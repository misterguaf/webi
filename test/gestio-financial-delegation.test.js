// FASE 3.5G.1A: security corrections before treasury (TREASURY.md §25.3, §27.1).
// Fee payment privacy, audited fee evidence, SECTION_DELEGATE without financial authority, and explicit,
// capability-limited, scoped, expiring, revocable financial delegations that need no role.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, id, migrations, root } from './helpers/gestio-sqlite.js';
import { authorize } from '../gestio/src/policy.js';
import { submitFee } from '../gestio/src/services/annual-fee-service.js';

const MANADA = id(1), TROPA = id(2), ESCOLTA = id(3);
const DELEGATE = 140; // an active user with no role at all
const PDF = Buffer.from('%PDF-1.4\nsynthetic fee evidence for 3.5G.1A\n%%EOF');
const later = days => Date.now() + days * 86400000;
let seq = 0;

async function setup() {
  const f = fixture();
  f.sql.exec(`INSERT INTO app_user(id,display_name,status,created_at,updated_at) VALUES('${id(DELEGATE)}','Persona de suport (fictícia)','ACTIVE',1,1)`);
  for (const user of [101, 102, 103, 104, 105, 107, DELEGATE]) await f.login(user);
  const store = { async put() {}, async delete() {}, async get() { return { body: PDF }; } };
  const pay = async children => (await submitFee(f.db, store, { roundCode: '2026/2027', children,
    submittedByName: 'Persona remitent (fictícia)', contactPhone: '600111222', receiptEmail: 'remitent-quota@example.test',
    declaredAmountCents: 10000, privacyAcknowledged: true, privacyNoticeVersion: 'DEMO-3B-PRIVACY-NOTICE-V1',
    idempotencyKey: `financial-delegation-${String(++seq).padStart(6, '0')}`,
    evidence: { filename: 'prova.pdf', mime: 'application/pdf', dataBase64: PDF.toString('base64') } }, crypto.randomUUID())).reference;
  const tropaChild = { name: 'Participante Tropa A (ficticio)', birthDate: '2013-05-18', sectionCode: 'TROPA' };
  const manadaChild = { name: 'Participante Manada A (ficticio)', birthDate: '2017-06-12', sectionCode: 'MANADA' };
  const tropa = await pay([tropaChild]);
  const multi = await pay([manadaChild, { name: 'Participante Tropa B (ficticio)', birthDate: '2012-11-03', sectionCode: 'TROPA' }]);
  const evidenceOf = payment => f.sql.prepare('SELECT id FROM annual_fee_evidence WHERE payment_id=?').get(payment).id;
  const call = (user, path, options = {}) => f.request(user, path, { ...options, env: { EVIDENCE_STORAGE: store } });
  const can = async (user, permission, details) => (await authorize(f.db, f.context[user], { permission, ...details })).allow;
  const audits = action => f.sql.prepare('SELECT * FROM audit_event WHERE action=? ORDER BY occurred_at,rowid').all(action);
  return { f, tropa, multi, evidenceOf, call, can, audits };
}

// Delegation through the real workflow: TECH_ADMIN provisions, the named authoriser (general
// coordination, who holds the capability) confirms and ratifies.
async function delegate(s, { userId = id(DELEGATE), permissionCode = 'finance.fee.payment.review', sectionId = TROPA,
  authorizedBy = id(101), expiresAt = later(30) } = {}) {
  const created = await s.call(107, '/api/delegations', { method: 'POST', body: { userId, permissionCode, sectionId, authorizedBy,
    authorizationReference: `DEMO-FIN-${String(++seq).padStart(6, '0')}`, expiresAt } });
  if (created.status !== 201) return created;
  assert.equal((await s.call(101, `/api/delegations/${created.data.id}/confirm`, { method: 'POST', body: {} })).status, 200);
  assert.equal((await s.call(101, `/api/delegations/${created.data.id}/ratify`, { method: 'POST',
    body: { ratificationReference: `DEMO-FIN-RAT-${String(seq).padStart(4, '0')}` } })).status, 200);
  return created;
}

const INTERNAL = /idempotency|payload_sha256|receipt_email|contact_phone|submitted_by_name|privacy_notice|submitted_birth_date|remitent|600111222/i;

test('Quotes privacy: listings and detail carry no contact or internal fields; contact is on demand, permissioned and audited', async () => {
  const s = await setup();
  try {
    const list = await s.call(104, `/api/fees/rounds/${id(901)}/payments`);
    assert.equal(list.status, 200);
    assert.ok(list.data.payments.length >= 2);
    for (const row of list.data.payments) {
      assert.deepEqual(Object.keys(row).sort(), ['created_at', 'declared_amount_cents', 'evidence_id', 'id', 'pending_matches',
        'people_count', 'review_status', 'round_id', 'verified_amount_cents']);
    }
    assert.doesNotMatch(JSON.stringify(list.data), INTERNAL);
    const detail = await s.call(104, `/api/fees/payments/${s.tropa}`);
    assert.equal(detail.status, 200);
    assert.deepEqual(Object.keys(detail.data.payment).sort(), ['allocation_version', 'created_at', 'declared_amount_cents', 'evidence',
      'id', 'review_status', 'reviewed_at', 'round_id', 'unallocated_cents', 'verified_amount_cents']);
    assert.deepEqual(Object.keys(detail.data.payment.evidence).sort(), ['id', 'mime', 'receivedAt', 'sizeBytes']);
    for (const person of detail.data.people) assert.deepEqual(Object.keys(person).sort(),
      ['id', 'match_status', 'participant_id', 'section_id', 'submitted_name']);
    assert.doesNotMatch(JSON.stringify(detail.data), INTERNAL);
    assert.doesNotMatch(JSON.stringify(detail.data), /sha256|object_key|synthetic\//i);

    // Contact: explicit capability (treasury and general coordination), audited without values.
    const contact = await s.call(104, `/api/fees/payments/${s.tropa}/contact`);
    assert.equal(contact.status, 200);
    assert.deepEqual(contact.data.contact, { submittedByName: 'Persona remitent (fictícia)', email: 'remitent-quota@example.test', phone: '600111222' });
    assert.equal((await s.call(101, `/api/fees/payments/${s.tropa}/contact`)).status, 200);
    const consulted = s.audits('SENSITIVE_DATA_READ').filter(row => row.reason_code === 'FEE_CONTACT_CONSULTED');
    assert.equal(consulted.length, 2);
    assert.ok(consulted.every(row => row.resource_type === 'annual_fee_payment' && row.resource_id === s.tropa && row.metadata_json === null));
    assert.doesNotMatch(JSON.stringify(s.f.sql.prepare('SELECT * FROM audit_event').all()), /remitent|600111222|example\.test/);
    for (const user of [102, 105, 107]) assert.equal((await s.call(user, `/api/fees/payments/${s.tropa}/contact`)).status, 403, `user ${user}`);
    // A fee-review delegate does not get contact implicitly.
    await delegate(s);
    assert.equal((await s.call(DELEGATE, `/api/fees/payments/${s.tropa}/contact`)).status, 403);
  } finally { s.f.close(); }
});

test('fee evidence: view and download are audited like 3.5F; no permission or out of scope stays safe', async () => {
  const s = await setup();
  try {
    const evidence = s.evidenceOf(s.tropa);
    const view = await s.call(104, `/api/fees/evidence/${evidence}?mode=view`);
    assert.equal(view.status, 200);
    assert.equal(view.headers.get('content-type'), 'application/pdf');
    assert.equal(view.headers.get('content-disposition'), 'inline');
    assert.equal(view.headers.get('cache-control'), 'no-store');
    const download = await s.call(104, `/api/fees/evidence/${evidence}`);
    assert.equal(download.status, 200);
    assert.match(download.headers.get('content-disposition'), /^attachment; filename="justificant-quota-\d{4}-\d{2}-\d{2}\.pdf"$/);
    assert.equal((await s.call(104, `/api/fees/evidence/${evidence}?mode=raw`)).status, 400);
    const viewed = s.audits('FEE_EVIDENCE_VIEWED'), downloaded = s.audits('FEE_EVIDENCE_DOWNLOADED');
    assert.equal(viewed.length, 1); assert.equal(downloaded.length, 1);
    for (const row of [...viewed, ...downloaded]) {
      assert.equal(row.actor_user_id, id(104)); assert.equal(row.resource_type, 'annual_fee_evidence');
      assert.equal(row.resource_id, evidence); assert.equal(row.metadata_json, null); assert.equal(row.reason_code, null);
    }
    // No permission: 403 for section coordination, Secretaria/section delegate and technical administration.
    for (const user of [102, 105, 107]) assert.equal((await s.call(user, `/api/fees/evidence/${evidence}`)).status, 403, `user ${user}`);
    // A Tropa fee-review delegate sees the Tropa proof, and gets an indistinguishable 404 for a multi-section one.
    await delegate(s);
    assert.equal((await s.call(DELEGATE, `/api/fees/evidence/${evidence}?mode=view`)).status, 200);
    assert.equal((await s.call(DELEGATE, `/api/fees/evidence/${s.evidenceOf(s.multi)}`)).status, 404);
    assert.equal((await s.call(DELEGATE, `/api/fees/evidence/${id(99999)}`)).status, 404);
    assert.equal(s.audits('FEE_EVIDENCE_VIEWED').length, 2, 'only successful reads are recorded as reads');
  } finally { s.f.close(); }
});

test('SECTION_DELEGATE alone carries no financial authority, even with a stale individual grant', async () => {
  const s = await setup();
  try {
    const ceiling = s.f.sql.prepare(`SELECT permission_code FROM role_permission WHERE role_code='SECTION_DELEGATE'
      AND permission_code LIKE 'finance.%'`).all();
    assert.deepEqual(ceiling, []);
    // 105 is the Tropa section delegate of the synthetic seed.
    assert.equal(await s.can(105, 'finance.payment.verify', { sectionId: TROPA }), false);
    assert.equal(await s.can(105, 'finance.fee.payment.review', { sectionId: TROPA }), false);
    s.f.sql.exec(`INSERT INTO user_permission_grant(id,user_id,permission_code,valid_from,justification) VALUES
      ('${id(9801)}','${id(105)}','finance.payment.verify',1,'Fixture'),('${id(9802)}','${id(105)}','finance.fee.payment.review',1,'Fixture')`);
    assert.equal(await s.can(105, 'finance.payment.verify', { sectionId: TROPA }), false);
    assert.equal(await s.can(105, 'finance.fee.payment.review', { mode: 'list' }), false);
    assert.equal((await s.call(105, `/api/fees/rounds/${id(901)}/payments`)).status, 403);
    assert.equal((await s.call(105, '/api/payments')).status, 403);
    const me = (await s.call(105, '/api/me')).data.capabilities;
    assert.equal(me.registrations.verifyPayments, null); assert.equal(me.fees.reviewPayments, null);
    // Non-financial delegated capabilities of the section delegate are unchanged.
    assert.equal(await s.can(105, 'activities.registration.review', { sectionId: TROPA }), true);
  } finally { s.f.close(); }
});

test('financial delegation: explicit, capability-limited, scoped, expiring, revocable and audited — no role needed', async () => {
  const s = await setup();
  try {
    assert.equal(await s.can(DELEGATE, 'finance.fee.payment.review', { sectionId: TROPA }), false, 'no delegation, no authority');
    assert.equal((await s.call(DELEGATE, `/api/fees/rounds/${id(901)}/payments`)).status, 403);

    // Only someone who holds the capability may authorise it: a section coordinator may authorise
    // delegations in Tropa, but holds no financial capability.
    assert.equal((await s.call(107, '/api/delegations', { method: 'POST', body: { userId: id(DELEGATE), permissionCode: 'finance.fee.payment.review',
      sectionId: TROPA, authorizedBy: id(102), authorizationReference: 'DEMO-FIN-NOAUTH-1', expiresAt: later(30) } })).status, 403);

    const granted = await delegate(s);
    assert.equal(granted.status, 201);
    const pending = await s.call(107, '/api/delegations', { method: 'POST', body: { userId: id(DELEGATE),
      permissionCode: 'finance.payment.verify', sectionId: TROPA, authorizedBy: id(101),
      authorizationReference: 'DEMO-FIN-PENDING1', expiresAt: later(30) } });
    assert.equal(pending.status, 201);
    assert.equal(await s.can(DELEGATE, 'finance.payment.verify', { sectionId: TROPA }), false, 'a pending delegation is not effective');

    // Granted capability, inside its scope only.
    assert.equal(await s.can(DELEGATE, 'finance.fee.payment.review', { sectionId: TROPA }), true);
    assert.equal(await s.can(DELEGATE, 'finance.fee.payment.review', { sectionId: ESCOLTA }), false);
    assert.equal(await s.can(DELEGATE, 'finance.fee.payment.review', { sectionId: MANADA }), false);
    assert.equal(await s.can(DELEGATE, 'finance.fee.payment.review', { mode: 'all-sections' }), false);
    const listed = await s.call(DELEGATE, `/api/fees/rounds/${id(901)}/payments`);
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.data.payments.map(row => row.id), [s.tropa]);
    assert.equal((await s.call(DELEGATE, `/api/fees/payments/${s.tropa}`)).status, 200);
    assert.equal((await s.call(DELEGATE, `/api/fees/payments/${s.multi}`)).status, 404, 'out of scope is not confirmed to exist');
    // Capabilities not granted stay denied.
    for (const permission of ['finance.payment.verify', 'finance.fee.contact.read', 'finance.fee.read', 'finance.fee.manage'])
      assert.equal(await s.can(DELEGATE, permission, permission === 'finance.fee.read' ? { mode: 'list' } : { sectionId: TROPA }), false, permission);
    const me = (await s.call(DELEGATE, '/api/me')).data.capabilities;
    assert.deepEqual(me.fees.reviewPayments.sections.map(row => row.code), ['TROPA']);
    assert.equal(me.fees.read, null); assert.equal(me.registrations.verifyPayments, null);

    // Expiry ends the authority immediately; the record stays as history.
    s.f.sql.exec(`UPDATE delegated_permission SET expires_at=${Date.now() - 1000},granted_at=${Date.now() - 5000} WHERE id='${granted.data.id}'`);
    assert.equal(await s.can(DELEGATE, 'finance.fee.payment.review', { sectionId: TROPA }), false, 'expired');
    assert.equal((await s.call(DELEGATE, `/api/fees/rounds/${id(901)}/payments`)).status, 403);

    // Revocation ends it immediately too.
    s.f.sql.exec(`DELETE FROM delegated_permission WHERE id='${pending.data.id}'`);
    const verify = await delegate(s, { permissionCode: 'finance.payment.verify' });
    assert.equal(await s.can(DELEGATE, 'finance.payment.verify', { sectionId: TROPA }), true);
    assert.equal((await s.call(101, `/api/delegations/${verify.data.id}/revoke`, { method: 'POST', body: {} })).status, 200);
    assert.equal(await s.can(DELEGATE, 'finance.payment.verify', { sectionId: TROPA }), false, 'revoked');
    assert.equal(s.f.sql.prepare('SELECT count(*) AS n FROM delegated_permission WHERE user_id=?').get(id(DELEGATE)).n, 2, 'history kept');

    // A delegation without expiry (legacy or forged by SQL) is never effective as financial authority.
    s.f.sql.exec(`INSERT INTO delegated_permission(id,user_id,permission_code,section_id,authorized_by,provisioned_by,authorization_reference,
      granted_at,expires_at,ratification_status,ratified_at,ratified_by,ratification_reference) VALUES('${id(9811)}','${id(DELEGATE)}',
      'finance.fee.contact.read','${TROPA}','${id(101)}','${id(107)}','DEMO-FIN-LEGACY1',1,NULL,'RATIFIED',2,'${id(101)}','DEMO-FIN-LEGACY-R')`);
    assert.equal(await s.can(DELEGATE, 'finance.fee.contact.read', { sectionId: TROPA }), false);

    // Audited: grant, confirmation, ratification and revocation, marked as financial, without personal data.
    for (const action of ['DELEGATED_PERMISSION_GRANTED', 'DELEGATED_PERMISSION_RATIFIED', 'DELEGATED_PERMISSION_REVOKED']) {
      const rows = s.audits(action).filter(row => row.reason_code === 'FINANCIAL_DELEGATION');
      assert.ok(rows.length >= 1, action);
      assert.ok(rows.every(row => row.metadata_json === null && row.resource_type === 'delegated_permission'));
    }
    assert.ok(s.audits('DELEGATION_AUTHORIZATION_CONFIRMED').length >= 2);
    // Denials keep the existing AUTHZ_DENY pattern.
    assert.ok(s.f.denials(DELEGATE) > 0);
  } finally { s.f.close(); }
});

test('regression: treasury and general coordination keep finance; section coordination only scoped status; TECH_ADMIN none', async () => {
  const s = await setup();
  try {
    const cases = [
      [104, 'finance.fee.payment.review', { mode: 'all-sections' }, true],
      [104, 'finance.payment.verify', { sectionId: MANADA }, true],
      [104, 'finance.fee.contact.read', { mode: 'all-sections' }, true],
      [104, 'finance.fee.read', { mode: 'all-sections' }, true],
      [101, 'finance.fee.payment.review', { mode: 'all-sections' }, true],
      [101, 'finance.payment.verify', { sectionId: ESCOLTA }, true],
      [101, 'finance.fee.contact.read', { mode: 'all-sections' }, true],
      [102, 'finance.fee.status.read', { sectionId: TROPA }, true],
      [102, 'finance.fee.status.read', { sectionId: ESCOLTA }, false],
      [102, 'finance.fee.payment.review', { sectionId: TROPA }, false],
      [102, 'finance.fee.contact.read', { sectionId: TROPA }, false],
      [102, 'finance.payment.verify', { sectionId: TROPA }, false],
      [103, 'finance.fee.read', { mode: 'list' }, false],
      [107, 'finance.fee.read', { mode: 'list' }, false],
      [107, 'finance.fee.status.read', { mode: 'list' }, false],
      [107, 'finance.fee.contact.read', { mode: 'list' }, false],
      [107, 'finance.payment.verify', { mode: 'list' }, false],
      [107, 'finance.fee.payment.review', { mode: 'list' }, false]
    ];
    for (const [user, permission, details, expected] of cases)
      assert.equal(await s.can(user, permission, details), expected, `${user} ${permission} ${JSON.stringify(details)}`);
    const coordinator = (await s.call(102, '/api/me')).data.capabilities.fees;
    assert.deepEqual(coordinator.status.sections.map(row => row.code), ['TROPA']);
    for (const key of ['read', 'manage', 'reviewPayments', 'readContacts']) assert.equal(coordinator[key], null, key);
    const treasury = (await s.call(104, '/api/me')).data.capabilities.fees;
    assert.equal(treasury.readContacts.all, true); assert.equal(treasury.reviewPayments.all, true);
    const tech = (await s.call(107, '/api/me')).data.capabilities;
    assert.deepEqual([tech.fees.status, tech.fees.read, tech.fees.reviewPayments, tech.fees.readContacts, tech.registrations.verifyPayments],
      [null, null, null, null, null]);
    // Section coordination keeps the basic status view and nothing more.
    const status = await s.call(102, '/api/fees/status');
    assert.equal(status.status, 200);
    assert.equal((await s.call(102, `/api/fees/rounds/${id(901)}/payments`)).status, 403);
  } finally { s.f.close(); }
});

test('migration 0022 removes the section-delegate ceiling, revokes orphaned grants and keeps treasury contact access', () => {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  const files = readdirSync(migrations).filter(name => name.endsWith('.sql')).sort();
  for (const name of files.filter(name => name < '0022')) sql.exec(readFileSync(join(migrations, name), 'utf8'));
  sql.exec(readFileSync(join(root, 'gestio/seed.sql'), 'utf8'));
  // The pre-3.5G.1A state: a financial ceiling on SECTION_DELEGATE and an individual grant for the Tropa delegate.
  sql.exec(`INSERT OR IGNORE INTO role_permission VALUES('SECTION_DELEGATE','finance.payment.verify'),('SECTION_DELEGATE','finance.fee.payment.review');
    INSERT INTO user_permission_grant(id,user_id,permission_code,valid_from,justification) VALUES
      ('${id(9821)}','${id(105)}','finance.payment.verify',1,'Legacy'),('${id(9822)}','${id(105)}','finance.fee.payment.review',1,'Legacy')`);
  assert.equal(sql.prepare("SELECT count(*) AS n FROM permission WHERE code='finance.fee.contact.read'").get().n, 0);
  sql.exec(readFileSync(join(migrations, files.find(name => name.startsWith('0022'))), 'utf8'));
  assert.deepEqual(sql.prepare(`SELECT permission_code FROM role_permission WHERE role_code='SECTION_DELEGATE' AND permission_code LIKE 'finance.%'`).all(), []);
  const legacy = sql.prepare(`SELECT revoked_at FROM user_permission_grant WHERE id IN ('${id(9821)}','${id(9822)}')`).all();
  assert.ok(legacy.length === 2 && legacy.every(row => row.revoked_at > 0), 'orphaned grants revoked, kept as history');
  // Treasury and general coordination grants of the same permissions are untouched.
  assert.equal(sql.prepare(`SELECT count(*) AS n FROM user_permission_grant WHERE user_id IN ('${id(101)}','${id(104)}')
    AND permission_code IN ('finance.payment.verify','finance.fee.payment.review') AND revoked_at IS NOT NULL`).get().n, 0);
  const contact = sql.prepare(`SELECT user_id FROM user_permission_grant WHERE permission_code='finance.fee.contact.read' AND revoked_at IS NULL
    ORDER BY user_id`).all().map(row => row.user_id);
  assert.deepEqual(contact, [id(101), id(104)]);
  assert.deepEqual(sql.prepare(`SELECT role_code FROM role_permission WHERE permission_code='finance.fee.contact.read' ORDER BY role_code`).all()
    .map(row => row.role_code), ['GROUP_COORDINATOR', 'TREASURY']);
  sql.close();
});

test('no financial sub-delegation: a capability received by delegation can be used but never re-delegated', async () => {
  const s = await setup();
  const B = 141;
  try {
    s.f.sql.exec(`INSERT INTO app_user(id,display_name,status,created_at,updated_at) VALUES('${id(B)}','Segona persona de suport (fictícia)','ACTIVE',1,1)`);
    await s.f.login(B);
    const toB = (authorizedBy, sectionId = TROPA, provisioner = 107) => s.call(provisioner, '/api/delegations', { method: 'POST',
      body: { userId: id(B), permissionCode: 'finance.payment.verify', sectionId, authorizedBy,
        authorizationReference: `DEMO-SUBDEL-${String(++seq).padStart(6, '0')}`, expiresAt: later(30) } });
    // 1. General coordination (originating authority) delegates verification in Tropa to A.
    const toA = await delegate(s, { permissionCode: 'finance.payment.verify' });
    assert.equal(toA.status, 201);
    // 2. A can exercise it in Tropa (and only there).
    assert.equal(await s.can(DELEGATE, 'finance.payment.verify', { sectionId: TROPA }), true);
    assert.equal(await s.can(DELEGATE, 'finance.payment.verify', { sectionId: ESCOLTA }), false);
    assert.equal((await s.call(DELEGATE, '/api/payments')).status, 200);
    // 3. A cannot authorise the same capability to B, in Tropa or elsewhere.
    assert.equal((await toB(id(DELEGATE))).status, 403);
    assert.equal((await toB(id(DELEGATE), ESCOLTA)).status, 403);
    // Nor provision it directly: using a capability is not administering delegations.
    assert.equal((await toB(id(DELEGATE), TROPA, DELEGATE)).status, 403);
    // Even if A also had delegation-authorising authority over Tropa (a section coordinator), holding the
    // financial capability only by delegation is not enough: the authoriser must hold it by role + grant.
    s.f.sql.exec(`INSERT INTO user_role(id,user_id,role_code,section_id,valid_from,justification) VALUES
        ('${id(9831)}','${id(DELEGATE)}','SECTION_COORDINATOR','${TROPA}',1,'Fixture');
      INSERT INTO user_permission_grant(id,user_id,permission_code,valid_from,justification) VALUES
        ('${id(9832)}','${id(DELEGATE)}','auth.permission.authorize',1,'Fixture')`);
    assert.equal(await s.can(DELEGATE, 'auth.permission.authorize', { sectionId: TROPA }), true);
    assert.equal((await toB(id(DELEGATE))).status, 403, 'usage is not delegation authority');
    assert.equal(await s.can(B, 'finance.payment.verify', { sectionId: TROPA }), false);
    assert.equal(s.f.sql.prepare('SELECT count(*) AS n FROM delegated_permission WHERE user_id=?').get(id(B)).n, 0, 'nothing was created');
    // The originating authority still delegates within its scope.
    const fromCoordination = await toB(id(101));
    assert.equal(fromCoordination.status, 201);
    s.f.sql.exec(`DELETE FROM delegated_permission WHERE id='${fromCoordination.data.id}'`);
    // Expiry and revocation of A's delegation end A's use, and re-delegation stays denied.
    s.f.sql.exec(`UPDATE delegated_permission SET expires_at=${Date.now() - 1000},granted_at=${Date.now() - 5000} WHERE id='${toA.data.id}'`);
    assert.equal(await s.can(DELEGATE, 'finance.payment.verify', { sectionId: TROPA }), false, 'expired');
    assert.equal((await toB(id(DELEGATE))).status, 403);
    s.f.sql.exec(`UPDATE delegated_permission SET expires_at=${later(30)} WHERE id='${toA.data.id}'`);
    assert.equal(await s.can(DELEGATE, 'finance.payment.verify', { sectionId: TROPA }), true);
    assert.equal((await s.call(101, `/api/delegations/${toA.data.id}/revoke`, { method: 'POST', body: {} })).status, 200);
    assert.equal(await s.can(DELEGATE, 'finance.payment.verify', { sectionId: TROPA }), false, 'revoked');
    assert.equal((await toB(id(DELEGATE))).status, 403);
  } finally { s.f.close(); }
});
