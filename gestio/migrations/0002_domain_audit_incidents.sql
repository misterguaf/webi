-- Incremental migration: keep 0001 and its applied history intact.
CREATE TABLE audit_event (
  id TEXT PRIMARY KEY,
  occurred_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  request_id TEXT NOT NULL CHECK(length(request_id) = 36),
  actor_user_id TEXT REFERENCES app_user(id) ON DELETE RESTRICT,
  session_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  result TEXT NOT NULL CHECK(result IN ('SUCCESS','ALLOW','DENY','ERROR')),
  reason_code TEXT CHECK(reason_code IS NULL OR length(reason_code) BETWEEN 1 AND 64),
  metadata_json TEXT CHECK(metadata_json IS NULL OR (json_valid(metadata_json) AND length(metadata_json) <= 256)),
  security_relevant INTEGER NOT NULL CHECK(security_relevant IN (0,1))
);
CREATE INDEX audit_event_time_idx ON audit_event(occurred_at DESC,id DESC);
CREATE INDEX audit_event_actor_time_idx ON audit_event(actor_user_id,occurred_at DESC);
CREATE INDEX audit_event_resource_time_idx ON audit_event(resource_type,resource_id,occurred_at DESC);
CREATE INDEX audit_event_request_idx ON audit_event(request_id,occurred_at DESC);

-- Preserve the Phase 1 local event history. No new writes go to security_event.
INSERT INTO audit_event(id,occurred_at,created_at,request_id,actor_user_id,action,resource_type,resource_id,result,reason_code,security_relevant)
SELECT id,occurred_at,occurred_at,request_id,actor_user_id,event_type,resource_type,subject_user_id,
  CASE WHEN event_type='AUTHZ_DENY' THEN 'DENY' WHEN event_type='AUTHZ_ALLOW' THEN 'ALLOW' ELSE 'SUCCESS' END,
  decision_reason,1 FROM security_event;

CREATE TABLE security_incident (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('OPEN','CONTAINED','CLOSED')),
  severity TEXT NOT NULL CHECK(severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  summary_code TEXT NOT NULL CHECK(summary_code IN ('TEST_SCENARIO','ACCOUNT_SUSPICION','UNEXPECTED_ACCESS','OTHER_TECHNICAL')),
  opened_at INTEGER NOT NULL,
  closed_at INTEGER,
  opened_by TEXT NOT NULL REFERENCES app_user(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK((status='CLOSED' AND closed_at IS NOT NULL) OR (status!='CLOSED' AND closed_at IS NULL))
);
CREATE INDEX security_incident_status_idx ON security_incident(status,opened_at DESC);
CREATE TABLE incident_resource (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES security_incident(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK(resource_type IN ('app_user','app_session','participant','audit_event')),
  resource_id TEXT NOT NULL CHECK(length(resource_id)=36),
  added_at INTEGER NOT NULL,
  UNIQUE(incident_id,resource_type,resource_id)
);
CREATE INDEX incident_resource_lookup_idx ON incident_resource(resource_type,resource_id);
CREATE TABLE incident_audit_hold (
  incident_id TEXT NOT NULL REFERENCES security_incident(id) ON DELETE RESTRICT,
  audit_event_id TEXT NOT NULL REFERENCES audit_event(id) ON DELETE CASCADE,
  held_at INTEGER NOT NULL,
  released_at INTEGER,
  PRIMARY KEY(incident_id,audit_event_id)
);
CREATE INDEX incident_audit_hold_event_idx ON incident_audit_hold(audit_event_id,released_at);
CREATE UNIQUE INDEX user_role_unrevoked_unique ON user_role(user_id,role_code,COALESCE(section_id,'')) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX user_permission_unrevoked_unique ON user_permission_grant(user_id,permission_code) WHERE revoked_at IS NULL;
CREATE TABLE retention_policy (
  category TEXT PRIMARY KEY CHECK(category IN ('AUDIT_EVENT','APP_SESSION')),
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  retention_ms INTEGER CHECK(retention_ms IS NULL OR retention_ms > 0),
  updated_at INTEGER NOT NULL,
  CHECK(enabled=0 OR retention_ms IS NOT NULL)
);
INSERT INTO retention_policy VALUES ('AUDIT_EVENT',0,NULL,1700000000000),('APP_SESSION',0,NULL,1700000000000);

-- No session can be newly issued for a disabled/blocked account, even if a caller bypasses the service.
CREATE TRIGGER session_user_must_be_active BEFORE INSERT ON app_session
WHEN NOT EXISTS(SELECT 1 FROM app_user WHERE id=NEW.user_id AND status='ACTIVE')
BEGIN SELECT RAISE(ABORT,'session requires active user'); END;

-- A direct account status transition also revokes sessions; the audited service remains responsible for its event.
CREATE TRIGGER revoke_session_on_account_block AFTER UPDATE OF status ON app_user
WHEN NEW.status!='ACTIVE' AND OLD.status!=NEW.status
BEGIN
  UPDATE app_session SET revoked_at=CAST(strftime('%s','now') AS INTEGER)*1000,
    revoke_reason='ACCOUNT_STATE' WHERE user_id=NEW.id AND revoked_at IS NULL;
END;

CREATE TRIGGER section_delegate_needs_expiry BEFORE INSERT ON user_role
WHEN NEW.role_code='SECTION_DELEGATE' AND NEW.expires_at IS NULL
BEGIN SELECT RAISE(ABORT,'section delegate requires expiry'); END;

-- A concurrent account block cannot leave a newly inserted grant on a blocked account.
CREATE TRIGGER role_recipient_must_be_active BEFORE INSERT ON user_role
WHEN NOT EXISTS(SELECT 1 FROM app_user WHERE id=NEW.user_id AND status='ACTIVE')
BEGIN SELECT RAISE(ABORT,'role requires active user'); END;
CREATE TRIGGER permission_recipient_must_be_active BEFORE INSERT ON user_permission_grant
WHEN NOT EXISTS(SELECT 1 FROM app_user WHERE id=NEW.user_id AND status='ACTIVE')
BEGIN SELECT RAISE(ABORT,'permission requires active user'); END;
CREATE TRIGGER health_recipient_must_be_active BEFORE INSERT ON health_access_grant
WHEN NOT EXISTS(SELECT 1 FROM app_user WHERE id=NEW.user_id AND status='ACTIVE')
BEGIN SELECT RAISE(ABORT,'health grant requires active user'); END;

INSERT INTO permission(code) VALUES ('audit.event.read'),('auth.role.manage'),('auth.permission.manage'),('health.grant.manage'),('auth.user.manage'),('security.incident.manage');
