PRAGMA foreign_keys = ON;

CREATE TABLE app_user (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 120),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','DISABLED','SECURITY_BLOCKED')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  disabled_at INTEGER,
  security_blocked_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0)
);
CREATE TABLE auth_identity (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  verified_email TEXT,
  last_seen_at INTEGER,
  UNIQUE(issuer, subject)
);
CREATE INDEX auth_identity_user_idx ON auth_identity(user_id);
CREATE TABLE app_session (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  absolute_expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  revoke_reason TEXT,
  CHECK(absolute_expires_at > created_at)
);
CREATE INDEX app_session_user_active_idx ON app_session(user_id, revoked_at, absolute_expires_at);
CREATE TABLE section (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE CHECK(code IN ('MANADA','TROPA','ESCOLTA','CLAN')),
  display_name TEXT NOT NULL
);
CREATE TABLE role (
  code TEXT PRIMARY KEY CHECK(code IN ('GROUP_COORDINATOR','SECTION_COORDINATOR','SECTION_DELEGATE','TREASURY','SECRETARY','CRM_MANAGER','TECH_ADMIN'))
);
CREATE TABLE permission (code TEXT PRIMARY KEY);
CREATE TABLE role_permission (
  role_code TEXT NOT NULL REFERENCES role(code),
  permission_code TEXT NOT NULL REFERENCES permission(code),
  PRIMARY KEY(role_code, permission_code)
);
CREATE TABLE user_role (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_user(id),
  role_code TEXT NOT NULL REFERENCES role(code),
  section_id TEXT REFERENCES section(id),
  valid_from INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER,
  granted_by TEXT REFERENCES app_user(id),
  justification TEXT NOT NULL CHECK(length(justification) BETWEEN 1 AND 300),
  CHECK(expires_at IS NULL OR expires_at > valid_from),
  CHECK((role_code IN ('SECTION_COORDINATOR','SECTION_DELEGATE') AND section_id IS NOT NULL) OR
        (role_code NOT IN ('SECTION_COORDINATOR','SECTION_DELEGATE') AND section_id IS NULL))
);
CREATE INDEX user_role_effective_idx ON user_role(user_id, revoked_at, valid_from, expires_at, section_id);
CREATE TABLE user_permission_grant (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_user(id),
  permission_code TEXT NOT NULL REFERENCES permission(code),
  valid_from INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER,
  granted_by TEXT REFERENCES app_user(id),
  justification TEXT NOT NULL CHECK(length(justification) BETWEEN 1 AND 300),
  CHECK(expires_at IS NULL OR expires_at > valid_from)
);
CREATE INDEX user_permission_effective_idx ON user_permission_grant(user_id, permission_code, revoked_at, valid_from, expires_at);
CREATE TABLE participant (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 120),
  current_section_id TEXT NOT NULL REFERENCES section(id),
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','INACTIVE'))
);
CREATE INDEX participant_section_idx ON participant(current_section_id, status, id);
CREATE TABLE health_access_grant (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_user(id),
  participant_id TEXT NOT NULL REFERENCES participant(id),
  purpose TEXT NOT NULL CHECK(length(purpose) BETWEEN 1 AND 100),
  valid_from INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  granted_by TEXT REFERENCES app_user(id),
  justification TEXT NOT NULL CHECK(length(justification) BETWEEN 1 AND 300),
  CHECK(expires_at > valid_from)
);
CREATE INDEX health_grant_effective_idx ON health_access_grant(user_id, participant_id, purpose, revoked_at, valid_from, expires_at);
CREATE TABLE security_event (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  actor_user_id TEXT REFERENCES app_user(id),
  subject_user_id TEXT REFERENCES app_user(id),
  event_type TEXT NOT NULL CHECK(event_type IN ('AUTH_SESSION_CREATED','AUTH_LOGOUT','AUTH_SESSION_REVOKED','USER_SECURITY_SUSPENDED','AUTHZ_ALLOW','AUTHZ_DENY')),
  resource_type TEXT,
  action TEXT,
  decision_reason TEXT,
  occurred_at INTEGER NOT NULL
);
CREATE INDEX security_event_actor_time_idx ON security_event(actor_user_id, occurred_at);
