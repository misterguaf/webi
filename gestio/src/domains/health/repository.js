export async function hasValidGrant(db,{userId,participantId,purpose,now}) {
  return !!await db.prepare(`SELECT 1 FROM health_access_grant WHERE user_id=? AND participant_id=? AND purpose=?
    AND revoked_at IS NULL AND valid_from<=? AND expires_at>? LIMIT 1`).bind(userId,participantId,purpose,now,now).first();
}
export async function eligibleRecipient(db,{userId,participantId,now}) {
  return !!await db.prepare(`SELECT 1 FROM participant p JOIN user_role ur ON ur.user_id=?
    JOIN role_permission rp ON rp.role_code=ur.role_code AND rp.permission_code='health.record.read'
    JOIN user_permission_grant up ON up.user_id=ur.user_id AND up.permission_code='health.record.read'
    JOIN app_user u ON u.id=ur.user_id WHERE p.id=? AND p.status='ACTIVE' AND u.status='ACTIVE'
    AND (ur.section_id IS NULL OR ur.section_id=p.current_section_id)
    AND ur.revoked_at IS NULL AND ur.valid_from<=? AND (ur.expires_at IS NULL OR ur.expires_at>?)
    AND up.revoked_at IS NULL AND up.valid_from<=? AND (up.expires_at IS NULL OR up.expires_at>?) LIMIT 1`)
    .bind(userId,participantId,now,now,now,now).first();
}
export function grantStatement(db,{id,userId,participantId,purpose,validFrom,expiresAt,actorId,justification}) {
  return db.prepare(`INSERT INTO health_access_grant(id,user_id,participant_id,purpose,valid_from,expires_at,granted_by,justification)
    VALUES(?,?,?,?,?,?,?,?)`).bind(id,userId,participantId,purpose,validFrom,expiresAt,actorId,justification);
}
export async function activeGrant(db,id) {
  return db.prepare('SELECT id,user_id,participant_id FROM health_access_grant WHERE id=? AND revoked_at IS NULL').bind(id).first();
}
export function revokeStatement(db,id,now) {
  return db.prepare('UPDATE health_access_grant SET revoked_at=? WHERE id=? AND revoked_at IS NULL').bind(now,id);
}
