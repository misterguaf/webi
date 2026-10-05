-- 3.5H finalization: every work incident records the deployment that created it (LOCAL / STAGING / PRODUCTION),
-- derived on the server from configuration (environment-policy.js deploymentEnvironment), never chosen by users.
-- Existing rows are LOCAL: until now Gestió has only run locally with synthetic data (DATA_MODE=SYNTHETIC_ONLY).
-- New rows always set it explicitly; the default exists only for those legacy rows.
ALTER TABLE work_incident ADD COLUMN environment TEXT NOT NULL DEFAULT 'LOCAL'
  CHECK(environment IN ('LOCAL','STAGING','PRODUCTION'));
CREATE INDEX work_incident_environment_idx ON work_incident(environment,status,created_at DESC);
-- Provenance is a fact: it never changes after creation.
CREATE TRIGGER work_incident_environment_immutable BEFORE UPDATE OF environment ON work_incident
WHEN NEW.environment IS NOT OLD.environment
BEGIN SELECT RAISE(ABORT,'work_incident_environment_immutable'); END;
