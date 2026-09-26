-- Explicit, synthetic-only authorization provenance for new registrations.
-- Older registrations retain consent_version as historical legacy metadata;
-- NULL in the new columns means that the separate acknowledgements are unknown.
ALTER TABLE activity_registration ADD COLUMN participation_terms_version TEXT
  CHECK(participation_terms_version IS NULL OR length(participation_terms_version) BETWEEN 1 AND 80);
ALTER TABLE activity_registration ADD COLUMN participation_authorized_at INTEGER
  CHECK(participation_authorized_at IS NULL OR participation_authorized_at > 0);
ALTER TABLE activity_registration ADD COLUMN privacy_notice_version TEXT
  CHECK(privacy_notice_version IS NULL OR length(privacy_notice_version) BETWEEN 1 AND 80);
ALTER TABLE activity_registration ADD COLUMN privacy_notice_acknowledged_at INTEGER
  CHECK(privacy_notice_acknowledged_at IS NULL OR privacy_notice_acknowledged_at > 0);

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

-- A birth date is an auxiliary pending-intake discriminator, never a primary key.
-- Resolved registrations continue to clear it under the 0004 lifecycle guards.
DROP INDEX activity_registration_pending_unique;
CREATE UNIQUE INDEX activity_registration_pending_unique
  ON activity_registration(activity_id,match_key,COALESCE(submitted_section_id,''),COALESCE(submitted_birth_date,''))
  WHERE participant_id IS NULL AND status='NEEDS_PARTICIPANT_REVIEW';
