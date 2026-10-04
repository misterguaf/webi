// FASE 3.5G.2A (extensió) — general incomes: manual income pending reconciliation, income from a movement,
// linking an existing income, partial reconciliation both ways, no double counting, history, permissions.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, id, migrations, root } from './helpers/gestio-sqlite.js';
import { buildDemoData, buildTreasuryDemo, buildTreasuryIncomeDemo, buildTreasuryOperationsDemo } from '../gestio/demo/data.js';

const ROUND = { code: '2026/2027', periodStart: '2026-10-01', periodEnd: '2027-09-30', annualFeeRoundId: id(901) };
const evidence = { filename: 'ticket-synthetic.pdf', mime: 'application/pdf',
  dataBase64: Buffer.from('%PDF-1.4\n%synthetic local fixture\n1 0 obj <<>> endobj\n%%EOF').toString('base64') };

async function setup() {
  const f = fixture();
  for (const user of [101, 102, 104, 105, 107]) await f.login(user);
  const call = (user, path, method = 'GET', body) => f.request(user, path, { method, body });
  const round = (await call(104, '/api/finance/rounds', 'POST', ROUND)).data.id;
  await call(104, `/api/finance/rounds/${round}/open`, 'POST', { expectedVersion: 1 });
  const bank = (await call(104, '/api/finance/positions', 'POST', { kind: 'BANK', name: 'Compte corrent' })).data.id;
  const line = async input => (await call(104, '/api/finance/budget-lines', 'POST', { roundId: round, ...input })).data.id;
  const root = await line({ code: '1', name: 'Ingressos', nature: 'INCOME' });
  const grants = await line({ code: '1.1', name: 'Subvencions', nature: 'INCOME', parentId: root });
  const town = await line({ code: '1.1.1', name: 'Ajuntament', nature: 'INCOME', parentId: grants });
  const lottery = await line({ code: '1.2', name: 'Loteria', nature: 'INCOME', parentId: root });
  const kitchen = await line({ code: '2', name: 'Cuina', nature: 'EXPENSE' });
  const manual = async (amountCents, operationDate = '2026-11-02') =>
    (await call(104, '/api/finance/movements', 'POST', { positionId: bank, operationDate, amountCents, label: 'Moviment de prova' })).data.id;
  const movement = async movementId => (await call(104, `/api/finance/movements/${movementId}`)).data.movement;
  const income = async incomeId => (await call(104, `/api/finance/incomes/${incomeId}`)).data;
  const economics = async () => (await call(104, `/api/finance/rounds/${round}`)).data.economics;
  const create = body => call(104, '/api/finance/incomes', 'POST', { roundId: round, incomeDate: '2026-10-01', concept: 'Subvenció Ajuntament',
    totalCents: 150000, budgetLineId: town, ...body });
  const count = (table, where = '1=1') => f.sql.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).get().n;
  return { f, call, round, bank, lines: { root, grants, town, lottery, kitchen }, manual, movement, income, economics, create, count };
}

test('manual income: valid INCOME leaf only, pending without a movement, not counted until collected, audited', async () => {
  const s = await setup();
  try {
    assert.equal((await s.create({ budgetLineId: s.lines.kitchen })).data.error, 'invalid_income', 'not an expense line');
    assert.equal((await s.create({ budgetLineId: s.lines.grants })).data.error, 'invalid_income', 'not a heading');
    assert.equal((await s.create({ totalCents: 0 })).status, 400);
    const before = s.count('finance_movement');
    const created = await s.create({});
    assert.equal(created.status, 201);
    assert.equal(s.count('finance_movement'), before, 'no movement is invented');
    const detail = await s.income(created.data.id);
    assert.deepEqual([detail.income.state, detail.income.reconciledCents, detail.income.pendingCents], ['PENDING', 0, 150000]);
    assert.deepEqual(detail.income.budgetLine.path, ['Ingressos', 'Subvencions', 'Ajuntament']);
    assert.equal((await s.economics()).incomeCents, 0, 'counted when collected');
    assert.equal(s.count('audit_event', "action='INCOME_CREATED'"), 1);
    const listed = (await s.call(104, `/api/finance/incomes?roundId=${s.round}&state=PENDING`)).data.incomes;
    assert.deepEqual(listed.map(row => row.id), [created.data.id]);
    assert.equal((await s.call(104, `/api/finance/incomes?roundId=${s.round}&budgetLineId=${s.lines.grants}`)).data.incomes.length, 1, 'heading filter');
    assert.equal((await s.call(104, '/api/finance/summary')).data.incomes.pendingCount, 1);
  } finally { s.f.close(); }
});

test('movement → new income: created and reconciled in one step, counted once; refused for outgoing or stale', async () => {
  const s = await setup();
  try {
    const movement = await s.manual(30000);
    const body = { roundId: s.round, incomeDate: '2026-11-02', concept: 'Venda loteria', totalCents: 30000, budgetLineId: s.lines.lottery };
    assert.equal((await s.call(104, `/api/finance/movements/${movement}/income`, 'POST', { ...body, expectedVersion: 4 })).data.error, 'stale_movement');
    assert.equal((await s.call(104, `/api/finance/movements/${movement}/income`, 'POST', { ...body, totalCents: 40000, expectedVersion: 0 })).data.error,
      'allocation_exceeds_movement');
    assert.equal(s.count('finance_income'), 0, 'a refused attempt leaves nothing');
    const created = await s.call(104, `/api/finance/movements/${movement}/income`, 'POST', { ...body, expectedVersion: 0 });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal((await s.income(created.data.incomeId)).income.state, 'RECONCILED');
    assert.equal((await s.movement(movement)).status, 'CLASSIFIED');
    assert.equal((await s.economics()).incomeCents, 30000, '+300 € once (income + allocation is one fact)');
    assert.equal(s.count('audit_event', "action='INCOME_RECONCILED'"), 1);
    const outgoing = await s.manual(-500);
    assert.equal((await s.call(104, `/api/finance/movements/${outgoing}/income`, 'POST', { ...body, totalCents: 500, expectedVersion: 0 })).data.error,
      'invalid_allocation_direction');
  } finally { s.f.close(); }
});

test('link an existing income: partial with two movements, one movement for two incomes, never above the income', async () => {
  const s = await setup();
  try {
    const grant = (await s.create({ totalCents: 100000 })).data.id;
    const first = await s.manual(60000), second = await s.manual(40000, '2026-11-05');
    const link = (movementId, expectedVersion, allocations) => s.call(104, `/api/finance/movements/${movementId}/allocations`, 'POST', { expectedVersion, allocations });
    assert.equal((await link(first, 0, [{ kind: 'INCOME', amountCents: 60000, incomeId: grant, budgetLineId: s.lines.town }])).status, 400, 'income brings its own line');
    assert.equal((await link(first, 0, [{ kind: 'INCOME', amountCents: 60000, incomeId: grant }])).status, 200);
    let detail = await s.income(grant);
    assert.deepEqual([detail.income.state, detail.income.pendingCents, detail.movements.length], ['PARTIAL', 40000, 1]);
    assert.ok(detail.candidates.some(row => row.id === second), 'the exact remaining amount is offered');
    assert.equal(detail.candidates[0].id, second, 'exact amount first');
    const third = await s.manual(70000, '2026-11-06');
    assert.equal((await link(third, 0, [{ kind: 'INCOME', amountCents: 50000, incomeId: grant }])).data.error, 'invalid_income_allocation', 'never above the income');
    assert.equal((await link(second, 0, [{ kind: 'INCOME', amountCents: 40000, incomeId: grant }])).status, 200);
    detail = await s.income(grant);
    assert.equal(detail.income.state, 'RECONCILED');
    // One movement collecting two incomes.
    const a = (await s.create({ concept: 'Donació A', totalCents: 30000, budgetLineId: s.lines.lottery })).data.id;
    const b = (await s.create({ concept: 'Donació B', totalCents: 40000, budgetLineId: s.lines.lottery })).data.id;
    assert.equal((await link(third, 0, [{ kind: 'INCOME', amountCents: 30000, incomeId: a }, { kind: 'INCOME', amountCents: 40000, incomeId: b }])).status, 200);
    assert.deepEqual([(await s.income(a)).income.state, (await s.income(b)).income.state], ['RECONCILED', 'RECONCILED']);
    assert.equal((await s.economics()).incomeCents, 170000, 'every euro once');
    // Movement detail names the income.
    const view = (await s.call(104, `/api/finance/movements/${third}`)).data.allocations;
    assert.deepEqual(view.map(x => x.income.concept).sort(), ['Donació A', 'Donació B']);
    // Adding an expense part to a movement that collects an income keeps the link (the set is rebuilt).
    const out = await s.manual(-1000);
    assert.equal((await s.movement(out)).status, 'PENDING');
  } finally { s.f.close(); }
});

test('correction keeps history; version conflict; void refused while collected; permissions', async () => {
  const s = await setup();
  try {
    const grant = (await s.create({})).data.id;
    const patch = body => s.call(104, `/api/finance/incomes/${grant}`, 'PATCH', body);
    assert.equal((await patch({ budgetLineId: s.lines.lottery, concept: 'Subvenció corregida', expectedVersion: 1 })).status, 200);
    assert.equal((await patch({ concept: 'Una altra', expectedVersion: 1 })).data.error, 'stale_income');
    assert.equal((await patch({ budgetLineId: s.lines.kitchen, expectedVersion: 2 })).data.error, 'invalid_income');
    const detail = await s.income(grant);
    assert.equal(detail.income.concept, 'Subvenció corregida');
    assert.deepEqual(detail.revisions.map(r => [r.previousConcept, r.previousBudgetLine.name]), [['Subvenció Ajuntament', 'Ajuntament']]);
    assert.equal(s.count('audit_event', "action='INCOME_REVISED'"), 1);
    const movement = await s.manual(150000);
    await s.call(104, `/api/finance/movements/${movement}/allocations`, 'POST', { expectedVersion: 0, allocations: [{ kind: 'INCOME', amountCents: 150000, incomeId: grant }] });
    assert.equal((await s.call(104, `/api/finance/incomes/${grant}/void`, 'POST', { expectedVersion: 2 })).data.error, 'income_reconciled');
    assert.equal((await patch({ totalCents: 100000, expectedVersion: 2 })).data.error, 'invalid_income', 'never below what was collected');
    const other = (await s.create({ concept: 'Error' })).data.id;
    assert.equal((await s.call(104, `/api/finance/incomes/${other}/void`, 'POST', { expectedVersion: 1 })).data.status, 'VOID');
    assert.equal((await s.income(other)).income.state, 'VOID');
    assert.equal(s.count('finance_income'), 2, 'nothing is deleted');
    assert.equal((await s.call(101, `/api/finance/incomes?roundId=${s.round}`)).status, 200, 'general coordination');
    for (const user of [102, 105, 107]) {
      assert.equal((await s.call(user, `/api/finance/incomes?roundId=${s.round}`)).status, 403);
      assert.equal((await s.call(user, '/api/finance/incomes', 'POST', {})).status, 403);
      const caps = (await s.call(user, '/api/me')).data.capabilities.treasury;
      assert.deepEqual([caps.readIncomes, caps.manageIncomes], [false, false]);
    }
    const caps = (await s.call(104, '/api/me')).data.capabilities.treasury;
    assert.deepEqual([caps.readIncomes, caps.manageIncomes], [true, true]);
    // Expenses are untouched by incomes.
    const expense = await s.call(104, '/api/finance/expenses', 'POST', { roundId: s.round, expenseDate: '2026-11-03', concept: 'Gas', totalCents: 2000,
      paymentMethod: 'BANK', recognise: true, evidence, lines: [{ budgetLineId: s.lines.kitchen, amountCents: 2000 }] });
    assert.equal(expense.data.status, 'RECOGNISED');
    assert.equal((await s.economics()).expenseGrossCents, 2000);
  } finally { s.f.close(); }
});

test('synthetic demo: pending grant, reconciled lottery sale and an unidentified entry apply with the real triggers', () => {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  for (const name of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) sql.exec(readFileSync(join(migrations, name), 'utf8'));
  sql.exec(readFileSync(join(root, 'gestio/seed.sql'), 'utf8'));
  sql.exec(buildDemoData().sql);
  sql.exec(buildTreasuryDemo()); sql.exec(buildTreasuryOperationsDemo()); sql.exec(buildTreasuryIncomeDemo());
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(sql.prepare('SELECT income_cents FROM finance_round_economics').get().income_cents, 70000, 'the lottery sale counts once; the grant not yet');
  const reconciled = id => sql.prepare('SELECT COALESCE(sum(amount_cents),0) AS n FROM finance_allocation_current WHERE income_id=?').get(id).n;
  assert.deepEqual([reconciled(id(23001)), reconciled(id(23002))], [0, 45000]);
  sql.close();
});

test('financial delegation of finance.income.*: group-wide only, effective when authorised, never re-delegable, never widens', async () => {
  const s = await setup();
  try {
    const A = 9611, B = 9612;
    for (const [user, name] of [[A, 'Suport ingressos (fictici)'], [B, 'Segon suport (fictici)']]) {
      s.f.sql.exec(`INSERT INTO app_user(id,display_name,status,created_at,updated_at) VALUES('${id(user)}','${name}','ACTIVE',1,1)`);
      await s.f.login(user);
    }
    let seq = 0;
    const provision = (userId, permissionCode, sectionId, authorizedBy, provisioner = 107) => s.call(provisioner, '/api/delegations', 'POST', { userId: id(userId),
      permissionCode, sectionId, authorizedBy, authorizationReference: `DEMO-INCOME-DEL-${++seq}`, expiresAt: Date.now() + 86400000 });
    const ratify = async created => {
      await s.call(101, `/api/delegations/${created.data.id}/confirm`, 'POST', {});
      assert.equal((await s.call(101, `/api/delegations/${created.data.id}/ratify`, 'POST', { ratificationReference: 'DEMO-INCOME-RATIFIED' })).status, 200);
    };
    const { authorize } = await import('../gestio/src/policy.js');
    const can = async (user, permission) => (await authorize(s.f.db, s.f.context[user], { permission })).allow;
    // GROUP scope: a section-scoped delegation is refused for both capabilities.
    for (const code of ['finance.income.read', 'finance.income.manage'])
      assert.equal((await provision(A, code, id(2), id(101))).status, 400, `${code} cannot be section-scoped`);
    // Explicit group-wide delegation from an authority that holds it by role + grant: effective once ratified.
    for (const code of ['finance.income.read', 'finance.income.manage']) {
      const created = await provision(A, code, null, id(101));
      assert.equal(created.status, 201, JSON.stringify(created.data));
      await ratify(created);
    }
    assert.equal(await can(A, 'finance.income.read'), true);
    assert.equal(await can(A, 'finance.income.manage'), true);
    assert.equal((await s.call(A, `/api/finance/incomes?roundId=${s.round}`)).status, 200);
    assert.equal((await s.call(A, '/api/finance/incomes', 'POST', { roundId: s.round, incomeDate: '2026-10-05', concept: 'Donació',
      totalCents: 1000, budgetLineId: s.lines.lottery })).status, 201);
    const caps = (await s.call(A, '/api/me')).data.capabilities.treasury;
    assert.deepEqual([caps.readIncomes, caps.manageIncomes], [true, true]);
    // It never widens: no movements, expenses, budget or treasury reading.
    for (const permission of ['finance.expense.read', 'finance.expense.manage', 'finance.movement.read', 'finance.movement.classify',
      'finance.treasury.read', 'finance.budget.read', 'finance.bank_description.reveal'])
      assert.equal(await can(A, permission), false, permission);
    assert.equal((await s.call(A, '/api/finance/movements')).status, 403);
    assert.equal((await s.call(A, `/api/finance/expenses?roundId=${s.round}`)).status, 403);
    // Received by delegation, usable but never re-delegable (as authoriser or as provisioner).
    assert.equal((await provision(B, 'finance.income.read', null, id(A))).status, 403);
    assert.equal((await provision(B, 'finance.income.manage', null, id(A))).status, 403);
    assert.equal((await provision(B, 'finance.income.read', null, id(A), A)).status, 403);
    assert.equal(await can(B, 'finance.income.read'), false);
    assert.equal(s.count('delegated_permission', `user_id='${id(B)}'`), 0, 'nothing was created for B');
  } finally { s.f.close(); }
});
