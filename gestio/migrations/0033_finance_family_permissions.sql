-- G.3: family grouping has its own authority, separate from managing fee obligations.
-- Borja explicitly authorised grants to current Secretary, Group Coordination and Treasury holders.
INSERT OR IGNORE INTO permission(code) VALUES ('finance.family.read'),('finance.family.manage');
INSERT OR IGNORE INTO role_permission(role_code,permission_code) VALUES
  ('SECRETARY','finance.family.read'),('SECRETARY','finance.family.manage'),
  ('GROUP_COORDINATOR','finance.family.read'),('GROUP_COORDINATOR','finance.family.manage'),
  ('TREASURY','finance.family.read'),('TREASURY','finance.family.manage');

INSERT INTO user_permission_grant(id,user_id,permission_code,valid_from,granted_by,justification)
SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||
  substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
  holder.user_id,holder.permission_code,CAST(strftime('%s','now') AS INTEGER)*1000,NULL,
  'Transició G.3: gestió familiar explícita'
FROM (SELECT DISTINCT ur.user_id,rp.permission_code FROM user_role ur
  JOIN role_permission rp ON rp.role_code=ur.role_code
  WHERE ur.role_code IN ('SECRETARY','GROUP_COORDINATOR','TREASURY')
    AND ur.section_id IS NULL AND ur.revoked_at IS NULL
    AND (ur.expires_at IS NULL OR ur.expires_at>CAST(strftime('%s','now') AS INTEGER)*1000)
    AND rp.permission_code IN ('finance.family.read','finance.family.manage')) holder
WHERE NOT EXISTS(SELECT 1 FROM user_permission_grant g WHERE g.user_id=holder.user_id
  AND g.permission_code=holder.permission_code AND g.revoked_at IS NULL);
