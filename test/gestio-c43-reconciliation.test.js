// FASE 3.5I — economic integrity of Inscripcions + Quotes + C43: one transfer is recognised exactly once, whatever
// arrives first (family proof, bank movement, manual entry). Every scenario checks persisted amounts — movement,
// available, allocated, obligation pending, Quotes allocations, round income, the quota budget line and the
// traditional export — not only the PAID/PARTIAL badge. Synthetic demo data only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, id } from './helpers/gestio-sqlite.js';
import { buildDemoData } from '../gestio/demo/data.js';
import { buildC43, latin1 } from '../gestio/demo/c43.js';
import { reconcileFeeFromMovement } from '../gestio/src/domains/finance/fee-reconciliation.js';
import { resultWorkbookModel } from '../gestio/src/domains/finance/treasury-export-model.js';

const ROUND = { code: '2026/2027', periodStart: '2026-10-01', periodEnd: '2027-09-30', annualFeeRoundId: id(901) };
const evidence = { filename: 'justificant-demo.pdf', mime: 'application/pdf',
  dataBase64: Buffer.from('%PDF-1.4\n%synthetic local fixture\n1 0 obj <<>> endobj\n%%EOF').toString('base64') };

async function setup() {
  const f = fixture();
  for (const user of [101, 102, 104]) await f.login(user);
  const call = (user, path, method = 'GET', body) => f.request(user, path, { method, body });
  const round = (await call(104, '/api/finance/rounds', 'POST', ROUND)).data.id;
  assert.equal((await call(104, `/api/finance/rounds/${round}/open`, 'POST', { expectedVersion: 1 })).status, 200);
  f.sql.exec(buildDemoData().sql);
  f.sql.prepare(`UPDATE activity_registration SET finance_round_id=? WHERE finance_round_id IS NULL AND expected_amount_cents>0 AND activity_id IN
    (SELECT id FROM activity WHERE date(starts_at/1000,'unixepoch') BETWEEN '2026-10-01' AND '2027-09-30')`).run(round);
  const bank = (await call(104, '/api/finance/positions', 'POST', { kind: 'BANK', name: 'Compte corrent', maskedReference: '2345' })).data.id;
  const line = async input => (await call(104, '/api/finance/budget-lines', 'POST', { roundId: round, ...input })).data.id;
  const income = await line({ code: '1', name: 'Finançament', nature: 'INCOME' });
  const quotaLine = await line({ code: '1.1', name: 'Quotes', nature: 'INCOME', parentId: income, economicGroup: 'ANNUAL_FEES' });
  const camps = await line({ code: '2', name: 'Campaments', nature: 'EXPENSE' });
  const bus = await line({ code: '2.1.2', name: 'Autobús', nature: 'EXPENSE', parentId: await line({ code: '2.1', name: 'Campament de Nadal', nature: 'EXPENSE', parentId: camps }) });
  assert.equal((await call(104, `/api/finance/rounds/${round}/budget`, 'POST')).status, 201);
  let ref = 7000;
  const importStatement = async movements => {
    const text = buildC43({ start: '2026-10-01', end: '2026-12-31', openingCents: 1000000,
      movements: movements.map(item => ({ ref1: String(++ref).padStart(12, '0'), common: '04', ...item })) });
    const contentBase64 = Buffer.from(latin1(text)).toString('base64');
    const hash = (await call(104, '/api/finance/bank-statements/preview', 'POST', { filename: 'C43.txt', contentBase64 })).data.file.hash;
    const result = await call(104, '/api/finance/bank-statements', 'POST', { filename: 'C43.txt', contentBase64, expectedFileHash: hash });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    return f.sql.prepare('SELECT id FROM finance_movement WHERE import_batch_id=? ORDER BY batch_row').all(result.data.id).map(row => row.id);
  };
  const suggest = async movementId => (await call(104, `/api/finance/movements/${movementId}/suggestions`)).data;
  const version = movementId => f.sql.prepare('SELECT allocation_version AS v FROM finance_movement WHERE id=?').get(movementId).v;
  const reconcile = (movementId, body, user = 104) => call(user, `/api/finance/movements/${movementId}/fee-reconciliations`, 'POST', { expectedVersion: version(movementId), ...body });
  const obligation = obligationId => f.sql.prepare(`SELECT participant_id AS participantId,display_name AS name,amount_due_cents AS due,allocated_cents AS allocated,
    amount_due_cents-allocated_cents AS pending,status,family_group_id AS familyId FROM annual_fee_obligation_status WHERE id=?`).get(obligationId);
  const pendingObligations = () => f.sql.prepare(`SELECT s.id FROM annual_fee_obligation_status s WHERE s.status='PENDING' AND s.allocated_cents=0
    AND NOT EXISTS(SELECT 1 FROM annual_fee_submission_person p JOIN annual_fee_payment pay ON pay.id=p.payment_id
      WHERE p.participant_id=s.participant_id AND pay.verified_amount_cents IS NULL) ORDER BY s.id`).all().map(row => row.id);
  // The economic picture, from persisted rows and the canonical read models.
  const ledger = async (movementIds = [], obligationIds = []) => ({
    movements: movementIds.map(movementId => f.sql.prepare(`SELECT m.amount_cents AS amount,COALESCE(b.allocated_cents,0) AS allocated,
      COALESCE(b.unallocated_cents,abs(m.amount_cents)) AS available FROM finance_movement m LEFT JOIN finance_movement_allocation_balance b ON b.movement_id=m.id
      WHERE m.id=?`).get(movementId)).map(row => ({ ...row })),
    obligations: obligationIds.map(obligationId => ({ allocated: obligation(obligationId).allocated, pending: obligation(obligationId).pending })),
    feeAllocations: f.sql.prepare('SELECT COALESCE(sum(amount_cents),0) AS n FROM annual_fee_allocation').get().n,
    feePayments: f.sql.prepare('SELECT count(*) AS n FROM annual_fee_payment').get().n,
    income: f.sql.prepare('SELECT income_cents AS n FROM finance_round_economics WHERE round_id=?').get(round).n,
    expense: f.sql.prepare('SELECT expense_gross_cents-expense_refund_cents AS n FROM finance_round_economics WHERE round_id=?').get(round).n,
    quotaBudget: (await call(104, `/api/finance/rounds/${round}/budget`)).data.lines.find(row => row.id === quotaLine).actualCents,
    exportedFees: (await resultWorkbookModel(f.db, f.context[104], crypto.randomUUID(), round)).detail.Cuotas.income.reduce((sum, row) => sum + row.cents, 0)
  });
  return { f, call, round, bank, bus, importStatement, suggest, reconcile, version, obligation, pendingObligations, ledger };
}
const delta = (before, after) => ({ feeAllocations: after.feeAllocations - before.feeAllocations, feePayments: after.feePayments - before.feePayments,
  income: after.income - before.income, quotaBudget: after.quotaBudget - before.quotaBudget, exportedFees: after.exportedFees - before.exportedFees, expense: after.expense - before.expense });
const once = cents => ({ feeAllocations: cents, feePayments: 0, income: cents, quotaBudget: cents, exportedFees: cents, expense: 0 });

test('family proof pending review + C43: one confirmation verifies it, links the bank and recognises the quota once', async () => {
  const s = await setup();
  try {
    const proof = s.f.sql.prepare(`SELECT p.id,s.participant_id AS participantId FROM annual_fee_payment p JOIN annual_fee_submission_person s ON s.payment_id=p.id
      WHERE p.verified_amount_cents IS NULL AND p.review_status='PENDING_REVIEW' AND s.match_status='CLEAR'`).get();
    const ob = s.f.sql.prepare('SELECT id FROM annual_fee_obligation_status WHERE participant_id=?').get(proof.participantId).id;
    const { name, pending } = s.obligation(ob);
    const [movement] = await s.importStatement([{ date: '2026-10-05', amountCents: pending, concepts: [`TRANSFERENCIA QUOTA ${name.toUpperCase()}`] }]);
    const match = (await s.suggest(movement)).matches.find(item => item.type === 'FEE_PROOF');
    assert.deepEqual([match?.paymentId, match?.strength, match?.allocations.map(row => [row.obligationId, row.amountCents])], [proof.id, 'STRONG', [[ob, pending]]]);
    const before = await s.ledger([movement], [ob]);
    const done = await s.reconcile(movement, { paymentId: proof.id, allocations: match.allocations.map(({ obligationId, amountCents }) => ({ obligationId, amountCents })) });
    assert.equal(done.status, 201, JSON.stringify(done.data));
    const after = await s.ledger([movement], [ob]);
    assert.deepEqual(delta(before, after), once(pending));
    assert.deepEqual(after.movements, [{ amount: pending, allocated: pending, available: 0 }]);
    assert.deepEqual(after.obligations, [{ allocated: pending, pending: 0 }]);
    const payment = s.f.sql.prepare('SELECT review_status,verified_amount_cents,origin FROM annual_fee_payment WHERE id=?').get(proof.id);
    assert.deepEqual({ ...payment }, { review_status: 'VERIFIED', verified_amount_cents: pending, origin: 'FAMILY' });
    assert.equal(s.f.sql.prepare('SELECT count(*) AS n FROM annual_fee_evidence WHERE payment_id=?').get(proof.id).n, 1, 'the family proof is kept');
    const actions = s.f.sql.prepare("SELECT action FROM audit_event WHERE resource_id IN (?,?,?)").all(proof.id, movement, ob).map(row => row.action);
    for (const action of ['FEE_PAYMENT_VERIFIED', 'FEE_RECEIPT_RECONCILED', 'MOVEMENT_CLASSIFIED', 'FEE_ALLOCATION_CREATED']) assert.ok(actions.includes(action), action);
    // Replays and second attempts change nothing.
    assert.equal((await s.call(104, `/api/finance/movements/${movement}/fee-reconciliations`, 'POST', { expectedVersion: 0, paymentId: proof.id,
      allocations: [{ obligationId: ob, amountCents: pending }] })).status, 409, 'stale replay');
    assert.equal((await s.reconcile(movement, { paymentId: proof.id, allocations: [{ obligationId: ob, amountCents: 1 }] })).status, 409);
    assert.deepEqual(await s.ledger([movement], [ob]), after);
  } finally { s.f.close(); }
});

test('no family proof: the bank transfer becomes the canonical Quotes payment, verified and linked in one step', async () => {
  const s = await setup();
  try {
    const ob = s.pendingObligations()[0];
    const { name, pending, participantId } = s.obligation(ob);
    const [movement] = await s.importStatement([{ date: '2026-10-06', amountCents: pending, concepts: [`BIZUM ${name.toUpperCase()}`] }]);
    const match = (await s.suggest(movement)).matches.find(item => item.type === 'FEE_OBLIGATION');
    assert.deepEqual([match?.strength, match?.allocations.map(row => row.obligationId)], ['STRONG', [ob]]);
    const before = await s.ledger([movement], [ob]);
    const done = await s.reconcile(movement, { allocations: [{ obligationId: ob, amountCents: pending }] });
    assert.equal(done.status, 201, JSON.stringify(done.data));
    const after = await s.ledger([movement], [ob]);
    assert.deepEqual(delta(before, after), { ...once(pending), feePayments: 1 });
    assert.deepEqual(after.obligations, [{ allocated: pending, pending: 0 }]);
    const payment = s.f.sql.prepare('SELECT origin,source_movement_id,review_status,verified_amount_cents,receipt_email FROM annual_fee_payment WHERE id=?').get(done.data.paymentId);
    assert.deepEqual({ ...payment }, { origin: 'BANK', source_movement_id: movement, review_status: 'VERIFIED', verified_amount_cents: pending, receipt_email: '' });
    assert.equal(s.f.sql.prepare('SELECT count(*) AS n FROM annual_fee_notification_outbox WHERE payment_id=?').get(done.data.paymentId).n, 0, 'no e-mail without a family address');
    assert.equal(s.f.sql.prepare('SELECT count(*) AS n FROM audit_event WHERE action=? AND resource_id=?').get('FEE_BANK_PAYMENT_RECORDED', done.data.paymentId).n, 1);
    const quotes = await s.call(104, `/api/quotes/participants/${participantId}`);
    assert.equal(quotes.status, 200, JSON.stringify(quotes.data));
    assert.equal(quotes.data.quota.status, 'PAID', 'Quotes shows the quota paid, no proof required');
    assert.equal(s.f.sql.prepare("SELECT count(*) AS n FROM annual_fee_payment WHERE origin='BANK' AND source_movement_id=?").get(movement).n, 1);
  } finally { s.f.close(); }
});

test('quota already paid: the bank movement is linked as its evidence; Quotes stays at the same amount; a second transfer waits for review', async () => {
  const s = await setup();
  try {
    const paid = s.f.sql.prepare(`SELECT p.id,a.obligation_id AS ob,a.amount_cents AS cents FROM annual_fee_payment p JOIN annual_fee_allocation a ON a.payment_id=p.id
      WHERE p.review_status='VERIFIED' AND (SELECT count(*) FROM annual_fee_allocation x WHERE x.payment_id=p.id)=1
        AND NOT EXISTS(SELECT 1 FROM annual_fee_issue i WHERE i.status='OPEN' AND (i.payment_id=p.id OR i.obligation_id=a.obligation_id))
        AND (SELECT status FROM annual_fee_obligation_status WHERE id=a.obligation_id)='PAID' ORDER BY p.id`).get();
    const { name, allocated } = s.obligation(paid.ob);
    const [first, second] = await s.importStatement([
      { date: '2026-10-07', amountCents: paid.cents, concepts: [`QUOTA ${name.toUpperCase()}`] },
      { date: '2026-10-20', amountCents: paid.cents, concepts: [`QUOTA ${name.toUpperCase()}`] }]);
    const match = (await s.suggest(first)).matches.find(item => item.type === 'FEE_PAYMENT' && item.id === paid.id);
    assert.equal(match?.strength, 'STRONG');
    assert.ok(!(await s.suggest(first)).matches.some(item => item.type === 'FEE_OBLIGATION'), 'never proposed as a new payment');
    const before = await s.ledger([first], [paid.ob]);
    assert.equal((await s.call(104, `/api/finance/movements/${first}/allocations/add`, 'POST', { expectedVersion: 0,
      allocation: { kind: 'FEE_PAYMENT', feePaymentId: paid.id, amountCents: match.amountCents } })).status, 200);
    const after = await s.ledger([first], [paid.ob]);
    assert.deepEqual(after.obligations, [{ allocated, pending: 0 }], 'paid before: same amount after');
    assert.deepEqual(delta(before, after), { ...once(paid.cents), feeAllocations: 0 }, 'Treasury recognises the bank receipt once; Quotes adds nothing');
    // The same quota arrives again: nothing proposes paying it twice; a forced attempt is refused.
    const again = await s.suggest(second);
    assert.ok(!again.matches.some(item => ['FEE_PAYMENT', 'FEE_OBLIGATION', 'FEE_PROOF'].includes(item.type)), JSON.stringify(again.matches));
    assert.ok(again.notes.some(note => /ja està reconeguda/.test(note)), 'possible repeated payment, left for review');
    const forced = await s.reconcile(second, { allocations: [{ obligationId: paid.ob, amountCents: paid.cents }] });
    assert.deepEqual([forced.status, forced.data.error], [409, 'fee_obligation_already_covered']);
    assert.deepEqual(await s.ledger([first], [paid.ob]), after);
    assert.equal(s.f.sql.prepare('SELECT allocation_version AS v FROM finance_movement WHERE id=?').get(second).v, 0, 'the second transfer stays pending, not discarded');
  } finally { s.f.close(); }
});

test('siblings in one transfer, a partial payment completed later, and an overpayment that leaves the rest pending', async () => {
  const s = await setup();
  try {
    const family = s.f.sql.prepare(`SELECT family_group_id AS f FROM annual_fee_obligation_status WHERE family_group_id IS NOT NULL
      GROUP BY family_group_id HAVING count(*)=2 AND sum(status='PENDING' AND allocated_cents=0)=2 LIMIT 1`).get().f;
    const kids = s.f.sql.prepare('SELECT id FROM annual_fee_obligation_status WHERE family_group_id=? ORDER BY sibling_ordinal').all(family).map(row => row.id);
    const familyTotal = kids.reduce((sum, ob) => sum + s.obligation(ob).pending, 0);
    const others = s.pendingObligations().filter(ob => !kids.includes(ob));
    const [partialOb, overOb] = others;
    const [siblings, part1, part2, over] = await s.importStatement([
      { date: '2026-10-08', amountCents: familyTotal, concepts: [`QUOTES GERMANS ${s.obligation(kids[1]).name.toUpperCase()}`] },
      { date: '2026-10-09', amountCents: 4000, concepts: [`QUOTA ${s.obligation(partialOb).name.toUpperCase()} PRIMER PAGAMENT`] },
      { date: '2026-11-09', amountCents: s.obligation(partialOb).pending - 4000, concepts: [`QUOTA ${s.obligation(partialOb).name.toUpperCase()} SEGON PAGAMENT`] },
      { date: '2026-10-10', amountCents: s.obligation(overOb).pending + 5000, concepts: [`QUOTA ${s.obligation(overOb).name.toUpperCase()}`] }]);
    // Two brothers, one transfer naming one of them: the family's two quotas.
    const forFamily = (await s.suggest(siblings)).matches.find(item => item.type === 'FEE_OBLIGATION');
    assert.deepEqual([forFamily.strength, forFamily.allocations.map(row => row.obligationId).sort()], ['STRONG', [...kids].sort()]);
    let before = await s.ledger([siblings], kids);
    assert.equal((await s.reconcile(siblings, { allocations: forFamily.allocations.map(({ obligationId, amountCents }) => ({ obligationId, amountCents })) })).status, 201);
    let after = await s.ledger([siblings], kids);
    assert.deepEqual(delta(before, after), { ...once(familyTotal), feePayments: 1 }, 'one payment for both brothers, counted once');
    assert.ok(after.obligations.every(row => row.pending === 0));
    // Two transfers for one quota.
    const total = s.obligation(partialOb).pending;
    before = await s.ledger([part1, part2], [partialOb]);
    assert.equal((await s.reconcile(part1, { allocations: [{ obligationId: partialOb, amountCents: 4000 }] })).status, 201);
    assert.deepEqual([s.obligation(partialOb).status, s.obligation(partialOb).pending], ['PARTIAL', total - 4000]);
    const second = (await s.suggest(part2)).matches.find(item => item.type === 'FEE_OBLIGATION');
    assert.deepEqual([second.strength, second.amountCents], ['STRONG', total - 4000]);
    assert.equal((await s.reconcile(part2, { allocations: [{ obligationId: partialOb, amountCents: total - 4000 }] })).status, 201);
    after = await s.ledger([part1, part2], [partialOb]);
    assert.deepEqual(delta(before, after), { ...once(total), feePayments: 2 });
    assert.deepEqual([s.obligation(partialOb).status, s.obligation(partialOb).pending], ['PAID', 0]);
    // More than pending: only the pending part is recognised; the rest of the movement stays to classify.
    const due = s.obligation(overOb).pending;
    assert.equal((await s.reconcile(over, { allocations: [{ obligationId: overOb, amountCents: due + 5000 }] })).data.error, 'fee_obligation_already_covered');
    before = await s.ledger([over], [overOb]);
    assert.equal((await s.reconcile(over, { allocations: [{ obligationId: overOb, amountCents: due }] })).status, 201);
    after = await s.ledger([over], [overOb]);
    assert.deepEqual(delta(before, after), { ...once(due), feePayments: 1 });
    assert.deepEqual(after.movements, [{ amount: due + 5000, allocated: due, available: 5000 }], 'the excess is not income: it waits for a person');
    assert.equal(s.f.sql.prepare("SELECT count(*) AS n FROM annual_fee_issue WHERE obligation_id=? AND status='OPEN'").get(overOb).n, 0);
  } finally { s.f.close(); }
});

test('one transfer for a quota and a camp: both are reconciled once, never above the movement', async () => {
  const s = await setup();
  try {
    const activity = s.f.sql.prepare(`SELECT pa.id,p.display_name AS name,ar.participant_id AS participantId,ar.activity_id AS activityId,pa.amount_cents-COALESCE((SELECT sum(x.amount_cents)
      FROM finance_allocation_current x WHERE x.kind='ACTIVITY_PAYMENT' AND x.activity_allocation_id=pa.id),0) AS outstanding
      FROM activity_payment_allocation pa JOIN activity_registration ar ON ar.id=pa.registration_id JOIN participant p ON p.id=ar.participant_id
      LEFT JOIN payment_evidence e ON e.id=pa.evidence_id WHERE ar.finance_round_id IS NOT NULL AND (pa.evidence_id IS NULL OR e.review_status='VERIFIED')
        AND EXISTS(SELECT 1 FROM annual_fee_obligation_status o WHERE o.participant_id=ar.participant_id AND o.status='PENDING' AND o.allocated_cents=0)
      ORDER BY pa.id`).all().find(row => row.outstanding > 0);
    const ob = s.f.sql.prepare('SELECT id FROM annual_fee_obligation_status WHERE participant_id=?').get(activity.participantId).id;
    const due = s.obligation(ob).pending;
    // Camp income needs its own budget line linked to the activity (existing rule of the budget and the export).
    const camps = (await s.call(104, '/api/finance/budget-lines', 'POST', { roundId: s.round, code: '2', name: 'Campaments', nature: 'INCOME' })).data.id;
    assert.equal((await s.call(104, '/api/finance/budget-lines', 'POST', { roundId: s.round, code: '2.1', name: 'Campament', nature: 'INCOME', parentId: camps,
      activityId: activity.activityId })).status, 201);
    const [movement] = await s.importStatement([{ date: '2026-10-11', amountCents: due + activity.outstanding,
      concepts: [`QUOTA I CAMPAMENT ${activity.name.toUpperCase()}`] }]);
    const before = await s.ledger([movement], [ob]);
    assert.equal((await s.reconcile(movement, { allocations: [{ obligationId: ob, amountCents: due }] })).status, 201);
    const added = await s.call(104, `/api/finance/movements/${movement}/allocations/add`, 'POST', { expectedVersion: s.version(movement),
      allocation: { kind: 'ACTIVITY_PAYMENT', activityAllocationId: activity.id, amountCents: activity.outstanding } });
    assert.equal(added.status, 200, JSON.stringify(added.data));
    const after = await s.ledger([movement], [ob]);
    assert.deepEqual(after.movements, [{ amount: due + activity.outstanding, allocated: due + activity.outstanding, available: 0 }]);
    assert.equal(after.income - before.income, due + activity.outstanding, 'quota and camp, each once');
    assert.deepEqual([after.quotaBudget - before.quotaBudget, after.exportedFees - before.exportedFees], [due, due]);
    const over = await s.call(104, `/api/finance/movements/${movement}/allocations/add`, 'POST', { expectedVersion: s.version(movement),
      allocation: { kind: 'ACTIVITY_PAYMENT', activityAllocationId: activity.id, amountCents: 1 } });
    assert.equal(over.status, 409, 'never above the movement nor above what the camp still owes');
    assert.deepEqual(await s.ledger([movement], [ob]), after);
  } finally { s.f.close(); }
});

test('two simultaneous confirmations for the same quota: the later one fails whole; two equal transfers of two families both count', async () => {
  const s = await setup();
  try {
    const [obA, obB] = s.pendingObligations();
    const due = s.obligation(obA).pending;
    assert.equal(s.obligation(obB).pending, due, 'two equal quotas');
    const [m1, m2, m3] = await s.importStatement([
      { date: '2026-10-12', amountCents: due, concepts: [`QUOTA ${s.obligation(obA).name.toUpperCase()}`] },
      { date: '2026-10-12', amountCents: due, concepts: [`QUOTA ${s.obligation(obA).name.toUpperCase()} REPETIDA`] },
      { date: '2026-10-12', amountCents: due, concepts: [`QUOTA ${s.obligation(obB).name.toUpperCase()}`] }]);
    const before = await s.ledger([m1, m2, m3], [obA, obB]);
    // Race: m2's confirmation is prepared, then m1's commits, then m2's batch runs.
    let raced = false;
    const racingDb = { prepare: (...args) => s.f.db.prepare(...args), batch: async statements => {
      if (!raced) { raced = true; await reconcileFeeFromMovement(s.f.db, s.f.context[104], crypto.randomUUID(), m1, { expectedVersion: 0, allocations: [{ obligationId: obA, amountCents: due }] }); }
      return s.f.db.batch(statements);
    } };
    await assert.rejects(reconcileFeeFromMovement(racingDb, s.f.context[104], crypto.randomUUID(), m2, { expectedVersion: 0, allocations: [{ obligationId: obA, amountCents: due }] }),
      error => error.status === 409 && error.code === 'fee_obligation_already_covered');
    // Two families, same amount, same day: both legitimate.
    assert.equal((await s.reconcile(m3, { allocations: [{ obligationId: obB, amountCents: due }] })).status, 201);
    const after = await s.ledger([m1, m2, m3], [obA, obB]);
    assert.deepEqual(after.obligations, [{ allocated: due, pending: 0 }, { allocated: due, pending: 0 }]);
    assert.deepEqual(after.movements.map(row => row.available), [0, due, 0], 'the repeated transfer waits for review');
    assert.deepEqual(delta(before, after), { ...once(2 * due), feePayments: 2 }, 'the failed confirmation left no payment behind');
  } finally { s.f.close(); }
});

test('a manual entry already reconciled, an expense already recognised and a refund: none is counted twice', async () => {
  const s = await setup();
  try {
    // Manual bank entry already reconciled with a quota; the statement brings the same transfer.
    const ob = s.pendingObligations()[0];
    const { name, pending } = s.obligation(ob);
    const manual = (await s.call(104, '/api/finance/movements', 'POST', { positionId: s.bank, operationDate: '2026-10-13', amountCents: pending, label: 'Quota registrada a mà' })).data.id;
    assert.equal((await s.reconcile(manual, { allocations: [{ obligationId: ob, amountCents: pending }] })).status, 201);
    const before = await s.ledger([manual], [ob]);
    const [imported] = await s.importStatement([{ date: '2026-10-13', amountCents: pending, concepts: [`QUOTA ${name.toUpperCase()}`] }]);
    assert.equal(s.f.sql.prepare('SELECT review_flag FROM finance_movement WHERE id=?').get(imported).review_flag, 'NEAR_MATCH', 'flagged as a possible duplicate');
    const tips = await s.suggest(imported);
    assert.ok(!tips.matches.some(item => item.type.startsWith('FEE')), 'never proposed as another quota payment');
    assert.equal((await s.call(104, `/api/finance/movements/${imported}/void-duplicate`, 'POST', { duplicateOfId: manual, expectedReviewVersion: 1 })).status, 200,
      'Treasury voids the imported copy of the manual entry');
    assert.deepEqual({ ...await s.ledger([manual], [ob]), quotaBudget: before.quotaBudget }, before);
    // An expense recognised before the statement: settling it never creates a second expense.
    const expense = await s.call(104, '/api/finance/expenses', 'POST', { roundId: s.round, expenseDate: '2026-10-14', totalCents: 48000, paymentMethod: 'BANK',
      concept: 'Autobús Nadal', lines: [{ budgetLineId: s.bus, amountCents: 48000 }] });
    assert.equal((await s.call(104, `/api/finance/expenses/${expense.data.id}/evidence`, 'POST', evidence)).status, 201);
    assert.equal((await s.call(104, `/api/finance/expenses/${expense.data.id}/recognise`, 'POST', { expectedVersion: 1 })).status, 200);
    const [charge, refund] = await s.importStatement([
      { date: '2026-10-15', amountCents: -48000, common: '03', concepts: ['AUTOBUS CAMPAMENT NADAL'] },
      { date: '2026-10-16', amountCents: -pending, common: '14', concepts: [`DEVOLUCION TRANSFERENCIA QUOTA ${name.toUpperCase()}`] }]);
    const beforeSettle = await s.ledger([charge], []);
    const settle = (await s.suggest(charge)).matches.find(item => item.type === 'EXPENSE_SETTLEMENT');
    assert.equal((await s.call(104, `/api/finance/movements/${charge}/allocations/add`, 'POST', { expectedVersion: 0,
      allocation: { kind: 'EXPENSE_SETTLEMENT', expenseId: settle.id, amountCents: 48000 } })).status, 200);
    const afterSettle = await s.ledger([charge], []);
    assert.equal(afterSettle.expense, beforeSettle.expense, 'the expense was already counted when recognised');
    assert.equal(s.f.sql.prepare('SELECT count(*) AS n FROM finance_expense').get().n, 1);
    // A refund of a reconciled quota is never income or an automatic expense: it waits for a person.
    const tip = await s.suggest(refund);
    assert.deepEqual([tip.nature.kind, tip.budgetLine, tip.matches.filter(item => item.type.startsWith('FEE')).length], ['REFUND_PAID', null, 0]);
    assert.deepEqual(await s.ledger([], []), { ...afterSettle, movements: [] });
  } finally { s.f.close(); }
});

test('permissions: section coordination cannot reconcile; Treasury needs the quota scope; amounts are validated server-side', async () => {
  const s = await setup();
  try {
    const ob = s.pendingObligations()[0];
    const [movement] = await s.importStatement([{ date: '2026-10-17', amountCents: 100, concepts: ['QUOTA'] }]);
    assert.equal((await s.reconcile(movement, { allocations: [{ obligationId: ob, amountCents: 100 }] }, 102)).status, 403);
    assert.equal((await s.reconcile(movement, { allocations: [{ obligationId: ob, amountCents: 0 }] })).status, 400);
    assert.equal((await s.reconcile(movement, { allocations: [{ obligationId: ob, amountCents: 101 }] })).data.error, 'allocation_exceeds_movement');
    assert.equal(s.f.sql.prepare('SELECT count(*) AS n FROM finance_allocation').get().n, 0);
  } finally { s.f.close(); }
});
