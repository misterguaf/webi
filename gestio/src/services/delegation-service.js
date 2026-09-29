import { pageRequest, pageResult } from '../pagination.js';
import { synthetic } from '../environment-policy.js';
import { effectiveSections } from '../domains/organization/repository.js';
import { statement } from '../domains/audit/repository.js';
import { AppError, requireFresh, requirePermission, requireUuid, validUuid } from './common.js';

const DELEGABLE=new Set(['activities.registration.review','finance.payment.verify','finance.fee.payment.review']);
const reference=value=>synthetic.reference(value);
async function active(db,id) {
  return db.prepare("SELECT id FROM app_user WHERE id=? AND status='ACTIVE'").bind(id).first();
}
export async function grantDelegation(db,context,session,requestId,input,now=Date.now()) {
  await requirePermission(db,context,requestId,'auth.permission.provision',{resourceType:'delegated_permission'});
  requireFresh(session,now);
  if (!input || Object.keys(input).some(key=>!['userId','permissionCode','sectionId','authorizedBy','authorizationReference','expiresAt'].includes(key)) ||
      !validUuid(input.userId) || !validUuid(input.authorizedBy) ||
      (input.sectionId!=null && !validUuid(input.sectionId)) || !DELEGABLE.has(input.permissionCode) ||
      !reference(input.authorizationReference) || !Number.isSafeInteger(input.expiresAt) ||
      input.expiresAt<=now || input.expiresAt>now+90*24*60*60*1000) throw new AppError(400,'invalid_delegation');
  if (!await active(db,input.userId) || !await active(db,input.authorizedBy)) throw new AppError(400,'invalid_delegation');
  const sectionId=input.sectionId??null;
  if (sectionId && !await db.prepare('SELECT 1 FROM section WHERE id=?').bind(sectionId).first()) throw new AppError(400,'invalid_delegation');
  const authorizer=await effectiveSections(db,input.authorizedBy,'auth.permission.authorize',now);
  if (!authorizer.length || (sectionId===null?!authorizer.includes(null):!authorizer.includes(null) && !authorizer.includes(sectionId)))
    throw new AppError(403,'unauthorized_delegation');
  const role=(await db.prepare(`SELECT ur.section_id FROM user_role ur JOIN role_permission rp ON rp.role_code=ur.role_code
    WHERE ur.user_id=? AND rp.permission_code=? AND ur.revoked_at IS NULL AND ur.valid_from<=?
    AND (ur.expires_at IS NULL OR ur.expires_at>?)`).bind(input.userId,input.permissionCode,now,now).all()).results;
  if (!role.some(row=>sectionId===null?row.section_id===null:row.section_id===null || row.section_id===sectionId))
    throw new AppError(400,'recipient_role_scope_required');
  const id=crypto.randomUUID();
  await db.batch([
    db.prepare(`INSERT INTO delegated_permission(id,user_id,permission_code,section_id,authorized_by,provisioned_by,
      authorization_reference,granted_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)`)
      .bind(id,input.userId,input.permissionCode,sectionId,input.authorizedBy,context.userId,
        input.authorizationReference,now,input.expiresAt),
    statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,
      action:'DELEGATED_PERMISSION_GRANTED',resourceType:'delegated_permission',resourceId:id,occurredAt:now})
  ]);
  return {id,ratificationStatus:'PENDING_RATIFICATION'};
}
export async function ratifyDelegation(db,context,session,requestId,id,input,now=Date.now()) {
  requireUuid(id);
  await requirePermission(db,context,requestId,'auth.permission.ratify',{resourceType:'delegated_permission',resourceId:id});
  requireFresh(session,now);
  if (!input || Object.keys(input).some(key=>key!=='ratificationReference') || !reference(input.ratificationReference))
    throw new AppError(400,'invalid_ratification');
  const row=await db.prepare('SELECT ratification_status,expires_at FROM delegated_permission WHERE id=?').bind(id).first();
  if (!row) throw new AppError(404,'not_found');
  if (row.ratification_status!=='PENDING_RATIFICATION' || (row.expires_at!==null && row.expires_at<=now))
    throw new AppError(409,'invalid_transition');
  await db.batch([
    db.prepare(`UPDATE delegated_permission SET ratification_status='RATIFIED',ratified_at=?,ratified_by=?,ratification_reference=?
      WHERE id=?`).bind(now,context.userId,input.ratificationReference,id),
    statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,
      action:'DELEGATED_PERMISSION_RATIFIED',resourceType:'delegated_permission',resourceId:id,occurredAt:now})
  ]);
  return {id,ratificationStatus:'RATIFIED'};
}
export async function revokeDelegation(db,context,session,requestId,id,now=Date.now()) {
  requireUuid(id);
  await requirePermission(db,context,requestId,'auth.permission.provision',{resourceType:'delegated_permission',resourceId:id});
  requireFresh(session,now);
  const row=await db.prepare('SELECT ratification_status FROM delegated_permission WHERE id=?').bind(id).first();
  if (!row) throw new AppError(404,'not_found');
  if (row.ratification_status==='REVOKED') throw new AppError(409,'invalid_transition');
  await db.batch([
    db.prepare(`UPDATE delegated_permission SET ratification_status='REVOKED',revoked_at=?,revoked_by=? WHERE id=?`)
      .bind(now,context.userId,id),
    statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,
      action:'DELEGATED_PERMISSION_REVOKED',resourceType:'delegated_permission',resourceId:id,occurredAt:now})
  ]);
  return {id,ratificationStatus:'REVOKED'};
}
export async function listDelegations(db,context,requestId,params) {
  await requirePermission(db,context,requestId,'auth.permission.provision',{resourceType:'delegated_permission'});
  const page=pageRequest(params,['number','string']);
  const rows=(await db.prepare(`SELECT id,user_id,permission_code,section_id,authorized_by,provisioned_by,
    authorization_reference,granted_at,expires_at,ratification_status,ratified_at,revoked_at
    FROM delegated_permission ${page.after?'WHERE (granted_at<? OR (granted_at=? AND id<?))':''}
    ORDER BY granted_at DESC,id DESC LIMIT ?`).bind(...(page.after?[page.after[0],page.after[0],page.after[1]]:[]),page.limit+1).all()).results;
  const result=pageResult(rows,page.limit,row=>[row.granted_at,row.id]);
  return {delegations:result.items,nextCursor:result.nextCursor};
}
