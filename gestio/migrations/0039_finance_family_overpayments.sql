-- G.3: preserve dormant activity claims while admitting fee-source overpayments.
-- No finance_allocation row could reference this table before this migration:
-- FAMILY_OVERPAYMENT was disabled. Assert that premise before rebuilding it.
CREATE TABLE finance_overpayment_upgrade_assert(n INTEGER NOT NULL CHECK(n=0));
INSERT INTO finance_overpayment_upgrade_assert SELECT count(*) FROM finance_allocation WHERE overpayment_id IS NOT NULL;
DROP TABLE finance_overpayment_upgrade_assert;
DROP TRIGGER finance_overpayment_no_delete;
CREATE TABLE finance_overpayment_v39 (
  id TEXT PRIMARY KEY,
  round_id TEXT REFERENCES finance_round(id) ON DELETE RESTRICT,
  registration_id TEXT REFERENCES activity_registration(id) ON DELETE RESTRICT,
  fee_payment_id TEXT REFERENCES annual_fee_payment(id) ON DELETE RESTRICT,
  evidence_id TEXT REFERENCES payment_evidence(id) ON DELETE RESTRICT,
  recipient_email TEXT NOT NULL CHECK(length(recipient_email) BETWEEN 3 AND 254),
  cause TEXT NOT NULL CHECK(cause IN ('PAYMENT_EXCESS','PRICE_CORRECTION')),
  amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 100000000),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','RESOLVED')),
  created_by TEXT NOT NULL REFERENCES app_user(id),
  created_at INTEGER NOT NULL,
  resolved_by TEXT REFERENCES app_user(id),
  resolved_at INTEGER,
  CHECK((registration_id IS NOT NULL)+(fee_payment_id IS NOT NULL)=1),
  CHECK(evidence_id IS NULL OR registration_id IS NOT NULL),
  CHECK((status='RESOLVED')=(resolved_by IS NOT NULL AND resolved_at IS NOT NULL))
);
INSERT INTO finance_overpayment_v39(id,round_id,registration_id,evidence_id,recipient_email,cause,
  amount_cents,status,created_by,created_at,resolved_by,resolved_at)
SELECT o.id,r.finance_round_id,o.registration_id,o.evidence_id,r.receipt_email,'PAYMENT_EXCESS',
  o.amount_cents,o.status,o.created_by,o.created_at,o.resolved_by,o.resolved_at
FROM finance_overpayment o JOIN activity_registration r ON r.id=o.registration_id;
CREATE TABLE finance_overpayment_copy_assert(n INTEGER NOT NULL CHECK(n=0));
INSERT INTO finance_overpayment_copy_assert
SELECT (SELECT count(*) FROM finance_overpayment)-(SELECT count(*) FROM finance_overpayment_v39);
DROP TABLE finance_overpayment_copy_assert;
DROP TABLE finance_overpayment;
ALTER TABLE finance_overpayment_v39 RENAME TO finance_overpayment;
CREATE INDEX finance_overpayment_fee_idx ON finance_overpayment(fee_payment_id,status);
CREATE INDEX finance_overpayment_registration_idx ON finance_overpayment(registration_id,status);
CREATE TRIGGER finance_overpayment_no_delete BEFORE DELETE ON finance_overpayment
BEGIN SELECT RAISE(ABORT,'overpayment_immutable'); END;

DROP VIEW annual_fee_payment_balance;
CREATE VIEW annual_fee_payment_balance AS
SELECT p.id,p.round_id,p.review_status,p.verified_amount_cents,
  COALESCE((SELECT sum(a.amount_cents) FROM annual_fee_allocation a WHERE a.payment_id=p.id),0) AS allocated_cents,
  CASE WHEN p.verified_amount_cents IS NULL THEN NULL ELSE p.verified_amount_cents
    -COALESCE((SELECT sum(a.amount_cents) FROM annual_fee_allocation a WHERE a.payment_id=p.id),0)
    -COALESCE((SELECT sum(o.amount_cents) FROM finance_overpayment o WHERE o.fee_payment_id=p.id),0)
  END AS unallocated_cents
FROM annual_fee_payment p;

CREATE TRIGGER finance_overpayment_insert_guard BEFORE INSERT ON finance_overpayment
WHEN NEW.status!='OPEN' OR NEW.round_id IS NULL OR
  (NEW.fee_payment_id IS NOT NULL AND (
    NOT EXISTS(SELECT 1 FROM annual_fee_payment p JOIN finance_round r ON r.annual_fee_round_id=p.round_id
      WHERE p.id=NEW.fee_payment_id AND r.id=NEW.round_id AND p.review_status='VERIFIED'
        AND p.receipt_email=NEW.recipient_email) OR
    NEW.amount_cents>COALESCE((SELECT unallocated_cents FROM annual_fee_payment_balance
      WHERE id=NEW.fee_payment_id),0))) OR
  (NEW.registration_id IS NOT NULL AND (
    NOT EXISTS(SELECT 1 FROM activity_registration r WHERE r.id=NEW.registration_id
      AND r.finance_round_id=NEW.round_id AND r.receipt_email=NEW.recipient_email) OR
    NEW.amount_cents>COALESCE((SELECT paid_cents-due_cents FROM activity_payment_balance
      WHERE registration_id=NEW.registration_id),0)
      -COALESCE((SELECT sum(amount_cents) FROM finance_overpayment
        WHERE registration_id=NEW.registration_id),0)))
BEGIN SELECT RAISE(ABORT,'invalid_family_overpayment'); END;
CREATE TRIGGER finance_overpayment_update_guard BEFORE UPDATE ON finance_overpayment
WHEN NEW.id IS NOT OLD.id OR NEW.round_id IS NOT OLD.round_id OR
  NEW.registration_id IS NOT OLD.registration_id OR NEW.fee_payment_id IS NOT OLD.fee_payment_id OR
  NEW.evidence_id IS NOT OLD.evidence_id OR NEW.recipient_email IS NOT OLD.recipient_email OR
  NEW.cause IS NOT OLD.cause OR NEW.amount_cents IS NOT OLD.amount_cents OR
  NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at OR
  NOT (OLD.status='OPEN' AND NEW.status='RESOLVED' AND NEW.resolved_by IS NOT NULL
    AND NEW.resolved_at IS NOT NULL AND EXISTS(SELECT 1 FROM finance_allocation_current a
      WHERE a.kind='FAMILY_REFUND' AND a.overpayment_id=OLD.id AND a.amount_cents=OLD.amount_cents))
BEGIN SELECT RAISE(ABORT,'overpayment_immutable'); END;

DROP TRIGGER finance_allocation_kind_enabled;
CREATE TRIGGER finance_allocation_kind_enabled BEFORE INSERT ON finance_allocation
WHEN NEW.kind NOT IN ('INCOME','EXPENSE_SETTLEMENT','EXPENSE_REFUND','INTERNAL_TRANSFER',
  'REIMBURSEMENT_SETTLEMENT','FEE_PAYMENT','ACTIVITY_PAYMENT','FAMILY_OVERPAYMENT')
BEGIN SELECT RAISE(ABORT,'allocation_kind_not_enabled'); END;
CREATE TRIGGER finance_family_overpayment_allocation_guard BEFORE INSERT ON finance_allocation
WHEN NEW.kind='FAMILY_OVERPAYMENT' AND (
  (SELECT p.kind FROM finance_position p JOIN finance_movement m ON m.position_id=p.id WHERE m.id=NEW.movement_id) IS NOT 'BANK' OR
  NOT EXISTS(SELECT 1 FROM finance_overpayment o WHERE o.id=NEW.overpayment_id AND o.status='OPEN') OR
  NEW.amount_cents+COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a
    WHERE a.kind='FAMILY_OVERPAYMENT' AND a.overpayment_id=NEW.overpayment_id
      AND a.movement_id!=NEW.movement_id),0)
    >(SELECT amount_cents FROM finance_overpayment WHERE id=NEW.overpayment_id) OR
  EXISTS(SELECT 1 FROM finance_allocation a WHERE a.movement_id=NEW.movement_id
    AND a.set_version=NEW.set_version AND a.kind='FAMILY_OVERPAYMENT' AND a.overpayment_id=NEW.overpayment_id))
BEGIN SELECT RAISE(ABORT,'invalid_family_overpayment_allocation'); END;
