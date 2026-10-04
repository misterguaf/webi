// FASE 3.5G.1 — financial foundation (TREASURY.md): rounds, positions, opening balances, movements, import
// idempotency, typed allocations, internal transfers, expenses, counterparties and the budget.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, id, migrations, root } from './helpers/gestio-sqlite.js';
import { buildDemoData, buildTreasuryDemo } from '../gestio/demo/data.js';
import { submitRegistration } from '../gestio/src/services/registration-service.js';

const ROUND = { code: '2026/2027', periodStart: '2026-10-01', periodEnd: '2027-09-30', annualFeeRoundId: id(901) };
const csv = rows => ['# synthetic', 'operation_date,value_date,amount_cents,reference,description,balance_cents', ...rows].join('\n');
const evidence = { filename: 'ticket-synthetic.pdf', mime: 'application/pdf',
  dataBase64: Buffer.from('%PDF-1.4\n%synthetic local fixture\n1 0 obj <<>> endobj\n%%EOF').toString('base64') };

async function setup({ open = true } = {}) {
  const f = fixture();
  for (const user of [101, 102, 104, 105, 107]) await f.login(user);
  const call = (user, path, method = 'GET', body) => f.request(user, path, { method, body });
  const created = await call(104, '/api/finance/rounds', 'POST', ROUND);
  assert.equal(created.status, 201);
  const round = created.data.id;
  if (open) assert.equal((await call(104, `/api/finance/rounds/${round}/open`, 'POST', { expectedVersion: 1 })).status, 200);
  const position = async (kind, name) => (await call(104, '/api/finance/positions', 'POST', { kind, name })).data.id;
  const bank = await position('BANK', 'Compte corrent'), card = await position('CARD', 'Targeta de crèdit'), cash = await position('CASH', 'Caixa');
  const manual = async (positionId, amountCents, operationDate = '2026-11-02', label = 'Moviment de prova') =>
    (await call(104, '/api/finance/movements', 'POST', { positionId, operationDate, amountCents, label })).data.id;
  const movement = async movementId => (await call(104, `/api/finance/movements/${movementId}`)).data.movement;
  const economics = async () => (await call(104, `/api/finance/rounds/${round}`)).data.economics;
  const line = async (input) => {
    const response = await call(104, '/api/finance/budget-lines', 'POST', { roundId: round, ...input });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return response.data.id;
  };
  const audits = action => f.sql.prepare('SELECT * FROM audit_event WHERE action=?').all(action);
  return { f, call, round, bank, card, cash, manual, movement, economics, line, audits };
}
// A minimal catalogue: income Quotes and the expense tree Campaments > Estiu > Cuina (3 levels).
async function catalogue(s) {
  const incomeRoot = await s.line({ code: '1', name: 'Finançament', nature: 'INCOME' });
  const quotes = await s.line({ code: '1.1', name: 'Quotes', nature: 'INCOME', parentId: incomeRoot, plannedCents: 1000000 });
  const camps = await s.line({ code: '2', name: 'Campaments', nature: 'EXPENSE' });
  const summer = await s.line({ code: '2.3', name: 'Campament d’Estiu', nature: 'EXPENSE', parentId: camps });
  const kitchen = await s.line({ code: '2.3.5', name: 'Cuina', nature: 'EXPENSE', parentId: summer, plannedCents: 1100000 });
  const transport = await s.line({ code: '2.3.1', name: 'Autobús', nature: 'EXPENSE', parentId: summer, plannedCents: 600000 });
  return { incomeRoot, quotes, camps, summer, kitchen, transport };
}

test('rounds: one OPEN at a time, no overlap, draft-only definition, closed rounds immutable; positions and opening balances', async () => {
  const s = await setup();
  try {
    const next = await s.call(104, '/api/finance/rounds', 'POST', { code: '2027/2028', periodStart: '2027-10-01', periodEnd: '2028-09-30' });
    assert.equal(next.status, 201);
    assert.equal((await s.call(104, `/api/finance/rounds/${next.data.id}/open`, 'POST', { expectedVersion: 1 })).data.error, 'open_round_exists');
    assert.equal((await s.call(104, '/api/finance/rounds', 'POST', { code: '2025/2026', periodStart: '2026-09-01', periodEnd: '2027-08-31' })).data.error,
      'finance_round_overlap');
    assert.equal((await s.call(104, '/api/finance/rounds', 'POST', { ...ROUND, annualFeeRoundId: undefined })).status, 409, 'duplicate code');
    assert.equal((await s.call(104, `/api/finance/rounds/${s.round}`, 'PATCH', { periodEnd: '2027-08-31', expectedVersion: 2 })).data.error,
      'finance_round_locked', 'an open round keeps its period');
    assert.equal((await s.call(104, `/api/finance/rounds/${next.data.id}`, 'PATCH', { periodEnd: '2028-08-31', expectedVersion: 7 })).data.error, 'stale_round');
    // OPEN → CLOSING → OPEN; CLOSED needs the official close snapshot and never reopens.
    assert.equal((await s.call(104, `/api/finance/rounds/${s.round}/closing`, 'POST', { expectedVersion: 2 })).status, 200);
    assert.equal((await s.call(104, `/api/finance/rounds/${s.round}/open`, 'POST', { expectedVersion: 3 })).status, 200);
    assert.throws(() => s.f.sql.exec(`UPDATE finance_round SET status='CLOSED',closed_by='${id(104)}',closed_at=1 WHERE id='${s.round}'`),
      /invalid_finance_round_transition|finance_round_close_snapshot_required/);
    assert.throws(() => s.f.sql.exec(`DELETE FROM finance_round WHERE id='${s.round}'`), /finance_round_immutable/);
    // Positions: several of a kind allowed, no IBAN-like reference, derived balance.
    assert.equal((await s.call(104, '/api/finance/positions', 'POST', { kind: 'BANK', name: 'Segon compte (fictici)' })).status, 201);
    assert.equal((await s.call(104, '/api/finance/positions', 'POST', { kind: 'BANK', name: 'Compte', maskedReference: 'ES7600000000000000000000' })).status, 400);
    assert.throws(() => s.f.sql.exec(`UPDATE finance_position SET kind='CASH' WHERE id='${s.bank}'`), /finance_position_kind_immutable/);
    const opening = await s.call(104, `/api/finance/rounds/${s.round}/opening-balances`, 'POST', { positionId: s.bank, amountCents: 1500000, expectedRevision: 0 });
    assert.equal(opening.status, 201);
    assert.equal((await s.call(104, `/api/finance/rounds/${s.round}/opening-balances`, 'POST', { positionId: s.bank, amountCents: 1600000, expectedRevision: 0 })).data.error,
      'stale_opening_balance');
    assert.equal((await s.call(104, `/api/finance/rounds/${s.round}/opening-balances`, 'POST', { positionId: s.bank, amountCents: 1568112, expectedRevision: 1 })).status, 201);
    assert.equal((await s.call(104, `/api/finance/rounds/${s.round}/reserves`, 'POST', { amountCents: 1200000, expectedRevision: 0 })).status, 201);
    assert.throws(() => s.f.sql.exec(`UPDATE finance_opening_balance SET amount_cents=1 WHERE round_id='${s.round}'`), /opening_balance_immutable/);
    await s.manual(s.bank, 25000); await s.manual(s.bank, -10000);
    await s.manual(s.bank, -999, '2027-11-01', 'Fora de la ronda');
    await s.manual(s.card, -3000);
    const positions = (await s.call(104, '/api/finance/positions')).data;
    assert.equal(positions.roundId, s.round);
    const bankBalance = positions.positions.find(row => row.id === s.bank).balance;
    assert.deepEqual(bankBalance, { openingCents: 1568112, movementsCents: 15000, balanceCents: 1583112 }, 'reserves are not the financial position');
    assert.equal(positions.positions.find(row => row.id === s.card).balance.debtCents, 3000);
    const detail = (await s.call(104, `/api/finance/rounds/${s.round}`)).data;
    assert.equal(detail.reserves.amountCents, 1200000);
    assert.equal(detail.openingBalances.find(row => row.positionId === s.bank).revision, 2);
  } finally { s.f.close(); }
});

test('G.4: Treasury closes with an immutable exact snapshot and explicit reserve result', async () => {
  const s = await setup();
  try {
    assert.equal((await s.call(104, `/api/finance/rounds/${s.round}/reserves`, 'POST',
      { amountCents: 10000, expectedRevision: 0 })).status, 201);
    assert.equal((await s.call(104, `/api/finance/rounds/${s.round}/reserve-operations`, 'POST',
      { kind: 'CONTRIBUTION', amountCents: 3000 })).status, 201);
    assert.equal((await s.call(104, `/api/finance/rounds/${s.round}/reserve-operations`, 'POST',
      { kind: 'APPLICATION', amountCents: 2000 })).status, 201);
    assert.equal((await s.call(104, `/api/finance/rounds/${s.round}/reserve-operations`, 'POST',
      { kind: 'APPLICATION', amountCents: 12000 })).data.error, 'insufficient_reserve');
    assert.throws(() => s.f.sql.exec(`INSERT INTO finance_reserve_operation
      (id,round_id,kind,amount_cents,created_by,created_at)
      VALUES('${crypto.randomUUID()}','${s.round}','APPLICATION',12000,'${id(104)}',1)`),
    /invalid_reserve_operation/);
    assert.equal((await s.call(104, `/api/finance/rounds/${s.round}/closing`, 'POST',
      { expectedVersion: 2 })).status, 200);
    assert.equal((await s.call(101, `/api/finance/rounds/${s.round}/close`, 'POST',
      { expectedVersion: 3 })).status, 403, 'coordination can manage rounds but Treasury closes');
    assert.throws(() => s.f.sql.exec(`INSERT INTO finance_round_close
      (round_id,income_cents,expense_cents,result_cents,reserves_final_cents,closed_by,closed_at)
      VALUES('${s.round}',0,0,0,0,'${id(104)}',1)`), /invalid_finance_round_close/);
    assert.equal((await s.call(104, `/api/finance/rounds/${s.round}/close`, 'POST',
      { expectedVersion: 3 })).status, 200);
    const detail = (await s.call(104, `/api/finance/rounds/${s.round}`)).data;
    assert.deepEqual([detail.officialClose.reservesFinalCents, detail.officialClose.reserveContributionCents,
      detail.officialClose.reserveApplicationCents, detail.officialClose.resultAfterReservesCents],
    [11000, 3000, 2000, -1000]);
    assert.equal(detail.round.status, 'CLOSED');
    assert.throws(() => s.f.sql.exec(`UPDATE finance_round_close SET result_cents=100 WHERE round_id='${s.round}'`),
      /finance_round_close_immutable/);
    assert.equal((await s.call(104, `/api/finance/rounds/${s.round}/reserve-operations`, 'POST',
      { kind: 'CONTRIBUTION', amountCents: 1 })).status, 409);
    assert.equal(s.audits('TREASURY_ROUND_CLOSED').length, 1);
  } finally { s.f.close(); }
});

test('permissions: treasury and general coordination act; section coordination, Secretaria/delegate and TECH_ADMIN see nothing', async () => {
  const s = await setup();
  try {
    for (const user of [102, 105, 107]) {
      for (const path of ['/api/finance/rounds', '/api/finance/positions', '/api/finance/movements', `/api/finance/rounds/${s.round}/budget`,
        `/api/finance/expenses?roundId=${s.round}`, '/api/finance/counterparties'])
        assert.equal((await s.call(user, path)).status, 403, `${user} ${path}`);
      const caps = (await s.call(user, '/api/me')).data.capabilities.treasury;
      assert.ok(Object.values(caps).every(value => value === false), `${user} has no treasury capability`);
    }
    assert.equal((await s.call(101, '/api/finance/rounds')).status, 200);
    const treasury = (await s.call(104, '/api/me')).data.capabilities.treasury;
    assert.equal(treasury.read, true); assert.equal(treasury.approveBudget, false); assert.equal(treasury.revealDescriptions, false);
    const coordination = (await s.call(101, '/api/me')).data.capabilities.treasury;
    assert.equal(coordination.approveBudget, true); assert.equal(coordination.importMovements, false, 'import is an explicit grant for coordination');
    assert.ok(s.f.denials(107) > 0, 'denials are audited');
  } finally { s.f.close(); }
});

test('movements: synthetic import, idempotency by file and fingerprint, near matches flagged, immutable facts, protected description', async () => {
  const s = await setup();
  try {
    const content = csv([
      '2026-11-03,2026-11-03,10000,R-001,TRF. Família Demo 01 (fictícia),1500000',
      '2026-11-03,2026-11-03,10000,R-001,TRF. Família Demo 01 (fictícia),1500000',
      '2026-11-04,,-5220,,"Rebut demo, administració (fictici)",1494780',
      '2026-11-05,,8000,,TRF. Família Demo 02 (fictícia),1494780']);
    const first = await s.call(104, '/api/finance/import-batches', 'POST', { positionId: s.bank, format: 'SYNTHETIC_CSV_V1', content });
    assert.equal(first.status, 201);
    assert.deepEqual([first.data.rowCount, first.data.createdCount, first.data.duplicateCount, first.data.flaggedCount], [4, 4, 0, 0],
      'two identical rows are two movements (ordinal); the same balance does not merge movements');
    assert.equal((await s.call(104, '/api/finance/import-batches', 'POST', { positionId: s.bank, format: 'SYNTHETIC_CSV_V1', content })).data.error,
      'duplicate_import', 'the same file is never imported twice');
    // An overlapping export: the known rows are skipped, a different description on the same day and amount is flagged.
    const overlap = csv([
      '2026-11-03,2026-11-03,10000,R-001,TRF. FAMÍLIA   DEMO 01 (fictícia),1500000',
      '2026-11-05,,8000,,TRF. Altra família Demo (fictícia),1502780',
      '2026-11-06,,2500,,TRF. Família Demo 03 (fictícia),']);
    const second = await s.call(104, '/api/finance/import-batches', 'POST', { positionId: s.bank, format: 'SYNTHETIC_CSV_V1', content: overlap });
    assert.deepEqual([second.data.createdCount, second.data.duplicateCount, second.data.flaggedCount], [2, 1, 1],
      'case and spacing do not change the identity; a near match is imported flagged, never dropped');
    assert.equal((await s.call(104, '/api/finance/import-batches', 'POST', { positionId: s.bank, format: 'SYNTHETIC_CSV_V1',
      content: overlap.replace('# synthetic\n', '') })).data.error, 'synthetic_import_required');
    assert.equal((await s.call(102, '/api/finance/import-batches', 'POST', { positionId: s.bank, format: 'SYNTHETIC_CSV_V1', content })).status, 403);
    const listed = (await s.call(104, `/api/finance/movements?positionId=${s.bank}`)).data.movements;
    assert.equal(listed.length, 6);
    assert.doesNotMatch(JSON.stringify(listed), /Família|família|administració|fingerprint/, 'listings carry the minimised label only');
    const flagged = listed.find(row => row.reviewFlag === 'NEAR_MATCH');
    assert.ok(flagged);
    assert.ok(listed.every(row => !('roundId' in row)), 'a movement has no economic round');
    // Immutable: no edit, no delete.
    assert.throws(() => s.f.sql.exec(`UPDATE finance_movement SET amount_cents=1 WHERE id='${flagged.id}'`), /movement_immutable/);
    assert.throws(() => s.f.sql.exec(`DELETE FROM finance_movement WHERE id='${flagged.id}'`), /movement_immutable/);
    assert.throws(() => s.f.sql.exec(`DELETE FROM finance_movement_description WHERE movement_id='${flagged.id}'`), /movement_description_immutable/);
    // The protected original: explicit grant, audited without the value.
    assert.equal((await s.call(104, `/api/finance/movements/${flagged.id}/description`)).status, 403);
    s.f.sql.exec(`INSERT INTO user_permission_grant(id,user_id,permission_code,valid_from,justification) VALUES('${id(9851)}','${id(104)}','finance.bank_description.reveal',1,'Fixture')`);
    const revealed = await s.call(104, `/api/finance/movements/${flagged.id}/description`);
    assert.equal(revealed.data.description, 'TRF. Altra família Demo (fictícia)');
    assert.equal(s.audits('BANK_DESCRIPTION_REVEALED').length, 1);
    // A confirmed duplicate is voided (kept, linked) — here the flagged one is confirmed distinct instead.
    assert.equal((await s.call(104, `/api/finance/movements/${flagged.id}/clear-review`, 'POST', { expectedReviewVersion: 1 })).status, 200);
    const twin = await s.manual(s.bank, 2500, '2026-11-06', 'Doble registre manual');
    const original = listed.find(row => row.amountCents === 2500).id;
    assert.equal((await s.call(104, `/api/finance/movements/${twin}/void-duplicate`, 'POST', { duplicateOfId: original, expectedReviewVersion: 1 })).status, 200);
    const voided = s.f.sql.prepare('SELECT state,duplicate_of_id FROM finance_movement WHERE id=?').get(twin);
    assert.deepEqual({ ...voided }, { state: 'VOID_DUPLICATE', duplicate_of_id: original });
    assert.equal((await s.call(104, `/api/finance/movements?positionId=${s.bank}`)).data.movements.length, 6, 'voided movements leave the active list');
    assert.equal((await s.call(104, `/api/finance/movements/${original}/void-duplicate`, 'POST', { duplicateOfId: s.bank, expectedReviewVersion: 1 })).status, 409);
    // Audit: counts and identifiers only.
    assert.equal(s.audits('MOVEMENT_IMPORTED').map(row => JSON.parse(row.metadata_json).count).join(','), '4,2');
    assert.doesNotMatch(JSON.stringify(s.f.sql.prepare('SELECT * FROM audit_event').all()), /Família|família|fictícia/);
  } finally { s.f.close(); }
});

test('allocations: typed destinations, remaining amount, no over-allocation even concurrently, history kept', async () => {
  const s = await setup();
  try {
    const { quotes, kitchen } = await catalogue(s);
    const income = await s.manual(s.bank, 25000);
    const allocate = (movementId, expectedVersion, allocations, reason) =>
      s.call(104, `/api/finance/movements/${movementId}/allocations`, 'POST', { expectedVersion, allocations, ...(reason ? { reason } : {}) });
    // Several imputations of one movement, with the remainder visible.
    assert.equal((await allocate(income, 0, [{ kind: 'INCOME', amountCents: 10000, budgetLineId: quotes },
      { kind: 'INCOME', amountCents: 10000, budgetLineId: quotes, sectionId: id(2) }])).status, 200);
    assert.deepEqual([(await s.movement(income)).allocatedCents, (await s.movement(income)).unallocatedCents], [20000, 5000]);
    assert.equal((await allocate(income, 1, [{ kind: 'INCOME', amountCents: 25001, budgetLineId: quotes }])).data.error,
      'allocation_correction_reason_required');
    assert.equal((await allocate(income, 1, [{ kind: 'INCOME', amountCents: 25001, budgetLineId: quotes }], 'Corregir classificació')).data.error,
      'allocation_exceeds_movement');
    assert.equal((await allocate(income, 0, [{ kind: 'INCOME', amountCents: 100, budgetLineId: quotes }])).data.error, 'stale_movement');
    assert.equal((await allocate(income, 1, [{ kind: 'INCOME', amountCents: 100, budgetLineId: kitchen }], 'Corregir classificació')).data.error, 'invalid_income_allocation',
      'income needs an income line');
    assert.equal((await allocate(income, 1, [{ kind: 'FAMILY_OVERPAYMENT', amountCents: 100 }])).data.error, 'allocation_kind_not_enabled');
    assert.equal((await allocate(income, 1, [{ kind: 'FEE_PAYMENT', amountCents: 100 }])).data.error, 'invalid_allocation');
    assert.equal((await allocate(income, 1, [{ kind: 'INCOME', amountCents: 100, budgetLineId: quotes, expenseId: id(1) }])).status, 400);
    // Two concurrent reclassifications with the same expected version: exactly one wins.
    const results = await Promise.all([
      allocate(income, 1, [{ kind: 'INCOME', amountCents: 25000, budgetLineId: quotes }], 'Corregir import'),
      allocate(income, 1, [{ kind: 'INCOME', amountCents: 24000, budgetLineId: quotes }], 'Corregir import')]);
    assert.deepEqual(results.map(row => row.status).sort(), [200, 409]);
    assert.equal((await s.movement(income)).allocatedCents, results[0].status === 200 ? 25000 : 24000);
    assert.equal(s.f.sql.prepare('SELECT count(DISTINCT set_version) AS n FROM finance_allocation WHERE movement_id=?').get(income).n, 2, 'previous set kept');
    // The database itself refuses writes outside the current set, above the movement or of a mismatched shape.
    assert.throws(() => s.f.sql.exec(`INSERT INTO finance_allocation(id,movement_id,set_version,kind,amount_cents,round_id,budget_line_id,created_by,created_at)
      VALUES('${id(9861)}','${income}',1,'INCOME',1,'${s.round}','${quotes}','${id(104)}',1)`), /stale_allocation_set/);
    assert.throws(() => s.f.sql.exec(`INSERT INTO finance_allocation(id,movement_id,set_version,kind,amount_cents,round_id,budget_line_id,created_by,created_at)
      VALUES('${id(9862)}','${income}',2,'INCOME',30000,'${s.round}','${quotes}','${id(104)}',1)`), /allocation_exceeds_movement/);
    const spare = await s.manual(s.bank, 300, '2026-11-02', 'Moviment lliure');
    assert.equal((await allocate(spare, 0, [])).status, 200, 'an empty set clears the classification');
    assert.throws(() => s.f.sql.exec(`INSERT INTO finance_allocation(id,movement_id,set_version,kind,amount_cents,round_id,budget_line_id,expense_id,created_by,created_at)
      VALUES('${id(9863)}','${spare}',1,'INCOME',1,'${s.round}','${quotes}','${id(9999)}','${id(104)}',1)`), /CHECK constraint failed/,
    'exactly one typed destination');
    assert.throws(() => s.f.sql.exec(`UPDATE finance_allocation SET amount_cents=1 WHERE movement_id='${income}'`), /allocation_immutable/);
    assert.throws(() => s.f.sql.exec(`DELETE FROM finance_allocation WHERE movement_id='${income}'`), /allocation_immutable/);
    assert.equal(s.audits('MOVEMENT_CLASSIFIED').length + s.audits('MOVEMENT_RECLASSIFIED').length, 3, 'one event per accepted set');
    // A movement cannot be voided while it has allocations.
    const other = await s.manual(s.bank, 25000, '2026-11-02', 'Possible doble');
    assert.equal((await s.call(104, `/api/finance/movements/${income}/void-duplicate`, 'POST', { duplicateOfId: other, expectedReviewVersion: 1 })).data.error,
      'invalid_duplicate_void');
  } finally { s.f.close(); }
});

test('internal transfers: bank → cash and back are balanced pairs that never count as income or expense', async () => {
  const s = await setup();
  try {
    const { quotes } = await catalogue(s);
    const before = await s.economics();
    const withdrawal = await s.manual(s.bank, -50000, '2027-07-20', 'Retirada'), cashIn = await s.manual(s.cash, 50000, '2027-07-20', 'Entrada a caixa');
    const transfer = await s.call(104, '/api/finance/internal-transfers', 'POST',
      { fromMovementId: withdrawal, toMovementId: cashIn, fromExpectedVersion: 0, toExpectedVersion: 0 });
    assert.equal(transfer.status, 201);
    for (const movementId of [withdrawal, cashIn]) assert.equal((await s.movement(movementId)).unallocatedCents, 0);
    assert.deepEqual(await s.economics(), before, 'a transfer is neither income nor expense');
    // Incoherent pairs are refused by the database: same sign, different amount, same position, third party.
    const redeposit = await s.manual(s.cash, -7000, '2027-08-20', 'Reingrés'), bankIn = await s.manual(s.bank, 7000, '2027-08-20', 'Reingrés al banc');
    const wrongAmount = await s.manual(s.bank, 6999, '2027-08-20', 'Import diferent');
    const sameSign = await s.manual(s.bank, -7000, '2027-08-20', 'Mateix signe');
    const pair = (from, to, fromExpectedVersion = 0, toExpectedVersion = 0) =>
      s.call(104, '/api/finance/internal-transfers', 'POST', { fromMovementId: from, toMovementId: to, fromExpectedVersion, toExpectedVersion });
    assert.equal((await pair(redeposit, wrongAmount)).data.error, 'invalid_internal_transfer');
    assert.equal((await pair(redeposit, sameSign)).data.error, 'invalid_internal_transfer');
    const cashOther = await s.manual(s.cash, 7000, '2027-08-20', 'Mateixa posició');
    assert.equal((await pair(redeposit, cashOther)).data.error, 'invalid_internal_transfer', 'same position');
    assert.equal((await pair(redeposit, bankIn)).status, 201);
    assert.equal((await pair(sameSign, cashIn, 0, 1)).data.error, 'invalid_internal_transfer', 'an allocated pair never joins a third movement');
    assert.equal((await s.call(104, `/api/finance/movements/${bankIn}/allocations`, 'POST', { expectedVersion: 1, reason: 'Corregir classificació',
      allocations: [{ kind: 'INCOME', amountCents: 7000, budgetLineId: quotes }] })).status, 200, 'a pair can be reclassified');
    assert.deepEqual(await s.economics(), { ...before, incomeCents: 7000, resultBeforeReservesCents: 7000,
      resultAfterReservesCents: 7000 });
  } finally { s.f.close(); }
});

test('expenses: proposed is not counted, recognised counts once whatever settles it; lines, revisions, counterparties', async () => {
  const s = await setup();
  try {
    const { kitchen, transport, summer } = await catalogue(s);
    const scout = (await s.call(104, '/api/finance/counterparties', 'POST', { kind: 'PERSON', displayName: 'Scouter de prova (fictici)', userId: id(102) })).data.id;
    assert.equal((await s.call(104, '/api/finance/counterparties', 'POST', { kind: 'PERSON', displayName: 'Nom real sense marca' })).status, 400,
      'synthetic-only names');
    assert.equal((await s.call(104, '/api/finance/counterparties', 'POST', { kind: 'ORGANIZATION', displayName: 'Proveïdor (fictici)', iban: 'ES00' })).status, 400,
      'no IBAN or extra data');
    const supplier = (await s.call(104, '/api/finance/counterparties', 'POST', { kind: 'ORGANIZATION', displayName: 'Supermercat Demo (fictici)' })).data.id;
    assert.equal((await s.call(104, '/api/finance/counterparties', 'POST', { kind: 'ORGANIZATION', displayName: 'Empresa (fictícia)', userId: id(105) })).status, 400);
    // A scouter's advanced expense: proposed, then recognised by someone else.
    const advanced = await s.call(104, '/api/finance/expenses', 'POST', { roundId: s.round, expenseDate: '2027-07-25', totalCents: 5000,
      paymentMethod: 'ADVANCED', advancedById: scout, lines: [{ budgetLineId: transport, amountCents: 5000 }] });
    assert.equal(advanced.data.status, 'PROPOSED');
    let economics = await s.economics();
    assert.deepEqual([economics.expenseGrossCents, economics.proposedExpenseCents], [0, 5000], 'a proposal is not an expense');
    assert.equal((await s.call(104, '/api/finance/expenses', 'POST', { roundId: s.round, expenseDate: '2027-07-25', totalCents: 5000, paymentMethod: 'ADVANCED',
      advancedById: scout, lines: [{ budgetLineId: transport, amountCents: 5000 }], recognise: true })).data.error, 'expense_evidence_required');
    assert.equal((await s.call(104, `/api/finance/expenses/${advanced.data.id}/evidence`, 'POST', evidence)).status, 201);
    // The scouter (user 102) cannot recognise their own advance, even holding the permission.
    s.f.sql.exec(`INSERT INTO user_role(id,user_id,role_code,valid_from,justification) VALUES('${id(9871)}','${id(102)}','TREASURY',1,'Fixture');
      INSERT INTO user_permission_grant(id,user_id,permission_code,valid_from,justification) VALUES('${id(9872)}','${id(102)}','finance.expense.manage',1,'Fixture')`);
    assert.equal((await s.call(102, `/api/finance/expenses/${advanced.data.id}/recognise`, 'POST', { expectedVersion: 1 })).data.error, 'self_approval');
    assert.equal(s.f.sql.prepare("SELECT count(*) AS n FROM audit_event WHERE action='AUTHZ_DENY' AND reason_code='SELF_APPROVAL'").get().n, 1);
    assert.throws(() => s.f.sql.exec(`UPDATE finance_expense SET status='RECOGNISED',recognized_by='${id(102)}',recognized_at=1 WHERE id='${advanced.data.id}'`),
      /invalid_expense/);
    assert.equal((await s.call(104, `/api/finance/expenses/${advanced.data.id}/recognise`, 'POST', { expectedVersion: 1 })).data.status, 'RECOGNISED');
    economics = await s.economics();
    assert.deepEqual([economics.expenseGrossCents, economics.proposedExpenseCents], [5000, 0]);
    // A direct card expense recognised at once; its lines must add up to the total.
    assert.equal((await s.call(104, '/api/finance/expenses', 'POST', { roundId: s.round, expenseDate: '2027-07-28', totalCents: 15000, paymentMethod: 'CARD',
      counterpartyId: supplier, lines: [{ budgetLineId: kitchen, amountCents: 9000 }], recognise: true, evidence })).data.error, 'expense_lines_total_mismatch');
    assert.equal((await s.call(104, '/api/finance/expenses', 'POST', { roundId: s.round, expenseDate: '2027-07-28', totalCents: 15000, paymentMethod: 'CARD',
      lines: [{ budgetLineId: summer, amountCents: 15000 }], recognise: true, evidence })).data.error, 'invalid_expense_line', 'lines go to leaves');
    const card = await s.call(104, '/api/finance/expenses', 'POST', { roundId: s.round, expenseDate: '2027-07-28', totalCents: 15000, paymentMethod: 'CARD',
      counterpartyId: supplier, lines: [{ budgetLineId: kitchen, amountCents: 9000 }, { budgetLineId: kitchen, amountCents: 6000, sectionId: id(2) }], recognise: true, evidence });
    assert.equal(card.status, 201);
    assert.throws(() => {
      s.f.sql.exec('BEGIN');
      try { s.f.sql.exec(`INSERT INTO finance_expense_line(expense_id,lines_version,line_no,budget_line_id,amount_cents)
        VALUES('${card.data.id}',2,1,'${kitchen}',1); UPDATE finance_expense SET lines_version=2 WHERE id='${card.data.id}'`); }
      finally { s.f.sql.exec('ROLLBACK'); }
    }, /expense_correction_reason_required/, 'direct SQL cannot bypass the correction reason');
    assert.throws(() => {
      s.f.sql.exec('BEGIN');
      try {
        const old = s.f.sql.prepare('SELECT * FROM finance_expense WHERE id=?').get(card.data.id);
        s.f.sql.prepare(`INSERT INTO finance_expense_revision(id,expense_id,previous_version,previous_round_id,previous_expense_date,
          previous_counterparty_id,previous_supplier_label,previous_total_cents,previous_payment_method,previous_advanced_by_id,
          previous_lines_version,changed_by,changed_at,previous_concept,previous_status,reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(id(9873), old.id, old.version, old.round_id, old.expense_date, old.counterparty_id, old.supplier_label,
            old.total_cents, old.payment_method, old.advanced_by_id, old.lines_version, id(104), 1, old.concept,
            old.status, 'Corregir import');
        s.f.sql.exec(`INSERT INTO finance_expense_line(expense_id,lines_version,line_no,budget_line_id,amount_cents)
          VALUES('${card.data.id}',2,1,'${kitchen}',1); UPDATE finance_expense SET lines_version=2,version=version+1 WHERE id='${card.data.id}'`);
      } finally { s.f.sql.exec('ROLLBACK'); }
    }, /invalid_expense/, 'even a reason cannot permit unbalanced recognised lines');
    // Settled by card purchases, then the card is settled from the bank: still 150 €, not 300 €.
    const purchase = await s.manual(s.card, -15000, '2027-07-28', 'Compra amb targeta');
    const settle = (movementId, expenseId, amountCents, expectedVersion = 0) => s.call(104, `/api/finance/movements/${movementId}/allocations`, 'POST',
      { expectedVersion, allocations: [{ kind: 'EXPENSE_SETTLEMENT', amountCents, expenseId }] });
    const bankPayment = await s.manual(s.bank, -15000, '2027-07-28', 'Pagament pel banc');
    assert.equal((await settle(bankPayment, card.data.id, 15000)).data.error, 'invalid_expense_allocation', 'a card expense is settled from the card');
    assert.equal((await settle(purchase, card.data.id, 15000)).status, 200);
    const extraPurchase = await s.manual(s.card, -100, '2027-07-29', 'Compra extra');
    assert.equal((await settle(extraPurchase, card.data.id, 100)).data.error, 'invalid_expense_allocation', 'never settled above the total');
    economics = await s.economics();
    assert.equal(economics.expenseGrossCents, 20000, 'each recognised expense counts once');
    // Revision keeps history; a settled expense cannot shrink below what was paid; voiding needs no settlement.
    assert.equal((await s.call(104, `/api/finance/expenses/${card.data.id}`, 'PATCH', { expectedVersion: 2, totalCents: 14000,
      lines: [{ budgetLineId: kitchen, amountCents: 14000 }], reason: 'Import erroni' })).data.error, 'invalid_expense');
    const revised = await s.call(104, `/api/finance/expenses/${card.data.id}`, 'PATCH', { expectedVersion: 2, expenseDate: '2027-07-27',
      lines: [{ budgetLineId: kitchen, amountCents: 15000 }], reason: 'Data errònia' });
    assert.equal(revised.status, 200);
    const detail = (await s.call(104, `/api/finance/expenses/${card.data.id}`)).data;
    assert.equal(detail.revisions.length, 1); assert.equal(detail.lines.length, 1); assert.equal(detail.expense.settlementState, 'SETTLED');
    assert.equal(s.f.sql.prepare('SELECT count(*) AS n FROM finance_expense_line WHERE expense_id=?').get(card.data.id).n, 3, 'old lines kept');
    assert.equal((await s.call(104, `/api/finance/expenses/${card.data.id}/void`, 'POST', { expectedVersion: 3, reason: 'ERROR' })).data.error, 'invalid_expense');
    assert.equal((await s.call(104, `/api/finance/expenses/${advanced.data.id}/void`, 'POST', { expectedVersion: 2, reason: 'Despesa duplicada' })).status,
      200, 'unpaid approved debt is cancelled together with the expense');
    assert.equal((await s.economics()).expenseGrossCents, 15000);
    // The scouter's user link cannot be reassigned silently while used: audited link changes.
    assert.equal((await s.call(104, `/api/finance/counterparties/${scout}`, 'PATCH', { userId: null, expectedVersion: 1 })).data.error,
      'counterparty_in_use');
    assert.equal(s.audits('COUNTERPARTY_USER_UNLINKED').length, 0);
    assert.doesNotMatch(JSON.stringify(s.f.sql.prepare('SELECT * FROM audit_event').all()), /fictici|Scouter|Supermercat/);
  } finally { s.f.close(); }
});

test('budget: per-round tree of 3+ levels, no cycles, approval freezes initial, revisions change current, lines never deleted', async () => {
  const s = await setup();
  try {
    const lines = await catalogue(s);
    const budget = (await s.call(104, `/api/finance/rounds/${s.round}/budget`, 'POST')).data.id;
    assert.equal((await s.call(104, `/api/finance/rounds/${s.round}/budget`, 'POST')).data.error, 'budget_exists');
    const tree = async () => Object.fromEntries((await s.call(104, `/api/finance/rounds/${s.round}/budget`)).data.lines.map(row => [row.id, row]));
    let rows = await tree();
    assert.deepEqual([rows[lines.camps].initialCents, rows[lines.summer].initialCents, rows[lines.kitchen].initialCents], [1700000, 1700000, 1100000],
      'headings sum their subtree');
    // No cycles: a heading never moves; a line is not its own parent; the nature of the parent rules.
    const version = id => rows[id].version;
    assert.equal((await s.call(104, `/api/finance/budget-lines/${lines.summer}`, 'PATCH', { parentId: lines.kitchen, expectedVersion: version(lines.summer) })).data.error,
      'invalid_budget_line');
    assert.equal((await s.call(104, `/api/finance/budget-lines/${lines.kitchen}`, 'PATCH', { parentId: lines.kitchen, expectedVersion: version(lines.kitchen) })).data.error,
      'invalid_budget_line');
    assert.equal((await s.call(104, '/api/finance/budget-lines', 'POST', { roundId: s.round, code: '2.9', name: 'Ingrés sota despesa', nature: 'INCOME',
      parentId: lines.camps })).data.error, 'invalid_budget_line');
    assert.equal((await s.call(104, '/api/finance/budget-lines', 'POST', { roundId: s.round, code: '2.3.5.1', name: 'Sota una partida amb import',
      nature: 'EXPENSE', parentId: lines.kitchen })).data.error, 'invalid_budget_line', 'amounts live on leaves');
    assert.equal((await s.call(104, '/api/finance/budget-lines', 'POST', { roundId: s.round, code: '2.3', name: 'Codi repetit', nature: 'EXPENSE' })).data.error,
      'duplicate_budget_code');
    // A leaf can move to another heading before money flows.
    const material = await s.line({ code: '4', name: 'Material de grup', nature: 'EXPENSE' });
    assert.equal((await s.call(104, `/api/finance/budget-lines/${lines.transport}`, 'PATCH', { parentId: material, code: '4.1',
      expectedVersion: version(lines.transport) })).status, 200);
    // Tresoreria proposes; Coordinació general approves (Tresoreria cannot).
    assert.equal((await s.call(104, `/api/finance/budgets/${budget}/propose`, 'POST', { expectedVersion: 1 })).status, 200);
    assert.equal((await s.call(104, `/api/finance/budgets/${budget}/approve`, 'POST', { expectedVersion: 2 })).status, 403);
    assert.equal((await s.call(101, `/api/finance/budgets/${budget}/approve`, 'POST', { expectedVersion: 2, externalApprovalDate: '2026-10-15',
      externalApprovalReference: 'Assemblea (fictícia)' })).status, 200);
    rows = await tree();
    assert.equal((await s.call(104, `/api/finance/budget-lines/${lines.kitchen}`, 'PATCH', { plannedCents: 1, expectedVersion: version(lines.kitchen) })).data.error,
      'invalid_budget_line', 'the initial budget is frozen');
    const revision = await s.call(104, '/api/finance/budget-revisions', 'POST', { budgetId: budget, lineId: lines.kitchen, deltaCents: 50000 });
    assert.equal(revision.status, 201);
    assert.equal((await s.call(104, `/api/finance/budget-revisions/${revision.data.id}/decision`, 'POST', { decision: 'APPROVE', expectedVersion: 1 })).status, 403);
    assert.equal((await s.call(101, `/api/finance/budget-revisions/${revision.data.id}/decision`, 'POST', { decision: 'APPROVE', expectedVersion: 1 })).status, 200);
    const negative = await s.call(104, '/api/finance/budget-revisions', 'POST', { budgetId: budget, lineId: lines.kitchen, deltaCents: -2000000 });
    assert.equal((await s.call(101, `/api/finance/budget-revisions/${negative.data.id}/decision`, 'POST', { decision: 'APPROVE', expectedVersion: 1 })).data.error,
      'invalid_budget_revision', 'a current amount never goes negative');
    rows = await tree();
    assert.deepEqual([rows[lines.kitchen].initialCents, rows[lines.kitchen].currentCents], [1100000, 1150000]);
    assert.deepEqual([rows[lines.camps].initialCents, rows[lines.camps].currentCents], [1100000, 1150000], 'parent totals derive from leaves');
    // A new leaf after approval starts at 0 and is funded by revisions; overspending is never blocked here.
    const late = await s.line({ code: '2.3.9', name: 'Partida nova', nature: 'EXPENSE', parentId: lines.summer });
    assert.equal((await s.call(104, '/api/finance/budget-revisions', 'POST', { budgetId: budget, lineId: late, deltaCents: 10000 })).status, 201);
    // Deactivate (never delete); a heading with active children stays active; a used line never becomes a heading.
    assert.equal((await s.call(104, `/api/finance/budget-lines/${lines.summer}`, 'PATCH', { status: 'INACTIVE', expectedVersion: rows[lines.summer].version })).data.error,
      'invalid_budget_line');
    assert.equal((await s.call(104, `/api/finance/budget-lines/${lines.transport}`, 'PATCH', { status: 'INACTIVE', expectedVersion: rows[lines.transport].version })).status, 200);
    assert.throws(() => s.f.sql.exec(`DELETE FROM finance_budget_line WHERE id='${lines.transport}'`), /budget_line_in_use/);
    assert.equal((await s.call(104, '/api/finance/budget-lines', 'POST', { roundId: s.round, code: '2.3.5.1', name: 'Sota partida usada', nature: 'EXPENSE',
      parentId: lines.kitchen })).data.error, 'budget_line_in_use');
    assert.equal(s.f.sql.prepare('SELECT count(*) AS n FROM finance_budget_line_revision').get().n, 2, 'every accepted line change keeps the previous version');
    for (const action of ['BUDGET_CREATED', 'BUDGET_PROPOSED', 'BUDGET_APPROVED', 'BUDGET_REVISION_PROPOSED', 'BUDGET_REVISION_APPROVED', 'BUDGET_LINE_DEACTIVATED'])
      assert.ok(s.audits(action).length >= 1, action);
    // Permissions: section coordination cannot read; nobody without propose can create lines.
    assert.equal((await s.call(102, `/api/finance/rounds/${s.round}/budget`)).status, 403);
    assert.equal((await s.call(107, '/api/finance/budget-lines', 'POST', { roundId: s.round, code: '9', name: 'x', nature: 'EXPENSE' })).status, 403);
  } finally { s.f.close(); }
});

test('G.4: current budget warns about a real overrun and supplier refund reduces actual once', async () => {
  const s = await setup();
  try {
    const category = await s.line({ code: '9', name: 'Material', nature: 'EXPENSE' });
    const leaf = await s.line({ code: '9.1', name: 'Material de prova', nature: 'EXPENSE', parentId: category,
      plannedCents: 50000 });
    const budget = (await s.call(104, `/api/finance/rounds/${s.round}/budget`, 'POST')).data.id;
    assert.equal((await s.call(104, `/api/finance/budgets/${budget}/propose`, 'POST', { expectedVersion: 1 })).status, 200);
    assert.equal((await s.call(101, `/api/finance/budgets/${budget}/approve`, 'POST', { expectedVersion: 2 })).status, 200);
    const created = await s.call(104, '/api/finance/expenses', 'POST', { roundId: s.round,
      expenseDate: '2027-03-01', totalCents: 54000, paymentMethod: 'BANK',
      lines: [{ budgetLineId: leaf, amountCents: 54000 }] });
    assert.equal(created.status, 201);
    const expenseId = created.data.id;
    assert.equal((await s.call(104, `/api/finance/expenses/${expenseId}/evidence`, 'POST', evidence)).status, 201);
    assert.equal((await s.call(104, `/api/finance/expenses/${expenseId}/recognise`, 'POST',
      { expectedVersion: 1 })).status, 200);
    const budgetLine = async () => (await s.call(104, `/api/finance/rounds/${s.round}/budget`)).data.lines
      .find(row => row.id === leaf);
    assert.deepEqual([ (await budgetLine()).initialCents, (await budgetLine()).currentCents,
      (await budgetLine()).actualCents, (await budgetLine()).overrunCents ], [50000, 50000, 54000, 4000]);
    const refund = await s.manual(s.bank, 4000);
    assert.equal((await s.call(104, `/api/finance/movements/${refund}/allocations`, 'POST', { expectedVersion: 0,
      allocations: [{ kind: 'EXPENSE_REFUND', amountCents: 4000, expenseId }] })).status, 200);
    assert.deepEqual([(await budgetLine()).actualCents, (await budgetLine()).overrunCents], [50000, 0]);
    assert.equal((await s.call(104, `/api/finance/rounds/${s.round}`)).data.economics.expenseNetCents, 50000);
  } finally { s.f.close(); }
});

test('G.3: one bank receipt splits across a verified fee and activity without double counting', async () => {
  const s = await setup();
  try {
    s.f.sql.exec(buildDemoData().sql);
    s.f.sql.prepare(`UPDATE activity_registration SET finance_round_id=? WHERE finance_round_id IS NULL
      AND expected_amount_cents>0 AND activity_id IN (SELECT id FROM activity
        WHERE date(starts_at/1000,'unixepoch') BETWEEN '2026-10-01' AND '2027-09-30')`).run(s.round);
    const fee = s.f.sql.prepare(`SELECT p.id,sum(a.amount_cents) AS cents FROM annual_fee_payment p
      JOIN annual_fee_allocation a ON a.payment_id=p.id WHERE p.review_status='VERIFIED'
      GROUP BY p.id ORDER BY p.id LIMIT 1`).get();
    const activity = s.f.sql.prepare(`SELECT pa.id,pa.amount_cents AS cents FROM activity_payment_allocation pa
      JOIN activity_registration ar ON ar.id=pa.registration_id
      LEFT JOIN payment_evidence e ON e.id=pa.evidence_id
      WHERE ar.finance_round_id=? AND (pa.evidence_id IS NULL OR e.review_status='VERIFIED')
      ORDER BY pa.id LIMIT 1`).get(s.round);
    assert.ok(fee?.cents > 0 && activity?.cents > 0);
    const movement = await s.manual(s.bank, fee.cents + activity.cents);
    const candidates = await s.call(104, `/api/finance/movements/${movement}/receipt-candidates`);
    assert.equal(candidates.status, 200, JSON.stringify(candidates.data));
    assert.equal(candidates.data.suggestionOnly, true);
    assert.ok(candidates.data.fees.some(row => row.id === fee.id));
    assert.ok(candidates.data.activities.some(row => row.id === activity.id));
    assert.equal((await s.call(105, `/api/finance/movements/${movement}/receipt-candidates`)).status, 403);
    assert.equal((await s.call(104, `/api/finance/movements/${movement}/allocations`, 'POST', {
      expectedVersion: 0, allocations: [
        { kind: 'FEE_PAYMENT', feePaymentId: fee.id, amountCents: fee.cents },
        { kind: 'ACTIVITY_PAYMENT', activityAllocationId: activity.id, amountCents: activity.cents }
      ] })).status, 200);
    assert.equal((await s.call(104, `/api/finance/rounds/${s.round}`)).data.economics.incomeCents,
      fee.cents + activity.cents);
    assert.equal(s.f.sql.prepare('SELECT count(*) AS n FROM finance_income').get().n, 0);
    const duplicate = await s.manual(s.bank, 100);
    assert.equal((await s.call(104, `/api/finance/movements/${duplicate}/allocations`, 'POST', {
      expectedVersion: 0, allocations: [{ kind: 'FEE_PAYMENT', feePaymentId: fee.id, amountCents: 100 }]
    })).data.error, 'invalid_fee_receipt');
    assert.equal((await s.call(104, `/api/finance/movements/${duplicate}/allocations`, 'POST', {
      expectedVersion: 0, allocations: [{ kind: 'ACTIVITY_PAYMENT', activityAllocationId: activity.id, amountCents: 100 }]
    })).data.error, 'invalid_activity_receipt');
    assert.throws(() => s.f.sql.prepare(`UPDATE annual_fee_payment SET review_status='ISSUE' WHERE id=?`).run(fee.id),
      /reconciled_fee_payment_locked/);
    assert.throws(() => s.f.sql.prepare(`DELETE FROM annual_fee_allocation WHERE payment_id=?`).run(fee.id),
      /reconciled_fee_payment_locked/);
  } finally { s.f.close(); }
});

test('G.3: submitted activity fixes the third sibling price from the round family, not attendees', async () => {
  const s = await setup();
  try {
    const group = crypto.randomUUID(), activity = crypto.randomUUID();
    s.f.sql.prepare(`INSERT INTO annual_fee_family_group(id,round_id,reference,created_by,created_at)
      VALUES(?,?,?,?,?)`).run(group, id(901), 'G3-SIBLING-FAMILY', id(104), 1);
    for (const [ordinal, participant] of [501, 502, 503].entries()) s.f.sql.prepare(`INSERT INTO annual_fee_family_member
      (group_id,round_id,participant_id,sibling_ordinal,assigned_by,assigned_at) VALUES(?,?,?,?,?,?)`)
      .run(group, id(901), id(participant), ordinal + 1, id(104), 1);
    s.f.sql.prepare(`INSERT INTO activity(id,public_code,name,status,audience,location,starts_at,ends_at,
      registration_deadline,price_cents,created_by,created_at,updated_at)
      VALUES(?,?,?,'PUBLISHED','GENERAL',?,?,?,?,?,?,?,?)`)
      .run(activity, 'G3-SIBLING-PAID', 'Campament de prova (fictici)', 'Lloc fictici',
        Date.parse('2027-06-01'), Date.parse('2027-06-05'), Date.parse('2027-05-01'), 18000, id(104), 1, 1);
    const proof = { filename: 'justificant-synthetic.pdf', mime: 'application/pdf',
      dataBase64: Buffer.from('%PDF-1.4\n%synthetic local fixture\n%%EOF').toString('base64') };
    assert.deepEqual(await submitRegistration(s.f.db, s.f.storage, {
      publicCode: 'G3-SIBLING-PAID', participantName: 'Participante Tropa B (ficticio)', birthDate: '2012-11-03',
      submittedByName: 'Tutor de prova (fictici)', sectionCode: 'TROPA', receiptEmail: 'g3-sibling@example.test',
      idempotencyKey: crypto.randomUUID().replaceAll('-', ''), participationTermsVersion: 'DEMO-3A-PARTICIPATION-V1',
      privacyNoticeVersion: 'DEMO-3A-PRIVACY-NOTICE-V1', evidence: proof
    }, crypto.randomUUID(), Date.parse('2027-04-01')), { ok: true });
    const row = s.f.sql.prepare(`SELECT expected_amount_cents,price_base_cents,price_discount_cents,
      price_sibling_ordinal,price_family_group_id FROM activity_registration WHERE activity_id=?`).get(activity);
    assert.deepEqual({ ...row }, { expected_amount_cents: 9000, price_base_cents: 18000,
      price_discount_cents: 9000, price_sibling_ordinal: 3, price_family_group_id: group });
    assert.throws(() => s.f.sql.prepare(`UPDATE activity_registration SET expected_amount_cents=18000 WHERE activity_id=?`)
      .run(activity), /activity_price_correction_required/);
  } finally { s.f.close(); }
});

test('G.4: late fee receipt stays in its closed round without changing the official close', async () => {
  const s = await setup();
  try {
    s.f.sql.exec(buildDemoData().sql);
    const fee = s.f.sql.prepare(`SELECT p.id,sum(a.amount_cents) AS cents FROM annual_fee_payment p
      JOIN annual_fee_allocation a ON a.payment_id=p.id WHERE p.review_status='VERIFIED'
      GROUP BY p.id HAVING cents>=2 ORDER BY p.id LIMIT 1`).get();
    assert.ok(fee);
    const firstCents = Math.floor(fee.cents / 2), lateCents = fee.cents - firstCents;
    const first = await s.manual(s.bank, firstCents);
    assert.equal((await s.call(104, `/api/finance/movements/${first}/allocations`, 'POST', {
      expectedVersion: 0, allocations: [{ kind: 'FEE_PAYMENT', feePaymentId: fee.id, amountCents: firstCents }]
    })).status, 200);
    assert.equal((await s.call(104, `/api/finance/rounds/${s.round}/closing`, 'POST', { expectedVersion: 2 })).status, 200);
    assert.equal((await s.call(104, `/api/finance/rounds/${s.round}/close`, 'POST', { expectedVersion: 3 })).status, 200);
    const official = (await s.call(104, `/api/finance/rounds/${s.round}`)).data.officialClose;
    assert.equal(official.incomeCents, firstCents);
    const late = await s.manual(s.bank, lateCents, '2027-11-02');
    assert.equal((await s.call(104, `/api/finance/movements/${late}/allocations`, 'POST', {
      expectedVersion: 0, allocations: [{ kind: 'FEE_PAYMENT', feePaymentId: fee.id, amountCents: lateCents }]
    })).status, 200);
    let detail = (await s.call(104, `/api/finance/rounds/${s.round}`)).data;
    assert.equal(detail.officialClose.incomeCents, firstCents);
    assert.equal(detail.economics.incomeCents, fee.cents);
    assert.equal(detail.postClose.resultDeltaCents, lateCents);
    assert.deepEqual(detail.postClose.adjustments.map(row => row.amountCents), [lateCents]);
    assert.equal((await s.call(104, `/api/finance/movements/${late}/allocations`, 'POST', {
      expectedVersion: 1, allocations: [], reason: 'Transferència assignada erròniament'
    })).status, 200);
    detail = (await s.call(104, `/api/finance/rounds/${s.round}`)).data;
    assert.equal(detail.officialClose.incomeCents, firstCents);
    assert.equal(detail.postClose.resultDeltaCents, 0);
    assert.deepEqual(detail.postClose.adjustments.map(row => row.amountCents).sort((a, b) => a - b), [-lateCents, lateCents]);
  } finally { s.f.close(); }
});

test('financial delegation reaches the new capabilities explicitly and group-wide only', async () => {
  const s = await setup();
  try {
    const delegate = 140;
    s.f.sql.exec(`INSERT INTO app_user(id,display_name,status,created_at,updated_at) VALUES('${id(delegate)}','Suport de tresoreria (fictici)','ACTIVE',1,1)`);
    await s.f.login(delegate);
    assert.equal((await s.call(delegate, '/api/finance/movements')).status, 403);
    const grant = sectionId => s.call(107, '/api/delegations', 'POST', { userId: id(delegate), permissionCode: 'finance.movement.read', sectionId,
      authorizedBy: id(101), authorizationReference: 'DEMO-FIN-MOVEMENTS', expiresAt: Date.now() + 86400000 });
    assert.equal((await grant(id(2))).status, 400, 'a group-wide capability is never section-scoped');
    const created = await grant(null);
    assert.equal(created.status, 201);
    await s.call(101, `/api/delegations/${created.data.id}/confirm`, 'POST', {});
    assert.equal((await s.call(101, `/api/delegations/${created.data.id}/ratify`, 'POST', { ratificationReference: 'DEMO-FIN-MOVEMENTS-R' })).status, 200);
    assert.equal((await s.call(delegate, '/api/finance/movements')).status, 200);
    assert.equal((await s.call(delegate, '/api/finance/movements', 'POST', { positionId: s.bank, operationDate: '2026-11-02', amountCents: 1, label: 'x' })).status, 403,
      'reading is not classifying');
    assert.equal((await s.call(delegate, `/api/finance/rounds/${s.round}/budget`)).status, 403);
    for (const code of ['finance.round.manage', 'finance.position.manage', 'finance.budget.approve', 'finance.bank_description.reveal']) {
      const response = await s.call(107, '/api/delegations', 'POST', { userId: id(delegate), permissionCode: code, authorizedBy: id(101),
        authorizationReference: 'DEMO-FIN-NOT-DELEG', expiresAt: Date.now() + 86400000 });
      assert.equal(response.status, 400, `${code} is not delegable`);
    }
  } finally { s.f.close(); }
});

test('migration 0027 grants the ordinary finance work to current treasury and coordination holders, never the reveal', () => {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  const files = readdirSync(migrations).filter(name => name.endsWith('.sql')).sort();
  for (const name of files.filter(name => name < '0027')) sql.exec(readFileSync(join(migrations, name), 'utf8'));
  sql.exec(readFileSync(join(root, 'gestio/seed.sql'), 'utf8'));
  assert.equal(sql.prepare("SELECT count(*) AS n FROM user_permission_grant WHERE permission_code='finance.treasury.read'").get().n, 0);
  sql.exec(readFileSync(join(migrations, files.find(name => name.startsWith('0027'))), 'utf8'));
  const grants = user => sql.prepare('SELECT permission_code FROM user_permission_grant WHERE user_id=? AND permission_code LIKE ? AND revoked_at IS NULL ORDER BY 1')
    .all(id(user), 'finance.%').map(row => row.permission_code).filter(code => !code.startsWith('finance.fee') && code !== 'finance.payment.verify');
  assert.deepEqual(grants(104), ['finance.budget.propose', 'finance.budget.read', 'finance.expense.manage', 'finance.expense.read', 'finance.movement.classify',
    'finance.movement.import', 'finance.movement.read', 'finance.position.manage', 'finance.round.manage', 'finance.treasury.read']);
  assert.deepEqual(grants(101), ['finance.budget.approve', 'finance.budget.propose', 'finance.budget.read', 'finance.expense.manage', 'finance.expense.read',
    'finance.movement.classify', 'finance.movement.read', 'finance.position.manage', 'finance.round.manage', 'finance.treasury.read']);
  for (const user of [102, 103, 105, 106, 107]) assert.deepEqual(grants(user), [], `user ${user}`);
  sql.close();
});

test('synthetic treasury demo applies with the real triggers and reproduces the approved scenarios', () => {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  for (const name of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) sql.exec(readFileSync(join(migrations, name), 'utf8'));
  sql.exec(readFileSync(join(root, 'gestio/seed.sql'), 'utf8'));
  sql.exec(buildDemoData().sql);
  sql.exec(buildTreasuryDemo());
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), []);
  const economics = { ...sql.prepare('SELECT income_cents,expense_gross_cents,proposed_expense_cents FROM finance_round_economics').get() };
  assert.deepEqual(economics, { income_cents: 10000, expense_gross_cents: 46000, proposed_expense_cents: 2500 },
    'the cash cycle counts nothing; cash and card expenses once; the scouter proposal not at all');
  assert.equal(sql.prepare('SELECT count(*) AS n FROM finance_movement_allocation_balance WHERE unallocated_cents!=0').get().n, 0);
  const kitchen = sql.prepare("SELECT initial_cents,current_cents FROM finance_budget_line_amount a JOIN finance_budget_line l ON l.id=a.line_id WHERE l.name='Cuina'").get();
  assert.deepEqual({ ...kitchen }, { initial_cents: 1100000, current_cents: 1150000 });
  assert.equal(sql.prepare("SELECT max(depth) AS d FROM (WITH RECURSIVE t(id,depth) AS (SELECT id,1 FROM finance_budget_line WHERE parent_id IS NULL UNION ALL SELECT l.id,t.depth+1 FROM finance_budget_line l JOIN t ON l.parent_id=t.id) SELECT depth FROM t)").get().d, 3);
  sql.close();
});

test('delegation scope follows each permission: section-scoped finance stays per section, foundation stays group-only, neither widens the other', async () => {
  const s = await setup();
  try {
    const delegate = 141;
    s.f.sql.exec(`INSERT INTO app_user(id,display_name,status,created_at,updated_at) VALUES('${id(delegate)}','Suport mixt (fictici)','ACTIVE',1,1)`);
    await s.f.login(delegate);
    const grant = async (permissionCode, sectionId) => {
      const created = await s.call(107, '/api/delegations', 'POST', { userId: id(delegate), permissionCode, sectionId, authorizedBy: id(101),
        authorizationReference: `DEMO-SCOPE-${permissionCode.replaceAll('.', '-').toUpperCase().slice(0, 30)}`, expiresAt: Date.now() + 86400000 });
      if (created.status !== 201) return created;
      await s.call(101, `/api/delegations/${created.data.id}/confirm`, 'POST', {});
      assert.equal((await s.call(101, `/api/delegations/${created.data.id}/ratify`, 'POST', { ratificationReference: 'DEMO-SCOPE-RATIFIED' })).status, 200);
      return created;
    };
    const { authorize } = await import('../gestio/src/policy.js');
    const can = async (permission, details) => (await authorize(s.f.db, s.f.context[delegate], { permission, ...details })).allow;
    // A. An existing section-scoped financial capability is still delegated per section (G.1A unchanged).
    assert.equal((await grant('finance.payment.verify', id(2))).status, 201);
    assert.equal(await can('finance.payment.verify', { sectionId: id(2) }), true);
    assert.equal(await can('finance.payment.verify', { sectionId: id(3) }), false);
    assert.equal(await can('finance.payment.verify', { mode: 'all-sections' }), false);
    // B. A foundation capability is group-only: a section scope is refused, the group scope works.
    assert.equal((await grant('finance.movement.read', id(2))).status, 400);
    assert.equal((await grant('finance.movement.read', null)).status, 201);
    assert.equal(await can('finance.movement.read', {}), true);
    // C. Neither widens the other: the group-wide foundation grant does not make verification group-wide,
    // and verification in Tropa gives no foundation capability.
    assert.equal(await can('finance.payment.verify', { sectionId: id(3) }), false);
    assert.equal(await can('finance.payment.verify', { mode: 'all-sections' }), false);
    for (const permission of ['finance.movement.classify', 'finance.treasury.read', 'finance.expense.read', 'finance.budget.read'])
      assert.equal(await can(permission, {}), false, permission);
    assert.equal(await can('finance.fee.payment.review', { sectionId: id(2) }), false);
  } finally { s.f.close(); }
});

test('economic figures never count twice: card purchase and its settlement, the cash cycle, proposals', async () => {
  const s = await setup();
  try {
    const { kitchen, transport } = await catalogue(s);
    const expense = async (paymentMethod, totalCents, lineId) => (await s.call(104, '/api/finance/expenses', 'POST', { roundId: s.round,
      expenseDate: '2027-07-20', totalCents, paymentMethod, lines: [{ budgetLineId: lineId, amountCents: totalCents }], recognise: true, evidence })).data.id;
    const settle = async (movementId, expenseId, amountCents) => assert.equal((await s.call(104, `/api/finance/movements/${movementId}/allocations`, 'POST',
      { expectedVersion: 0, allocations: [{ kind: 'EXPENSE_SETTLEMENT', amountCents, expenseId }] })).status, 200);
    const transfer = async (from, to) => assert.equal((await s.call(104, '/api/finance/internal-transfers', 'POST',
      { fromMovementId: from, toMovementId: to, fromExpectedVersion: 0, toExpectedVersion: 0 })).status, 201);
    const figures = async () => { const e = await s.economics(); return { income: e.incomeCents, expense: e.expenseNetCents, proposed: e.proposedExpenseCents }; };

    // Card: the purchase is the expense (60 €), once.
    const cardExpense = await expense('CARD', 6000, kitchen);
    const purchase = await s.manual(s.card, -6000, '2027-07-20', 'Compra amb targeta');
    await settle(purchase, cardExpense, 6000);
    assert.deepEqual(await figures(), { income: 0, expense: 6000, proposed: 0 });
    // The bank charge that settles the card is not a second expense: unclassified it counts nothing, and it can
    // never settle the card expense again (a card expense is settled from the card).
    const cardPayment = await s.manual(s.bank, -6000, '2027-08-05', 'Liquidació de la targeta');
    assert.deepEqual(await figures(), { income: 0, expense: 6000, proposed: 0 });
    assert.equal((await s.call(104, `/api/finance/movements/${cardPayment}/allocations`, 'POST', { expectedVersion: 0,
      allocations: [{ kind: 'EXPENSE_SETTLEMENT', amountCents: 6000, expenseId: cardExpense }] })).data.error, 'invalid_expense_allocation');
    assert.equal((await s.call(104, `/api/finance/movements/${cardPayment}/allocations`, 'POST', { expectedVersion: 0,
      allocations: [{ kind: 'CARD_SETTLEMENT', amountCents: 6000 }] })).data.error, 'allocation_kind_not_enabled', 'card statements arrive in 3.5G.2');
    // Once card statements exist, a CARD_SETTLEMENT allocation is outside the economic figures by construction:
    // simulate it here by lifting the 3.5G.1 kind gate in this test database only.
    s.f.sql.exec(`INSERT INTO finance_card_statement(id,position_id,period_start,period_end,created_by,created_at)
      VALUES('${id(9881)}','${s.card}','2027-07-01','2027-07-31','${id(104)}',1);
      DROP TRIGGER finance_allocation_kind_enabled;
      UPDATE finance_movement SET allocation_version=1 WHERE id='${cardPayment}';
      INSERT INTO finance_allocation(id,movement_id,set_version,kind,amount_cents,card_statement_id,created_by,created_at)
      VALUES('${id(9882)}','${cardPayment}',1,'CARD_SETTLEMENT',6000,'${id(9881)}','${id(104)}',1)`);
    assert.deepEqual(await figures(), { income: 0, expense: 6000, proposed: 0 }, 'card expense 60 €, not 120 €');

    // Cash: withdrawal and cash entry are a transfer (0), the cash payment is the expense (430 €), the surplus back is a transfer (still 430 €).
    const withdrawal = await s.manual(s.bank, -50000, '2027-07-10', 'Retirada'), cashIn = await s.manual(s.cash, 50000, '2027-07-10', 'Entrada a caixa');
    await transfer(withdrawal, cashIn);
    assert.deepEqual(await figures(), { income: 0, expense: 6000, proposed: 0 });
    const cashExpense = await expense('CASH', 43000, transport);
    const cashPayment = await s.manual(s.cash, -43000, '2027-07-12', 'Pagament en efectiu');
    await settle(cashPayment, cashExpense, 43000);
    assert.deepEqual(await figures(), { income: 0, expense: 49000, proposed: 0 });
    const surplus = await s.manual(s.cash, -7000, '2027-07-25', 'Sobrant'), bankIn = await s.manual(s.bank, 7000, '2027-07-25', 'Reingrés');
    await transfer(surplus, bankIn);
    assert.deepEqual(await figures(), { income: 0, expense: 49000, proposed: 0 }, 'cash expense 430 €; transfers count nothing');
    const cash = (await s.call(104, '/api/finance/positions')).data.positions.find(row => row.id === s.cash).balance;
    assert.equal(cash.balanceCents, 0, 'cash back to zero once the surplus is re-deposited');

    // A proposal never counts; recognising it counts once; settling it never counts it again.
    const proposed = (await s.call(104, '/api/finance/expenses', 'POST', { roundId: s.round, expenseDate: '2027-07-26', totalCents: 2000,
      paymentMethod: 'BANK', lines: [{ budgetLineId: kitchen, amountCents: 2000 }] })).data.id;
    assert.deepEqual(await figures(), { income: 0, expense: 49000, proposed: 2000 });
    assert.equal((await s.call(104, `/api/finance/expenses/${proposed}/evidence`, 'POST', evidence)).status, 201);
    assert.equal((await s.call(104, `/api/finance/expenses/${proposed}/recognise`, 'POST', { expectedVersion: 1 })).status, 200);
    assert.deepEqual(await figures(), { income: 0, expense: 51000, proposed: 0 });
    await settle(await s.manual(s.bank, -2000, '2027-07-27', 'Transferència al proveïdor'), proposed, 2000);
    assert.deepEqual(await figures(), { income: 0, expense: 51000, proposed: 0 });
  } finally { s.f.close(); }
});
