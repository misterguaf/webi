// M1/M2 audit remediation: explicit permission catalogue, role boundary matrix, fail-closed
// evaluation and the /api/me capabilities projection.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authorize, decideScope } from '../gestio/src/policy.js';
import { PERMISSIONS } from '../gestio/src/permissions.js';
import { capabilities } from '../gestio/src/services/capability-service.js';
import { fixture, id } from './helpers/gestio-sqlite.js';

const MANADA = id(1), TROPA = id(2), ESCOLTA = id(3);
const USERS = { GROUP_COORDINATOR: 101, SECTION_COORDINATOR_TROPA: 102, SECTION_COORDINATOR_ESCOLTA: 103,
  TREASURY: 104, SECRETARY_AND_TROPA_DELEGATE: 105, CRM_MANAGER: 106, TECH_ADMIN: 107 };

async function evaluate(f, user, request) {
  return authorize(f.db, f.context[user], request);
}
async function loginAll(f) { for (const number of Object.values(USERS)) await f.login(number); }

test('catalogue covers exactly the permissions in the schema and every entry is well formed', () => {
  const f = fixture();
  try {
    const schema = f.sql.prepare('SELECT code FROM permission ORDER BY code').all().map(row => row.code);
    assert.deepEqual(Object.keys(PERMISSIONS).sort(), schema);
    for (const [code, definition] of Object.entries(PERMISSIONS)) {
      assert.ok(['GLOBAL', 'SCOPED'].includes(definition.kind), code);
      if (definition.scopedHolders) assert.equal(definition.kind, 'GLOBAL', `${code}: scopedHolders only applies to GLOBAL`);
    }
    // GLOBAL permissions reachable by a section-scoped role must be an explicit catalogue decision.
    const scopedGlobal = f.sql.prepare(`SELECT role_code,permission_code FROM role_permission
      WHERE role_code IN ('SECTION_COORDINATOR','SECTION_DELEGATE') ORDER BY 1,2`).all()
      .filter(row => PERMISSIONS[row.permission_code].kind === 'GLOBAL');
    assert.deepEqual(scopedGlobal.map(row => `${row.role_code}:${row.permission_code}`),
      ['SECTION_COORDINATOR:activities.general.manage']);
    assert.equal(PERMISSIONS['activities.general.manage'].scopedHolders, 'ALLOWED');
  } finally { f.close(); }
});

test('evaluation form is explicit and fails closed', () => {
  const scoped = [TROPA], global = [null];
  assert.equal(decideScope('activities.manage', scoped).reason, 'SCOPE_REQUIRED', 'SCOPED without scope');
  assert.equal(decideScope('activities.manage', global).reason, 'SCOPE_REQUIRED', 'even a global holder must state the form');
  assert.equal(decideScope('activities.manage', scoped, { sectionId: TROPA, mode: 'list' }).reason, 'INVALID_EVALUATION');
  assert.equal(decideScope('activities.manage', scoped, { mode: 'everything' }).reason, 'INVALID_EVALUATION');
  assert.equal(decideScope('audit.event.read', global, { sectionId: TROPA }).reason, 'INVALID_EVALUATION', 'GLOBAL with section');
  assert.equal(decideScope('audit.event.read', global, { mode: 'list' }).reason, 'INVALID_EVALUATION');
  assert.equal(decideScope('audit.event.read', scoped).reason, 'GROUP_SCOPE_REQUIRED', 'scoped holder of GLOBAL-only permission');
  assert.equal(decideScope('activities.general.manage', scoped).allow, true, 'explicit product decision');
  assert.equal(decideScope('finance.fee.read', scoped, { mode: 'all-sections' }).reason, 'GROUP_SCOPE_REQUIRED');
  assert.deepEqual(decideScope('finance.fee.read', global, { mode: 'all-sections' }), { allow: true, reason: 'ALLOW', sections: null });
  assert.deepEqual(decideScope('activities.read', [TROPA, TROPA], { mode: 'list' }).sections, [TROPA]);
  assert.equal(decideScope('activities.read', scoped, { sectionId: ESCOLTA }).reason, 'OUT_OF_SCOPE');
  assert.equal(decideScope('not.a.permission', global).reason, 'INVALID_CONTEXT');
  assert.equal(decideScope('activities.read', [], { mode: 'list' }).reason, 'NO_EFFECTIVE_PERMISSION');
});

test('role boundary matrix over the real schema and synthetic seed', async () => {
  const f = fixture();
  try {
    await loginAll(f);
    const allow = async (user, permission, extra = {}) => (await evaluate(f, user, { permission, ...extra })).allow;
    const list = async (user, permission) => (await evaluate(f, user, { permission, mode: 'list' })).sections;
    const cases = [
      // [user, permission, request, expected]
      // GROUP_COORDINATOR: group-wide operation and administration, no basic-only fee view needed.
      [101, 'participants.profile.read', { sectionId: MANADA }, true],
      [101, 'activities.general.manage', {}, true],
      [101, 'finance.fee.read', { mode: 'all-sections' }, true],
      [101, 'finance.fee.config.manage', {}, true],
      [101, 'auth.role.manage', {}, true],
      [101, 'audit.event.read', {}, true],
      [101, 'finance.fee.status.read', { mode: 'list' }, false],
      // SECTION_COORDINATOR (Tropa): own section only, GENERAL activities by explicit decision, basic fees only.
      [102, 'participants.profile.read', { sectionId: TROPA }, true],
      [102, 'participants.profile.read', { sectionId: ESCOLTA }, false],
      [102, 'activities.manage', { sectionId: TROPA }, true],
      [102, 'activities.manage', { sectionId: ESCOLTA }, false],
      [102, 'activities.general.manage', {}, true],
      [102, 'finance.fee.status.read', { sectionId: TROPA }, true],
      [102, 'finance.fee.status.read', { sectionId: ESCOLTA }, false],
      [102, 'finance.fee.read', { mode: 'list' }, false],
      [102, 'finance.fee.manage', { sectionId: TROPA }, false],
      [102, 'finance.fee.payment.review', { sectionId: TROPA }, false],
      [102, 'finance.payment.verify', { sectionId: TROPA }, false],
      [102, 'audit.event.read', {}, false],
      [102, 'auth.role.manage', {}, false],
      [102, 'auth.permission.authorize', { sectionId: TROPA }, true],
      [102, 'auth.permission.authorize', { sectionId: ESCOLTA }, false],
      // Escolta coordinator lacks the individual grant: role alone never authorises.
      [103, 'activities.general.manage', {}, false],
      [103, 'activities.manage', { sectionId: ESCOLTA }, true],
      // TREASURY: finance group-wide, no participant profiles, activities or administration.
      [104, 'finance.fee.read', { mode: 'all-sections' }, true],
      [104, 'finance.fee.config.manage', {}, true],
      [104, 'finance.fee.installment.authorize', { sectionId: ESCOLTA }, true],
      [104, 'finance.payment.verify', { sectionId: MANADA }, true],
      [104, 'participants.profile.read', { mode: 'list' }, false],
      [104, 'activities.manage', { sectionId: TROPA }, false],
      [104, 'auth.role.manage', {}, false],
      [104, 'audit.event.read', {}, false],
      // SECRETARY + SECTION_DELEGATE Tropa: profiles group-wide; review only via ratified Tropa delegation.
      [105, 'participants.profile.read', { sectionId: ESCOLTA }, true],
      [105, 'activities.registration.review', { sectionId: TROPA }, true],
      [105, 'activities.registration.review', { sectionId: ESCOLTA }, false],
      [105, 'activities.registration.review', { mode: 'all-sections' }, false],
      [105, 'finance.payment.verify', { sectionId: TROPA }, false],
      [105, 'finance.fee.payment.review', { sectionId: TROPA }, false],
      [105, 'finance.fee.read', { mode: 'list' }, false],
      // CRM_MANAGER: no operational data yet.
      [106, 'participants.profile.read', { mode: 'list' }, false],
      [106, 'finance.fee.status.read', { mode: 'list' }, false],
      [106, 'activities.read', { mode: 'list' }, false],
      // TECH_ADMIN: no routine personal, financial, health or audit access.
      [107, 'participants.profile.read', { mode: 'list' }, false],
      [107, 'health.record.read', { participantId: id(502), purpose: 'activity-safety' }, false],
      [107, 'finance.fee.read', { mode: 'list' }, false],
      [107, 'finance.fee.status.read', { mode: 'list' }, false],
      [107, 'activities.read', { mode: 'list' }, false],
      [107, 'audit.event.read', {}, false],
      [107, 'auth.role.manage', {}, false],
      [107, 'auth.permission.manage', {}, false],
      [107, 'auth.permission.provision', {}, true]
    ];
    for (const [user, permission, request, expected] of cases)
      assert.equal(await allow(user, permission, request), expected, `${user} ${permission} ${JSON.stringify(request)}`);
    assert.deepEqual(await list(102, 'participants.profile.read'), [TROPA]);
    assert.equal(await list(101, 'participants.profile.read'), null);
    assert.deepEqual(await list(105, 'activities.registration.review'), [TROPA]);
  } finally { f.close(); }
});

test('a GLOBAL-only permission wrongly attached to a scoped role never grants group authority', async () => {
  const f = fixture();
  try {
    await f.login(102);
    f.sql.exec(`INSERT INTO role_permission VALUES('SECTION_COORDINATOR','auth.role.manage');
      INSERT INTO user_permission_grant(id,user_id,permission_code,valid_from,justification)
      VALUES('${id(999)}','${id(102)}','auth.role.manage',1700000000000,'Misconfiguration test')`);
    const decision = await evaluate(f, 102, { permission: 'auth.role.manage' });
    assert.deepEqual(decision, { allow: false, reason: 'GROUP_SCOPE_REQUIRED' });
    const response = await f.request(102, `/api/users/${id(103)}/roles`, { method: 'POST', body: { roleCode: 'TREASURY' } });
    assert.equal(response.status, 403);
  } finally { f.close(); }
});

test('section coordinators manage GENERAL activities through the route; without the grant they cannot', async () => {
  const f = fixture();
  try {
    await f.login(102); await f.login(103);
    const day = 86400000, start = Date.now() + 30 * day;
    const body = { name: 'Jornada general fictícia', audience: 'GENERAL', sectionIds: [], location: 'Lloc fictici',
      startsAt: start, endsAt: start + day, registrationDeadline: start - day, priceCents: 0 };
    const created = await f.request(102, '/api/activities', { method: 'POST', body });
    assert.equal(created.status, 201);
    assert.equal((await f.request(102, `/api/activities/${created.data.id}`)).status, 200);
    assert.equal((await f.request(102, `/api/activities/${created.data.id}/publish`, { method: 'POST', body: { expectedVersion: 1 } })).status, 200);
    assert.equal((await f.request(103, '/api/activities', { method: 'POST', body })).status, 403);
    // 3.5D (B4): reading a GENERAL activity needs only activities.read; managing it still needs the grant.
    assert.equal((await f.request(103, `/api/activities/${created.data.id}`)).status, 200);
    assert.equal((await f.request(103, `/api/activities/${created.data.id}/close`, { method: 'POST', body: { expectedVersion: 2 } })).status, 403);
    assert.equal((await f.request(102, `/api/activities/${created.data.id}/close`, { method: 'POST', body: { expectedVersion: 2 } })).status, 200);
  } finally { f.close(); }
});

test('/api/me capabilities match policy decisions for every seeded role and cause no AUTHZ_DENY', async () => {
  const f = fixture();
  try {
    await loginAll(f);
    const me = async user => (await f.request(user, '/api/me')).data.capabilities;
    const coordinator = await me(101);
    assert.equal(coordinator.version, 1);
    assert.deepEqual(coordinator.participants.read, { all: true, sections: [] });
    assert.equal(coordinator.activities.manageGeneral, true);
    assert.deepEqual(coordinator.fees.read, { all: true, sections: [] });
    assert.equal(coordinator.fees.status, null);
    assert.equal(coordinator.administration.manageRoles, true);

    const tropa = await me(102);
    assert.deepEqual(tropa.participants.read, { all: false, sections: [{ id: TROPA, code: 'TROPA' }] });
    assert.equal(tropa.activities.manageGeneral, true);
    assert.deepEqual(tropa.activities.manage.sections.map(s => s.code), ['TROPA']);
    assert.deepEqual(tropa.fees.status.sections.map(s => s.code), ['TROPA']);
    assert.equal(tropa.fees.read, null);
    assert.equal(tropa.fees.reviewPayments, null);
    assert.equal(tropa.administration.audit, false);

    assert.equal((await me(103)).activities.manageGeneral, false);

    const treasury = await me(104);
    assert.equal(treasury.participants.read, null);
    assert.deepEqual(treasury.fees.authorizeInstallments, { all: true, sections: [] });
    assert.equal(treasury.fees.configure, true);
    assert.equal(treasury.activities.read, null);

    const delegate = await me(105);
    assert.deepEqual(delegate.activities.reviewRegistrations.sections.map(s => s.code), ['TROPA']);
    assert.equal(delegate.activities.verifyPayments, null);
    assert.equal(delegate.fees.authorizeInstallments, null);

    const tech = await me(107);
    assert.equal(tech.participants.read, null);
    assert.equal(tech.fees.read, null);
    assert.equal(tech.fees.status, null);
    assert.equal(tech.administration.audit, false);
    assert.equal(tech.administration.provisionDelegations, true);

    for (const user of Object.values(USERS)) assert.equal(f.denials(user), 0, `user ${user}`);
    const serialized = JSON.stringify(await me(102));
    assert.doesNotMatch(serialized, /cents|iban|birth|email|phone/i);
  } finally { f.close(); }
});
