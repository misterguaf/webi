-- FASE 3.5E: guardian relationships with basis/provenance, an append-only representation history and
-- the administrative review queue (relevant changes, shared-guardian change requests, possible
-- duplicates). Earlier migrations are unchanged; all columns and tables here are additive. No health
-- data. Guardians and contacts (guardian, participant_guardian, contact_point) already exist (0011).

-- ---------------------------------------------------------------- relationship metadata (additive)
-- representation_basis is meaningful only when legal_representative=1 (enforced in the service, since
-- an ADD COLUMN check cannot reference another column). COMUNICAT = the family told us; ACREDITAT = a
-- document was seen (only Secretaria / general coordination may set it).
ALTER TABLE participant_guardian ADD COLUMN representation_basis TEXT
  CHECK(representation_basis IS NULL OR representation_basis IN ('COMUNICAT','ACREDITAT'));
ALTER TABLE participant_guardian ADD COLUMN recorded_by TEXT REFERENCES app_user(id);
ALTER TABLE participant_guardian ADD COLUMN provenance TEXT
  CHECK(provenance IS NULL OR provenance IN ('CRM_ANTERIOR','DOCUMENTACIO_FISICA','COMUNICACIO_FAMILIA','ALTRES'));
ALTER TABLE participant_guardian ADD COLUMN updated_at INTEGER;

-- ---------------------------------------------------------------- representation history (append-only)
CREATE TABLE participant_representation_event (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participant(id) ON DELETE RESTRICT,
  guardian_id TEXT NOT NULL REFERENCES guardian(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK(action IN ('SET_REPRESENTATIVE','CLEAR_REPRESENTATIVE','ACCREDIT','RELATIONSHIP_ENDED','BASIS_CHANGED')),
  basis TEXT CHECK(basis IS NULL OR basis IN ('COMUNICAT','ACREDITAT')),
  provenance TEXT CHECK(provenance IS NULL OR provenance IN ('CRM_ANTERIOR','DOCUMENTACIO_FISICA','COMUNICACIO_FAMILIA','ALTRES')),
  note TEXT CHECK(note IS NULL OR length(note)<=200),
  recorded_by TEXT NOT NULL REFERENCES app_user(id),
  recorded_at INTEGER NOT NULL
);
CREATE INDEX participant_representation_event_idx ON participant_representation_event(participant_id,recorded_at);
CREATE TRIGGER participant_representation_event_no_update BEFORE UPDATE ON participant_representation_event
BEGIN SELECT RAISE(ABORT,'representation_history_immutable'); END;
CREATE TRIGGER participant_representation_event_no_delete BEFORE DELETE ON participant_representation_event
BEGIN SELECT RAISE(ABORT,'representation_history_immutable'); END;

-- ---------------------------------------------------------------- administrative review queue
-- Secretaria (participants.review.manage) works this queue. A change request on shared guardian data
-- keeps the proposed values in payload_json so Secretaria can apply or reject it. Notes are short and
-- must not contain health data.
CREATE TABLE participant_review (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('REPRESENTATION_CHANGE','GUARDIAN_DATA_REQUEST','POSSIBLE_DUPLICATE_PARTICIPANT','POSSIBLE_DUPLICATE_GUARDIAN')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','ACKNOWLEDGED','INCIDENCE','RESOLVED','ESCALATED')),
  participant_id TEXT REFERENCES participant(id) ON DELETE RESTRICT,
  guardian_id TEXT REFERENCES guardian(id) ON DELETE RESTRICT,
  duplicate_of TEXT,
  detail TEXT CHECK(detail IS NULL OR length(detail)<=280),
  payload_json TEXT CHECK(payload_json IS NULL OR length(payload_json)<=1000),
  created_by TEXT NOT NULL REFERENCES app_user(id),
  created_at INTEGER NOT NULL,
  updated_by TEXT REFERENCES app_user(id),
  updated_at INTEGER,
  resolution_note TEXT CHECK(resolution_note IS NULL OR length(resolution_note)<=280)
);
CREATE INDEX participant_review_open_idx ON participant_review(status,created_at);
CREATE INDEX participant_review_participant_idx ON participant_review(participant_id,created_at);
