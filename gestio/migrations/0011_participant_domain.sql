-- FASE 3.5 audit remediation A2: evolutive participant domain. Synthetic data only.
-- Earlier migrations are unchanged. participant.current_section_id remains the fast projection used
-- by authorisation; the triggers below keep the membership history consistent with it.
-- No health data and no household/family entity: sibling grouping for fees stays in
-- annual_fee_family_group (explicit, per round), and guardians are an N:M relation.

-- ---------------------------------------------------------------- section membership history
CREATE TABLE participant_section_membership (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participant(id) ON DELETE RESTRICT,
  section_id TEXT NOT NULL REFERENCES section(id) ON DELETE RESTRICT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  start_reason TEXT NOT NULL CHECK(start_reason IN ('BACKFILL','ENROLMENT','TRANSFER','REACTIVATION')),
  end_reason TEXT CHECK(end_reason IS NULL OR end_reason IN ('TRANSFER','DEACTIVATION')),
  CHECK((ended_at IS NULL AND end_reason IS NULL) OR
    (ended_at IS NOT NULL AND end_reason IS NOT NULL AND ended_at>=started_at))
);
CREATE UNIQUE INDEX participant_membership_open_unique ON participant_section_membership(participant_id) WHERE ended_at IS NULL;
CREATE INDEX participant_membership_history_idx ON participant_section_membership(participant_id,started_at);
CREATE INDEX participant_membership_section_idx ON participant_section_membership(section_id,ended_at);

-- Backfill: existing participants get one BACKFILL row in their current section (start unknown = migration time).
INSERT INTO participant_section_membership(id,participant_id,section_id,started_at,ended_at,start_reason,end_reason)
SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||
    substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
  id,current_section_id,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),
  CASE WHEN status='ACTIVE' THEN NULL ELSE CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) END,
  'BACKFILL',CASE WHEN status='ACTIVE' THEN NULL ELSE 'DEACTIVATION' END
FROM participant;

CREATE TRIGGER participant_membership_on_insert AFTER INSERT ON participant
BEGIN
  INSERT INTO participant_section_membership(id,participant_id,section_id,started_at,ended_at,start_reason,end_reason)
  VALUES(lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||
      substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
    NEW.id,NEW.current_section_id,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),
    CASE WHEN NEW.status='ACTIVE' THEN NULL ELSE CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) END,
    'ENROLMENT',CASE WHEN NEW.status='ACTIVE' THEN NULL ELSE 'DEACTIVATION' END);
END;

CREATE TRIGGER participant_membership_on_transfer AFTER UPDATE OF current_section_id ON participant
WHEN NEW.current_section_id IS NOT OLD.current_section_id
BEGIN
  UPDATE participant_section_membership SET ended_at=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),end_reason='TRANSFER'
    WHERE participant_id=NEW.id AND ended_at IS NULL;
  INSERT INTO participant_section_membership(id,participant_id,section_id,started_at,ended_at,start_reason,end_reason)
  VALUES(lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||
      substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
    NEW.id,NEW.current_section_id,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),
    CASE WHEN NEW.status='ACTIVE' THEN NULL ELSE CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) END,
    'TRANSFER',CASE WHEN NEW.status='ACTIVE' THEN NULL ELSE 'DEACTIVATION' END);
END;

CREATE TRIGGER participant_membership_on_status AFTER UPDATE OF status ON participant
WHEN NEW.status IS NOT OLD.status
BEGIN
  UPDATE participant_section_membership SET ended_at=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),end_reason='DEACTIVATION'
    WHERE participant_id=NEW.id AND ended_at IS NULL AND NEW.status='INACTIVE';
  INSERT INTO participant_section_membership(id,participant_id,section_id,started_at,start_reason)
  SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||
      substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
    NEW.id,NEW.current_section_id,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),'REACTIVATION'
  WHERE NEW.status='ACTIVE' AND NOT EXISTS(SELECT 1 FROM participant_section_membership
    WHERE participant_id=NEW.id AND ended_at IS NULL);
END;

-- History is append-only: rows are only ever closed, never rewritten or removed.
CREATE TRIGGER participant_membership_open_consistent BEFORE INSERT ON participant_section_membership
WHEN NEW.ended_at IS NULL AND NOT EXISTS(SELECT 1 FROM participant p
  WHERE p.id=NEW.participant_id AND p.current_section_id=NEW.section_id AND p.status='ACTIVE')
BEGIN SELECT RAISE(ABORT,'membership_projection_mismatch'); END;
CREATE TRIGGER participant_membership_close_only BEFORE UPDATE ON participant_section_membership
WHEN OLD.ended_at IS NOT NULL OR NEW.participant_id IS NOT OLD.participant_id OR NEW.section_id IS NOT OLD.section_id
  OR NEW.started_at IS NOT OLD.started_at OR NEW.start_reason IS NOT OLD.start_reason OR NEW.id IS NOT OLD.id
BEGIN SELECT RAISE(ABORT,'membership_history_immutable'); END;
CREATE TRIGGER participant_membership_no_delete BEFORE DELETE ON participant_section_membership
BEGIN SELECT RAISE(ABORT,'membership_history_immutable'); END;

-- ---------------------------------------------------------------- guardians (N:M)
CREATE TABLE guardian (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 120),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE participant_guardian (
  participant_id TEXT NOT NULL REFERENCES participant(id) ON DELETE RESTRICT,
  guardian_id TEXT NOT NULL REFERENCES guardian(id) ON DELETE RESTRICT,
  relationship TEXT NOT NULL CHECK(relationship IN ('PARENT','LEGAL_GUARDIAN','OTHER')),
  legal_representative INTEGER NOT NULL DEFAULT 0 CHECK(legal_representative IN (0,1)),
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  PRIMARY KEY(participant_id,guardian_id),
  CHECK(ended_at IS NULL OR ended_at>=started_at)
);
CREATE INDEX participant_guardian_guardian_idx ON participant_guardian(guardian_id,participant_id);

-- ---------------------------------------------------------------- contact points
-- Exactly one owner (participant or guardian). At most one current primary per owner and kind.
CREATE TABLE contact_point (
  id TEXT PRIMARY KEY,
  participant_id TEXT REFERENCES participant(id) ON DELETE RESTRICT,
  guardian_id TEXT REFERENCES guardian(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(kind IN ('EMAIL','PHONE')),
  value TEXT NOT NULL CHECK(length(value) BETWEEN 3 AND 254),
  purpose TEXT NOT NULL DEFAULT 'GENERAL' CHECK(purpose IN ('GENERAL','NOTIFICATIONS')),
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0,1)),
  verified_at INTEGER,
  created_at INTEGER NOT NULL,
  ended_at INTEGER,
  CHECK((participant_id IS NULL) != (guardian_id IS NULL)),
  CHECK(kind!='EMAIL' OR value LIKE '%_@_%._%'),
  CHECK(kind!='PHONE' OR (length(value) BETWEEN 6 AND 24 AND value NOT GLOB '*[^0-9+ ().-]*')),
  CHECK(ended_at IS NULL OR ended_at>=created_at)
);
CREATE UNIQUE INDEX contact_point_participant_primary ON contact_point(participant_id,kind,purpose)
  WHERE is_primary=1 AND ended_at IS NULL AND participant_id IS NOT NULL;
CREATE UNIQUE INDEX contact_point_guardian_primary ON contact_point(guardian_id,kind,purpose)
  WHERE is_primary=1 AND ended_at IS NULL AND guardian_id IS NOT NULL;
CREATE INDEX contact_point_participant_idx ON contact_point(participant_id,kind);
CREATE INDEX contact_point_guardian_idx ON contact_point(guardian_id,kind);

-- Legacy participant_contact (3A notification address) is DEPRECATED: backfilled and mirrored here.
INSERT INTO contact_point(id,participant_id,kind,value,purpose,is_primary,verified_at,created_at)
SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||
    substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
  participant_id,'EMAIL',notification_email,'NOTIFICATIONS',1,verified_at,verified_at
FROM participant_contact;
CREATE TRIGGER participant_contact_mirror_insert AFTER INSERT ON participant_contact
BEGIN
  INSERT INTO contact_point(id,participant_id,kind,value,purpose,is_primary,verified_at,created_at)
  VALUES(lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||
      substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
    NEW.participant_id,'EMAIL',NEW.notification_email,'NOTIFICATIONS',1,NEW.verified_at,NEW.verified_at);
END;
CREATE TRIGGER participant_contact_mirror_update AFTER UPDATE OF notification_email,verified_at ON participant_contact
BEGIN
  UPDATE contact_point SET value=NEW.notification_email,verified_at=NEW.verified_at
    WHERE participant_id=NEW.participant_id AND kind='EMAIL' AND purpose='NOTIFICATIONS' AND is_primary=1 AND ended_at IS NULL;
END;

-- ---------------------------------------------------------------- consents (append-only)
-- consent_code is an open, reviewed catalogue (DECISION REQUIRED for the final list and texts).
CREATE TABLE consent_record (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participant(id) ON DELETE RESTRICT,
  guardian_id TEXT REFERENCES guardian(id) ON DELETE RESTRICT,
  consent_code TEXT NOT NULL CHECK(length(consent_code) BETWEEN 3 AND 60 AND consent_code NOT GLOB '*[^A-Z0-9_]*'),
  document_version TEXT NOT NULL CHECK(length(document_version) BETWEEN 1 AND 60),
  decision TEXT NOT NULL CHECK(decision IN ('GRANTED','DENIED','WITHDRAWN')),
  decided_at INTEGER NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('PORTAL','PAPER','GESTIO','IMPORT')),
  recorded_by TEXT REFERENCES app_user(id),
  recorded_at INTEGER NOT NULL
);
CREATE INDEX consent_record_current_idx ON consent_record(participant_id,consent_code,decided_at);
CREATE TRIGGER consent_record_no_update BEFORE UPDATE ON consent_record
BEGIN SELECT RAISE(ABORT,'consent_history_immutable'); END;
CREATE TRIGGER consent_record_no_delete BEFORE DELETE ON consent_record
BEGIN SELECT RAISE(ABORT,'consent_history_immutable'); END;
-- Current decision = latest decided_at (ties: latest recorded_at, then id) per participant and consent.
CREATE VIEW participant_consent_current AS
SELECT c.participant_id,c.consent_code,c.document_version,c.decision,c.decided_at,c.guardian_id,c.source
FROM consent_record c WHERE NOT EXISTS(SELECT 1 FROM consent_record n
  WHERE n.participant_id=c.participant_id AND n.consent_code=c.consent_code AND
    (n.decided_at>c.decided_at OR (n.decided_at=c.decided_at AND
      (n.recorded_at>c.recorded_at OR (n.recorded_at=c.recorded_at AND n.id>c.id)))));
