import { synthetic } from '../environment-policy.js';
import * as auth from '../domains/auth/repository.js';
import * as organization from '../domains/organization/repository.js';
import * as health from '../domains/health/repository.js';
import * as security from '../domains/security/repository.js';
import { statement } from '../domains/audit/repository.js';
import { AppError, requireFresh, requirePermission, requireUuid, validUuid } from './common.js';
import { PERMISSIONS } from '../permissions.js';
import { roleDefaults } from '../access-model.js';

const ROLES=new Set(['GROUP_COORDINATOR','SECTION_COORDINATOR','SECTION_DELEGATE','TREASURY','SECRETARY','TECH_ADMIN']);
// 3.5E: SECRETARY absorbs the CRM manager function. CRM_MANAGER is retired — it can no longer be
// assigned through the API. Its code and any historical assignments stay (fixed by a CHECK in
// migration 0001 and present in the audit trail); existing assignments keep granting nothing
// operational and are never converted automatically.
const RETIRED_ROLES=new Set(['CRM_MANAGER']);
const SEVERITIES=new Set(['LOW','MEDIUM','HIGH','CRITICAL']);
const SUMMARY_CODES=new Set(['TEST_SCENARIO','ACCOUNT_SUSPICION','UNEXPECTED_ACCESS','OTHER_TECHNICAL']);
// M3 conservative policy for elevated roles (see docs/PHASE_3_5_AUDIT_REMEDIATION.md):
// only a current GROUP_COORDINATOR assigns them, assignments are audited as ELEVATED_ROLE, and the
// last active GROUP_COORDINATOR cannot be removed or disabled (security suspension stays possible).
const ELEVATED_ROLES=new Set(['GROUP_COORDINATOR','TREASURY','TECH_ADMIN']);
export async function holdsRole(db,userId,roleCode,now) {
  return !!await db.prepare(`SELECT 1 FROM user_role WHERE user_id=? AND role_code=? AND revoked_at IS NULL
    AND valid_from<=? AND (expires_at IS NULL OR expires_at>?) LIMIT 1`).bind(userId,roleCode,now,now).first();
}
async function otherActiveCoordinators(db,userId,now) {
  return (await db.prepare(`SELECT count(DISTINCT ur.user_id) AS n FROM user_role ur JOIN app_user u ON u.id=ur.user_id
    WHERE ur.role_code='GROUP_COORDINATOR' AND ur.user_id!=? AND u.status='ACTIVE' AND ur.revoked_at IS NULL
    AND ur.valid_from<=? AND (ur.expires_at IS NULL OR ur.expires_at>?)`).bind(userId,now,now).first()).n;
}
function notSelf(context,targetId) { if (context.userId===targetId) throw new AppError(403,'self_change_forbidden'); }
// 3.5E: role assignments may run up to a year, matching the maximum delegation duration, so a
// SECTION_DELEGATE role never expires before a valid delegation that relies on it.
const ROLE_EXPIRY_MAX_MS=365*24*60*60*1000;
export function expiry(value,now,{required=false,maxMs=ROLE_EXPIRY_MAX_MS}={}) {
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
  if (!enabled && await holdsRole(db,targetId,'GROUP_COORDINATOR',now) && !await otherActiveCoordinators(db,targetId,now))
    throw new AppError(409,'last_group_coordinator');
  await db.batch([...(enabled?[security.enableStatement(db,targetId,now)]:security.disableStatements(db,targetId,now)),
    statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,
      action:enabled?'USER_ENABLED':'USER_DISABLED',resourceType:'app_user',resourceId:targetId,occurredAt:now})]);
}
// 3.5H.1 origin authority: nobody grants what they do not hold themselves (role + grant only, never through
// a delegation), over a scope at least as wide as the one granted. Coordinació general is the group's
// originating authority and may grant inside the recipient's ceiling (G.1A, unchanged).
export async function assertCanGrant(db,actorId,permissionCode,sectionId,now) {
  if (await holdsRole(db,actorId,'GROUP_COORDINATOR',now)) return;
  const held=await organization.roleGrantSections(db,actorId,permissionCode,now);
  if (!held.includes(null) && !(sectionId!==null && held.includes(sectionId))) throw new AppError(403,'grant_exceeds_authority');
}
// The person whose authority justifies the act (authorized_by) may differ from the provisioner (granted_by).
async function authorizer(db,context,input,permission,targetId,now) {
  const id=input?.authorizedBy??context.userId;
  if (!validUuid(id) || id===targetId) throw new AppError(403,'separation_of_duties');
  if (id!==context.userId && !(await organization.roleGrantSections(db,id,permission,now)).includes(null)) throw new AppError(403,'unauthorized_authorizer');
  return id;
}
/**
 * Statements for one role assignment. `permissions` (3.5H.1, optional): the permissions of the role ceiling
 * granted with it — 'DEFAULTS' or a list. Role-sourced grants end with the role. Without it the legacy
 * contract stays: the role is only a ceiling and grants are separate acts.
 */
export async function roleAssignmentStatements(db,context,requestId,{userId,roleCode,sectionId=null,expiresAt=null,permissions,authorizedBy},now,{newUser=false}={}) {
  if (RETIRED_ROLES.has(roleCode)) throw new AppError(409,'role_retired');
  if (!ROLES.has(roleCode) || (sectionId!==null && !validUuid(sectionId))) throw new AppError(400,'invalid_role');
  const scoped=roleCode==='SECTION_COORDINATOR'||roleCode==='SECTION_DELEGATE';
  if (scoped!==Boolean(sectionId) || !await organization.roleExists(db,roleCode,sectionId)) throw new AppError(400,'invalid_scope');
  if (!newUser && (await auth.getUser(db,userId))?.status!=='ACTIVE') throw new AppError(404,'not_found');
  const elevated=ELEVATED_ROLES.has(roleCode);
  if (elevated && !await holdsRole(db,context.userId,'GROUP_COORDINATOR',now)) throw new AppError(403,'elevated_role_requires_group_coordinator');
  const ceiling=(await db.prepare('SELECT permission_code FROM role_permission WHERE role_code=? ORDER BY permission_code').bind(roleCode).all()).results.map(row=>row.permission_code);
  let granted=[];
  if (permissions!==undefined) {
    granted=permissions==='DEFAULTS'?roleDefaults(roleCode,ceiling):permissions;
    if (!Array.isArray(granted) || granted.length>80 || new Set(granted).size!==granted.length ||
        granted.some(code=>typeof code!=='string' || !ceiling.includes(code) || PERMISSIONS[code]?.reserved)) throw new AppError(400,'invalid_permission');
    for (const code of granted) await assertCanGrant(db,context.userId,code,sectionId,now);
  }
  const id=crypto.randomUUID(), validated=expiry(expiresAt,now,{required:roleCode==='SECTION_DELEGATE'});
  const statements=[organization.assignRoleStatement(db,{id,userId,roleCode,sectionId,validFrom:now,expiresAt:validated,actorId:context.userId,
      justification:synthetic.adminJustification,authorizedBy,ratificationStatus:'PENDING_RATIFICATION'}),
    statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,action:'ROLE_ASSIGNED',
      resourceType:'user_role',resourceId:id,reasonCode:elevated?'ELEVATED_ROLE':null,occurredAt:now}),
    ...granted.map(permissionCode=>organization.grantPermissionStatement(db,{id:crypto.randomUUID(),userId,permissionCode,validFrom:now,
      expiresAt:validated,actorId:context.userId,justification:synthetic.adminJustification,authorizedBy,sourceRoleId:id}))];
  return {id,statements,granted};
}
export async function assignRole(db,context,session,requestId,input,now=Date.now()) {
  await requirePermission(db,context,requestId,'auth.role.manage'); requireFresh(session,now);
  const {userId}=input??{};
  requireUuid(userId); notSelf(context,userId);
  if (Object.keys(input).some(key=>!['userId','roleCode','sectionId','expiresAt','permissions','authorizedBy'].includes(key))) throw new AppError(400,'invalid_role');
  const authorizedBy=await authorizer(db,context,input,'auth.role.manage',userId,now);
  const {id,statements,granted}=await roleAssignmentStatements(db,context,requestId,{...input,sectionId:input.sectionId??null,authorizedBy},now);
  try { await db.batch(statements); }
  catch(error) {
    // Regression (audit remediation): a duplicate active assignment is a conflict, not a server error.
    if (/UNIQUE/.test(error?.message??'')) throw new AppError(409,'role_already_assigned');
    throw error;
  }
  return {id,grantedPermissions:granted,ratificationStatus:'PENDING_RATIFICATION'};
}
export async function removeRole(db,context,session,requestId,userId,assignmentId,now=Date.now()) {
  requireUuid(userId);requireUuid(assignmentId);
  await requirePermission(db,context,requestId,'auth.role.manage'); requireFresh(session,now);notSelf(context,userId);
  return revokeRoleAssignment(db,context,requestId,userId,assignmentId,now);
}
/** Ends a role and the grants that came with it: effective on the next request (authority is read per request). */
export async function revokeRoleAssignment(db,context,requestId,userId,assignmentId,now) {
  const role=await organization.activeRole(db,assignmentId,userId);
  if (!role) throw new AppError(404,'not_found');
  if (role.role_code==='GROUP_COORDINATOR' && !await otherActiveCoordinators(db,userId,now)) throw new AppError(409,'last_group_coordinator');
  await db.batch([organization.revokeRoleStatement(db,assignmentId,userId,now,context.userId),
    organization.revokeRoleGrantsStatement(db,assignmentId,userId,now,context.userId),
    statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,action:'ROLE_REMOVED',
      resourceType:'user_role',resourceId:assignmentId,occurredAt:now})]);
}
/** A direct (individual) grant: inside a role ceiling of the recipient, optionally scoped to one section. */
export async function directGrantStatements(db,context,requestId,{userId,permissionCode,sectionId=null,expiresAt=null,authorizedBy},now,{ceilings=null}={}) {
  const definition=PERMISSIONS[permissionCode];
  if (typeof permissionCode!=='string' || !definition || definition.reserved || !await organization.permissionExists(db,permissionCode)) throw new AppError(400,'invalid_permission');
  if (sectionId!==null && (!validUuid(sectionId) || definition.kind==='GLOBAL' || !await db.prepare('SELECT 1 FROM section WHERE id=?').bind(sectionId).first()))
    throw new AppError(400,'invalid_scope');
  // Ceiling: a current role of the recipient that includes the permission and covers the section.
  const roles=ceilings??(await db.prepare(`SELECT ur.section_id FROM user_role ur JOIN role_permission rp ON rp.role_code=ur.role_code
    WHERE ur.user_id=? AND rp.permission_code=? AND ur.revoked_at IS NULL AND ur.valid_from<=? AND (ur.expires_at IS NULL OR ur.expires_at>?)`)
    .bind(userId,permissionCode,now,now).all()).results.map(row=>row.section_id);
  if (!roles.some(scope=>scope===null || (sectionId!==null && scope===sectionId))) throw new AppError(400,'invalid_permission');
  await assertCanGrant(db,context.userId,permissionCode,sectionId,now);
  const id=crypto.randomUUID();
  return {id,statements:[organization.grantPermissionStatement(db,{id,userId,permissionCode,validFrom:now,expiresAt:expiry(expiresAt,now),
      actorId:context.userId,justification:synthetic.adminJustification,authorizedBy,ratificationStatus:'PENDING_RATIFICATION',sectionId}),
    statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,action:'PERMISSION_GRANTED',
      resourceType:'user_permission_grant',resourceId:id,occurredAt:now})]};
}
export async function grantPermission(db,context,session,requestId,input,now=Date.now()) {
  await requirePermission(db,context,requestId,'auth.permission.manage'); requireFresh(session,now);
  const {userId}=input??{};
  requireUuid(userId);notSelf(context,userId);
  if (Object.keys(input).some(key=>!['userId','permissionCode','sectionId','expiresAt','authorizedBy'].includes(key))) throw new AppError(400,'invalid_permission');
  if ((await auth.getUser(db,userId))?.status!=='ACTIVE') throw new AppError(400,'invalid_permission');
  const authorizedBy=await authorizer(db,context,input,'auth.permission.manage',userId,now);
  const {id,statements}=await directGrantStatements(db,context,requestId,{...input,sectionId:input.sectionId??null,authorizedBy},now);
  try { await db.batch(statements); }
  catch(error) { if (/UNIQUE/.test(error?.message??'')) throw new AppError(409,'permission_already_granted'); throw error; }
  return {id,ratificationStatus:'PENDING_RATIFICATION'};
}
export async function revokePermission(db,context,session,requestId,userId,grantId,now=Date.now()) {
  requireUuid(userId);requireUuid(grantId);
  await requirePermission(db,context,requestId,'auth.permission.manage');requireFresh(session,now);notSelf(context,userId);
  return revokeDirectGrant(db,context,requestId,userId,grantId,now);
}
export async function revokeDirectGrant(db,context,requestId,userId,grantId,now) {
  const grant=await organization.activePermissionGrant(db,grantId,userId);
  if (!grant) throw new AppError(404,'not_found');
  // A permission that comes with a role is changed by changing the role (no negative overrides in v1).
  if (grant.source_role_id) throw new AppError(409,'role_derived_permission');
  await db.batch([organization.revokePermissionStatement(db,grantId,userId,now,context.userId),
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
    actorId:context.userId,justification:synthetic.adminJustification}),
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
