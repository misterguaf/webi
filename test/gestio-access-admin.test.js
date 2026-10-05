// FASE 3.5H.1 — access administration: multiple roles, role-sourced and direct (scoped) grants, account
// provisioning authority, TECH_ADMIN without functional access, origin authority and self-escalation,
// delegations effective once authorised, ratification inbox, immediate revocation, sessions.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, id } from './helpers/gestio-sqlite.js';
import { newSession } from '../gestio/src/auth.js';
import { authorize } from '../gestio/src/policy.js';

const TROPA = id(2), ESCOLTA = id(3), DAY = 86400000;
async function setup() {
  const f = fixture();
  for (const user of [101, 102, 103, 104, 105, 107]) await f.login(user);
  const call = (user, path, method = 'GET', body) => f.request(user, path, { method, body });
  // Log in a person created during the test under a short key.
  const loginAs = async (key, userId) => {
    f.token[key] = (await newSession(f.db, userId)).token;
    const session = f.sql.prepare('SELECT id FROM app_session WHERE user_id=? ORDER BY created_at DESC LIMIT 1').get(userId);
    f.context[key] = { userId, sessionId: session.id, status: 'ACTIVE' };
  };
  const can = async (key, permission, details = {}) => (await authorize(f.db, f.context[key], { permission, ...details }, Date.now())).allow;
  const provision = (actor, body) => call(actor, '/api/admin/users', 'POST', body);
  const count = (sql, ...args) => f.sql.prepare(sql).get(...args).n;
  return { f, call, loginAs, can, provision, count };
}

test('multiple roles combine; role-sourced grants show their origin; a scoped direct grant never becomes group-wide', async () => {
  const s = await setup();
  try {
    const created = await s.provision(101, { displayName: 'Víctor Demo (fictici)', roles: [
      { roleCode: 'SECRETARY', permissions: ['participants.review.manage'] },
      { roleCode: 'SECTION_DELEGATE', sectionId: TROPA, expiresAt: Date.now() + 30 * DAY, permissions: 'DEFAULTS' }],
    grants: [{ permissionCode: 'participants.contact.read', sectionId: TROPA }] });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    await s.loginAs('v', created.data.id);
    // SECRETARY (group) and SECTION_DELEGATE (Tropa) at the same time.
    assert.equal(await s.can('v', 'participants.review.manage'), true, 'from SECRETARY');
    assert.equal(await s.can('v', 'activities.read', { sectionId: TROPA }), true, 'from SECTION_DELEGATE');
    assert.equal(await s.can('v', 'activities.read', { sectionId: ESCOLTA }), false, 'the delegate role stays in Tropa');
    // participants.contact.read is in the SECRETARY (group) ceiling too, but the direct grant says Tropa.
    const scope = await authorize(s.f.db, s.f.context.v, { permission: 'participants.contact.read', mode: 'list' });
    assert.deepEqual(scope.sections, [TROPA], 'scoped grant: Tropa only, never group-wide');
    assert.equal(await s.can('v', 'participants.contact.read', { sectionId: ESCOLTA }), false);
    const access = (await s.call(101, `/api/admin/users/${created.data.id}/access`)).data;
    assert.deepEqual(access.roles.map(role => role.role_code).sort(), ['SECRETARY', 'SECTION_DELEGATE']);
    const origins = access.items.map(item => `${item.origin}:${item.permission}${item.role ? '@' + item.role : ''}`);
    assert.ok(origins.includes('ROLE:participants.review.manage@SECRETARY'));
    assert.ok(origins.includes('ROLE:activities.read@SECTION_DELEGATE'));
    assert.ok(origins.includes('DIRECT:participants.contact.read'));
    assert.equal(access.items.find(item => item.origin === 'DIRECT').scope.code, 'TROPA');
    assert.ok(access.items.filter(item => item.origin === 'ROLE').every(item => item.removable === false), 'inherited permissions are informational');
    assert.ok(access.summary.some(module => module.module === 'participants'));
    // A role-sourced grant cannot be unchecked on its own (no negative overrides in v1).
    const inherited = access.items.find(item => item.origin === 'ROLE');
    assert.equal((await s.call(101, `/api/users/${created.data.id}/permissions/${inherited.grantId}`, 'DELETE')).data.error, 'role_derived_permission');
    // Removing the role removes its grants on the next request; the other role stays.
    const delegateRole = access.roles.find(role => role.role_code === 'SECTION_DELEGATE');
    assert.equal((await s.call(101, `/api/users/${created.data.id}/roles/${delegateRole.id}`, 'DELETE')).status, 200);
    assert.equal(await s.can('v', 'activities.read', { sectionId: TROPA }), false, 'revocation is immediate');
    assert.equal(await s.can('v', 'participants.review.manage'), true);
    assert.equal(s.count("SELECT count(*) AS n FROM audit_event WHERE action='USER_CREATED' AND reason_code='ACCOUNT_PROVISIONED'"), 1);
  } finally { s.f.close(); }
});

test('account provisioning: Secretaria and Coordinació general yes; Tresoreria, coordinació de secció and TECH_ADMIN no; explicit administration capability works', async () => {
  const s = await setup();
  try {
    assert.equal((await s.provision(105, { displayName: 'Nova Persona (fictícia)', roles: [
      { roleCode: 'SECTION_DELEGATE', sectionId: TROPA, expiresAt: Date.now() + 10 * DAY, permissions: ['participants.profile.read'] }] })).status, 201,
      'Secretaria provisions accounts');
    assert.equal((await s.provision(101, { displayName: 'Altra Persona (fictícia)' })).status, 201, 'Coordinació general provisions accounts');
    for (const user of [104, 102, 107]) assert.equal((await s.provision(user, { displayName: 'Intent Demo (fictici)' })).status, 403, `user ${user}`);
    // Capability-based (3.5H.2 correction): Secretaria may assign an elevated role, but only grant what it holds itself.
    assert.equal((await s.provision(105, { displayName: 'Tresorer Demo (fictici)', roles: [{ roleCode: 'TREASURY' }] })).data.error,
      'grant_exceeds_authority', 'Secretaria holds no finance permission to grant');
    const sec = await s.provision(105, { displayName: 'Admin Secretaria (fictícia)', roles: [{ roleCode: 'TECH_ADMIN', permissions: ['auth.user.manage'] }] });
    assert.equal(sec.status, 201, 'an administrator assigns only authority they hold: here user administration');
    await s.loginAs('sa', sec.data.id);
    assert.equal(await s.can('sa', 'auth.user.manage'), true);
    assert.equal(await s.can('sa', 'auth.permission.provision'), false, 'nothing beyond what was granted');
    // TECH_ADMIN is not a functional superuser.
    for (const path of ['/api/participants', '/api/finance/rounds', `/api/admin/ratifications`]) assert.equal((await s.call(107, path)).status, 403, path);
    assert.equal(await s.can(107, 'participants.profile.read', { mode: 'list' }), false);
    assert.equal(await s.can(107, 'auth.user.manage'), false, 'not by holding TECH_ADMIN');
    // Borja-like administration: an explicit individual grant inside the TECH_ADMIN ceiling, by Coordinació general.
    const admin = await s.provision(101, { displayName: 'Admin Demo (fictici)', roles: [{ roleCode: 'TECH_ADMIN',
      permissions: ['auth.user.manage', 'auth.role.manage', 'auth.permission.manage', 'auth.session.revoke'] }] });
    assert.equal(admin.status, 201, JSON.stringify(admin.data));
    await s.loginAs('a', admin.data.id);
    assert.equal(await s.can('a', 'auth.user.manage'), true);
    assert.equal((await s.f.request('a', '/api/admin/users', { method: 'POST', body: { displayName: 'Creada per admin (fictícia)' } })).status, 201);
    assert.equal((await s.f.request('a', '/api/participants')).status, 403, 'administration never opens functional data');
    assert.equal((await s.f.request('a', '/api/finance/rounds')).status, 403);
  } finally { s.f.close(); }
});

test('self-escalation and grants beyond the actor’s own authority are rejected server-side', async () => {
  const s = await setup();
  try {
    assert.equal((await s.call(105, `/api/users/${id(105)}/permissions`, 'POST', { permissionCode: 'participants.review.manage' })).data.error, 'self_change_forbidden');
    assert.equal((await s.call(105, `/api/users/${id(105)}/roles`, 'POST', { roleCode: 'SECRETARY' })).data.error, 'self_change_forbidden');
    // Secretaria does not hold activities.manage: it cannot grant it, whatever the UI shows.
    assert.equal((await s.call(105, `/api/users/${id(103)}/permissions`, 'POST', { permissionCode: 'activities.manage', sectionId: ESCOLTA })).data.error,
      'grant_exceeds_authority');
    assert.equal((await s.provision(105, { displayName: 'Coord Demo (fictici)', roles: [{ roleCode: 'SECTION_COORDINATOR', sectionId: TROPA, permissions: ['activities.manage'] }] })).data.error,
      'grant_exceeds_authority');
    // Nothing outside a role ceiling, and a GLOBAL permission is never section-scoped.
    const user = (await s.provision(101, { displayName: 'Sense Rol (fictici)' })).data.id;
    assert.equal((await s.call(101, `/api/users/${user}/permissions`, 'POST', { permissionCode: 'finance.expense.read' })).data.error, 'invalid_permission');
    assert.equal((await s.provision(101, { displayName: 'Abast Demo (fictici)', roles: [{ roleCode: 'SECRETARY', permissions: [] }],
      grants: [{ permissionCode: 'participants.review.manage', sectionId: TROPA }] })).data.error, 'invalid_scope');
    assert.equal((await s.provision(105, { displayName: 'Sense Permís (fictici)', authorizedBy: id(104) })).data.error, 'unauthorized_authorizer');
    assert.equal(s.count("SELECT count(*) AS n FROM app_user WHERE display_name IN ('Coord Demo (fictici)','Abast Demo (fictici)','Sense Permís (fictici)')"), 0,
      'a refused provisioning leaves nothing');
  } finally { s.f.close(); }
});

test('delegations: default 90 days, max 365, effective once authorised and while pending ratification, no subdelegation, expiry stops them', async () => {
  const s = await setup();
  try {
    const target = (await s.provision(101, { displayName: 'Delegat Demo (fictici)', roles: [
      { roleCode: 'SECTION_DELEGATE', sectionId: TROPA, expiresAt: Date.now() + 200 * DAY, permissions: ['activities.read'] }] })).data.id;
    await s.loginAs('d', target);
    const delegate = (body, actor = 101) => s.call(actor, '/api/delegations', 'POST', { userId: target, permissionCode: 'participants.contact.read',
      sectionId: TROPA, authorizedBy: id(101), authorizationReference: 'DEMO-H1-DELEGATION', ...body });
    assert.equal((await delegate({ expiresAt: Date.now() + 366 * DAY })).data.error, 'invalid_delegation', 'maximum 365 days');
    const created = await delegate({});
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const row = s.f.sql.prepare('SELECT granted_at,expires_at,ratification_status FROM delegated_permission WHERE id=?').get(created.data.id);
    assert.equal(row.expires_at - row.granted_at, 90 * DAY, 'default 90 days');
    assert.equal(row.ratification_status, 'PENDING_RATIFICATION');
    assert.equal(await s.can('d', 'participants.contact.read', { sectionId: TROPA }), true, 'authorised by the provisioner itself: effective at once, pending ratification');
    // Provisioned by someone else and not yet confirmed by the named authoriser: not authorised yet.
    const other = await s.call(107, '/api/delegations', 'POST', { userId: target, permissionCode: 'participants.profile.read', sectionId: TROPA,
      authorizedBy: id(101), authorizationReference: 'DEMO-H1-DELEGATION-2' });
    assert.equal(other.status, 201);
    assert.equal(await s.can('d', 'participants.profile.read', { sectionId: TROPA }), false, 'not authorised until the authoriser confirms');
    assert.equal((await s.call(101, `/api/delegations/${other.data.id}/confirm`, 'POST', {})).status, 200);
    assert.equal(await s.can('d', 'participants.profile.read', { sectionId: TROPA }), true, 'authorised → effective, still pending ratification');
    // No subdelegation: the delegate can neither provision nor authorise.
    assert.equal((await s.f.request('d', '/api/delegations', { method: 'POST', body: { userId: id(102), permissionCode: 'participants.contact.read',
      sectionId: TROPA, authorizedBy: target, authorizationReference: 'DEMO-H1-SUBDELEGATION' } })).status, 403);
    assert.equal((await s.call(107, '/api/delegations', 'POST', { userId: id(102), permissionCode: 'participants.contact.read', sectionId: TROPA,
      authorizedBy: target, authorizationReference: 'DEMO-H1-SUBDELEGATION' })).data.error, 'unauthorized_delegation');
    // The delegations list exposes the derived state.
    const listed = (await s.call(107, '/api/delegations')).data.delegations.find(item => item.id === created.data.id);
    assert.equal(listed.state, 'ACTIVE_PENDING_RATIFICATION');
    // Expiry stops it automatically.
    s.f.sql.exec(`UPDATE delegated_permission SET expires_at=${Date.now() - 1000},granted_at=${Date.now() - 5000} WHERE id='${created.data.id}'`);
    assert.equal(await s.can('d', 'participants.contact.read', { sectionId: TROPA }), false, 'expired');
  } finally { s.f.close(); }
});

test('ratification inbox: pending acts are effective, ratification keeps them, revocation removes them at once, nobody ratifies their own act', async () => {
  const s = await setup();
  try {
    // Secretaria provisions; Coordinació general ratifies.
    const created = await s.provision(105, { displayName: 'Pendent Demo (fictici)', roles: [
      { roleCode: 'SECTION_DELEGATE', sectionId: TROPA, expiresAt: Date.now() + 30 * DAY, permissions: ['participants.profile.read'] }],
      grants: [{ permissionCode: 'participants.contact.read', sectionId: TROPA }] });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    await s.loginAs('p', created.data.id);
    assert.equal(await s.can('p', 'participants.profile.read', { sectionId: TROPA }), true, 'effective while pending');
    const inbox = (await s.call(101, '/api/admin/ratifications')).data.items.filter(item => item.user_id === created.data.id);
    assert.deepEqual(inbox.map(item => item.kind).sort(), ['grant', 'role'], 'role-sourced grants ride with their role');
    assert.ok(inbox.every(item => item.provisioned_by_name && item.label && item.section_code === 'TROPA' && item.overdue === false));
    assert.equal((await s.call(105, '/api/admin/ratifications')).status, 403, 'ratifying needs auth.permission.ratify');
    const role = inbox.find(item => item.kind === 'role'), grant = inbox.find(item => item.kind === 'grant');
    assert.equal((await s.call(101, `/api/admin/ratifications/role/${role.id}/ratify`, 'POST', {})).data.error, 'invalid_ratification');
    assert.equal((await s.call(101, `/api/admin/ratifications/role/${role.id}/ratify`, 'POST', { ratificationReference: 'DEMO-CONSELL-2026-10' })).data.status, 'RATIFIED');
    assert.equal(await s.can('p', 'participants.profile.read', { sectionId: TROPA }), true, 'ratification preserves authority');
    assert.equal(s.f.sql.prepare('SELECT ratification_status FROM user_role WHERE id=?').get(role.id).ratification_status, 'RATIFIED');
    // REVOKE from the inbox: immediate.
    assert.equal((await s.call(101, `/api/admin/ratifications/grant/${grant.id}/revoke`, 'POST')).data.status, 'REVOKED');
    assert.equal(await s.can('p', 'participants.contact.read', { sectionId: TROPA }), false, 'revocation is immediate');
    // Nobody ratifies an act they provisioned (Coordinació general provisions here).
    const own = (await s.provision(101, { displayName: 'Propi Demo (fictici)', roles: [{ roleCode: 'SECRETARY', permissions: ['participants.review.manage'] }] })).data.id;
    const ownRole = (await s.call(101, '/api/admin/ratifications')).data.items.find(item => item.user_id === own);
    assert.equal((await s.call(101, `/api/admin/ratifications/role/${ownRole.id}/ratify`, 'POST', { ratificationReference: 'DEMO-CONSELL-2026-10' })).data.error,
      'separation_of_duties');
    // Never revoked automatically: an old pending act stays effective and is flagged as overdue.
    s.f.sql.exec(`UPDATE user_role SET valid_from=${Date.now() - 120 * DAY} WHERE id='${ownRole.id}'`);
    assert.equal((await s.call(101, '/api/admin/ratifications')).data.items.find(item => item.id === ownRole.id).overdue, true);
    assert.equal(s.count("SELECT count(*) AS n FROM audit_event WHERE action='ROLE_RATIFIED'"), 1);
  } finally { s.f.close(); }
});

test('sessions: own sessions without permission; other people’s only with auth.session.revoke, metadata only, effective at once', async () => {
  const s = await setup();
  try {
    const own = await s.call(105, '/api/me/sessions');
    assert.equal(own.status, 200);
    assert.ok(own.data.sessions.length >= 1);
    assert.equal((await s.call(105, `/api/admin/users/${id(102)}/sessions`)).status, 403, 'Secretaria cannot manage other people’s sessions');
    assert.equal((await s.call(107, `/api/admin/users/${id(102)}/sessions/revoke-all`, 'POST')).status, 403, 'TECH_ADMIN alone cannot either');
    const listed = await s.call(101, `/api/admin/users/${id(102)}/sessions`);
    assert.equal(listed.status, 200);
    assert.ok(listed.data.sessions.length >= 1);
    assert.ok(!JSON.stringify(listed.data).includes('token'), 'no token or hash reaches the client');
    assert.equal((await s.call(102, '/api/me')).status, 200);
    assert.equal((await s.call(101, `/api/admin/users/${id(102)}/sessions/revoke-all`, 'POST')).status, 200);
    assert.equal((await s.call(102, '/api/me')).status, 401, 'revoked on the next request');
    assert.equal((await s.call(101, `/api/participants/${id(201)}`)).status !== 401, true, 'the revoker keeps their own session');
    assert.equal(s.count("SELECT count(*) AS n FROM audit_event WHERE action='AUTH_ALL_SESSIONS_REVOKED' AND reason_code='ADMIN_REVOKED'"), 1);
    // Session authority does not open functional data: an admin with only auth.session.revoke cannot read participants.
    const admin = (await s.provision(101, { displayName: 'Sessions Demo (fictici)', roles: [{ roleCode: 'TECH_ADMIN', permissions: ['auth.session.revoke'] }] })).data.id;
    await s.loginAs('x', admin);
    assert.equal((await s.f.request('x', `/api/admin/users/${id(103)}/sessions`)).status, 200);
    assert.equal((await s.f.request('x', '/api/participants')).status, 403);
    assert.equal((await s.f.request('x', `/api/admin/users/${id(103)}/access`)).status, 403, 'nor access details');
  } finally { s.f.close(); }
});
