-- FASE 3.5F (last technical adjustment): payment incidence notices belong to the payment attempt.
-- Earlier migrations are unchanged.
--
-- notification_outbox was UNIQUE(registration_id,kind) (0003/0018), so a registration could only ever
-- send one PAYMENT_ISSUE notice. Since 0020 each attempt (payment_evidence) has its own incidence, so the
-- incidence notice is deduplicated per attempt: at most one PAYMENT_ISSUE notice per attempt, any number
-- of attempts per registration. Every other kind stays once per registration.
--
-- The inline UNIQUE cannot be dropped in place: notification_outbox is rebuilt under its own name with
-- every row copied unchanged, together with its only child notification_capture (RESTRICT reference).
-- Existing PAYMENT_ISSUE notices (one per registration, from the one-proof era) are linked to the
-- registration's flagged attempt, or to its first attempt when none is flagged.

CREATE TABLE notification_outbox_v21 (
  id TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL REFERENCES activity_registration(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(kind IN ('RECEIVED','PENDING_PAYMENT','CONFIRMED','PAYMENT_ISSUE','REJECTED','WITHDRAWN')),
  recipient_email TEXT NOT NULL CHECK(length(recipient_email)<=254),
  status TEXT NOT NULL CHECK(status IN ('PENDING','SENT','FAILED')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  last_error_code TEXT,
  -- The payment attempt an incidence notice is about (PAYMENT_ISSUE only).
  evidence_id TEXT REFERENCES payment_evidence(id) ON DELETE RESTRICT,
  CHECK(kind='PAYMENT_ISSUE' OR evidence_id IS NULL)
);
CREATE TABLE notification_capture_v21 (
  outbox_id TEXT PRIMARY KEY REFERENCES notification_outbox_v21(id) ON DELETE RESTRICT,
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  captured_at INTEGER NOT NULL
);

INSERT INTO notification_outbox_v21(id,registration_id,kind,recipient_email,status,attempt_count,created_at,sent_at,last_error_code,evidence_id)
SELECT o.id,o.registration_id,o.kind,o.recipient_email,o.status,o.attempt_count,o.created_at,o.sent_at,o.last_error_code,
  CASE WHEN o.kind='PAYMENT_ISSUE' THEN COALESCE(
    (SELECT e.id FROM payment_evidence e WHERE e.registration_id=o.registration_id AND e.review_status='ISSUE' ORDER BY e.created_at,e.id LIMIT 1),
    (SELECT e.id FROM payment_evidence e WHERE e.registration_id=o.registration_id ORDER BY e.created_at,e.id LIMIT 1)) END
FROM notification_outbox o;
INSERT INTO notification_capture_v21(outbox_id,recipient_email,subject,body,captured_at)
SELECT outbox_id,recipient_email,subject,body,captured_at FROM notification_capture;

DROP TABLE notification_capture;
DROP TABLE notification_outbox;
ALTER TABLE notification_outbox_v21 RENAME TO notification_outbox;
ALTER TABLE notification_capture_v21 RENAME TO notification_capture;

CREATE INDEX notification_outbox_pending_idx ON notification_outbox(status,created_at);
-- Once per registration and kind, except incidences…
CREATE UNIQUE INDEX notification_outbox_registration_kind_unique ON notification_outbox(registration_id,kind)
  WHERE kind!='PAYMENT_ISSUE';
-- …which are once per payment attempt.
CREATE UNIQUE INDEX notification_outbox_issue_attempt_unique ON notification_outbox(evidence_id)
  WHERE kind='PAYMENT_ISSUE';
CREATE TRIGGER notification_delivery_transition BEFORE UPDATE OF status ON notification_outbox
WHEN OLD.status='SENT' OR NEW.status NOT IN ('SENT','FAILED')
BEGIN SELECT RAISE(ABORT,'invalid_notification_transition'); END;
