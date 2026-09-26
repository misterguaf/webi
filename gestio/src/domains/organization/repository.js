export async function effectiveSections(db, userId, permission, now) {
  const rows=await db.prepare(`SELECT ur.section_id FROM user_role ur
    JOIN role_permission rp ON rp.role_code=ur.role_code AND rp.permission_code=?
    JOIN user_permission_grant up ON up.user_id=ur.user_id AND up.permission_code=rp.permission_code
    WHERE ur.user_id=? AND ur.revoked_at IS NULL AND ur.valid_from<=? AND (ur.expires_at IS NULL OR ur.expires_at>?)
    AND up.revoked_at IS NULL AND up.valid_from<=? AND (up.expires_at IS NULL OR up.expires_at>?)
    UNION ALL
    SELECT dp.section_id FROM delegated_permission dp
    JOIN user_role ur ON ur.user_id=dp.user_id
    JOIN role_permission rp ON rp.role_code=ur.role_code AND rp.permission_code=dp.permission_code
    WHERE dp.user_id=? AND dp.permission_code=? AND dp.revoked_at IS NULL
    AND dp.ratification_status IN ('PENDING_RATIFICATION','RATIFIED')
    AND dp.granted_at<=? AND (dp.expires_at IS NULL OR dp.expires_at>?)
    AND ur.revoked_at IS NULL AND ur.valid_from<=? AND (ur.expires_at IS NULL OR ur.expires_at>?)
    AND ((dp.section_id IS NULL AND ur.section_id IS NULL) OR
      (dp.section_id IS NOT NULL AND (ur.section_id IS NULL OR ur.section_id=dp.section_id)))`)
    .bind(permission,userId,now,now,now,now,userId,permission,now,now,now,now).all();
  return rows.results.map(row=>row.section_id);
}
export async function currentRoles(db, userId, now) {
  return (await db.prepare(`SELECT ur.role_code,s.code AS section_code,ur.expires_at FROM user_role ur LEFT JOIN section s ON s.id=ur.section_id
    WHERE ur.user_id=? AND ur.revoked_at IS NULL AND ur.valid_from<=? AND (ur.expires_at IS NULL OR ur.expires_at>?) ORDER BY ur.role_code`)
    .bind(userId,now,now).all()).results;
}
export async function roleExists(db, roleCode, sectionId) {
  const role=await db.prepare('SELECT code FROM role WHERE code=?').bind(roleCode).first();
  if (!role) return false;
  if (sectionId===null) return true;
  return !!await db.prepare('SELECT id FROM section WHERE id=?').bind(sectionId).first();
}
export function assignRoleStatement(db, {id,userId,roleCode,sectionId,validFrom,expiresAt,actorId,justification}) {
  return db.prepare(`INSERT INTO user_role(id,user_id,role_code,section_id,valid_from,expires_at,granted_by,justification)
    VALUES(?,?,?,?,?,?,?,?)`).bind(id,userId,roleCode,sectionId,validFrom,expiresAt,actorId,justification);
}
export function revokeRoleStatement(db, id, userId, now) {
  return db.prepare('UPDATE user_role SET revoked_at=? WHERE id=? AND user_id=? AND revoked_at IS NULL').bind(now,id,userId);
}
export async function activeRole(db,id,userId) {
  return db.prepare('SELECT id,role_code,section_id FROM user_role WHERE id=? AND user_id=? AND revoked_at IS NULL').bind(id,userId).first();
}
export async function permissionExists(db,code) { return !!await db.prepare('SELECT 1 FROM permission WHERE code=?').bind(code).first(); }
export async function roleAllowsPermission(db,userId,permissionCode,now) {
  return !!await db.prepare(`SELECT 1 FROM user_role ur JOIN role_permission rp ON rp.role_code=ur.role_code
    WHERE ur.user_id=? AND rp.permission_code=? AND ur.revoked_at IS NULL AND ur.valid_from<=?
    AND (ur.expires_at IS NULL OR ur.expires_at>?) LIMIT 1`).bind(userId,permissionCode,now,now).first();
}
export function grantPermissionStatement(db,{id,userId,permissionCode,validFrom,expiresAt,actorId,justification}) {
  return db.prepare(`INSERT INTO user_permission_grant(id,user_id,permission_code,valid_from,expires_at,granted_by,justification)
    VALUES(?,?,?,?,?,?,?)`).bind(id,userId,permissionCode,validFrom,expiresAt,actorId,justification);
}
export function revokePermissionStatement(db,id,userId,now) {
  return db.prepare('UPDATE user_permission_grant SET revoked_at=? WHERE id=? AND user_id=? AND revoked_at IS NULL').bind(now,id,userId);
}
export async function activePermissionGrant(db,id,userId) {
  return db.prepare('SELECT id,permission_code FROM user_permission_grant WHERE id=? AND user_id=? AND revoked_at IS NULL').bind(id,userId).first();
}
