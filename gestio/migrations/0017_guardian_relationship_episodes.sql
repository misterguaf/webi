-- FASE 3.5E closure: a participant and a guardian may have several relationship episodes over time.
-- 0011 keyed participant_guardian by (participant_id, guardian_id), so an ended relationship could never
-- exist again for the same pair. SQLite cannot drop a primary key in place, so the table is rebuilt
-- under the same name with a surrogate id; every existing row is copied unchanged (nothing is deleted)
-- and keeps its columns, so existing queries and contracts keep working. Earlier migrations are untouched.
--
-- Invariants after this migration:
--   * at most one current (ended_at IS NULL) episode per participant+guardian pair;
--   * an ended episode is history: it cannot be updated, reopened or deleted (a new episode is created);
--   * no episode can be deleted; identity, pair, start and author of an episode never change.
-- No other table references participant_guardian, so the rebuild touches no foreign key.

CREATE TABLE participant_guardian_episode (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participant(id) ON DELETE RESTRICT,
  guardian_id TEXT NOT NULL REFERENCES guardian(id) ON DELETE RESTRICT,
  relationship TEXT NOT NULL CHECK(relationship IN ('PARENT','LEGAL_GUARDIAN','OTHER')),
  legal_representative INTEGER NOT NULL DEFAULT 0 CHECK(legal_representative IN (0,1)),
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  representation_basis TEXT CHECK(representation_basis IS NULL OR representation_basis IN ('COMUNICAT','ACREDITAT')),
  recorded_by TEXT REFERENCES app_user(id),
  provenance TEXT CHECK(provenance IS NULL OR provenance IN ('CRM_ANTERIOR','DOCUMENTACIO_FISICA','COMUNICACIO_FAMILIA','ALTRES')),
  updated_at INTEGER,
  created_by TEXT REFERENCES app_user(id),
  ended_by TEXT REFERENCES app_user(id),
  CHECK(ended_at IS NULL OR ended_at>=started_at),
  CHECK(ended_by IS NULL OR ended_at IS NOT NULL)
);

-- Existing rows become the first episode of their pair; recorded_by is the best known author.
INSERT INTO participant_guardian_episode(id,participant_id,guardian_id,relationship,legal_representative,started_at,ended_at,
  representation_basis,recorded_by,provenance,updated_at,created_by,ended_by)
SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-'||
  substr('89ab',1+(abs(random())%4),1)||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
  participant_id,guardian_id,relationship,legal_representative,started_at,ended_at,
  representation_basis,recorded_by,provenance,updated_at,recorded_by,NULL
FROM participant_guardian;

DROP TABLE participant_guardian;
ALTER TABLE participant_guardian_episode RENAME TO participant_guardian;

CREATE UNIQUE INDEX participant_guardian_current_unique ON participant_guardian(participant_id,guardian_id) WHERE ended_at IS NULL;
CREATE INDEX participant_guardian_guardian_idx ON participant_guardian(guardian_id,participant_id);
CREATE INDEX participant_guardian_participant_idx ON participant_guardian(participant_id,started_at);

-- A new episode cannot start before an earlier episode of the same pair ended.
CREATE TRIGGER participant_guardian_episode_order BEFORE INSERT ON participant_guardian
WHEN EXISTS(SELECT 1 FROM participant_guardian WHERE participant_id=NEW.participant_id AND guardian_id=NEW.guardian_id
  AND ended_at IS NOT NULL AND ended_at>NEW.started_at)
BEGIN SELECT RAISE(ABORT,'guardian_episode_overlap'); END;
-- Ended episodes are history; current episodes keep their identity, pair, start and author.
CREATE TRIGGER participant_guardian_history_immutable BEFORE UPDATE ON participant_guardian
WHEN OLD.ended_at IS NOT NULL OR NEW.id IS NOT OLD.id OR NEW.participant_id IS NOT OLD.participant_id
  OR NEW.guardian_id IS NOT OLD.guardian_id OR NEW.started_at IS NOT OLD.started_at OR NEW.created_by IS NOT OLD.created_by
BEGIN SELECT RAISE(ABORT,'guardian_relationship_history_immutable'); END;
CREATE TRIGGER participant_guardian_no_delete BEFORE DELETE ON participant_guardian
BEGIN SELECT RAISE(ABORT,'guardian_relationship_history_immutable'); END;
