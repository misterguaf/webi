export async function syntheticIdentities(db,issuer) {
  return (await db.prepare(`SELECT ai.subject,u.display_name FROM auth_identity ai JOIN app_user u ON u.id=ai.user_id
    WHERE ai.issuer=? AND ai.revoked_at IS NULL AND u.status='ACTIVE' ORDER BY ai.subject`).bind(issuer).all()).results;
}
export async function findIdentityUser(db,issuer,subject) {
  return db.prepare(`SELECT u.id,u.display_name,u.status FROM auth_identity ai JOIN app_user u ON u.id=ai.user_id
    WHERE ai.issuer=? AND ai.subject=? AND ai.revoked_at IS NULL AND u.status='ACTIVE'`).bind(issuer,subject).first();
}
export async function markIdentitySeen(db,{issuer,subject,email,now}) {
  return db.prepare('UPDATE auth_identity SET verified_email=?,last_seen_at=? WHERE issuer=? AND subject=? AND revoked_at IS NULL').bind(email,now,issuer,subject).run();
}
export async function getUser(db,id) {return db.prepare('SELECT id,status,version FROM app_user WHERE id=?').bind(id).first();}
export async function findSession(db,tokenHash,now,idleMs) {
  return db.prepare(`SELECT s.id AS session_id,s.user_id,s.created_at,s.last_seen_at,s.absolute_expires_at,u.display_name,u.status
    FROM app_session s JOIN app_user u ON u.id=s.user_id WHERE s.token_hash=? AND s.revoked_at IS NULL
    AND s.absolute_expires_at>? AND s.last_seen_at>? AND u.status='ACTIVE'`)
    .bind(tokenHash,now,now-idleMs).first();
}
export async function touchSession(db,id,now,idleMs) {
  return db.prepare('UPDATE app_session SET last_seen_at=? WHERE id=? AND revoked_at IS NULL AND absolute_expires_at>? AND last_seen_at>?')
    .bind(now,id,now,now-idleMs).run();
}
export async function sessionActive(db,context,now,idleMs) {
  return !!await db.prepare(`SELECT 1 FROM app_session s JOIN app_user u ON u.id=s.user_id
    WHERE s.id=? AND s.user_id=? AND s.revoked_at IS NULL AND s.absolute_expires_at>? AND s.last_seen_at>?
    AND u.status='ACTIVE' LIMIT 1`).bind(context.sessionId,context.userId,now,now-idleMs).first();
}
export function createSessionStatement(db,{id,userId,tokenHash,now,absoluteMs}) {
  return db.prepare(`INSERT INTO app_session(id,user_id,token_hash,created_at,last_seen_at,absolute_expires_at)
    VALUES(?,?,?,?,?,?)`).bind(id,userId,tokenHash,now,now,now+absoluteMs);
}
export async function ownSessions(db,userId,now) {
  return (await db.prepare(`SELECT id,created_at,last_seen_at,absolute_expires_at FROM app_session
    WHERE user_id=? AND revoked_at IS NULL AND absolute_expires_at>? ORDER BY created_at DESC LIMIT 20`)
    .bind(userId,now).all()).results;
}
export async function ownedSession(db,id,userId) {
  return db.prepare('SELECT id FROM app_session WHERE id=? AND user_id=? AND revoked_at IS NULL').bind(id,userId).first();
}
export function revokeSessionStatement(db,id,userId,now,reason) {
  return db.prepare('UPDATE app_session SET revoked_at=?,revoke_reason=? WHERE id=? AND user_id=? AND revoked_at IS NULL').bind(now,reason,id,userId);
}
export function revokeAllStatements(db,userId,now,reason) {
  return db.prepare('UPDATE app_session SET revoked_at=?,revoke_reason=? WHERE user_id=? AND revoked_at IS NULL').bind(now,reason,userId);
}
export function cleanupSessionsStatement(db,cutoff) {
  return db.prepare(`DELETE FROM app_session WHERE
    ((revoked_at IS NOT NULL AND revoked_at<?) OR absolute_expires_at<?)
    AND NOT EXISTS(SELECT 1 FROM incident_resource ir JOIN security_incident i ON i.id=ir.incident_id
      WHERE ir.resource_type='app_session' AND ir.resource_id=app_session.id AND i.status!='CLOSED')`).bind(cutoff,cutoff);
}

// ---- Identity provisioning (invitation by verified e-mail, bound on first Access login) ----
export async function identityBySubject(db,issuer,subject) {
  return db.prepare('SELECT id,user_id,revoked_at FROM auth_identity WHERE issuer=? AND subject=?').bind(issuer,subject).first();
}
export async function openInvitation(db,{issuer,email,now}) {
  return db.prepare(`SELECT i.id,i.user_id FROM auth_identity_invitation i JOIN app_user u ON u.id=i.user_id
    WHERE i.issuer=? AND i.email=? AND i.consumed_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>? AND u.status='ACTIVE'`)
    .bind(issuer,email,now).first();
}
// One atomic batch (D1 serialises batches): insert the identity only while the invitation is still
// open, then consume the invitation only if that identity now exists.
export function claimInvitationStatements(db,{invitationId,identityId,issuer,subject,email,now}) {
  return [
    db.prepare(`INSERT INTO auth_identity(id,user_id,issuer,subject,verified_email,last_seen_at)
      SELECT ?,user_id,?,?,?,? FROM auth_identity_invitation
      WHERE id=? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>?`)
      .bind(identityId,issuer,subject,email,now,invitationId,now),
    db.prepare(`UPDATE auth_identity_invitation SET consumed_at=?,consumed_identity_id=?
      WHERE id=? AND consumed_at IS NULL AND EXISTS(SELECT 1 FROM auth_identity WHERE id=?)`)
      .bind(now,identityId,invitationId,identityId)
  ];
}
