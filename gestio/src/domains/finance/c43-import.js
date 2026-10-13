// FASE 3.5I — bank statement import in Cuaderno 43, on top of the existing import batches and immutable movements
// (TREASURY.md §7–§8). Two steps, both recomputed on the server from the file itself:
//   preview — parse, validate and classify each movement (new · duplicate · possible duplicate) without writing;
//   confirm — the same analysis again, then one atomic batch with the new movements only.
// Duplicates are detected per movement (never per file): the bank reference when the statement carries one,
// otherwise the full row with its ordinal among identical rows. A near match (same account, date and amount,
// different identity) is imported flagged for human review, never dropped. Nothing of the file is stored besides
// the movements: no copy of the statement, no public object, no personal data in logs or audit metadata.
import { synthetic } from '../../environment-policy.js';
import { AppError, validUuid } from '../../services/common.js';
import { allow, audit, commit, fail, keysOnly, notFound, uuid } from './shared.js';
import { canReadBankConcepts } from './movements.js';
import { C43Error, C43_COMMON_CONCEPTS, C43_ENCODINGS, C43_LIMITS, accountMask, decodeC43, parseC43 } from './c43-parser.js';

const encoder = new TextEncoder();
const hex = buffer => [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
const sha256 = async value => hex(await crypto.subtle.digest('SHA-256', typeof value === 'string' ? encoder.encode(value) : value));
// Same normalisation as the synthetic CSV import (matching only; the original text is kept apart, untouched).
const normalise = text => text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const MAX_MOVEMENT_CENTS = 100000000;
const blankReference = value => !value || /^0+$/.test(value);

/** Listing label: direction, date and the standard concept category. Never the bank text (names, minors). */
export const c43Label = (amountCents, date, commonConcept) =>
  `${amountCents > 0 ? 'Ingrés' : 'Càrrec'} ${date} · ${C43_COMMON_CONCEPTS[commonConcept] ?? 'Moviment bancari'}`.slice(0, 80);

function readInput(input, confirming) {
  const allowed = ['positionId', 'filename', 'contentBase64', 'encoding', ...(confirming ? ['expectedFileHash'] : [])];
  if (!keysOnly(input, allowed) || typeof input.filename !== 'string' || !input.filename.trim() || input.filename.length > 120 ||
      /[/\\\u0000-\u001f]/.test(input.filename) || typeof input.contentBase64 !== 'string' ||
      input.contentBase64.length > Math.ceil(C43_LIMITS.maxBytes * 4 / 3) + 8 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.contentBase64) ||
      input.contentBase64.length % 4 !== 0 || (input.positionId != null && !validUuid(input.positionId)) ||
      (input.encoding != null && !C43_ENCODINGS.includes(input.encoding)) ||
      (confirming && (typeof input.expectedFileHash !== 'string' || !/^[0-9a-f]{64}$/.test(input.expectedFileHash)))) fail('invalid_import');
  let bytes;
  try { bytes = Uint8Array.from(atob(input.contentBase64), char => char.charCodeAt(0)); } catch { fail('invalid_import'); }
  if (!bytes.length) fail('c43_empty');
  if (bytes.length > C43_LIMITS.maxBytes) throw new AppError(413, 'c43_too_large');
  return bytes;
}

/** Which own bank position the statement belongs to: the chosen one, or the only active bank with the same last digits. */
async function resolvePosition(db, positionId, mask) {
  if (positionId) {
    const position = await db.prepare("SELECT id,name,kind,status,masked_reference AS mask FROM finance_position WHERE id=?").bind(positionId).first();
    if (!position) throw notFound();
    if (position.kind !== 'BANK') fail('c43_position_not_bank');
    if (position.status !== 'ACTIVE') throw new AppError(409, 'position_inactive');
    if (position.mask && !mask.endsWith(position.mask)) throw new AppError(409, 'c43_account_mismatch');
    return { position, choices: [] };
  }
  const banks = (await db.prepare("SELECT id,name,masked_reference AS mask FROM finance_position WHERE kind='BANK' AND status='ACTIVE' ORDER BY name,id").all()).results;
  const matching = banks.filter(row => row.mask && mask.endsWith(row.mask));
  if (matching.length === 1) return { position: matching[0], choices: [] };
  return { position: null, choices: (matching.length ? matching : banks).map(row => ({ id: row.id, name: row.name, mask: row.mask ?? null })) };
}

/** Duplicate identity of each movement. The bank reference is used when present (unique per movement in practice);
 * otherwise the full row. The ordinal among identical identities keeps overlapping statements consistent. */
async function identities(positionId, movements) {
  const seen = new Map(), result = [];
  for (const item of movements) {
    const byReference = !blankReference(item.reference1);
    const canonical = byReference
      ? ['C43REF', positionId, item.operationDate, item.amountCents, item.commonConcept, item.reference1].join('|')
      : ['C43ROW', positionId, item.operationDate, item.valueDate, item.amountCents, item.commonConcept, item.ownConcept, item.originBranch,
        item.documentNumber, item.reference1, item.reference2, await sha256(normalise(item.description))].join('|');
    const ordinal = (seen.get(canonical) ?? 0) + 1; seen.set(canonical, ordinal);
    result.push({ fingerprint: await sha256(`${canonical}|${ordinal}`), identity: byReference ? 'BANK_REFERENCE' : 'ROW' });
  }
  return result;
}

/** Rounds whose period contains the date: one (a hint), none or several (to be decided by a person). */
function roundHint(rounds, date) {
  const matching = rounds.filter(round => round.periodStart <= date && date <= round.periodEnd);
  return matching.length === 1 ? { status: 'ONE', code: matching[0].code } : { status: matching.length ? 'MANY' : 'NONE', code: null };
}

/** @returns {Promise<any>} the analysis, or `{error}` for a statement that cannot be imported */
async function analyse(db, input, bytes) {
  let parsed, decoded;
  try {
    decoded = decodeC43(bytes, input.encoding ?? 'auto');
    parsed = parseC43(decoded.text);
  } catch (error) {
    if (error instanceof C43Error) return { error: { code: error.code, line: error.line } };
    throw error;
  }
  if (parsed.accounts.length !== 1) return { error: { code: 'c43_multiple_accounts', line: null } };
  const account = parsed.accounts[0];
  // DATA_MODE = SYNTHETIC_ONLY: a real statement is refused before anything is matched or stored.
  if (!synthetic.bankStatementHolder(account.holder)) return { error: { code: 'synthetic_bank_statement_required', line: account.headerLine } };
  const tooLarge = account.movements.find(item => Math.abs(item.amountCents) > MAX_MOVEMENT_CENTS);
  if (tooLarge) return { error: { code: 'c43_amount_too_large', line: tooLarge.line } };
  const mask = accountMask(account.account);
  const { position, choices } = await resolvePosition(db, input.positionId ?? null, mask);
  const fileHash = await sha256(bytes);
  const statement = { accountMask: mask, startDate: account.startDate, endDate: account.endDate, openingCents: account.openingCents,
    closingCents: account.closingCents, debitCount: account.totals.debitCount, creditCount: account.totals.creditCount,
    movementCount: account.movements.length };
  const base = { fileHash, encoding: decoded.encoding, statement, warnings: parsed.warnings, positionChoices: choices };
  if (!position) return { ...base, position: null, rows: [] };
  const ids = await identities(position.id, account.movements);
  const existing = (await db.prepare(`SELECT id,fingerprint,operation_date AS date,amount_cents AS amount,state FROM finance_movement
    WHERE position_id=? AND operation_date BETWEEN ? AND ?`).bind(position.id, account.movements.reduce((min, item) => item.operationDate < min ? item.operationDate : min, account.startDate),
    account.movements.reduce((max, item) => item.operationDate > max ? item.operationDate : max, account.endDate)).all()).results;
  const byFingerprint = new Map(existing.map(row => [row.fingerprint, row]));
  const near = new Set(existing.filter(row => row.state === 'ACTIVE').map(row => `${row.date}|${row.amount}`));
  const rounds = (await db.prepare('SELECT code,period_start AS periodStart,period_end AS periodEnd FROM finance_round').all()).results;
  const outside = new Set(parsed.warnings.filter(item => item.code === 'c43_date_outside_period').map(item => item.line));
  const rows = account.movements.map((item, index) => {
    const duplicate = byFingerprint.get(ids[index].fingerprint);
    const status = duplicate ? 'DUPLICATE' : near.has(`${item.operationDate}|${item.amountCents}`) ? 'POSSIBLE_DUPLICATE' : 'NEW';
    const incidents = [...(outside.has(item.line) ? ['DATE_OUTSIDE_PERIOD'] : []), ...(item.equivalence ? ['FOREIGN_CURRENCY'] : []),
      ...(status === 'POSSIBLE_DUPLICATE' ? ['POSSIBLE_DUPLICATE'] : [])];
    return { ...item, ...ids[index], row: index + 1, status, duplicateOfId: duplicate?.id ?? null, incidents,
      round: roundHint(rounds, item.operationDate), label: c43Label(item.amountCents, item.operationDate, item.commonConcept) };
  });
  const alreadyImported = !!await db.prepare('SELECT 1 FROM finance_import_batch WHERE file_sha256=?').bind(fileHash).first();
  return { ...base, position, rows, alreadyImported };
}

const counts = rows => ({ detected: rows.length, new: rows.filter(row => row.status === 'NEW').length,
  duplicates: rows.filter(row => row.status === 'DUPLICATE').length,
  possibleDuplicates: rows.filter(row => row.status === 'POSSIBLE_DUPLICATE').length,
  incidents: rows.filter(row => row.incidents.length).length });

/** Analyse a statement without writing. Concepts are shown to the people who classify bank movements. */
export async function previewC43Import(db, context, requestId, input, now = Date.now()) {
  await allow(db, context, requestId, 'finance.movement.import', 'finance_import_batch');
  const bytes = readInput(input, false);
  const result = await analyse(db, input, bytes);
  if (result.error) return { ok: false, error: result.error };
  const concepts = await canReadBankConcepts(db, context);
  await commit(db, [audit(db, context, requestId, 'BANK_IMPORT_PREVIEWED', 'finance_import_batch', null, now,
    { metadata: { count: Math.min(result.statement.movementCount, 1000) } })]);
  return { ok: true, file: { name: input.filename.trim(), hash: result.fileHash, encoding: result.encoding, bytes: bytes.length },
    statement: result.statement, position: result.position ? { id: result.position.id, name: result.position.name } : null,
    positionChoices: result.positionChoices, alreadyImported: !!result.alreadyImported, warnings: result.warnings,
    counts: counts(result.rows), conceptsVisible: concepts,
    rows: result.rows.map(row => ({ row: row.row, operationDate: row.operationDate, valueDate: row.valueDate, amountCents: row.amountCents,
      label: row.label, category: C43_COMMON_CONCEPTS[row.commonConcept] ?? null, concept: concepts ? row.description || null : null,
      status: row.status, duplicateOfId: row.duplicateOfId, incidents: row.incidents, round: row.round })) };
}

// Values are bound one by one in D1 (100 parameters per statement); a statement of literal rows keeps an import of
// hundreds of movements inside a handful of statements. Every value is an integer or an escaped string.
function literal(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') { if (!Number.isSafeInteger(value)) throw new Error('invalid_literal'); return String(value); }
  if (typeof value !== 'string' || value.includes('\u0000')) throw new Error('invalid_literal');
  return `'${value.replaceAll("'", "''")}'`;
}
function literalInserts(db, table, columns, rows, maxBytes = 90_000) {
  const head = `INSERT INTO ${table}(${columns.join(',')}) VALUES `, statements = [];
  let values = [], size = head.length;
  for (const row of rows) {
    const tuple = `(${row.map(literal).join(',')})`;
    if (values.length && size + tuple.length + 1 > maxBytes) { statements.push(db.prepare(head + values.join(','))); values = []; size = head.length; }
    values.push(tuple); size += tuple.length + 1;
  }
  if (values.length) statements.push(db.prepare(head + values.join(',')));
  return statements;
}

/** Import the new movements of a previewed statement, atomically. Re-importing never creates a second copy. */
export async function confirmC43Import(db, context, requestId, input, now = Date.now()) {
  await allow(db, context, requestId, 'finance.movement.import', 'finance_import_batch');
  const bytes = readInput(input, true);
  const result = await analyse(db, input, bytes);
  if (result.error) throw new AppError(400, result.error.code);
  if (result.fileHash !== input.expectedFileHash) throw new AppError(409, 'c43_file_changed');
  if (!result.position) throw new AppError(409, 'c43_position_required');
  if (result.alreadyImported) throw new AppError(409, 'duplicate_import');
  if (!result.rows.length) fail('c43_no_movements');
  const created = result.rows.filter(row => row.status !== 'DUPLICATE').map(row => ({ ...row, id: uuid() }));
  const flagged = created.filter(row => row.status === 'POSSIBLE_DUPLICATE').length;
  const batchId = uuid();
  const nullable = value => blankReference(value) ? null : value;
  await commit(db, [
    db.prepare(`INSERT INTO finance_import_batch(id,position_id,source_format,file_sha256,row_count,created_count,duplicate_count,flagged_count,
      status,imported_by,imported_at,statement_start,statement_end,opening_balance_cents,closing_balance_cents,account_mask,source_encoding)
      VALUES(?,?,'C43',?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(batchId, result.position.id, result.fileHash, result.rows.length, created.length,
      result.rows.length - created.length, flagged, flagged ? 'PARTIALLY_FLAGGED' : 'IMPORTED', context.userId, now,
      result.statement.startDate, result.statement.endDate, result.statement.openingCents, result.statement.closingCents,
      result.statement.accountMask, result.encoding),
    ...literalInserts(db, 'finance_movement', ['id', 'position_id', 'operation_date', 'value_date', 'amount_cents', 'origin', 'import_batch_id',
      'batch_row', 'fingerprint', 'display_label', 'review_flag', 'created_by', 'created_at'],
      created.map(row => [row.id, result.position.id, row.operationDate, row.valueDate, row.amountCents, 'IMPORT', batchId, row.row,
        row.fingerprint, row.label, row.status === 'POSSIBLE_DUPLICATE' ? 'NEAR_MATCH' : null, context.userId, now])),
    ...literalInserts(db, 'finance_movement_description', ['movement_id', 'original_text'],
      created.filter(row => row.description).map(row => [row.id, row.description])),
    ...literalInserts(db, 'finance_movement_bank_detail', ['movement_id', 'common_concept', 'own_concept', 'origin_branch', 'document_number',
      'reference_1', 'reference_2', 'identity'],
      created.map(row => [row.id, row.commonConcept, row.ownConcept || null, row.originBranch || null, nullable(row.documentNumber),
        nullable(row.reference1), row.reference2 || null, row.identity])),
    audit(db, context, requestId, 'BANK_IMPORT_CREATED', 'finance_import_batch', batchId, now, { metadata: { count: Math.min(result.rows.length, 1000) } }),
    audit(db, context, requestId, 'MOVEMENT_IMPORTED', 'finance_import_batch', batchId, now, { metadata: { count: Math.min(created.length, 1000) } })
  ]);
  return { id: batchId, positionId: result.position.id, counts: { ...counts(result.rows), created: created.length, flagged },
    statement: result.statement };
}
