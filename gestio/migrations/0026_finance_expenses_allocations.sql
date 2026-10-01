-- FASE 3.5G.1 (TREASURY.md §9–§13, §21.4, §23): expenses with versioned lines, expense evidence, the
-- prepared reimbursement / card statement / overpayment targets, and typed movement allocations.
-- Earlier migrations are unchanged.
--
-- Economic figures come only from recognised expenses and from income-type allocations. Settlement and
-- transfer allocations never touch a budget line, so paying an expense (bank, card, cash, reimbursement)
-- or moving money between positions never counts twice.

-- Expense (economic fact). PROPOSED never counts; RECOGNISED counts once. `version` is the concurrency
-- counter; `lines_version` names the current set of lines (each revision writes a new set).
CREATE TABLE finance_expense (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES finance_round(id) ON DELETE RESTRICT,
  expense_date TEXT NOT NULL CHECK(date(expense_date)=expense_date),
  counterparty_id TEXT REFERENCES finance_counterparty(id) ON DELETE RESTRICT,
  supplier_label TEXT CHECK(supplier_label IS NULL OR length(supplier_label) BETWEEN 1 AND 80),
  total_cents INTEGER NOT NULL CHECK(total_cents BETWEEN 1 AND 100000000),
  payment_method TEXT NOT NULL CHECK(payment_method IN ('BANK','CARD','CASH','ADVANCED')),
  advanced_by_id TEXT REFERENCES finance_counterparty(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'PROPOSED' CHECK(status IN ('PROPOSED','RECOGNISED','REJECTED','VOID')),
  lines_version INTEGER NOT NULL DEFAULT 1 CHECK(lines_version>0),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_by TEXT NOT NULL REFERENCES app_user(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  recognized_by TEXT REFERENCES app_user(id),
  recognized_at INTEGER,
  rejected_by TEXT REFERENCES app_user(id),
  rejected_at INTEGER,
  voided_by TEXT REFERENCES app_user(id),
  voided_at INTEGER,
  void_reason TEXT CHECK(void_reason IS NULL OR void_reason IN ('DUPLICATE','ERROR','CANCELLED')),
  CHECK((payment_method='ADVANCED')=(advanced_by_id IS NOT NULL)),
  CHECK((status IN ('RECOGNISED','VOID'))=(recognized_by IS NOT NULL AND recognized_at IS NOT NULL)),
  CHECK((status='REJECTED')=(rejected_by IS NOT NULL AND rejected_at IS NOT NULL)),
  CHECK((status='VOID')=(voided_by IS NOT NULL AND voided_at IS NOT NULL AND void_reason IS NOT NULL))
);
CREATE INDEX finance_expense_round_idx ON finance_expense(round_id,status,expense_date);
CREATE TRIGGER finance_expense_insert_guard BEFORE INSERT ON finance_expense
WHEN NEW.status!='PROPOSED' OR NEW.lines_version!=1 OR NEW.version!=1
  OR (SELECT status FROM finance_round WHERE id=NEW.round_id) NOT IN ('DRAFT','OPEN','CLOSING')
  OR (NEW.advanced_by_id IS NOT NULL AND (SELECT kind FROM finance_counterparty WHERE id=NEW.advanced_by_id) IS NOT 'PERSON')
BEGIN SELECT RAISE(ABORT,'invalid_expense'); END;

CREATE TABLE finance_expense_line (
  expense_id TEXT NOT NULL REFERENCES finance_expense(id) ON DELETE RESTRICT,
  lines_version INTEGER NOT NULL CHECK(lines_version>0),
  line_no INTEGER NOT NULL CHECK(line_no BETWEEN 1 AND 50),
  budget_line_id TEXT NOT NULL REFERENCES finance_budget_line(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 100000000),
  activity_id TEXT REFERENCES activity(id) ON DELETE RESTRICT,
  section_id TEXT REFERENCES section(id) ON DELETE RESTRICT,
  PRIMARY KEY(expense_id,lines_version,line_no)
);
CREATE INDEX finance_expense_line_budget_idx ON finance_expense_line(budget_line_id);
-- A line set is written for the next version (a revision) or, while proposed, for the current one. The
-- budget line is an active EXPENSE leaf of the expense's round.
CREATE TRIGGER finance_expense_line_guard BEFORE INSERT ON finance_expense_line
WHEN NOT EXISTS(SELECT 1 FROM finance_expense e WHERE e.id=NEW.expense_id AND e.status IN ('PROPOSED','RECOGNISED')
    AND (NEW.lines_version=e.lines_version+1 OR (NEW.lines_version=e.lines_version AND e.status='PROPOSED')))
  OR NOT EXISTS(SELECT 1 FROM finance_budget_line l JOIN finance_expense e ON e.round_id=l.round_id
    WHERE l.id=NEW.budget_line_id AND e.id=NEW.expense_id AND l.nature='EXPENSE' AND l.status='ACTIVE')
  OR EXISTS(SELECT 1 FROM finance_budget_line c WHERE c.parent_id=NEW.budget_line_id)
BEGIN SELECT RAISE(ABORT,'invalid_expense_line'); END;
CREATE TRIGGER finance_expense_line_no_update BEFORE UPDATE ON finance_expense_line
BEGIN SELECT RAISE(ABORT,'expense_line_immutable'); END;
CREATE TRIGGER finance_expense_line_no_delete BEFORE DELETE ON finance_expense_line
BEGIN SELECT RAISE(ABORT,'expense_line_immutable'); END;

CREATE TABLE finance_expense_revision (
  id TEXT PRIMARY KEY,
  expense_id TEXT NOT NULL REFERENCES finance_expense(id) ON DELETE RESTRICT,
  previous_version INTEGER NOT NULL CHECK(previous_version>0),
  previous_round_id TEXT NOT NULL,
  previous_expense_date TEXT NOT NULL,
  previous_counterparty_id TEXT,
  previous_supplier_label TEXT,
  previous_total_cents INTEGER NOT NULL,
  previous_payment_method TEXT NOT NULL,
  previous_advanced_by_id TEXT,
  previous_lines_version INTEGER NOT NULL,
  changed_by TEXT NOT NULL REFERENCES app_user(id),
  changed_at INTEGER NOT NULL,
  UNIQUE(expense_id,previous_version)
);
CREATE TRIGGER finance_expense_revision_no_update BEFORE UPDATE ON finance_expense_revision
BEGIN SELECT RAISE(ABORT,'expense_revision_immutable'); END;
CREATE TRIGGER finance_expense_revision_no_delete BEFORE DELETE ON finance_expense_revision
BEGIN SELECT RAISE(ABORT,'expense_revision_immutable'); END;
CREATE TRIGGER finance_expense_no_delete BEFORE DELETE ON finance_expense
BEGIN SELECT RAISE(ABORT,'expense_immutable'); END;

-- Expense evidence (tickets): metadata in D1, bytes in private R2 under an opaque key. Retention and purge
-- are a LEGAL DECISION REQUIRED; the purge state exists so a future policy needs no schema change.
CREATE TABLE finance_expense_evidence (
  id TEXT PRIMARY KEY,
  expense_id TEXT NOT NULL REFERENCES finance_expense(id) ON DELETE RESTRICT,
  object_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 4194304),
  detected_mime TEXT NOT NULL CHECK(detected_mime IN ('application/pdf','image/png','image/jpeg','image/webp')),
  uploaded_by TEXT NOT NULL REFERENCES app_user(id),
  created_at INTEGER NOT NULL,
  object_purged_at INTEGER,
  object_purge_reason TEXT CHECK(object_purge_reason IS NULL OR object_purge_reason IN ('RETENTION_POLICY')),
  CHECK((object_purged_at IS NULL)=(object_purge_reason IS NULL))
);
CREATE INDEX finance_expense_evidence_expense_idx ON finance_expense_evidence(expense_id,created_at);
CREATE TRIGGER finance_expense_evidence_immutable BEFORE UPDATE ON finance_expense_evidence
WHEN OLD.object_purged_at IS NOT NULL OR NEW.expense_id IS NOT OLD.expense_id OR NEW.object_key IS NOT OLD.object_key
  OR NEW.sha256 IS NOT OLD.sha256 OR NEW.size_bytes IS NOT OLD.size_bytes OR NEW.detected_mime IS NOT OLD.detected_mime
  OR NEW.uploaded_by IS NOT OLD.uploaded_by OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'expense_evidence_immutable'); END;
CREATE TRIGGER finance_expense_evidence_no_delete BEFORE DELETE ON finance_expense_evidence
BEGIN SELECT RAISE(ABORT,'expense_evidence_immutable'); END;

-- Prepared allocation targets whose workflows arrive later (reimbursements 3.5G.2, card statements
-- 3.5G.2, overpayments 3.5G.3). Their allocation kinds stay disabled below until then.
CREATE TABLE finance_reimbursement (
  id TEXT PRIMARY KEY,
  expense_id TEXT NOT NULL REFERENCES finance_expense(id) ON DELETE RESTRICT,
  recipient_id TEXT NOT NULL REFERENCES finance_counterparty(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 100000000),
  status TEXT NOT NULL DEFAULT 'PENDING_REVIEW' CHECK(status IN ('PENDING_REVIEW','APPROVED','REJECTED')),
  approved_by TEXT REFERENCES app_user(id),
  approved_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_by TEXT NOT NULL REFERENCES app_user(id),
  created_at INTEGER NOT NULL,
  CHECK((status='APPROVED')=(approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE UNIQUE INDEX finance_reimbursement_active_unique ON finance_reimbursement(expense_id) WHERE status!='REJECTED';
CREATE TRIGGER finance_reimbursement_guard BEFORE INSERT ON finance_reimbursement
WHEN NOT EXISTS(SELECT 1 FROM finance_expense e WHERE e.id=NEW.expense_id AND e.payment_method='ADVANCED'
    AND e.advanced_by_id=NEW.recipient_id AND e.status IN ('PROPOSED','RECOGNISED'))
  OR NEW.status!='PENDING_REVIEW'
BEGIN SELECT RAISE(ABORT,'invalid_reimbursement'); END;
-- Nobody approves their own reimbursement (TREASURY.md I20).
CREATE TRIGGER finance_reimbursement_self_approval BEFORE UPDATE OF status,approved_by ON finance_reimbursement
WHEN NEW.approved_by IS NOT NULL AND NEW.approved_by=(SELECT user_id FROM finance_counterparty WHERE id=NEW.recipient_id)
BEGIN SELECT RAISE(ABORT,'self_approval'); END;
CREATE TRIGGER finance_reimbursement_no_delete BEFORE DELETE ON finance_reimbursement
BEGIN SELECT RAISE(ABORT,'reimbursement_immutable'); END;
-- A counterparty's user link cannot change while one of its reimbursements is open (the self-approval
-- check could otherwise be bypassed by editing the link).
CREATE TRIGGER finance_counterparty_user_link_guard BEFORE UPDATE OF user_id ON finance_counterparty
WHEN NEW.user_id IS NOT OLD.user_id AND EXISTS(SELECT 1 FROM finance_reimbursement r
  WHERE r.recipient_id=OLD.id AND r.status IN ('PENDING_REVIEW','APPROVED'))
BEGIN SELECT RAISE(ABORT,'counterparty_in_use'); END;

CREATE TABLE finance_card_statement (
  id TEXT PRIMARY KEY,
  position_id TEXT NOT NULL REFERENCES finance_position(id) ON DELETE RESTRICT,
  period_start TEXT NOT NULL CHECK(date(period_start)=period_start),
  period_end TEXT NOT NULL CHECK(date(period_end)=period_end),
  created_by TEXT NOT NULL REFERENCES app_user(id),
  created_at INTEGER NOT NULL,
  CHECK(period_end>=period_start)
);
CREATE TRIGGER finance_card_statement_guard BEFORE INSERT ON finance_card_statement
WHEN (SELECT kind FROM finance_position WHERE id=NEW.position_id) IS NOT 'CARD'
BEGIN SELECT RAISE(ABORT,'invalid_card_statement'); END;
CREATE TRIGGER finance_card_statement_no_delete BEFORE DELETE ON finance_card_statement
BEGIN SELECT RAISE(ABORT,'card_statement_immutable'); END;

CREATE TABLE finance_overpayment (
  id TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL REFERENCES activity_registration(id) ON DELETE RESTRICT,
  evidence_id TEXT REFERENCES payment_evidence(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 100000000),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','RESOLVED')),
  created_by TEXT NOT NULL REFERENCES app_user(id),
  created_at INTEGER NOT NULL,
  resolved_by TEXT REFERENCES app_user(id),
  resolved_at INTEGER,
  CHECK((status='RESOLVED')=(resolved_by IS NOT NULL AND resolved_at IS NOT NULL))
);
CREATE TRIGGER finance_overpayment_no_delete BEFORE DELETE ON finance_overpayment
BEGIN SELECT RAISE(ABORT,'overpayment_immutable'); END;

-- Typed allocations (TREASURY.md §9): each row has a kind and exactly one destination column, with real
-- foreign keys. The rows of a movement form allocation sets; the current set is the one whose
-- set_version equals finance_movement.allocation_version. Rows are never changed or deleted: a
-- reclassification writes a new set after a compare-and-set on the movement.
CREATE TABLE finance_allocation (
  id TEXT PRIMARY KEY,
  movement_id TEXT NOT NULL REFERENCES finance_movement(id) ON DELETE RESTRICT,
  set_version INTEGER NOT NULL CHECK(set_version>0),
  kind TEXT NOT NULL CHECK(kind IN ('INCOME','EXPENSE_SETTLEMENT','EXPENSE_REFUND','INTERNAL_TRANSFER','CARD_SETTLEMENT',
    'REIMBURSEMENT_SETTLEMENT','FEE_PAYMENT','ACTIVITY_PAYMENT','FAMILY_OVERPAYMENT','FAMILY_REFUND','RESERVED_CREDIT')),
  amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 100000000),
  round_id TEXT REFERENCES finance_round(id) ON DELETE RESTRICT,
  budget_line_id TEXT REFERENCES finance_budget_line(id) ON DELETE RESTRICT,
  expense_id TEXT REFERENCES finance_expense(id) ON DELETE RESTRICT,
  paired_movement_id TEXT REFERENCES finance_movement(id) ON DELETE RESTRICT,
  card_statement_id TEXT REFERENCES finance_card_statement(id) ON DELETE RESTRICT,
  reimbursement_id TEXT REFERENCES finance_reimbursement(id) ON DELETE RESTRICT,
  fee_payment_id TEXT REFERENCES annual_fee_payment(id) ON DELETE RESTRICT,
  activity_allocation_id TEXT REFERENCES activity_payment_allocation(id) ON DELETE RESTRICT,
  overpayment_id TEXT REFERENCES finance_overpayment(id) ON DELETE RESTRICT,
  activity_id TEXT REFERENCES activity(id) ON DELETE RESTRICT,
  section_id TEXT REFERENCES section(id) ON DELETE RESTRICT,
  created_by TEXT NOT NULL REFERENCES app_user(id),
  created_at INTEGER NOT NULL,
  CHECK((budget_line_id IS NOT NULL)+(expense_id IS NOT NULL)+(paired_movement_id IS NOT NULL)+(card_statement_id IS NOT NULL)
    +(reimbursement_id IS NOT NULL)+(fee_payment_id IS NOT NULL)+(activity_allocation_id IS NOT NULL)+(overpayment_id IS NOT NULL)
    =CASE WHEN kind='RESERVED_CREDIT' THEN 0 ELSE 1 END),
  CHECK(kind!='INCOME' OR budget_line_id IS NOT NULL),
  CHECK(kind NOT IN ('EXPENSE_SETTLEMENT','EXPENSE_REFUND') OR expense_id IS NOT NULL),
  CHECK(kind!='INTERNAL_TRANSFER' OR paired_movement_id IS NOT NULL),
  CHECK(kind!='CARD_SETTLEMENT' OR card_statement_id IS NOT NULL),
  CHECK(kind!='REIMBURSEMENT_SETTLEMENT' OR reimbursement_id IS NOT NULL),
  CHECK(kind!='FEE_PAYMENT' OR fee_payment_id IS NOT NULL),
  CHECK(kind!='ACTIVITY_PAYMENT' OR activity_allocation_id IS NOT NULL),
  CHECK(kind!='FAMILY_OVERPAYMENT' OR overpayment_id IS NOT NULL),
  CHECK(kind!='FAMILY_REFUND' OR fee_payment_id IS NOT NULL OR activity_allocation_id IS NOT NULL OR overpayment_id IS NOT NULL),
  CHECK((kind='INCOME')=(round_id IS NOT NULL)),
  CHECK(kind='INCOME' OR (activity_id IS NULL AND section_id IS NULL)),
  CHECK(paired_movement_id IS NULL OR paired_movement_id!=movement_id)
);
CREATE INDEX finance_allocation_movement_idx ON finance_allocation(movement_id,set_version);
CREATE INDEX finance_allocation_expense_idx ON finance_allocation(expense_id,kind);
CREATE INDEX finance_allocation_budget_idx ON finance_allocation(budget_line_id);
CREATE INDEX finance_allocation_round_idx ON finance_allocation(round_id,kind);
CREATE INDEX finance_allocation_paired_idx ON finance_allocation(paired_movement_id);

-- Kinds enabled in 3.5G.1; the others become available with their workflows (one trigger to replace).
CREATE TRIGGER finance_allocation_kind_enabled BEFORE INSERT ON finance_allocation
WHEN NEW.kind NOT IN ('INCOME','EXPENSE_SETTLEMENT','EXPENSE_REFUND','INTERNAL_TRANSFER')
BEGIN SELECT RAISE(ABORT,'allocation_kind_not_enabled'); END;
-- Only into the current set of an ACTIVE movement (written after the movement's compare-and-set).
CREATE TRIGGER finance_allocation_current_set BEFORE INSERT ON finance_allocation
WHEN NOT EXISTS(SELECT 1 FROM finance_movement m WHERE m.id=NEW.movement_id AND m.state='ACTIVE'
  AND m.allocation_version=NEW.set_version)
BEGIN SELECT RAISE(ABORT,'stale_allocation_set'); END;
-- Never more than the movement (TREASURY.md I3).
CREATE TRIGGER finance_allocation_not_above_movement BEFORE INSERT ON finance_allocation
WHEN NEW.amount_cents+COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation a
    WHERE a.movement_id=NEW.movement_id AND a.set_version=NEW.set_version),0)
  >(SELECT abs(amount_cents) FROM finance_movement WHERE id=NEW.movement_id)
BEGIN SELECT RAISE(ABORT,'allocation_exceeds_movement'); END;
-- Direction: income and refunds come in, settlements go out.
CREATE TRIGGER finance_allocation_direction BEFORE INSERT ON finance_allocation
WHEN (NEW.kind IN ('INCOME','EXPENSE_REFUND','FEE_PAYMENT','ACTIVITY_PAYMENT','FAMILY_OVERPAYMENT')
    AND (SELECT amount_cents FROM finance_movement WHERE id=NEW.movement_id)<0)
  OR (NEW.kind IN ('EXPENSE_SETTLEMENT','REIMBURSEMENT_SETTLEMENT','CARD_SETTLEMENT','FAMILY_REFUND')
    AND (SELECT amount_cents FROM finance_movement WHERE id=NEW.movement_id)>0)
BEGIN SELECT RAISE(ABORT,'invalid_allocation_direction'); END;
-- Income: an active INCOME leaf of the given round, in a round that is not closed (post-close: 3.5G.4).
CREATE TRIGGER finance_allocation_income_guard BEFORE INSERT ON finance_allocation
WHEN NEW.kind='INCOME' AND (
  NOT EXISTS(SELECT 1 FROM finance_budget_line l WHERE l.id=NEW.budget_line_id AND l.round_id=NEW.round_id
    AND l.nature='INCOME' AND l.status='ACTIVE')
  OR EXISTS(SELECT 1 FROM finance_budget_line c WHERE c.parent_id=NEW.budget_line_id)
  OR (SELECT status FROM finance_round WHERE id=NEW.round_id)='CLOSED')
BEGIN SELECT RAISE(ABORT,'invalid_income_allocation'); END;
-- Expense settlement / refund: a recognised expense of a round that is not closed; a settlement comes
-- from a position of the expense's payment method; Σ current settlements (or refunds) ≤ the total.
CREATE TRIGGER finance_allocation_expense_guard BEFORE INSERT ON finance_allocation
WHEN NEW.kind IN ('EXPENSE_SETTLEMENT','EXPENSE_REFUND') AND (
  NOT EXISTS(SELECT 1 FROM finance_expense e JOIN finance_round r ON r.id=e.round_id
    WHERE e.id=NEW.expense_id AND e.status='RECOGNISED' AND r.status!='CLOSED')
  OR (NEW.kind='EXPENSE_SETTLEMENT' AND (SELECT payment_method FROM finance_expense WHERE id=NEW.expense_id)
    IS NOT (SELECT p.kind FROM finance_position p JOIN finance_movement m ON m.position_id=p.id WHERE m.id=NEW.movement_id))
  OR NEW.amount_cents+COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation a JOIN finance_movement m
    ON m.id=a.movement_id AND m.allocation_version=a.set_version AND m.state='ACTIVE'
    WHERE a.expense_id=NEW.expense_id AND a.kind=NEW.kind),0)>(SELECT total_cents FROM finance_expense WHERE id=NEW.expense_id))
BEGIN SELECT RAISE(ABORT,'invalid_expense_allocation'); END;
-- Internal transfer: the whole movement, paired with an ACTIVE movement of another position, same
-- absolute amount and opposite sign; if the pair is already allocated as a transfer, it points back.
CREATE TRIGGER finance_allocation_transfer_guard BEFORE INSERT ON finance_allocation
WHEN NEW.kind='INTERNAL_TRANSFER' AND (
  NEW.amount_cents!=(SELECT abs(amount_cents) FROM finance_movement WHERE id=NEW.movement_id)
  OR NOT EXISTS(SELECT 1 FROM finance_movement m JOIN finance_movement p ON p.id=NEW.paired_movement_id
    WHERE m.id=NEW.movement_id AND p.state='ACTIVE' AND p.position_id!=m.position_id AND p.amount_cents=-m.amount_cents)
  OR EXISTS(SELECT 1 FROM finance_allocation a JOIN finance_movement p ON p.id=a.movement_id AND p.allocation_version=a.set_version
    WHERE a.movement_id=NEW.paired_movement_id AND a.kind='INTERNAL_TRANSFER' AND a.paired_movement_id!=NEW.movement_id))
BEGIN SELECT RAISE(ABORT,'invalid_internal_transfer'); END;
CREATE TRIGGER finance_allocation_no_update BEFORE UPDATE ON finance_allocation
BEGIN SELECT RAISE(ABORT,'allocation_immutable'); END;
CREATE TRIGGER finance_allocation_no_delete BEFORE DELETE ON finance_allocation
BEGIN SELECT RAISE(ABORT,'allocation_immutable'); END;

-- A duplicate can only be voided once nothing is allocated to it.
CREATE TRIGGER finance_movement_void_unallocated BEFORE UPDATE OF state ON finance_movement
WHEN NEW.state='VOID_DUPLICATE' AND OLD.state='ACTIVE' AND EXISTS(SELECT 1 FROM finance_allocation a
  WHERE a.movement_id=OLD.id AND a.set_version=OLD.allocation_version)
BEGIN SELECT RAISE(ABORT,'invalid_duplicate_void'); END;

-- Expense state machine and the money invariants that depend on its lines and allocations:
-- recognised ⇒ Σ current lines = total; recognised total never below what was settled or refunded;
-- nobody recognises an expense they advanced themselves; no change in a closed round.
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
  OR (NEW.status='RECOGNISED' AND NEW.recognized_by=(SELECT user_id FROM finance_counterparty WHERE id=NEW.advanced_by_id))
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

-- A line that carries money (expense lines, allocations, revisions) never becomes a heading.
CREATE TRIGGER finance_budget_line_parent_in_use BEFORE INSERT ON finance_budget_line
WHEN NEW.parent_id IS NOT NULL AND (
  EXISTS(SELECT 1 FROM finance_expense_line x WHERE x.budget_line_id=NEW.parent_id) OR
  EXISTS(SELECT 1 FROM finance_allocation x WHERE x.budget_line_id=NEW.parent_id) OR
  EXISTS(SELECT 1 FROM finance_budget_revision x WHERE x.line_id=NEW.parent_id))
BEGIN SELECT RAISE(ABORT,'budget_line_in_use'); END;
CREATE TRIGGER finance_budget_line_move_parent_in_use BEFORE UPDATE OF parent_id ON finance_budget_line
WHEN NEW.parent_id IS NOT NULL AND NEW.parent_id IS NOT OLD.parent_id AND (
  EXISTS(SELECT 1 FROM finance_expense_line x WHERE x.budget_line_id=NEW.parent_id) OR
  EXISTS(SELECT 1 FROM finance_allocation x WHERE x.budget_line_id=NEW.parent_id) OR
  EXISTS(SELECT 1 FROM finance_budget_revision x WHERE x.line_id=NEW.parent_id))
BEGIN SELECT RAISE(ABORT,'budget_line_in_use'); END;

-- Derived views.
CREATE VIEW finance_allocation_current AS
SELECT a.* FROM finance_allocation a JOIN finance_movement m
  ON m.id=a.movement_id AND m.allocation_version=a.set_version AND m.state='ACTIVE';
CREATE VIEW finance_movement_allocation_balance AS
SELECT m.id AS movement_id,abs(m.amount_cents) AS absolute_cents,
  COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation a WHERE a.movement_id=m.id AND a.set_version=m.allocation_version),0) AS allocated_cents,
  abs(m.amount_cents)-COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation a WHERE a.movement_id=m.id AND a.set_version=m.allocation_version),0) AS unallocated_cents
FROM finance_movement m WHERE m.state='ACTIVE';
-- Economic figures of a round from the foundation: recognised expenses (net of refunds) and income-type
-- allocations. Settlements and internal transfers contribute nothing (TREASURY.md I10).
CREATE VIEW finance_round_economics AS
SELECT r.id AS round_id,
  COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a WHERE a.kind='INCOME' AND a.round_id=r.id),0) AS income_cents,
  COALESCE((SELECT sum(e.total_cents) FROM finance_expense e WHERE e.round_id=r.id AND e.status='RECOGNISED'),0) AS expense_gross_cents,
  COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a JOIN finance_expense e ON e.id=a.expense_id
    WHERE a.kind='EXPENSE_REFUND' AND e.round_id=r.id AND e.status='RECOGNISED'),0) AS expense_refund_cents,
  COALESCE((SELECT sum(e.total_cents) FROM finance_expense e WHERE e.round_id=r.id AND e.status='PROPOSED'),0) AS proposed_expense_cents
FROM finance_round r;
