// FASE 3.5I — Cuaderno 43 parser: fixed-width records, exact cents, debit/credit, dates, concept complements,
// legacy encodings and every structural check (totals, balances, sequence, lengths, truncation). Synthetic files only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { C43Error, C43_COMMON_CONCEPTS, accountMask, decodeC43, parseC43 } from '../gestio/src/domains/finance/c43-parser.js';
import { buildC43, demoStatement, latin1 } from '../gestio/demo/c43.js';

const base = { start: '2026-10-01', end: '2026-10-31', openingCents: 100000, movements: [
  { date: '2026-10-02', valueDate: '2026-10-03', amountCents: 10000, common: '04', own: '012', branch: '0420', document: '77', ref1: '000123456789', ref2: 'REF-B',
    concepts: ['TRANSFERENCIA DE MARC FERRER (FICTICI)', 'QUOTA ANUAL 26-27'] },
  { date: '2026-10-05', amountCents: -2550, common: '03', own: '005', concepts: ['RECIBO SUMINISTROS'] }
] };
const errorOf = fn => { try { fn(); } catch (error) { assert.ok(error instanceof C43Error, String(error)); return { code: error.code, line: error.line }; } assert.fail('expected C43Error'); };
const parse = text => parseC43(text);

test('fields, signed exact cents, dates and concept complements are read at their fixed positions', () => {
  const result = parse(buildC43(base));
  assert.equal(result.accounts.length, 1);
  const [account] = result.accounts;
  assert.deepEqual({ bank: account.bankCode, branch: account.branchCode, mask: accountMask(account.account), start: account.startDate, end: account.endDate,
    opening: account.openingCents, closing: account.closingCents, currency: account.currency },
    { bank: '2100', branch: '0001', mask: '2345', start: '2026-10-01', end: '2026-10-31', opening: 100000, closing: 107450, currency: 'EUR' });
  const [credit, debit] = account.movements;
  assert.deepEqual({ ...credit, line: undefined }, { line: undefined, originBranch: '0420', operationDate: '2026-10-02', valueDate: '2026-10-03',
    commonConcept: '04', ownConcept: '012', amountCents: 10000, documentNumber: '0000000077', reference1: '000123456789', reference2: 'REF-B',
    concepts: ['TRANSFERENCIA DE MARC FERRER (FICTICI)', 'QUOTA ANUAL 26-27'], equivalence: null,
    description: 'TRANSFERENCIA DE MARC FERRER (FICTICI) QUOTA ANUAL 26-27' });
  assert.equal(debit.amountCents, -2550, 'debit (1) is negative, in cents, never a float');
  assert.deepEqual(account.totals, { debitCount: 1, debitCents: 2550, creditCount: 1, creditCents: 10000 });
  assert.equal(C43_COMMON_CONCEPTS['04'], 'Transferència');
  assert.deepEqual(result.warnings, []);
});

test('a concept longer than 38 characters spans both halves; up to five complements per movement', () => {
  const long = 'BIZUM DE FAMILIA BELLVER (FICTICIA) QUOTA ANUAL GERMANS ABRIL I PAU';
  const result = parse(buildC43({ ...base, movements: [{ date: '2026-10-03', amountCents: 15000, concepts: [long, 'A', 'B', 'C', 'D'] }] }));
  assert.equal(result.accounts[0].movements[0].concepts[0], long);
  assert.equal(result.accounts[0].movements[0].concepts.length, 5);
  const six = buildC43({ ...base, movements: [{ date: '2026-10-03', amountCents: 1, concepts: ['A'] }] }).split('\r\n');
  six.splice(2, 0, six[2]);
  assert.equal(errorOf(() => parse(six.join('\r\n'))).code, 'c43_complement_sequence', 'complement codes must follow 01, 02…');
});

test('legacy encodings keep accents and ñ; UTF-8 and the choice of encoding are honoured', () => {
  const text = buildC43({ ...base, movements: [{ date: '2026-10-02', amountCents: 500, concepts: ['ROBA I PANOLETES ÑANDÚ CAMPAÑA ÀÉÍÒÚ ç'] }] });
  const fromLatin1 = decodeC43(latin1(text));
  assert.equal(fromLatin1.encoding, 'windows-1252');
  assert.match(parse(fromLatin1.text).accounts[0].movements[0].description, /ÑANDÚ CAMPAÑA ÀÉÍÒÚ ç/);
  const cp850 = Uint8Array.from(latin1(text).map(byte => ({ 0xd1: 0xa5, 0xda: 0xe9, 0xc0: 0xb7, 0xc9: 0x90, 0xcd: 0xd6, 0xd2: 0xe3, 0xe7: 0x87 })[byte] ?? byte));
  const fromCp850 = decodeC43(cp850);
  assert.equal(fromCp850.encoding, 'cp850', 'the DOS code page is detected by plausibility');
  assert.match(parse(fromCp850.text).accounts[0].movements[0].description, /ÑANDÚ CAMPAÑA ÀÉÍÒÚ ç/);
  assert.equal(decodeC43(new TextEncoder().encode(text)).encoding, 'utf-8');
  assert.equal(decodeC43(latin1(text), 'cp850').encoding, 'cp850', 'an explicit choice wins');
  assert.equal(decodeC43(latin1(buildC43(base))).encoding, 'ascii');
  assert.equal(errorOf(() => decodeC43(new Uint8Array(3 * 1024 * 1024))).code, 'c43_too_large');
});

test('totals, balance and record count are verified; any inconsistency rejects the whole file', () => {
  const lines = buildC43(base).split('\r\n');
  const tamper = (index, from, value) => { const copy = [...lines]; copy[index] = copy[index].slice(0, from) + value + copy[index].slice(from + value.length); return copy.join('\r\n'); };
  const closing = lines.findIndex(line => line.startsWith('33'));
  assert.equal(errorOf(() => parse(tamper(closing, 20, '00002'))).code, 'c43_totals_mismatch', 'debit count');
  assert.equal(errorOf(() => parse(tamper(closing, 59, '00000000107451'))).code, 'c43_balance_mismatch');
  assert.equal(errorOf(() => parse(tamper(1, 28, '00000000010001'))).code, 'c43_totals_mismatch', 'a changed amount no longer adds up');
  assert.equal(errorOf(() => parse(tamper(lines.length - 2, 20, '000099'))).code, 'c43_record_count');
  assert.doesNotThrow(() => parse(buildC43({ ...base, endCountIncludesSelf: true })), 'banks that count the end record are accepted');
  assert.equal(errorOf(() => parse(tamper(closing, 10, '9999999999'))).code, 'c43_account_mismatch');
});

test('truncated, malformed or unknown content is refused with the line number', () => {
  const lines = buildC43(base).split('\r\n');
  assert.equal(errorOf(() => parse(lines.slice(0, 4).join('\r\n'))).code, 'c43_truncated', 'no account closing record');
  assert.deepEqual(errorOf(() => parse(lines.map((line, i) => i === 1 ? line + 'X' : line).join('\r\n'))), { code: 'c43_line_length', line: 2 });
  assert.deepEqual(errorOf(() => parse(lines.map((line, i) => i === 1 ? '99' + line.slice(2) : line).join('\r\n'))), { code: 'c43_unknown_record', line: 2 });
  assert.equal(errorOf(() => parse(lines.map((line, i) => i === 1 ? line.slice(0, 10) + '261302' + line.slice(16) : line).join('\r\n'))).code, 'c43_invalid_date');
  assert.equal(errorOf(() => parse(lines.map((line, i) => i === 1 ? line.slice(0, 27) + '3' + line.slice(28) : line).join('\r\n'))).code, 'c43_invalid_sign');
  assert.equal(errorOf(() => parse(lines.map((line, i) => i === 1 ? line.slice(0, 30) + '12,5' + line.slice(34) : line).join('\r\n'))).code, 'c43_invalid_amount');
  assert.equal(errorOf(() => parse([lines[1], ...lines].join('\r\n'))).code, 'c43_sequence', 'a movement before any account header');
  assert.equal(errorOf(() => parse(buildC43({ ...base, movements: [] }).replace('978', '840'))).code, 'c43_currency');
  assert.equal(errorOf(() => parse('')).code, 'c43_empty');
  assert.equal(errorOf(() => parse(buildC43(base) + 'trailing text after the end')).code, 'c43_after_end');
  assert.equal(errorOf(() => parse(lines.map((line, i) => i === 1 ? line.slice(0, 40) + '\t' + line.slice(41) : line).join('\r\n'))).code, 'c43_control_character');
});

test('trailing blanks trimmed by the bank, LF endings, a final Ctrl-Z and a missing end record are tolerated', () => {
  const trimmed = buildC43(base).split('\r\n').map(line => line.trimEnd()).join('\n') + '\u001a';
  assert.equal(parse(trimmed).accounts[0].movements.length, 2);
  const noEnd = parse(buildC43({ ...base, endRecord: false }));
  assert.deepEqual(noEnd.warnings, [{ code: 'c43_no_end_record', line: null }]);
  const outside = parse(buildC43({ ...base, movements: [{ date: '2026-11-02', amountCents: 100 }] }));
  assert.deepEqual(outside.warnings, [{ code: 'c43_date_outside_period', line: 2 }]);
  assert.equal(parse(demoStatement()).accounts[0].movements.length, 9);
});
