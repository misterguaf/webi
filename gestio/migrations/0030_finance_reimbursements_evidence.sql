-- G.2B: evidence before new recognition, an explicit self-approval marker, and bank reimbursement settlement.
-- Existing recognised expenses are historical facts: the new evidence rule applies only on transition.
ALTER TABLE finance_expense ADD COLUMN self_approval_exception INTEGER NOT NULL DEFAULT 0 CHECK(self_approval_exception IN (0,1));
ALTER TABLE finance_reimbursement ADD COLUMN self_approval_exception INTEGER NOT NULL DEFAULT 0 CHECK(self_approval_exception IN (0,1));

INSERT OR IGNORE INTO permission(code) VALUES ('finance.reimbursement.self_approve');
INSERT OR IGNORE INTO role_permission(role_code,permission_code) VALUES ('TREASURY','finance.reimbursement.self_approve');
-- Existing Treasury holders receive an explicit personal grant. The permission is not delegable.
INSERT INTO user_permission_grant(id,user_id,permission_code,valid_from,granted_by,justification)
SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||
  substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
  ur.user_id,'finance.reimbursement.self_approve',CAST(strftime('%s','now') AS INTEGER)*1000,NULL,
  'Transició G.2B: excepció explícita de reemborsament propi'
FROM user_role ur WHERE ur.role_code='TREASURY' AND ur.section_id IS NULL AND ur.revoked_at IS NULL
  AND (ur.expires_at IS NULL OR ur.expires_at>CAST(strftime('%s','now') AS INTEGER)*1000)
  AND NOT EXISTS(SELECT 1 FROM user_permission_grant g WHERE g.user_id=ur.user_id
    AND g.permission_code='finance.reimbursement.self_approve' AND g.revoked_at IS NULL);

CREATE TRIGGER finance_expense_recognition_evidence BEFORE UPDATE OF status ON finance_expense
WHEN OLD.status!='RECOGNISED' AND NEW.status='RECOGNISED' AND NOT EXISTS(
  SELECT 1 FROM finance_expense_evidence d WHERE d.expense_id=OLD.id AND d.object_purged_at IS NULL)
BEGIN SELECT RAISE(ABORT,'expense_evidence_required'); END;

-- The service authorises the narrow capability. D1 only checks that the stored exception is coherent
-- with the actor and beneficiary; a SQLite trigger cannot inspect an application session.
CREATE TRIGGER finance_expense_self_exception_insert_guard BEFORE INSERT ON finance_expense
WHEN NEW.self_approval_exception!=0
BEGIN SELECT RAISE(ABORT,'invalid_self_approval_exception'); END;
CREATE TRIGGER finance_expense_self_exception_guard BEFORE UPDATE ON finance_expense
WHEN (NEW.self_approval_exception!=OLD.self_approval_exception AND NOT (
    OLD.status='PROPOSED' AND NEW.status='RECOGNISED' AND OLD.self_approval_exception=0
    AND NEW.self_approval_exception=1 AND NEW.recognized_by=(SELECT user_id FROM finance_counterparty WHERE id=NEW.advanced_by_id)))
  OR (NEW.status='RECOGNISED' AND NEW.self_approval_exception=1
    AND (NEW.payment_method!='ADVANCED' OR NEW.recognized_by IS NOT (SELECT user_id FROM finance_counterparty WHERE id=NEW.advanced_by_id)))
BEGIN SELECT RAISE(ABORT,'invalid_self_approval_exception'); END;

DROP TRIGGER finance_expense_update_guard;
CREATE TRIGGER finance_expense_update_guard BEFORE UPDATE ON finance_expense
WHEN (NEW.status!=OLD.status AND NOT ((OLD.status='PROPOSED' AND NEW.status IN ('RECOGNISED','REJECTED'))
    OR (OLD.status='RECOGNISED' AND NEW.status='VOID')))
  OR OLD.status IN ('REJECTED','VOID')
  OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at
  OR NEW.lines_version NOT IN (OLD.lines_version,OLD.lines_version+1)
  OR (SELECT status FROM finance_round WHERE id=OLD.round_id)='CLOSED'
  OR (SELECT status FROM finance_round WHERE id=NEW.round_id) NOT IN ('DRAFT','OPEN','CLOSING')
  OR (NEW.advanced_by_id IS NOT NULL AND (SELECT kind FROM finance_counterparty WHERE id=NEW.advanced_by_id) IS NOT 'PERSON')
  OR (NEW.status='RECOGNISED' AND COALESCE((SELECT sum(l.amount_cents) FROM finance_expense_line l
    WHERE l.expense_id=NEW.id AND l.lines_version=NEW.lines_version),0)!=NEW.total_cents)
  OR (NEW.status='RECOGNISED' AND NEW.recognized_by=(SELECT user_id FROM finance_counterparty WHERE id=NEW.advanced_by_id)
    AND NEW.self_approval_exception!=1)
  OR (NEW.status='RECOGNISED' AND (NEW.round_id IS NOT OLD.round_id OR NEW.payment_method IS NOT OLD.payment_method)
    AND EXISTS(SELECT 1 FROM finance_allocation a JOIN finance_movement m ON m.id=a.movement_id AND m.allocation_version=a.set_version
      WHERE a.expense_id=OLD.id))
  OR (NEW.status IN ('RECOGNISED','VOID') AND (
    COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation a JOIN finance_movement m ON m.id=a.movement_id
      AND m.allocation_version=a.set_version AND m.state='ACTIVE' WHERE a.expense_id=OLD.id AND a.kind='EXPENSE_SETTLEMENT'),0)
      >CASE WHEN NEW.status='VOID' THEN 0 ELSE NEW.total_cents END
    OR COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation a JOIN finance_movement m ON m.id=a.movement_id
      AND m.allocation_version=a.set_version AND m.state='ACTIVE' WHERE a.expense_id=OLD.id AND a.kind='EXPENSE_REFUND'),0)
      >CASE WHEN NEW.status='VOID' THEN 0 ELSE NEW.total_cents END))
BEGIN SELECT RAISE(ABORT,'invalid_expense'); END;

-- An approved liability must continue to refer to the same recognised economic expense and person.
CREATE TRIGGER finance_expense_reimbursement_lock BEFORE UPDATE ON finance_expense
WHEN EXISTS(SELECT 1 FROM finance_reimbursement r WHERE r.expense_id=OLD.id AND r.status='APPROVED')
  AND (NEW.total_cents IS NOT OLD.total_cents OR NEW.advanced_by_id IS NOT OLD.advanced_by_id
    OR NEW.payment_method IS NOT OLD.payment_method OR NEW.status IS NOT OLD.status)
BEGIN SELECT RAISE(ABORT,'reimbursement_expense_locked'); END;

CREATE TRIGGER finance_reimbursement_v1_insert_guard BEFORE INSERT ON finance_reimbursement
WHEN NEW.amount_cents!=(SELECT total_cents FROM finance_expense WHERE id=NEW.expense_id)
  OR NOT EXISTS(SELECT 1 FROM finance_expense e WHERE e.id=NEW.expense_id AND e.status='RECOGNISED'
    AND e.payment_method='ADVANCED' AND e.advanced_by_id=NEW.recipient_id)
  OR NEW.self_approval_exception!=0
BEGIN SELECT RAISE(ABORT,'invalid_reimbursement'); END;

DROP TRIGGER finance_reimbursement_self_approval;
CREATE TRIGGER finance_reimbursement_self_approval BEFORE UPDATE OF status,approved_by ON finance_reimbursement
WHEN NEW.approved_by IS NOT NULL AND NEW.approved_by=(SELECT user_id FROM finance_counterparty WHERE id=NEW.recipient_id)
  AND NEW.self_approval_exception!=1
BEGIN SELECT RAISE(ABORT,'self_approval'); END;
CREATE TRIGGER finance_reimbursement_transition_guard BEFORE UPDATE ON finance_reimbursement
WHEN OLD.status!='PENDING_REVIEW' OR NEW.status NOT IN ('APPROVED','REJECTED')
  OR NEW.version!=OLD.version+1 OR NEW.expense_id IS NOT OLD.expense_id OR NEW.recipient_id IS NOT OLD.recipient_id
  OR NEW.amount_cents IS NOT OLD.amount_cents OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at
  OR (NEW.status='APPROVED' AND (NEW.approved_by IS NULL OR NEW.approved_at IS NULL
    OR NOT EXISTS(SELECT 1 FROM finance_expense e WHERE e.id=NEW.expense_id AND e.status='RECOGNISED'
      AND e.payment_method='ADVANCED' AND e.advanced_by_id=NEW.recipient_id AND e.total_cents=NEW.amount_cents
      AND EXISTS(SELECT 1 FROM finance_expense_evidence d WHERE d.expense_id=e.id AND d.object_purged_at IS NULL))))
  OR (NEW.status='REJECTED' AND (NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL))
  OR (NEW.self_approval_exception!=OLD.self_approval_exception AND NOT (
    NEW.status='APPROVED' AND OLD.self_approval_exception=0 AND NEW.self_approval_exception=1
    AND NEW.approved_by=(SELECT user_id FROM finance_counterparty WHERE id=NEW.recipient_id)
    AND (SELECT self_approval_exception FROM finance_expense WHERE id=NEW.expense_id)=1))
  OR (NEW.status='APPROVED' AND NEW.self_approval_exception=1
    AND NEW.approved_by IS NOT (SELECT user_id FROM finance_counterparty WHERE id=NEW.recipient_id))
BEGIN SELECT RAISE(ABORT,'invalid_reimbursement'); END;

DROP TRIGGER finance_allocation_kind_enabled;
CREATE TRIGGER finance_allocation_kind_enabled BEFORE INSERT ON finance_allocation
WHEN NEW.kind NOT IN ('INCOME','EXPENSE_SETTLEMENT','EXPENSE_REFUND','INTERNAL_TRANSFER','REIMBURSEMENT_SETTLEMENT')
BEGIN SELECT RAISE(ABORT,'allocation_kind_not_enabled'); END;

CREATE INDEX finance_allocation_reimbursement_idx ON finance_allocation(reimbursement_id,set_version);
CREATE TRIGGER finance_reimbursement_settlement_guard BEFORE INSERT ON finance_allocation
WHEN NEW.kind='REIMBURSEMENT_SETTLEMENT' AND (
  (SELECT p.kind FROM finance_position p JOIN finance_movement m ON m.position_id=p.id WHERE m.id=NEW.movement_id) IS NOT 'BANK'
  OR NOT EXISTS(SELECT 1 FROM finance_reimbursement r JOIN finance_expense e ON e.id=r.expense_id
    WHERE r.id=NEW.reimbursement_id AND r.status='APPROVED' AND e.status='RECOGNISED'
      AND e.payment_method='ADVANCED' AND e.advanced_by_id=r.recipient_id
      AND EXISTS(SELECT 1 FROM finance_expense_evidence d WHERE d.expense_id=e.id AND d.object_purged_at IS NULL))
  OR NEW.amount_cents+COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a
    WHERE a.reimbursement_id=NEW.reimbursement_id AND a.kind='REIMBURSEMENT_SETTLEMENT'),0)
    >(SELECT amount_cents FROM finance_reimbursement WHERE id=NEW.reimbursement_id)
  OR EXISTS(SELECT 1 FROM finance_allocation a JOIN finance_reimbursement r ON r.id=a.reimbursement_id
    WHERE a.movement_id=NEW.movement_id AND a.set_version=NEW.set_version AND a.kind='REIMBURSEMENT_SETTLEMENT'
      AND r.recipient_id IS NOT (SELECT recipient_id FROM finance_reimbursement WHERE id=NEW.reimbursement_id)))
BEGIN SELECT RAISE(ABORT,'invalid_reimbursement_settlement'); END;
