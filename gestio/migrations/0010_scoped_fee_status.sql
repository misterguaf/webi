-- Scoped, read-only annual fee status. Financial permissions remain separate.
INSERT INTO permission(code) VALUES ('finance.fee.status.read');
INSERT INTO role_permission(role_code,permission_code)
SELECT code,'finance.fee.status.read' FROM role WHERE code='SECTION_COORDINATOR';

-- Existing section coordinators with effective participant access receive the
-- new basic read capability. No global or treasury role is broadened here.
INSERT INTO user_permission_grant(id,user_id,permission_code,valid_from,granted_by,justification)
SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
  users.user_id,'finance.fee.status.read',CAST(strftime('%s','now') AS INTEGER)*1000,NULL,
  'Transició 3.5C.1: lectura bàsica de quotes en la secció actual'
FROM (SELECT DISTINCT ur.user_id FROM user_role ur
  JOIN user_permission_grant up ON up.user_id=ur.user_id AND up.permission_code='participants.profile.read'
  WHERE ur.role_code='SECTION_COORDINATOR' AND ur.revoked_at IS NULL
    AND ur.valid_from<=CAST(strftime('%s','now') AS INTEGER)*1000
    AND (ur.expires_at IS NULL OR ur.expires_at>CAST(strftime('%s','now') AS INTEGER)*1000)
    AND up.revoked_at IS NULL AND up.valid_from<=CAST(strftime('%s','now') AS INTEGER)*1000
    AND (up.expires_at IS NULL OR up.expires_at>CAST(strftime('%s','now') AS INTEGER)*1000)) users
WHERE NOT EXISTS (SELECT 1 FROM user_permission_grant existing
  WHERE existing.user_id=users.user_id AND existing.permission_code='finance.fee.status.read'
    AND existing.revoked_at IS NULL);
