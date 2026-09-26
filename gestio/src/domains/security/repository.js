export function suspendStatements(db,userId,now) {
  return [
    db.prepare(`UPDATE app_user SET status='SECURITY_BLOCKED',security_blocked_at=?,updated_at=?,version=version+1
      WHERE id=? AND status!='SECURITY_BLOCKED'`).bind(now,now,userId),
    db.prepare('UPDATE app_session SET revoked_at=?,revoke_reason=? WHERE user_id=? AND revoked_at IS NULL').bind(now,'SECURITY_SUSPEND',userId),
    db.prepare('UPDATE user_role SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').bind(now,userId),
    db.prepare('UPDATE user_permission_grant SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').bind(now,userId),
    db.prepare('UPDATE health_access_grant SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').bind(now,userId)
  ];
}
export function disableStatements(db,userId,now) {
  return [
    db.prepare(`UPDATE app_user SET status='DISABLED',disabled_at=?,updated_at=?,version=version+1 WHERE id=? AND status='ACTIVE'`).bind(now,now,userId),
    db.prepare('UPDATE app_session SET revoked_at=?,revoke_reason=? WHERE user_id=? AND revoked_at IS NULL').bind(now,'ACCOUNT_DISABLED',userId),
    db.prepare('UPDATE user_role SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').bind(now,userId),
    db.prepare('UPDATE user_permission_grant SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').bind(now,userId),
    db.prepare('UPDATE health_access_grant SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').bind(now,userId)
  ];
}
export function enableStatement(db,userId,now) {
  return db.prepare(`UPDATE app_user SET status='ACTIVE',disabled_at=NULL,updated_at=?,version=version+1 WHERE id=? AND status='DISABLED'`).bind(now,userId);
}
export function openIncidentStatement(db,{id,actorId,severity,summaryCode,now}) {
  return db.prepare(`INSERT INTO security_incident(id,status,severity,summary_code,opened_at,opened_by,created_at,updated_at)
    VALUES(?,'OPEN',?,?,?,?,?,?)`).bind(id,severity,summaryCode,now,actorId,now,now);
}
export async function incident(db,id) {
  return db.prepare('SELECT id,status,severity,summary_code,opened_at,closed_at FROM security_incident WHERE id=?').bind(id).first();
}
export function addIncidentResourceStatement(db,{incidentId,resourceType,resourceId,now}) {
  return db.prepare('INSERT INTO incident_resource(id,incident_id,resource_type,resource_id,added_at) VALUES(?,?,?,?,?)')
    .bind(crypto.randomUUID(),incidentId,resourceType,resourceId,now);
}
export function addHoldStatement(db,{incidentId,eventId,now}) {
  return db.prepare('INSERT INTO incident_audit_hold(incident_id,audit_event_id,held_at) VALUES(?,?,?)').bind(incidentId,eventId,now);
}
export function releaseHoldStatement(db,{incidentId,eventId,now}) {
  return db.prepare('UPDATE incident_audit_hold SET released_at=? WHERE incident_id=? AND audit_event_id=? AND released_at IS NULL').bind(now,incidentId,eventId);
}
export async function activeHold(db,{incidentId,eventId}) {
  return db.prepare('SELECT 1 FROM incident_audit_hold WHERE incident_id=? AND audit_event_id=? AND released_at IS NULL').bind(incidentId,eventId).first();
}
export async function retentionPolicy(db,category) {
  return db.prepare('SELECT enabled,retention_ms FROM retention_policy WHERE category=?').bind(category).first();
}
