// FASE 3.5I-Q — Quotes v1: one read model over the existing fee domain, projected by the viewer's capabilities.
// Section coordinators: ACTIVE participants of their CURRENT section, name/section/status only. Treasury and
// group-wide finance readers: amounts, family, payments, plan, issues, corrections. TECH_ADMIN alone: nothing.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, id } from './helpers/gestio-sqlite.js';
import { buildDemoData } from '../gestio/demo/data.js';

const ROUND = id(901), TROPA = id(2), ESCULTA = id(3);
async function setup() {
  const f = fixture();
  f.sql.exec(buildDemoData().sql);
  for (const user of [101, 102, 103, 104, 105, 106, 107]) await f.login(user);
  const call = (user, path, method = 'GET', body) => f.request(user, path, { method, body });
  const status = participantId => f.sql.prepare('SELECT status FROM annual_fee_obligation_status WHERE participant_id=? AND round_id=?').get(participantId, ROUND)?.status;
  return { f, call, status };
}
const MONEY_KEYS = /amount|Cents|received|pending|payment|evidence|family|sibling|discount|issue|proof|plan|correction|overpay/i;

test('section coordinator: ACTIVE participants of the CURRENT section, name/section/status only; no money, evidence, payers or actions', async () => {
  const s = await setup();
  try {
    const list = (await s.call(102, '/api/quotes')).data;
    assert.equal(list.mode, 'basic');
    assert.deepEqual(list.sections, ['TROPA']);
    const tropa = s.f.sql.prepare("SELECT count(*) n FROM annual_fee_obligation o JOIN participant p ON p.id=o.participant_id WHERE p.current_section_id=? AND p.status='ACTIVE'").get(TROPA).n;
    assert.equal(list.total, tropa);
    assert.equal(Object.values(list.counts).reduce((a, b) => a + b, 0), tropa, 'counts of the scope');
    for (const row of list.rows) {
      assert.deepEqual(Object.keys(row).sort(), ['displayName', 'participantId', 'sectionCode', 'status']);
      assert.equal(row.sectionCode, 'TROPA');
    }
    assert.doesNotMatch(JSON.stringify(list), /Cents|€/);
    // An inactive Tropa member disappears for the coordinator (still visible to Treasury).
    const leaver = list.rows[0].participantId;
    s.f.sql.prepare("UPDATE participant SET status='INACTIVE' WHERE id=?").run(leaver);
    assert.ok(!(await s.call(102, '/api/quotes')).data.rows.some(row => row.participantId === leaver));
    assert.equal((await s.call(102, `/api/quotes/participants/${leaver}`)).status, 404);
    assert.ok((await s.call(104, '/api/quotes')).data.rows.some(row => row.participantId === leaver && row.active === false));
    // Another section: refused as a filter and concealed as a detail.
    assert.equal((await s.call(102, '/api/quotes?section=ESCOLTA')).status, 403);
    const esculta = s.f.sql.prepare("SELECT participant_id FROM annual_fee_obligation_status WHERE current_section_id=? LIMIT 1").get(ESCULTA).participant_id;
    assert.equal((await s.call(102, `/api/quotes/participants/${esculta}`)).status, 404);
    // Basic detail: status only.
    const own = (await s.call(102, '/api/quotes')).data.rows[0].participantId;
    const detail = (await s.call(102, `/api/quotes/participants/${own}`)).data;
    assert.equal(detail.mode, 'basic');
    assert.doesNotMatch(Object.keys(detail.quota).join(','), MONEY_KEYS);
    assert.equal(detail.actions, undefined, 'no Treasury actions');
    // The fee endpoints behind the financial view stay closed.
    const payment = s.f.sql.prepare(`SELECT p.id,e.id AS evidence FROM annual_fee_payment p JOIN annual_fee_evidence e ON e.payment_id=p.id
      JOIN annual_fee_allocation a ON a.payment_id=p.id JOIN annual_fee_obligation o ON o.id=a.obligation_id JOIN participant pp ON pp.id=o.participant_id
      WHERE pp.current_section_id=? LIMIT 1`).get(TROPA);
    assert.equal((await s.call(102, `/api/fees/rounds/${ROUND}/payments`)).status, 403);
    assert.equal((await s.call(102, `/api/fees/rounds/${ROUND}/metrics`)).status, 403);
    assert.ok([403, 404].includes((await s.call(102, `/api/fees/evidence/${payment.evidence}?mode=view`)).status), 'no evidence');
    assert.ok([403, 404].includes((await s.call(102, `/api/fees/payments/${payment.id}`)).status), 'no payer or allocation');
    assert.equal((await s.call(102, `/api/fees/payments/${payment.id}/review`, 'POST', { verifiedAmountCents: 1, allocations: [] })).status, 403, 'no review');
    assert.equal((await s.call(102, '/api/finance/movements')).status, 403, 'no bank movements');
  } finally { s.f.close(); }
});

test('Treasury and group coordination: financial projection over the whole group; actions only where their capabilities reach', async () => {
  const s = await setup();
  try {
    for (const user of [104, 101]) {
      const list = (await s.call(user, '/api/quotes')).data;
      assert.equal(list.mode, 'financial', `user ${user}`);
      assert.equal(list.total, 104);
      assert.deepEqual(list.counts, { PENDING: 75, PARTIAL: 10, PAID: 12, ISSUE: 7 }, 'the server projection, not client arithmetic');
    }
    const partial = (await s.call(104, '/api/quotes?status=PARTIAL&q=noa')).data.rows[0];
    assert.equal(partial.status, 'PARTIAL');
    assert.equal(partial.receivedCents + partial.pendingCents, partial.amountDueCents);
    const detail = (await s.call(104, `/api/quotes/participants/${partial.participantId}`)).data;
    assert.equal(detail.mode, 'financial');
    assert.ok(detail.quota.payments.length && detail.quota.payments[0].evidenceId, 'payments with their evidence reference');
    assert.ok(detail.quota.plan?.parts.length >= 2, 'instalment plan');
    assert.ok(detail.quota.family.members.length >= 2, 'family context for a group-wide reader');
    assert.deepEqual(detail.actions, { reviewPayments: true, manage: true, treasury: true, links: { participant: false, treasury: true } });
    // Existing secure evidence path and review workflow are reachable for Treasury.
    const { demoPdf } = await import('../gestio/demo/data.js');
    const key = s.f.sql.prepare('SELECT object_key FROM annual_fee_evidence WHERE id=?').get(detail.quota.payments[0].evidenceId).object_key;
    await s.f.storage.put(key, demoPdf()); // the demo CLI uploads it to local R2; the in-memory fixture needs it here
    const evidence = await s.call(104, `/api/fees/evidence/${detail.quota.payments[0].evidenceId}?mode=view`);
    assert.equal(evidence.status, 200);
    assert.equal(s.f.sql.prepare("SELECT count(*) n FROM audit_event WHERE action='FEE_EVIDENCE_VIEWED'").get().n, 1, 'audited');
    assert.equal((await s.call(104, `/api/fees/payments/${detail.quota.payments[0].paymentId}/review`, 'POST', {})).status, 400, 'reaches validation, not authorisation');
    // Group coordination's financial view depends on its actual finance capability.
    const grant = s.f.sql.prepare("SELECT id FROM user_permission_grant WHERE user_id=? AND permission_code='finance.fee.read' AND revoked_at IS NULL").get(id(101)).id;
    s.f.sql.prepare('UPDATE user_permission_grant SET revoked_at=1,revoked_by=? WHERE id=?').run(id(104), grant);
    assert.equal((await s.call(101, '/api/quotes')).status, 403, 'without the fee capability, no Quotes');
  } finally { s.f.close(); }
});

test('TECH_ADMIN, CRM and Secretaria (family groups only) get no Quotes data', async () => {
  const s = await setup();
  try {
    const someone = s.f.sql.prepare('SELECT participant_id FROM annual_fee_obligation LIMIT 1').get().participant_id;
    for (const user of [107, 106, 105]) {
      assert.equal((await s.call(user, '/api/quotes')).status, 403, `user ${user}`);
      assert.ok([403, 404].includes((await s.call(user, `/api/quotes/participants/${someone}`)).status));
      const caps = (await s.call(user, '/api/me')).data.capabilities.fees;
      assert.ok(!caps.status && !caps.read, `no fee visibility for ${user}`);
    }
  } finally { s.f.close(); }
});

test('explicit grant works only in its scope, and revoking it takes effect immediately', async () => {
  const s = await setup();
  try {
    const created = await s.call(101, '/api/admin/users', 'POST', { displayName: 'Suport Quotes Tropa (fictícia)', roles: [
      { roleCode: 'SECTION_COORDINATOR', sectionId: TROPA, permissions: ['finance.fee.status.read'] }] });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const { newSession } = await import('../gestio/src/auth.js');
    s.f.token.q = (await newSession(s.f.db, created.data.id)).token;
    const list = (await s.f.request('q', '/api/quotes')).data;
    assert.deepEqual([list.mode, list.sections], ['basic', ['TROPA']]);
    assert.equal((await s.f.request('q', '/api/quotes?section=CLAN')).status, 403);
    const role = s.f.sql.prepare('SELECT id FROM user_role WHERE user_id=? AND revoked_at IS NULL').get(created.data.id).id;
    assert.equal((await s.call(101, `/api/users/${created.data.id}/roles/${role}`, 'DELETE')).status, 200);
    assert.equal((await s.f.request('q', '/api/quotes')).status, 403, 'revoked → no access');
  } finally { s.f.close(); }
});

test('payment states come from the authoritative projection: pending, partial, paid, issue, instalments, sibling discount, correction, overpayment', async () => {
  const s = await setup();
  try {
    const rows = (await s.call(104, '/api/quotes')).data;
    const all = [...rows.rows];
    for (let cursor = rows.nextCursor; cursor;) { const next = (await s.call(104, `/api/quotes?cursor=${encodeURIComponent(cursor)}`)).data; all.push(...next.rows); cursor = next.nextCursor; }
    assert.equal(all.length, 104, 'load more walks the whole scope');
    for (const row of all) assert.equal(row.status, s.status(row.participantId), row.displayName);
    const paid = all.find(row => row.status === 'PAID'), pending = all.find(row => row.status === 'PENDING' && row.siblingOrdinal === 1);
    assert.deepEqual([paid.receivedCents, paid.pendingCents], [paid.amountDueCents, 0], 'exact full payment');
    assert.deepEqual([pending.receivedCents, pending.pendingCents], [0, pending.amountDueCents]);
    const third = all.find(row => row.siblingOrdinal >= 3);
    assert.ok(third.discountCents > 0 && third.amountDueCents < 10000, 'sibling discount from the existing rule');
    const issue = all.find(row => row.status === 'ISSUE');
    const issueDetail = (await s.call(104, `/api/quotes/participants/${issue.participantId}`)).data.quota;
    assert.ok(issueDetail.issues.some(item => item.status === 'OPEN'), 'unresolved issue explains the state');
    // Correction through the existing workflow: amount revision recorded, projection follows the server.
    const target = all.find(row => row.status === 'PENDING' && row.siblingOrdinal === 1);
    const obligation = (await s.call(104, `/api/quotes/participants/${target.participantId}`)).data.quota.obligationId;
    assert.equal((await s.call(104, `/api/fees/obligations/${obligation}`, 'PATCH', { amountDueCents: 8000, reason: 'Correcció de prova' })).status, 200);
    const corrected = (await s.call(104, `/api/quotes/participants/${target.participantId}`)).data.quota;
    assert.deepEqual([corrected.amountDueCents, corrected.corrections[0].previousCents, corrected.corrections[0].newCents], [8000, 10000, 8000]);
    // A section coordinator sees none of this (status only).
    const coordinator = (await s.call(102, `/api/quotes/participants/${target.participantId}`));
    if (coordinator.status === 200) assert.doesNotMatch(Object.keys(coordinator.data.quota).join(','), MONEY_KEYS);
  } finally { s.f.close(); }
});

test('family context respects scope: a scoped finance reader never sees a sibling of another section', async () => {
  const s = await setup();
  try {
    // A Tropa-scoped finance.fee.read holder (explicit grant) looks at a family spread across sections.
    const family = s.f.sql.prepare(`SELECT m.group_id FROM annual_fee_family_member m JOIN participant p ON p.id=m.participant_id
      GROUP BY m.group_id HAVING count(DISTINCT p.current_section_id)>1 AND sum(p.current_section_id=?)>0 LIMIT 1`).get(TROPA).group_id;
    const tropaChild = s.f.sql.prepare(`SELECT m.participant_id FROM annual_fee_family_member m JOIN participant p ON p.id=m.participant_id
      WHERE m.group_id=? AND p.current_section_id=?`).get(family, TROPA).participant_id;
    const created = await s.call(101, '/api/admin/users', 'POST', { displayName: 'Tresoreria Tropa (fictícia)', roles: [
      { roleCode: 'SECTION_COORDINATOR', sectionId: TROPA, permissions: ['finance.fee.status.read'] }] });
    s.f.sql.prepare(`INSERT INTO role_permission(role_code,permission_code) SELECT 'SECTION_COORDINATOR','finance.fee.read'
      WHERE NOT EXISTS(SELECT 1 FROM role_permission WHERE role_code='SECTION_COORDINATOR' AND permission_code='finance.fee.read')`).run();
    const role = s.f.sql.prepare('SELECT id FROM user_role WHERE user_id=? AND revoked_at IS NULL').get(created.data.id).id;
    s.f.sql.prepare(`INSERT INTO user_permission_grant(id,user_id,permission_code,section_id,source_role_id,valid_from,granted_by,justification)
      VALUES(?,?,'finance.fee.read',?,?,1,?,'Prova d’abast')`).run(crypto.randomUUID(), created.data.id, TROPA, role, id(101));
    const { newSession } = await import('../gestio/src/auth.js');
    s.f.token.t = (await newSession(s.f.db, created.data.id)).token;
    const detail = (await s.f.request('t', `/api/quotes/participants/${tropaChild}`)).data;
    assert.equal(detail.mode, 'financial');
    assert.ok(detail.quota.family.members.every(member => member.sectionCode === 'TROPA'), 'only in-scope siblings');
    const other = s.f.sql.prepare(`SELECT m.participant_id FROM annual_fee_family_member m JOIN participant p ON p.id=m.participant_id
      WHERE m.group_id=? AND p.current_section_id!=?`).get(family, TROPA).participant_id;
    assert.equal((await s.f.request('t', `/api/quotes/participants/${other}`)).status, 404);
  } finally { s.f.close(); }
});

test('family overpayment (existing correction workflow): quota covered, the excess explained to Treasury only, never income', async () => {
  const s = await setup();
  try {
    const { buildTreasuryDemo } = await import('../gestio/demo/data.js');
    s.f.sql.exec(buildTreasuryDemo());
    const obligation = id(3002), participant = id(502); // paid, Tropa
    const corrected = await s.call(104, `/api/fees/obligations/${obligation}`, 'PATCH', { amountDueCents: 8000, reason: 'Germà afegit tard' });
    assert.equal(corrected.status, 200, JSON.stringify(corrected.data));
    assert.equal(corrected.data.overpaymentIds.length, 1);
    const treasury = (await s.call(104, `/api/quotes/participants/${participant}`)).data.quota;
    assert.equal(treasury.status, 'PAID');
    assert.deepEqual(treasury.overpayments.map(claim => [claim.amountCents, claim.status]), [[2000, 'OPEN']]);
    const { overpaymentCopy } = await import('../gestio/public/views/quotes/model.js');
    assert.match(overpaymentCopy(treasury.overpayments), /^Quota coberta\. Hi ha 20,00\s€ addicionals pendents de resoldre\.$/);
    const coordinator = (await s.call(102, `/api/quotes/participants/${participant}`)).data;
    assert.deepEqual([coordinator.mode, coordinator.quota.status], ['basic', 'PAID']);
    assert.doesNotMatch(JSON.stringify(coordinator), /overpay|2000|20,00/i, 'no financial detail for the section coordinator');
  } finally { s.f.close(); }
});
