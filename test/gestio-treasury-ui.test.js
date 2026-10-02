// FASE 3.5G.2A — Tresoreria UI: the pure model (money, labels, filters, error copy, split, tree,
// classification choices) and the wiring of each action to its endpoint. The server enforces every rule.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as model from '../gestio/public/views/treasury/model.js';
import { PAGES } from '../gestio/public/router.js';

const root = join(import.meta.dirname, '..');
const source = file => readFileSync(join(root, 'gestio/public', file), 'utf8');
const caps = treasury => ({ treasury: { read: false, readMovements: false, classifyMovements: false, revealDescriptions: false, readExpenses: false, manageExpenses: false, ...treasury } });
const UUID = '00000000-0000-4000-8000-000000000123';

test('money and dates: EUR with grouping and sign, calendar days, no technical codes in labels', () => {
  assert.equal(model.formatEur(125000, { signed: true }), '+1.250,00 €');
  assert.equal(model.formatEur(-125000, { signed: true }), '−1.250,00 €');
  assert.equal(model.formatEur(500), '5,00 €');
  assert.equal(model.formatEur(-8550), '−85,50 €');
  assert.equal(model.centsInput(8550), '85,50');
  assert.equal(model.parseEuros('85,5'), 8550);
  assert.match(model.formatDay('2026-10-03'), /^3 .*2026$/);
  assert.equal(model.formatDay('nope'), '');
  for (const code of ['PENDING', 'PARTIAL', 'CLASSIFIED', 'POSSIBLE_DUPLICATE', 'VOID_DUPLICATE']) assert.doesNotMatch(model.movementStatus(code).label, /[A-Z_]{3,}/);
  assert.deepEqual(['PENDING', 'PARTIAL', 'CLASSIFIED', 'POSSIBLE_DUPLICATE', 'VOID_DUPLICATE'].map(code => model.movementStatus(code).label),
    ['Pendent de classificar', 'Parcialment imputat', 'Classificat', 'Possible duplicat', 'Anul·lat com a duplicat']);
  assert.equal(model.expenseStatus('PROPOSED').label, 'Proposta');
  assert.equal(model.expenseStatus('RECOGNISED').label, 'Reconeguda');
});

test('tabs and actions follow the advisory capabilities; no finance capability means no Tresoreria', () => {
  assert.equal(model.treasuryAvailable(caps({})), false);
  assert.equal(model.treasuryAvailable({}), false);
  assert.deepEqual(model.availableTabs(caps({ read: true, readMovements: true, readExpenses: true })).map(t => t.id), ['inici', 'moviments', 'despeses']);
  assert.deepEqual(model.availableTabs(caps({ readMovements: true })).map(t => t.id), ['inici', 'moviments'], 'a movement-only delegation sees no expenses');
  assert.equal(model.canReveal(caps({ read: true, readMovements: true })), false);
  assert.equal(model.canReveal(caps({ revealDescriptions: true })), true);
});

test('classification offers only the enabled kinds, by direction and permission', () => {
  const full = caps({ classifyMovements: true, manageExpenses: true, readIncomes: true, manageIncomes: true });
  const out = { state: 'ACTIVE', amountCents: -3000 }, inn = { state: 'ACTIVE', amountCents: 3000 };
  assert.deepEqual(model.classificationOptions(out, full).map(o => o.id), ['NEW_EXPENSE', 'EXPENSE_SETTLEMENT', 'INTERNAL_TRANSFER']);
  assert.deepEqual(model.classificationOptions(inn, full).map(o => o.id), ['NEW_INCOME', 'LINK_INCOME', 'EXPENSE_REFUND', 'INTERNAL_TRANSFER']);
  assert.deepEqual(model.classificationOptions(inn, caps({ classifyMovements: true })).map(o => o.id), ['EXPENSE_REFUND', 'INTERNAL_TRANSFER'], 'no income choices without income capabilities');
  const refund = model.classificationOptions(inn, full).find(o => o.id === 'EXPENSE_REFUND');
  assert.match(refund.label, /despesa \(proveïdor\)/); assert.match(refund.hint, /No és un ingrés/); assert.doesNotMatch(refund.label + refund.hint, /famíl/i, 'supplier refund, never a family refund');
  assert.equal(model.allocationLabel({ kind: 'EXPENSE_REFUND', expense: { concept: 'Bus' } }), 'Devolució de despesa · Bus');
  assert.deepEqual(model.classificationOptions(out, caps({ classifyMovements: true })).map(o => o.id), ['EXPENSE_SETTLEMENT', 'INTERNAL_TRANSFER'], 'no expense creation without expense.manage');
  assert.deepEqual(model.classificationOptions(out, caps({ readMovements: true })), []);
  assert.deepEqual(model.classificationOptions({ ...out, state: 'VOID_DUPLICATE' }, full), []);
  const offered = [...model.classificationOptions(out, full), ...model.classificationOptions(inn, full)].map(o => o.id).join();
  for (const disabled of ['FEE_PAYMENT', 'ACTIVITY_PAYMENT', 'FAMILY_', 'CARD_SETTLEMENT', 'REIMBURSEMENT']) assert.ok(!offered.includes(disabled), disabled);
});

test('filters: URL values validated, mapped to API parameters, unknown values dropped', () => {
  const filters = model.parseMovementFilters({ estat: 'pendents', posicio: UUID, des: '2026-10-01', fins: 'bad', sentit: 'eixides', q: '  ref ', extra: 'x' });
  assert.deepEqual(filters, { estat: 'pendents', posicio: UUID, des: '2026-10-01', fins: '', sentit: 'eixides', q: 'ref' });
  assert.equal(model.movementApiQuery(filters), `status=pending&positionId=${UUID}&from=2026-10-01&direction=out&q=ref`);
  assert.equal(model.parseMovementFilters({ estat: 'hack' }).estat, '');
  assert.deepEqual(model.movementFiltersToQuery(model.parseMovementFilters({})), {});
  const expense = model.parseExpenseFilters({ estat: 'propostes', linia: UUID, tercer: 'nope' });
  assert.equal(model.expenseApiQuery('r', expense), `roundId=r&status=PROPOSED&budgetLineId=${UUID}`);
});

test('error copy: the agreed human messages; codes never reach the screen', () => {
  assert.equal(model.errorCopy({ code: 'allocation_exceeds_movement' }), 'L’import assignat supera l’import disponible del moviment.');
  assert.equal(model.errorCopy({ code: 'stale_movement' }), 'Aquesta informació ha canviat. Torna a carregar-la.');
  assert.equal(model.errorCopy({ code: 'stale_expense' }), 'Aquesta informació ha canviat. Torna a carregar-la.');
  assert.equal(model.errorCopy({ status: 403, code: 'forbidden' }), 'No tens permís per fer aquesta acció.');
  assert.equal(model.errorCopy({ status: 403 }), 'No tens permís per fer aquesta acció.');
  assert.equal(model.errorCopy({ status: 403, code: 'self_approval' }), 'No pots aprovar una despesa avançada per tu mateix.');
  assert.equal(model.errorCopy({ status: 409, code: 'weird_code' }), 'No s’ha pogut completar l’acció. Torna-ho a provar.');
  for (const code of ['invalid_expense_line', 'expense_lines_total_mismatch', 'invalid_allocation_direction', 'allocation_kind_not_enabled',
    'invalid_internal_transfer', 'invalid_expense_allocation', 'movement_voided', 'invalid_duplicate_void', 'invalid_counterparty'])
    assert.doesNotMatch(model.errorCopy({ code }), /_|[A-Z]{4,}/, code);
});

test('line split: Total / Distribuït / Pendent; confirmation only when it balances', () => {
  const a = { budgetLineId: 'l1', amount: '200' }, b = { budgetLineId: 'l2', amount: '160' };
  assert.deepEqual(model.splitState(36000, [a, b]), { total: 36000, distributed: 36000, pending: 0, invalid: false, balanced: true });
  assert.equal(model.splitState(36000, [a]).pending, 16000);
  assert.equal(model.splitState(36000, [a, { budgetLineId: 'l2', amount: '200' }]).pending, -4000);
  assert.equal(model.splitState(36000, [{ budgetLineId: null, amount: '360' }]).balanced, false, 'every line needs a budget line');
  const base = { concept: ' Autobús ', expenseDate: '2026-10-26', total: '360', lines: [a, b] };
  const ok = model.validateExpense(base, { roundId: 'r' });
  assert.equal(ok.valid, true);
  assert.deepEqual(ok.body, { roundId: 'r', expenseDate: '2026-10-26', concept: 'Autobús', lines: [{ budgetLineId: 'l1', amountCents: 20000 }, { budgetLineId: 'l2', amountCents: 16000 }] });
  assert.equal(model.validateExpense({ ...base, lines: [a] }, { roundId: 'r' }).errors.lines, 'Falten 160,00 € per repartir.');
  assert.match(model.validateExpense({ ...base, total: '300' }, { roundId: 'r' }).errors.lines, /de més/);
  const manual = model.validateExpense({ ...base, paymentMethod: 'ADVANCED' }, { roundId: 'r', manual: true });
  assert.equal(manual.errors.advancedById, 'Tria qui ha avançat els diners.');
  const card = model.validateExpense({ ...base, paymentMethod: 'CARD', counterpartyId: 'c' }, { roundId: 'r', manual: true });
  assert.deepEqual([card.body.totalCents, card.body.paymentMethod, card.body.counterpartyId], [36000, 'CARD', 'c']);
});

test('budget tree: hierarchy with paths; headings are not assignable; search keeps the ancestors', () => {
  const lines = [{ id: 'a', code: '2', name: 'Campaments', parentId: null, assignable: false }, { id: 'b', code: '2.3', name: 'Estiu', parentId: 'a', assignable: false },
    { id: 'c', code: '2.3.1', name: 'Autobús', parentId: 'b', assignable: true }, { id: 'd', code: '3', name: 'Oficina', parentId: null, assignable: true }];
  const tree = model.budgetTree(lines);
  assert.deepEqual(tree.map(n => [n.code, n.depth]), [['2', 0], ['2.3', 1], ['2.3.1', 2], ['3', 0]]);
  assert.deepEqual(tree[2].path, ['Campaments', 'Estiu', 'Autobús']);
  assert.deepEqual(model.filterTree(tree, 'autobus').map(n => n.code), ['2', '2.3', '2.3.1'], 'accent-insensitive, ancestors shown');
  assert.equal(model.budgetPath({ path: ['Campaments', 'Estiu', 'Autobús'] }), 'Campaments › Estiu › Autobús');
});

test('allocation sets: keep the current parts, add one validated part; settleable expenses match the position', () => {
  const current = [{ id: 'x', kind: 'INCOME', amountCents: 12000, budgetLineId: 'l', expenseId: null, pairedMovementId: null, budgetLine: { name: 'Quotes' } }];
  assert.deepEqual(model.allocationPayload(current), [{ kind: 'INCOME', amountCents: 12000, budgetLineId: 'l' }]);
  assert.equal(model.newAllocation({ kind: 'INCOME', amount: '90', budgetLineId: 'l' }, 8000).error, 'L’import assignat supera l’import disponible del moviment.');
  assert.deepEqual(model.newAllocation({ kind: 'INCOME', amount: '80', budgetLineId: 'l' }, 8000).allocation, { kind: 'INCOME', amountCents: 8000, budgetLineId: 'l' });
  assert.equal(model.newAllocation({ kind: 'EXPENSE_SETTLEMENT', amount: '10' }, 8000).error, 'Tria la despesa.');
  const expenses = [{ id: 1, status: 'RECOGNISED', paymentMethod: 'BANK', totalCents: 100, settledCents: 0 }, { id: 2, status: 'RECOGNISED', paymentMethod: 'CARD', totalCents: 100, settledCents: 0 },
    { id: 3, status: 'RECOGNISED', paymentMethod: 'BANK', totalCents: 100, settledCents: 100 }, { id: 4, status: 'PROPOSED', paymentMethod: 'BANK', totalCents: 100, settledCents: 0 }];
  assert.deepEqual(model.settleableExpenses(expenses, { positionKind: 'BANK' }, 'EXPENSE_SETTLEMENT').map(e => e.id), [1]);
  assert.deepEqual(model.settleableExpenses(expenses, { positionKind: 'BANK' }, 'EXPENSE_REFUND').map(e => e.id), [1, 2, 3]);
  assert.equal(model.classificationLine({ classification: [{ kind: 'EXPENSE_SETTLEMENT', expense: { concept: 'Autobús' } }, { kind: 'INCOME', budgetLine: { name: 'Q' } }] }), 'Despesa · Autobús i 1 més');
});

test('wiring: each action label reaches its endpoint; reveal is on demand, never stored; shell, router and app register Tresoreria', () => {
  const movements = source('views/treasury/movements.js'), expenses = source('views/treasury/expenses.js'), form = source('views/treasury/expense-form.js');
  const shell = source('shell.js'), app = source('app.js'), html = source('index.html');
  const wired = [
    [movements, "'Classifica'", '/allocations'], [movements, 'Corregeix classificació', '/allocations'], [movements, 'Mostra descripció original', '/description'],
    [movements, 'Confirma que és duplicat', '/void-duplicate'], [movements, 'És un moviment vàlid', '/clear-review'], [movements, 'INTERNAL_TRANSFER', '/api/finance/internal-transfers'],
    [form, 'Crea i classifica', '/expense`'], [form, 'Crea la despesa', "'/api/finance/expenses'"], [expenses, 'Reconeix la despesa', '/recognise']];
  for (const [text, label, endpoint] of wired) { assert.ok(text.includes(label), label); assert.ok(text.includes(endpoint), endpoint); }
  assert.ok(source('views/treasury/model.js').includes('És un traspàs intern'));
  assert.ok(expenses.includes('Sense justificant adjunt'), 'no evidence → explicit text and no upload button');
  assert.doesNotMatch(expenses + form, /type: 'file'|upload/i);
  assert.doesNotMatch(movements, /localStorage|sessionStorage/, 'the original description is never stored');
  for (const toastText of ['Despesa creada', 'Classificació actualitzada', 'Moviment marcat com a duplicat']) assert.ok((movements + form).includes(toastText), toastText);
  assert.ok(PAGES.includes('tresoreria'));
  assert.match(shell, /\{id:'tresoreria',label:'Tresoreria',icon:'bank'\}/);
  assert.match(app, /setNavAvailable\('tresoreria', treasuryAvailable\(me\.capabilities\)\)/);
  assert.match(html, /id="treasuryView"[^>]*data-page="tresoreria"/);
  assert.match(html, /href="\/treasury\.css"/);
  assert.doesNotMatch(source('views/treasury.js') + movements + expenses + form + source('views/treasury/home.js') + source('views/treasury/forms.js'),
    /innerHTML|style=|fingerprint|import-batches', \{ method/, 'no HTML injection, no inline styles, no fingerprints, no import upload');
});

test('incomes: tab by capability, human states, filters, form validation and keeping income links', () => {
  assert.deepEqual(model.availableTabs(caps({ read: true, readMovements: true, readIncomes: true, readExpenses: true })).map(t => t.id), ['inici', 'moviments', 'ingressos', 'despeses']);
  assert.ok(!model.availableTabs(caps({ read: true, readMovements: true, readExpenses: true })).some(t => t.id === 'ingressos'), 'no Ingressos without finance.income.read');
  assert.equal(model.treasuryAvailable(caps({ readIncomes: true })), true);
  assert.deepEqual(['PENDING', 'PARTIAL', 'RECONCILED', 'VOID'].map(code => model.incomeState(code).label), ['Pendent de conciliar', 'Conciliat en part', 'Conciliat', 'Anul·lat']);
  assert.equal(model.incomeApiQuery('r', model.parseIncomeFilters({ estat: 'pendents', linia: UUID, des: 'x' })), `roundId=r&state=PENDING&budgetLineId=${UUID}`);
  const ok = model.validateIncome({ concept: ' Subvenció ', incomeDate: '2026-10-01', total: '1.500', budgetLineId: 'l' }, { roundId: 'r' });
  assert.equal(ok.body.totalCents, 150000, 'thousands dots are accepted');
  assert.equal(model.parseEuros('1.250,50'), 125050);
  assert.equal(model.parseEuros('15.50'), 1550, 'a decimal point still works');
  const good = model.validateIncome({ concept: ' Subvenció ', incomeDate: '2026-10-01', total: '1500', budgetLineId: 'l', counterpartyId: 'c' }, { roundId: 'r' });
  assert.deepEqual(good.body, { roundId: 'r', incomeDate: '2026-10-01', concept: 'Subvenció', totalCents: 150000, budgetLineId: 'l', counterpartyId: 'c' });
  assert.equal(model.validateIncome({ concept: 'V', incomeDate: '2026-10-01', total: '400', budgetLineId: 'l' }, { roundId: 'r', maxCents: 30000 }).errors.total,
    'L’import assignat supera l’import disponible del moviment.');
  assert.equal(model.validateIncome({ concept: '', incomeDate: '', total: '', budgetLineId: null }, { roundId: 'r' }).errors.budgetLineId, 'Tria una partida d’ingressos.');
  assert.deepEqual(model.allocationPayload([{ kind: 'INCOME', amountCents: 100, budgetLineId: 'l', incomeId: 'i' }]), [{ kind: 'INCOME', amountCents: 100, incomeId: 'i' }],
    'a kept income link carries no line (the income brings it)');
  assert.deepEqual(model.newAllocation({ kind: 'LINK_INCOME', amount: '300', incomeId: 'i' }, 30000).allocation, { kind: 'INCOME', amountCents: 30000, incomeId: 'i' });
  assert.equal(model.newAllocation({ kind: 'LINK_INCOME', amount: '300' }, 30000).error, 'Tria l’ingrés.');
  assert.equal(model.allocationLabel({ kind: 'INCOME', income: { concept: 'Venda loteria' } }), 'Ingrés · Venda loteria');
  assert.equal(model.errorCopy({ code: 'income_reconciled' }), 'Aquest ingrés ja té cobraments vinculats. Corregeix primer la classificació del moviment.');
  assert.doesNotMatch(model.errorCopy({ code: 'invalid_income' }), /_|[A-Z]{4,}/);
  const incomes = source('views/treasury/incomes.js'), form = source('views/treasury/income-form.js'), movements = source('views/treasury/movements.js');
  for (const [text, label, endpoint] of [[incomes, 'Nou ingrés', 'openIncomeForm'], [form, 'Crea l’ingrés', "'/api/finance/incomes'"], [form, 'Crea i concilia', '/income`'],
    [movements, 'LINK_INCOME', '/allocations'], [incomes, 'Concilia amb un moviment', '/allocations'], [incomes, 'Anul·la l’ingrés', '/void']])
  { assert.ok(text.includes(label), label); assert.ok(text.includes(endpoint), endpoint); }
  assert.doesNotMatch(incomes + form, /innerHTML|style=|localStorage/);
});
