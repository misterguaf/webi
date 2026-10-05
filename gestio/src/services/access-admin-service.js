// 3.5H.1 Administració: account provisioning with roles and grants in one act, effective access with its
// origin, the ratification inbox and other people's sessions. Every operation authorises itself; access
// packages are UI presets and never reach this layer as authority.
import { authorize } from '../policy.js';
import { statement } from '../domains/audit/repository.js';
import { effectiveGrants } from '../domains/organization/repository.js';
import { synthetic } from '../environment-policy.js';
import { PERMISSIONS } from '../permissions.js';
import { MODULES, PACKAGES, ROLES, moduleOf, permissionLabel, roleDefaults } from '../access-model.js';
import { AppError, requireFresh, requirePermission, requireUuid, validUuid } from './common.js';
import { directGrantStatements, revokeDirectGrant, revokeRoleAssignment, roleAssignmentStatements } from './security-service.js';
import { ratifyDelegation, revokeDelegation } from './delegation-service.js';

const DAY = 24 * 60 * 60 * 1000;
// Ratification is never automatic: a pending act stays effective and is flagged as overdue after this.
export const RATIFICATION_OVERDUE_MS = 90 * DAY;
const ADMIN_PERMISSIONS = ['auth.user.manage', 'auth.role.manage', 'auth.permission.manage', 'auth.permission.provision',
  'auth.permission.ratify', 'auth.session.revoke'];
const can = async (db, context, permission) => (await authorize(db, context, { permission })).allow;
async function requireAnyAdmin(db, context, requestId) {
  for (const permission of ADMIN_PERMISSIONS) if (await can(db, context, permission)) return;
  await requirePermission(db, context, requestId, 'auth.user.manage');
}
const audit = (db, context, requestId, action, resourceType, resourceId, now, reasonCode = null) => statement(db, { requestId,
  actorUserId: context.userId, sessionId: context.sessionId, action, resourceType, resourceId, reasonCode, occurredAt: now });

/** Roles with their ceilings and defaults, the permission catalogue by module, packages and sections. */
export async function catalog(db, context, requestId) {
  await requireAnyAdmin(db, context, requestId);
  const rows = (await db.prepare('SELECT role_code,permission_code FROM role_permission ORDER BY role_code,permission_code').all()).results;
  const roles = Object.entries(ROLES).map(([code, role]) => {
    const ceiling = rows.filter(row => row.role_code === code).map(row => row.permission_code).filter(perm => PERMISSIONS[perm] && !PERMISSIONS[perm].reserved);
    return { code, ...role, ceiling, defaults: roleDefaults(code, ceiling) };
  });
  const permissions = Object.entries(PERMISSIONS).filter(([, def]) => !def.reserved).map(([code, def]) => ({
    code, label: permissionLabel(code), module: moduleOf(code), kind: def.kind, delegable: !!def.delegable, financial: !!def.financialDelegation }));
  const sections = (await db.prepare('SELECT id,code,display_name AS name FROM section ORDER BY code').all()).results;
  const capabilities = Object.fromEntries(await Promise.all(ADMIN_PERMISSIONS.map(async perm => [perm, await can(db, context, perm)])));
  return { roles, permissions, modules: MODULES.map(({ id, label }) => ({ id, label })), packages: PACKAGES, sections, capabilities };
}

/**
 * Create a person with roles and individual grants in one atomic act. Identity stays with the existing
 * Cloudflare Access model: the account is invited afterwards by verified e-mail.
 */
export async function provisionUser(db, context, session, requestId, input, now = Date.now()) {
  await requirePermission(db, context, requestId, 'auth.user.manage', { resourceType: 'app_user' }); requireFresh(session, now);
  if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['displayName', 'roles', 'grants', 'authorizedBy'].includes(key)))
    throw new AppError(400, 'invalid_user');
  const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : '';
  if (displayName.length < 2 || displayName.length > 120 || !synthetic.personName(displayName)) throw new AppError(400, 'invalid_user');
  const roles = input.roles ?? [], grants = input.grants ?? [];
  if (!Array.isArray(roles) || !Array.isArray(grants) || roles.length > 6 || grants.length > 40) throw new AppError(400, 'invalid_user');
  if (roles.length) await requirePermission(db, context, requestId, 'auth.role.manage', { resourceType: 'app_user' });
  if (grants.length) await requirePermission(db, context, requestId, 'auth.permission.manage', { resourceType: 'app_user' });
  const authorizedBy = input.authorizedBy ?? context.userId;
  if (!validUuid(authorizedBy)) throw new AppError(400, 'invalid_user');
  if (authorizedBy !== context.userId) {
    const holds = async perm => (await authorize(db, { userId: authorizedBy, sessionId: context.sessionId, status: 'ACTIVE' }, { permission: perm })).allow;
    if (!await holds('auth.user.manage')) throw new AppError(403, 'unauthorized_authorizer');
  }
  const userId = crypto.randomUUID();
  const statements = [
    db.prepare(`INSERT INTO app_user(id,display_name,status,created_at,updated_at) VALUES(?,?,'ACTIVE',?,?)`).bind(userId, displayName, now, now),
    audit(db, context, requestId, 'USER_CREATED', 'app_user', userId, now, 'ACCOUNT_PROVISIONED')];
  const ceilings = new Map();
  for (const role of roles) {
    if (!role || typeof role !== 'object' || Object.keys(role).some(key => !['roleCode', 'sectionId', 'expiresAt', 'permissions'].includes(key))) throw new AppError(400, 'invalid_role');
    const built = await roleAssignmentStatements(db, context, requestId, { userId, roleCode: role.roleCode, sectionId: role.sectionId ?? null,
      expiresAt: role.expiresAt ?? null, permissions: role.permissions ?? 'DEFAULTS', authorizedBy }, now, { newUser: true });
    statements.push(...built.statements);
    const ceiling = (await db.prepare('SELECT permission_code FROM role_permission WHERE role_code=?').bind(role.roleCode).all()).results;
    for (const { permission_code: perm } of ceiling) ceilings.set(perm, [...(ceilings.get(perm) ?? []), role.sectionId ?? null]);
  }
  for (const grant of grants) {
    if (!grant || typeof grant !== 'object' || Object.keys(grant).some(key => !['permissionCode', 'sectionId', 'expiresAt'].includes(key))) throw new AppError(400, 'invalid_permission');
    const built = await directGrantStatements(db, context, requestId, { userId, permissionCode: grant.permissionCode, sectionId: grant.sectionId ?? null,
      expiresAt: grant.expiresAt ?? null, authorizedBy }, now, { ceilings: ceilings.get(grant.permissionCode) ?? [] });
    statements.push(...built.statements);
  }
  try { await db.batch(statements); }
  catch (error) { if (/UNIQUE/.test(error?.message ?? '')) throw new AppError(409, 'duplicate_access'); throw error; }
  return { id: userId, status: 'ACTIVE' };
}

const section = row => row.section_code ? { id: row.section_id, code: row.section_code } : null;
/** "What can this person actually do?" — every effective item with its origin, scope, expiry and ratification. */
export async function userAccess(db, context, requestId, userId, now = Date.now()) {
  requireUuid(userId);
  await requirePermission(db, context, requestId, 'auth.user.manage', { resourceType: 'app_user', resourceId: userId });
  const user = await db.prepare('SELECT id,display_name,status,created_at FROM app_user WHERE id=?').bind(userId).first();
  if (!user) throw new AppError(404, 'not_found');
  const names = `(SELECT display_name FROM app_user WHERE id=%) `;
  const roles = (await db.prepare(`SELECT ur.id,ur.role_code,ur.section_id,s.code AS section_code,ur.valid_from,ur.expires_at,ur.ratification_status,
      ur.ratified_at,${names.replace('%', 'ur.authorized_by')}AS authorized_by_name,${names.replace('%', 'ur.granted_by')}AS provisioned_by_name
    FROM user_role ur LEFT JOIN section s ON s.id=ur.section_id WHERE ur.user_id=? AND ur.revoked_at IS NULL AND (ur.expires_at IS NULL OR ur.expires_at>?)
    ORDER BY ur.role_code`).bind(userId, now).all()).results;
  const grants = (await db.prepare(`SELECT g.id,g.permission_code,g.section_id,s.code AS section_code,g.source_role_id,g.valid_from,g.expires_at,
      g.ratification_status,${names.replace('%', 'g.authorized_by')}AS authorized_by_name FROM user_permission_grant g LEFT JOIN section s ON s.id=g.section_id
    WHERE g.user_id=? AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>?) ORDER BY g.permission_code`).bind(userId, now).all()).results;
  const delegations = (await db.prepare(`SELECT d.id,d.permission_code,d.section_id,s.code AS section_code,d.granted_at,d.expires_at,d.ratification_status,
      c.confirmed_at,${names.replace('%', 'd.authorized_by')}AS authorized_by_name FROM delegated_permission d LEFT JOIN section s ON s.id=d.section_id
      LEFT JOIN delegated_permission_confirmation c ON c.delegation_id=d.id
    WHERE d.user_id=? AND d.revoked_at IS NULL AND (d.expires_at IS NULL OR d.expires_at>?) ORDER BY d.expires_at`).bind(userId, now).all()).results;
  const ceilingRows = (await db.prepare('SELECT role_code,permission_code FROM role_permission').all()).results;
  const ceilingOf = code => ceilingRows.filter(row => row.role_code === code).map(row => row.permission_code);
  const items = [];
  for (const grant of grants) {
    if (grant.source_role_id) {
      const role = roles.find(item => item.id === grant.source_role_id);
      if (role) items.push({ permission: grant.permission_code, origin: 'ROLE', role: role.role_code, scope: section(role), expiresAt: grant.expires_at,
        ratificationStatus: role.ratification_status, grantId: grant.id, removable: false });
      continue;
    }
    const holders = roles.filter(role => ceilingOf(role.role_code).includes(grant.permission_code)
      && (!grant.section_id || !role.section_id || role.section_id === grant.section_id));
    const scopes = grant.section_id ? [section(grant)] : holders.map(section);
    items.push({ permission: grant.permission_code, origin: 'DIRECT', scope: scopes.length === 1 ? scopes[0] : null, scopes,
      effective: holders.length > 0, expiresAt: grant.expires_at, ratificationStatus: grant.ratification_status, grantId: grant.id, removable: true });
  }
  for (const delegation of delegations) items.push({ permission: delegation.permission_code, origin: 'DELEGATION', scope: section(delegation),
    expiresAt: delegation.expires_at, ratificationStatus: delegation.ratification_status, authorised: !!delegation.confirmed_at,
    effective: !!delegation.confirmed_at, delegationId: delegation.id, removable: true });
  const effective = await effectiveGrants(db, userId, now);
  const summary = MODULES.map(module => ({ module: module.id, label: module.label,
    permissions: [...effective.keys()].filter(code => module.match(code) && PERMISSIONS[code] && !PERMISSIONS[code].reserved).sort()
      .map(code => ({ code, label: permissionLabel(code), group: effective.get(code).includes(null),
        sections: [...new Set(effective.get(code).filter(Boolean))] })) })).filter(module => module.permissions.length);
  return { user, roles: roles.map(role => ({ ...role, label: ROLES[role.role_code]?.label ?? role.role_code })), items, summary };
}

/** Authority changes pending ratification (roles, direct grants and delegations), oldest first. */
export async function listRatifications(db, context, requestId, now = Date.now()) {
  await requirePermission(db, context, requestId, 'auth.permission.ratify', { resourceType: 'app_user' });
  const name = column => `(SELECT display_name FROM app_user WHERE id=${column})`;
  const roles = (await db.prepare(`SELECT 'role' AS kind,ur.id,ur.user_id,${name('ur.user_id')} AS user_name,ur.role_code AS subject,s.code AS section_code,
      ${name('ur.authorized_by')} AS authorized_by_name,${name('ur.granted_by')} AS provisioned_by_name,ur.valid_from AS granted_at,ur.expires_at,1 AS authorised
    FROM user_role ur LEFT JOIN section s ON s.id=ur.section_id WHERE ur.ratification_status='PENDING_RATIFICATION' AND ur.revoked_at IS NULL
      AND (ur.expires_at IS NULL OR ur.expires_at>?)`).bind(now).all()).results;
  const grants = (await db.prepare(`SELECT 'grant' AS kind,g.id,g.user_id,${name('g.user_id')} AS user_name,g.permission_code AS subject,s.code AS section_code,
      ${name('g.authorized_by')} AS authorized_by_name,${name('g.granted_by')} AS provisioned_by_name,g.valid_from AS granted_at,g.expires_at,1 AS authorised
    FROM user_permission_grant g LEFT JOIN section s ON s.id=g.section_id WHERE g.ratification_status='PENDING_RATIFICATION' AND g.revoked_at IS NULL
      AND g.source_role_id IS NULL AND (g.expires_at IS NULL OR g.expires_at>?)`).bind(now).all()).results;
  const delegations = (await db.prepare(`SELECT 'delegation' AS kind,d.id,d.user_id,${name('d.user_id')} AS user_name,d.permission_code AS subject,s.code AS section_code,
      ${name('d.authorized_by')} AS authorized_by_name,${name('d.provisioned_by')} AS provisioned_by_name,d.granted_at,d.expires_at,
      (c.delegation_id IS NOT NULL) AS authorised FROM delegated_permission d LEFT JOIN section s ON s.id=d.section_id
      LEFT JOIN delegated_permission_confirmation c ON c.delegation_id=d.id
    WHERE d.ratification_status='PENDING_RATIFICATION' AND d.revoked_at IS NULL AND (d.expires_at IS NULL OR d.expires_at>?)`).bind(now).all()).results;
  const items = [...roles, ...grants, ...delegations].sort((a, b) => a.granted_at - b.granted_at)
    .map(row => ({ ...row, authorised: !!row.authorised, label: row.kind === 'role' ? ROLES[row.subject]?.label ?? row.subject : permissionLabel(row.subject),
      overdue: now - row.granted_at > RATIFICATION_OVERDUE_MS, pendingDays: Math.floor((now - row.granted_at) / DAY) }));
  return { items };
}

/** RATIFY or REVOKE one pending act. Nobody ratifies an act they provisioned or that benefits them. */
export async function decideRatification(db, context, session, requestId, kind, id, decision, input, now = Date.now()) {
  requireUuid(id);
  if (!['role', 'grant', 'delegation'].includes(kind) || !['ratify', 'revoke'].includes(decision)) throw new AppError(404, 'not_found');
  await requirePermission(db, context, requestId, 'auth.permission.ratify', { resourceType: kind === 'role' ? 'user_role' : kind === 'grant' ? 'user_permission_grant' : 'delegated_permission', resourceId: id });
  requireFresh(session, now);
  if (kind === 'delegation') {
    if (decision === 'ratify') return ratifyDelegation(db, context, session, requestId, id, input, now);
    const row = await db.prepare('SELECT user_id FROM delegated_permission WHERE id=?').bind(id).first();
    if (row?.user_id === context.userId) throw new AppError(403, 'separation_of_duties');
    return revokeDelegation(db, context, session, requestId, id, now, { asRatifier: true });
  }
  const table = kind === 'role' ? 'user_role' : 'user_permission_grant';
  const row = await db.prepare(`SELECT user_id,granted_by,ratification_status,revoked_at${kind === 'grant' ? ',source_role_id' : ''} FROM ${table} WHERE id=?`).bind(id).first();
  if (!row || row.revoked_at || (kind === 'grant' && row.source_role_id)) throw new AppError(404, 'not_found');
  if (row.user_id === context.userId || (decision === 'ratify' && row.granted_by === context.userId)) throw new AppError(403, 'separation_of_duties');
  if (row.ratification_status !== 'PENDING_RATIFICATION') throw new AppError(409, 'invalid_transition');
  if (decision === 'revoke') {
    if (kind === 'role') await revokeRoleAssignment(db, context, requestId, row.user_id, id, now);
    else await revokeDirectGrant(db, context, requestId, row.user_id, id, now);
    return { id, status: 'REVOKED' };
  }
  if (!input || Object.keys(input).some(key => key !== 'ratificationReference') || !synthetic.reference(input.ratificationReference))
    throw new AppError(400, 'invalid_ratification');
  await db.batch([
    db.prepare(`UPDATE ${table} SET ratification_status='RATIFIED',ratified_at=?,ratified_by=?,ratification_reference=? WHERE id=? AND revoked_at IS NULL`)
      .bind(now, context.userId, input.ratificationReference, id),
    audit(db, context, requestId, kind === 'role' ? 'ROLE_RATIFIED' : 'PERMISSION_RATIFIED', table, id, now)]);
  return { id, status: 'RATIFIED' };
}

/** Another person's sessions: metadata only; revoking them never opens that person's data. */
export async function userSessions(db, context, requestId, userId, now = Date.now()) {
  requireUuid(userId);
  await requirePermission(db, context, requestId, 'auth.session.revoke', { resourceType: 'app_user', resourceId: userId });
  return { sessions: (await db.prepare(`SELECT id,created_at,last_seen_at,absolute_expires_at FROM app_session WHERE user_id=? AND revoked_at IS NULL
    AND absolute_expires_at>? ORDER BY created_at DESC LIMIT 20`).bind(userId, now).all()).results };
}
export async function revokeUserSessions(db, context, session, requestId, userId, now = Date.now()) {
  requireUuid(userId);
  await requirePermission(db, context, requestId, 'auth.session.revoke', { resourceType: 'app_user', resourceId: userId });
  requireFresh(session, now);
  if (userId === context.userId) throw new AppError(409, 'use_own_sessions');
  const result = await db.batch([
    db.prepare("UPDATE app_session SET revoked_at=?,revoke_reason='ADMIN_REVOKED' WHERE user_id=? AND revoked_at IS NULL").bind(now, userId),
    audit(db, context, requestId, 'AUTH_ALL_SESSIONS_REVOKED', 'app_user', userId, now, 'ADMIN_REVOKED')]);
  return { revoked: result[0]?.meta?.changes ?? null };
}
