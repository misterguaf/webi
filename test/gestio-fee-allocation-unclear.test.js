// 3.5G.1A fix: ALLOCATION_UNCLEAR (verified fee money not assigned) cannot be closed while euros remain
// unassigned; it is resolved by correcting the payment's allocations, then the issue can be resolved.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, id } from './helpers/gestio-sqlite.js';
import { createObligation, submitFee } from '../gestio/src/services/annual-fee-service.js';
import { setupFees } from '../gestio/public/fees.js';

const PDF = Buffer.from('%PDF-1.4\nsynthetic allocation unclear test\n%%EOF');

async function setup() {
  const f = fixture();
  for (const user of [101, 104]) await f.login(user);
  const obligation = (await createObligation(f.db, f.context[104], crypto.randomUUID(), { roundId: id(901), participantId: id(502) })).id;
  const payment = (await submitFee(f.db, { put: async () => {}, delete: async () => {} }, { roundCode: '2026/2027',
    children: [{ name: 'Participante Tropa A (ficticio)', birthDate: '2013-05-18', sectionCode: 'TROPA' }],
    submittedByName: 'Persona remitent (fictícia)', contactPhone: null, receiptEmail: 'unclear@example.test', declaredAmountCents: 5000,
    privacyAcknowledged: true, privacyNoticeVersion: 'DEMO-3B-PRIVACY-NOTICE-V1', idempotencyKey: 'allocation-unclear-000001',
    evidence: { filename: 'prova.pdf', mime: 'application/pdf', dataBase64: PDF.toString('base64') } }, crypto.randomUUID())).reference;
  // Verified 50 €, only 20 € assigned: 30 € verified and unassigned → ALLOCATION_UNCLEAR.
  const reviewed = await f.request(104, `/api/fees/payments/${payment}/review`, { method: 'POST',
    body: { verifiedAmountCents: 5000, allocations: [{ obligationId: obligation, amountCents: 2000 }] } });
  assert.equal(reviewed.status, 200);
  const issues = async () => (await f.request(104, `/api/fees/rounds/${id(901)}/issues`)).data.issues;
  const unclear = (await issues()).find(row => row.code === 'ALLOCATION_UNCLEAR');
  const plain = row => row && { ...row };
  const money = () => ({
    payment: plain(f.sql.prepare('SELECT verified_amount_cents,allocation_version FROM annual_fee_payment WHERE id=?').get(payment)),
    balance: plain(f.sql.prepare('SELECT allocated_cents,unallocated_cents FROM annual_fee_payment_balance WHERE id=?').get(payment)),
    allocations: f.sql.prepare('SELECT obligation_id,amount_cents FROM annual_fee_allocation WHERE payment_id=? ORDER BY obligation_id').all(payment).map(plain)
  });
  const resolvedAudits = () => f.sql.prepare("SELECT * FROM audit_event WHERE action='FEE_ISSUE_RESOLVED' AND resource_id=?").all(unclear.id);
  return { f, payment, obligation, unclear, issues, money, resolvedAudits };
}

test('ALLOCATION_UNCLEAR with unassigned euros cannot be closed; money and history stay untouched', async () => {
  const s = await setup();
  try {
    assert.equal(s.unclear.status, 'OPEN');
    assert.equal(s.unclear.unallocated_cents, 3000, 'the issue list states the unassigned amount');
    const before = s.money();
    assert.deepEqual(before.balance, { allocated_cents: 2000, unallocated_cents: 3000 });
    const refused = await s.f.request(104, `/api/fees/issues/${s.unclear.id}/resolve`, { method: 'POST', body: {} });
    assert.equal(refused.status, 409);
    assert.equal(refused.data.error, 'unallocated_fee_balance');
    assert.equal(s.f.sql.prepare('SELECT status FROM annual_fee_issue WHERE id=?').get(s.unclear.id).status, 'OPEN');
    assert.deepEqual(s.money(), before, 'no money is created, removed or moved');
    assert.equal(s.resolvedAudits().length, 0, 'a refused resolution is not recorded as resolved');
    // The database refuses it as well, even bypassing the service.
    assert.throws(() => s.f.sql.exec(`UPDATE annual_fee_issue SET status='RESOLVED',resolved_by='${id(104)}',resolved_at=1
      WHERE id='${s.unclear.id}'`), /unallocated_fee_balance/);
  } finally { s.f.close(); }
});

test('once the balance is really assigned, the ALLOCATION_UNCLEAR issue resolves and is audited', async () => {
  const s = await setup();
  try {
    const { payment: { allocation_version: version } } = s.money();
    const revised = await s.f.request(104, `/api/fees/payments/${s.payment}/allocations`, { method: 'PATCH',
      body: { expectedVersion: version, allocations: [{ obligationId: s.obligation, amountCents: 5000 }] } });
    assert.equal(revised.status, 200);
    const after = s.money();
    assert.equal(after.payment.verified_amount_cents, 5000, 'the verified amount never changes');
    assert.deepEqual(after.balance, { allocated_cents: 5000, unallocated_cents: 0 });
    assert.deepEqual(after.allocations, [{ obligation_id: s.obligation, amount_cents: 5000 }]);
    assert.equal((await s.issues()).find(row => row.id === s.unclear.id).unallocated_cents, 0);
    const resolved = await s.f.request(104, `/api/fees/issues/${s.unclear.id}/resolve`, { method: 'POST', body: {} });
    assert.equal(resolved.status, 200);
    assert.equal(s.f.sql.prepare('SELECT status,resolved_by FROM annual_fee_issue WHERE id=?').get(s.unclear.id).resolved_by, id(104));
    assert.deepEqual(s.money().balance, after.balance, 'resolving moves no money');
    const audits = s.resolvedAudits();
    assert.equal(audits.length, 1);
    assert.equal(audits[0].actor_user_id, id(104)); assert.equal(audits[0].resource_type, 'annual_fee_issue');
    assert.equal(audits[0].metadata_json, null);
    assert.equal(s.f.sql.prepare("SELECT count(*) AS n FROM audit_event WHERE action='FEE_ALLOCATION_REVISED' AND resource_id=?").get(s.payment).n, 1);
    assert.equal((await s.f.request(104, `/api/fees/issues/${s.unclear.id}/resolve`, { method: 'POST', body: {} })).status, 409);
  } finally { s.f.close(); }
});

test('Quotes issue list: no "Resol" for ALLOCATION_UNCLEAR while euros remain unassigned; it leads to the payment', async () => {
  const nodes = new Map();
  const element = () => ({ children: [], hidden: false, textContent: '', value: '', checked: false, readOnly: false,
    listeners: {}, replaceChildren(...items) { this.children = items; }, append(...items) { this.children.push(...items); },
    addEventListener(type, fn) { this.listeners[type] = fn; }, reset() {}, scrollIntoView() {} });
  globalThis.document = { getElementById: key => { if (!nodes.has(key)) nodes.set(key, element()); return nodes.get(key); },
    createElement: () => element() };
  const calls = [];
  const issues = [
    { id: id(1), code: 'ALLOCATION_UNCLEAR', status: 'OPEN', payment_id: id(11), obligation_id: null, unallocated_cents: 3000 },
    { id: id(2), code: 'ALLOCATION_UNCLEAR', status: 'OPEN', payment_id: id(12), obligation_id: null, unallocated_cents: 0 },
    { id: id(3), code: 'DISCREPANCY', status: 'OPEN', payment_id: null, obligation_id: id(13), unallocated_cents: null }];
  const call = async path => {
    calls.push(path);
    if (path === '/api/fees/rounds') return { rounds: [{ id: id(901), code: '2026/2027', base_cents: 10000 }] };
    if (path.includes('/issues')) return { issues };
    if (path.includes('/revisions')) return { revisions: [] };
    if (path.includes('/metrics')) return { metrics: { expectedCents: 0, confirmedAllocatedCents: 0, disputedAllocatedCents: 0,
      unallocatedVerifiedCents: 3000, pendingCents: 0, collectedPercent: 0, statusCounts: { PENDING: 0, PAID: 0 }, partialCount: 0,
      issueCount: 3, bySection: {} } };
    if (path.startsWith('/api/fees/payments/')) return { payment: { id: id(11), review_status: 'VERIFIED', verified_amount_cents: 5000,
      unallocated_cents: 3000, allocation_version: 1, evidence: null }, people: [], allocations: [], allocationRevisions: [], eligibleObligations: [] };
    return { obligations: [], payments: [], groups: [] };
  };
  try {
    const load = setupFees({ call, message: () => {} });
    assert.equal(await load({ reviewOnly: false }), true);
    const rows = nodes.get('feeIssues').children;
    const labels = row => row.children.filter(child => typeof child === 'object').map(child => child.textContent);
    assert.deepEqual(labels(rows[0]), ['Revisa el pagament']);
    assert.match(rows[0].children.find(child => typeof child === 'string'), /30\.00 € verificats sense assignar/);
    assert.deepEqual(labels(rows[1]), ['Resol'], 'nothing left unassigned: it can be resolved');
    assert.deepEqual(labels(rows[2]), ['Resol'], 'other issues keep their action');
    await rows[0].children.find(child => child.textContent === 'Revisa el pagament').listeners.click();
    assert.ok(calls.includes(`/api/fees/payments/${id(11)}`), 'the action opens the payment to correct its allocations');
    assert.ok(!calls.some(path => path.endsWith('/resolve')));
  } finally { delete globalThis.document; }
});
