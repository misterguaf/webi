-- FASE 3.5F: Inscripcions v1.0 (REGISTRATIONS.md v0.2). Earlier migrations are unchanged.
--
-- activity_registration.status and notification_outbox.kind are fixed by CHECK constraints (0003) that
-- cannot be altered in place, so both tables are rebuilt under their own names with every row copied
-- unchanged (same ids, same relations). payment_evidence and notification_capture reference them with
-- ON DELETE RESTRICT, which is enforced immediately even with deferred foreign keys; they are rebuilt
-- in the same step so no old parent is ever dropped while an old child still points at it. The new
-- tables reference each other by their temporary names; SQLite rewrites those references when the
-- tables are renamed. Triggers on other tables whose bodies name activity_registration are dropped
-- before the rename and recreated afterwards, unchanged.
--
-- New concepts:
--   * registration_section_id — operational and historical section of a registration (scope, counts,
--     payments, lists). Backfilled from the declared section (submitted_section_id, never changed).
--   * version — optimistic concurrency for review, correction, escalation and withdrawal.
--   * review_level / escalation — global review without disclosing anything to section reviewers.
--   * WITHDRAWN — the family stopped participating; distinct from REJECTED; no financial meaning.
--   * append-only history of section corrections.
--   * REJECTED / WITHDRAWN family notices.
--   * retention-ready evidence (object purge metadata; no job is enabled here).
--   * activities.registration.contact.read, and Secretaria's global registration review.
-- No personal data is added.

-- ---------------------------------------------------------------- triggers naming the rebuilt tables
DROP TRIGGER activity_terms_locked;
DROP TRIGGER activity_section_locked_insert;
DROP TRIGGER activity_section_locked_delete;
DROP TRIGGER activity_transport_locked_insert;
DROP TRIGGER activity_transport_locked_delete;

-- ---------------------------------------------------------------- new tables (temporary names)
CREATE TABLE activity_registration_v18 (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activity(id) ON DELETE RESTRICT,
  participant_id TEXT REFERENCES participant(id) ON DELETE RESTRICT,
  submitted_name TEXT NOT NULL CHECK(length(submitted_name) BETWEEN 2 AND 120),
  match_key TEXT NOT NULL CHECK(length(match_key) BETWEEN 2 AND 120),
  submitted_section_id TEXT REFERENCES section(id),
  receipt_email TEXT NOT NULL CHECK(length(receipt_email)<=254),
  transport_code TEXT CHECK(transport_code IN ('GROUP','FAMILY')),
  expected_amount_cents INTEGER NOT NULL CHECK(expected_amount_cents BETWEEN 0 AND 1000000),
  match_status TEXT NOT NULL CHECK(match_status IN ('CLEAR','AMBIGUOUS','NONE','RESOLVED','REJECTED')),
  status TEXT NOT NULL CHECK(status IN ('NEEDS_PARTICIPANT_REVIEW','AWAITING_PAYMENT_REVIEW','CONFIRMED','REJECTED','WITHDRAWN')),
  consent_version TEXT NOT NULL CHECK(length(consent_version) BETWEEN 1 AND 50),
  idempotency_key TEXT NOT NULL UNIQUE CHECK(length(idempotency_key) BETWEEN 16 AND 100),
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  reviewed_by TEXT REFERENCES app_user(id),
  reviewed_at INTEGER,
  submitted_by_name TEXT NOT NULL DEFAULT '' CHECK(length(submitted_by_name)<=120),
  contact_phone TEXT CHECK(contact_phone IS NULL OR length(contact_phone)<=24),
  submitted_birth_date TEXT CHECK(submitted_birth_date IS NULL OR
    (length(submitted_birth_date)=10 AND submitted_birth_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')),
  participation_terms_version TEXT CHECK(participation_terms_version IS NULL OR length(participation_terms_version) BETWEEN 1 AND 80),
  participation_authorized_at INTEGER CHECK(participation_authorized_at IS NULL OR participation_authorized_at > 0),
  privacy_notice_version TEXT CHECK(privacy_notice_version IS NULL OR length(privacy_notice_version) BETWEEN 1 AND 80),
  privacy_notice_acknowledged_at INTEGER CHECK(privacy_notice_acknowledged_at IS NULL OR privacy_notice_acknowledged_at > 0),
  -- 3.5F
  registration_section_id TEXT REFERENCES section(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
  review_level TEXT NOT NULL DEFAULT 'SECTION' CHECK(review_level IN ('SECTION','GLOBAL')),
  escalation_reason TEXT CHECK(escalation_reason IS NULL OR escalation_reason IN ('POSSIBLE_OTHER_SECTION','REVIEWER_REQUEST')),
  escalated_at INTEGER,
  escalated_by TEXT REFERENCES app_user(id),
  withdrawn_at INTEGER,
  withdrawn_by TEXT REFERENCES app_user(id),
  withdrawal_source TEXT CHECK(withdrawal_source IS NULL OR withdrawal_source IN ('FAMILY_COMMUNICATION','OTHER')),
  CHECK((match_status IN ('CLEAR','RESOLVED') AND participant_id IS NOT NULL) OR
    (match_status IN ('AMBIGUOUS','NONE','REJECTED') AND participant_id IS NULL)),
  CHECK(status!='CONFIRMED' OR participant_id IS NOT NULL),
  CHECK(review_level='SECTION' OR (escalation_reason IS NOT NULL AND escalated_at IS NOT NULL)),
  CHECK((status='WITHDRAWN')=(withdrawn_at IS NOT NULL AND withdrawn_by IS NOT NULL AND withdrawal_source IS NOT NULL)),
  CHECK(status='WITHDRAWN' OR (withdrawn_at IS NULL AND withdrawn_by IS NULL AND withdrawal_source IS NULL))
);
CREATE TABLE payment_evidence_v18 (
  id TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL UNIQUE REFERENCES activity_registration_v18(id) ON DELETE RESTRICT,
  object_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 4194304),
  detected_mime TEXT NOT NULL CHECK(detected_mime IN ('application/pdf','image/png','image/jpeg','image/webp')),
  review_status TEXT NOT NULL CHECK(review_status IN ('PENDING_REVIEW','VERIFIED','ISSUE')),
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  reviewed_by TEXT REFERENCES app_user(id),
  -- 3.5F retention-ready: the R2 object may be deleted by policy; this row and its history stay.
  object_purged_at INTEGER,
  object_purge_reason TEXT CHECK(object_purge_reason IS NULL OR object_purge_reason IN ('RETENTION_POLICY')),
  CHECK((object_purged_at IS NULL)=(object_purge_reason IS NULL)),
  CHECK(object_purged_at IS NULL OR review_status='VERIFIED')
);
CREATE TABLE notification_outbox_v18 (
  id TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL REFERENCES activity_registration_v18(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(kind IN ('RECEIVED','PENDING_PAYMENT','CONFIRMED','PAYMENT_ISSUE','REJECTED','WITHDRAWN')),
  recipient_email TEXT NOT NULL CHECK(length(recipient_email)<=254),
  status TEXT NOT NULL CHECK(status IN ('PENDING','SENT','FAILED')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  last_error_code TEXT,
  UNIQUE(registration_id,kind)
);
CREATE TABLE notification_capture_v18 (
  outbox_id TEXT PRIMARY KEY REFERENCES notification_outbox_v18(id) ON DELETE RESTRICT,
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  captured_at INTEGER NOT NULL
);

-- ---------------------------------------------------------------- copy (parents first), unchanged rows
INSERT INTO activity_registration_v18(id,activity_id,participant_id,submitted_name,match_key,submitted_section_id,receipt_email,
  transport_code,expected_amount_cents,match_status,status,consent_version,idempotency_key,payload_sha256,created_at,updated_at,
  reviewed_by,reviewed_at,submitted_by_name,contact_phone,submitted_birth_date,participation_terms_version,participation_authorized_at,
  privacy_notice_version,privacy_notice_acknowledged_at,registration_section_id)
SELECT id,activity_id,participant_id,submitted_name,match_key,submitted_section_id,receipt_email,
  transport_code,expected_amount_cents,match_status,status,consent_version,idempotency_key,payload_sha256,created_at,updated_at,
  reviewed_by,reviewed_at,submitted_by_name,contact_phone,submitted_birth_date,participation_terms_version,participation_authorized_at,
  privacy_notice_version,privacy_notice_acknowledged_at,submitted_section_id
FROM activity_registration;
INSERT INTO payment_evidence_v18(id,registration_id,object_key,sha256,size_bytes,detected_mime,review_status,created_at,reviewed_at,reviewed_by)
SELECT id,registration_id,object_key,sha256,size_bytes,detected_mime,review_status,created_at,reviewed_at,reviewed_by FROM payment_evidence;
INSERT INTO notification_outbox_v18(id,registration_id,kind,recipient_email,status,attempt_count,created_at,sent_at,last_error_code)
SELECT id,registration_id,kind,recipient_email,status,attempt_count,created_at,sent_at,last_error_code FROM notification_outbox;
INSERT INTO notification_capture_v18(outbox_id,recipient_email,subject,body,captured_at)
SELECT outbox_id,recipient_email,subject,body,captured_at FROM notification_capture;

-- ---------------------------------------------------------------- drop old tables (children first)
DROP TABLE notification_capture;
DROP TABLE notification_outbox;
DROP TABLE payment_evidence;
DROP TABLE activity_registration;

ALTER TABLE activity_registration_v18 RENAME TO activity_registration;
ALTER TABLE payment_evidence_v18 RENAME TO payment_evidence;
ALTER TABLE notification_outbox_v18 RENAME TO notification_outbox;
ALTER TABLE notification_capture_v18 RENAME TO notification_capture;

-- ---------------------------------------------------------------- indexes (0003/0005 names kept)
CREATE INDEX activity_registration_activity_idx ON activity_registration(activity_id,status,created_at);
-- A rejected or withdrawn registration no longer blocks a new request for the same participant.
CREATE UNIQUE INDEX activity_registration_member_unique ON activity_registration(activity_id,participant_id)
  WHERE participant_id IS NOT NULL AND status NOT IN ('REJECTED','WITHDRAWN');
CREATE UNIQUE INDEX activity_registration_pending_unique
  ON activity_registration(activity_id,match_key,COALESCE(submitted_section_id,''),COALESCE(submitted_birth_date,''))
  WHERE participant_id IS NULL AND status='NEEDS_PARTICIPANT_REVIEW';
CREATE INDEX activity_registration_section_idx ON activity_registration(registration_section_id,status,activity_id);
CREATE INDEX activity_registration_review_level_idx ON activity_registration(review_level,status);
CREATE INDEX notification_outbox_pending_idx ON notification_outbox(status,created_at);

-- ---------------------------------------------------------------- registration triggers
CREATE TRIGGER activity_registration_transition BEFORE UPDATE OF status,match_status ON activity_registration
WHEN NOT (
  (OLD.status='NEEDS_PARTICIPANT_REVIEW' AND (
    (NEW.match_status='RESOLVED' AND NEW.status IN ('AWAITING_PAYMENT_REVIEW','CONFIRMED')) OR
    (NEW.match_status='REJECTED' AND NEW.status='REJECTED') OR
    (NEW.status='WITHDRAWN' AND NEW.match_status=OLD.match_status))) OR
  (OLD.status='AWAITING_PAYMENT_REVIEW' AND NEW.status IN ('CONFIRMED','WITHDRAWN') AND NEW.match_status=OLD.match_status) OR
  (OLD.status='CONFIRMED' AND NEW.status='WITHDRAWN' AND NEW.match_status=OLD.match_status))
BEGIN SELECT RAISE(ABORT,'invalid_registration_transition'); END;
CREATE TRIGGER registration_birthdate_only_pending_insert
BEFORE INSERT ON activity_registration
WHEN NEW.submitted_birth_date IS NOT NULL AND NEW.status!='NEEDS_PARTICIPANT_REVIEW'
BEGIN SELECT RAISE(ABORT,'registration_birthdate_only_pending'); END;
CREATE TRIGGER registration_birthdate_only_pending_update
BEFORE UPDATE OF participant_id,status,submitted_birth_date ON activity_registration
WHEN NEW.submitted_birth_date IS NOT NULL AND
  (NEW.participant_id IS NOT NULL OR NEW.status!='NEEDS_PARTICIPANT_REVIEW')
BEGIN SELECT RAISE(ABORT,'registration_birthdate_only_pending'); END;
CREATE TRIGGER registration_authorizations_required_insert
BEFORE INSERT ON activity_registration
WHEN NEW.participation_terms_version IS NULL OR NEW.participation_authorized_at IS NULL OR
  NEW.privacy_notice_version IS NULL OR NEW.privacy_notice_acknowledged_at IS NULL
BEGIN SELECT RAISE(ABORT,'registration_authorizations_required'); END;
CREATE TRIGGER registration_authorizations_immutable_update
BEFORE UPDATE OF participation_terms_version,participation_authorized_at,
  privacy_notice_version,privacy_notice_acknowledged_at ON activity_registration
WHEN OLD.participation_terms_version IS NOT NULL AND
  (NEW.participation_terms_version IS NOT OLD.participation_terms_version OR
   NEW.participation_authorized_at IS NOT OLD.participation_authorized_at OR
   NEW.privacy_notice_version IS NOT OLD.privacy_notice_version OR
   NEW.privacy_notice_acknowledged_at IS NOT OLD.privacy_notice_acknowledged_at)
BEGIN SELECT RAISE(ABORT,'registration_authorizations_immutable'); END;
-- The declared section is what the family stated: never rewritten.
CREATE TRIGGER registration_declared_section_immutable BEFORE UPDATE OF submitted_section_id ON activity_registration
WHEN NEW.submitted_section_id IS NOT OLD.submitted_section_id
BEGIN SELECT RAISE(ABORT,'registration_declared_section_immutable'); END;
-- New registrations start with their registration section equal to the declared one: an explicit value
-- must match it, and an omitted value is filled from it right after the insert.
CREATE TRIGGER registration_section_on_insert BEFORE INSERT ON activity_registration
WHEN NEW.registration_section_id IS NOT NULL AND NEW.registration_section_id IS NOT NEW.submitted_section_id
BEGIN SELECT RAISE(ABORT,'registration_section_mismatch'); END;
CREATE TRIGGER registration_section_fill AFTER INSERT ON activity_registration
WHEN NEW.registration_section_id IS NULL AND NEW.submitted_section_id IS NOT NULL
BEGIN UPDATE activity_registration SET registration_section_id=NEW.submitted_section_id WHERE id=NEW.id; END;
-- The registration section changes only by correction while pending, never to NULL, and only to a
-- section the activity admits (any section for GENERAL activities). The initial fill is the exception.
CREATE TRIGGER registration_section_correction_guard BEFORE UPDATE OF registration_section_id ON activity_registration
WHEN NEW.registration_section_id IS NOT OLD.registration_section_id
  AND NOT (OLD.registration_section_id IS NULL AND NEW.registration_section_id IS NEW.submitted_section_id) AND (
  OLD.status!='NEEDS_PARTICIPANT_REVIEW' OR NEW.registration_section_id IS NULL OR
  ((SELECT audience FROM activity WHERE id=NEW.activity_id)='SECTIONS' AND
    NOT EXISTS(SELECT 1 FROM activity_section WHERE activity_id=NEW.activity_id AND section_id=NEW.registration_section_id)))
BEGIN SELECT RAISE(ABORT,'registration_section_locked'); END;
-- Withdrawal facts are written once.
CREATE TRIGGER registration_withdrawal_immutable BEFORE UPDATE OF withdrawn_at,withdrawn_by,withdrawal_source ON activity_registration
WHEN OLD.withdrawn_at IS NOT NULL AND (NEW.withdrawn_at IS NOT OLD.withdrawn_at OR
  NEW.withdrawn_by IS NOT OLD.withdrawn_by OR NEW.withdrawal_source IS NOT OLD.withdrawal_source)
BEGIN SELECT RAISE(ABORT,'registration_withdrawal_immutable'); END;
-- Escalation only applies to a pending registration.
CREATE TRIGGER registration_escalation_pending_only BEFORE UPDATE OF review_level ON activity_registration
WHEN NEW.review_level='GLOBAL' AND OLD.review_level='SECTION' AND OLD.status!='NEEDS_PARTICIPANT_REVIEW'
BEGIN SELECT RAISE(ABORT,'invalid_registration_transition'); END;

-- ---------------------------------------------------------------- evidence and outbox triggers
CREATE TRIGGER payment_review_transition BEFORE UPDATE OF review_status ON payment_evidence
WHEN NOT ((OLD.review_status='PENDING_REVIEW' AND NEW.review_status IN ('ISSUE','VERIFIED')) OR
  (OLD.review_status='ISSUE' AND NEW.review_status='VERIFIED'))
BEGIN SELECT RAISE(ABORT,'invalid_payment_transition'); END;
CREATE TRIGGER payment_evidence_purge_once BEFORE UPDATE OF object_purged_at,object_purge_reason ON payment_evidence
WHEN OLD.object_purged_at IS NOT NULL
BEGIN SELECT RAISE(ABORT,'payment_evidence_purged'); END;
CREATE TRIGGER notification_delivery_transition BEFORE UPDATE OF status ON notification_outbox
WHEN OLD.status='SENT' OR NEW.status NOT IN ('SENT','FAILED')
BEGIN SELECT RAISE(ABORT,'invalid_notification_transition'); END;

-- ---------------------------------------------------------------- activity locks (recreated unchanged)
CREATE TRIGGER activity_terms_locked BEFORE UPDATE ON activity
WHEN (OLD.status='CLOSED' OR EXISTS(SELECT 1 FROM activity_registration WHERE activity_id=OLD.id))
  AND (NEW.audience!=OLD.audience OR NEW.starts_at!=OLD.starts_at OR NEW.ends_at!=OLD.ends_at
    OR NEW.registration_deadline!=OLD.registration_deadline OR NEW.price_cents!=OLD.price_cents)
BEGIN SELECT RAISE(ABORT,'activity_terms_locked'); END;
CREATE TRIGGER activity_section_locked_insert BEFORE INSERT ON activity_section
WHEN EXISTS(SELECT 1 FROM activity_registration WHERE activity_id=NEW.activity_id)
BEGIN SELECT RAISE(ABORT,'activity_sections_locked'); END;
CREATE TRIGGER activity_section_locked_delete BEFORE DELETE ON activity_section
WHEN EXISTS(SELECT 1 FROM activity_registration WHERE activity_id=OLD.activity_id)
BEGIN SELECT RAISE(ABORT,'activity_sections_locked'); END;
CREATE TRIGGER activity_transport_locked_insert BEFORE INSERT ON activity_transport_option
WHEN EXISTS(SELECT 1 FROM activity_registration WHERE activity_id=NEW.activity_id)
BEGIN SELECT RAISE(ABORT,'activity_transport_locked'); END;
CREATE TRIGGER activity_transport_locked_delete BEFORE DELETE ON activity_transport_option
WHEN EXISTS(SELECT 1 FROM activity_registration WHERE activity_id=OLD.activity_id)
BEGIN SELECT RAISE(ABORT,'activity_transport_locked'); END;

-- ---------------------------------------------------------------- section correction history
CREATE TABLE activity_registration_section_change (
  id TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL REFERENCES activity_registration(id) ON DELETE RESTRICT,
  from_section_id TEXT REFERENCES section(id),
  to_section_id TEXT NOT NULL REFERENCES section(id),
  reason TEXT NOT NULL CHECK(reason IN ('CORRECTION')),
  changed_by TEXT NOT NULL REFERENCES app_user(id),
  changed_at INTEGER NOT NULL,
  CHECK(from_section_id IS NULL OR from_section_id!=to_section_id)
);
CREATE INDEX activity_registration_section_change_idx ON activity_registration_section_change(registration_id,changed_at);
CREATE TRIGGER activity_registration_section_change_no_update BEFORE UPDATE ON activity_registration_section_change
BEGIN SELECT RAISE(ABORT,'registration_section_history_immutable'); END;
CREATE TRIGGER activity_registration_section_change_no_delete BEFORE DELETE ON activity_registration_section_change
BEGIN SELECT RAISE(ABORT,'registration_section_history_immutable'); END;

-- ---------------------------------------------------------------- permissions and default matrix
INSERT OR IGNORE INTO permission(code) VALUES ('activities.registration.contact.read');
-- Secretaria performs the global review (escalations, section corrections) in the activity tab:
-- read, review and the submitter contact, group-wide. Never activities.manage.
INSERT OR IGNORE INTO role_permission(role_code,permission_code) VALUES
  ('GROUP_COORDINATOR','activities.registration.contact.read'),
  ('SECRETARY','activities.registration.contact.read'),
  ('SECTION_COORDINATOR','activities.registration.contact.read'),
  ('SECTION_DELEGATE','activities.registration.contact.read'),
  ('SECRETARY','activities.read'),
  ('SECRETARY','activities.registration.review');
