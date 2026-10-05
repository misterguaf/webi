-- FASE 3.5H.2 — Noves altes (docs/decisions/ADMIN_DECISIONS.md, H.2). Additive; earlier migrations unchanged.
--
-- An admission request is the intake and provenance of someone joining the group, received from the existing
-- public form. It is never health data and never a participant: Participants stays the operational truth after
-- acceptance. Requests are never deleted; every state change is kept in admission_request_event.

CREATE TABLE admission_request (
  id TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('PUBLIC_FORM')),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK(status IN ('PENDING','IN_REVIEW','WAITLISTED','ACCEPTED','REJECTED','WITHDRAWN')),
  given_name TEXT NOT NULL CHECK(length(given_name) BETWEEN 1 AND 80),
  family_names TEXT NOT NULL CHECK(length(family_names) BETWEEN 1 AND 120),
  birth_date TEXT NOT NULL CHECK(date(birth_date)=birth_date),
  -- Section asked for in the public form: untrusted, informative and used for scope until confirmed.
  requested_section_id TEXT REFERENCES section(id) ON DELETE RESTRICT,
  -- Operational section confirmed internally; required before acceptance.
  section_id TEXT REFERENCES section(id) ON DELETE RESTRICT,
  -- Intake contact (moved to Participants on acceptance and cleared here: not kept twice).
  guardian_name TEXT CHECK(guardian_name IS NULL OR length(guardian_name) BETWEEN 1 AND 120),
  contact_phone TEXT CHECK(contact_phone IS NULL OR length(contact_phone) BETWEEN 6 AND 24),
  contact_email TEXT CHECK(contact_email IS NULL OR (length(contact_email) BETWEEN 6 AND 254 AND contact_email LIKE '%_@_%._%')),
  heard_from TEXT CHECK(heard_from IS NULL OR length(heard_from) <= 200),
  data_consent INTEGER NOT NULL CHECK(data_consent=1),
  contact_consent INTEGER NOT NULL CHECK(contact_consent=1),
  contact_transferred_at INTEGER,
  -- Matching state kept inside Admissions (no general incidents module yet).
  match_status TEXT CHECK(match_status IS NULL OR match_status IN ('NONE','CLEAR','AMBIGUOUS','RESOLVED_NEW','RESOLVED_EXISTING')),
  -- Existing participant confirmed by a manual resolution (internal; never leaves Gestió).
  match_participant_id TEXT REFERENCES participant(id) ON DELETE RESTRICT,
  participant_id TEXT REFERENCES participant(id) ON DELETE RESTRICT,
  rejection_category TEXT CHECK(rejection_category IS NULL OR rejection_category IN ('NO_PLACES','AGE_OR_SECTION','DUPLICATE','OTHER')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  updated_at INTEGER NOT NULL,
  CHECK((status='ACCEPTED')=(participant_id IS NOT NULL)),
  CHECK(status!='ACCEPTED' OR section_id IS NOT NULL),
  CHECK((status='REJECTED')=(rejection_category IS NOT NULL))
);
CREATE INDEX admission_request_status_idx ON admission_request(status,received_at);
CREATE INDEX admission_request_section_idx ON admission_request(COALESCE(section_id,requested_section_id),status);

CREATE TRIGGER admission_request_insert_guard BEFORE INSERT ON admission_request
WHEN NEW.status!='PENDING' OR NEW.version!=1 OR NEW.participant_id IS NOT NULL
BEGIN SELECT RAISE(ABORT,'invalid_admission'); END;
-- Workflow: PENDING → IN_REVIEW | WAITLISTED | REJECTED | WITHDRAWN; IN_REVIEW ⇄ WAITLISTED; IN_REVIEW and
-- WAITLISTED → ACCEPTED | REJECTED | WITHDRAWN. ACCEPTED, REJECTED and WITHDRAWN are final. Facts never change.
CREATE TRIGGER admission_request_transition BEFORE UPDATE ON admission_request
WHEN NEW.received_at IS NOT OLD.received_at OR NEW.source IS NOT OLD.source OR NEW.given_name IS NOT OLD.given_name
  OR NEW.family_names IS NOT OLD.family_names OR NEW.birth_date IS NOT OLD.birth_date
  OR NEW.requested_section_id IS NOT OLD.requested_section_id OR NEW.heard_from IS NOT OLD.heard_from
  OR OLD.status IN ('ACCEPTED','REJECTED','WITHDRAWN') AND (NEW.status IS NOT OLD.status OR NEW.participant_id IS NOT OLD.participant_id
    OR NEW.section_id IS NOT OLD.section_id OR NEW.rejection_category IS NOT OLD.rejection_category)
  OR (NEW.status IS NOT OLD.status AND NOT (
    (OLD.status='PENDING' AND NEW.status IN ('IN_REVIEW','WAITLISTED','REJECTED','WITHDRAWN'))
    OR (OLD.status='IN_REVIEW' AND NEW.status IN ('WAITLISTED','ACCEPTED','REJECTED','WITHDRAWN'))
    OR (OLD.status='WAITLISTED' AND NEW.status IN ('IN_REVIEW','ACCEPTED','REJECTED','WITHDRAWN'))))
  -- Contact values may only be cleared (on acceptance), never rewritten.
  OR (NEW.guardian_name IS NOT OLD.guardian_name AND NEW.guardian_name IS NOT NULL)
  OR (NEW.contact_phone IS NOT OLD.contact_phone AND NEW.contact_phone IS NOT NULL)
  OR (NEW.contact_email IS NOT OLD.contact_email AND NEW.contact_email IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'invalid_admission_transition'); END;
CREATE TRIGGER admission_request_no_delete BEFORE DELETE ON admission_request
BEGIN SELECT RAISE(ABORT,'admission_immutable'); END;

CREATE TABLE admission_request_event (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES admission_request(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK(action IN ('RECEIVED','REVIEW_STARTED','WAITLISTED','RETURNED_TO_REVIEW','SECTION_CONFIRMED',
    'MATCH_RESOLVED','ACCEPTED','REJECTED','WITHDRAWN')),
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_user_id TEXT REFERENCES app_user(id),
  section_id TEXT REFERENCES section(id),
  category TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX admission_request_event_request_idx ON admission_request_event(request_id,created_at);
CREATE TRIGGER admission_request_event_no_update BEFORE UPDATE ON admission_request_event
BEGIN SELECT RAISE(ABORT,'admission_event_immutable'); END;
CREATE TRIGGER admission_request_event_no_delete BEFORE DELETE ON admission_request_event
BEGIN SELECT RAISE(ABORT,'admission_event_immutable'); END;

-- Permissions (SCOPED by the request's section): read the inbox, manage the workflow, decide (accept/reject).
INSERT OR IGNORE INTO permission(code) VALUES ('admissions.read'),('admissions.manage'),('admissions.decide');
-- Secretaria and Coordinació general: full management (group-wide). Coordinació de secció: within its section,
-- including accept/reject (closed decision: Gestió records the decision; it does not govern the Council).
-- SECTION_DELEGATE: ceiling only, so the capabilities can be granted or delegated explicitly.
INSERT OR IGNORE INTO role_permission(role_code,permission_code) VALUES
  ('SECRETARY','admissions.read'),('SECRETARY','admissions.manage'),('SECRETARY','admissions.decide'),
  ('GROUP_COORDINATOR','admissions.read'),('GROUP_COORDINATOR','admissions.manage'),('GROUP_COORDINATOR','admissions.decide'),
  ('SECTION_COORDINATOR','admissions.read'),('SECTION_COORDINATOR','admissions.manage'),('SECTION_COORDINATOR','admissions.decide'),
  ('SECTION_DELEGATE','admissions.read'),('SECTION_DELEGATE','admissions.manage'),('SECTION_DELEGATE','admissions.decide');
-- Current Secretaria, Coordinació general and Coordinació de secció holders receive their grants.
INSERT INTO user_permission_grant(id,user_id,permission_code,valid_from,granted_by,justification)
SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||
  substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
  holders.user_id,holders.permission_code,CAST(strftime('%s','now') AS INTEGER)*1000,NULL,'Transició 3.5H.2: noves altes'
FROM (SELECT DISTINCT ur.user_id,rp.permission_code FROM user_role ur JOIN role_permission rp ON rp.role_code=ur.role_code
  WHERE ur.role_code IN ('SECRETARY','GROUP_COORDINATOR','SECTION_COORDINATOR') AND ur.revoked_at IS NULL
    AND (ur.expires_at IS NULL OR ur.expires_at>CAST(strftime('%s','now') AS INTEGER)*1000)
    AND rp.permission_code IN ('admissions.read','admissions.manage','admissions.decide')) holders
WHERE NOT EXISTS(SELECT 1 FROM user_permission_grant existing WHERE existing.user_id=holders.user_id
  AND existing.permission_code=holders.permission_code AND existing.revoked_at IS NULL AND existing.source_role_id IS NULL
  AND existing.section_id IS NULL);
