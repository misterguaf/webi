-- FASE 3B: annual fees, local synthetic data only. Earlier migrations are unchanged.
CREATE TABLE annual_fee_round (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE CHECK(length(code)=9),
  is_open INTEGER NOT NULL CHECK(is_open IN (0,1)),
  base_cents INTEGER NOT NULL CHECK(base_cents BETWEEN 1 AND 1000000),
  discount_from_ordinal INTEGER NOT NULL DEFAULT 3 CHECK(discount_from_ordinal=3),
  discount_percent INTEGER NOT NULL DEFAULT 50 CHECK(discount_percent=50),
  deadline_at INTEGER,
  account_holder TEXT NOT NULL CHECK(length(account_holder) BETWEEN 2 AND 120),
  iban TEXT NOT NULL CHECK(length(iban) BETWEEN 15 AND 34),
  concept_template TEXT NOT NULL CHECK(length(concept_template) BETWEEN 5 AND 120),
  created_by TEXT NOT NULL REFERENCES app_user(id),
  updated_by TEXT NOT NULL REFERENCES app_user(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0)
);
CREATE UNIQUE INDEX annual_fee_one_open_round ON annual_fee_round(is_open) WHERE is_open=1;
CREATE TABLE annual_fee_round_revision (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES annual_fee_round(id) ON DELETE RESTRICT,
  previous_base_cents INTEGER NOT NULL,
  new_base_cents INTEGER NOT NULL,
  previous_deadline_at INTEGER,
  new_deadline_at INTEGER,
  changed_by TEXT NOT NULL REFERENCES app_user(id),
  changed_at INTEGER NOT NULL
);
CREATE INDEX annual_fee_round_revision_idx ON annual_fee_round_revision(round_id,changed_at);

CREATE TABLE annual_fee_family_group (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES annual_fee_round(id) ON DELETE RESTRICT,
  reference TEXT NOT NULL CHECK(length(reference) BETWEEN 8 AND 80),
  created_by TEXT NOT NULL REFERENCES app_user(id),
  created_at INTEGER NOT NULL,
  UNIQUE(round_id,reference),
  UNIQUE(id,round_id)
);
CREATE TABLE annual_fee_family_member (
  group_id TEXT NOT NULL,
  round_id TEXT NOT NULL,
  participant_id TEXT NOT NULL REFERENCES participant(id) ON DELETE RESTRICT,
  sibling_ordinal INTEGER NOT NULL CHECK(sibling_ordinal BETWEEN 1 AND 20),
  assigned_by TEXT NOT NULL REFERENCES app_user(id),
  assigned_at INTEGER NOT NULL,
  PRIMARY KEY(group_id,participant_id),
  UNIQUE(round_id,participant_id),
  UNIQUE(group_id,sibling_ordinal),
  FOREIGN KEY(group_id,round_id) REFERENCES annual_fee_family_group(id,round_id) ON DELETE RESTRICT
);

CREATE TABLE annual_fee_obligation (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES annual_fee_round(id) ON DELETE RESTRICT,
  participant_id TEXT NOT NULL REFERENCES participant(id) ON DELETE RESTRICT,
  family_group_id TEXT REFERENCES annual_fee_family_group(id) ON DELETE RESTRICT,
  sibling_ordinal INTEGER NOT NULL CHECK(sibling_ordinal BETWEEN 1 AND 20),
  base_cents INTEGER NOT NULL CHECK(base_cents BETWEEN 1 AND 1000000),
  discount_cents INTEGER NOT NULL CHECK(discount_cents>=0 AND discount_cents<base_cents),
  amount_due_cents INTEGER NOT NULL CHECK(amount_due_cents BETWEEN 1 AND 1000000),
  override_by TEXT REFERENCES app_user(id),
  override_at INTEGER,
  created_by TEXT NOT NULL REFERENCES app_user(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(round_id,participant_id),
  CHECK((override_by IS NULL AND override_at IS NULL AND amount_due_cents=base_cents-discount_cents) OR
    (override_by IS NOT NULL AND override_at IS NOT NULL))
);
CREATE INDEX annual_fee_obligation_round_idx ON annual_fee_obligation(round_id,participant_id);
CREATE TABLE annual_fee_amount_revision (
  id TEXT PRIMARY KEY,
  obligation_id TEXT NOT NULL REFERENCES annual_fee_obligation(id) ON DELETE RESTRICT,
  previous_amount_cents INTEGER NOT NULL,
  new_amount_cents INTEGER NOT NULL,
  changed_by TEXT NOT NULL REFERENCES app_user(id),
  changed_at INTEGER NOT NULL,
  CHECK(previous_amount_cents>0 AND new_amount_cents>0)
);
CREATE INDEX annual_fee_amount_revision_idx ON annual_fee_amount_revision(obligation_id,changed_at);

CREATE TABLE annual_fee_payment (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES annual_fee_round(id) ON DELETE RESTRICT,
  receipt_email TEXT NOT NULL CHECK(length(receipt_email)<=254),
  submitted_by_name TEXT NOT NULL CHECK(length(submitted_by_name) BETWEEN 2 AND 120),
  contact_phone TEXT CHECK(contact_phone IS NULL OR length(contact_phone)<=24),
  declared_amount_cents INTEGER CHECK(declared_amount_cents IS NULL OR declared_amount_cents BETWEEN 1 AND 10000000),
  verified_amount_cents INTEGER CHECK(verified_amount_cents IS NULL OR verified_amount_cents BETWEEN 1 AND 10000000),
  review_status TEXT NOT NULL DEFAULT 'PENDING_REVIEW' CHECK(review_status IN ('PENDING_REVIEW','VERIFIED','ISSUE')),
  idempotency_key TEXT NOT NULL UNIQUE CHECK(length(idempotency_key) BETWEEN 16 AND 100),
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
  privacy_notice_version TEXT NOT NULL CHECK(length(privacy_notice_version) BETWEEN 1 AND 60),
  privacy_notice_acknowledged_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  reviewed_by TEXT REFERENCES app_user(id),
  reviewed_at INTEGER,
  CHECK(review_status!='VERIFIED' OR verified_amount_cents IS NOT NULL)
);
CREATE INDEX annual_fee_payment_round_idx ON annual_fee_payment(round_id,review_status,created_at);
CREATE TABLE annual_fee_submission_person (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES annual_fee_payment(id) ON DELETE RESTRICT,
  submitted_name TEXT NOT NULL CHECK(length(submitted_name) BETWEEN 2 AND 120),
  match_key TEXT NOT NULL CHECK(length(match_key) BETWEEN 2 AND 120),
  submitted_birth_date TEXT,
  section_id TEXT NOT NULL REFERENCES section(id),
  participant_id TEXT REFERENCES participant(id) ON DELETE RESTRICT,
  match_status TEXT NOT NULL CHECK(match_status IN ('CLEAR','AMBIGUOUS','NONE','RESOLVED','REJECTED')),
  reviewed_by TEXT REFERENCES app_user(id),
  reviewed_at INTEGER,
  CHECK((match_status IN ('CLEAR','RESOLVED') AND participant_id IS NOT NULL AND submitted_birth_date IS NULL) OR
    (match_status IN ('AMBIGUOUS','NONE') AND participant_id IS NULL AND submitted_birth_date IS NOT NULL) OR
    (match_status='REJECTED' AND participant_id IS NULL AND submitted_birth_date IS NULL))
);
CREATE UNIQUE INDEX annual_fee_payment_person_unique ON annual_fee_submission_person(payment_id,participant_id) WHERE participant_id IS NOT NULL;
CREATE INDEX annual_fee_person_review_idx ON annual_fee_submission_person(match_status,section_id,payment_id);
CREATE TABLE annual_fee_evidence (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL UNIQUE REFERENCES annual_fee_payment(id) ON DELETE RESTRICT,
  object_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 4194304),
  detected_mime TEXT NOT NULL CHECK(detected_mime IN ('application/pdf','image/png','image/jpeg','image/webp')),
  created_at INTEGER NOT NULL
);

CREATE TABLE annual_fee_allocation (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES annual_fee_payment(id) ON DELETE RESTRICT,
  obligation_id TEXT NOT NULL REFERENCES annual_fee_obligation(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 10000000),
  created_by TEXT NOT NULL REFERENCES app_user(id),
  created_at INTEGER NOT NULL,
  UNIQUE(payment_id,obligation_id)
);
CREATE INDEX annual_fee_allocation_obligation_idx ON annual_fee_allocation(obligation_id);
CREATE TABLE annual_fee_allocation_revision (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES annual_fee_payment(id) ON DELETE RESTRICT,
  obligation_id TEXT NOT NULL REFERENCES annual_fee_obligation(id) ON DELETE RESTRICT,
  previous_amount_cents INTEGER CHECK(previous_amount_cents IS NULL OR previous_amount_cents>0),
  new_amount_cents INTEGER CHECK(new_amount_cents IS NULL OR new_amount_cents>0),
  changed_by TEXT NOT NULL REFERENCES app_user(id),
  changed_at INTEGER NOT NULL,
  CHECK(previous_amount_cents IS NOT NULL OR new_amount_cents IS NOT NULL)
);
CREATE INDEX annual_fee_allocation_revision_idx ON annual_fee_allocation_revision(payment_id,changed_at);
CREATE TRIGGER annual_fee_allocation_guard BEFORE INSERT ON annual_fee_allocation
WHEN (SELECT p.review_status='VERIFIED' FROM annual_fee_payment p WHERE p.id=NEW.payment_id)
  OR (SELECT p.round_id!=o.round_id FROM annual_fee_payment p,annual_fee_obligation o
      WHERE p.id=NEW.payment_id AND o.id=NEW.obligation_id)
  OR (SELECT p.verified_amount_cents IS NULL OR
      (SELECT COALESCE(SUM(amount_cents),0) FROM annual_fee_allocation WHERE payment_id=NEW.payment_id)+NEW.amount_cents>p.verified_amount_cents
      FROM annual_fee_payment p WHERE p.id=NEW.payment_id)
BEGIN SELECT RAISE(ABORT,'invalid_fee_allocation'); END;
CREATE TRIGGER annual_fee_allocation_no_update BEFORE UPDATE ON annual_fee_allocation
BEGIN SELECT RAISE(ABORT,'allocation_revision_required'); END;
CREATE TRIGGER annual_fee_allocation_delete_guard BEFORE DELETE ON annual_fee_allocation
WHEN (SELECT review_status='VERIFIED' FROM annual_fee_payment WHERE id=OLD.payment_id)
BEGIN SELECT RAISE(ABORT,'allocation_revision_required'); END;
CREATE TRIGGER annual_fee_payment_amount_guard BEFORE UPDATE OF verified_amount_cents ON annual_fee_payment
WHEN NEW.verified_amount_cents IS NOT NULL AND NEW.verified_amount_cents<
  (SELECT COALESCE(SUM(amount_cents),0) FROM annual_fee_allocation WHERE payment_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'invalid_verified_amount'); END;
CREATE TRIGGER annual_fee_payment_review_guard BEFORE UPDATE OF review_status ON annual_fee_payment
WHEN NEW.review_status='VERIFIED' AND (NEW.verified_amount_cents IS NULL OR
  NOT EXISTS(SELECT 1 FROM annual_fee_allocation WHERE payment_id=NEW.id))
BEGIN SELECT RAISE(ABORT,'unallocated_fee_payment'); END;

CREATE TABLE annual_fee_installment_plan (
  id TEXT PRIMARY KEY,
  obligation_id TEXT NOT NULL UNIQUE REFERENCES annual_fee_obligation(id) ON DELETE RESTRICT,
  authorized_by TEXT NOT NULL REFERENCES app_user(id),
  authorized_at INTEGER NOT NULL
);
CREATE TABLE annual_fee_installment_part (
  plan_id TEXT NOT NULL REFERENCES annual_fee_installment_plan(id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK(ordinal IN (1,2)),
  planned_cents INTEGER NOT NULL CHECK(planned_cents>0),
  target_at INTEGER,
  PRIMARY KEY(plan_id,ordinal)
);
CREATE TABLE annual_fee_issue (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES annual_fee_round(id) ON DELETE RESTRICT,
  payment_id TEXT REFERENCES annual_fee_payment(id) ON DELETE RESTRICT,
  obligation_id TEXT REFERENCES annual_fee_obligation(id) ON DELETE RESTRICT,
  code TEXT NOT NULL CHECK(code IN ('BANK_NOT_FOUND','OVERPAYMENT','EVIDENCE_PROBLEM','UNIDENTIFIED_TRANSFER','ALLOCATION_UNCLEAR','DISCREPANCY')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','RESOLVED')),
  created_by TEXT NOT NULL REFERENCES app_user(id),
  created_at INTEGER NOT NULL,
  resolved_by TEXT REFERENCES app_user(id),
  resolved_at INTEGER,
  CHECK(payment_id IS NOT NULL OR obligation_id IS NOT NULL),
  CHECK((status='OPEN' AND resolved_by IS NULL AND resolved_at IS NULL) OR
    (status='RESOLVED' AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL))
);
CREATE INDEX annual_fee_issue_open_idx ON annual_fee_issue(round_id,status,obligation_id);
CREATE TABLE annual_fee_notification_outbox (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES annual_fee_payment(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(kind IN ('FEE_SUBMISSION_RECEIVED','FEE_PAYMENT_CONFIRMED','FEE_PAYMENT_ISSUE')),
  recipient_email TEXT NOT NULL CHECK(length(recipient_email)<=254),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SENT','FAILED')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 5),
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  last_error_code TEXT,
  UNIQUE(payment_id,kind)
);
CREATE INDEX annual_fee_notification_pending_idx ON annual_fee_notification_outbox(status,created_at);
CREATE TABLE annual_fee_notification_capture (
  outbox_id TEXT PRIMARY KEY REFERENCES annual_fee_notification_outbox(id) ON DELETE RESTRICT,
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  captured_at INTEGER NOT NULL
);

CREATE VIEW annual_fee_obligation_status AS
SELECT o.id,o.round_id,o.participant_id,o.family_group_id,o.sibling_ordinal,o.base_cents,o.discount_cents,
  o.amount_due_cents,o.override_by,o.created_at,p.display_name,p.current_section_id,
  COALESCE((SELECT SUM(a.amount_cents) FROM annual_fee_allocation a JOIN annual_fee_payment pay ON pay.id=a.payment_id
    WHERE a.obligation_id=o.id AND pay.verified_amount_cents IS NOT NULL),0) AS allocated_cents,
  CASE
    WHEN EXISTS(SELECT 1 FROM annual_fee_issue i WHERE i.obligation_id=o.id AND i.status='OPEN') THEN 'ISSUE'
    WHEN COALESCE((SELECT SUM(a.amount_cents) FROM annual_fee_allocation a JOIN annual_fee_payment pay ON pay.id=a.payment_id
      WHERE a.obligation_id=o.id AND pay.verified_amount_cents IS NOT NULL),0)>o.amount_due_cents THEN 'ISSUE'
    WHEN COALESCE((SELECT SUM(a.amount_cents) FROM annual_fee_allocation a JOIN annual_fee_payment pay ON pay.id=a.payment_id
      WHERE a.obligation_id=o.id AND pay.verified_amount_cents IS NOT NULL),0)=o.amount_due_cents THEN 'PAID'
    WHEN EXISTS(SELECT 1 FROM annual_fee_allocation a WHERE a.obligation_id=o.id) THEN 'PARTIAL'
    ELSE 'PENDING' END AS status
FROM annual_fee_obligation o JOIN participant p ON p.id=o.participant_id;

INSERT INTO permission(code) VALUES
  ('finance.fee.read'),('finance.fee.manage'),('finance.fee.payment.review'),
  ('finance.fee.installment.authorize'),('finance.fee.config.manage');
