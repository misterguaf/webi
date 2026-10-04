-- G.3: a family refund is a separate obligation. One source payment/claim can have one refund
-- obligation; a BANK debit may settle several obligations, but only for one recipient.
CREATE TABLE finance_family_refund (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES finance_round(id) ON DELETE RESTRICT,
  activity_allocation_id TEXT UNIQUE REFERENCES activity_payment_allocation(id) ON DELETE RESTRICT,
  overpayment_id TEXT UNIQUE REFERENCES finance_overpayment(id) ON DELETE RESTRICT,
  recipient_email TEXT NOT NULL CHECK(length(recipient_email) BETWEEN 3 AND 254),
  cause TEXT NOT NULL CHECK(cause IN ('OVERPAYMENT_REFUND','ACTIVITY_WITHDRAWAL_REFUND','ACTIVITY_REJECTION_REFUND')),
  amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 100000000),
  decision_id TEXT REFERENCES finance_family_refund_decision(id) ON DELETE RESTRICT,
  created_by TEXT NOT NULL REFERENCES app_user(id),
  created_at INTEGER NOT NULL,
  CHECK((activity_allocation_id IS NOT NULL)+(overpayment_id IS NOT NULL)=1),
  CHECK((cause='OVERPAYMENT_REFUND')=(overpayment_id IS NOT NULL))
);
CREATE INDEX finance_family_refund_round_idx ON finance_family_refund(round_id,created_at);
CREATE TABLE finance_family_refund_decision (
  id TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL REFERENCES activity_registration(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK(decision IN ('FULL','PARTIAL','NONE')),
  basis_paid_cents INTEGER NOT NULL CHECK(basis_paid_cents>=0),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 3 AND 240),
  authorized_by TEXT NOT NULL REFERENCES app_user(id),
  authorized_at INTEGER NOT NULL,
  UNIQUE(registration_id,basis_paid_cents)
);
CREATE INDEX finance_family_refund_decision_registration_idx ON finance_family_refund_decision(registration_id,authorized_at);
CREATE TRIGGER finance_family_refund_decision_guard BEFORE INSERT ON finance_family_refund_decision
WHEN NOT EXISTS(SELECT 1 FROM activity_registration r JOIN activity_payment_balance b ON b.registration_id=r.id
    WHERE r.id=NEW.registration_id AND r.status='WITHDRAWN' AND b.paid_cents=NEW.basis_paid_cents)
BEGIN SELECT RAISE(ABORT,'invalid_family_refund_decision'); END;
CREATE TRIGGER finance_family_refund_decision_no_update BEFORE UPDATE ON finance_family_refund_decision
BEGIN SELECT RAISE(ABORT,'family_refund_decision_immutable'); END;
CREATE TRIGGER finance_family_refund_decision_no_delete BEFORE DELETE ON finance_family_refund_decision
BEGIN SELECT RAISE(ABORT,'family_refund_decision_immutable'); END;
CREATE TRIGGER finance_family_refund_insert_guard BEFORE INSERT ON finance_family_refund
WHEN (NEW.overpayment_id IS NOT NULL AND (
    NEW.cause!='OVERPAYMENT_REFUND' OR NEW.decision_id IS NOT NULL OR
    NOT EXISTS(SELECT 1 FROM finance_overpayment o WHERE o.id=NEW.overpayment_id AND o.status='OPEN'
      AND o.round_id=NEW.round_id AND o.recipient_email=NEW.recipient_email AND o.amount_cents=NEW.amount_cents
      AND o.amount_cents=COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a
        WHERE a.kind='FAMILY_OVERPAYMENT' AND a.overpayment_id=o.id),0))))
  OR (NEW.activity_allocation_id IS NOT NULL AND (
    NOT EXISTS(SELECT 1 FROM activity_payment_allocation a JOIN activity_registration r ON r.id=a.registration_id
      WHERE a.id=NEW.activity_allocation_id AND r.finance_round_id=NEW.round_id
        AND r.receipt_email=NEW.recipient_email AND NEW.amount_cents<=a.amount_cents
        AND ((r.status='WITHDRAWN' AND NEW.cause='ACTIVITY_WITHDRAWAL_REFUND'
          AND EXISTS(SELECT 1 FROM finance_family_refund_decision d WHERE d.id=NEW.decision_id
            AND d.registration_id=r.id AND d.decision IN ('FULL','PARTIAL')))
          OR (r.status='REJECTED' AND NEW.cause='ACTIVITY_REJECTION_REFUND' AND NEW.decision_id IS NULL
            AND NEW.amount_cents=a.amount_cents)))))
BEGIN SELECT RAISE(ABORT,'invalid_family_refund'); END;
CREATE TRIGGER finance_family_refund_no_update BEFORE UPDATE ON finance_family_refund
BEGIN SELECT RAISE(ABORT,'family_refund_immutable'); END;
CREATE TRIGGER finance_family_refund_no_delete BEFORE DELETE ON finance_family_refund
BEGIN SELECT RAISE(ABORT,'family_refund_immutable'); END;

-- A registration can be rejected while still awaiting participant matching. Treasury may have
-- verified its payment without resolving the child's identity. Rejection creates FULL refund dues.
DROP TRIGGER activity_payment_allocation_guard;
CREATE TRIGGER activity_payment_allocation_guard BEFORE INSERT ON activity_payment_allocation
WHEN NOT EXISTS(SELECT 1 FROM activity_registration r WHERE r.id=NEW.registration_id
    AND r.status IN ('NEEDS_PARTICIPANT_REVIEW','AWAITING_PAYMENT_REVIEW','WITHDRAWN','CONFIRMED'))
  OR (NEW.evidence_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM payment_evidence e WHERE e.id=NEW.evidence_id AND e.registration_id=NEW.registration_id))
  OR NEW.amount_cents+(SELECT COALESCE(SUM(a.amount_cents),0) FROM activity_payment_allocation a WHERE a.registration_id=NEW.registration_id)
    >(SELECT expected_amount_cents FROM activity_registration WHERE id=NEW.registration_id)
BEGIN SELECT RAISE(ABORT,'invalid_payment_allocation'); END;
CREATE TRIGGER finance_rejected_registration_refunds AFTER UPDATE OF status ON activity_registration
WHEN NEW.status='REJECTED' AND OLD.status!='REJECTED' AND NEW.finance_round_id IS NOT NULL
BEGIN
  INSERT INTO finance_family_refund(id,round_id,activity_allocation_id,recipient_email,cause,amount_cents,created_by,created_at)
  SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||
    substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
    NEW.finance_round_id,a.id,NEW.receipt_email,'ACTIVITY_REJECTION_REFUND',a.amount_cents,NEW.reviewed_by,NEW.reviewed_at
  FROM activity_payment_allocation a WHERE a.registration_id=NEW.id;
END;
CREATE TRIGGER finance_rejected_registration_round_guard BEFORE UPDATE OF status ON activity_registration
WHEN NEW.status='REJECTED' AND OLD.status!='REJECTED' AND NEW.finance_round_id IS NULL
  AND EXISTS(SELECT 1 FROM activity_payment_allocation a WHERE a.registration_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'paid_rejection_requires_finance_round'); END;

DROP TRIGGER finance_allocation_kind_enabled;
CREATE TRIGGER finance_allocation_kind_enabled BEFORE INSERT ON finance_allocation
WHEN NEW.kind NOT IN ('INCOME','EXPENSE_SETTLEMENT','EXPENSE_REFUND','INTERNAL_TRANSFER',
  'REIMBURSEMENT_SETTLEMENT','FEE_PAYMENT','ACTIVITY_PAYMENT','FAMILY_OVERPAYMENT','FAMILY_REFUND')
BEGIN SELECT RAISE(ABORT,'allocation_kind_not_enabled'); END;
CREATE TRIGGER finance_family_refund_allocation_guard BEFORE INSERT ON finance_allocation
WHEN NEW.kind='FAMILY_REFUND' AND (
  NEW.fee_payment_id IS NOT NULL OR NEW.budget_line_id IS NOT NULL OR NEW.expense_id IS NOT NULL OR
  NEW.paired_movement_id IS NOT NULL OR NEW.reimbursement_id IS NOT NULL OR
  (SELECT p.kind FROM finance_position p JOIN finance_movement m ON m.position_id=p.id WHERE m.id=NEW.movement_id) IS NOT 'BANK' OR
  NOT EXISTS(SELECT 1 FROM finance_family_refund f WHERE
    (NEW.activity_allocation_id IS NOT NULL AND f.activity_allocation_id=NEW.activity_allocation_id) OR
    (NEW.overpayment_id IS NOT NULL AND f.overpayment_id=NEW.overpayment_id)) OR
  NEW.amount_cents+COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a
    WHERE a.kind='FAMILY_REFUND' AND a.movement_id!=NEW.movement_id AND
      ((NEW.activity_allocation_id IS NOT NULL AND a.activity_allocation_id=NEW.activity_allocation_id) OR
       (NEW.overpayment_id IS NOT NULL AND a.overpayment_id=NEW.overpayment_id))),0)
    >(SELECT f.amount_cents FROM finance_family_refund f WHERE
      (NEW.activity_allocation_id IS NOT NULL AND f.activity_allocation_id=NEW.activity_allocation_id) OR
      (NEW.overpayment_id IS NOT NULL AND f.overpayment_id=NEW.overpayment_id)) OR
  EXISTS(SELECT 1 FROM finance_allocation a WHERE a.movement_id=NEW.movement_id AND a.set_version=NEW.set_version
    AND a.kind='FAMILY_REFUND' AND a.activity_allocation_id IS NEW.activity_allocation_id
    AND a.overpayment_id IS NEW.overpayment_id) OR
  EXISTS(SELECT 1 FROM finance_allocation a JOIN finance_family_refund f ON
      (f.activity_allocation_id=a.activity_allocation_id AND a.activity_allocation_id IS NOT NULL) OR
      (f.overpayment_id=a.overpayment_id AND a.overpayment_id IS NOT NULL)
    WHERE a.movement_id=NEW.movement_id AND a.set_version=NEW.set_version AND a.kind='FAMILY_REFUND'
      AND f.recipient_email!=(SELECT recipient_email FROM finance_family_refund WHERE
        (NEW.activity_allocation_id IS NOT NULL AND activity_allocation_id=NEW.activity_allocation_id) OR
        (NEW.overpayment_id IS NOT NULL AND overpayment_id=NEW.overpayment_id)))
)
BEGIN SELECT RAISE(ABORT,'invalid_family_refund_allocation'); END;
CREATE TRIGGER finance_family_refund_movement_exclusive BEFORE INSERT ON finance_allocation
WHEN (NEW.kind='FAMILY_REFUND' AND EXISTS(SELECT 1 FROM finance_allocation a
    WHERE a.movement_id=NEW.movement_id AND a.set_version=NEW.set_version AND a.kind!='FAMILY_REFUND'))
  OR (NEW.kind!='FAMILY_REFUND' AND EXISTS(SELECT 1 FROM finance_allocation a
    WHERE a.movement_id=NEW.movement_id AND a.set_version=NEW.set_version AND a.kind='FAMILY_REFUND'))
BEGIN SELECT RAISE(ABORT,'invalid_family_refund_allocation'); END;

-- The old overpayment's RESOLVED flag follows its current refund allocations even if a movement
-- is reclassified later; the immutable claim amount and origin never change.
DROP TRIGGER finance_overpayment_update_guard;
CREATE TRIGGER finance_overpayment_update_guard BEFORE UPDATE ON finance_overpayment
WHEN NEW.id IS NOT OLD.id OR NEW.round_id IS NOT OLD.round_id OR
  NEW.registration_id IS NOT OLD.registration_id OR NEW.fee_payment_id IS NOT OLD.fee_payment_id OR
  NEW.evidence_id IS NOT OLD.evidence_id OR NEW.recipient_email IS NOT OLD.recipient_email OR
  NEW.cause IS NOT OLD.cause OR NEW.amount_cents IS NOT OLD.amount_cents OR
  NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at OR
  NOT ((OLD.status='OPEN' AND NEW.status='RESOLVED' AND NEW.resolved_by IS NOT NULL
      AND NEW.resolved_at IS NOT NULL AND NEW.amount_cents=COALESCE((SELECT sum(a.amount_cents)
        FROM finance_allocation_current a WHERE a.kind='FAMILY_REFUND' AND a.overpayment_id=OLD.id),0)) OR
    (OLD.status='RESOLVED' AND NEW.status='OPEN' AND NEW.resolved_by IS NULL AND NEW.resolved_at IS NULL
      AND OLD.amount_cents>COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a
        WHERE a.kind='FAMILY_REFUND' AND a.overpayment_id=OLD.id),0)))
BEGIN SELECT RAISE(ABORT,'overpayment_immutable'); END;
CREATE TRIGGER finance_overpayment_refund_settled AFTER INSERT ON finance_allocation
WHEN NEW.kind='FAMILY_REFUND' AND NEW.overpayment_id IS NOT NULL
  AND (SELECT amount_cents FROM finance_overpayment WHERE id=NEW.overpayment_id)=
    (SELECT COALESCE(sum(amount_cents),0) FROM finance_allocation_current
      WHERE kind='FAMILY_REFUND' AND overpayment_id=NEW.overpayment_id)
BEGIN UPDATE finance_overpayment SET status='RESOLVED',resolved_by=NEW.created_by,resolved_at=NEW.created_at
  WHERE id=NEW.overpayment_id AND status='OPEN'; END;
CREATE TRIGGER finance_overpayment_refund_reopened AFTER UPDATE OF allocation_version ON finance_movement
WHEN NEW.allocation_version=OLD.allocation_version+1
BEGIN UPDATE finance_overpayment SET status='OPEN',resolved_by=NULL,resolved_at=NULL
  WHERE id IN (SELECT overpayment_id FROM finance_allocation a WHERE a.movement_id=OLD.id
    AND a.set_version=OLD.allocation_version AND a.kind='FAMILY_REFUND' AND a.overpayment_id IS NOT NULL)
    AND status='RESOLVED' AND amount_cents>(SELECT COALESCE(sum(amount_cents),0)
      FROM finance_allocation_current x WHERE x.kind='FAMILY_REFUND' AND x.overpayment_id=finance_overpayment.id);
END;

DROP VIEW finance_round_economics;
CREATE VIEW finance_round_economics AS
SELECT r.id AS round_id,
  COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a WHERE a.kind='INCOME' AND a.round_id=r.id),0)
    +COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a JOIN annual_fee_payment p ON p.id=a.fee_payment_id
      WHERE a.kind='FEE_PAYMENT' AND p.round_id=r.annual_fee_round_id),0)
    +COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a
      JOIN activity_payment_allocation pa ON pa.id=a.activity_allocation_id
      JOIN activity_registration ar ON ar.id=pa.registration_id
      WHERE a.kind='ACTIVITY_PAYMENT' AND ar.finance_round_id=r.id),0)
    -COALESCE((SELECT sum(min(
      COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a
        WHERE a.kind='FAMILY_REFUND' AND a.activity_allocation_id=f.activity_allocation_id),0),
      COALESCE((SELECT sum(receipt.amount_cents) FROM finance_allocation_current receipt
        WHERE receipt.kind='ACTIVITY_PAYMENT' AND receipt.activity_allocation_id=f.activity_allocation_id),0)))
      FROM finance_family_refund f WHERE f.activity_allocation_id IS NOT NULL AND f.round_id=r.id),0) AS income_cents,
  COALESCE((SELECT sum(e.total_cents) FROM finance_expense e WHERE e.round_id=r.id AND e.status='RECOGNISED'),0) AS expense_gross_cents,
  COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a JOIN finance_expense e ON e.id=a.expense_id
    WHERE a.kind='EXPENSE_REFUND' AND e.round_id=r.id AND e.status='RECOGNISED'),0) AS expense_refund_cents,
  COALESCE((SELECT sum(e.total_cents) FROM finance_expense e WHERE e.round_id=r.id AND e.status='PROPOSED'),0) AS proposed_expense_cents
FROM finance_round r;
