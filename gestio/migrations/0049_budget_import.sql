CREATE TABLE finance_budget_import(
 id TEXT PRIMARY KEY,round_id TEXT NOT NULL REFERENCES finance_round(id) ON DELETE RESTRICT,
 created_by TEXT NOT NULL REFERENCES app_user(id),created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,
 filename TEXT NOT NULL CHECK(length(filename) BETWEEN 1 AND 120),
 file_hash TEXT NOT NULL CHECK(length(file_hash)=64),object_key TEXT NOT NULL UNIQUE,
 template TEXT NOT NULL,preview_json TEXT NOT NULL CHECK(json_valid(preview_json)),
 round_version INTEGER NOT NULL,budget_id TEXT REFERENCES finance_budget(id),
 budget_version INTEGER,
 status TEXT NOT NULL DEFAULT 'PREVIEW' CHECK(status IN ('PREVIEW','CONFIRMED')),
 confirmed_at INTEGER,confirmed_by TEXT REFERENCES app_user(id),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 CHECK((status='CONFIRMED')=(confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL))
);
CREATE UNIQUE INDEX finance_budget_import_confirmed_round ON finance_budget_import(round_id) WHERE status='CONFIRMED';
CREATE INDEX finance_budget_import_file_actor ON finance_budget_import(round_id,file_hash,created_by);
CREATE TABLE finance_budget_import_line(
 import_id TEXT NOT NULL REFERENCES finance_budget_import(id) ON DELETE RESTRICT,
 line_id TEXT PRIMARY KEY REFERENCES finance_budget_line(id) ON DELETE RESTRICT,
 source_cell TEXT NOT NULL,label_cell TEXT NOT NULL,
 legacy_target TEXT CHECK(legacy_target IS NULL OR json_valid(legacy_target))
);
CREATE TRIGGER finance_budget_import_immutable BEFORE UPDATE ON finance_budget_import
WHEN OLD.status='CONFIRMED' OR NEW.id IS NOT OLD.id OR NEW.round_id IS NOT OLD.round_id
 OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at
 OR NEW.file_hash IS NOT OLD.file_hash OR NEW.object_key IS NOT OLD.object_key OR NEW.filename IS NOT OLD.filename
 OR NEW.preview_json IS NOT OLD.preview_json OR NEW.template IS NOT OLD.template
 OR NEW.round_version IS NOT OLD.round_version OR NEW.budget_id IS NOT OLD.budget_id
 OR NEW.budget_version IS NOT OLD.budget_version OR NEW.expires_at IS NOT OLD.expires_at
 OR NEW.version!=OLD.version+1
BEGIN SELECT RAISE(ABORT,'budget_import_immutable'); END;
CREATE TRIGGER finance_budget_import_no_delete BEFORE DELETE ON finance_budget_import
BEGIN SELECT RAISE(ABORT,'budget_import_immutable'); END;
CREATE TRIGGER finance_budget_import_line_no_update BEFORE UPDATE ON finance_budget_import_line
BEGIN SELECT RAISE(ABORT,'budget_import_immutable'); END;
CREATE TRIGGER finance_budget_import_line_no_delete BEFORE DELETE ON finance_budget_import_line
BEGIN SELECT RAISE(ABORT,'budget_import_immutable'); END;
