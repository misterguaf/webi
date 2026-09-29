-- FASE 3.5D: optimistic concurrency for activities. Previous migrations remain immutable.
-- Every write (edit, publish, close, discard) compares and increments `version` inside its batch
-- (see src/concurrency.js). NOT NULL is what makes a stale compare-and-set abort the whole batch.
ALTER TABLE activity ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1);
