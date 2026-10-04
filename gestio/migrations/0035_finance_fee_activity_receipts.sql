-- G.3: bank reconciliation of existing, separately verified fee and activity receipts.
-- The physical movement is unique; these are typed destinations within its versioned allocation set.
ALTER TABLE activity_registration ADD COLUMN finance_round_id TEXT REFERENCES finance_round(id) ON DELETE RESTRICT;
UPDATE activity_registration SET finance_round_id=(
  SELECT r.id FROM finance_round r JOIN activity a ON a.id=activity_registration.activity_id
  WHERE date(a.starts_at/1000,'unixepoch') BETWEEN r.period_start AND r.period_end LIMIT 1)
WHERE expected_amount_cents>0;
CREATE TRIGGER activity_registration_finance_round_insert_guard BEFORE INSERT ON activity_registration
WHEN NEW.finance_round_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM finance_round r JOIN activity a ON a.id=NEW.activity_id
  WHERE r.id=NEW.finance_round_id AND date(a.starts_at/1000,'unixepoch') BETWEEN r.period_start AND r.period_end)
BEGIN SELECT RAISE(ABORT,'invalid_registration_finance_round'); END;
CREATE TRIGGER activity_registration_finance_round_immutable BEFORE UPDATE OF finance_round_id ON activity_registration
WHEN NEW.finance_round_id IS NOT OLD.finance_round_id AND (
  OLD.finance_round_id IS NOT NULL OR NEW.finance_round_id IS NULL OR
  NOT EXISTS(SELECT 1 FROM finance_round r JOIN activity a ON a.id=NEW.activity_id
    WHERE r.id=NEW.finance_round_id AND date(a.starts_at/1000,'unixepoch') BETWEEN r.period_start AND r.period_end))
BEGIN SELECT RAISE(ABORT,'registration_finance_round_immutable'); END;

DROP TRIGGER finance_allocation_kind_enabled;
CREATE TRIGGER finance_allocation_kind_enabled BEFORE INSERT ON finance_allocation
WHEN NEW.kind NOT IN ('INCOME','EXPENSE_SETTLEMENT','EXPENSE_REFUND','INTERNAL_TRANSFER',
  'REIMBURSEMENT_SETTLEMENT','FEE_PAYMENT','ACTIVITY_PAYMENT')
BEGIN SELECT RAISE(ABORT,'allocation_kind_not_enabled'); END;

CREATE INDEX finance_allocation_fee_payment_idx ON finance_allocation(fee_payment_id,set_version);
CREATE INDEX finance_allocation_activity_payment_idx ON finance_allocation(activity_allocation_id,set_version);
CREATE TRIGGER finance_fee_receipt_guard BEFORE INSERT ON finance_allocation
WHEN NEW.kind='FEE_PAYMENT' AND (
  (SELECT p.kind FROM finance_position p JOIN finance_movement m ON m.position_id=p.id WHERE m.id=NEW.movement_id) IS NOT 'BANK'
  OR NOT EXISTS(SELECT 1 FROM annual_fee_payment p JOIN finance_round r ON r.annual_fee_round_id=p.round_id
    WHERE p.id=NEW.fee_payment_id AND p.review_status='VERIFIED' AND p.verified_amount_cents IS NOT NULL)
  OR EXISTS(SELECT 1 FROM annual_fee_issue i WHERE i.status='OPEN' AND
    (i.payment_id=NEW.fee_payment_id OR EXISTS(SELECT 1 FROM annual_fee_allocation a
      WHERE a.payment_id=NEW.fee_payment_id AND a.obligation_id=i.obligation_id)))
  OR NEW.amount_cents+COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a
    WHERE a.fee_payment_id=NEW.fee_payment_id AND a.kind='FEE_PAYMENT'),0)
    >(SELECT COALESCE(sum(a.amount_cents),0) FROM annual_fee_allocation a JOIN annual_fee_payment p ON p.id=a.payment_id
      WHERE p.id=NEW.fee_payment_id AND p.review_status='VERIFIED')
  OR EXISTS(SELECT 1 FROM finance_allocation a WHERE a.movement_id=NEW.movement_id AND a.set_version=NEW.set_version
    AND a.fee_payment_id=NEW.fee_payment_id AND a.kind='FEE_PAYMENT')
)
BEGIN SELECT RAISE(ABORT,'invalid_fee_receipt'); END;
CREATE TRIGGER annual_fee_payment_reconciled_guard BEFORE UPDATE OF review_status,verified_amount_cents ON annual_fee_payment
WHEN EXISTS(SELECT 1 FROM finance_allocation_current a WHERE a.fee_payment_id=OLD.id AND a.kind='FEE_PAYMENT')
  AND (NEW.review_status!='VERIFIED' OR NEW.verified_amount_cents IS NOT OLD.verified_amount_cents)
BEGIN SELECT RAISE(ABORT,'reconciled_fee_payment_locked'); END;
CREATE TRIGGER annual_fee_allocation_reconciled_guard BEFORE DELETE ON annual_fee_allocation
WHEN EXISTS(SELECT 1 FROM finance_allocation_current a WHERE a.fee_payment_id=OLD.payment_id AND a.kind='FEE_PAYMENT')
BEGIN SELECT RAISE(ABORT,'reconciled_fee_payment_locked'); END;

CREATE TRIGGER finance_activity_receipt_guard BEFORE INSERT ON finance_allocation
WHEN NEW.kind='ACTIVITY_PAYMENT' AND (
  (SELECT p.kind FROM finance_position p JOIN finance_movement m ON m.position_id=p.id WHERE m.id=NEW.movement_id) IS NOT 'BANK'
  OR NOT EXISTS(SELECT 1 FROM activity_payment_allocation pa JOIN activity_registration ar ON ar.id=pa.registration_id
    JOIN finance_round r ON r.id=ar.finance_round_id
    LEFT JOIN payment_evidence e ON e.id=pa.evidence_id
    WHERE pa.id=NEW.activity_allocation_id AND ar.expected_amount_cents>0
      AND (pa.evidence_id IS NULL OR e.review_status='VERIFIED'))
  OR NEW.amount_cents+COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a
    WHERE a.activity_allocation_id=NEW.activity_allocation_id AND a.kind='ACTIVITY_PAYMENT'),0)
    >(SELECT amount_cents FROM activity_payment_allocation WHERE id=NEW.activity_allocation_id)
  OR EXISTS(SELECT 1 FROM finance_allocation a WHERE a.movement_id=NEW.movement_id AND a.set_version=NEW.set_version
    AND a.activity_allocation_id=NEW.activity_allocation_id AND a.kind='ACTIVITY_PAYMENT')
)
BEGIN SELECT RAISE(ABORT,'invalid_activity_receipt'); END;
CREATE TRIGGER payment_evidence_reconciled_guard BEFORE UPDATE OF review_status ON payment_evidence
WHEN NEW.review_status!='VERIFIED' AND EXISTS(SELECT 1 FROM activity_payment_allocation pa
  JOIN finance_allocation_current a ON a.activity_allocation_id=pa.id AND a.kind='ACTIVITY_PAYMENT'
  WHERE pa.evidence_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'reconciled_activity_payment_locked'); END;

DROP VIEW finance_round_economics;
CREATE VIEW finance_round_economics AS
SELECT r.id AS round_id,
  COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a WHERE a.kind='INCOME' AND a.round_id=r.id),0)
    +COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a JOIN annual_fee_payment p ON p.id=a.fee_payment_id
      WHERE a.kind='FEE_PAYMENT' AND p.round_id=r.annual_fee_round_id),0)
    +COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a
      JOIN activity_payment_allocation pa ON pa.id=a.activity_allocation_id
      JOIN activity_registration ar ON ar.id=pa.registration_id
      WHERE a.kind='ACTIVITY_PAYMENT' AND ar.finance_round_id=r.id),0) AS income_cents,
  COALESCE((SELECT sum(e.total_cents) FROM finance_expense e WHERE e.round_id=r.id AND e.status='RECOGNISED'),0) AS expense_gross_cents,
  COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a JOIN finance_expense e ON e.id=a.expense_id
    WHERE a.kind='EXPENSE_REFUND' AND e.round_id=r.id AND e.status='RECOGNISED'),0) AS expense_refund_cents,
  COALESCE((SELECT sum(e.total_cents) FROM finance_expense e WHERE e.round_id=r.id AND e.status='PROPOSED'),0) AS proposed_expense_cents
FROM finance_round r;
