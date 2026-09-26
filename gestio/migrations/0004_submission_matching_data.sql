-- Portal family submissions: synthetic-only rollout; master records are never
-- updated from an intake. Birth dates on these known fixture IDs are test data.
ALTER TABLE participant ADD COLUMN birth_date TEXT
  CHECK(birth_date IS NULL OR (length(birth_date)=10 AND birth_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'));

ALTER TABLE activity_registration ADD COLUMN submitted_by_name TEXT NOT NULL DEFAULT ''
  CHECK(length(submitted_by_name)<=120);
ALTER TABLE activity_registration ADD COLUMN contact_phone TEXT
  CHECK(contact_phone IS NULL OR length(contact_phone)<=24);
ALTER TABLE activity_registration ADD COLUMN submitted_birth_date TEXT
  CHECK(submitted_birth_date IS NULL OR
    (length(submitted_birth_date)=10 AND submitted_birth_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'));

CREATE INDEX participant_matching_idx
  ON participant(current_section_id,status,display_name,birth_date);

-- Keep the temporary submitted date only while a human matching decision is
-- pending. The application must clear it atomically when matching/rejecting.
CREATE TRIGGER registration_birthdate_only_pending_insert
BEFORE INSERT ON activity_registration
WHEN NEW.submitted_birth_date IS NOT NULL AND NEW.status!='NEEDS_PARTICIPANT_REVIEW'
BEGIN SELECT RAISE(ABORT,'registration_birthdate_only_pending'); END;
CREATE TRIGGER registration_birthdate_only_pending_update
BEFORE UPDATE OF participant_id,status,submitted_birth_date ON activity_registration
WHEN NEW.submitted_birth_date IS NOT NULL AND
  (NEW.participant_id IS NOT NULL OR NEW.status!='NEEDS_PARTICIPANT_REVIEW')
BEGIN SELECT RAISE(ABORT,'registration_birthdate_only_pending'); END;

-- Deterministic dates for the five synthetic participants from seed.sql.
UPDATE participant SET birth_date='2017-06-12' WHERE id='00000000-0000-4000-8000-000000000501';
UPDATE participant SET birth_date='2013-05-18' WHERE id='00000000-0000-4000-8000-000000000502';
UPDATE participant SET birth_date='2012-11-03' WHERE id='00000000-0000-4000-8000-000000000503';
UPDATE participant SET birth_date='2009-04-26' WHERE id='00000000-0000-4000-8000-000000000504';
UPDATE participant SET birth_date='2007-08-09' WHERE id='00000000-0000-4000-8000-000000000505';
