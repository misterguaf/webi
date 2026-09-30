-- FASE 3.5E: participant management permissions, optimistic concurrency and administrative metadata.
-- Earlier migrations are unchanged. Reference rows (permissions and the default role matrix) use
-- INSERT OR IGNORE so the synthetic seed stays compatible. No personal data.
--
-- CRM_MANAGER is NOT removed: its code is fixed by a CHECK constraint in historical migration 0001
-- and it appears in the audit trail. Secretaria absorbs its function here by gaining the participant
-- permissions below; the role is retired at the service layer (it can no longer be assigned through
-- the API). Existing CRM_MANAGER assignments keep granting nothing operational and are never
-- converted automatically.

-- ---------------------------------------------------------------- new permissions
INSERT OR IGNORE INTO permission(code) VALUES
  ('participants.profile.manage'),
  ('participants.contact.read'),
  ('participants.contact.manage'),
  ('participants.guardian.manage'),
  ('participants.representation.accredit'),
  ('participants.review.manage');

-- ---------------------------------------------------------------- default role matrix
-- SCOPED participant management for the sectional and global operational roles. SECRETARY absorbs the
-- former CRM manager function. SECTION_DELEGATE holds the delegable permissions in the matrix so an
-- individual delegation to a monitor can take effect; monitors get nothing without an explicit grant.
INSERT OR IGNORE INTO role_permission(role_code,permission_code) VALUES
  ('GROUP_COORDINATOR','participants.profile.manage'),
  ('GROUP_COORDINATOR','participants.contact.read'),
  ('GROUP_COORDINATOR','participants.contact.manage'),
  ('GROUP_COORDINATOR','participants.guardian.manage'),
  ('GROUP_COORDINATOR','participants.representation.accredit'),
  ('GROUP_COORDINATOR','participants.review.manage'),
  ('SECRETARY','participants.profile.manage'),
  ('SECRETARY','participants.contact.read'),
  ('SECRETARY','participants.contact.manage'),
  ('SECRETARY','participants.guardian.manage'),
  ('SECRETARY','participants.representation.accredit'),
  ('SECRETARY','participants.review.manage'),
  ('SECTION_COORDINATOR','participants.profile.manage'),
  ('SECTION_COORDINATOR','participants.contact.read'),
  ('SECTION_COORDINATOR','participants.contact.manage'),
  ('SECTION_COORDINATOR','participants.guardian.manage'),
  ('SECTION_DELEGATE','participants.profile.manage'),
  ('SECTION_DELEGATE','participants.contact.read'),
  ('SECTION_DELEGATE','participants.contact.manage'),
  ('SECTION_DELEGATE','participants.guardian.manage');

-- ---------------------------------------------------------------- participant administrative columns
-- version: optimistic concurrency (same compare-and-set pattern as activity, src/concurrency.js).
-- created_at/updated_at/created_by/provenance: administrative metadata for manual incorporation.
ALTER TABLE participant ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1);
ALTER TABLE participant ADD COLUMN created_at INTEGER;
ALTER TABLE participant ADD COLUMN updated_at INTEGER;
ALTER TABLE participant ADD COLUMN created_by TEXT REFERENCES app_user(id);
ALTER TABLE participant ADD COLUMN provenance TEXT
  CHECK(provenance IS NULL OR provenance IN ('CRM_ANTERIOR','DOCUMENTACIO_FISICA','COMUNICACIO_FAMILIA','ALTRES'));
ALTER TABLE participant ADD COLUMN provenance_note TEXT CHECK(provenance_note IS NULL OR length(provenance_note)<=200);

-- Backfill existing participants with the migration time so ordering and display stay coherent.
UPDATE participant SET created_at=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),
  updated_at=CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) WHERE created_at IS NULL;
