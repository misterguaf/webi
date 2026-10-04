import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, id } from './helpers/gestio-sqlite.js';

const receipt = { filename: 'ticket-synthetic.pdf', mime: 'application/pdf',
  dataBase64: Buffer.from('%PDF-1.4\n%synthetic local fixture\n1 0 obj <<>> endobj\n%%EOF').toString('base64') };
async function setup() {
  const f = fixture();
  for (const user of [101, 104, 107]) await f.login(user);
  const call = (path, method = 'GET', body, user = 104) => f.request(user, path, { method, body });
  const created = await call('/api/finance/rounds', 'POST', {
    code: '2026/2027', periodStart: '2026-10-01', periodEnd: '2027-09-30', annualFeeRoundId: id(901) });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const round = created.data.id;
  assert.equal((await call(`/api/finance/rounds/${round}/open`, 'POST', { expectedVersion: 1 })).status, 200);
  const line = (await call('/api/finance/budget-lines', 'POST', { roundId: round, code: '2', name: 'Material', nature: 'EXPENSE' })).data.id;
  const otherLine = (await call('/api/finance/budget-lines', 'POST', { roundId: round, code: '3', name: 'Eixides', nature: 'EXPENSE' })).data.id;
  const bank = (await call('/api/finance/positions', 'POST', { kind: 'BANK', name: 'Compte' })).data.id;
  const person = async name => (await call('/api/finance/counterparties', 'POST', { kind: 'PERSON', displayName: name })).data.id;
  const expense = (amountCents, paymentMethod = 'BANK', advancedById = null, recognise = true) =>
    call('/api/finance/expenses', 'POST', { roundId: round, expenseDate: '2026-11-10', concept: 'Material de prova',
      totalCents: amountCents, paymentMethod, ...(advancedById ? { advancedById } : {}),
      lines: [{ budgetLineId: line, amountCents }], ...(recognise ? { recognise: true, evidence: receipt } : {}) });
  const movement = async amountCents => (await call('/api/finance/movements', 'POST', {
    positionId: bank, operationDate: '2026-11-12', amountCents, label: 'Transferència demo' })).data.id;
  const economics = async () => (await call(`/api/finance/rounds/${round}`)).data.economics;
  return { f, call, round, line, otherLine, bank, person, expense, movement, economics };
}

test('draft expense edits stay simple; recognised corrections require reason and preserve previous values', async () => {
  const s = await setup();
  try {
    const first = await s.person('Primera Persona Demo (fictici)');
    const second = await s.person('Segona Persona Demo (fictici)');
    const proposed = await s.expense(5000, 'ADVANCED', first, false);
    assert.equal(proposed.status, 201, JSON.stringify(proposed.data));
    const expenseId = proposed.data.id;
    const draftEdit = await s.call(`/api/finance/expenses/${expenseId}`, 'PATCH', {
      expectedVersion: 1, totalCents: 5300, advancedById: second,
      lines: [{ budgetLineId: s.otherLine, amountCents: 5300 }] });
    assert.equal(draftEdit.status, 200, JSON.stringify(draftEdit.data));
    assert.equal(s.f.sql.prepare('SELECT count(*) AS n FROM finance_expense_revision WHERE expense_id=?').get(expenseId).n, 0);
    assert.equal((await s.call(`/api/finance/expenses/${expenseId}`, 'PATCH', { expectedVersion: 1, concept: 'Antic' })).data.error,
      'stale_expense');
    const uploaded = await s.call(`/api/finance/expenses/${expenseId}/evidence`, 'POST', receipt);
    assert.equal(uploaded.status, 201);
    assert.equal((await s.call(`/api/finance/expenses/${expenseId}/recognise`, 'POST', { expectedVersion: 2 })).status, 200);
    assert.equal((await s.economics()).expenseGrossCents, 5300);
    assert.equal((await s.call(`/api/finance/expenses/${expenseId}`, 'PATCH', { expectedVersion: 3, concept: 'Corregit' })).data.error,
      'expense_correction_reason_required');
    const corrected = await s.call(`/api/finance/expenses/${expenseId}`, 'PATCH', { expectedVersion: 3,
      reason: 'Import i línia corregits', totalCents: 4800, concept: 'Concepte corregit',
      lines: [{ budgetLineId: s.line, amountCents: 4800 }] });
    assert.equal(corrected.status, 200, JSON.stringify(corrected.data));
    assert.equal((await s.economics()).expenseGrossCents, 4800);
    const revision = s.f.sql.prepare('SELECT previous_total_cents,reason,previous_status FROM finance_expense_revision WHERE expense_id=?').get(expenseId);
    assert.deepEqual([revision.previous_total_cents,revision.reason,revision.previous_status], [5300,'Import i línia corregits','RECOGNISED']);
    const events = s.f.sql.prepare("SELECT action,metadata_json FROM audit_event WHERE resource_id=? AND action='EXPENSE_CORRECTED'").all(expenseId);
    assert.equal(events.length, 1); assert.equal(events[0].metadata_json, null);
  } finally { s.f.close(); }
});

test('unpaid advanced liability follows correction; paid debt blocks amount, beneficiary and cancellation', async () => {
  const s = await setup();
  try {
    const first = await s.person('Beneficiària Primera (fictici)');
    const second = await s.person('Beneficiària Segona (fictici)');
    const created = await s.expense(5000, 'ADVANCED', first);
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const idExpense = created.data.id, idReimbursement = created.data.reimbursementId;
    const corrected = await s.call(`/api/finance/expenses/${idExpense}`, 'PATCH', {
      expectedVersion: 2, reason: 'Beneficiària i import corregits', advancedById: second, totalCents: 4500,
      lines: [{ budgetLineId: s.line, amountCents: 4500 }] });
    assert.equal(corrected.status, 200, JSON.stringify(corrected.data));
    const debt = s.f.sql.prepare('SELECT recipient_id,amount_cents,cancelled_at FROM finance_reimbursement WHERE id=?').get(idReimbursement);
    assert.deepEqual([debt.recipient_id,debt.amount_cents,debt.cancelled_at], [second,4500,null]);
    const bank = await s.movement(-3000);
    assert.equal((await s.call(`/api/finance/movements/${bank}/allocations`, 'POST', { expectedVersion: 0,
      allocations: [{ kind: 'REIMBURSEMENT_SETTLEMENT', reimbursementId: idReimbursement, amountCents: 3000 }] })).status, 200);
    const lowered = await s.call(`/api/finance/expenses/${idExpense}`, 'PATCH', { expectedVersion: 3,
      reason: 'Import erroni', totalCents: 2000, lines: [{ budgetLineId: s.line, amountCents: 2000 }] });
    assert.equal(lowered.data.error, 'reimbursement_settlement_locked');
    assert.equal((await s.call(`/api/finance/expenses/${idExpense}`, 'PATCH', { expectedVersion: 3,
      reason: 'Persona errònia', advancedById: first })).data.error, 'reimbursement_settlement_locked');
    assert.equal((await s.call(`/api/finance/expenses/${idExpense}/void`, 'POST', {
      expectedVersion: 3, reason: 'Despesa duplicada' })).data.error, 'reimbursement_settlement_locked');
    assert.equal((await s.economics()).expenseGrossCents, 4500, 'the reimbursement movement never duplicates expense');
  } finally { s.f.close(); }
});

test('BANK and ADVANCED changes create or close debt; cancellation hides expense without deletion', async () => {
  const s = await setup();
  try {
    const person = await s.person('Scouter Tercer (fictici)');
    const created = await s.expense(2000);
    assert.equal(created.status, 201);
    const idExpense = created.data.id;
    const advanced = await s.call(`/api/finance/expenses/${idExpense}`, 'PATCH', {
      expectedVersion: 2, reason: 'La va pagar el scouter', paymentMethod: 'ADVANCED', advancedById: person });
    assert.equal(advanced.status, 200, JSON.stringify(advanced.data));
    const firstDebt = s.f.sql.prepare('SELECT id,cancelled_at FROM finance_reimbursement WHERE expense_id=?').get(idExpense);
    assert.ok(firstDebt?.id); assert.equal(firstDebt.cancelled_at, null);
    const group = await s.call(`/api/finance/expenses/${idExpense}`, 'PATCH', {
      expectedVersion: 3, reason: 'En realitat va pagar el grup', paymentMethod: 'BANK', advancedById: null });
    assert.equal(group.status, 200, JSON.stringify(group.data));
    assert.ok(s.f.sql.prepare('SELECT cancelled_at FROM finance_reimbursement WHERE id=?').get(firstDebt.id).cancelled_at);
    assert.equal((await s.call(`/api/finance/reimbursements?roundId=${s.round}&outstanding=1`)).data.reimbursements.length, 0);
    const again = await s.call(`/api/finance/expenses/${idExpense}`, 'PATCH', {
      expectedVersion: 4, reason: 'Confirmat pagament personal', paymentMethod: 'ADVANCED', advancedById: person });
    assert.equal(again.status, 200, JSON.stringify(again.data));
    assert.equal(s.f.sql.prepare('SELECT count(*) AS n FROM finance_reimbursement WHERE expense_id=? AND cancelled_at IS NULL').get(idExpense).n, 1);
    assert.equal((await s.call(`/api/finance/expenses/${idExpense}/void`, 'POST', { expectedVersion: 5 })).status, 400);
    const cancelled = await s.call(`/api/finance/expenses/${idExpense}/void`, 'POST', {
      expectedVersion: 5, reason: 'Despesa duplicada' });
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));
    assert.equal((await s.economics()).expenseGrossCents, 0);
    assert.equal((await s.call(`/api/finance/expenses?roundId=${s.round}`)).data.expenses.length, 0);
    assert.equal((await s.call(`/api/finance/expenses?roundId=${s.round}&status=VOID`)).data.expenses.length, 1);
    assert.equal(s.f.sql.prepare('SELECT count(*) AS n FROM finance_expense WHERE id=?').get(idExpense).n, 1);
    assert.equal(s.f.sql.prepare('SELECT count(*) AS n FROM finance_expense_revision WHERE expense_id=? AND previous_status=?').get(idExpense,'RECOGNISED').n, 4);
    assert.equal(s.f.sql.prepare('SELECT count(*) AS n FROM finance_reimbursement WHERE expense_id=? AND cancelled_at IS NULL').get(idExpense).n, 0);
  } finally { s.f.close(); }
});

test('receipt replacement preserves private old object; allocation corrections require reason and keep historical sets', async () => {
  const s = await setup();
  try {
    const person = await s.person('Scouter Quarta (fictici)');
    const created = await s.expense(3000, 'ADVANCED', person);
    assert.equal(created.status, 201);
    const idExpense = created.data.id;
    const initial = (await s.call(`/api/finance/expenses/${idExpense}`)).data.evidence[0].id;
    assert.throws(() => s.f.sql.prepare('UPDATE finance_expense_evidence SET superseded_at=?,superseded_by_id=? WHERE id=?')
      .run(10, id(9998), initial), /expense_evidence_required/, 'a recognised expense cannot lose its only current receipt');
    const bad = await s.call(`/api/finance/expenses/${idExpense}/evidence/${initial}/replace`, 'POST', { ...receipt, mime: 'image/png' });
    assert.equal(bad.status, 400);
    assert.equal(s.f.sql.prepare('SELECT superseded_at FROM finance_expense_evidence WHERE id=?').get(initial).superseded_at, null);
    const replacement = await s.call(`/api/finance/expenses/${idExpense}/evidence/${initial}/replace`, 'POST', receipt);
    assert.equal(replacement.status, 201, JSON.stringify(replacement.data));
    const detail = (await s.call(`/api/finance/expenses/${idExpense}`)).data;
    assert.equal(detail.evidence.length, 1);
    assert.equal(detail.evidenceHistory.find(row => row.id === initial).supersededAt != null, true);
    assert.equal((await s.call(`/api/finance/expense-evidence/${initial}?mode=view`)).status, 200);
    assert.equal((await s.call(`/api/finance/expenses/${idExpense}/evidence/${initial}/replace`, 'POST', receipt)).data.error,
      'evidence_already_replaced');
    assert.equal((await s.call(`/api/finance/expenses/${idExpense}/evidence/${replacement.data.id}/replace`, 'POST', receipt, 107)).status, 403);
    const movement = await s.movement(-3000);
    const allocation = { kind: 'REIMBURSEMENT_SETTLEMENT', reimbursementId: created.data.reimbursementId, amountCents: 3000 };
    assert.equal((await s.call(`/api/finance/movements/${movement}/allocations`, 'POST', {
      expectedVersion: 0, allocations: [allocation] })).status, 200);
    assert.equal((await s.call(`/api/finance/movements/${movement}/allocations`, 'POST', {
      expectedVersion: 1, allocations: [] })).data.error, 'allocation_correction_reason_required');
    const fixed = await s.call(`/api/finance/movements/${movement}/allocations`, 'POST', {
      expectedVersion: 1, allocations: [], reason: 'Reemborsament assignat al moviment erroni' });
    assert.equal(fixed.status, 200, JSON.stringify(fixed.data));
    assert.equal((await s.call(`/api/finance/movements/${movement}`)).data.allocations.length, 0);
    assert.equal(s.f.sql.prepare('SELECT count(*) AS n FROM finance_allocation WHERE movement_id=?').get(movement).n, 1);
    assert.equal(s.f.sql.prepare('SELECT reason FROM finance_allocation_correction WHERE movement_id=?').get(movement).reason,
      'Reemborsament assignat al moviment erroni');
    assert.equal((await s.economics()).expenseGrossCents, 3000);
  } finally { s.f.close(); }
});

test('one corrected bank transfer can replace wrong reimbursement targets without double expense', async () => {
  const s = await setup();
  try {
    const recipient = await s.person('Scouter Cinqué (fictici)');
    const other = await s.person('Altra Scouter Demo (fictici)');
    const created = [];
    for (const amount of [2000, 5000, 3500, 1500]) {
      const response = await s.expense(amount, 'ADVANCED', recipient);
      assert.equal(response.status, 201); created.push(response.data.reimbursementId);
    }
    const outsider = (await s.expense(1000, 'ADVANCED', other)).data.reimbursementId;
    const movement = await s.movement(-7000);
    const wrong = [{ kind: 'REIMBURSEMENT_SETTLEMENT', reimbursementId: created[0], amountCents: 2000 },
      { kind: 'REIMBURSEMENT_SETTLEMENT', reimbursementId: created[1], amountCents: 5000 }];
    assert.equal((await s.call(`/api/finance/movements/${movement}/allocations`, 'POST', {
      expectedVersion: 0, allocations: wrong })).status, 200);
    const fixed = [{ ...wrong[0] },
      { kind: 'REIMBURSEMENT_SETTLEMENT', reimbursementId: created[2], amountCents: 3500 },
      { kind: 'REIMBURSEMENT_SETTLEMENT', reimbursementId: created[3], amountCents: 1500 }];
    const changed = await s.call(`/api/finance/movements/${movement}/allocations`, 'POST', {
      expectedVersion: 1, allocations: fixed, reason: 'Les despeses B eren incorrectes' });
    assert.equal(changed.status, 200, JSON.stringify(changed.data));
    assert.deepEqual((await s.call(`/api/finance/movements/${movement}`)).data.allocations.map(row => row.reimbursementId).sort(),
      [created[0],created[2],created[3]].sort());
    assert.equal(s.f.sql.prepare('SELECT count(*) AS n FROM finance_allocation WHERE movement_id=?').get(movement).n, 5);
    assert.equal((await s.call(`/api/finance/movements/${movement}/allocations`, 'POST', {
      expectedVersion: 2, allocations: [...fixed, { kind: 'REIMBURSEMENT_SETTLEMENT', reimbursementId: outsider, amountCents: 1 }],
      reason: 'Comprovació de beneficiari' })).status, 409);
    const secondMovement = await s.movement(-1000);
    assert.equal((await s.call(`/api/finance/movements/${secondMovement}/allocations`, 'POST', {
      expectedVersion: 0, allocations: [{ kind: 'REIMBURSEMENT_SETTLEMENT', reimbursementId: created[1], amountCents: 1000 }] })).status, 200);
    assert.equal((await s.call(`/api/finance/movements/${secondMovement}/allocations`, 'POST', {
      expectedVersion: 1, allocations: [{ kind: 'REIMBURSEMENT_SETTLEMENT', reimbursementId: created[0], amountCents: 1000 }],
      reason: 'Comprovació de límit de reemborsament' })).data.error, 'invalid_reimbursement_settlement',
    'a replacement set cannot over-settle a reimbursement already paid by another movement');
    assert.equal((await s.economics()).expenseGrossCents, 13000);
  } finally { s.f.close(); }
});

test('failed replacement D1 batch removes only the newly uploaded R2 object', async () => {
  const s = await setup();
  try {
    const created = await s.expense(900);
    const current = (await s.call(`/api/finance/expenses/${created.data.id}`)).data.evidence[0];
    const oldKey = s.f.sql.prepare('SELECT object_key FROM finance_expense_evidence WHERE id=?').get(current.id).object_key;
    const uploaded = [];
    const put = s.f.storage.put;
    s.f.storage.put = async (key, bytes) => { uploaded.push(key); return put(key, bytes); };
    const batch = s.f.db.batch;
    s.f.db.batch = async () => { throw new Error('Synthetic D1 failure'); };
    const response = await s.call(`/api/finance/expenses/${created.data.id}/evidence/${current.id}/replace`, 'POST', receipt);
    s.f.db.batch = batch;
    assert.equal(response.status, 500);
    assert.equal(uploaded.length, 1);
    assert.equal(await s.f.storage.head(uploaded[0]), null);
    assert.ok(await s.f.storage.head(oldKey));
    assert.equal(s.f.sql.prepare('SELECT superseded_at FROM finance_expense_evidence WHERE id=?').get(current.id).superseded_at, null);
  } finally { s.f.close(); }
});

test('self-beneficiary correction keeps the narrow Treasury permission boundary', async () => {
  const s = await setup();
  try {
    const linked = await s.call('/api/finance/counterparties', 'POST', {
      kind: 'PERSON', displayName: 'Tresorera Sintètica (fictici)', userId: id(104) });
    assert.equal(linked.status, 201);
    const groupExpense = () => s.call('/api/finance/expenses', 'POST', { roundId: s.round,
      expenseDate: '2026-11-10', concept: 'Compra del grup', totalCents: 1000, paymentMethod: 'BANK',
      lines: [{ budgetLineId: s.line, amountCents: 1000 }], recognise: true, evidence: receipt }, 101);
    const first = await groupExpense();
    assert.equal(first.status, 201);
    const corrected = await s.call(`/api/finance/expenses/${first.data.id}`, 'PATCH', {
      expectedVersion: 2, paymentMethod: 'ADVANCED', advancedById: linked.data.id,
      reason: 'El pagament el va avançar la tresorera' });
    assert.equal(corrected.status, 200, JSON.stringify(corrected.data));
    const liability = s.f.sql.prepare('SELECT self_approval_exception,approved_by FROM finance_reimbursement WHERE expense_id=?').get(first.data.id);
    assert.deepEqual([liability.self_approval_exception,liability.approved_by], [1,id(104)]);
    s.f.sql.prepare("DELETE FROM user_permission_grant WHERE user_id=? AND permission_code='finance.reimbursement.self_approve'").run(id(104));
    const second = await groupExpense();
    assert.equal(second.status, 201);
    assert.equal((await s.call(`/api/finance/expenses/${second.data.id}`, 'PATCH', {
      expectedVersion: 2, paymentMethod: 'ADVANCED', advancedById: linked.data.id,
      reason: 'El pagament el va avançar la tresorera' })).status, 403);
    assert.equal(s.f.sql.prepare('SELECT count(*) AS n FROM finance_reimbursement WHERE expense_id=?').get(second.data.id).n, 0);
  } finally { s.f.close(); }
});
