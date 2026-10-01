-- FASE 3.5G.1 (TREASURY.md §10.3, §14): minimal counterparties and the per-round budget catalogue,
-- budget and budget revisions. Earlier migrations are unchanged.

-- Minimal economic counterparty (person or organisation): no IBAN, no contact, no address; not a CRM.
CREATE TABLE finance_counterparty (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('PERSON','ORGANIZATION')),
  display_name TEXT NOT NULL CHECK(length(trim(display_name)) BETWEEN 2 AND 120),
  user_id TEXT REFERENCES app_user(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_by TEXT NOT NULL REFERENCES app_user(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK(kind='PERSON' OR user_id IS NULL)
);
CREATE UNIQUE INDEX finance_counterparty_user_unique ON finance_counterparty(user_id) WHERE user_id IS NOT NULL;
CREATE TRIGGER finance_counterparty_kind_immutable BEFORE UPDATE OF kind ON finance_counterparty
WHEN NEW.kind!=OLD.kind
BEGIN SELECT RAISE(ABORT,'counterparty_kind_immutable'); END;
CREATE TRIGGER finance_counterparty_no_delete BEFORE DELETE ON finance_counterparty
BEGIN SELECT RAISE(ABORT,'counterparty_immutable'); END;
CREATE TABLE finance_counterparty_revision (
  id TEXT PRIMARY KEY,
  counterparty_id TEXT NOT NULL REFERENCES finance_counterparty(id) ON DELETE RESTRICT,
  previous_version INTEGER NOT NULL CHECK(previous_version>0),
  previous_display_name TEXT NOT NULL,
  previous_user_id TEXT REFERENCES app_user(id),
  previous_status TEXT NOT NULL,
  changed_by TEXT NOT NULL REFERENCES app_user(id),
  changed_at INTEGER NOT NULL,
  UNIQUE(counterparty_id,previous_version)
);
CREATE TRIGGER finance_counterparty_revision_no_update BEFORE UPDATE ON finance_counterparty_revision
BEGIN SELECT RAISE(ABORT,'counterparty_revision_immutable'); END;
CREATE TRIGGER finance_counterparty_revision_no_delete BEFORE DELETE ON finance_counterparty_revision
BEGIN SELECT RAISE(ABORT,'counterparty_revision_immutable'); END;

-- Budget of a round: Tresoreria prepares and proposes, Coordinació general approves (TREASURY.md §14.2).
-- The approval of the initial budget freezes the planned amounts; later changes are budget revisions.
CREATE TABLE finance_budget (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL UNIQUE REFERENCES finance_round(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PROPOSED','APPROVED','CLOSED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_by TEXT NOT NULL REFERENCES app_user(id),
  created_at INTEGER NOT NULL,
  proposed_by TEXT REFERENCES app_user(id),
  proposed_at INTEGER,
  approved_by TEXT REFERENCES app_user(id),
  approved_at INTEGER,
  -- Optional record of an external approval (Assemblea or another body); authority TBD in the legal phase.
  external_approval_date TEXT CHECK(external_approval_date IS NULL OR date(external_approval_date)=external_approval_date),
  external_approval_reference TEXT CHECK(external_approval_reference IS NULL OR length(external_approval_reference) BETWEEN 1 AND 80),
  CHECK(status NOT IN ('PROPOSED','APPROVED','CLOSED') OR (proposed_by IS NOT NULL AND proposed_at IS NOT NULL)),
  CHECK((status IN ('APPROVED','CLOSED'))=(approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE TRIGGER finance_budget_transition BEFORE UPDATE OF status ON finance_budget
WHEN NEW.status!=OLD.status AND NOT (
  (OLD.status='DRAFT' AND NEW.status='PROPOSED') OR (OLD.status='PROPOSED' AND NEW.status IN ('DRAFT','APPROVED')) OR
  (OLD.status='APPROVED' AND NEW.status='CLOSED'))
BEGIN SELECT RAISE(ABORT,'invalid_budget_transition'); END;
CREATE TRIGGER finance_budget_closed_round BEFORE INSERT ON finance_budget
WHEN (SELECT status FROM finance_round WHERE id=NEW.round_id)='CLOSED'
BEGIN SELECT RAISE(ABORT,'finance_round_closed'); END;
CREATE TRIGGER finance_budget_no_delete BEFORE DELETE ON finance_budget
BEGIN SELECT RAISE(ABORT,'budget_immutable'); END;

-- Catalogue of budget lines of a round (TREASURY.md §14.1). N levels; amounts on leaves only; a parent
-- shares the nature of its children; a leaf is a line without children; a node with children never moves
-- (so no cycle can be created);
-- lines are never deleted (deactivation only); codes are revisable data, unique per round and nature
-- (income and expense trees keep their own numbering, as the Excel does).
CREATE TABLE finance_budget_line (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES finance_round(id) ON DELETE RESTRICT,
  code TEXT NOT NULL CHECK(length(code) BETWEEN 1 AND 20),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
  parent_id TEXT REFERENCES finance_budget_line(id) ON DELETE RESTRICT,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK(sort_order BETWEEN 0 AND 10000),
  nature TEXT NOT NULL CHECK(nature IN ('INCOME','EXPENSE','RESERVE_USE','RESERVE_CONTRIBUTION')),
  economic_group TEXT CHECK(economic_group IS NULL OR length(economic_group) BETWEEN 1 AND 40),
  activity_id TEXT REFERENCES activity(id) ON DELETE RESTRICT,
  section_id TEXT REFERENCES section(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE')),
  -- Planned amount of a leaf: the initial budget once approved (frozen). Always NULL on a heading; NULL on
  -- a leaf means 0 (e.g. a line added after approval, funded through revisions).
  planned_cents INTEGER CHECK(planned_cents IS NULL OR planned_cents BETWEEN 0 AND 100000000),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_by TEXT NOT NULL REFERENCES app_user(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(round_id,nature,code),
  CHECK(parent_id IS NULL OR parent_id!=id)
);
CREATE INDEX finance_budget_line_parent_idx ON finance_budget_line(parent_id,sort_order);
CREATE INDEX finance_budget_line_round_idx ON finance_budget_line(round_id,nature,code);
CREATE TRIGGER finance_budget_line_insert_guard BEFORE INSERT ON finance_budget_line
WHEN (SELECT status FROM finance_round WHERE id=NEW.round_id)='CLOSED'
  OR (NEW.parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM finance_budget_line p WHERE p.id=NEW.parent_id
    AND p.round_id=NEW.round_id AND p.nature=NEW.nature AND p.status='ACTIVE' AND p.planned_cents IS NULL))
  OR (NEW.planned_cents IS NOT NULL AND (SELECT status FROM finance_budget WHERE round_id=NEW.round_id) IN ('APPROVED','CLOSED'))
BEGIN SELECT RAISE(ABORT,'invalid_budget_line'); END;
CREATE TRIGGER finance_budget_line_update_guard BEFORE UPDATE ON finance_budget_line
WHEN NEW.round_id IS NOT OLD.round_id OR NEW.nature IS NOT OLD.nature
  OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at
  OR (SELECT status FROM finance_round WHERE id=OLD.round_id)='CLOSED'
  OR (NEW.parent_id IS NOT OLD.parent_id AND (
    EXISTS(SELECT 1 FROM finance_budget_line c WHERE c.parent_id=OLD.id) OR
    (NEW.parent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM finance_budget_line p WHERE p.id=NEW.parent_id
      AND p.round_id=NEW.round_id AND p.nature=NEW.nature AND p.status='ACTIVE' AND p.planned_cents IS NULL))))
  OR (NEW.planned_cents IS NOT OLD.planned_cents AND (
    (SELECT status FROM finance_budget WHERE round_id=OLD.round_id) IN ('APPROVED','CLOSED') OR
    (NEW.planned_cents IS NOT NULL AND EXISTS(SELECT 1 FROM finance_budget_line c WHERE c.parent_id=OLD.id))))
  OR (NEW.status='INACTIVE' AND OLD.status='ACTIVE' AND EXISTS(SELECT 1 FROM finance_budget_line c WHERE c.parent_id=OLD.id AND c.status='ACTIVE'))
  OR (NEW.status='ACTIVE' AND OLD.status='INACTIVE' AND NEW.parent_id IS NOT NULL
    AND (SELECT status FROM finance_budget_line WHERE id=NEW.parent_id)!='ACTIVE')
BEGIN SELECT RAISE(ABORT,'invalid_budget_line'); END;
CREATE TRIGGER finance_budget_line_no_delete BEFORE DELETE ON finance_budget_line
BEGIN SELECT RAISE(ABORT,'budget_line_in_use'); END;
CREATE TABLE finance_budget_line_revision (
  id TEXT PRIMARY KEY,
  line_id TEXT NOT NULL REFERENCES finance_budget_line(id) ON DELETE RESTRICT,
  previous_version INTEGER NOT NULL CHECK(previous_version>0),
  previous_code TEXT NOT NULL,
  previous_name TEXT NOT NULL,
  previous_parent_id TEXT,
  previous_sort_order INTEGER NOT NULL,
  previous_status TEXT NOT NULL,
  previous_planned_cents INTEGER,
  changed_by TEXT NOT NULL REFERENCES app_user(id),
  changed_at INTEGER NOT NULL,
  UNIQUE(line_id,previous_version)
);
CREATE TRIGGER finance_budget_line_revision_no_update BEFORE UPDATE ON finance_budget_line_revision
BEGIN SELECT RAISE(ABORT,'budget_line_revision_immutable'); END;
CREATE TRIGGER finance_budget_line_revision_no_delete BEFORE DELETE ON finance_budget_line_revision
BEGIN SELECT RAISE(ABORT,'budget_line_revision_immutable'); END;

-- Budget revisions of an approved budget: Tresoreria proposes, Coordinació general approves.
-- current = initial (planned) + Σ approved deltas; the initial amount never changes.
CREATE TABLE finance_budget_revision (
  id TEXT PRIMARY KEY,
  budget_id TEXT NOT NULL REFERENCES finance_budget(id) ON DELETE RESTRICT,
  line_id TEXT NOT NULL REFERENCES finance_budget_line(id) ON DELETE RESTRICT,
  delta_cents INTEGER NOT NULL CHECK(delta_cents!=0 AND delta_cents BETWEEN -100000000 AND 100000000),
  status TEXT NOT NULL DEFAULT 'PROPOSED' CHECK(status IN ('PROPOSED','APPROVED','REJECTED')),
  proposed_by TEXT NOT NULL REFERENCES app_user(id),
  proposed_at INTEGER NOT NULL,
  decided_by TEXT REFERENCES app_user(id),
  decided_at INTEGER,
  external_approval_date TEXT CHECK(external_approval_date IS NULL OR date(external_approval_date)=external_approval_date),
  external_approval_reference TEXT CHECK(external_approval_reference IS NULL OR length(external_approval_reference) BETWEEN 1 AND 80),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  CHECK((status='PROPOSED')=(decided_by IS NULL AND decided_at IS NULL))
);
CREATE INDEX finance_budget_revision_line_idx ON finance_budget_revision(line_id,status);
CREATE TRIGGER finance_budget_revision_insert_guard BEFORE INSERT ON finance_budget_revision
WHEN NEW.status!='PROPOSED'
  OR (SELECT status FROM finance_budget WHERE id=NEW.budget_id)!='APPROVED'
  OR NOT EXISTS(SELECT 1 FROM finance_budget_line l JOIN finance_budget b ON b.round_id=l.round_id
    WHERE l.id=NEW.line_id AND b.id=NEW.budget_id AND l.status='ACTIVE')
  OR EXISTS(SELECT 1 FROM finance_budget_line c WHERE c.parent_id=NEW.line_id)
BEGIN SELECT RAISE(ABORT,'invalid_budget_revision'); END;
CREATE TRIGGER finance_budget_revision_transition BEFORE UPDATE ON finance_budget_revision
WHEN NOT (OLD.status='PROPOSED' AND NEW.status IN ('APPROVED','REJECTED'))
  OR NEW.budget_id IS NOT OLD.budget_id OR NEW.line_id IS NOT OLD.line_id OR NEW.delta_cents IS NOT OLD.delta_cents
  OR NEW.proposed_by IS NOT OLD.proposed_by OR NEW.proposed_at IS NOT OLD.proposed_at
  OR (SELECT status FROM finance_budget WHERE id=OLD.budget_id)!='APPROVED'
  OR (NEW.status='APPROVED' AND COALESCE((SELECT planned_cents FROM finance_budget_line WHERE id=OLD.line_id),0)
    +COALESCE((SELECT sum(r.delta_cents) FROM finance_budget_revision r WHERE r.line_id=OLD.line_id AND r.status='APPROVED'),0)
    +OLD.delta_cents<0)
BEGIN SELECT RAISE(ABORT,'invalid_budget_revision'); END;
CREATE TRIGGER finance_budget_revision_no_delete BEFORE DELETE ON finance_budget_revision
BEGIN SELECT RAISE(ABORT,'budget_revision_immutable'); END;

-- Amounts per line: initial (planned leaf amount) and current (initial + approved revisions); headings
-- sum their whole subtree.
CREATE VIEW finance_budget_line_amount AS
WITH RECURSIVE tree(ancestor_id,line_id) AS (
  SELECT id,id FROM finance_budget_line
  UNION ALL
  SELECT t.ancestor_id,c.id FROM tree t JOIN finance_budget_line c ON c.parent_id=t.line_id
)
SELECT t.ancestor_id AS line_id,
  COALESCE(SUM(l.planned_cents),0) AS initial_cents,
  COALESCE(SUM(l.planned_cents),0)+COALESCE(SUM((SELECT sum(r.delta_cents) FROM finance_budget_revision r
    WHERE r.line_id=l.id AND r.status='APPROVED')),0) AS current_cents
FROM tree t JOIN finance_budget_line l ON l.id=t.line_id
GROUP BY t.ancestor_id;
