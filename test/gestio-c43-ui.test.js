// FASE 3.5I — bank import UI: human copy for every statement error (with the line), filters and counts from the
// server's preview, result wording, suggestion payloads, and wiring (route, button only with the import capability,
// no automatic classification, no bank text in local storage).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as model from '../gestio/public/views/treasury/bank-import-model.js';

const source = file => readFileSync(join(import.meta.dirname, '..', 'gestio/public', file), 'utf8');
const parserCodes = [...readFileSync(join(import.meta.dirname, '..', 'gestio/src/domains/finance/c43-parser.js'), 'utf8').matchAll(/fail\('(c43_[a-z_]+)'/g)].map(match => match[1]);

test('every parser and import error has a sentence for the treasurer, with the line when known', () => {
  for (const code of new Set([...parserCodes, 'c43_multiple_accounts', 'synthetic_bank_statement_required', 'c43_amount_too_large', 'c43_position_required',
    'c43_file_changed', 'duplicate_import', 'import_conflict'])) {
    const copy = model.importErrorCopy(code);
    assert.doesNotMatch(copy, /_/, code);
    assert.notEqual(copy, model.importErrorCopy('unknown_code'), `${code} has its own copy`);
  }
  assert.equal(model.importErrorCopy({ code: 'c43_balance_mismatch', line: 57 }), 'Línia 57: El saldo final no quadra amb el saldo inicial i els moviments.');
  assert.match(model.importErrorCopy('synthetic_bank_statement_required'), /dades fictícies/);
});

test('filters, labels and result lines come from the server analysis', () => {
  const rows = [{ status: 'NEW', incidents: [] }, { status: 'DUPLICATE', incidents: [] }, { status: 'POSSIBLE_DUPLICATE', incidents: ['POSSIBLE_DUPLICATE'] }];
  assert.deepEqual(model.PREVIEW_FILTERS.map(item => model.filterRows(rows, item.value).length), [3, 1, 1, 1, 1]);
  assert.deepEqual(Object.values(model.ROW_STATUS).map(item => item.label), ['Nou', 'Ja importat', 'Possible duplicat']);
  assert.equal(model.roundLabel({ status: 'ONE', code: '2026/2027' }), 'Ronda 2026/2027');
  assert.equal(model.roundLabel({ status: 'NONE' }), 'Fora de cap ronda');
  assert.deepEqual(model.resultLines({ created: 5, duplicates: 3, flagged: 1 }), ['S’han importat 5 moviments nous.',
    '3 ja estaven a Gestió i no s’han tornat a afegir.', '1 queden marcats com a possibles duplicats per a revisar.',
    'Els moviments queden pendents de classificar: res s’ha classificat ni conciliat automàticament.']);
  assert.equal(model.toBase64(new Uint8Array([0x31, 0x31, 0xd1])), Buffer.from([0x31, 0x31, 0xd1]).toString('base64'));
  assert.deepEqual(model.matchAllocation({ type: 'FEE_PAYMENT', id: 'f', amountCents: 100 }), { kind: 'FEE_PAYMENT', feePaymentId: 'f', amountCents: 100 });
  assert.deepEqual(model.matchAllocation({ type: 'EXPENSE_SETTLEMENT', id: 'e', amountCents: 9 }), { kind: 'EXPENSE_SETTLEMENT', expenseId: 'e', amountCents: 9 });
});

test('wiring: Moviments › Importar extracte, preview then confirm, suggestions only confirmed by a person', () => {
  const view = source('views/treasury/bank-import.js'), movements = source('views/treasury/movements.js'), router = source('views/treasury.js');
  assert.match(router, /tab\.id === 'moviments' && id === 'importar'/);
  assert.match(movements, /ctx\.caps\(\)\.treasury\?\.importMovements \? h\('button'/, 'the import button follows the import capability');
  assert.ok(view.indexOf("'/api/finance/bank-statements/preview'") < view.indexOf("'/api/finance/bank-statements', { method: 'POST'"));
  assert.match(view, /expectedFileHash: preview\.file\.hash/, 'confirmation is bound to the previewed file');
  assert.match(movements, /\/suggestions`\)/);
  assert.match(movements, /confirmDialog\(\{ title, body, confirm: 'Confirma' \}\)/, 'every suggestion needs an explicit confirmation');
  assert.doesNotMatch(view + movements, /localStorage|sessionStorage|innerHTML/);
});
