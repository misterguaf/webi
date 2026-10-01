-- FASE 3.5G.1 (TREASURY.md §7–§8): import batches and immutable financial movements. Earlier migrations
-- are unchanged.
--
-- A movement belongs to a position, a date and an origin — never to an economic round (the round comes
-- from its allocations). It is never edited or deleted: the only changes are the duplicate voiding (with
-- a link to the kept movement), clearing a near-match review flag and the allocation-set version.
-- The original bank description lives apart in finance_movement_description (protected; the retention
-- policy is a LEGAL DECISION REQUIRED); listings use the minimised display_label only.

CREATE TABLE finance_import_batch (
  id TEXT PRIMARY KEY,
  position_id TEXT NOT NULL REFERENCES finance_position(id) ON DELETE RESTRICT,
  source_format TEXT NOT NULL CHECK(source_format IN ('SYNTHETIC_CSV_V1')),
  file_sha256 TEXT NOT NULL UNIQUE CHECK(length(file_sha256)=64),
  row_count INTEGER NOT NULL CHECK(row_count BETWEEN 1 AND 5000),
  created_count INTEGER NOT NULL CHECK(created_count>=0),
  duplicate_count INTEGER NOT NULL CHECK(duplicate_count>=0),
  flagged_count INTEGER NOT NULL CHECK(flagged_count>=0),
  status TEXT NOT NULL CHECK(status IN ('IMPORTED','PARTIALLY_FLAGGED')),
  -- Original file in private R2 only if the legal decision allows keeping it; NULL until then.
  source_object_key TEXT UNIQUE,
  imported_by TEXT NOT NULL REFERENCES app_user(id),
  imported_at INTEGER NOT NULL,
  CHECK(created_count+duplicate_count=row_count),
  CHECK(flagged_count<=created_count),
  CHECK((status='PARTIALLY_FLAGGED')=(flagged_count>0))
);
CREATE TRIGGER finance_import_batch_no_update BEFORE UPDATE ON finance_import_batch
BEGIN SELECT RAISE(ABORT,'import_batch_immutable'); END;
CREATE TRIGGER finance_import_batch_no_delete BEFORE DELETE ON finance_import_batch
BEGIN SELECT RAISE(ABORT,'import_batch_immutable'); END;

CREATE TABLE finance_movement (
  id TEXT PRIMARY KEY,
  position_id TEXT NOT NULL REFERENCES finance_position(id) ON DELETE RESTRICT,
  operation_date TEXT NOT NULL CHECK(date(operation_date)=operation_date),
  value_date TEXT CHECK(value_date IS NULL OR date(value_date)=value_date),
  amount_cents INTEGER NOT NULL CHECK(amount_cents!=0 AND amount_cents BETWEEN -100000000 AND 100000000),
  origin TEXT NOT NULL CHECK(origin IN ('IMPORT','MANUAL')),
  import_batch_id TEXT REFERENCES finance_import_batch(id) ON DELETE RESTRICT,
  batch_row INTEGER CHECK(batch_row IS NULL OR batch_row>0),
  bank_reference TEXT CHECK(bank_reference IS NULL OR length(bank_reference) BETWEEN 1 AND 80),
  -- SHA-256 of the canonical row (position, dates, amount, reference, normalised description digest and
  -- ordinal among identical rows of the same file). Never the bank balance.
  fingerprint TEXT NOT NULL UNIQUE CHECK(length(fingerprint)=64),
  display_label TEXT NOT NULL CHECK(length(display_label) BETWEEN 1 AND 80),
  auxiliary_balance_cents INTEGER,
  review_flag TEXT CHECK(review_flag IS NULL OR review_flag IN ('NEAR_MATCH')),
  state TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(state IN ('ACTIVE','VOID_DUPLICATE')),
  duplicate_of_id TEXT REFERENCES finance_movement(id) ON DELETE RESTRICT,
  voided_by TEXT REFERENCES app_user(id),
  voided_at INTEGER,
  allocation_version INTEGER NOT NULL DEFAULT 0 CHECK(allocation_version>=0),
  review_version INTEGER NOT NULL DEFAULT 1 CHECK(review_version>0),
  created_by TEXT NOT NULL REFERENCES app_user(id),
  created_at INTEGER NOT NULL,
  CHECK((origin='IMPORT')=(import_batch_id IS NOT NULL AND batch_row IS NOT NULL)),
  CHECK((state='VOID_DUPLICATE')=(duplicate_of_id IS NOT NULL AND voided_by IS NOT NULL AND voided_at IS NOT NULL)),
  CHECK(duplicate_of_id IS NULL OR duplicate_of_id!=id)
);
CREATE INDEX finance_movement_position_date_idx ON finance_movement(position_id,operation_date,id);
CREATE INDEX finance_movement_batch_idx ON finance_movement(import_batch_id,batch_row);
CREATE INDEX finance_movement_near_match_idx ON finance_movement(position_id,operation_date,amount_cents);
CREATE UNIQUE INDEX finance_movement_batch_row_unique ON finance_movement(import_batch_id,batch_row) WHERE import_batch_id IS NOT NULL;

CREATE TRIGGER finance_movement_import_guard BEFORE INSERT ON finance_movement
WHEN NEW.import_batch_id IS NOT NULL AND (SELECT position_id FROM finance_import_batch WHERE id=NEW.import_batch_id) IS NOT NEW.position_id
BEGIN SELECT RAISE(ABORT,'invalid_movement_batch'); END;
CREATE TRIGGER finance_movement_insert_state BEFORE INSERT ON finance_movement
WHEN NEW.state!='ACTIVE' OR NEW.allocation_version!=0
BEGIN SELECT RAISE(ABORT,'invalid_movement_state'); END;
-- Immutable facts. Allowed changes: ACTIVE → VOID_DUPLICATE, clearing the review flag, version counters.
CREATE TRIGGER finance_movement_immutable BEFORE UPDATE ON finance_movement
WHEN NEW.position_id IS NOT OLD.position_id OR NEW.operation_date IS NOT OLD.operation_date
  OR NEW.value_date IS NOT OLD.value_date OR NEW.amount_cents IS NOT OLD.amount_cents OR NEW.origin IS NOT OLD.origin
  OR NEW.import_batch_id IS NOT OLD.import_batch_id OR NEW.batch_row IS NOT OLD.batch_row
  OR NEW.bank_reference IS NOT OLD.bank_reference OR NEW.fingerprint IS NOT OLD.fingerprint
  OR NEW.display_label IS NOT OLD.display_label OR NEW.auxiliary_balance_cents IS NOT OLD.auxiliary_balance_cents
  OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at
  OR (NEW.review_flag IS NOT OLD.review_flag AND NEW.review_flag IS NOT NULL)
  OR (OLD.state='VOID_DUPLICATE' AND (NEW.state!='VOID_DUPLICATE' OR NEW.duplicate_of_id IS NOT OLD.duplicate_of_id
    OR NEW.voided_by IS NOT OLD.voided_by OR NEW.voided_at IS NOT OLD.voided_at OR NEW.allocation_version!=OLD.allocation_version))
  OR NEW.allocation_version NOT IN (OLD.allocation_version,OLD.allocation_version+1)
BEGIN SELECT RAISE(ABORT,'movement_immutable'); END;
-- A duplicate is voided only against an ACTIVE movement of the same position and amount, and only
-- while it has no current allocations (reallocate first).
CREATE TRIGGER finance_movement_void_guard BEFORE UPDATE OF state ON finance_movement
WHEN NEW.state='VOID_DUPLICATE' AND OLD.state='ACTIVE' AND (
  NOT EXISTS(SELECT 1 FROM finance_movement k WHERE k.id=NEW.duplicate_of_id AND k.state='ACTIVE'
    AND k.position_id=OLD.position_id AND k.amount_cents=OLD.amount_cents) OR OLD.allocation_version!=NEW.allocation_version)
BEGIN SELECT RAISE(ABORT,'invalid_duplicate_void'); END;
CREATE TRIGGER finance_movement_no_delete BEFORE DELETE ON finance_movement
BEGIN SELECT RAISE(ABORT,'movement_immutable'); END;

CREATE TABLE finance_movement_description (
  movement_id TEXT PRIMARY KEY REFERENCES finance_movement(id) ON DELETE RESTRICT,
  original_text TEXT NOT NULL CHECK(length(original_text) BETWEEN 1 AND 500)
);
CREATE TRIGGER finance_movement_description_no_update BEFORE UPDATE ON finance_movement_description
BEGIN SELECT RAISE(ABORT,'movement_description_immutable'); END;
CREATE TRIGGER finance_movement_description_no_delete BEFORE DELETE ON finance_movement_description
BEGIN SELECT RAISE(ABORT,'movement_description_immutable'); END;
