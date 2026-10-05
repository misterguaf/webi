import { FINANCIAL_DELEGATIONS } from '../../permissions.js';

// Effective scopes of a permission for a user (null = group-wide). Three sources:
//  1. role ceiling + explicit individual grant (a role alone never authorises). A grant may be
//     role-sourced (it ends with its role) and may carry a section scope, never wider than the role;
//  2. authorised delegation of a non-financial permission, inside the ceiling of a current role;
//  3. authorised, expiring delegation of a financial permission (TREASURY.md §25.3, 3.5G.1A): the
//     delegation itself is the authority, limited to that capability and its section, with no role
//     ceiling. An undated (legacy) financial delegation is never effective.
// 3.5H.1 (closed decision): an authorised role, grant or delegation is effective IMMEDIATELY. A delegation is
// authorised once its named authoriser confirmed it; it stays effective while pending ratification and
// after ratification, until it expires or is revoked. Ratification never gates authority.
const FINANCIAL=FINANCIAL_DELEGATIONS.map(code=>`'${code}'`).join(',');
const ROLE_GRANT=`SELECT rp.permission_code AS permission,COALESCE(up.section_id,ur.section_id) AS section_id FROM user_role ur
    JOIN role_permission rp ON rp.role_code=ur.role_code
    JOIN user_permission_grant up ON up.user_id=ur.user_id AND up.permission_code=rp.permission_code
      AND (up.source_role_id IS NULL OR up.source_role_id=ur.id)
      AND (up.section_id IS NULL OR ur.section_id IS NULL OR ur.section_id=up.section_id)
    WHERE ur.user_id=?1 AND ur.revoked_at IS NULL AND ur.valid_from<=?2 AND (ur.expires_at IS NULL OR ur.expires_at>?2)
    AND up.revoked_at IS NULL AND up.valid_from<=?2 AND (up.expires_at IS NULL OR up.expires_at>?2)`;
const AUTHORISED=`(dp.ratification_status='RATIFIED' OR (dp.ratification_status='PENDING_RATIFICATION'
    AND EXISTS(SELECT 1 FROM delegated_permission_confirmation c WHERE c.delegation_id=dp.id)))`;
const CEILING_DELEGATION=`SELECT dp.permission_code AS permission,dp.section_id FROM delegated_permission dp
    JOIN user_role ur ON ur.user_id=dp.user_id
    JOIN role_permission rp ON rp.role_code=ur.role_code AND rp.permission_code=dp.permission_code
    WHERE dp.user_id=?1 AND dp.permission_code NOT IN (${FINANCIAL}) AND dp.revoked_at IS NULL
    AND ${AUTHORISED} AND dp.granted_at<=?2 AND (dp.expires_at IS NULL OR dp.expires_at>?2)
    AND ur.revoked_at IS NULL AND ur.valid_from<=?2 AND (ur.expires_at IS NULL OR ur.expires_at>?2)
    AND ((dp.section_id IS NULL AND ur.section_id IS NULL) OR
      (dp.section_id IS NOT NULL AND (ur.section_id IS NULL OR ur.section_id=dp.section_id)))`;
const FINANCIAL_DELEGATION=`SELECT dp.permission_code AS permission,dp.section_id FROM delegated_permission dp
    WHERE dp.user_id=?1 AND dp.permission_code IN (${FINANCIAL}) AND dp.revoked_at IS NULL
    AND ${AUTHORISED} AND dp.granted_at<=?2 AND dp.expires_at IS NOT NULL AND dp.expires_at>?2`;
const EFFECTIVE=`${ROLE_GRANT} UNION ALL ${CEILING_DELEGATION} UNION ALL ${FINANCIAL_DELEGATION}`;

/** Scopes held through role + grant only (never through a delegation): origin authority. */
export async function roleGrantSections(db, userId, permission, now) {
  const rows=await db.prepare(`SELECT section_id FROM (${ROLE_GRANT}) WHERE permission=?3`).bind(userId,now,permission).all();
  return rows.results.map(row=>row.section_id);
}
export async function effectiveSections(db, userId, permission, now) {
  const rows=await db.prepare(`SELECT section_id FROM (${EFFECTIVE}) WHERE permission=?3`).bind(userId,now,permission).all();
  return rows.results.map(row=>row.section_id);
}
// Same effective-grant rules as effectiveSections, for every permission at once. Used only by
// the capabilities projection; operation checks still call authorize() per request.
export async function effectiveGrants(db, userId, now) {
  const rows=await db.prepare(EFFECTIVE).bind(userId,now).all();
  /** @type {Map<string, Array<string|null>>} */
  const grants=new Map();
  for (const row of rows.results) {
    if (!grants.has(row.permission)) grants.set(row.permission,[]);
    grants.get(row.permission).push(row.section_id);
  }
  return grants;
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
export function assignRoleStatement(db, {id,userId,roleCode,sectionId,validFrom,expiresAt,actorId,justification,authorizedBy=null,ratificationStatus='NOT_REQUIRED'}) {
  return db.prepare(`INSERT INTO user_role(id,user_id,role_code,section_id,valid_from,expires_at,granted_by,justification,authorized_by,ratification_status)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(id,userId,roleCode,sectionId,validFrom,expiresAt,actorId,justification,authorizedBy??actorId,ratificationStatus);
}
export function revokeRoleStatement(db, id, userId, now, actorId=null) {
  return db.prepare('UPDATE user_role SET revoked_at=?,revoked_by=? WHERE id=? AND user_id=? AND revoked_at IS NULL').bind(now,actorId,id,userId);
}
/** Grants that belong to a role assignment end with it. */
export function revokeRoleGrantsStatement(db, roleId, userId, now, actorId=null) {
  return db.prepare('UPDATE user_permission_grant SET revoked_at=?,revoked_by=? WHERE source_role_id=? AND user_id=? AND revoked_at IS NULL')
    .bind(now,actorId,roleId,userId);
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
export function grantPermissionStatement(db,{id,userId,permissionCode,validFrom,expiresAt,actorId,justification,authorizedBy=null,
  ratificationStatus='NOT_REQUIRED',sectionId=null,sourceRoleId=null}) {
  return db.prepare(`INSERT INTO user_permission_grant(id,user_id,permission_code,valid_from,expires_at,granted_by,justification,
    authorized_by,ratification_status,section_id,source_role_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id,userId,permissionCode,validFrom,expiresAt,actorId,justification,authorizedBy??actorId,ratificationStatus,sectionId,sourceRoleId);
}
export function revokePermissionStatement(db,id,userId,now,actorId=null) {
  return db.prepare('UPDATE user_permission_grant SET revoked_at=?,revoked_by=? WHERE id=? AND user_id=? AND revoked_at IS NULL').bind(now,actorId,id,userId);
}
export async function activePermissionGrant(db,id,userId) {
  return db.prepare('SELECT id,permission_code,source_role_id FROM user_permission_grant WHERE id=? AND user_id=? AND revoked_at IS NULL').bind(id,userId).first();
}
