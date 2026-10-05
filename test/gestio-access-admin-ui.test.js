// FASE 3.5H.1 — Administració UI: tabs by capability, packages as presets, the new-account request, delegation
// expiry rules, human error copy and the wiring of each action to its server endpoint.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as model from '../gestio/public/views/administration/model.js';
import { PACKAGES, ROLES, roleDefaults } from '../gestio/src/access-model.js';

const root = join(import.meta.dirname, '..');
const source = file => readFileSync(join(root, 'gestio/public', file), 'utf8');
const admin = administration => ({ administration: { manageUsers: false, manageRoles: false, managePermissions: false, provisionDelegations: false,
  ratifyDelegations: false, revokeSessions: false, ...administration } });
const DAY = 86400000;

test('tabs follow the advisory capabilities; everyone keeps their own account and sessions', () => {
  assert.deepEqual(model.availableTabs(admin({})).map(tab => tab.id), ['compte', 'sessions']);
  assert.deepEqual(model.availableTabs(admin({ manageUsers: true, manageRoles: true, managePermissions: true, provisionDelegations: true, ratifyDelegations: true }))
    .map(tab => tab.id), ['compte', 'usuaris', 'rols', 'delegacions', 'ratificacions', 'sessions']);
  assert.ok(!model.availableTabs(admin({ provisionDelegations: true })).some(tab => tab.id === 'usuaris'), 'TECH_ADMIN provisioning alone does not manage users');
});

test('packages are presets over existing roles: they never add a role ceiling or a new authority source', () => {
  const catalog = { roles: Object.entries(ROLES).map(([code, role]) => ({ code, ...role, ceiling: ['participants.profile.read', 'activities.read', 'finance.treasury.read'],
    defaults: roleDefaults(code, ['participants.profile.read', 'activities.read', 'finance.treasury.read']) })) };
  for (const pkg of PACKAGES) for (const role of pkg.roles) assert.ok(ROLES[role.roleCode], `${pkg.id} uses an existing role`);
  const section = model.applyPackage({ roles: [], grants: [] }, PACKAGES.find(pkg => pkg.id === 'section-read'), { sectionId: 'tropa', catalog });
  assert.deepEqual(section.draft.roles.map(role => [role.roleCode, role.sectionId, role.permissions]), [['SECTION_DELEGATE', 'tropa', ['participants.profile.read', 'activities.read']]]);
  assert.ok(section.draft.roles[0].expiresAt, 'a section delegate always carries an expiry');
  assert.equal(model.applyPackage({ roles: [], grants: [] }, PACKAGES.find(pkg => pkg.id === 'section-management'), { catalog }).error, 'Aquest paquet necessita una secció.');
  const twice = model.applyPackage(section.draft, PACKAGES.find(pkg => pkg.id === 'section-read'), { sectionId: 'tropa', catalog });
  assert.equal(twice.draft.roles.length, 1, 'the same role and section merge');
  assert.ok(!roleDefaults('TECH_ADMIN', ['auth.user.manage', 'auth.permission.provision']).includes('auth.user.manage'), 'TECH_ADMIN never gets user administration by default');
  assert.ok(!roleDefaults('TREASURY', ['finance.bank_description.reveal', 'finance.treasury.read']).includes('finance.bank_description.reveal'));
});

test('new-account request: name, roles with expiry, scoped grants; delegation expiry default 90 and maximum 365 days', () => {
  const draft = { displayName: ' Víctor Demo (fictici) ', email: '', grants: [{ permissionCode: 'participants.contact.read', sectionId: 'tropa' }],
    roles: [{ roleCode: 'SECRETARY', sectionId: null, permissions: ['participants.review.manage'], expiresAt: '' },
      { roleCode: 'SECTION_DELEGATE', sectionId: 'tropa', permissions: ['activities.read'], expiresAt: model.isoDay(Date.now() + 30 * DAY) }] };
  const { errors, body } = model.provisionRequest(draft);
  assert.deepEqual(errors, {});
  assert.equal(body.displayName, 'Víctor Demo (fictici)');
  assert.deepEqual(body.roles.map(role => role.roleCode), ['SECRETARY', 'SECTION_DELEGATE']);
  assert.ok(body.roles[1].expiresAt > Date.now() && !('expiresAt' in body.roles[0]));
  assert.deepEqual(body.grants, [{ permissionCode: 'participants.contact.read', sectionId: 'tropa' }]);
  assert.equal(model.provisionRequest({ ...draft, roles: [{ ...draft.roles[1], expiresAt: '' }] }).errors.roles, 'La delegació de secció necessita caducitat.');
  assert.equal(model.provisionRequest({ ...draft, displayName: '' }).errors.displayName, 'Escriu el nom de la persona.');
  assert.equal(model.DELEGATION_DEFAULT_DAYS, 90);
  assert.equal(model.validDelegationExpiry(model.isoDay(Date.now() + 366 * DAY)).error, 'Una delegació dura com a màxim 365 dies.');
  assert.equal(model.validDelegationExpiry(model.isoDay(Date.now() - DAY)).error, 'La caducitat ha de ser futura.');
  assert.ok(model.validDelegationExpiry(model.isoDay(Date.now() + 90 * DAY)).value);
  const rows = [{ state: 'ACTIVE' }, { state: 'ACTIVE_PENDING_RATIFICATION' }, { state: 'EXPIRED' }, { state: 'REVOKED' }, { state: 'EXPIRING' }];
  assert.equal(model.filterDelegations(rows, 'actives').length, 3);
  assert.equal(model.filterDelegations(rows, 'caducades').length, 1);
});

test('error copy is human and the expected rejections are explained', () => {
  for (const code of ['grant_exceeds_authority', 'self_change_forbidden', 'role_derived_permission', 'separation_of_duties', 'elevated_role_requires_group_coordinator',
    'unauthorized_delegation', 'fresh_session_required'])
    assert.doesNotMatch(model.errorCopy({ code }), /_|[A-Z]{4,}/, code);
  assert.equal(model.errorCopy({ status: 403 }), 'No tens permís per fer aquesta acció.');
  assert.equal(model.ORIGIN.ROLE, 'Per rol'); assert.equal(model.ORIGIN.DIRECT, 'Directe'); assert.equal(model.ORIGIN.DELEGATION, 'Delegat');
  assert.equal(model.RATIFICATION.PENDING_RATIFICATION.label, 'Activa · pendent de ratificar');
});

test('wiring: each action reaches its endpoint; shell and app register Administració; no inline styles or HTML injection', () => {
  const view = source('views/administration.js'), html = source('index.html'), app = source('app.js'), shell = source('shell.js');
  for (const [label, endpoint] of [['Crea l’usuari', "'/api/admin/users'"], ['Afegeix rol', '/roles`'], ['Concedeix permís', '/permissions`'],
    ['Retira el rol', '/roles/${role.id}`'], ['Nova delegació', "'/api/delegations'"], ['Confirma que ho autoritze', '/confirm`'],
    ['Ratifica', '/api/admin/ratifications/${item.kind}/${item.id}/${decision}`'], ['Tanca totes les sessions', '/sessions/revoke-all`'],
    ['D’on ve cada permís', '/api/admin/users/${userId}/access`']])
  { assert.ok(view.includes(label), label); assert.ok(view.includes(endpoint), endpoint); }
  assert.match(html, /id="administrationView"[^>]*data-page="administracio"/);
  assert.match(html, /href="\/admin\.css"/);
  assert.match(app, /createAdministrationView\(\{ call, reportLoadError, routes, setPageHeader \}\)/);
  assert.match(shell, /navigateTo\('administracio',\{path:\['sessions'\]\}\)/);
  assert.doesNotMatch(view, /innerHTML|style=|localStorage|token_hash/);
});
