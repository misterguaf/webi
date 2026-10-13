// FASE 3.5I — Cuaderno 43 import on the existing Treasury model: preview without writing, atomic confirm,
// per-movement duplicate protection (re-import, overlapping statements, same-day equal amounts), concurrency,
// no partial writes, synthetic-only data, permissions and minimised listings. Synthetic statements only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, id } from './helpers/gestio-sqlite.js';
import { buildC43, latin1 } from '../gestio/demo/c43.js';
import { confirmC43Import, previewC43Import } from '../gestio/src/domains/finance/c43-import.js';

const ROUND = { code: '2026/2027', periodStart: '2026-10-01', periodEnd: '2027-09-30', annualFeeRoundId: id(901) };
const b64 = text => Buffer.from(latin1(text)).toString('base64');
const october = (end = '2026-10-31', extra = []) => buildC43({ start: '2026-10-01', end, openingCents: 500000, movements: [
  { date: '2026-10-02', amountCents: 10000, common: '04', ref1: '000000000101', concepts: ['TRANSFERENCIA DE MARC FERRER (FICTICI)', 'QUOTA ANUAL'] },
  { date: '2026-10-02', amountCents: 10000, common: '04', ref1: '000000000102', concepts: ['TRANSFERENCIA DE LAIA PONS (FICTICIA)', 'QUOTA ANUAL'] },
  { date: '2026-10-09', amountCents: -48000, common: '03', ref1: '000000000103', concepts: ['RECIBO AUTOCARES FICTICIOS SL', 'AUTOBUS CAMPAMENT NADAL'] },
  ...(end >= '2026-10-31' ? [
    { date: '2026-10-20', amountCents: 32000, common: '02', ref1: '000000000104', concepts: ['INGRESO LOTERIA NADAL'] },
    { date: '2026-10-28', amountCents: -1500, common: '17', ref1: '000000000105', concepts: ['COMISION MANTENIMIENTO'] }] : []),
  ...extra] });

async function setup() {
  const f = fixture();
  for (const user of [101, 102, 104, 105, 107]) await f.login(user);
  const call = (user, path, method = 'GET', body) => f.request(user, path, { method, body });
  const round = (await call(104, '/api/finance/rounds', 'POST', ROUND)).data.id;
  assert.equal((await call(104, `/api/finance/rounds/${round}/open`, 'POST', { expectedVersion: 1 })).status, 200);
  const bank = (await call(104, '/api/finance/positions', 'POST', { kind: 'BANK', name: 'Compte corrent', maskedReference: '2345' })).data.id;
  const preview = (text, user = 104, extra = {}) => call(user, '/api/finance/bank-statements/preview', 'POST', { filename: 'C43.txt', contentBase64: b64(text), ...extra });
  const confirm = async (text, user = 104, extra = {}) => {
    const hash = (await preview(text, user, extra)).data.file?.hash ?? '0'.repeat(64);
    return call(user, '/api/finance/bank-statements', 'POST', { filename: 'C43.txt', contentBase64: b64(text), expectedFileHash: hash, ...extra });
  };
  const count = (table, where = '1=1') => f.sql.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).get().n;
  // The original bank text is an explicit, audited grant (never part of a role): Treasury gets it in these tests.
  const grantReveal = user => f.sql.prepare(`INSERT INTO user_permission_grant(id,user_id,permission_code,valid_from,granted_by,justification)
    VALUES(?,?,'finance.bank_description.reveal',0,?,'SYNTHETIC_PHASE_2A')`).run(crypto.randomUUID(), id(user), id(101));
  return { f, call, round, bank, preview, confirm, count, grantReveal };
}

test('preview analyses the statement without writing; confirm stores only the movements, minimised in listings', async () => {
  const s = await setup();
  try {
    const before = s.count('finance_movement');
    // Product decision: people authorised to consult bank movements (Treasury) read the concepts they classify.
    const preview = await s.preview(october());
    assert.equal(preview.status, 200, JSON.stringify(preview.data));
    const data = preview.data;
    assert.equal(data.ok, true);
    assert.deepEqual(data.counts, { detected: 5, new: 5, duplicates: 0, possibleDuplicates: 0, incidents: 0 });
    assert.deepEqual(data.statement, { accountMask: '2345', startDate: '2026-10-01', endDate: '2026-10-31', openingCents: 500000,
      closingCents: 500000 + 10000 + 10000 - 48000 + 32000 - 1500, debitCount: 2, creditCount: 3, movementCount: 5 });
    assert.equal(data.position.id, s.bank, 'the bank position is recognised by its last four digits');
    assert.equal(data.rows[0].concept, 'TRANSFERENCIA DE MARC FERRER (FICTICI) QUOTA ANUAL', 'Treasury may read bank concepts');
    assert.deepEqual(data.rows.map(row => row.round), Array(5).fill({ status: 'ONE', code: '2026/2027' }));
    assert.equal(s.count('finance_movement'), before, 'preview never writes movements');
    assert.equal(s.count('finance_import_batch'), 0);
    const audit = s.f.sql.prepare("SELECT metadata_json FROM audit_event WHERE action='BANK_IMPORT_PREVIEWED'").all();
    assert.deepEqual(audit.map(row => JSON.parse(row.metadata_json)), [{ count: 5 }]);

    const confirmed = await s.confirm(october());
    assert.equal(confirmed.status, 201, JSON.stringify(confirmed.data));
    assert.deepEqual(confirmed.data.counts, { detected: 5, new: 5, duplicates: 0, possibleDuplicates: 0, incidents: 0, created: 5, flagged: 0 });
    const batch = s.f.sql.prepare('SELECT * FROM finance_import_batch').get();
    assert.deepEqual([batch.source_format, batch.row_count, batch.created_count, batch.statement_start, batch.statement_end, batch.account_mask,
      batch.source_encoding, batch.opening_balance_cents], ['C43', 5, 5, '2026-10-01', '2026-10-31', '2345', 'ascii', 500000]);
    assert.equal(s.count('finance_movement_description'), 5);
    assert.deepEqual(s.f.sql.prepare('SELECT DISTINCT identity FROM finance_movement_bank_detail').all().map(row => row.identity), ['BANK_REFERENCE']);
    const listed = JSON.stringify((await s.call(104, '/api/finance/movements')).data.movements);
    assert.doesNotMatch(listed, /FERRER|PONS|AUTOCARES|LOTERIA|000000000101/, 'listings never show bank text or references');
    assert.match(listed, /Ingrés 2026-10-02 · Transferència/);
    const events = s.f.sql.prepare("SELECT action,metadata_json FROM audit_event WHERE action IN ('BANK_IMPORT_CREATED','MOVEMENT_IMPORTED')").all();
    assert.deepEqual(events.map(row => [row.action, JSON.parse(row.metadata_json)]), [['BANK_IMPORT_CREATED', { count: 5 }], ['MOVEMENT_IMPORTED', { count: 5 }]]);
    assert.doesNotMatch(JSON.stringify(s.f.sql.prepare('SELECT * FROM audit_event').all()), /FERRER|PONS|AUTOCARES|2100000102/, 'no bank text or account in audit');
    // Economic integrity: imported movements are pending, nothing is classified or recognised automatically.
    assert.equal(s.count('finance_allocation'), 0);
    assert.equal(s.count('finance_expense'), 0);
    assert.equal(s.count('finance_income'), 0);
  } finally { s.f.close(); }
});

test('re-importing the same file creates nothing; an overlapping statement adds only the new movements', async () => {
  const s = await setup();
  try {
    assert.equal((await s.confirm(october('2026-10-15'))).status, 201);
    assert.equal(s.count('finance_movement'), 3);
    const again = await s.preview(october('2026-10-15'));
    assert.equal(again.data.alreadyImported, true);
    assert.deepEqual(again.data.counts, { detected: 3, new: 0, duplicates: 3, possibleDuplicates: 0, incidents: 0 });
    assert.equal((await s.confirm(october('2026-10-15'))).status, 409, 'same file: duplicate_import');
    assert.equal(s.count('finance_movement'), 3);
    const month = await s.preview(october());
    assert.deepEqual(month.data.counts, { detected: 5, new: 2, duplicates: 3, possibleDuplicates: 0, incidents: 0 });
    assert.ok(month.data.rows.filter(row => row.status === 'DUPLICATE').every(row => row.duplicateOfId));
    const imported = await s.confirm(october());
    assert.equal(imported.status, 201);
    assert.deepEqual([imported.data.counts.created, imported.data.counts.duplicates], [2, 3]);
    assert.equal(s.count('finance_movement'), 5, 'the first fortnight is not duplicated');
    assert.equal(s.count('finance_movement', "amount_cents=10000 AND operation_date='2026-10-02'"), 2, 'two equal fees on the same day are two families');
  } finally { s.f.close(); }
});

test('without bank references the full row identifies a movement; equal rows keep their ordinal; near matches are flagged', async () => {
  const s = await setup();
  try {
    const noRefs = end => buildC43({ start: '2026-10-01', end, openingCents: 0, movements: [
      { date: '2026-10-03', amountCents: 5000, concepts: ['BIZUM PANOLETES'] }, { date: '2026-10-03', amountCents: 5000, concepts: ['BIZUM PANOLETES'] },
      ...(end === '2026-10-31' ? [{ date: '2026-10-21', amountCents: 700, concepts: ['BIZUM ROBA'] }] : [])] });
    assert.equal((await s.confirm(noRefs('2026-10-10'))).status, 201);
    assert.deepEqual(s.f.sql.prepare('SELECT DISTINCT identity FROM finance_movement_bank_detail').all().map(row => row.identity), ['ROW']);
    const later = await s.preview(noRefs('2026-10-31'));
    assert.deepEqual(later.data.counts, { detected: 3, new: 1, duplicates: 2, possibleDuplicates: 0, incidents: 0 }, 'identical rows are matched one to one');
    // A different movement with the same account, date and amount is imported, flagged for review, never dropped.
    const other = buildC43({ start: '2026-10-01', end: '2026-10-31', openingCents: 0, account: '0200012345',
      movements: [{ date: '2026-10-03', amountCents: 5000, ref1: '000000009999', concepts: ['BIZUM QUOTA ALTRA FAMILIA'] }] });
    const flagged = await s.preview(other);
    assert.deepEqual(flagged.data.counts, { detected: 1, new: 0, duplicates: 0, possibleDuplicates: 1, incidents: 1 });
    const done = await s.confirm(other);
    assert.deepEqual([done.data.counts.created, done.data.counts.flagged], [1, 1]);
    assert.equal(s.count('finance_movement', "review_flag='NEAR_MATCH'"), 1);
    assert.equal(s.f.sql.prepare("SELECT status FROM finance_import_batch WHERE flagged_count=1").get().status, 'PARTIALLY_FLAGGED');
    const list = (await s.call(104, '/api/finance/movements?status=duplicates')).data.movements;
    assert.equal(list.length, 1, 'the possible duplicate waits for human review');
  } finally { s.f.close(); }
});

test('concurrent confirmations of overlapping statements: the later one fails whole, nothing partial, a retry completes', async () => {
  const s = await setup();
  try {
    const first = october('2026-10-15'), second = october();
    const input = async text => ({ filename: 'C43.txt', contentBase64: b64(text), expectedFileHash: (await s.preview(text)).data.file.hash });
    const [inputA, inputB] = [await input(first), await input(second)];
    // Race: B analyses the account, then A commits before B writes its batch.
    let raced = false;
    const racingDb = { prepare: (...args) => s.f.db.prepare(...args), batch: async statements => {
      if (!raced) { raced = true; await confirmC43Import(s.f.db, s.f.context[104], crypto.randomUUID(), inputA); }
      return s.f.db.batch(statements);
    } };
    await assert.rejects(confirmC43Import(racingDb, s.f.context[104], crypto.randomUUID(), inputB),
      error => error.status === 409 && error.code === 'import_conflict');
    assert.equal(s.count('finance_movement'), 3, 'only A: B wrote nothing');
    assert.equal(s.count('finance_import_batch'), 1);
    assert.equal(s.count('finance_movement_bank_detail'), 3);
    const retry = await s.confirm(second);
    assert.deepEqual([retry.status, retry.data.counts.created, retry.data.counts.duplicates], [201, 2, 3]);
    assert.equal(s.count('finance_movement'), 5);
    assert.equal(typeof previewC43Import, 'function');
  } finally { s.f.close(); }
});

test('inconsistent, foreign or real statements are refused before anything is written', async () => {
  const s = await setup();
  try {
    const lines = october().split('\r\n');
    const closing = lines.findIndex(line => line.startsWith('33'));
    lines[closing] = lines[closing].slice(0, 59) + '00000000000001' + lines[closing].slice(73);
    const broken = lines.join('\r\n');
    const preview = await s.preview(broken);
    assert.deepEqual([preview.data.ok, preview.data.error], [false, { code: 'c43_balance_mismatch', line: closing + 1 }]);
    assert.equal((await s.call(104, '/api/finance/bank-statements', 'POST', { filename: 'C43.txt', contentBase64: b64(broken), expectedFileHash: '0'.repeat(64) })).status, 400);
    const real = buildC43({ start: '2026-10-01', end: '2026-10-31', openingCents: 0, holder: 'GRUP SCOUT PARPALLO', movements: [{ date: '2026-10-02', amountCents: 100 }] });
    assert.equal((await s.preview(real)).data.error.code, 'synthetic_bank_statement_required', 'DATA_MODE=SYNTHETIC_ONLY: a real statement never enters');
    assert.equal((await s.call(104, '/api/finance/bank-statements', 'POST', { filename: 'C43.txt', contentBase64: b64(real), expectedFileHash: '0'.repeat(64) })).status, 400);
    const changed = await s.call(104, '/api/finance/bank-statements', 'POST', { filename: 'C43.txt', contentBase64: b64(october()), expectedFileHash: 'a'.repeat(64) });
    assert.deepEqual([changed.status, changed.data.error], [409, 'c43_file_changed'], 'confirmation is bound to the previewed file');
    assert.equal((await s.preview('x'.repeat(80))).data.error.code, 'c43_unknown_record');
    assert.equal((await s.call(104, '/api/finance/bank-statements/preview', 'POST', { filename: '../C43.txt', contentBase64: b64(october()) })).status, 400);
    assert.equal(s.count('finance_movement'), 0);
    assert.equal(s.count('finance_import_batch'), 0);
  } finally { s.f.close(); }
});

test('position: chosen or recognised by its last digits; a wrong account or a non-bank position is refused', async () => {
  const s = await setup();
  try {
    const other = buildC43({ start: '2026-10-01', end: '2026-10-31', openingCents: 0, account: '0200019999', movements: [{ date: '2026-10-02', amountCents: 100 }] });
    const unknown = await s.preview(other);
    assert.equal(unknown.data.position, null);
    assert.deepEqual(unknown.data.positionChoices.map(choice => choice.id), [s.bank], 'no recognised account: Treasury chooses');
    assert.equal((await s.confirm(other)).data.error, 'c43_position_required');
    assert.equal((await s.preview(other, 104, { positionId: s.bank })).data.error, 'c43_account_mismatch', 'the masked digits of the chosen position must agree');
    const plain = (await s.call(104, '/api/finance/positions', 'POST', { kind: 'BANK', name: 'Compte sense dígits' })).data.id;
    assert.equal((await s.preview(other, 104, { positionId: plain })).data.position.id, plain);
    const cash = (await s.call(104, '/api/finance/positions', 'POST', { kind: 'CASH', name: 'Caixa' })).data.id;
    assert.equal((await s.preview(other, 104, { positionId: cash })).status, 400);
  } finally { s.f.close(); }
});

test('a statement spanning two rounds keeps real dates and shows the round of each movement, or none', async () => {
  const s = await setup();
  try {
    const statement = buildC43({ start: '2026-09-20', end: '2026-10-10', openingCents: 0, movements: [
      { date: '2026-09-25', amountCents: 100, ref1: '1' }, { date: '2026-10-05', amountCents: 200, ref1: '2' }] });
    const rows = (await s.preview(statement)).data.rows;
    assert.deepEqual(rows.map(row => [row.operationDate, row.round.status, row.round.code]),
      [['2026-09-25', 'NONE', null], ['2026-10-05', 'ONE', '2026/2027']]);
    assert.equal((await s.confirm(statement)).status, 201);
    assert.deepEqual(s.f.sql.prepare('SELECT operation_date FROM finance_movement ORDER BY operation_date').all().map(row => row.operation_date),
      ['2026-09-25', '2026-10-05'], 'movements keep the bank date; the round comes from their classification');
  } finally { s.f.close(); }
});

test('permissions: Treasury only (not coordinators, Secretaria or TECH_ADMIN); bank concepts only for authorised readers', async () => {
  const s = await setup();
  try {
    for (const user of [101, 102, 105, 107]) {
      assert.equal((await s.preview(october(), user)).status, 403, `user ${user}`);
      assert.equal((await s.call(user, '/api/finance/bank-statements', 'POST', { filename: 'C43.txt', contentBase64: b64(october()), expectedFileHash: '0'.repeat(64) })).status, 403);
    }
    const treasury = (await s.preview(october(), 104)).data;
    assert.deepEqual([treasury.ok, treasury.conceptsVisible], [true, true]);
    // A movement imported, then its concept: Treasury reads it (audited); section coordination and TECH_ADMIN never.
    assert.equal((await s.confirm(october())).status, 201);
    const movement = s.f.sql.prepare('SELECT id FROM finance_movement LIMIT 1').get().id;
    assert.equal((await s.call(104, `/api/finance/movements/${movement}/description`)).status, 200);
    assert.equal(s.count('audit_event', "action='BANK_DESCRIPTION_REVEALED'"), 1);
    for (const user of [102, 105, 107]) assert.equal((await s.call(user, `/api/finance/movements/${movement}/description`)).status, 403, `user ${user}`);
  } finally { s.f.close(); }
});
