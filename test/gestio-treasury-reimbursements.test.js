import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, id } from './helpers/gestio-sqlite.js';
import { commitWithEvidence } from '../gestio/src/domains/finance/evidence.js';

const evidence = { filename: 'ticket-synthetic.pdf', mime: 'application/pdf',
  dataBase64: Buffer.from('%PDF-1.4\n%synthetic local fixture\n1 0 obj <<>> endobj\n%%EOF').toString('base64') };
const call = (f, user, path, method = 'GET', body) => f.request(user, path, { method, body });
async function setup() {
  const f = fixture();
  for (const user of [101, 102, 104, 107]) await f.login(user);
  const created = await call(f, 104, '/api/finance/rounds', 'POST', {
    code: '2026/2027', periodStart: '2026-10-01', periodEnd: '2027-09-30', annualFeeRoundId: id(901) });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const round = created.data.id;
  assert.equal((await call(f, 104, `/api/finance/rounds/${round}/open`, 'POST', { expectedVersion: 1 })).status, 200);
  const budget = await call(f, 104, '/api/finance/budget-lines', 'POST', { roundId: round, code: '2', name: 'Material', nature: 'EXPENSE' });
  assert.equal(budget.status, 201, JSON.stringify(budget.data));
  const line = budget.data.id;
  const bank = (await call(f, 104, '/api/finance/positions', 'POST', { kind: 'BANK', name: 'Compte corrent' })).data.id;
  const card = (await call(f, 104, '/api/finance/positions', 'POST', { kind: 'CARD', name: 'Targeta preparada' })).data.id;
  const person = async (name, userId = null) => {
    const response = await call(f, 104, '/api/finance/counterparties', 'POST', { kind: 'PERSON', displayName: name, ...(userId ? { userId } : {}) });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return response.data.id;
  };
  const movement = async (amountCents, positionId = bank) => {
    const response = await call(f, 104, '/api/finance/movements', 'POST', { positionId, operationDate: '2026-11-12', amountCents, label: 'Transferència demo' });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return response.data.id;
  };
  const advance = async (recipientId, amountCents, actor = 104, receipt = evidence) => call(f, actor, '/api/finance/expenses', 'POST', {
    roundId: round, expenseDate: '2026-11-10', concept: 'Material sintètic', totalCents: amountCents,
    paymentMethod: 'ADVANCED', advancedById: recipientId, lines: [{ budgetLineId: line, amountCents }],
    recognise: true, ...(receipt ? { evidence: receipt } : {}) });
  const reimbursements = async recipientId => (await call(f, 104,
    `/api/finance/reimbursements?roundId=${round}${recipientId ? `&recipientId=${recipientId}` : ''}`)).data.reimbursements;
  const allocate = (movementId, expectedVersion, allocations, reason) => call(f, 104, `/api/finance/movements/${movementId}/allocations`, 'POST', {
    expectedVersion, allocations, ...(reason ? { reason } : {}) });
  return { f, round, line, bank, card, person, movement, advance, reimbursements, allocate };
}

test('expense receipt is mandatory, validated, private and audited before recognition', async () => {
  const s = await setup();
  try {
    const group = { roundId: s.round, expenseDate: '2026-11-10', concept: 'Compra demo', totalCents: 2000,
      paymentMethod: 'BANK', lines: [{ budgetLineId: s.line, amountCents: 2000 }] };
    assert.equal((await call(s.f, 104, '/api/finance/expenses', 'POST', { ...group, recognise: true })).data.error, 'expense_evidence_required');
    const proposed = await call(s.f, 104, '/api/finance/expenses', 'POST', group);
    assert.equal(proposed.status, 201);
    assert.equal((await call(s.f, 104, `/api/finance/expenses/${proposed.data.id}/recognise`, 'POST', { expectedVersion: 1 })).data.error,
      'expense_evidence_required');
    const bad = { ...evidence, mime: 'image/png' };
    assert.equal((await call(s.f, 104, `/api/finance/expenses/${proposed.data.id}/evidence`, 'POST', bad)).status, 400);
    const large = Buffer.alloc(4 * 1024 * 1024 + 1, 65); large.set(Buffer.from('%PDF-synthetic'), 0);
    assert.equal((await call(s.f, 104, `/api/finance/expenses/${proposed.data.id}/evidence`, 'POST',
      { ...evidence, dataBase64: large.toString('base64') })).status, 413);
    const uploaded = await call(s.f, 104, `/api/finance/expenses/${proposed.data.id}/evidence`, 'POST', evidence);
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.data));
    assert.equal((await call(s.f, 107, `/api/finance/expense-evidence/${uploaded.data.id}?mode=view`)).status, 403);
    const viewed = await call(s.f, 104, `/api/finance/expense-evidence/${uploaded.data.id}?mode=view`);
    assert.equal(viewed.status, 200);
    assert.equal(viewed.headers.get('content-disposition'), 'inline');
    const downloaded = await call(s.f, 104, `/api/finance/expense-evidence/${uploaded.data.id}?mode=download`);
    assert.equal(downloaded.status, 200);
    assert.match(downloaded.headers.get('content-disposition'), /^attachment;/);
    const objectKey = s.f.sql.prepare('SELECT object_key FROM finance_expense_evidence WHERE id=?').get(uploaded.data.id).object_key;
    await s.f.storage.delete(objectKey);
    assert.equal((await call(s.f, 104, `/api/finance/expenses/${proposed.data.id}/recognise`, 'POST', { expectedVersion: 1 })).data.error,
      'expense_evidence_required', 'metadata without the stored R2 object cannot authorize recognition');
    await s.f.storage.put(objectKey, Buffer.from(evidence.dataBase64, 'base64'));
    assert.equal((await call(s.f, 104, `/api/finance/expenses/${proposed.data.id}/recognise`, 'POST', { expectedVersion: 1 })).status, 200);
    assert.equal((await call(s.f, 107, `/api/finance/expenses/${proposed.data.id}/evidence`, 'POST', evidence)).status, 403);
    assert.equal((await call(s.f, 104, `/api/finance/expenses/${proposed.data.id}/evidence`, 'POST', evidence)).status, 201,
      'a recognised expense can retain more than one private receipt');
    assert.equal(s.f.sql.prepare('SELECT count(*) AS n FROM finance_expense_evidence WHERE expense_id=?').get(proposed.data.id).n, 2);
    assert.equal(s.f.sql.prepare("SELECT count(*) AS n FROM audit_event WHERE action='EXPENSE_EVIDENCE_VIEWED'").get().n, 1);
    assert.equal(s.f.sql.prepare("SELECT count(*) AS n FROM audit_event WHERE action='EXPENSE_EVIDENCE_DOWNLOADED'").get().n, 1);
  } finally { s.f.close(); }
});

test('failed D1 persistence compensates the earlier R2 upload', async () => {
  const objects = new Map();
  const storage = { async put(key, bytes) { objects.set(key, bytes); }, async delete(key) { objects.delete(key); } };
  const item = { objectKey: 'opaque/test-key', bytes: Buffer.from('synthetic') };
  const db = { async batch() { throw new Error('D1 rejected transaction'); } };
  await assert.rejects(commitWithEvidence(db, storage, item, [{}]), /D1 rejected transaction/);
  assert.equal(objects.size, 0);
});

test('advanced expenses create approved liabilities; aggregate and partial BANK allocations count economics once', async () => {
  const s = await setup();
  try {
    const person = await s.person('Scouter Demo (fictici)');
    const other = await s.person('Altra Persona Demo (fictici)');
    const created = [];
    for (const amount of [2000, 3500, 1500]) {
      const response = await s.advance(person, amount);
      assert.equal(response.status, 201, JSON.stringify(response.data));
      created.push(response.data);
    }
    const outsider = await s.advance(other, 1000);
    assert.equal(outsider.status, 201);
    const rows = await s.reimbursements(person);
    assert.deepEqual(rows.map(row => row.amountCents).sort((a, b) => a - b), [1500, 2000, 3500]);
    assert.ok(rows.every(row => row.status === 'APPROVED' && row.paymentState === 'PENDING'));
    const bank = await s.movement(-7000);
    const allocations = created.map((entry, index) => ({ kind: 'REIMBURSEMENT_SETTLEMENT',
      amountCents: [2000, 3500, 1500][index], reimbursementId: entry.reimbursementId }));
    assert.equal((await s.allocate(bank, 0, allocations)).status, 200);
    const settledAudit = s.f.sql.prepare("SELECT metadata_json FROM audit_event WHERE action='REIMBURSEMENT_SETTLED' AND resource_id=?")
      .get(created[0].reimbursementId);
    assert.deepEqual(JSON.parse(settledAudit.metadata_json), { amountCents: 2000 });
    assert.ok((await s.reimbursements(person)).every(row => row.paymentState === 'PAID' && row.outstandingCents === 0));
    assert.equal((await call(s.f, 104, `/api/finance/expenses?roundId=${s.round}&outstanding=1`)).data.expenses.length, 1);
    const economics = (await call(s.f, 104, `/api/finance/rounds/${s.round}`)).data.economics;
    assert.equal(economics.expenseGrossCents, 8000, 'the transfer is settlement, not a second expense');
    assert.equal((await s.allocate(bank, 1, [...allocations, { kind: 'REIMBURSEMENT_SETTLEMENT', amountCents: 1,
      reimbursementId: outsider.data.reimbursementId }])).status, 409, 'mixed recipients cannot share one bank payment');
    assert.equal((await s.allocate(bank, 1, allocations)).status, 200, 'revision preserves current payment without overcounting');
    assert.equal((await s.allocate(bank, 2, [], 'Conciliació assignada al moviment erroni')).status, 200, 'removal reverses operational paid status');
    const partial = await s.movement(-3000);
    assert.equal((await s.allocate(partial, 0, [{ ...allocations[1], amountCents: 3000 }])).status, 200);
    assert.equal((await s.reimbursements(person)).find(row => row.id === created[1].reimbursementId).paymentState, 'PARTIAL');
    const final = await s.movement(-500);
    assert.equal((await s.allocate(final, 0, [{ ...allocations[1], amountCents: 500 }])).status, 200);
    assert.equal((await s.reimbursements(person)).find(row => row.id === created[1].reimbursementId).paymentState, 'PAID');
    const excess = await s.movement(-100);
    assert.equal((await s.allocate(excess, 0, [{ ...allocations[1], amountCents: 100 }])).status, 409);
    const wrongWay = await s.movement(100);
    assert.equal((await s.allocate(wrongWay, 0, [{ ...allocations[0], amountCents: 100 }])).status, 409);
    const wrongPosition = await s.movement(-100, s.card);
    assert.equal((await s.allocate(wrongPosition, 0, [{ ...allocations[0], amountCents: 100 }])).status, 409);
    assert.equal(s.f.sql.prepare("SELECT count(*) AS n FROM audit_event WHERE action='REIMBURSEMENT_SETTLED'").get().n, 5);
    assert.equal(s.f.sql.prepare("SELECT count(*) AS n FROM audit_event WHERE action='REIMBURSEMENT_SETTLEMENT_REVISED'").get().n, 6,
      'revision and removal each leave an audited event per affected liability');
  } finally { s.f.close(); }
});

test('own-beneficiary recognition needs the narrow explicit grant and emits a dedicated audit event', async () => {
  const s = await setup();
  try {
    assert.equal(s.f.sql.prepare("SELECT count(*) AS n FROM user_permission_grant WHERE user_id=? AND permission_code='finance.reimbursement.self_approve' AND revoked_at IS NULL")
      .get(id(104)).n, 1, 'migration and seed produce one explicit Treasury grant');
    const self = await s.person('Tresorera Demo (fictici)', id(104));
    const noGrant = await s.person('Coordinadora Demo (fictici)', id(101));
    assert.throws(() => s.f.sql.prepare(`INSERT INTO finance_expense(id,round_id,expense_date,total_cents,payment_method,
      advanced_by_id,created_by,created_at,updated_at,self_approval_exception) VALUES(?,?,?,?,?,?,?,?,?,1)`)
      .run(id(9901), s.round, '2026-11-10', 100, 'ADVANCED', self, id(104), 1, 1), /invalid_self_approval_exception/,
    'the structural exception cannot be smuggled into a new proposed expense');
    assert.equal((await s.advance(noGrant, 1200, 101)).data.error, 'self_approval');
    const approved = await s.advance(self, 1400, 104);
    assert.equal(approved.status, 201, JSON.stringify(approved.data));
    const row = s.f.sql.prepare('SELECT self_approval_exception FROM finance_reimbursement WHERE id=?').get(approved.data.reimbursementId);
    assert.equal(row.self_approval_exception, 1);
    const selfAudit = s.f.sql.prepare("SELECT metadata_json FROM audit_event WHERE action='REIMBURSEMENT_SELF_APPROVED'").get();
    assert.deepEqual(JSON.parse(selfAudit.metadata_json), { amountCents: 1400 });
    s.f.sql.prepare("DELETE FROM user_permission_grant WHERE user_id=? AND permission_code='finance.reimbursement.self_approve'").run(id(104));
    assert.equal((await s.advance(self, 500, 104)).data.error, 'self_approval',
      'holding the Treasury role and ordinary expense authority does not silently grant the exception');
    assert.equal((await call(s.f, 107, `/api/finance/reimbursements?roundId=${s.round}`)).status, 403);
  } finally { s.f.close(); }
});

test('movement classification alone cannot settle or revise private reimbursement liabilities', async () => {
  const s = await setup();
  try {
    const person = await s.person('Scouter Privat Demo (fictici)');
    const expense = await s.advance(person, 1100);
    assert.equal(expense.status, 201);
    const bank = await s.movement(-1100);
    const allocation = { kind: 'REIMBURSEMENT_SETTLEMENT', reimbursementId: expense.data.reimbursementId, amountCents: 1100 };
    s.f.sql.prepare("DELETE FROM user_permission_grant WHERE user_id=? AND permission_code='finance.expense.read'").run(id(101));
    assert.equal((await call(s.f, 101, `/api/finance/movements/${bank}/allocations`, 'POST',
      { expectedVersion: 0, allocations: [allocation] })).status, 403);
    assert.equal((await s.allocate(bank, 0, [allocation])).status, 200);
    const detail = await call(s.f, 101, `/api/finance/movements/${bank}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.data.allocations[0].reimbursement, null);
    assert.equal(detail.data.allocations[0].reimbursementId, null);
    const listing = await call(s.f, 101, '/api/finance/movements');
    const listed = listing.data.movements.find(row => row.id === bank);
    assert.equal(listed.classification[0].reimbursement, null);
    assert.equal(listed.classification[0].reimbursementId, null);
    assert.equal((await call(s.f, 101, `/api/finance/movements/${bank}/allocations`, 'POST',
      { expectedVersion: 1, allocations: [] })).status, 403, 'classification cannot erase a private settlement either');
    assert.equal((await s.reimbursements(person))[0].paymentState, 'PAID');
  } finally { s.f.close(); }
});

test('D1 rejects unapproved, unrecognised, oversized and revised over-settlement independently of the UI', async () => {
  const s = await setup();
  try {
    const person = await s.person('Beneficiària Demo (fictici)');
    const proposed = await call(s.f, 104, '/api/finance/expenses', 'POST', { roundId: s.round,
      expenseDate: '2026-11-10', concept: 'Proposta demo', totalCents: 500, paymentMethod: 'ADVANCED', advancedById: person,
      lines: [{ budgetLineId: s.line, amountCents: 500 }] });
    assert.equal(proposed.status, 201);
    assert.throws(() => s.f.sql.prepare(`INSERT INTO finance_reimbursement(id,expense_id,recipient_id,amount_cents,created_by,created_at)
      VALUES(?,?,?,?,?,?)`).run(id(9910), proposed.data.id, person, 500, id(104), 1), /invalid_reimbursement/,
    'a proposed expense cannot carry an approved settlement target');
    assert.throws(() => s.f.sql.prepare(`UPDATE finance_expense SET status='RECOGNISED',recognized_by=?,recognized_at=?,version=2 WHERE id=?`)
      .run(id(104), 1, proposed.data.id), /expense_evidence_required/);
    assert.equal((await call(s.f, 104, `/api/finance/expenses/${proposed.data.id}/evidence`, 'POST', evidence)).status, 201);
    s.f.sql.prepare(`UPDATE finance_expense SET status='RECOGNISED',recognized_by=?,recognized_at=?,version=2 WHERE id=?`)
      .run(id(104), 1, proposed.data.id);
    assert.throws(() => s.f.sql.prepare(`INSERT INTO finance_reimbursement(id,expense_id,recipient_id,amount_cents,created_by,created_at)
      VALUES(?,?,?,?,?,?)`).run(id(9911), proposed.data.id, person, 501, id(104), 1), /invalid_reimbursement/);
    s.f.sql.prepare(`INSERT INTO finance_reimbursement(id,expense_id,recipient_id,amount_cents,created_by,created_at)
      VALUES(?,?,?,?,?,?)`).run(id(9912), proposed.data.id, person, 500, id(104), 1);
    const pendingMovement = await s.movement(-500);
    assert.equal((await s.allocate(pendingMovement, 0, [{ kind: 'REIMBURSEMENT_SETTLEMENT',
      reimbursementId: id(9912), amountCents: 500 }])).status, 409, 'service denies a pending liability');
    const approved = await s.advance(person, 2000);
    assert.equal(approved.status, 201);
    assert.throws(() => s.f.sql.prepare('UPDATE finance_reimbursement SET amount_cents=3000 WHERE id=?')
      .run(approved.data.reimbursementId), /invalid_reimbursement/);
    assert.throws(() => s.f.sql.prepare("UPDATE finance_expense SET status='VOID',voided_by=?,voided_at=? WHERE id=?")
      .run(id(104), 1, approved.data.id), /expense_correction_reason_required/);
    const first = await s.movement(-1500);
    assert.equal((await s.allocate(first, 0, [{ kind: 'REIMBURSEMENT_SETTLEMENT',
      reimbursementId: approved.data.reimbursementId, amountCents: 1500 }])).status, 200);
    const second = await s.movement(-1000);
    assert.throws(() => {
      s.f.sql.exec('BEGIN');
      try {
        s.f.sql.prepare('UPDATE finance_movement SET allocation_version=1 WHERE id=?').run(second);
        s.f.sql.prepare(`INSERT INTO finance_allocation(id,movement_id,set_version,kind,amount_cents,reimbursement_id,created_by,created_at)
          VALUES(?,?,1,'REIMBURSEMENT_SETTLEMENT',?,?,?,?)`).run(id(9913), second, 1000, approved.data.reimbursementId, id(104), 1);
      } finally { s.f.sql.exec('ROLLBACK'); }
    }, /invalid_reimbursement_settlement/);
    assert.equal((await s.reimbursements(person)).find(row => row.id === approved.data.reimbursementId).outstandingCents, 500);
    assert.equal((await s.allocate(second, 0, [{ kind: 'REIMBURSEMENT_SETTLEMENT',
      reimbursementId: approved.data.reimbursementId, amountCents: 500 }])).status, 200);
    assert.equal((await s.allocate(first, 1, [{ kind: 'REIMBURSEMENT_SETTLEMENT',
      reimbursementId: approved.data.reimbursementId, amountCents: 1600 }], 'Import incorrecte')).status, 409,
    'a versioned correction cannot over-settle a debt already paid by another movement');
    assert.throws(() => {
      s.f.sql.exec('BEGIN');
      try {
        s.f.sql.prepare('UPDATE finance_movement SET allocation_version=2 WHERE id=?').run(first);
        s.f.sql.prepare(`INSERT INTO finance_allocation(id,movement_id,set_version,kind,amount_cents,reimbursement_id,created_by,created_at)
          VALUES(?,?,2,'REIMBURSEMENT_SETTLEMENT',?,?,?,?)`).run(id(9914), first, 1600, approved.data.reimbursementId, id(104), 1);
      } finally { s.f.sql.exec('ROLLBACK'); }
    }, /invalid_reimbursement_settlement/);
  } finally { s.f.close(); }
});
