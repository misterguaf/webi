-- FASE 3A: local/synthetic activity intake. Previous migrations remain immutable.
CREATE TABLE activity (
  id TEXT PRIMARY KEY,
  public_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
  status TEXT NOT NULL CHECK(status IN ('DRAFT','PUBLISHED','CLOSED')),
  audience TEXT NOT NULL CHECK(audience IN ('SECTIONS','GENERAL')),
  location TEXT NOT NULL CHECK(length(location)<=160),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  registration_deadline INTEGER NOT NULL,
  price_cents INTEGER NOT NULL CHECK(price_cents BETWEEN 0 AND 1000000),
  currency TEXT NOT NULL DEFAULT 'EUR' CHECK(currency='EUR'),
  short_description TEXT NOT NULL DEFAULT '' CHECK(length(short_description)<=600),
  materials TEXT NOT NULL DEFAULT '' CHECK(length(materials)<=400),
  special_notice TEXT NOT NULL DEFAULT '' CHECK(length(special_notice)<=400),
  created_by TEXT NOT NULL REFERENCES app_user(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK(ends_at>starts_at),
  CHECK(registration_deadline<=starts_at)
);
CREATE INDEX activity_public_idx ON activity(status,registration_deadline,starts_at);
CREATE TRIGGER activity_status_transition BEFORE UPDATE OF status ON activity
WHEN NEW.status!=OLD.status AND NOT (
  (OLD.status='DRAFT' AND NEW.status='PUBLISHED') OR
  (OLD.status='PUBLISHED' AND NEW.status='CLOSED'))
BEGIN SELECT RAISE(ABORT,'invalid_activity_transition'); END;
CREATE TABLE activity_section (
  activity_id TEXT NOT NULL REFERENCES activity(id) ON DELETE RESTRICT,
  section_id TEXT NOT NULL REFERENCES section(id) ON DELETE RESTRICT,
  PRIMARY KEY(activity_id,section_id)
);
CREATE INDEX activity_section_lookup_idx ON activity_section(section_id,activity_id);
CREATE TABLE activity_transport_option (
  activity_id TEXT NOT NULL REFERENCES activity(id) ON DELETE RESTRICT,
  code TEXT NOT NULL CHECK(code IN ('GROUP','FAMILY')),
  price_adjustment_cents INTEGER NOT NULL DEFAULT 0 CHECK(price_adjustment_cents BETWEEN -1000000 AND 1000000),
  PRIMARY KEY(activity_id,code)
);
CREATE TABLE participant_contact (
  participant_id TEXT PRIMARY KEY REFERENCES participant(id) ON DELETE RESTRICT,
  notification_email TEXT NOT NULL CHECK(length(notification_email)<=254),
  verified_at INTEGER NOT NULL
);
CREATE TABLE delegated_permission (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_user(id),
  permission_code TEXT NOT NULL REFERENCES permission(code),
  section_id TEXT REFERENCES section(id),
  authorized_by TEXT NOT NULL REFERENCES app_user(id),
  provisioned_by TEXT NOT NULL REFERENCES app_user(id),
  authorization_reference TEXT NOT NULL CHECK(length(authorization_reference) BETWEEN 8 AND 100),
  granted_at INTEGER NOT NULL,
  expires_at INTEGER,
  ratification_status TEXT NOT NULL DEFAULT 'PENDING_RATIFICATION' CHECK(ratification_status IN ('PENDING_RATIFICATION','RATIFIED','REVOKED')),
  ratified_at INTEGER,
  ratified_by TEXT REFERENCES app_user(id),
  ratification_reference TEXT CHECK(ratification_reference IS NULL OR length(ratification_reference) BETWEEN 8 AND 100),
  revoked_at INTEGER,
  revoked_by TEXT REFERENCES app_user(id),
  CHECK(expires_at IS NULL OR expires_at>granted_at),
  CHECK((ratification_status='RATIFIED' AND ratified_at IS NOT NULL AND ratified_by IS NOT NULL AND ratification_reference IS NOT NULL)
    OR (ratification_status!='RATIFIED')),
  CHECK((ratification_status='REVOKED' AND revoked_at IS NOT NULL) OR (ratification_status!='REVOKED' AND revoked_at IS NULL))
);
CREATE INDEX delegated_permission_effective_idx ON delegated_permission(user_id,permission_code,section_id,ratification_status,expires_at);
CREATE UNIQUE INDEX delegated_permission_active_unique ON delegated_permission(user_id,permission_code,COALESCE(section_id,'')) WHERE revoked_at IS NULL;
CREATE TRIGGER delegated_permission_transition BEFORE UPDATE OF ratification_status ON delegated_permission
WHEN NOT ((OLD.ratification_status='PENDING_RATIFICATION' AND NEW.ratification_status IN ('RATIFIED','REVOKED')) OR
  (OLD.ratification_status='RATIFIED' AND NEW.ratification_status='REVOKED'))
BEGIN SELECT RAISE(ABORT,'invalid_delegation_transition'); END;
CREATE TABLE activity_registration (
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
  status TEXT NOT NULL CHECK(status IN ('NEEDS_PARTICIPANT_REVIEW','AWAITING_PAYMENT_REVIEW','CONFIRMED','REJECTED')),
  consent_version TEXT NOT NULL CHECK(length(consent_version) BETWEEN 1 AND 50),
  idempotency_key TEXT NOT NULL UNIQUE CHECK(length(idempotency_key) BETWEEN 16 AND 100),
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  reviewed_by TEXT REFERENCES app_user(id),
  reviewed_at INTEGER,
  CHECK((match_status IN ('CLEAR','RESOLVED') AND participant_id IS NOT NULL) OR
    (match_status IN ('AMBIGUOUS','NONE','REJECTED') AND participant_id IS NULL)),
  CHECK(status!='CONFIRMED' OR participant_id IS NOT NULL)
);
CREATE INDEX activity_registration_activity_idx ON activity_registration(activity_id,status,created_at);
CREATE UNIQUE INDEX activity_registration_member_unique ON activity_registration(activity_id,participant_id) WHERE participant_id IS NOT NULL AND status!='REJECTED';
CREATE UNIQUE INDEX activity_registration_pending_unique ON activity_registration(activity_id,match_key,COALESCE(submitted_section_id,'')) WHERE participant_id IS NULL AND status='NEEDS_PARTICIPANT_REVIEW';
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
CREATE TRIGGER activity_registration_transition BEFORE UPDATE OF status,match_status ON activity_registration
WHEN NOT (
  (OLD.status='NEEDS_PARTICIPANT_REVIEW' AND (
    (NEW.match_status='RESOLVED' AND NEW.status IN ('AWAITING_PAYMENT_REVIEW','CONFIRMED')) OR
    (NEW.match_status='REJECTED' AND NEW.status='REJECTED'))) OR
  (OLD.status='AWAITING_PAYMENT_REVIEW' AND NEW.status='CONFIRMED' AND NEW.match_status=OLD.match_status))
BEGIN SELECT RAISE(ABORT,'invalid_registration_transition'); END;
CREATE TABLE payment_evidence (
  id TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL UNIQUE REFERENCES activity_registration(id) ON DELETE RESTRICT,
  object_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 4194304),
  detected_mime TEXT NOT NULL CHECK(detected_mime IN ('application/pdf','image/png','image/jpeg','image/webp')),
  review_status TEXT NOT NULL CHECK(review_status IN ('PENDING_REVIEW','VERIFIED','ISSUE')),
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  reviewed_by TEXT REFERENCES app_user(id)
);
CREATE TRIGGER payment_review_transition BEFORE UPDATE OF review_status ON payment_evidence
WHEN NOT ((OLD.review_status='PENDING_REVIEW' AND NEW.review_status IN ('ISSUE','VERIFIED')) OR
  (OLD.review_status='ISSUE' AND NEW.review_status='VERIFIED'))
BEGIN SELECT RAISE(ABORT,'invalid_payment_transition'); END;
CREATE TABLE notification_outbox (
  id TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL REFERENCES activity_registration(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(kind IN ('RECEIVED','PENDING_PAYMENT','CONFIRMED','PAYMENT_ISSUE')),
  recipient_email TEXT NOT NULL CHECK(length(recipient_email)<=254),
  status TEXT NOT NULL CHECK(status IN ('PENDING','SENT','FAILED')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  last_error_code TEXT,
  UNIQUE(registration_id,kind)
);
CREATE INDEX notification_outbox_pending_idx ON notification_outbox(status,created_at);
CREATE TRIGGER notification_delivery_transition BEFORE UPDATE OF status ON notification_outbox
WHEN OLD.status='SENT' OR NEW.status NOT IN ('SENT','FAILED')
BEGIN SELECT RAISE(ABORT,'invalid_notification_transition'); END;
CREATE TABLE notification_capture (
  outbox_id TEXT PRIMARY KEY REFERENCES notification_outbox(id) ON DELETE RESTRICT,
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  captured_at INTEGER NOT NULL
);

INSERT INTO permission(code) VALUES
  ('activities.read'),('activities.manage'),('activities.general.manage'),
  ('activities.registration.review'),('finance.payment.verify'),
  ('auth.permission.authorize'),('auth.permission.provision'),('auth.permission.ratify');
