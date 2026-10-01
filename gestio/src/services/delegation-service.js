import { pageRequest, pageResult } from '../pagination.js';
import { synthetic } from '../environment-policy.js';
import { effectiveSections } from '../domains/organization/repository.js';
import { statement } from '../domains/audit/repository.js';
import { AppError, requireFresh, requirePermission, requireUuid, validUuid } from './common.js';
import { FINANCIAL_DELEGATIONS } from '../permissions.js';

const FINANCIAL=new Set(FINANCIAL_DELEGATIONS);
const DELEGABLE=new Set(['activities.registration.review','activities.registration.contact.read',
  'participants.profile.read','participants.profile.manage','participants.contact.read','participants.contact.manage',
  'participants.guardian.manage',...FINANCIAL]);
// 3.5E delegation duration: 90 days by default, up to 365 days, always with an expiry. Never indefinite.
// The maximum matches the delegate-role expiry cap (security-service) so the role never expires first.
const DAY=24*60*60*1000;
export const DELEGATION_DEFAULT_MS=90*DAY, DELEGATION_MAX_MS=365*DAY;
const reference=value=>synthetic.reference(value);
async function active(db,id) {
  return db.prepare("SELECT id FROM app_user WHERE id=? AND status='ACTIVE'").bind(id).first();
}
export async function grantDelegation(db,context,session,requestId,input,now=Date.now()) {
  await requirePermission(db,context,requestId,'auth.permission.provision',{resourceType:'delegated_permission'});
  requireFresh(session,now);
  // expiresAt is optional: default 90 days, maximum 365, always in the future. Never indefinite.
  const expiresAt=input?.expiresAt==null?now+DELEGATION_DEFAULT_MS:input.expiresAt;
  if (!input || Object.keys(input).some(key=>!['userId','permissionCode','sectionId','authorizedBy','authorizationReference','expiresAt'].includes(key)) ||
      !validUuid(input.userId) || !validUuid(input.authorizedBy) ||
      (input.sectionId!=null && !validUuid(input.sectionId)) || !DELEGABLE.has(input.permissionCode) ||
      !reference(input.authorizationReference) || !Number.isSafeInteger(expiresAt) ||
      expiresAt<=now || expiresAt>now+DELEGATION_MAX_MS) throw new AppError(400,'invalid_delegation');
  if (!await active(db,input.userId) || !await active(db,input.authorizedBy)) throw new AppError(400,'invalid_delegation');
  // Separation of duties (M3): nobody delegates to themselves, as provisioner or as named authoriser.
  if (input.userId===context.userId || input.userId===input.authorizedBy) throw new AppError(403,'separation_of_duties');
  const sectionId=input.sectionId??null;
  if (sectionId && !await db.prepare('SELECT 1 FROM section WHERE id=?').bind(sectionId).first()) throw new AppError(400,'invalid_delegation');
  const authorizer=await effectiveSections(db,input.authorizedBy,'auth.permission.authorize',now);
  if (!authorizer.length || (sectionId===null?!authorizer.includes(null):!authorizer.includes(null) && !authorizer.includes(sectionId)))
    throw new AppError(403,'unauthorized_delegation');
  const covers=(scopes)=>scopes.includes(null) || (sectionId!==null && scopes.includes(sectionId));
  if (FINANCIAL.has(input.permissionCode)) {
    // Financial delegation (TREASURY.md §25.3): no role of the recipient grants or limits it. Nobody
    // delegates financial authority they do not hold: the named authoriser must currently hold the same
    // capability over the delegated scope (role + grant only, never through a delegation of their own).
    const held=(await db.prepare(`SELECT ur.section_id FROM user_role ur
      JOIN role_permission rp ON rp.role_code=ur.role_code AND rp.permission_code=?
      JOIN user_permission_grant up ON up.user_id=ur.user_id AND up.permission_code=rp.permission_code
      WHERE ur.user_id=? AND ur.revoked_at IS NULL AND ur.valid_from<=? AND (ur.expires_at IS NULL OR ur.expires_at>?)
      AND up.revoked_at IS NULL AND up.valid_from<=? AND (up.expires_at IS NULL OR up.expires_at>?)`)
      .bind(input.permissionCode,input.authorizedBy,now,now,now,now).all()).results.map(row=>row.section_id);
    if (!covers(held)) throw new AppError(403,'unauthorized_delegation');
  } else {
    const role=(await db.prepare(`SELECT ur.section_id FROM user_role ur JOIN role_permission rp ON rp.role_code=ur.role_code
      WHERE ur.user_id=? AND rp.permission_code=? AND ur.revoked_at IS NULL AND ur.valid_from<=?
      AND (ur.expires_at IS NULL OR ur.expires_at>?)`).bind(input.userId,input.permissionCode,now,now).all()).results;
    if (!role.some(row=>sectionId===null?row.section_id===null:row.section_id===null || row.section_id===sectionId))
      throw new AppError(400,'recipient_role_scope_required');
  }
  const id=crypto.randomUUID();
  // When the provisioner is the named authoriser, the authority is exercised in this same act.
  const selfAuthorized=input.authorizedBy===context.userId;
  await db.batch([
    db.prepare(`INSERT INTO delegated_permission(id,user_id,permission_code,section_id,authorized_by,provisioned_by,
      authorization_reference,granted_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)`)
      .bind(id,input.userId,input.permissionCode,sectionId,input.authorizedBy,context.userId,
        input.authorizationReference,now,expiresAt),
    statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,
      action:'DELEGATED_PERMISSION_GRANTED',resourceType:'delegated_permission',resourceId:id,
      reasonCode:FINANCIAL.has(input.permissionCode)?'FINANCIAL_DELEGATION':null,occurredAt:now}),
    ...(selfAuthorized?confirmationStatements(db,context,requestId,id,now):[])
  ]);
  return {id,ratificationStatus:'PENDING_RATIFICATION',authorizationStatus:selfAuthorized?'CONFIRMED':'PENDING_CONFIRMATION'};
}
function confirmationStatements(db,context,requestId,id,now) {
  return [db.prepare('INSERT INTO delegated_permission_confirmation(delegation_id,confirmed_by,confirmed_at) VALUES(?,?,?)')
      .bind(id,context.userId,now),
    statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,
      action:'DELEGATION_AUTHORIZATION_CONFIRMED',resourceType:'delegated_permission',resourceId:id,occurredAt:now})];
}
// M3: the named authoriser confirms in Gestió that they authorised the delegation. A provisioner
// (e.g. TECH_ADMIN) can no longer attribute an authorisation to someone who never gave it.
export async function confirmDelegation(db,context,session,requestId,id,now=Date.now()) {
  requireUuid(id);
  const row=await db.prepare(`SELECT d.authorized_by,d.section_id,d.ratification_status,c.delegation_id AS confirmed
    FROM delegated_permission d LEFT JOIN delegated_permission_confirmation c ON c.delegation_id=d.id WHERE d.id=?`).bind(id).first();
  if (!row) throw new AppError(404,'not_found');
  await requirePermission(db,context,requestId,'auth.permission.authorize',
    {...(row.section_id?{sectionId:row.section_id}:{mode:'all-sections'}),resourceType:'delegated_permission',resourceId:id});
  requireFresh(session,now);
  if (row.authorized_by!==context.userId) throw new AppError(403,'named_authoriser_required');
  if (row.ratification_status!=='PENDING_RATIFICATION' || row.confirmed) throw new AppError(409,'invalid_transition');
  await db.batch(confirmationStatements(db,context,requestId,id,now));
  return {id,authorizationStatus:'CONFIRMED'};
}
export async function ratifyDelegation(db,context,session,requestId,id,input,now=Date.now()) {
  requireUuid(id);
  await requirePermission(db,context,requestId,'auth.permission.ratify',{resourceType:'delegated_permission',resourceId:id});
  requireFresh(session,now);
  if (!input || Object.keys(input).some(key=>key!=='ratificationReference') || !reference(input.ratificationReference))
    throw new AppError(400,'invalid_ratification');
  const row=await db.prepare(`SELECT d.ratification_status,d.expires_at,d.provisioned_by,d.user_id,d.permission_code,c.delegation_id AS confirmed
    FROM delegated_permission d LEFT JOIN delegated_permission_confirmation c ON c.delegation_id=d.id WHERE d.id=?`).bind(id).first();
  if (!row) throw new AppError(404,'not_found');
  if (row.ratification_status!=='PENDING_RATIFICATION' || (row.expires_at!==null && row.expires_at<=now))
    throw new AppError(409,'invalid_transition');
  if (row.provisioned_by===context.userId || row.user_id===context.userId) throw new AppError(403,'separation_of_duties');
  if (!row.confirmed) throw new AppError(409,'authorization_confirmation_required');
  await db.batch([
    db.prepare(`UPDATE delegated_permission SET ratification_status='RATIFIED',ratified_at=?,ratified_by=?,ratification_reference=?
      WHERE id=?`).bind(now,context.userId,input.ratificationReference,id),
    statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,
      action:'DELEGATED_PERMISSION_RATIFIED',resourceType:'delegated_permission',resourceId:id,
      reasonCode:FINANCIAL.has(row.permission_code)?'FINANCIAL_DELEGATION':null,occurredAt:now})
  ]);
  return {id,ratificationStatus:'RATIFIED'};
}
export async function revokeDelegation(db,context,session,requestId,id,now=Date.now()) {
  requireUuid(id);
  await requirePermission(db,context,requestId,'auth.permission.provision',{resourceType:'delegated_permission',resourceId:id});
  requireFresh(session,now);
  const row=await db.prepare('SELECT ratification_status,permission_code FROM delegated_permission WHERE id=?').bind(id).first();
  if (!row) throw new AppError(404,'not_found');
  if (row.ratification_status==='REVOKED') throw new AppError(409,'invalid_transition');
  await db.batch([
    db.prepare(`UPDATE delegated_permission SET ratification_status='REVOKED',revoked_at=?,revoked_by=? WHERE id=?`)
      .bind(now,context.userId,id),
    statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,
      action:'DELEGATED_PERMISSION_REVOKED',resourceType:'delegated_permission',resourceId:id,
      reasonCode:FINANCIAL.has(row.permission_code)?'FINANCIAL_DELEGATION':null,occurredAt:now})
  ]);
  return {id,ratificationStatus:'REVOKED'};
}
export async function listDelegations(db,context,requestId,params) {
  await requirePermission(db,context,requestId,'auth.permission.provision',{resourceType:'delegated_permission'});
  const page=pageRequest(params,['number','string']);
  const rows=(await db.prepare(`SELECT d.id,d.user_id,d.permission_code,d.section_id,d.authorized_by,d.provisioned_by,
    d.authorization_reference,d.granted_at,d.expires_at,d.ratification_status,d.ratified_at,d.revoked_at,
    c.confirmed_at AS authorization_confirmed_at
    FROM delegated_permission d LEFT JOIN delegated_permission_confirmation c ON c.delegation_id=d.id
    ${page.after?'WHERE (d.granted_at<? OR (d.granted_at=? AND d.id<?))':''}
    ORDER BY d.granted_at DESC,d.id DESC LIMIT ?`).bind(...(page.after?[page.after[0],page.after[0],page.after[1]]:[]),page.limit+1).all()).results;
  const result=pageResult(rows,page.limit,row=>[row.granted_at,row.id]);
  return {delegations:result.items,nextCursor:result.nextCursor};
}
