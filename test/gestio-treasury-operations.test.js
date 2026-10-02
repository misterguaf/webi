// FASE 3.5G.2A — Tresoreria operativa: summary, movement list/filters/detail, reveal, classification,
// correction with history, duplicates, expense from a movement, expense list/detail/recognition and the
// permission boundaries the screens rely on. The server is the boundary; the UI only mirrors it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, id } from './helpers/gestio-sqlite.js';

const ROUND = { code: '2026/2027', periodStart: '2026-10-01', periodEnd: '2027-09-30', annualFeeRoundId: id(901) };
const csv = rows => ['# synthetic', 'operation_date,value_date,amount_cents,reference,description,balance_cents', ...rows].join('\n');

async function setup() {
  const f = fixture();
  for (const user of [101, 102, 104, 105, 107]) await f.login(user);
  const call = (user, path, method = 'GET', body) => f.request(user, path, { method, body });
  const round = (await call(104, '/api/finance/rounds', 'POST', ROUND)).data.id;
  assert.equal((await call(104, `/api/finance/rounds/${round}/open`, 'POST', { expectedVersion: 1 })).status, 200);
  const position = async (kind, name) => (await call(104, '/api/finance/positions', 'POST', { kind, name })).data.id;
  const bank = await position('BANK', 'Compte corrent'), card = await position('CARD', 'Targeta'), cash = await position('CASH', 'Caixa');
  const manual = async (positionId, amountCents, operationDate = '2026-11-02', label = 'Moviment de prova') =>
    (await call(104, '/api/finance/movements', 'POST', { positionId, operationDate, amountCents, label })).data.id;
  const detail = async movementId => (await call(104, `/api/finance/movements/${movementId}`)).data;
  const economics = async () => (await call(104, `/api/finance/rounds/${round}`)).data.economics;
  const line = async input => {
    const response = await call(104, '/api/finance/budget-lines', 'POST', { roundId: round, ...input });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return response.data.id;
  };
  const income = await line({ code: '1', name: 'Finançament', nature: 'INCOME' });
  const quotes = await line({ code: '1.1', name: 'Quotes', nature: 'INCOME', parentId: income });
  const camps = await line({ code: '2', name: 'Campaments', nature: 'EXPENSE' });
  const summer = await line({ code: '2.3', name: 'Campament d’Estiu', nature: 'EXPENSE', parentId: camps });
  const kitchen = await line({ code: '2.3.5', name: 'Cuina', nature: 'EXPENSE', parentId: summer });
  const transport = await line({ code: '2.3.1', name: 'Autobús', nature: 'EXPENSE', parentId: summer });
  const office = await line({ code: '3', name: 'Oficina', nature: 'EXPENSE' });
  const lines = { income, quotes, camps, summer, kitchen, transport, office };
  const count = (table, where = '1=1') => f.sql.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).get().n;
  return { f, call, round, bank, card, cash, manual, detail, economics, lines, count };
}
const list = async (s, query = '', user = 104) => {
  const response = await s.call(user, `/api/finance/movements${query ? `?${query}` : ''}`);
  assert.equal(response.status, 200, JSON.stringify(response.data));
  return response.data.movements;
};

test('summary: only the blocks each person may read; section coordination, Secretaria and TECH_ADMIN get nothing', async () => {
  const s = await setup();
  try {
    await s.manual(s.bank, 12000); await s.manual(s.bank, -3000);
    const summary = (await s.call(104, '/api/finance/summary')).data;
    assert.equal(summary.round.code, '2026/2027');
    assert.deepEqual(summary.positions.map(p => p.kind), ['BANK', 'CARD', 'CASH']);
    assert.equal(summary.positions.find(p => p.id === s.bank).balanceCents, 9000);
    assert.equal(summary.movements.pendingCount, 2);
    assert.equal(summary.expenses.proposedCount, 0);
    assert.ok(!('resultCents' in summary) && !JSON.stringify(summary).includes('result'), 'no result, profit or budget consumption on Inici');
    assert.equal((await s.call(101, '/api/finance/summary')).status, 200, 'general coordination enters Tresoreria');
    for (const user of [102, 105, 107]) {
      assert.equal((await s.call(user, '/api/finance/summary')).status, 403, `user ${user}`);
      const caps = (await s.call(user, '/api/me')).data.capabilities.treasury;
      assert.ok(Object.values(caps).every(value => value === false));
    }
    assert.ok(s.f.denials(105) > 0, 'the denial is audited');
  } finally { s.f.close(); }
});

test('financial delegation: movement.read only gives the movement block, no balances, no expenses, no classification', async () => {
  const s = await setup();
  try {
    const delegate = 9601;
    s.f.sql.exec(`INSERT INTO app_user(id,display_name,status,created_at,updated_at) VALUES('${id(delegate)}','Suport Tresoreria (fictici)','ACTIVE',1,1)`);
    await s.f.login(delegate);
    const created = await s.call(107, '/api/delegations', 'POST', { userId: id(delegate), permissionCode: 'finance.movement.read', sectionId: null,
      authorizedBy: id(101), authorizationReference: 'DEMO-G2A-MOVEMENT-READ', expiresAt: Date.now() + 86400000 });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    await s.call(101, `/api/delegations/${created.data.id}/confirm`, 'POST', {});
    assert.equal((await s.call(101, `/api/delegations/${created.data.id}/ratify`, 'POST', { ratificationReference: 'DEMO-G2A-RATIFIED' })).status, 200);
    const movement = await s.manual(s.bank, -2500);
    const summary = (await s.call(delegate, '/api/finance/summary')).data;
    assert.equal(summary.movements.pendingCount, 1);
    assert.equal(summary.positions, undefined, 'no balances without treasury.read');
    assert.equal(summary.expenses, undefined, 'no expenses without expense.read');
    assert.equal(summary.positionOptions.length, 3, 'position names for the filter');
    const caps = (await s.call(delegate, '/api/me')).data.capabilities.treasury;
    assert.deepEqual([caps.read, caps.readMovements, caps.classifyMovements, caps.readExpenses], [false, true, false, false]);
    assert.equal((await list(s, '', delegate)).length, 1);
    assert.equal((await s.call(delegate, `/api/finance/movements/${movement}/allocations`, 'POST', { expectedVersion: 0, allocations: [] })).status, 403);
    assert.equal((await s.call(delegate, `/api/finance/rounds/${s.round}/assignable-lines?nature=EXPENSE`)).status, 403);
    assert.equal((await s.call(delegate, `/api/finance/rounds/${s.round}/assignable-lines?nature=INCOME`)).status, 200);
    assert.equal((await s.call(delegate, `/api/finance/expenses?roundId=${s.round}`)).status, 403);
    assert.equal((await s.call(delegate, `/api/finance/movements/${movement}/description`)).status, 403);
  } finally { s.f.close(); }
});

test('movement list: status, position, dates, direction and search filters on the sanitised projection only', async () => {
  const s = await setup();
  try {
    const content = csv([
      '2026-11-03,,10000,R-001,TRF. Família Secreta Demo (fictícia),1500000',
      '2026-11-04,,-5220,R-002,Rebut material (fictici),1494780']);
    assert.equal((await s.call(104, '/api/finance/import-batches', 'POST', { positionId: s.bank, format: 'SYNTHETIC_CSV_V1', content })).status, 201);
    const cash = await s.manual(s.cash, -1500, '2026-12-01', 'Pagament caixa');
    const rows = await list(s);
    assert.equal(rows.length, 3);
    const raw = JSON.stringify(rows);
    for (const forbidden of ['fingerprint', 'Secreta', 'original_text', 'description']) assert.ok(!raw.includes(forbidden), `list never carries ${forbidden}`);
    assert.ok(rows.every(row => row.status === 'PENDING' && Array.isArray(row.classification)));
    assert.deepEqual((await list(s, `positionId=${s.cash}`)).map(row => row.id), [cash]);
    assert.equal((await list(s, 'direction=in')).length, 1);
    assert.equal((await list(s, 'direction=out')).length, 2);
    assert.equal((await list(s, 'from=2026-11-04&to=2026-11-30')).length, 1);
    assert.equal((await list(s, 'q=R-002')).length, 1, 'search by reference');
    assert.equal((await list(s, 'q=caixa')).length, 1, 'search by position name');
    assert.equal((await list(s, 'q=Secreta')).length, 0, 'the original description is never searched');
    assert.equal((await list(s, 'q=100%25')).length, 0, 'LIKE wildcards are escaped');
    assert.equal((await s.call(104, '/api/finance/movements?status=nope')).status, 400);
    assert.equal((await s.call(104, '/api/finance/movements?direction=sideways')).status, 400);
    const income = rows.find(row => row.amountCents === 10000);
    const allocated = await s.call(104, `/api/finance/movements/${income.id}/allocations`, 'POST', { expectedVersion: 0,
      allocations: [{ kind: 'INCOME', amountCents: 10000, budgetLineId: s.lines.quotes }] });
    assert.equal(allocated.status, 200);
    assert.deepEqual((await list(s, 'status=classified')).map(row => row.id), [income.id]);
    assert.equal((await list(s, 'status=pending')).length, 2);
    const classified = (await list(s, 'status=classified'))[0];
    assert.equal(classified.classification[0].budgetLine.name, 'Quotes');
    assert.deepEqual(classified.classification[0].budgetLine.path, ['Finançament', 'Quotes']);
  } finally { s.f.close(); }
});

test('original description: refused by default (audited), revealed on demand with the permission, never in lists or details', async () => {
  const s = await setup();
  try {
    const content = csv(['2026-11-03,,10000,R-001,TRF. Família Reveal Demo (fictícia),1500000']);
    await s.call(104, '/api/finance/import-batches', 'POST', { positionId: s.bank, format: 'SYNTHETIC_CSV_V1', content });
    const [row] = await list(s);
    const detail = await s.detail(row.id);
    assert.equal(detail.movement.hasDescription, true);
    assert.ok(!JSON.stringify(detail).includes('Reveal'), 'the detail carries no original text');
    const denied = await s.call(104, `/api/finance/movements/${row.id}/description`);
    assert.equal(denied.status, 403, 'nobody has the reveal permission by default, not even Tresoreria');
    assert.equal(s.count('audit_event', "action='AUTHZ_DENY' AND resource_type='finance_movement'"), 1);
    assert.equal((await s.call(101, `/api/finance/movements/${row.id}/description`)).status, 403);
    s.f.sql.exec(`INSERT INTO user_permission_grant(id,user_id,permission_code,valid_from,justification) VALUES('${id(9701)}','${id(104)}','finance.bank_description.reveal',1,'Fixture')`);
    const revealed = await s.call(104, `/api/finance/movements/${row.id}/description`);
    assert.equal(revealed.data.description, 'TRF. Família Reveal Demo (fictícia)');
    const audits = s.f.sql.prepare("SELECT * FROM audit_event WHERE action='BANK_DESCRIPTION_REVEALED'").all();
    assert.equal(audits.length, 1);
    assert.ok(!JSON.stringify(audits).includes('Reveal Demo'), 'the audit never stores the description');
    await s.call(104, `/api/finance/movements/${row.id}/description`);
    assert.equal(s.count('audit_event', "action='BANK_DESCRIPTION_REVEALED'"), 2, 'every consultation is audited (no cache)');
  } finally { s.f.close(); }
});

test('classification: enabled kinds only, partial, over-allocation, stale version, correction keeps history', async () => {
  const s = await setup();
  try {
    const movement = await s.manual(s.bank, 20000);
    const allocate = (expectedVersion, allocations) => s.call(104, `/api/finance/movements/${movement}/allocations`, 'POST', { expectedVersion, allocations });
    assert.equal((await allocate(0, [{ kind: 'FEE_PAYMENT', amountCents: 1000, budgetLineId: s.lines.quotes }])).data.error, 'allocation_kind_not_enabled');
    assert.equal((await allocate(0, [{ kind: 'INCOME', amountCents: 25000, budgetLineId: s.lines.quotes }])).data.error, 'allocation_exceeds_movement');
    assert.equal((await allocate(0, [{ kind: 'INCOME', amountCents: 5000, budgetLineId: s.lines.income }])).data.error, 'invalid_income_allocation', 'not a heading');
    assert.equal((await allocate(0, [{ kind: 'INCOME', amountCents: 5000, budgetLineId: s.lines.kitchen }])).data.error, 'invalid_income_allocation', 'not an expense line');
    assert.equal((await allocate(0, [{ kind: 'INCOME', amountCents: 12000, budgetLineId: s.lines.quotes }])).status, 200);
    let detail = await s.detail(movement);
    assert.deepEqual([detail.movement.status, detail.movement.allocatedCents, detail.movement.unallocatedCents], ['PARTIAL', 12000, 8000]);
    assert.equal((await allocate(0, [])).data.error, 'stale_movement', 'expectedVersion conflict');
    // Add the rest keeping the first part; then correct (replace) — every earlier set stays in history.
    const kept = detail.allocations.map(a => ({ kind: a.kind, amountCents: a.amountCents, budgetLineId: a.budgetLineId }));
    assert.equal((await allocate(1, [...kept, { kind: 'INCOME', amountCents: 9000, budgetLineId: s.lines.quotes }])).data.error, 'allocation_exceeds_movement');
    assert.equal((await allocate(1, [...kept, { kind: 'INCOME', amountCents: 8000, budgetLineId: s.lines.quotes }])).status, 200);
    detail = await s.detail(movement);
    assert.equal(detail.movement.status, 'CLASSIFIED');
    assert.equal((await allocate(2, [{ kind: 'INCOME', amountCents: 20000, budgetLineId: s.lines.quotes }])).status, 200);
    detail = await s.detail(movement);
    assert.equal(detail.allocations.length, 1);
    assert.equal(detail.history.length, 2, 'both earlier sets are kept');
    assert.deepEqual(detail.history.map(entry => entry.allocations.length), [2, 1]);
    assert.equal(s.count('finance_allocation', `movement_id='${movement}'`), 4, 'nothing is deleted');
    assert.equal(s.count('audit_event', "action='MOVEMENT_RECLASSIFIED'"), 2);
    assert.equal((await s.economics()).incomeCents, 20000, 'only the current set counts');
  } finally { s.f.close(); }
});

test('duplicates: a near match is flagged, reviewed, confirmed as duplicate (kept, not deleted) or kept as valid', async () => {
  const s = await setup();
  try {
    await s.call(104, '/api/finance/import-batches', 'POST', { positionId: s.bank, format: 'SYNTHETIC_CSV_V1', content: csv(['2026-11-05,,-4500,A-1,Compra Demo (fictici),1'])});
    const second = await s.call(104, '/api/finance/import-batches', 'POST', { positionId: s.bank, format: 'SYNTHETIC_CSV_V1',
      content: csv(['2026-11-05,,-4500,A-2,Compra Demo bis (fictici),1', '2026-11-06,,-700,A-3,Altra Demo (fictici),1', '2026-11-06,,-700,A-4,Altra Demo bis (fictici),1']) });
    assert.equal(second.data.flaggedCount, 1);
    const flagged = await list(s, 'status=duplicates');
    assert.equal(flagged.length, 1);
    assert.equal(flagged[0].status, 'POSSIBLE_DUPLICATE');
    const detail = await s.detail(flagged[0].id);
    assert.equal(detail.duplicateCandidates.length, 1);
    const original = detail.duplicateCandidates[0].id;
    const voided = await s.call(104, `/api/finance/movements/${flagged[0].id}/void-duplicate`, 'POST', { duplicateOfId: original, expectedReviewVersion: detail.movement.reviewVersion });
    assert.equal(voided.status, 200);
    assert.equal(s.count('finance_movement', `id='${flagged[0].id}'`), 1, 'never deleted');
    const after = await s.detail(flagged[0].id);
    assert.equal(after.movement.status, 'VOID_DUPLICATE');
    assert.equal(after.duplicateOf.id, original);
    assert.ok(!(await list(s)).some(row => row.id === flagged[0].id), 'a voided duplicate leaves the default list');
    assert.deepEqual((await list(s, 'status=voided')).map(row => row.id), [flagged[0].id]);
    assert.equal((await s.call(104, `/api/finance/movements/${flagged[0].id}/allocations`, 'POST', { expectedVersion: 0, allocations: [] })).data.error, 'movement_voided');
    // The second pair (same file) is not flagged: identical rows of one file are two movements. Keep-as-valid on a flagged one:
    await s.call(104, '/api/finance/import-batches', 'POST', { positionId: s.bank, format: 'SYNTHETIC_CSV_V1', content: csv(['2026-11-06,,-700,A-5,Tercera Demo (fictici),1']) });
    const [again] = await list(s, 'status=duplicates');
    const review = (await s.detail(again.id)).movement.reviewVersion;
    assert.equal((await s.call(104, `/api/finance/movements/${again.id}/clear-review`, 'POST', { expectedReviewVersion: review })).status, 200);
    assert.equal((await s.detail(again.id)).movement.status, 'PENDING');
    assert.equal((await s.call(104, `/api/finance/movements/${again.id}/clear-review`, 'POST', { expectedReviewVersion: review })).status, 409);
  } finally { s.f.close(); }
});

test('expense from a movement: one recognised expense, split lines, settled by the movement and counted once', async () => {
  const s = await setup();
  try {
    const supplier = (await s.call(104, '/api/finance/counterparties', 'POST', { kind: 'ORGANIZATION', displayName: 'Autocars Demo (fictici)' })).data.id;
    const movement = await s.manual(s.bank, -36000, '2026-11-10', 'Càrrec autobús');
    const create = (body, expectedVersion = 0) => s.call(104, `/api/finance/movements/${movement}/expense`, 'POST',
      { expectedVersion, roundId: s.round, expenseDate: '2026-11-10', concept: 'Autobús Campament', counterpartyId: supplier, ...body });
    const expensesBefore = s.count('finance_expense');
    assert.equal((await create({ lines: [{ budgetLineId: s.lines.transport, amountCents: 40000 }] })).data.error, 'allocation_exceeds_movement');
    assert.equal((await create({ lines: [{ budgetLineId: s.lines.summer, amountCents: 1000 }] })).data.error, 'invalid_expense_line', 'a heading is not assignable');
    assert.equal((await create({ lines: [{ budgetLineId: s.lines.quotes, amountCents: 1000 }] })).data.error, 'invalid_expense_line', 'wrong nature');
    assert.equal((await create({ lines: [{ budgetLineId: s.lines.transport, amountCents: 1000 }] }, 3)).data.error, 'stale_movement');
    assert.equal((await create({ lines: [] })).status, 400);
    assert.equal(s.count('finance_expense'), expensesBefore, 'a rejected attempt leaves nothing behind');
    const ok = await create({ lines: [{ budgetLineId: s.lines.transport, amountCents: 20000 }, { budgetLineId: s.lines.kitchen, amountCents: 16000 }] });
    assert.equal(ok.status, 201, JSON.stringify(ok.data));
    const detail = (await s.call(104, `/api/finance/expenses/${ok.data.expenseId}`)).data;
    assert.deepEqual([detail.expense.status, detail.expense.concept, detail.expense.totalCents, detail.expense.paymentMethod], ['RECOGNISED', 'Autobús Campament', 36000, 'BANK']);
    assert.deepEqual(detail.lines.map(l => [l.budgetLine.path.join(' › '), l.amountCents]),
      [['Campaments › Campament d’Estiu › Autobús', 20000], ['Campaments › Campament d’Estiu › Cuina', 16000]]);
    assert.deepEqual(detail.settlements.map(x => [x.movementId, x.kind, x.amountCents, x.positionName]), [[movement, 'EXPENSE_SETTLEMENT', 36000, 'Compte corrent']]);
    assert.equal(detail.expense.settlementState, 'SETTLED');
    assert.deepEqual(detail.evidence, [], 'no evidence: the screen says “Sense justificant adjunt”');
    assert.equal((await s.detail(movement)).movement.status, 'CLASSIFIED');
    const economics = await s.economics();
    assert.deepEqual([economics.expenseGrossCents, economics.proposedExpenseCents], [36000, 0], 'counted once: the expense, not the movement too');
    // Positive movements cannot become expenses.
    const incoming = await s.manual(s.bank, 5000);
    assert.equal((await s.call(104, `/api/finance/movements/${incoming}/expense`, 'POST', { expectedVersion: 0, roundId: s.round, expenseDate: '2026-11-10',
      concept: 'X', lines: [{ budgetLineId: s.lines.transport, amountCents: 5000 }] })).data.error, 'invalid_allocation_direction');
    // Needs both classify and expense.manage.
    assert.equal((await s.call(105, `/api/finance/movements/${incoming}/expense`, 'POST', {})).status, 403);
  } finally { s.f.close(); }
});

test('expenses: list filters and enriched rows, manual proposal not counted, recognition once, revision history, self-approval, counterparties', async () => {
  const s = await setup();
  try {
    const supplier = (await s.call(104, '/api/finance/counterparties', 'POST', { kind: 'ORGANIZATION', displayName: 'Ferreteria Demo (fictici)' })).data.id;
    assert.equal((await s.call(104, '/api/finance/counterparties', 'POST', { kind: 'ORGANIZATION', displayName: 'Ferreteria Real' })).status, 400, 'synthetic-only names');
    assert.equal((await s.call(104, '/api/finance/counterparties', 'POST', { kind: 'ORGANIZATION', displayName: 'Banc Demo (fictici)', iban: 'ES00' })).status, 400, 'no IBAN or CRM data');
    const scouter = (await s.call(104, '/api/finance/counterparties', 'POST', { kind: 'PERSON', displayName: 'Scouter Demo (fictici)', userId: id(102) })).data.id;
    const post = body => s.call(104, '/api/finance/expenses', 'POST', { roundId: s.round, expenseDate: '2026-11-12', ...body });
    const proposal = await post({ concept: 'Material de manualitats', counterpartyId: supplier, totalCents: 4500, paymentMethod: 'BANK',
      lines: [{ budgetLineId: s.lines.office, amountCents: 4500 }] });
    assert.equal(proposal.data.status, 'PROPOSED');
    const multi = await post({ concept: 'Compra mixta', totalCents: 10000, paymentMethod: 'CARD', recognise: true, expenseDate: '2026-12-01',
      lines: [{ budgetLineId: s.lines.kitchen, amountCents: 7000 }, { budgetLineId: s.lines.transport, amountCents: 3000 }] });
    assert.equal(multi.data.status, 'RECOGNISED');
    assert.equal((await post({ concept: 'Descuadrada', totalCents: 9000, paymentMethod: 'CARD', recognise: true,
      lines: [{ budgetLineId: s.lines.kitchen, amountCents: 7000 }] })).data.error, 'expense_lines_total_mismatch');
    assert.equal((await post({ concept: 'Línia d’ingressos', totalCents: 1000, paymentMethod: 'CARD', recognise: true,
      lines: [{ budgetLineId: s.lines.quotes, amountCents: 1000 }] })).data.error, 'invalid_expense_line');
    assert.equal((await post({ concept: 'x'.repeat(121), totalCents: 1000, paymentMethod: 'CARD' })).status, 400);
    let economics = await s.economics();
    assert.deepEqual([economics.expenseGrossCents, economics.proposedExpenseCents], [10000, 4500], 'proposed is not counted');
    const rows = async query => (await s.call(104, `/api/finance/expenses?roundId=${s.round}${query}`)).data.expenses;
    const all = await rows('');
    assert.equal(all.length, 2);
    const mixed = all.find(row => row.id === multi.data.id);
    assert.deepEqual([mixed.concept, mixed.lineCount, mixed.mainLine.name, mixed.settledCents], ['Compra mixta', 2, 'Cuina', 0]);
    assert.equal(all.find(row => row.id === proposal.data.id).counterpartyName, 'Ferreteria Demo (fictici)');
    assert.deepEqual((await rows('&status=PROPOSED')).map(row => row.id), [proposal.data.id]);
    assert.deepEqual((await rows(`&budgetLineId=${s.lines.camps}`)).map(row => row.id), [multi.data.id], 'a heading selects every line below it');
    assert.deepEqual((await rows(`&counterpartyId=${supplier}`)).map(row => row.id), [proposal.data.id]);
    assert.deepEqual((await rows('&from=2026-11-20')).map(row => row.id), [multi.data.id]);
    assert.equal((await s.call(104, `/api/finance/expenses?roundId=${s.round}&status=MAYBE`)).status, 400);
    // Recognition: once; then revision keeps the previous concept in history.
    assert.equal((await s.call(104, `/api/finance/expenses/${proposal.data.id}/recognise`, 'POST', { expectedVersion: 1 })).data.status, 'RECOGNISED');
    assert.equal((await s.call(104, `/api/finance/expenses/${proposal.data.id}/recognise`, 'POST', { expectedVersion: 2 })).data.error, 'invalid_transition');
    economics = await s.economics();
    assert.deepEqual([economics.expenseGrossCents, economics.proposedExpenseCents], [14500, 0]);
    assert.equal((await s.call(104, `/api/finance/expenses/${proposal.data.id}`, 'PATCH', { concept: 'Material de manualitats (revisat)', expectedVersion: 2 })).status, 200);
    assert.equal((await s.call(104, `/api/finance/expenses/${proposal.data.id}`, 'PATCH', { concept: 'Una altra', expectedVersion: 2 })).data.error, 'stale_expense');
    const revised = (await s.call(104, `/api/finance/expenses/${proposal.data.id}`)).data;
    assert.equal(revised.expense.concept, 'Material de manualitats (revisat)');
    assert.deepEqual(revised.revisions.map(r => r.previousConcept), ['Material de manualitats']);
    // Settlement: a card movement settles the card expense; the expense is still counted once.
    const charge = await s.manual(s.card, -10000, '2026-12-02');
    assert.equal((await s.call(104, `/api/finance/movements/${charge}/allocations`, 'POST', { expectedVersion: 0,
      allocations: [{ kind: 'EXPENSE_SETTLEMENT', amountCents: 10000, expenseId: multi.data.id }] })).status, 200);
    assert.equal((await rows(`&status=RECOGNISED`)).find(row => row.id === multi.data.id).settledCents, 10000);
    assert.equal((await s.economics()).expenseGrossCents, 14500, 'settling does not count the expense again');
    // Self-approval: the scouter who advanced the money cannot recognise it, even holding expense.manage.
    const advance = await post({ concept: 'Piles', totalCents: 800, paymentMethod: 'ADVANCED', advancedById: scouter, lines: [{ budgetLineId: s.lines.office, amountCents: 800 }] });
    s.f.sql.exec(`INSERT INTO user_role(id,user_id,role_code,valid_from,justification) VALUES('${id(9711)}','${id(102)}','TREASURY',1,'Fixture');
      INSERT INTO user_permission_grant(id,user_id,permission_code,valid_from,justification) VALUES('${id(9712)}','${id(102)}','finance.expense.manage',1,'Fixture')`);
    assert.equal((await s.call(102, `/api/finance/expenses/${advance.data.id}/recognise`, 'POST', { expectedVersion: 1 })).data.error, 'self_approval');
    assert.equal(s.count('audit_event', "action='AUTHZ_DENY' AND reason_code='SELF_APPROVAL'"), 1);
    // The line picker returns names only (no amounts) and marks assignable leaves.
    const picker = (await s.call(104, `/api/finance/rounds/${s.round}/assignable-lines?nature=EXPENSE`)).data.lines;
    assert.deepEqual(picker.filter(l => l.assignable).map(l => l.code).sort(), ['2.3.1', '2.3.5', '3']);
    assert.ok(picker.every(l => !('plannedCents' in l) && !('currentCents' in l)));
  } finally { s.f.close(); }
});
