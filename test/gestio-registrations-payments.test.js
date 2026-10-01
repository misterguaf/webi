// FASE 3.5F closure — activity payments in instalments (migration 0019). Obligation (expected amount)
// != evidence (the family's proof) != allocation (each verified amount). Paid amounts are derived from
// allocations; the state is PENDING / PARTIAL / PAID / ISSUE; nothing verified is ever overwritten.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, id, migrations, root } from './helpers/gestio-sqlite.js';
import { paymentState, submitRegistration } from '../gestio/src/services/registration-service.js';

const PDF = Buffer.from('%PDF-1.4\n%synthetic instalment fixture\n%%EOF');
const ACTIVITY = id(9950);
let seq = 0;

async function setup({ price = 8000 } = {}) {
  const f = fixture();
  for (const user of [101, 102, 103, 104, 105]) await f.login(user);
  f.sql.exec(`INSERT INTO activity(id,public_code,name,status,audience,location,starts_at,ends_at,registration_deadline,price_cents,currency,
    short_description,materials,special_notice,created_by,created_at,updated_at) VALUES('${ACTIVITY}','DEMO-PLAZOS-TROPA','Campament en plaços (fictici)',
    'PUBLISHED','SECTIONS','Lloc fictici',2209075200000,2209161600000,2208988800000,${price},'EUR','Prova','','','${id(101)}',1,1);
    INSERT INTO activity_section(activity_id,section_id) VALUES('${ACTIVITY}','${id(2)}');`);
  const store = { async put() {}, async delete() {}, async get() { return { body: PDF }; } };
  await submitRegistration(f.db, store, { publicCode: 'DEMO-PLAZOS-TROPA', participantName: 'Participante Tropa A (ficticio)', birthDate: '2013-05-18',
    submittedByName: 'Tutor fictici', sectionCode: 'TROPA', receiptEmail: 'plaços@example.test', idempotencyKey: `instalments-test-${String(++seq).padStart(6, '0')}`,
    participationTermsVersion: 'DEMO-3A-PARTICIPATION-V1', privacyNoticeVersion: 'DEMO-3A-PRIVACY-NOTICE-V1',
    evidence: { filename: 'justificant.pdf', mime: 'application/pdf', dataBase64: PDF.toString('base64') } }, crypto.randomUUID());
  const reg = f.sql.prepare('SELECT * FROM activity_registration WHERE activity_id=?').get(ACTIVITY);
  const evidence = f.sql.prepare('SELECT id FROM payment_evidence WHERE registration_id=?').get(reg.id).id;
  const call = (user, path, options = {}) => f.request(user, path, { ...options, env: { EVIDENCE_STORAGE: store } });
  const detail = async (user = 104) => (await call(user, `/api/payments/${evidence}`)).data.payment;
  const review = async (user, body, version) => call(user, `/api/payments/${evidence}/review`,
    { method: 'POST', body: { expectedVersion: version ?? (await detail()).registrationVersion, ...body } });
  const status = () => f.sql.prepare('SELECT status FROM activity_registration WHERE id=?').get(reg.id).status;
  const allocations = () => f.sql.prepare('SELECT * FROM activity_payment_allocation WHERE registration_id=? ORDER BY created_at,rowid').all(reg.id);
  return { f, reg, evidence, call, detail, review, status, allocations };
}

test('payment state is derived: PENDING / PARTIAL / PAID / ISSUE, never removing verified amounts', () => {
  assert.equal(paymentState(8000, 0, 'PENDING_REVIEW'), 'PENDING');
  assert.equal(paymentState(8000, 3000, 'VERIFIED'), 'PARTIAL');
  assert.equal(paymentState(8000, 3000, 'ISSUE'), 'ISSUE');
  assert.equal(paymentState(8000, 8000, 'ISSUE'), 'PAID', 'a fully paid obligation is never shown as an incidence');
  assert.equal(paymentState(0, 0, null), 'NOT_REQUIRED');
});

test('0/80 → PENDING; 30 → PARTIAL 30/80; 50 more → PAID 80/80; confirmed only at the total', async () => {
  const t = await setup();
  try {
    assert.equal(t.status(), 'AWAITING_PAYMENT_REVIEW');
    let d = await t.detail();
    assert.deepEqual([d.paymentState, d.amountCents, d.paidCents, d.remainingCents], ['PENDING', 8000, 0, 8000]);
    const first = await t.review(104, { decision: 'VERIFIED', amountCents: 3000 });
    assert.deepEqual([first.status, first.data.paymentState, first.data.paidCents, first.data.remainingCents], [200, 'PARTIAL', 3000, 5000]);
    assert.equal(t.status(), 'AWAITING_PAYMENT_REVIEW', 'still waiting for the rest');
    assert.ok(!t.f.sql.prepare("SELECT 1 FROM notification_outbox WHERE registration_id=? AND kind='CONFIRMED'").get(t.reg.id));
    d = await t.detail();
    assert.deepEqual([d.paymentState, d.paidCents, d.remainingCents, d.allocations.map(a => a.amountCents)], ['PARTIAL', 3000, 5000, [3000]]);
    const list = (await t.call(104, '/api/payments?vista=pendents')).data.payments.find(p => p.id === t.evidence);
    assert.equal(list.paymentState, 'PARTIAL', 'a partial payment stays in the queue for the next instalment');
    const second = await t.review(104, { decision: 'VERIFIED', amountCents: 5000 });
    assert.deepEqual([second.data.paymentState, second.data.paidCents, second.data.remainingCents], ['PAID', 8000, 0]);
    assert.equal(t.status(), 'CONFIRMED');
    assert.ok(t.f.sql.prepare("SELECT 1 FROM notification_outbox WHERE registration_id=? AND kind='CONFIRMED'").get(t.reg.id));
    assert.deepEqual(t.allocations().map(a => [a.amount_cents, a.created_by, a.source]), [[3000, id(104), 'VERIFICATION'], [5000, id(104), 'VERIFICATION']]);
    // Nothing more can be verified or flagged once paid.
    assert.equal((await t.review(104, { decision: 'VERIFIED', amountCents: 1 })).data.error, 'invalid_transition');
    assert.equal((await t.review(104, { decision: 'ISSUE' })).data.error, 'invalid_transition');
  } finally { t.f.close(); }
});

test('amount validation: required, positive, never above the remaining amount (server and database)', async () => {
  const t = await setup();
  try {
    for (const body of [{ decision: 'VERIFIED' }, { decision: 'VERIFIED', amountCents: 0 }, { decision: 'VERIFIED', amountCents: 8001 },
      { decision: 'VERIFIED', amountCents: 12.5 }, { decision: 'ISSUE', amountCents: 100 }])
      assert.equal((await t.review(104, body)).status, 400, JSON.stringify(body));
    assert.equal((await t.review(104, { decision: 'VERIFIED', amountCents: 100 }, null)).status, 200, 'baseline works');
    const missingVersion = await t.call(104, `/api/payments/${t.evidence}/review`, { method: 'POST', body: { decision: 'VERIFIED', amountCents: 100 } });
    assert.deepEqual([missingVersion.status, missingVersion.data.error], [400, 'invalid_version']);
    assert.throws(() => t.f.sql.prepare(`INSERT INTO activity_payment_allocation(id,registration_id,amount_cents,created_by,created_at)
      VALUES(?,?,7901,?,1)`).run(id(9960), t.reg.id, id(104)), /invalid_payment_allocation/, 'the database refuses overpayment');
    const [allocation] = t.allocations();
    assert.throws(() => t.f.sql.prepare('UPDATE activity_payment_allocation SET amount_cents=1 WHERE id=?').run(allocation.id), /immutable/);
    assert.throws(() => t.f.sql.prepare('DELETE FROM activity_payment_allocation WHERE id=?').run(allocation.id), /immutable/);
  } finally { t.f.close(); }
});

test('a later incidence keeps the 30 already verified; a new verification closes it', async () => {
  const t = await setup();
  try {
    await t.review(104, { decision: 'VERIFIED', amountCents: 3000 });
    const issue = await t.review(104, { decision: 'ISSUE' });
    assert.equal(issue.status, 200);
    let d = await t.detail();
    assert.deepEqual([d.paymentState, d.paidCents, d.remainingCents], ['ISSUE', 3000, 5000], 'the valid partial payment is not lost');
    assert.equal(t.allocations().length, 1);
    assert.deepEqual((await t.call(104, '/api/payments?vista=incidencies')).data.payments.map(p => p.id), [t.evidence]);
    assert.equal((await t.review(104, { decision: 'ISSUE' })).data.error, 'invalid_transition', 'already open');
    assert.ok(t.f.sql.prepare("SELECT 1 FROM notification_outbox WHERE registration_id=? AND kind='PAYMENT_ISSUE'").get(t.reg.id));
    await t.review(104, { decision: 'VERIFIED', amountCents: 2000 });
    d = await t.detail();
    assert.deepEqual([d.paymentState, d.paidCents, d.remainingCents, d.evidenceStatus], ['PARTIAL', 5000, 3000, 'VERIFIED']);
    // A second incidence on the same obligation is recorded; the family notice is not repeated (one per kind).
    assert.equal((await t.review(104, { decision: 'ISSUE' })).status, 200);
    assert.equal(t.f.sql.prepare("SELECT count(*) AS n FROM notification_outbox WHERE registration_id=? AND kind='PAYMENT_ISSUE'").get(t.reg.id).n, 1);
    assert.equal((await t.detail()).paidCents, 5000);
  } finally { t.f.close(); }
});

test('concurrency: two verifiers with the same version — one wins, the other gets 409 and writes nothing', async () => {
  const t = await setup();
  try {
    const version = (await t.detail()).registrationVersion;
    const [a, b] = await Promise.all([t.review(104, { decision: 'VERIFIED', amountCents: 5000 }, version),
      t.review(101, { decision: 'VERIFIED', amountCents: 5000 }, version)]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    assert.equal([a, b].find(r => r.status === 409).data.error, 'stale_payment');
    assert.equal(t.allocations().length, 1);
    assert.equal((await t.detail()).paidCents, 5000);
    // The audit records only the successful verification.
    assert.equal(t.f.sql.prepare("SELECT count(*) AS n FROM audit_event WHERE action='PAYMENT_VERIFIED' AND resource_id=?").get(t.evidence).n, 1);
  } finally { t.f.close(); }
});

test('audit: each instalment is its own event and allocation (actor, date, amount in the row; nothing personal in the log)', async () => {
  const t = await setup();
  try {
    await t.review(104, { decision: 'VERIFIED', amountCents: 3000 });
    await t.review(101, { decision: 'VERIFIED', amountCents: 5000 });
    const verified = t.f.sql.prepare("SELECT actor_user_id,reason_code,metadata_json FROM audit_event WHERE action='PAYMENT_VERIFIED' AND resource_id=? ORDER BY occurred_at,rowid").all(t.evidence);
    assert.deepEqual(verified.map(r => [r.actor_user_id, r.reason_code, r.metadata_json]), [[id(104), 'PARTIAL', null], [id(101), 'PAID', null]]);
    const allocationEvents = t.f.sql.prepare("SELECT resource_id,actor_user_id FROM audit_event WHERE resource_type='activity_payment_allocation'").all();
    assert.deepEqual(allocationEvents.map(e => e.resource_id).sort(), t.allocations().map(a => a.id).sort());
    assert.deepEqual(t.allocations().map(a => [a.amount_cents, a.created_by, typeof a.created_at]), [[3000, id(104), 'number'], [5000, id(101), 'number']]);
    assert.ok(!JSON.stringify(t.f.sql.prepare('SELECT * FROM audit_event').all()).includes('plaços@example.test'));
  } finally { t.f.close(); }
});

test('withdrawal with a partial payment keeps the 30 and allows recording the rest; with full payment nothing changes', async () => {
  const partial = await setup();
  try {
    await partial.review(104, { decision: 'VERIFIED', amountCents: 3000 });
    const version = partial.f.sql.prepare('SELECT version FROM activity_registration WHERE id=?').get(partial.reg.id).version;
    assert.equal((await partial.call(102, `/api/registrations/${partial.reg.id}/withdraw`, { method: 'POST',
      body: { source: 'FAMILY_COMMUNICATION', expectedVersion: version } })).status, 200);
    let d = await partial.detail();
    assert.deepEqual([d.registrationState, d.paymentState, d.paidCents], ['WITHDRAWN', 'PARTIAL', 3000], 'no refund implied, nothing erased');
    await partial.review(104, { decision: 'VERIFIED', amountCents: 5000 });
    d = await partial.detail();
    assert.deepEqual([d.registrationState, d.paymentState], ['WITHDRAWN', 'PAID'], 'money received is recorded; the registration stays withdrawn');
    assert.ok(!partial.f.sql.prepare("SELECT 1 FROM notification_outbox WHERE registration_id=? AND kind='CONFIRMED'").get(partial.reg.id));
  } finally { partial.f.close(); }
  const full = await setup();
  try {
    await full.review(104, { decision: 'VERIFIED', amountCents: 8000 });
    assert.equal(full.status(), 'CONFIRMED');
    const version = full.f.sql.prepare('SELECT version FROM activity_registration WHERE id=?').get(full.reg.id).version;
    assert.equal((await full.call(102, `/api/registrations/${full.reg.id}/withdraw`, { method: 'POST',
      body: { source: 'OTHER', expectedVersion: version } })).status, 200);
    const d = await full.detail();
    assert.deepEqual([d.registrationState, d.paymentState, d.paidCents, d.allocations.length], ['WITHDRAWN', 'PAID', 8000, 1]);
  } finally { full.f.close(); }
});

test('financial scope and permissions: verifiers only, within the registration section; out of scope = missing', async () => {
  const t = await setup();
  try {
    assert.equal((await t.review(102, { decision: 'VERIFIED', amountCents: 100 }, 1)).status, 403, 'section coordinators do not verify');
    assert.equal((await t.review(103, { decision: 'VERIFIED', amountCents: 100 }, 1)).status, 403);
    // A Tropa-delegated verifier works on Tropa; an Escolta one would get the same 404 as a missing payment.
    t.f.sql.exec(`INSERT INTO delegated_permission(id,user_id,permission_code,section_id,authorized_by,provisioned_by,authorization_reference,granted_at,expires_at,
      ratification_status,ratified_at,ratified_by,ratification_reference) VALUES('${id(9970)}','${id(105)}','finance.payment.verify','${id(2)}',
      '${id(102)}','${id(107)}','DEMO-AUTH-PLAZOS',1700000000000,4102444800000,'RATIFIED',1700000000001,'${id(101)}','DEMO-RATIFIED-PLAZOS')`);
    assert.equal((await t.review(105, { decision: 'VERIFIED', amountCents: 1000 })).status, 200);
    assert.equal((await t.call(105, `/api/payments/${id(831)}/review`, { method: 'POST', body: { decision: 'VERIFIED', amountCents: 100, expectedVersion: 1 } })).status, 404);
    assert.equal((await t.call(105, `/api/payments/${id(99990)}/review`, { method: 'POST', body: { decision: 'VERIFIED', amountCents: 100, expectedVersion: 1 } })).status, 404);
    // The stale/invalid answers never come before the scope check.
    assert.equal((await t.call(105, `/api/payments/${id(831)}/review`, { method: 'POST', body: {} })).status, 404);
  } finally { t.f.close(); }
});

test('migration 0019: verified evidence from before instalments becomes one full allocation', () => {
  const sql = new DatabaseSync(':memory:');
  try {
    sql.exec('PRAGMA foreign_keys=ON');
    for (const name of readdirSync(migrations).filter(n => n.endsWith('.sql') && n < '0019').sort()) sql.exec(readFileSync(join(migrations, name), 'utf8'));
    sql.exec(readFileSync(join(root, 'gestio/seed.sql'), 'utf8'));
    sql.exec(`UPDATE payment_evidence SET review_status='VERIFIED',reviewed_by='${id(104)}',reviewed_at=5 WHERE id='${id(831)}'`);
    sql.exec(readFileSync(join(migrations, '0019_activity_payment_allocations.sql'), 'utf8'));
    assert.deepEqual(sql.prepare('SELECT registration_id,evidence_id,amount_cents,source,created_by,created_at FROM activity_payment_allocation').all().map(r => ({ ...r })),
      [{ registration_id: id(822), evidence_id: id(831), amount_cents: 1200, source: 'LEGACY_FULL_VERIFICATION', created_by: id(104), created_at: 5 }]);
    assert.deepEqual({ ...sql.prepare('SELECT due_cents,paid_cents FROM activity_payment_balance WHERE registration_id=?').get(id(822)) }, { due_cents: 1200, paid_cents: 1200 });
    assert.equal(sql.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { sql.close(); }
});
