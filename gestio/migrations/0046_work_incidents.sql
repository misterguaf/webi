-- 3.5H.3 Incidències i millores (docs/decisions/ADMIN_DECISIONS.md, H.3). An operational work item, distinct
-- from the raw audit (audit_event) and from security incidents (security_incident). No priority, no
-- attachments, no comments. Only minimal fields; a SYSTEM incident references its resource, never copies it.
CREATE TABLE work_incident (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('ERROR','IMPROVEMENT','ACCESS','DATA','OTHER')),
  origin TEXT NOT NULL CHECK(origin IN ('MANUAL','SYSTEM')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','IN_PROGRESS','RESOLVED')),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 3 AND 120),
  description TEXT CHECK(description IS NULL OR length(description) BETWEEN 1 AND 2000),
  module TEXT CHECK(module IS NULL OR module IN ('inici','activitat','activitats','inscripcions','quotes','tresoreria',
    'participants','incidencies','administracio','altres')),
  reporter_user_id TEXT REFERENCES app_user(id) ON DELETE RESTRICT,
  -- Deterministic key of a SYSTEM blocker (e.g. ADMISSION_MATCH_AMBIGUOUS:<request id>): one incident per blocker.
  system_key TEXT UNIQUE CHECK(system_key IS NULL OR length(system_key) BETWEEN 1 AND 120),
  resource_type TEXT CHECK(resource_type IS NULL OR resource_type IN ('admission_request')),
  resource_id TEXT CHECK(resource_id IS NULL OR length(resource_id)=36),
  resolution TEXT CHECK(resolution IS NULL OR length(resolution) BETWEEN 1 AND 280),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  resolved_at INTEGER,
  resolved_by TEXT REFERENCES app_user(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  CHECK((origin='MANUAL' AND reporter_user_id IS NOT NULL AND system_key IS NULL)
     OR (origin='SYSTEM' AND reporter_user_id IS NULL AND system_key IS NOT NULL)),
  CHECK((resource_type IS NULL)=(resource_id IS NULL)),
  CHECK((status='RESOLVED')=(resolved_at IS NOT NULL)),
  CHECK(status='RESOLVED' OR resolution IS NULL)
);
CREATE INDEX work_incident_status_idx ON work_incident(status,created_at DESC);
CREATE INDEX work_incident_reporter_idx ON work_incident(reporter_user_id,created_at DESC);
CREATE TRIGGER work_incident_insert_guard BEFORE INSERT ON work_incident
WHEN NEW.status!='OPEN' OR NEW.version!=1 OR NEW.started_at IS NOT NULL OR NEW.resolved_by IS NOT NULL
BEGIN SELECT RAISE(ABORT,'invalid_work_incident'); END;
-- Facts are immutable; only the workflow moves: OPEN → IN_PROGRESS → RESOLVED, OPEN → RESOLVED, RESOLVED → OPEN.
CREATE TRIGGER work_incident_transition BEFORE UPDATE ON work_incident
WHEN NEW.id IS NOT OLD.id OR NEW.type IS NOT OLD.type OR NEW.origin IS NOT OLD.origin OR NEW.title IS NOT OLD.title
  OR NEW.description IS NOT OLD.description OR NEW.module IS NOT OLD.module OR NEW.reporter_user_id IS NOT OLD.reporter_user_id
  OR NEW.system_key IS NOT OLD.system_key OR NEW.resource_type IS NOT OLD.resource_type OR NEW.resource_id IS NOT OLD.resource_id
  OR NEW.created_at IS NOT OLD.created_at
  OR NOT ((OLD.status='OPEN' AND NEW.status IN ('IN_PROGRESS','RESOLVED'))
       OR (OLD.status='IN_PROGRESS' AND NEW.status='RESOLVED')
       OR (OLD.status='RESOLVED' AND NEW.status='OPEN'))
BEGIN SELECT RAISE(ABORT,'invalid_work_incident_transition'); END;
CREATE TRIGGER work_incident_no_delete BEFORE DELETE ON work_incident
BEGIN SELECT RAISE(ABORT,'work_incident_immutable'); END;

-- Management capability (GLOBAL: incidents are not owned by a section). Secretaria and Coordinació general hold
-- it; TECH_ADMIN has only the ceiling, so it manages incidents only after an explicit, individual grant.
INSERT OR IGNORE INTO permission(code) VALUES ('admin.incidents.manage');
INSERT OR IGNORE INTO role_permission(role_code,permission_code) VALUES
  ('SECRETARY','admin.incidents.manage'),('GROUP_COORDINATOR','admin.incidents.manage'),('TECH_ADMIN','admin.incidents.manage');
INSERT INTO user_permission_grant(id,user_id,permission_code,valid_from,granted_by,justification)
SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||
  substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
  holders.user_id,'admin.incidents.manage',CAST(strftime('%s','now') AS INTEGER)*1000,NULL,'Transició 3.5H.3: incidències i millores'
FROM (SELECT DISTINCT ur.user_id FROM user_role ur
  WHERE ur.role_code IN ('SECRETARY','GROUP_COORDINATOR') AND ur.revoked_at IS NULL AND ur.section_id IS NULL
    AND (ur.expires_at IS NULL OR ur.expires_at>CAST(strftime('%s','now') AS INTEGER)*1000)) holders
WHERE NOT EXISTS(SELECT 1 FROM user_permission_grant existing WHERE existing.user_id=holders.user_id
  AND existing.permission_code='admin.incidents.manage' AND existing.revoked_at IS NULL AND existing.source_role_id IS NULL
  AND existing.section_id IS NULL);
