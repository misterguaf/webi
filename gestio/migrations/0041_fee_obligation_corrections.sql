-- G.3: a paid fee may be corrected downward without rewriting verified payment or allocation history.
-- The part above the corrected obligation becomes a separately refundable claim tied to its source.
ALTER TABLE finance_overpayment ADD COLUMN fee_obligation_id TEXT REFERENCES annual_fee_obligation(id) ON DELETE RESTRICT;
CREATE INDEX finance_overpayment_fee_obligation_idx ON finance_overpayment(fee_obligation_id);
ALTER TABLE annual_fee_family_revision ADD COLUMN reason TEXT;
CREATE TABLE finance_fee_correction_gate (
  obligation_id TEXT PRIMARY KEY REFERENCES annual_fee_obligation(id) ON DELETE RESTRICT,
  target_due_cents INTEGER NOT NULL CHECK(target_due_cents BETWEEN 1 AND 10000000),
  reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 240),
  opened_by TEXT NOT NULL REFERENCES app_user(id),
  opened_at INTEGER NOT NULL
);

DROP TRIGGER finance_overpayment_insert_guard;
CREATE TRIGGER finance_overpayment_insert_guard BEFORE INSERT ON finance_overpayment
WHEN NEW.status!='OPEN' OR NEW.round_id IS NULL OR
  (NEW.fee_payment_id IS NOT NULL AND (
    NOT EXISTS(SELECT 1 FROM annual_fee_payment p JOIN finance_round r ON r.annual_fee_round_id=p.round_id
      WHERE p.id=NEW.fee_payment_id AND r.id=NEW.round_id AND p.review_status='VERIFIED'
        AND p.receipt_email=NEW.recipient_email) OR
    (NEW.cause='PAYMENT_EXCESS' AND (NEW.fee_obligation_id IS NOT NULL OR
      NEW.amount_cents>COALESCE((SELECT unallocated_cents FROM annual_fee_payment_balance
        WHERE id=NEW.fee_payment_id),0))) OR
    (NEW.cause='PRICE_CORRECTION' AND (
      NEW.fee_obligation_id IS NULL OR
      NOT EXISTS(SELECT 1 FROM finance_fee_correction_gate g JOIN annual_fee_obligation ob ON ob.id=g.obligation_id
        JOIN annual_fee_payment p ON p.round_id=ob.round_id
        WHERE g.obligation_id=NEW.fee_obligation_id AND p.id=NEW.fee_payment_id AND g.opened_by=NEW.created_by)
      OR NEW.amount_cents>COALESCE((SELECT sum(a.amount_cents) FROM annual_fee_allocation a
        WHERE a.payment_id=NEW.fee_payment_id AND a.obligation_id=NEW.fee_obligation_id),0)
        -COALESCE((SELECT sum(o.amount_cents) FROM finance_overpayment o
          WHERE o.fee_payment_id=NEW.fee_payment_id AND o.fee_obligation_id=NEW.fee_obligation_id),0)
      OR NEW.amount_cents>COALESCE((SELECT sum(a.amount_cents) FROM annual_fee_allocation a
        JOIN annual_fee_payment p ON p.id=a.payment_id
        WHERE a.obligation_id=NEW.fee_obligation_id AND p.review_status='VERIFIED'),0)
        -(SELECT target_due_cents FROM finance_fee_correction_gate WHERE obligation_id=NEW.fee_obligation_id)
        -COALESCE((SELECT sum(o.amount_cents) FROM finance_overpayment o
          WHERE o.fee_obligation_id=NEW.fee_obligation_id),0)))
  )) OR
  (NEW.registration_id IS NOT NULL AND (NEW.fee_obligation_id IS NOT NULL OR
    NOT EXISTS(SELECT 1 FROM activity_registration r WHERE r.id=NEW.registration_id
      AND r.finance_round_id=NEW.round_id AND r.receipt_email=NEW.recipient_email) OR
    NEW.amount_cents>COALESCE((SELECT paid_cents-due_cents FROM activity_payment_balance
      WHERE registration_id=NEW.registration_id),0)
      -COALESCE((SELECT sum(amount_cents) FROM finance_overpayment
        WHERE registration_id=NEW.registration_id),0)))
BEGIN SELECT RAISE(ABORT,'invalid_family_overpayment'); END;

DROP TRIGGER finance_overpayment_update_guard;
CREATE TRIGGER finance_overpayment_update_guard BEFORE UPDATE ON finance_overpayment
WHEN NEW.id IS NOT OLD.id OR NEW.round_id IS NOT OLD.round_id OR
  NEW.registration_id IS NOT OLD.registration_id OR NEW.fee_payment_id IS NOT OLD.fee_payment_id OR
  NEW.fee_obligation_id IS NOT OLD.fee_obligation_id OR NEW.evidence_id IS NOT OLD.evidence_id OR
  NEW.recipient_email IS NOT OLD.recipient_email OR NEW.cause IS NOT OLD.cause OR
  NEW.amount_cents IS NOT OLD.amount_cents OR NEW.created_by IS NOT OLD.created_by OR
  NEW.created_at IS NOT OLD.created_at OR
  NOT ((OLD.status='OPEN' AND NEW.status='RESOLVED' AND NEW.resolved_by IS NOT NULL
      AND NEW.resolved_at IS NOT NULL AND NEW.amount_cents=COALESCE((SELECT sum(a.amount_cents)
        FROM finance_allocation_current a WHERE a.kind='FAMILY_REFUND' AND a.overpayment_id=OLD.id),0)) OR
    (OLD.status='RESOLVED' AND NEW.status='OPEN' AND NEW.resolved_by IS NULL AND NEW.resolved_at IS NULL
      AND OLD.amount_cents>COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a
        WHERE a.kind='FAMILY_REFUND' AND a.overpayment_id=OLD.id),0)))
BEGIN SELECT RAISE(ABORT,'overpayment_immutable'); END;

DROP VIEW annual_fee_payment_balance;
CREATE VIEW annual_fee_payment_balance AS
SELECT p.id,p.round_id,p.review_status,p.verified_amount_cents,
  COALESCE((SELECT sum(a.amount_cents) FROM annual_fee_allocation a WHERE a.payment_id=p.id),0)
    -COALESCE((SELECT sum(o.amount_cents) FROM finance_overpayment o
      WHERE o.fee_payment_id=p.id AND o.cause='PRICE_CORRECTION'),0) AS allocated_cents,
  CASE WHEN p.verified_amount_cents IS NULL THEN NULL ELSE p.verified_amount_cents
    -COALESCE((SELECT sum(a.amount_cents) FROM annual_fee_allocation a WHERE a.payment_id=p.id),0)
    -COALESCE((SELECT sum(o.amount_cents) FROM finance_overpayment o
      WHERE o.fee_payment_id=p.id AND o.cause='PAYMENT_EXCESS'),0)
  END AS unallocated_cents
FROM annual_fee_payment p;

DROP TRIGGER annual_fee_obligation_allocation_amount_guard;
CREATE TRIGGER annual_fee_obligation_allocation_amount_guard BEFORE UPDATE OF amount_due_cents ON annual_fee_obligation
WHEN NEW.amount_due_cents<(
    SELECT COALESCE(sum(a.amount_cents),0) FROM annual_fee_allocation a WHERE a.obligation_id=NEW.id)
    -COALESCE((SELECT sum(o.amount_cents) FROM finance_overpayment o WHERE o.fee_obligation_id=NEW.id),0)
  OR (NEW.amount_due_cents<OLD.amount_due_cents AND EXISTS(SELECT 1 FROM annual_fee_allocation a
    WHERE a.obligation_id=NEW.id) AND NOT EXISTS(SELECT 1 FROM finance_fee_correction_gate g
      WHERE g.obligation_id=NEW.id AND g.target_due_cents=NEW.amount_due_cents))
BEGIN SELECT RAISE(ABORT,'fee_allocation_exceeds_amount_due'); END;

DROP VIEW annual_fee_obligation_status;
CREATE VIEW annual_fee_obligation_status AS
SELECT s.*,
  CASE
    WHEN EXISTS(SELECT 1 FROM annual_fee_issue i WHERE i.obligation_id=s.id AND i.status='OPEN') THEN 'ISSUE'
    WHEN EXISTS(SELECT 1 FROM annual_fee_allocation a JOIN annual_fee_issue i ON i.payment_id=a.payment_id
      WHERE a.obligation_id=s.id AND i.status='OPEN' AND
      (i.obligation_id IS NULL OR i.code IN ('BANK_NOT_FOUND','EVIDENCE_PROBLEM','UNIDENTIFIED_TRANSFER'))) THEN 'ISSUE'
    WHEN s.allocated_cents>s.amount_due_cents THEN 'ISSUE'
    WHEN s.allocated_cents=s.amount_due_cents THEN 'PAID'
    WHEN s.allocated_cents>0 THEN 'PARTIAL'
    ELSE 'PENDING' END AS status
FROM (
  SELECT o.id,o.round_id,o.participant_id,o.family_group_id,o.sibling_ordinal,o.base_cents,o.discount_cents,
    o.amount_due_cents,o.override_by,o.created_at,p.display_name,p.current_section_id,
    COALESCE((SELECT sum(a.amount_cents) FROM annual_fee_allocation a JOIN annual_fee_payment pay ON pay.id=a.payment_id
      WHERE a.obligation_id=o.id AND pay.review_status='VERIFIED' AND pay.verified_amount_cents IS NOT NULL),0)
      -COALESCE((SELECT sum(claim.amount_cents) FROM finance_overpayment claim
        JOIN annual_fee_payment pay ON pay.id=claim.fee_payment_id
        WHERE claim.fee_obligation_id=o.id AND pay.review_status='VERIFIED'),0) AS allocated_cents
  FROM annual_fee_obligation o JOIN participant p ON p.id=o.participant_id
) s;

DROP TRIGGER finance_fee_receipt_guard;
CREATE TRIGGER finance_fee_receipt_guard BEFORE INSERT ON finance_allocation
WHEN NEW.kind='FEE_PAYMENT' AND (
  (SELECT p.kind FROM finance_position p JOIN finance_movement m ON m.position_id=p.id WHERE m.id=NEW.movement_id) IS NOT 'BANK'
  OR NOT EXISTS(SELECT 1 FROM annual_fee_payment p JOIN finance_round r ON r.annual_fee_round_id=p.round_id
    WHERE p.id=NEW.fee_payment_id AND p.review_status='VERIFIED' AND p.verified_amount_cents IS NOT NULL)
  OR EXISTS(SELECT 1 FROM annual_fee_issue i WHERE i.status='OPEN' AND
    (i.payment_id=NEW.fee_payment_id OR EXISTS(SELECT 1 FROM annual_fee_allocation a
      WHERE a.payment_id=NEW.fee_payment_id AND a.obligation_id=i.obligation_id)))
  OR NEW.amount_cents+COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a
    WHERE a.fee_payment_id=NEW.fee_payment_id AND a.kind='FEE_PAYMENT' AND a.movement_id!=NEW.movement_id),0)
    >(SELECT COALESCE(sum(a.amount_cents),0) FROM annual_fee_allocation a WHERE a.payment_id=NEW.fee_payment_id)
      -(SELECT COALESCE(sum(o.amount_cents),0) FROM finance_overpayment o
        WHERE o.fee_payment_id=NEW.fee_payment_id AND o.cause='PRICE_CORRECTION')
  OR EXISTS(SELECT 1 FROM finance_allocation a WHERE a.movement_id=NEW.movement_id AND a.set_version=NEW.set_version
    AND a.fee_payment_id=NEW.fee_payment_id AND a.kind='FEE_PAYMENT')
)
BEGIN SELECT RAISE(ABORT,'invalid_fee_receipt'); END;

DROP VIEW finance_round_economics;
CREATE VIEW finance_round_economics AS
SELECT r.id AS round_id,
  COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a WHERE a.kind='INCOME' AND a.round_id=r.id),0)
    +COALESCE((SELECT sum(min(
      COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a
        WHERE a.kind='FEE_PAYMENT' AND a.fee_payment_id=p.id),0),
      COALESCE((SELECT sum(a.amount_cents) FROM annual_fee_allocation a WHERE a.payment_id=p.id),0)
        -COALESCE((SELECT sum(o.amount_cents) FROM finance_overpayment o
          WHERE o.fee_payment_id=p.id AND o.cause='PRICE_CORRECTION'),0)))
      FROM annual_fee_payment p WHERE p.round_id=r.annual_fee_round_id),0)
    +COALESCE((SELECT sum(max(0,
      min(COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a
        JOIN activity_payment_allocation pa ON pa.id=a.activity_allocation_id
        WHERE a.kind='ACTIVITY_PAYMENT' AND pa.registration_id=ar.id),0),ar.expected_amount_cents)
      -min(COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a
        JOIN activity_payment_allocation pa ON pa.id=a.activity_allocation_id
        WHERE a.kind='FAMILY_REFUND' AND pa.registration_id=ar.id),0),
        COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a
          JOIN activity_payment_allocation pa ON pa.id=a.activity_allocation_id
          WHERE a.kind='ACTIVITY_PAYMENT' AND pa.registration_id=ar.id),0))))
      FROM activity_registration ar WHERE ar.finance_round_id=r.id),0) AS income_cents,
  COALESCE((SELECT sum(e.total_cents) FROM finance_expense e WHERE e.round_id=r.id AND e.status='RECOGNISED'),0) AS expense_gross_cents,
  COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a JOIN finance_expense e ON e.id=a.expense_id
    WHERE a.kind='EXPENSE_REFUND' AND e.round_id=r.id AND e.status='RECOGNISED'),0) AS expense_refund_cents,
  COALESCE((SELECT sum(e.total_cents) FROM finance_expense e WHERE e.round_id=r.id AND e.status='PROPOSED'),0) AS proposed_expense_cents
FROM finance_round r;
