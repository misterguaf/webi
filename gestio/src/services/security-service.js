import * as auth from '../domains/auth/repository.js';
import * as organization from '../domains/organization/repository.js';
import * as health from '../domains/health/repository.js';
import * as security from '../domains/security/repository.js';
import { statement } from '../domains/audit/repository.js';
import { AppError, requireFresh, requirePermission, requireUuid, validUuid } from './common.js';

const ROLES=new Set(['GROUP_COORDINATOR','SECTION_COORDINATOR','SECTION_DELEGATE','TREASURY','SECRETARY','CRM_MANAGER','TECH_ADMIN']);
const SEVERITIES=new Set(['LOW','MEDIUM','HIGH','CRITICAL']);
const SUMMARY_CODES=new Set(['TEST_SCENARIO','ACCOUNT_SUSPICION','UNEXPECTED_ACCESS','OTHER_TECHNICAL']);
function notSelf(context,targetId) { if (context.userId===targetId) throw new AppError(403,'self_change_forbidden'); }
function expiry(value,now,{required=false,maxMs=90*24*60*60*1000}={}) {
  if (value==null && !required) return null;
  if (!Number.isSafeInteger(value) || value<=now || value>now+maxMs) throw new AppError(400,'invalid_expiry');
  return value;
}

export async function suspendUser(db,context,session,requestId,targetId,now=Date.now()) {
  requireUuid(targetId);
  await requirePermission(db,context,requestId,'auth.user.suspend'); requireFresh(session,now); notSelf(context,targetId);
  const target=await auth.getUser(db,targetId);
  if (!target) throw new AppError(404,'not_found');
  if (target.status==='SECURITY_BLOCKED') throw new AppError(409,'already_blocked');
  await db.batch([...security.suspendStatements(db,targetId,now),
    statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,action:'USER_SECURITY_SUSPENDED',
      resourceType:'app_user',resourceId:targetId,occurredAt:now})]);
}
export async function setUserEnabled(db,context,session,requestId,targetId,enabled,now=Date.now()) {
  requireUuid(targetId);
  await requirePermission(db,context,requestId,'auth.user.manage'); requireFresh(session,now); notSelf(context,targetId);
  const target=await auth.getUser(db,targetId);
  if (!target) throw new AppError(404,'not_found');
  if (target.status!==(enabled?'DISABLED':'ACTIVE')) throw new AppError(409,'invalid_transition');
  await db.batch([...(enabled?[security.enableStatement(db,targetId,now)]:security.disableStatements(db,targetId,now)),
    statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,
      action:enabled?'USER_ENABLED':'USER_DISABLED',resourceType:'app_user',resourceId:targetId,occurredAt:now})]);
}
export async function assignRole(db,context,session,requestId,input,now=Date.now()) {
  await requirePermission(db,context,requestId,'auth.role.manage'); requireFresh(session,now);
  const {userId,roleCode,sectionId=null}=input??{};
  requireUuid(userId); notSelf(context,userId);
  if (!ROLES.has(roleCode) || (sectionId!==null && !validUuid(sectionId))) throw new AppError(400,'invalid_role');
  const scoped=roleCode==='SECTION_COORDINATOR'||roleCode==='SECTION_DELEGATE';
  if (scoped!==Boolean(sectionId) || !await organization.roleExists(db,roleCode,sectionId)) throw new AppError(400,'invalid_scope');
  if ((await auth.getUser(db,userId))?.status!=='ACTIVE') throw new AppError(404,'not_found');
  const expiresAt=expiry(input.expiresAt??null,now,{required:roleCode==='SECTION_DELEGATE'});
  const id=crypto.randomUUID();
  await db.batch([organization.assignRoleStatement(db,{id,userId,roleCode,sectionId,validFrom:now,expiresAt,actorId:context.userId,justification:'SYNTHETIC_PHASE_2A'}),
    statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,action:'ROLE_ASSIGNED',
      resourceType:'user_role',resourceId:id,occurredAt:now})]);
  return {id};
}
export async function removeRole(db,context,session,requestId,userId,assignmentId,now=Date.now()) {
  requireUuid(userId);requireUuid(assignmentId);
  await requirePermission(db,context,requestId,'auth.role.manage'); requireFresh(session,now);notSelf(context,userId);
  if (!await organization.activeRole(db,assignmentId,userId)) throw new AppError(404,'not_found');
  await db.batch([organization.revokeRoleStatement(db,assignmentId,userId,now),
    statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,action:'ROLE_REMOVED',
      resourceType:'user_role',resourceId:assignmentId,occurredAt:now})]);
}
export async function grantPermission(db,context,session,requestId,input,now=Date.now()) {
  await requirePermission(db,context,requestId,'auth.permission.manage'); requireFresh(session,now);
  const {userId,permissionCode}=input??{};
  requireUuid(userId);notSelf(context,userId);
  if (typeof permissionCode!=='string' || !await organization.permissionExists(db,permissionCode) ||
      (await auth.getUser(db,userId))?.status!=='ACTIVE' ||
      !await organization.roleAllowsPermission(db,userId,permissionCode,now)) throw new AppError(400,'invalid_permission');
  const expiresAt=expiry(input.expiresAt??null,now);
  const id=crypto.randomUUID();
  await db.batch([organization.grantPermissionStatement(db,{id,userId,permissionCode,validFrom:now,expiresAt,actorId:context.userId,justification:'SYNTHETIC_PHASE_2A'}),
    statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,action:'PERMISSION_GRANTED',
      resourceType:'user_permission_grant',resourceId:id,occurredAt:now})]);
  return {id};
}
export async function revokePermission(db,context,session,requestId,userId,grantId,now=Date.now()) {
  requireUuid(userId);requireUuid(grantId);
  await requirePermission(db,context,requestId,'auth.permission.manage');requireFresh(session,now);notSelf(context,userId);
  if (!await organization.activePermissionGrant(db,grantId,userId)) throw new AppError(404,'not_found');
  await db.batch([organization.revokePermissionStatement(db,grantId,userId,now),
    statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,action:'PERMISSION_REVOKED',
      resourceType:'user_permission_grant',resourceId:grantId,occurredAt:now})]);
}
export async function grantHealth(db,context,session,requestId,input,now=Date.now()) {
  await requirePermission(db,context,requestId,'health.grant.manage');requireFresh(session,now);
  const {userId,participantId,purpose,expiresAt}=input??{};
  requireUuid(userId);requireUuid(participantId);
  if (purpose!=='activity-safety' || !await health.eligibleRecipient(db,{userId,participantId,now})) throw new AppError(403,'invalid_health_grant');
  const limitedExpiry=expiry(expiresAt,now,{required:true,maxMs:24*60*60*1000});
  const id=crypto.randomUUID();
  await db.batch([health.grantStatement(db,{id,userId,participantId,purpose,validFrom:now,expiresAt:limitedExpiry,
    actorId:context.userId,justification:'SYNTHETIC_PHASE_2A'}),
    statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,action:'HEALTH_ACCESS_GRANTED',
      resourceType:'health_access_grant',resourceId:id,occurredAt:now})]);
  return {id};
}
export async function revokeHealth(db,context,session,requestId,grantId,now=Date.now()) {
  requireUuid(grantId);
  await requirePermission(db,context,requestId,'health.grant.manage');requireFresh(session,now);
  if (!await health.activeGrant(db,grantId)) throw new AppError(404,'not_found');
  await db.batch([health.revokeStatement(db,grantId,now),
    statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,action:'HEALTH_ACCESS_REVOKED',
      resourceType:'health_access_grant',resourceId:grantId,occurredAt:now})]);
}
export async function openIncident(db,context,session,requestId,input,now=Date.now()) {
  await requirePermission(db,context,requestId,'security.incident.manage');requireFresh(session,now);
  const {severity,summaryCode}=input??{};
  if (!SEVERITIES.has(severity) || !SUMMARY_CODES.has(summaryCode)) throw new AppError(400,'invalid_incident');
  const id=crypto.randomUUID();
  await db.batch([security.openIncidentStatement(db,{id,actorId:context.userId,severity,summaryCode,now}),
    statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,action:'INCIDENT_OPENED',
      resourceType:'security_incident',resourceId:id,occurredAt:now})]);
  return {id};
}
export async function holdAuditEvent(db,context,session,requestId,incidentId,eventId,now=Date.now()) {
  requireUuid(incidentId);requireUuid(eventId);
  await requirePermission(db,context,requestId,'security.incident.manage');requireFresh(session,now);
  const found=await security.incident(db,incidentId);
  if (!found || found.status==='CLOSED') throw new AppError(404,'not_found');
  await db.batch([security.addIncidentResourceStatement(db,{incidentId,resourceType:'audit_event',resourceId:eventId,now}),
    security.addHoldStatement(db,{incidentId,eventId,now}),
    statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,action:'INCIDENT_HOLD_ADDED',
      resourceType:'audit_event',resourceId:eventId,occurredAt:now})]);
}
export async function releaseAuditHold(db,context,session,requestId,incidentId,eventId,now=Date.now()) {
  requireUuid(incidentId);requireUuid(eventId);
  await requirePermission(db,context,requestId,'security.incident.manage');requireFresh(session,now);
  if (!await security.activeHold(db,{incidentId,eventId})) throw new AppError(404,'not_found');
  await db.batch([security.releaseHoldStatement(db,{incidentId,eventId,now}),
    statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,action:'INCIDENT_HOLD_RELEASED',
      resourceType:'audit_event',resourceId:eventId,occurredAt:now})]);
}
