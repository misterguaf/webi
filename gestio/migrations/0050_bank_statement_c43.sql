-- FASE 3.5I (C43): bank statements in Cuaderno 43 reuse the existing import batches and immutable movements.
-- Earlier migrations are unchanged. Two changes only:
-- 1. finance_import_batch also accepts source_format 'C43' and records the statement period and balances
--    (SQLite cannot widen a CHECK: the table is rebuilt with identical rows, foreign keys deferred to commit);
-- 2. finance_movement_bank_detail keeps the C43 codes and references of each imported movement, protected
--    like the original description (references can identify payers). Listings never read it.
PRAGMA defer_foreign_keys = true;

-- Movements reference the batches, so the table is not renamed (a rename leaves the deferred foreign-key
-- violations of the dropped parent counted): the rows are kept aside, the table is recreated under the same
-- name and the rows are inserted back, which satisfies every movement before commit.
CREATE TABLE finance_import_batch_rows_v50 AS SELECT * FROM finance_import_batch;
DROP TRIGGER finance_import_batch_no_update;
DROP TRIGGER finance_import_batch_no_delete;
DROP TABLE finance_import_batch;
CREATE TABLE finance_import_batch (
  id TEXT PRIMARY KEY,
  position_id TEXT NOT NULL REFERENCES finance_position(id) ON DELETE RESTRICT,
  source_format TEXT NOT NULL CHECK(source_format IN ('SYNTHETIC_CSV_V1','C43')),
  file_sha256 TEXT NOT NULL UNIQUE CHECK(length(file_sha256)=64),
  row_count INTEGER NOT NULL CHECK(row_count BETWEEN 1 AND 5000),
  created_count INTEGER NOT NULL CHECK(created_count>=0),
  duplicate_count INTEGER NOT NULL CHECK(duplicate_count>=0),
  flagged_count INTEGER NOT NULL CHECK(flagged_count>=0),
  status TEXT NOT NULL CHECK(status IN ('IMPORTED','PARTIALLY_FLAGGED')),
  source_object_key TEXT UNIQUE,
  imported_by TEXT NOT NULL REFERENCES app_user(id),
  imported_at INTEGER NOT NULL,
  -- C43 statement facts (NULL for the synthetic CSV): period, balances, last four account digits, decoding used.
  statement_start TEXT CHECK(statement_start IS NULL OR date(statement_start)=statement_start),
  statement_end TEXT CHECK(statement_end IS NULL OR date(statement_end)=statement_end),
  opening_balance_cents INTEGER,
  closing_balance_cents INTEGER,
  account_mask TEXT CHECK(account_mask IS NULL OR (length(account_mask) BETWEEN 1 AND 4 AND account_mask NOT GLOB '*[^0-9]*')),
  source_encoding TEXT CHECK(source_encoding IS NULL OR source_encoding IN ('ascii','utf-8','windows-1252','cp850')),
  CHECK(created_count+duplicate_count=row_count),
  CHECK(flagged_count<=created_count),
  CHECK((status='PARTIALLY_FLAGGED')=(flagged_count>0)),
  CHECK((source_format='C43')=(statement_start IS NOT NULL AND statement_end IS NOT NULL AND opening_balance_cents IS NOT NULL
    AND closing_balance_cents IS NOT NULL AND source_encoding IS NOT NULL)),
  CHECK(statement_end IS NULL OR statement_end>=statement_start)
);
INSERT INTO finance_import_batch(id,position_id,source_format,file_sha256,row_count,created_count,duplicate_count,flagged_count,
  status,source_object_key,imported_by,imported_at)
SELECT id,position_id,source_format,file_sha256,row_count,created_count,duplicate_count,flagged_count,
  status,source_object_key,imported_by,imported_at FROM finance_import_batch_rows_v50;
CREATE TABLE finance_import_batch_copy_assert(n INTEGER NOT NULL CHECK(n=0));
INSERT INTO finance_import_batch_copy_assert
SELECT (SELECT count(*) FROM finance_import_batch_rows_v50)-(SELECT count(*) FROM finance_import_batch);
DROP TABLE finance_import_batch_copy_assert;
DROP TABLE finance_import_batch_rows_v50;
CREATE TRIGGER finance_import_batch_no_update BEFORE UPDATE ON finance_import_batch
BEGIN SELECT RAISE(ABORT,'import_batch_immutable'); END;
CREATE TRIGGER finance_import_batch_no_delete BEFORE DELETE ON finance_import_batch
BEGIN SELECT RAISE(ABORT,'import_batch_immutable'); END;

CREATE TABLE finance_movement_bank_detail (
  movement_id TEXT PRIMARY KEY REFERENCES finance_movement(id) ON DELETE RESTRICT,
  common_concept TEXT NOT NULL CHECK(length(common_concept)=2 AND common_concept NOT GLOB '*[^0-9]*'),
  own_concept TEXT CHECK(own_concept IS NULL OR length(own_concept) BETWEEN 1 AND 3),
  origin_branch TEXT CHECK(origin_branch IS NULL OR length(origin_branch) BETWEEN 1 AND 4),
  document_number TEXT CHECK(document_number IS NULL OR length(document_number) BETWEEN 1 AND 10),
  reference_1 TEXT CHECK(reference_1 IS NULL OR length(reference_1) BETWEEN 1 AND 12),
  reference_2 TEXT CHECK(reference_2 IS NULL OR length(reference_2) BETWEEN 1 AND 16),
  -- How the duplicate identity was built: the bank reference when present, otherwise the full row.
  identity TEXT NOT NULL CHECK(identity IN ('BANK_REFERENCE','ROW'))
);
CREATE TRIGGER finance_movement_bank_detail_insert_guard BEFORE INSERT ON finance_movement_bank_detail
WHEN NOT EXISTS(SELECT 1 FROM finance_movement m JOIN finance_import_batch b ON b.id=m.import_batch_id
  WHERE m.id=NEW.movement_id AND b.source_format='C43')
BEGIN SELECT RAISE(ABORT,'invalid_bank_detail'); END;
CREATE TRIGGER finance_movement_bank_detail_no_update BEFORE UPDATE ON finance_movement_bank_detail
BEGIN SELECT RAISE(ABORT,'bank_detail_immutable'); END;
CREATE TRIGGER finance_movement_bank_detail_no_delete BEFORE DELETE ON finance_movement_bank_detail
BEGIN SELECT RAISE(ABORT,'bank_detail_immutable'); END;
