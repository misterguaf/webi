-- FASE 3.5H.1 — access administration (docs/decisions/ADMIN_DECISIONS.md). Additive; earlier migrations unchanged.
--
-- The G.1A model stays: a role is a ceiling, an individual grant makes a permission effective inside it,
-- and delegations are temporary. H.1 adds provenance and ratification to roles and grants, scoped and
-- role-sourced grants, the session-revocation capability and the account-provisioning ceilings.

-- Provenance and ratification of role assignments. granted_by remains the provisioner.
ALTER TABLE user_role ADD COLUMN authorized_by TEXT REFERENCES app_user(id);
ALTER TABLE user_role ADD COLUMN ratification_status TEXT NOT NULL DEFAULT 'NOT_REQUIRED'
  CHECK(ratification_status IN ('NOT_REQUIRED','PENDING_RATIFICATION','RATIFIED'));
ALTER TABLE user_role ADD COLUMN ratified_at INTEGER;
ALTER TABLE user_role ADD COLUMN ratified_by TEXT REFERENCES app_user(id);
ALTER TABLE user_role ADD COLUMN ratification_reference TEXT
  CHECK(ratification_reference IS NULL OR length(ratification_reference) BETWEEN 8 AND 100);
ALTER TABLE user_role ADD COLUMN revoked_by TEXT REFERENCES app_user(id);

-- Individual grants: provenance, ratification, an optional section scope (never wider than the role that
-- holds the ceiling) and the role assignment a grant belongs to (role-sourced grants end with the role).
ALTER TABLE user_permission_grant ADD COLUMN authorized_by TEXT REFERENCES app_user(id);
ALTER TABLE user_permission_grant ADD COLUMN ratification_status TEXT NOT NULL DEFAULT 'NOT_REQUIRED'
  CHECK(ratification_status IN ('NOT_REQUIRED','PENDING_RATIFICATION','RATIFIED'));
ALTER TABLE user_permission_grant ADD COLUMN ratified_at INTEGER;
ALTER TABLE user_permission_grant ADD COLUMN ratified_by TEXT REFERENCES app_user(id);
ALTER TABLE user_permission_grant ADD COLUMN ratification_reference TEXT
  CHECK(ratification_reference IS NULL OR length(ratification_reference) BETWEEN 8 AND 100);
ALTER TABLE user_permission_grant ADD COLUMN revoked_by TEXT REFERENCES app_user(id);
ALTER TABLE user_permission_grant ADD COLUMN section_id TEXT REFERENCES section(id);
ALTER TABLE user_permission_grant ADD COLUMN source_role_id TEXT REFERENCES user_role(id);

-- One active grant per permission, origin and scope: a person holding two roles that include the same
-- permission keeps one role-sourced grant per role, so removing one role never removes the other's.
DROP INDEX user_permission_unrevoked_unique;
CREATE UNIQUE INDEX user_permission_active_unique ON user_permission_grant(user_id,permission_code,
  COALESCE(source_role_id,''),COALESCE(section_id,'')) WHERE revoked_at IS NULL;
CREATE INDEX user_permission_source_role_idx ON user_permission_grant(source_role_id);

-- A role-sourced grant belongs to a role of the same person; a section-scoped grant is never
-- wider than its own role.
CREATE TRIGGER user_permission_grant_source_guard BEFORE INSERT ON user_permission_grant
WHEN NEW.source_role_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM user_role r JOIN role_permission rp ON rp.role_code=r.role_code
    WHERE r.id=NEW.source_role_id AND r.user_id=NEW.user_id AND r.revoked_at IS NULL AND rp.permission_code=NEW.permission_code
    AND (NEW.section_id IS NULL OR r.section_id IS NULL OR r.section_id=NEW.section_id))
BEGIN SELECT RAISE(ABORT,'invalid_role_sourced_grant'); END;

-- Ratification: ratified by someone other than the beneficiary and the provisioner; only
-- PENDING_RATIFICATION → RATIFIED. Revocation uses revoked_at (status stays the history of the act).
CREATE TRIGGER user_role_ratification_guard BEFORE UPDATE OF ratification_status ON user_role
WHEN NOT (OLD.ratification_status='PENDING_RATIFICATION' AND NEW.ratification_status='RATIFIED')
  OR NEW.ratified_by IS NULL OR NEW.ratified_at IS NULL OR NEW.ratification_reference IS NULL
  OR NEW.ratified_by=OLD.user_id OR NEW.ratified_by IS OLD.granted_by OR OLD.revoked_at IS NOT NULL
BEGIN SELECT RAISE(ABORT,'invalid_ratification'); END;
CREATE TRIGGER user_permission_ratification_guard BEFORE UPDATE OF ratification_status ON user_permission_grant
WHEN NOT (OLD.ratification_status='PENDING_RATIFICATION' AND NEW.ratification_status='RATIFIED')
  OR NEW.ratified_by IS NULL OR NEW.ratified_at IS NULL OR NEW.ratification_reference IS NULL
  OR NEW.ratified_by=OLD.user_id OR NEW.ratified_by IS OLD.granted_by OR OLD.revoked_at IS NOT NULL
BEGIN SELECT RAISE(ABORT,'invalid_ratification'); END;

-- Session revocation of other people (own sessions need no permission).
INSERT OR IGNORE INTO permission(code) VALUES ('auth.session.revoke');

-- Account provisioning (closed decision): Secretaria and Coordinació general provision accounts. TECH_ADMIN
-- gets the user-administration ceiling only, so the capability exists solely through an explicit
-- individual grant (never by holding the role). Treasury gets none.
INSERT OR IGNORE INTO role_permission(role_code,permission_code) VALUES
  ('SECRETARY','auth.user.manage'),('SECRETARY','auth.role.manage'),('SECRETARY','auth.permission.manage'),
  ('GROUP_COORDINATOR','auth.session.revoke'),
  ('TECH_ADMIN','auth.user.manage'),('TECH_ADMIN','auth.role.manage'),('TECH_ADMIN','auth.permission.manage'),
  ('TECH_ADMIN','auth.session.revoke'),('TECH_ADMIN','auth.user.suspend');

-- Current Secretaria and Coordinació general holders receive the grants of the closed decision. TECH_ADMIN
-- holders receive nothing.
INSERT INTO user_permission_grant(id,user_id,permission_code,valid_from,granted_by,justification)
SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||
  substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
  holders.user_id,holders.permission_code,CAST(strftime('%s','now') AS INTEGER)*1000,NULL,
  'Transició 3.5H.1: administració d''accessos'
FROM (SELECT DISTINCT ur.user_id,rp.permission_code FROM user_role ur JOIN role_permission rp ON rp.role_code=ur.role_code
  WHERE ur.section_id IS NULL AND ur.revoked_at IS NULL
    AND (ur.expires_at IS NULL OR ur.expires_at>CAST(strftime('%s','now') AS INTEGER)*1000)
    AND ((ur.role_code='SECRETARY' AND rp.permission_code IN ('auth.user.manage','auth.role.manage','auth.permission.manage'))
      OR (ur.role_code='GROUP_COORDINATOR' AND rp.permission_code='auth.session.revoke'))) holders
WHERE NOT EXISTS(SELECT 1 FROM user_permission_grant existing WHERE existing.user_id=holders.user_id
  AND existing.permission_code=holders.permission_code AND existing.revoked_at IS NULL);
