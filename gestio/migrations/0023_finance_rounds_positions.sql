-- FASE 3.5G.1 (financial foundation, TREASURY.md §5–§6, §16): economic rounds, financial positions,
-- opening balances, general reserves and the closing structures. Earlier migrations are unchanged.
--
-- A round is the economic unit of time (code AAAA/AAAA, period, state). Positions (bank, card, cash)
-- belong to the group, not to a round; their balances are always derived from movements. Opening
-- balances and general reserves are per round, append-only by revision. The official close snapshot
-- is immutable; later effects on a closed round are post-close adjustments carried as reserves.

CREATE TABLE finance_round (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE CHECK(length(code)=9 AND code GLOB '[0-9][0-9][0-9][0-9]/[0-9][0-9][0-9][0-9]'),
  period_start TEXT NOT NULL CHECK(date(period_start)=period_start),
  period_end TEXT NOT NULL CHECK(date(period_end)=period_end),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','OPEN','CLOSING','CLOSED')),
  annual_fee_round_id TEXT UNIQUE REFERENCES annual_fee_round(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_by TEXT NOT NULL REFERENCES app_user(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  opened_by TEXT REFERENCES app_user(id),
  opened_at INTEGER,
  closing_started_at INTEGER,
  closed_by TEXT REFERENCES app_user(id),
  closed_at INTEGER,
  CHECK(period_end>period_start),
  CHECK(status='DRAFT' OR (opened_by IS NOT NULL AND opened_at IS NOT NULL)),
  CHECK((status='CLOSED')=(closed_by IS NOT NULL AND closed_at IS NOT NULL))
);
-- At most one OPEN round for ordinary operation and at most one other CLOSING (TREASURY.md I28).
CREATE UNIQUE INDEX finance_round_one_open ON finance_round(status) WHERE status='OPEN';
CREATE UNIQUE INDEX finance_round_one_closing ON finance_round(status) WHERE status='CLOSING';
CREATE TRIGGER finance_round_no_overlap_insert BEFORE INSERT ON finance_round
WHEN EXISTS(SELECT 1 FROM finance_round r WHERE NEW.period_start<=r.period_end AND NEW.period_end>=r.period_start)
BEGIN SELECT RAISE(ABORT,'finance_round_overlap'); END;
CREATE TRIGGER finance_round_no_overlap_update BEFORE UPDATE OF period_start,period_end ON finance_round
WHEN EXISTS(SELECT 1 FROM finance_round r WHERE r.id!=NEW.id AND NEW.period_start<=r.period_end AND NEW.period_end>=r.period_start)
BEGIN SELECT RAISE(ABORT,'finance_round_overlap'); END;
-- Code and period are configuration of a draft only; a used round keeps its identity.
CREATE TRIGGER finance_round_definition_locked BEFORE UPDATE OF code,period_start,period_end ON finance_round
WHEN OLD.status!='DRAFT' AND (NEW.code IS NOT OLD.code OR NEW.period_start IS NOT OLD.period_start OR NEW.period_end IS NOT OLD.period_end)
BEGIN SELECT RAISE(ABORT,'finance_round_locked'); END;
-- DRAFT → OPEN → CLOSING → CLOSED; CLOSING may return to OPEN before closing. A closed round never reopens.
CREATE TRIGGER finance_round_transition BEFORE UPDATE OF status ON finance_round
WHEN NEW.status!=OLD.status AND NOT (
  (OLD.status='DRAFT' AND NEW.status='OPEN') OR (OLD.status='OPEN' AND NEW.status='CLOSING') OR
  (OLD.status='CLOSING' AND NEW.status IN ('OPEN','CLOSED')))
BEGIN SELECT RAISE(ABORT,'invalid_finance_round_transition'); END;
CREATE TRIGGER finance_round_closed_immutable BEFORE UPDATE ON finance_round
WHEN OLD.status='CLOSED'
BEGIN SELECT RAISE(ABORT,'finance_round_closed'); END;
CREATE TRIGGER finance_round_no_delete BEFORE DELETE ON finance_round
BEGIN SELECT RAISE(ABORT,'finance_round_immutable'); END;

CREATE TABLE finance_position (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('BANK','CARD','CASH')),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 80),
  -- Last digits at most: never an IBAN or a card number (TREASURY.md §6).
  masked_reference TEXT CHECK(masked_reference IS NULL OR (length(masked_reference) BETWEEN 1 AND 4 AND masked_reference NOT GLOB '*[^0-9]*')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_by TEXT NOT NULL REFERENCES app_user(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TRIGGER finance_position_kind_immutable BEFORE UPDATE OF kind ON finance_position
WHEN NEW.kind!=OLD.kind
BEGIN SELECT RAISE(ABORT,'finance_position_kind_immutable'); END;
CREATE TRIGGER finance_position_no_delete BEFORE DELETE ON finance_position
BEGIN SELECT RAISE(ABORT,'finance_position_immutable'); END;

-- Financial position of each position at the round period start. Append-only revisions: a correction is
-- a new revision; the current value is the latest one. Manual INITIALISATION is only possible while no
-- round has been closed (the first managed round); later rounds derive it from the previous close.
CREATE TABLE finance_opening_balance (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES finance_round(id) ON DELETE RESTRICT,
  position_id TEXT NOT NULL REFERENCES finance_position(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK(revision>0),
  amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN -100000000 AND 100000000),
  source TEXT NOT NULL CHECK(source IN ('INITIALISATION','DERIVED')),
  recorded_by TEXT NOT NULL REFERENCES app_user(id),
  recorded_at INTEGER NOT NULL,
  UNIQUE(round_id,position_id,revision)
);
CREATE TRIGGER finance_opening_balance_guard BEFORE INSERT ON finance_opening_balance
WHEN (SELECT status FROM finance_round WHERE id=NEW.round_id)='CLOSED'
  OR NEW.revision!=COALESCE((SELECT max(revision) FROM finance_opening_balance
    WHERE round_id=NEW.round_id AND position_id=NEW.position_id),0)+1
  OR (NEW.source='INITIALISATION' AND EXISTS(SELECT 1 FROM finance_round WHERE status='CLOSED'))
BEGIN SELECT RAISE(ABORT,'invalid_opening_balance'); END;
CREATE TRIGGER finance_opening_balance_no_update BEFORE UPDATE ON finance_opening_balance
BEGIN SELECT RAISE(ABORT,'opening_balance_immutable'); END;
CREATE TRIGGER finance_opening_balance_no_delete BEFORE DELETE ON finance_opening_balance
BEGIN SELECT RAISE(ABORT,'opening_balance_immutable'); END;
CREATE VIEW finance_opening_balance_current AS
SELECT o.round_id,o.position_id,o.revision,o.amount_cents,o.source,o.recorded_at
FROM finance_opening_balance o
WHERE o.revision=(SELECT max(x.revision) FROM finance_opening_balance x WHERE x.round_id=o.round_id AND x.position_id=o.position_id);

-- General reserves (own funds) at the round start: one general reserve in v1, distinct from the financial
-- position. Same revision pattern and the same INITIALISATION rule.
CREATE TABLE finance_reserve_opening (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES finance_round(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK(revision>0),
  amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN -100000000 AND 100000000),
  source TEXT NOT NULL CHECK(source IN ('INITIALISATION','DERIVED')),
  recorded_by TEXT NOT NULL REFERENCES app_user(id),
  recorded_at INTEGER NOT NULL,
  UNIQUE(round_id,revision)
);
CREATE TRIGGER finance_reserve_opening_guard BEFORE INSERT ON finance_reserve_opening
WHEN (SELECT status FROM finance_round WHERE id=NEW.round_id)='CLOSED'
  OR NEW.revision!=COALESCE((SELECT max(revision) FROM finance_reserve_opening WHERE round_id=NEW.round_id),0)+1
  OR (NEW.source='INITIALISATION' AND EXISTS(SELECT 1 FROM finance_round WHERE status='CLOSED'))
BEGIN SELECT RAISE(ABORT,'invalid_reserve_opening'); END;
CREATE TRIGGER finance_reserve_opening_no_update BEFORE UPDATE ON finance_reserve_opening
BEGIN SELECT RAISE(ABORT,'reserve_opening_immutable'); END;
CREATE TRIGGER finance_reserve_opening_no_delete BEFORE DELETE ON finance_reserve_opening
BEGIN SELECT RAISE(ABORT,'reserve_opening_immutable'); END;

-- Official close snapshot (written once, when CLOSING → CLOSED; the workflow arrives in 3.5G.4).
CREATE TABLE finance_round_close (
  round_id TEXT PRIMARY KEY REFERENCES finance_round(id) ON DELETE RESTRICT,
  income_cents INTEGER NOT NULL,
  expense_cents INTEGER NOT NULL,
  result_cents INTEGER NOT NULL,
  reserves_final_cents INTEGER NOT NULL,
  closed_by TEXT NOT NULL REFERENCES app_user(id),
  closed_at INTEGER NOT NULL,
  CHECK(result_cents=income_cents-expense_cents)
);
CREATE TRIGGER finance_round_close_guard BEFORE INSERT ON finance_round_close
WHEN (SELECT status FROM finance_round WHERE id=NEW.round_id)!='CLOSING'
BEGIN SELECT RAISE(ABORT,'finance_round_not_closing'); END;
CREATE TRIGGER finance_round_close_no_update BEFORE UPDATE ON finance_round_close
BEGIN SELECT RAISE(ABORT,'finance_round_close_immutable'); END;
CREATE TRIGGER finance_round_close_no_delete BEFORE DELETE ON finance_round_close
BEGIN SELECT RAISE(ABORT,'finance_round_close_immutable'); END;
CREATE TRIGGER finance_round_close_required BEFORE UPDATE OF status ON finance_round
WHEN NEW.status='CLOSED' AND OLD.status!='CLOSED' AND NOT EXISTS(SELECT 1 FROM finance_round_close WHERE round_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'finance_round_close_snapshot_required'); END;

-- Post-close adjustments (TREASURY.md §5.4): official close + adjustments = effective figures. Carried as
-- reserves in the OPEN round, or pending until the next round opens. Append-only except the carry.
CREATE TABLE finance_post_close_adjustment (
  id TEXT PRIMARY KEY,
  closed_round_id TEXT NOT NULL REFERENCES finance_round(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(kind IN ('LATE_INCOME','LATE_EXPENSE','REFUND','CORRECTION')),
  amount_cents INTEGER NOT NULL CHECK(amount_cents!=0),
  reverses_id TEXT REFERENCES finance_post_close_adjustment(id) ON DELETE RESTRICT,
  carry_state TEXT NOT NULL CHECK(carry_state IN ('PENDING_CARRY','CARRIED')),
  carried_round_id TEXT REFERENCES finance_round(id) ON DELETE RESTRICT,
  carried_at INTEGER,
  created_by TEXT NOT NULL REFERENCES app_user(id),
  created_at INTEGER NOT NULL,
  CHECK((carry_state='CARRIED')=(carried_round_id IS NOT NULL AND carried_at IS NOT NULL)),
  CHECK(carried_round_id IS NULL OR carried_round_id!=closed_round_id)
);
CREATE TRIGGER finance_post_close_adjustment_guard BEFORE INSERT ON finance_post_close_adjustment
WHEN (SELECT status FROM finance_round WHERE id=NEW.closed_round_id)!='CLOSED'
  OR (NEW.carry_state='CARRIED' AND (SELECT status FROM finance_round WHERE id=NEW.carried_round_id) IS NOT 'OPEN')
BEGIN SELECT RAISE(ABORT,'invalid_post_close_adjustment'); END;
CREATE TRIGGER finance_post_close_adjustment_carry BEFORE UPDATE ON finance_post_close_adjustment
WHEN NOT (OLD.carry_state='PENDING_CARRY' AND NEW.carry_state='CARRIED'
    AND (SELECT status FROM finance_round WHERE id=NEW.carried_round_id)='OPEN')
  OR NEW.closed_round_id IS NOT OLD.closed_round_id OR NEW.kind IS NOT OLD.kind OR NEW.amount_cents IS NOT OLD.amount_cents
  OR NEW.reverses_id IS NOT OLD.reverses_id OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'post_close_adjustment_immutable'); END;
CREATE TRIGGER finance_post_close_adjustment_no_delete BEFORE DELETE ON finance_post_close_adjustment
BEGIN SELECT RAISE(ABORT,'post_close_adjustment_immutable'); END;
