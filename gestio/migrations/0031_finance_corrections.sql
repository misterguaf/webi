-- G.2C: preserve the reason beside immutable financial history, not in public audit metadata.
ALTER TABLE finance_expense_revision ADD COLUMN previous_status TEXT;
ALTER TABLE finance_expense_revision ADD COLUMN reason TEXT CHECK(reason IS NULL OR length(trim(reason)) BETWEEN 3 AND 240);

-- A receipt is current until explicitly replaced. Purge remains a separate retention operation.
ALTER TABLE finance_expense_evidence ADD COLUMN superseded_at INTEGER;
ALTER TABLE finance_expense_evidence ADD COLUMN superseded_by_id TEXT REFERENCES finance_expense_evidence(id) ON DELETE RESTRICT;
CREATE INDEX finance_expense_evidence_current_idx ON finance_expense_evidence(expense_id,superseded_at,object_purged_at);
DROP TRIGGER finance_expense_evidence_immutable;
CREATE TRIGGER finance_expense_evidence_immutable BEFORE UPDATE ON finance_expense_evidence
WHEN OLD.object_purged_at IS NOT NULL OR NEW.expense_id IS NOT OLD.expense_id OR NEW.object_key IS NOT OLD.object_key
  OR NEW.sha256 IS NOT OLD.sha256 OR NEW.size_bytes IS NOT OLD.size_bytes OR NEW.detected_mime IS NOT OLD.detected_mime
  OR NEW.uploaded_by IS NOT OLD.uploaded_by OR NEW.created_at IS NOT OLD.created_at
  OR NEW.superseded_at IS NOT OLD.superseded_at AND NOT (OLD.superseded_at IS NULL AND NEW.superseded_at IS NOT NULL
    AND NEW.superseded_by_id IS NOT NULL AND EXISTS(SELECT 1 FROM finance_expense_evidence replacement
      WHERE replacement.id=NEW.superseded_by_id AND replacement.expense_id=OLD.expense_id
        AND replacement.superseded_at IS NULL AND replacement.object_purged_at IS NULL))
  OR (NEW.superseded_by_id IS NOT OLD.superseded_by_id AND OLD.superseded_at IS NOT NULL)
  OR (NEW.superseded_at IS NULL AND NEW.superseded_by_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'expense_evidence_immutable'); END;
CREATE TRIGGER finance_expense_evidence_current_guard BEFORE UPDATE OF object_purged_at,superseded_at ON finance_expense_evidence
WHEN OLD.object_purged_at IS NULL AND OLD.superseded_at IS NULL
  AND (NEW.object_purged_at IS NOT NULL OR NEW.superseded_at IS NOT NULL)
  AND (SELECT status FROM finance_expense WHERE id=OLD.expense_id)='RECOGNISED'
  AND NOT EXISTS(SELECT 1 FROM finance_expense_evidence d WHERE d.expense_id=OLD.expense_id AND d.id!=OLD.id
    AND d.object_purged_at IS NULL AND d.superseded_at IS NULL)
BEGIN SELECT RAISE(ABORT,'expense_evidence_required'); END;

DROP TRIGGER finance_expense_recognition_evidence;
CREATE TRIGGER finance_expense_recognition_evidence BEFORE UPDATE OF status ON finance_expense
WHEN OLD.status!='RECOGNISED' AND NEW.status='RECOGNISED' AND NOT EXISTS(
  SELECT 1 FROM finance_expense_evidence d WHERE d.expense_id=OLD.id AND d.object_purged_at IS NULL AND d.superseded_at IS NULL)
BEGIN SELECT RAISE(ABORT,'expense_evidence_required'); END;

-- An approved liability may be superseded only before any active payment. Its row remains historical.
ALTER TABLE finance_reimbursement ADD COLUMN cancelled_at INTEGER;
DROP INDEX finance_reimbursement_active_unique;
CREATE UNIQUE INDEX finance_reimbursement_active_unique ON finance_reimbursement(expense_id)
  WHERE status!='REJECTED' AND cancelled_at IS NULL;

DROP TRIGGER finance_expense_self_exception_guard;
CREATE TRIGGER finance_expense_self_exception_guard BEFORE UPDATE ON finance_expense
WHEN (NEW.self_approval_exception!=OLD.self_approval_exception AND NOT (
    (OLD.status='PROPOSED' AND NEW.status='RECOGNISED') OR
    (OLD.status='RECOGNISED' AND NEW.status IN ('RECOGNISED','VOID') AND NEW.version=OLD.version+1)))
  OR (NEW.status='RECOGNISED' AND NEW.self_approval_exception=1
    AND (NEW.payment_method!='ADVANCED' OR NEW.recognized_by IS NOT (SELECT user_id FROM finance_counterparty WHERE id=NEW.advanced_by_id)))
BEGIN SELECT RAISE(ABORT,'invalid_self_approval_exception'); END;

-- A recognised edit or cancellation has a preceding immutable snapshot with a short reason.
CREATE TRIGGER finance_expense_correction_reason BEFORE UPDATE ON finance_expense
WHEN OLD.status='RECOGNISED' AND (NEW.version!=OLD.version OR NEW.status IS NOT OLD.status
  OR NEW.total_cents IS NOT OLD.total_cents OR NEW.expense_date IS NOT OLD.expense_date
  OR NEW.concept IS NOT OLD.concept OR NEW.round_id IS NOT OLD.round_id
  OR NEW.counterparty_id IS NOT OLD.counterparty_id OR NEW.supplier_label IS NOT OLD.supplier_label
  OR NEW.payment_method IS NOT OLD.payment_method OR NEW.advanced_by_id IS NOT OLD.advanced_by_id
  OR NEW.lines_version!=OLD.lines_version)
  AND NOT EXISTS(SELECT 1 FROM finance_expense_revision rev WHERE rev.expense_id=OLD.id
    AND rev.previous_version=OLD.version AND rev.previous_status='RECOGNISED' AND length(trim(rev.reason)) BETWEEN 3 AND 240)
BEGIN SELECT RAISE(ABORT,'expense_correction_reason_required'); END;

DROP TRIGGER finance_expense_reimbursement_lock;
CREATE TRIGGER finance_expense_reimbursement_lock BEFORE UPDATE ON finance_expense
WHEN EXISTS(SELECT 1 FROM finance_reimbursement r WHERE r.expense_id=OLD.id AND r.status='APPROVED'
  AND r.cancelled_at IS NULL AND EXISTS(SELECT 1 FROM finance_allocation_current a
    WHERE a.reimbursement_id=r.id AND a.kind='REIMBURSEMENT_SETTLEMENT'))
  AND (NEW.total_cents IS NOT OLD.total_cents OR NEW.advanced_by_id IS NOT OLD.advanced_by_id
    OR NEW.payment_method IS NOT OLD.payment_method OR NEW.status IS NOT OLD.status)
BEGIN SELECT RAISE(ABORT,'reimbursement_settlement_locked'); END;

-- Keep an unpaid liability coherent with its corrected expense inside the same D1 transaction.
CREATE TRIGGER finance_expense_reimbursement_sync AFTER UPDATE ON finance_expense
WHEN OLD.status='RECOGNISED' AND (NEW.total_cents IS NOT OLD.total_cents OR NEW.advanced_by_id IS NOT OLD.advanced_by_id
  OR NEW.payment_method IS NOT OLD.payment_method OR NEW.status IS NOT OLD.status)
BEGIN
  UPDATE finance_reimbursement SET cancelled_at=NEW.updated_at,version=version+1
    WHERE expense_id=OLD.id AND status='APPROVED' AND cancelled_at IS NULL
      AND (NEW.status!='RECOGNISED' OR NEW.payment_method!='ADVANCED');
  UPDATE finance_reimbursement SET amount_cents=NEW.total_cents,recipient_id=NEW.advanced_by_id,
      self_approval_exception=CASE WHEN approved_by=(SELECT user_id FROM finance_counterparty WHERE id=NEW.advanced_by_id)
        THEN 1 ELSE 0 END,version=version+1
    WHERE expense_id=OLD.id AND status='APPROVED' AND cancelled_at IS NULL
      AND NEW.status='RECOGNISED' AND NEW.payment_method='ADVANCED'
      AND (amount_cents!=NEW.total_cents OR recipient_id IS NOT NEW.advanced_by_id);
END;

DROP TRIGGER finance_reimbursement_transition_guard;
CREATE TRIGGER finance_reimbursement_transition_guard BEFORE UPDATE ON finance_reimbursement
WHEN (OLD.status='PENDING_REVIEW' AND (
    NEW.status NOT IN ('APPROVED','REJECTED') OR NEW.version!=OLD.version+1
    OR NEW.expense_id IS NOT OLD.expense_id OR NEW.recipient_id IS NOT OLD.recipient_id
    OR NEW.amount_cents IS NOT OLD.amount_cents OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at
    OR NEW.cancelled_at IS NOT NULL
    OR (NEW.status='APPROVED' AND (NEW.approved_by IS NULL OR NEW.approved_at IS NULL
      OR NOT EXISTS(SELECT 1 FROM finance_expense e WHERE e.id=NEW.expense_id AND e.status='RECOGNISED'
        AND e.payment_method='ADVANCED' AND e.advanced_by_id=NEW.recipient_id AND e.total_cents=NEW.amount_cents
        AND EXISTS(SELECT 1 FROM finance_expense_evidence d WHERE d.expense_id=e.id
          AND d.object_purged_at IS NULL AND d.superseded_at IS NULL))))
    OR (NEW.status='REJECTED' AND (NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL))
    OR (NEW.self_approval_exception!=OLD.self_approval_exception AND NOT (
      NEW.status='APPROVED' AND OLD.self_approval_exception=0 AND NEW.self_approval_exception=1
      AND NEW.approved_by=(SELECT user_id FROM finance_counterparty WHERE id=NEW.recipient_id)
      AND ((SELECT self_approval_exception FROM finance_expense WHERE id=NEW.expense_id)=1
        OR NEW.approved_by IS NOT (SELECT recognized_by FROM finance_expense WHERE id=NEW.expense_id))))))
  OR (OLD.status='APPROVED' AND (
    NEW.status!='APPROVED' OR OLD.cancelled_at IS NOT NULL OR NEW.version!=OLD.version+1
    OR NEW.expense_id IS NOT OLD.expense_id OR NEW.approved_by IS NOT OLD.approved_by
    OR NEW.approved_at IS NOT OLD.approved_at OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at
    OR (NEW.cancelled_at IS NOT OLD.cancelled_at AND NOT (OLD.cancelled_at IS NULL AND NEW.cancelled_at IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM finance_allocation_current a WHERE a.reimbursement_id=OLD.id)
      AND EXISTS(SELECT 1 FROM finance_expense e WHERE e.id=OLD.expense_id
        AND (e.status='VOID' OR e.payment_method!='ADVANCED'))))
    OR (NEW.cancelled_at IS NULL AND NOT EXISTS(SELECT 1 FROM finance_expense e WHERE e.id=NEW.expense_id
      AND e.status='RECOGNISED' AND e.payment_method='ADVANCED' AND e.advanced_by_id=NEW.recipient_id
      AND e.total_cents=NEW.amount_cents AND EXISTS(SELECT 1 FROM finance_expense_evidence d
        WHERE d.expense_id=e.id AND d.object_purged_at IS NULL AND d.superseded_at IS NULL)))
    OR (NEW.cancelled_at IS NULL AND EXISTS(SELECT 1 FROM finance_allocation_current a WHERE a.reimbursement_id=OLD.id)
      AND (NEW.amount_cents IS NOT OLD.amount_cents OR NEW.recipient_id IS NOT OLD.recipient_id))
    OR (NEW.cancelled_at IS NOT NULL AND (NEW.amount_cents IS NOT OLD.amount_cents OR NEW.recipient_id IS NOT OLD.recipient_id))
    OR (NEW.self_approval_exception!=OLD.self_approval_exception AND NEW.cancelled_at IS NULL
      AND NEW.self_approval_exception!=(NEW.approved_by=(SELECT user_id FROM finance_counterparty WHERE id=NEW.recipient_id)))))
  OR (OLD.status='REJECTED')
  OR (NEW.status='APPROVED' AND NEW.cancelled_at IS NULL AND NEW.approved_by=(SELECT user_id FROM finance_counterparty WHERE id=NEW.recipient_id)
    AND NEW.self_approval_exception!=1)
BEGIN SELECT RAISE(ABORT,'invalid_reimbursement'); END;

DROP TRIGGER finance_reimbursement_settlement_guard;
CREATE TRIGGER finance_reimbursement_settlement_guard BEFORE INSERT ON finance_allocation
WHEN NEW.kind='REIMBURSEMENT_SETTLEMENT' AND (
  (SELECT p.kind FROM finance_position p JOIN finance_movement m ON m.position_id=p.id WHERE m.id=NEW.movement_id) IS NOT 'BANK'
  OR NOT EXISTS(SELECT 1 FROM finance_reimbursement r JOIN finance_expense e ON e.id=r.expense_id
    WHERE r.id=NEW.reimbursement_id AND r.status='APPROVED' AND r.cancelled_at IS NULL AND e.status='RECOGNISED'
      AND e.payment_method='ADVANCED' AND e.advanced_by_id=r.recipient_id
      AND EXISTS(SELECT 1 FROM finance_expense_evidence d WHERE d.expense_id=e.id
        AND d.object_purged_at IS NULL AND d.superseded_at IS NULL))
  OR NEW.amount_cents+COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a
    WHERE a.reimbursement_id=NEW.reimbursement_id AND a.kind='REIMBURSEMENT_SETTLEMENT'),0)
    >(SELECT amount_cents FROM finance_reimbursement WHERE id=NEW.reimbursement_id)
  OR EXISTS(SELECT 1 FROM finance_allocation a JOIN finance_reimbursement r ON r.id=a.reimbursement_id
    WHERE a.movement_id=NEW.movement_id AND a.set_version=NEW.set_version AND a.kind='REIMBURSEMENT_SETTLEMENT'
      AND r.recipient_id IS NOT (SELECT recipient_id FROM finance_reimbursement WHERE id=NEW.reimbursement_id)))
BEGIN SELECT RAISE(ABORT,'invalid_reimbursement_settlement'); END;

-- Allocation rows already preserve every old set. This table stores only why a set was replaced.
CREATE TABLE finance_allocation_correction (
  movement_id TEXT NOT NULL REFERENCES finance_movement(id) ON DELETE RESTRICT,
  set_version INTEGER NOT NULL CHECK(set_version>1),
  reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 240),
  changed_by TEXT NOT NULL REFERENCES app_user(id),
  changed_at INTEGER NOT NULL,
  PRIMARY KEY(movement_id,set_version)
);
CREATE TRIGGER finance_allocation_correction_immutable BEFORE UPDATE ON finance_allocation_correction
BEGIN SELECT RAISE(ABORT,'allocation_correction_immutable'); END;
CREATE TRIGGER finance_allocation_correction_no_delete BEFORE DELETE ON finance_allocation_correction
BEGIN SELECT RAISE(ABORT,'allocation_correction_immutable'); END;
