-- FASE 3.5G.2A (extensió): ingressos generals com a fet econòmic propi (subvencions, donacions, loteria,
-- venda de material...). Additive; earlier migrations are unchanged.
--
-- An income is the economic fact; a bank movement only confirms the money. An income can exist before
-- its movement (pending reconciliation) and a movement can exist before anyone knows what it is.
-- Reconciliation is NOT stored as a status: it is derived from the current INCOME allocations that point
-- to the income (one source of truth). Round figures keep counting INCOME allocations, so an income linked
-- to a movement counts once, when collected (TREASURY.md §34.3).

CREATE TABLE finance_income (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES finance_round(id) ON DELETE RESTRICT,
  income_date TEXT NOT NULL CHECK(date(income_date)=income_date),
  concept TEXT NOT NULL CHECK(length(trim(concept)) BETWEEN 1 AND 120),
  total_cents INTEGER NOT NULL CHECK(total_cents BETWEEN 1 AND 100000000),
  budget_line_id TEXT NOT NULL REFERENCES finance_budget_line(id) ON DELETE RESTRICT,
  counterparty_id TEXT REFERENCES finance_counterparty(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','VOID')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_by TEXT NOT NULL REFERENCES app_user(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  voided_by TEXT REFERENCES app_user(id),
  voided_at INTEGER,
  CHECK((status='VOID')=(voided_by IS NOT NULL AND voided_at IS NOT NULL))
);
CREATE INDEX finance_income_round_idx ON finance_income(round_id,status,income_date);
CREATE INDEX finance_income_line_idx ON finance_income(budget_line_id);

-- The budget line is an active INCOME leaf of the income's round; the round is not closed.
CREATE TRIGGER finance_income_insert_guard BEFORE INSERT ON finance_income
WHEN NEW.status!='ACTIVE' OR NEW.version!=1
  OR NOT EXISTS(SELECT 1 FROM finance_budget_line l WHERE l.id=NEW.budget_line_id AND l.round_id=NEW.round_id
    AND l.nature='INCOME' AND l.status='ACTIVE')
  OR EXISTS(SELECT 1 FROM finance_budget_line c WHERE c.parent_id=NEW.budget_line_id)
  OR (SELECT status FROM finance_round WHERE id=NEW.round_id) NOT IN ('DRAFT','OPEN','CLOSING')
BEGIN SELECT RAISE(ABORT,'invalid_income'); END;
-- Revisions keep the same rules; a voided income never changes; the round never moves once collected;
-- the total never goes below what is already reconciled.
CREATE TRIGGER finance_income_update_guard BEFORE UPDATE ON finance_income
WHEN OLD.status='VOID'
  OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at
  OR (NEW.status!=OLD.status AND NOT (OLD.status='ACTIVE' AND NEW.status='VOID'))
  OR NOT EXISTS(SELECT 1 FROM finance_budget_line l WHERE l.id=NEW.budget_line_id AND l.round_id=NEW.round_id
    AND l.nature='INCOME' AND l.status='ACTIVE')
  OR EXISTS(SELECT 1 FROM finance_budget_line c WHERE c.parent_id=NEW.budget_line_id)
  OR (SELECT status FROM finance_round WHERE id=OLD.round_id)='CLOSED'
  OR (SELECT status FROM finance_round WHERE id=NEW.round_id) NOT IN ('DRAFT','OPEN','CLOSING')
  OR (NEW.round_id IS NOT OLD.round_id AND EXISTS(SELECT 1 FROM finance_allocation_current a WHERE a.income_id=OLD.id))
  OR NEW.total_cents<COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a WHERE a.income_id=OLD.id),0)
  OR (NEW.status='VOID' AND EXISTS(SELECT 1 FROM finance_allocation_current a WHERE a.income_id=OLD.id))
BEGIN SELECT RAISE(ABORT,'invalid_income'); END;
CREATE TRIGGER finance_income_no_delete BEFORE DELETE ON finance_income
BEGIN SELECT RAISE(ABORT,'income_immutable'); END;

CREATE TABLE finance_income_revision (
  id TEXT PRIMARY KEY,
  income_id TEXT NOT NULL REFERENCES finance_income(id) ON DELETE RESTRICT,
  previous_version INTEGER NOT NULL CHECK(previous_version>0),
  previous_income_date TEXT NOT NULL,
  previous_concept TEXT NOT NULL,
  previous_total_cents INTEGER NOT NULL,
  previous_budget_line_id TEXT NOT NULL,
  previous_counterparty_id TEXT,
  changed_by TEXT NOT NULL REFERENCES app_user(id),
  changed_at INTEGER NOT NULL,
  UNIQUE(income_id,previous_version)
);
CREATE TRIGGER finance_income_revision_no_update BEFORE UPDATE ON finance_income_revision
BEGIN SELECT RAISE(ABORT,'income_revision_immutable'); END;
CREATE TRIGGER finance_income_revision_no_delete BEFORE DELETE ON finance_income_revision
BEGIN SELECT RAISE(ABORT,'income_revision_immutable'); END;

-- An INCOME allocation may name the income it collects. Then it carries the income's line and round,
-- the income is ACTIVE, and the current allocations never exceed the income's total. Several movements
-- can collect one income, and one movement can collect several incomes.
ALTER TABLE finance_allocation ADD COLUMN income_id TEXT REFERENCES finance_income(id) ON DELETE RESTRICT;
CREATE INDEX finance_allocation_income_idx ON finance_allocation(income_id);
CREATE TRIGGER finance_allocation_income_link_guard BEFORE INSERT ON finance_allocation
WHEN NEW.income_id IS NOT NULL AND (
  NEW.kind!='INCOME'
  OR NOT EXISTS(SELECT 1 FROM finance_income i WHERE i.id=NEW.income_id AND i.status='ACTIVE'
    AND i.budget_line_id=NEW.budget_line_id AND i.round_id=NEW.round_id)
  OR NEW.amount_cents+COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation a JOIN finance_movement m
    ON m.id=a.movement_id AND m.allocation_version=a.set_version AND m.state='ACTIVE'
    WHERE a.income_id=NEW.income_id),0)>(SELECT total_cents FROM finance_income WHERE id=NEW.income_id))
BEGIN SELECT RAISE(ABORT,'invalid_income_allocation'); END;
CREATE TRIGGER finance_allocation_income_link_immutable BEFORE UPDATE OF income_id ON finance_allocation
BEGIN SELECT RAISE(ABORT,'allocation_immutable'); END;

INSERT OR IGNORE INTO permission(code) VALUES ('finance.income.read'),('finance.income.manage');
INSERT OR IGNORE INTO role_permission(role_code,permission_code) VALUES
  ('TREASURY','finance.income.read'),('TREASURY','finance.income.manage'),
  ('GROUP_COORDINATOR','finance.income.read'),('GROUP_COORDINATOR','finance.income.manage');
-- Current holders receive the grants of their ordinary work, as in 0027.
INSERT INTO user_permission_grant(id,user_id,permission_code,valid_from,granted_by,justification)
SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||
  substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
  holders.user_id,holders.permission_code,CAST(strftime('%s','now') AS INTEGER)*1000,NULL,
  'Transició 3.5G.2A: ingressos'
FROM (SELECT DISTINCT ur.user_id,rp.permission_code FROM user_role ur
  JOIN role_permission rp ON rp.role_code=ur.role_code
  WHERE ur.role_code IN ('TREASURY','GROUP_COORDINATOR') AND ur.section_id IS NULL AND ur.revoked_at IS NULL
    AND (ur.expires_at IS NULL OR ur.expires_at>CAST(strftime('%s','now') AS INTEGER)*1000)
    AND rp.permission_code IN ('finance.income.read','finance.income.manage')) holders
WHERE NOT EXISTS(SELECT 1 FROM user_permission_grant existing WHERE existing.user_id=holders.user_id
  AND existing.permission_code=holders.permission_code AND existing.revoked_at IS NULL);
