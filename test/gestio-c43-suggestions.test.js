// FASE 3.5I — suggestions after a C43 import: explainable, never automatic. Family payments by name and amount
// (a quota is never marked paid by a suggestion), ambiguity left to a person, budget lines of the round's own budget
// (quota/activity lines excluded), special movements (transfers, card settlements, refunds, bank charges),
// existing expenses instead of new ones, and permission boundaries. Synthetic data only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, id } from './helpers/gestio-sqlite.js';
import { buildDemoData } from '../gestio/demo/data.js';
import { buildC43, latin1 } from '../gestio/demo/c43.js';

const ROUND = { code: '2026/2027', periodStart: '2026-10-01', periodEnd: '2027-09-30', annualFeeRoundId: id(901) };
const evidence = { filename: 'justificant-demo.pdf', mime: 'application/pdf',
  dataBase64: Buffer.from('%PDF-1.4\n%synthetic local fixture\n1 0 obj <<>> endobj\n%%EOF').toString('base64') };

async function setup() {
  const f = fixture();
  for (const user of [101, 102, 104, 105, 107]) await f.login(user);
  const call = (user, path, method = 'GET', body) => f.request(user, path, { method, body });
  const round = (await call(104, '/api/finance/rounds', 'POST', ROUND)).data.id;
  assert.equal((await call(104, `/api/finance/rounds/${round}/open`, 'POST', { expectedVersion: 1 })).status, 200);
  f.sql.exec(buildDemoData().sql);
  const bank = (await call(104, '/api/finance/positions', 'POST', { kind: 'BANK', name: 'Compte corrent', maskedReference: '2345' })).data.id;
  const cash = (await call(104, '/api/finance/positions', 'POST', { kind: 'CASH', name: 'Caixa' })).data.id;
  const line = async input => {
    const response = await call(104, '/api/finance/budget-lines', 'POST', { roundId: round, ...input });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return response.data.id;
  };
  const income = await line({ code: '1', name: 'Finançament', nature: 'INCOME' });
  const lines = {
    quotes: await line({ code: '1.1', name: 'Quotes', nature: 'INCOME', parentId: income, economicGroup: 'ANNUAL_FEES' }),
    lottery: await line({ code: '1.2', name: 'Loteria', nature: 'INCOME', parentId: income })
  };
  const camps = await line({ code: '2', name: 'Campaments', nature: 'EXPENSE' });
  const christmas = await line({ code: '2.1', name: 'Campament de Nadal', nature: 'EXPENSE', parentId: camps });
  const easter = await line({ code: '2.2', name: 'Campament de Pasqua', nature: 'EXPENSE', parentId: camps });
  lines.christmasBus = await line({ code: '2.1.2', name: 'Autobús', nature: 'EXPENSE', parentId: christmas });
  lines.easterBus = await line({ code: '2.2.2', name: 'Autobús', nature: 'EXPENSE', parentId: easter });
  const current = await line({ code: '3', name: 'Gastos corrents', nature: 'EXPENSE' });
  lines.supplies = await line({ code: '3.3', name: 'Suministres', nature: 'EXPENSE', parentId: current });
  // Verified quota payments of the demo, with the participants they cover and what is still to reconcile.
  const fees = f.sql.prepare(`SELECT p.id,sum(a.amount_cents) AS cents,group_concat(pt.display_name,'|') AS names,count(*) AS people
    FROM annual_fee_payment p JOIN annual_fee_allocation a ON a.payment_id=p.id JOIN annual_fee_obligation o ON o.id=a.obligation_id
    JOIN participant pt ON pt.id=o.participant_id WHERE p.review_status='VERIFIED'
      AND NOT EXISTS(SELECT 1 FROM annual_fee_issue i WHERE i.payment_id=p.id AND i.status='OPEN')
    GROUP BY p.id ORDER BY p.id`).all();
  let ref = 1000;
  const importStatement = async movements => {
    const text = buildC43({ start: '2026-10-01', end: '2026-12-31', openingCents: 1000000,
      movements: movements.map(item => ({ ref1: String(++ref).padStart(12, '0'), ...item })) });
    const contentBase64 = Buffer.from(latin1(text)).toString('base64');
    const hash = (await call(104, '/api/finance/bank-statements/preview', 'POST', { filename: 'C43.txt', contentBase64 })).data.file.hash;
    const result = await call(104, '/api/finance/bank-statements', 'POST', { filename: 'C43.txt', contentBase64, expectedFileHash: hash });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    return f.sql.prepare('SELECT id FROM finance_movement WHERE import_batch_id=? ORDER BY batch_row').all(result.data.id).map(row => row.id);
  };
  const suggest = async (movementId, user = 104) => call(user, `/api/finance/movements/${movementId}/suggestions`);
  const count = (table, where = '1=1') => f.sql.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).get().n;
  return { f, call, round, bank, cash, lines, fees, importStatement, suggest, count };
}

test('a quota transfer naming the educand is suggested with reasons, never marked paid; confirming uses the existing reconciliation', async () => {
  const s = await setup();
  try {
    const fee = s.fees.find(row => row.people === 1);
    assert.ok(fee, 'the demo has a verified single quota');
    const [movement] = await s.importStatement([{ date: '2026-10-05', amountCents: fee.cents, common: '04',
      concepts: [`TRANSFERENCIA ${fee.names.toUpperCase()}`, 'QUOTA ANUAL 26-27'] }]);
    const allocationsBefore = s.count('finance_allocation');
    const response = await s.suggest(movement);
    assert.equal(response.status, 200, JSON.stringify(response.data));
    const data = response.data;
    assert.equal(data.suggestionOnly, true);
    assert.deepEqual(data.round, { status: 'ONE', id: s.round, code: '2026/2027' });
    assert.equal(data.nature.kind, 'FEE');
    assert.equal(data.budgetLine, null, 'quota income is never suggested as a budget line (it is recognised through the fee payment)');
    const match = data.matches.find(item => item.type === 'FEE_PAYMENT' && item.id === fee.id);
    assert.ok(match, JSON.stringify(data.matches));
    assert.equal(match.strength, 'STRONG');
    assert.deepEqual(match.participants, [fee.names]);
    assert.ok(match.reasons.some(reason => reason.includes(fee.names)) && match.reasons.some(reason => /Import idèntic/.test(reason)));
    assert.equal(data.ambiguous, false);
    assert.doesNotMatch(JSON.stringify(data), /TRANSFERENCIA|QUOTA ANUAL 26-27/, 'the bank text itself is never returned');
    assert.equal(s.count('finance_allocation'), allocationsBefore, 'a suggestion writes nothing');
    // A person confirms through the existing allocation endpoint (all its guards apply).
    const confirmed = await s.call(104, `/api/finance/movements/${movement}/allocations`, 'POST',
      { expectedVersion: 0, allocations: [{ kind: 'FEE_PAYMENT', feePaymentId: fee.id, amountCents: match.amountCents }] });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
    assert.deepEqual((await s.suggest(movement)).data.notes, ['El moviment ja està classificat o anul·lat.']);
  } finally { s.f.close(); }
});

test('siblings and ambiguity: one payment for brothers matches by either name; two candidate payments are never chosen', async () => {
  const s = await setup();
  try {
    const siblings = s.fees.find(row => row.people >= 2);
    const singles = s.fees.filter(row => row.people === 1 && row.cents === s.fees.find(item => item.people === 1).cents).slice(0, 2);
    assert.ok(siblings && singles.length === 2, 'demo has siblings and equal single quotas');
    const brother = siblings.names.split('|')[1];
    const [family, mixed] = await s.importStatement([
      { date: '2026-10-06', amountCents: siblings.cents, common: '04', concepts: [`BIZUM QUOTA ${brother.toUpperCase()}`] },
      { date: '2026-10-07', amountCents: singles[0].cents, common: '04', concepts: [`QUOTA ${singles[0].names} I ${singles[1].names}`.toUpperCase().slice(0, 76)] }]);
    const forFamily = (await s.suggest(family)).data;
    const familyMatch = forFamily.matches.find(item => item.id === siblings.id);
    assert.ok(familyMatch, 'the sibling payment is found through the second child');
    assert.deepEqual(familyMatch.participants.sort(), siblings.names.split('|').sort());
    const forMixed = (await s.suggest(mixed)).data;
    assert.ok(forMixed.matches.filter(item => item.type === 'FEE_PAYMENT').length >= 2);
    assert.equal(forMixed.ambiguous, true, 'two families named: no candidate is picked');
    assert.ok(forMixed.notes.some(note => /més d’una coincidència/.test(note)));
    assert.equal(s.count('finance_allocation', "kind='FEE_PAYMENT'"), 0);
  } finally { s.f.close(); }
});

test('budget lines come from the round budget: a clear path is suggested, ties and unknown concepts stay pending', async () => {
  const s = await setup();
  try {
    const [christmasBus, anyBus, lottery, unknown, quota] = await s.importStatement([
      { date: '2026-10-08', amountCents: -48000, common: '03', concepts: ['RECIBO AUTOCARES FICTICIOS SL', 'AUTOBUS CAMPAMENT NADAL'] },
      { date: '2026-10-09', amountCents: -30000, common: '03', concepts: ['RECIBO AUTOBUS'] },
      { date: '2026-10-10', amountCents: 32000, common: '02', concepts: ['INGRESO LOTERIA NADAL'] },
      { date: '2026-10-11', amountCents: -9900, common: '03', concepts: ['RECIBO GIMNASIO FICTICIO'] },
      { date: '2026-10-12', amountCents: 2200, common: '04', concepts: ['QUOTA SENSE NOM'] }]);
    const bus = (await s.suggest(christmasBus)).data;
    assert.deepEqual([bus.nature.kind, bus.budgetLine?.id, bus.budgetLine?.path], ['EXPENSE', s.lines.christmasBus, ['Campaments', 'Campament de Nadal', 'Autobús']]);
    assert.match(bus.budgetLine.reasons[0], /autobus.*nadal/);
    const tie = (await s.suggest(anyBus)).data;
    assert.equal(tie.budgetLine, null);
    assert.deepEqual(tie.alternatives.map(item => item.id).sort(), [s.lines.christmasBus, s.lines.easterBus].sort(), 'equally good lines are offered, not chosen');
    const income = (await s.suggest(lottery)).data;
    assert.deepEqual([income.nature.kind, income.budgetLine?.id], ['INCOME', s.lines.lottery], 'income goes to income lines only');
    const none = (await s.suggest(unknown)).data;
    assert.equal(none.budgetLine, null);
    assert.ok(none.notes.some(note => /Cap partida/.test(note)), 'no compatible line: pending, never a wrong one');
    const fee = (await s.suggest(quota)).data;
    assert.equal(fee.budgetLine, null);
    assert.ok(fee.notes.some(note => /registrar i verificar el pagament a Quotes/.test(note)));
  } finally { s.f.close(); }
});

test('special movements: own-account transfer, card settlement, refunds and bank charges are not ordinary income or expense', async () => {
  const s = await setup();
  try {
    const cashIn = (await s.call(104, '/api/finance/movements', 'POST', { positionId: s.cash, operationDate: '2026-10-15', amountCents: 20000, label: 'Entrada a caixa' })).data.id;
    const [transfer, card, refund, charges] = await s.importStatement([
      { date: '2026-10-14', amountCents: -20000, common: '04', concepts: ['TRASPASO A CUENTA PROPIA'] },
      { date: '2026-10-16', amountCents: -6500, common: '12', concepts: ['LIQUIDACION TARJETA CREDITO'] },
      { date: '2026-10-17', amountCents: 2500, common: '14', concepts: ['DEVOLUCION RECIBO SUMINISTROS'] },
      { date: '2026-10-18', amountCents: -1500, common: '17', concepts: ['COMISION MANTENIMIENTO'] }]);
    const own = (await s.suggest(transfer)).data;
    assert.deepEqual([own.nature.kind, own.transfer?.id], ['INTERNAL_TRANSFER', cashIn]);
    assert.equal(own.budgetLine, null, 'a transfer between own accounts is never income or expense');
    assert.equal((await s.suggest(card)).data.nature.kind, 'CARD_SETTLEMENT');
    assert.equal((await s.suggest(card)).data.budgetLine, null, 'a card settlement is not a new expense');
    assert.equal((await s.suggest(refund)).data.nature.kind, 'REFUND_RECEIVED');
    assert.equal((await s.suggest(charges)).data.nature.kind, 'BANK_CHARGES');
    // Confirming the transfer reuses the existing pairing (one fact, counted once on each side).
    const done = await s.call(104, '/api/finance/internal-transfers', 'POST', { fromMovementId: transfer, toMovementId: cashIn, fromExpectedVersion: 0, toExpectedVersion: 0 });
    assert.equal(done.status, 201, JSON.stringify(done.data));
  } finally { s.f.close(); }
});

test('a charge matching an expense already recognised is offered to settle it, never as a second expense', async () => {
  const s = await setup();
  try {
    const created = await s.call(104, '/api/finance/expenses', 'POST', { roundId: s.round, expenseDate: '2026-10-07', totalCents: 48000,
      paymentMethod: 'BANK', concept: 'Autobús Nadal', lines: [{ budgetLineId: s.lines.christmasBus, amountCents: 48000 }] });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal((await s.call(104, `/api/finance/expenses/${created.data.id}/evidence`, 'POST', evidence)).status, 201);
    assert.equal((await s.call(104, `/api/finance/expenses/${created.data.id}/recognise`, 'POST', { expectedVersion: 1 })).status, 200);
    const [movement] = await s.importStatement([{ date: '2026-10-08', amountCents: -48000, common: '03', concepts: ['AUTOBUS CAMPAMENT NADAL'] }]);
    const data = (await s.suggest(movement)).data;
    const settle = data.matches.find(item => item.type === 'EXPENSE_SETTLEMENT');
    assert.deepEqual([settle?.id, settle?.strength, settle?.amountCents], [created.data.id, 'STRONG', 48000]);
    assert.equal(s.count('finance_expense'), 1, 'no expense is created by the import or the suggestion');
  } finally { s.f.close(); }
});

test('movements outside any open round leave the round to a person; suggestions follow the existing classify permission', async () => {
  const s = await setup();
  try {
    const [early] = await (async () => {
      const text = buildC43({ start: '2026-09-01', end: '2026-09-30', openingCents: 0, movements: [{ date: '2026-09-20', amountCents: -1000, ref1: '9', concepts: ['RECIBO SUMINISTROS'] }] });
      const contentBase64 = Buffer.from(latin1(text)).toString('base64');
      const hash = (await s.call(104, '/api/finance/bank-statements/preview', 'POST', { filename: 'C43.txt', contentBase64 })).data.file.hash;
      const batch = (await s.call(104, '/api/finance/bank-statements', 'POST', { filename: 'C43.txt', contentBase64, expectedFileHash: hash })).data.id;
      return s.f.sql.prepare('SELECT id FROM finance_movement WHERE import_batch_id=?').all(batch).map(row => row.id);
    })();
    const data = (await s.suggest(early)).data;
    assert.equal(data.round.status, 'NONE');
    assert.equal(data.budgetLine, null, 'without a clear round no budget line is suggested');
    assert.ok(data.notes.some(note => /Cap ronda oberta/.test(note)));
    for (const user of [102, 105, 107]) assert.equal((await s.suggest(early, user)).status, 403, `user ${user}`);
    assert.equal((await s.suggest(early, 101)).status, 200, 'general coordination already classifies movements');
  } finally { s.f.close(); }
});
