-- G.4: explicit reserve movements and immutable official result at close.
INSERT OR IGNORE INTO permission(code) VALUES ('finance.round.close');
INSERT OR IGNORE INTO role_permission(role_code,permission_code) VALUES ('TREASURY','finance.round.close');
INSERT INTO user_permission_grant(id,user_id,permission_code,valid_from,granted_by,justification)
SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||
  substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
  ur.user_id,'finance.round.close',CAST(strftime('%s','now') AS INTEGER)*1000,NULL,'Transició G.4: tancament de ronda per Tresoreria'
FROM user_role ur WHERE ur.role_code='TREASURY' AND ur.section_id IS NULL AND ur.revoked_at IS NULL
  AND ur.valid_from<=CAST(strftime('%s','now') AS INTEGER)*1000
  AND (ur.expires_at IS NULL OR ur.expires_at>CAST(strftime('%s','now') AS INTEGER)*1000)
  AND NOT EXISTS(SELECT 1 FROM user_permission_grant g WHERE g.user_id=ur.user_id
    AND g.permission_code='finance.round.close' AND g.revoked_at IS NULL);

CREATE TABLE finance_reserve_operation (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES finance_round(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(kind IN ('CONTRIBUTION','APPLICATION')),
  amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 100000000),
  created_by TEXT NOT NULL REFERENCES app_user(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX finance_reserve_operation_round_idx ON finance_reserve_operation(round_id,created_at);
CREATE TRIGGER finance_reserve_operation_guard BEFORE INSERT ON finance_reserve_operation
WHEN (SELECT status FROM finance_round WHERE id=NEW.round_id) NOT IN ('OPEN','CLOSING')
  OR (NEW.kind='APPLICATION' AND NEW.amount_cents>
    COALESCE((SELECT amount_cents FROM finance_reserve_opening WHERE round_id=NEW.round_id ORDER BY revision DESC LIMIT 1),0)
    +COALESCE((SELECT sum(amount_cents) FROM finance_reserve_operation WHERE round_id=NEW.round_id AND kind='CONTRIBUTION'),0)
    -COALESCE((SELECT sum(amount_cents) FROM finance_reserve_operation WHERE round_id=NEW.round_id AND kind='APPLICATION'),0))
BEGIN SELECT RAISE(ABORT,'invalid_reserve_operation'); END;
CREATE TRIGGER finance_reserve_operation_no_update BEFORE UPDATE ON finance_reserve_operation
BEGIN SELECT RAISE(ABORT,'reserve_operation_immutable'); END;
CREATE TRIGGER finance_reserve_operation_no_delete BEFORE DELETE ON finance_reserve_operation
BEGIN SELECT RAISE(ABORT,'reserve_operation_immutable'); END;

-- No official close workflow existed before G.4. Fail if someone inserted a snapshot through direct SQL;
-- never invent reserve details for a historical official close.
CREATE TABLE finance_close_upgrade_assert(n INTEGER NOT NULL CHECK(n=0));
INSERT INTO finance_close_upgrade_assert SELECT count(*) FROM finance_round_close;
DROP TABLE finance_close_upgrade_assert;
ALTER TABLE finance_round_close ADD COLUMN reserve_contribution_cents INTEGER NOT NULL DEFAULT 0 CHECK(reserve_contribution_cents>=0);
ALTER TABLE finance_round_close ADD COLUMN reserve_application_cents INTEGER NOT NULL DEFAULT 0 CHECK(reserve_application_cents>=0);
ALTER TABLE finance_round_close ADD COLUMN result_after_reserves_cents INTEGER NOT NULL DEFAULT 0;
DROP TRIGGER finance_round_close_guard;
CREATE TRIGGER finance_round_close_guard BEFORE INSERT ON finance_round_close
WHEN (SELECT status FROM finance_round WHERE id=NEW.round_id)!='CLOSING'
  OR NEW.income_cents!=(SELECT income_cents FROM finance_round_economics WHERE round_id=NEW.round_id)
  OR NEW.expense_cents!=(SELECT expense_gross_cents-expense_refund_cents FROM finance_round_economics WHERE round_id=NEW.round_id)
  OR NEW.reserve_contribution_cents!=COALESCE((SELECT sum(amount_cents) FROM finance_reserve_operation
    WHERE round_id=NEW.round_id AND kind='CONTRIBUTION'),0)
  OR NEW.reserve_application_cents!=COALESCE((SELECT sum(amount_cents) FROM finance_reserve_operation
    WHERE round_id=NEW.round_id AND kind='APPLICATION'),0)
  OR NEW.reserves_final_cents!=COALESCE((SELECT amount_cents FROM finance_reserve_opening
    WHERE round_id=NEW.round_id ORDER BY revision DESC LIMIT 1),0)+NEW.reserve_contribution_cents-NEW.reserve_application_cents
  OR NEW.reserves_final_cents<0
  OR NEW.result_after_reserves_cents!=NEW.result_cents+NEW.reserve_application_cents-NEW.reserve_contribution_cents
BEGIN SELECT RAISE(ABORT,'invalid_finance_round_close'); END;
