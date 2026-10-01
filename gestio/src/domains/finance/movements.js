// FASE 3.5G.1 — import batches, immutable movements and typed allocations (TREASURY.md §7–§9, §24).
// A movement is a financial fact; its economic meaning lives only in its current allocation set.
import { versionCas } from '../../concurrency.js';
import { pageRequest, pageResult } from '../../pagination.js';
import { append } from '../audit/repository.js';
import { AppError, requireUuid, validUuid } from '../../services/common.js';
import { allow, audit, cents, commit, fail, isDate, keysOnly, notFound, optionalId, signedCents, uuid, version } from './shared.js';

const encoder = new TextEncoder();
async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
// Matching only: Unicode NFKC, case-folded, whitespace collapsed. The original is kept apart, untouched.
const normalise = text => text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
// Minimised projection shown in listings: direction, date and reference, never the bank description
// (which may contain names, including minors'). LEGAL DECISION REQUIRED decides any richer label.
const minimisedLabel = (amount, date, reference) =>
  `${amount > 0 ? 'Ingrés' : 'Càrrec'} ${date}${reference ? ` · ref. ${reference.slice(0, 40)}` : ''}`.slice(0, 80);

// ---------------------------------------------------------------- synthetic import format
// SYNTHETIC_CSV_V1: first line "# synthetic" (DATA_MODE=SYNTHETIC_ONLY), then the header
// operation_date,value_date,amount_cents,reference,description,balance_cents and one row per movement.
// The real bank adapter is added once the bank export is known (TREASURY.md §8).
const HEADER = 'operation_date,value_date,amount_cents,reference,description,balance_cents';
const MAX_ROWS = 500, MAX_BYTES = 256 * 1024;
function csvFields(line) {
  const fields = []; let current = '', quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') { current += '"'; index++; }
      else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"' && current === '') quoted = true;
    else if (char === ',') { fields.push(current); current = ''; }
    else current += char;
  }
  if (quoted) fail('invalid_import_row');
  fields.push(current);
  return fields;
}
export function parseSyntheticCsv(content) {
  if (typeof content !== 'string' || !content.length || encoder.encode(content).length > MAX_BYTES) fail('invalid_import');
  const lines = content.replace(/\r\n?/g, '\n').split('\n').filter(line => line.trim() !== '');
  if (lines[0]?.trim().toLowerCase() !== '# synthetic') fail('synthetic_import_required');
  if (lines[1]?.trim() !== HEADER) fail('invalid_import');
  const rows = lines.slice(2).map(line => {
    const [operationDate, valueDate, amount, reference, description, balance, ...extra] = csvFields(line);
    const amountCents = Number(amount), balanceCents = balance === '' || balance === undefined ? null : Number(balance);
    if (extra.length || !isDate(operationDate) || (valueDate && !isDate(valueDate)) || !/^-?\d+$/.test(amount ?? '') || !signedCents(amountCents) ||
        (reference ?? '').length > 80 || typeof description !== 'string' || !description.trim() || description.length > 500 ||
        (balanceCents !== null && (!/^-?\d+$/.test(balance) || !Number.isSafeInteger(balanceCents))))
      fail('invalid_import_row');
    return { operationDate, valueDate: valueDate || null, amountCents, reference: reference || null, description, balanceCents };
  });
  if (!rows.length || rows.length > MAX_ROWS) fail('invalid_import');
  return rows;
}
// Fingerprint of a row: position, dates, amount, reference, normalised description digest and the ordinal
// among identical rows of the same file. The auxiliary bank balance is never part of the identity.
async function fingerprints(positionId, rows) {
  const seen = new Map();
  return Promise.all(rows.map(async row => {
    const canonical = [positionId, row.operationDate, row.valueDate ?? '', row.amountCents, row.reference ?? '',
      await sha256(normalise(row.description))].join('|');
    const ordinal = (seen.get(canonical) ?? 0) + 1; seen.set(canonical, ordinal);
    return sha256(canonical + '|' + ordinal);
  }));
}
export async function importBatch(db, context, requestId, input, now = Date.now()) {
  await allow(db, context, requestId, 'finance.movement.import', 'finance_import_batch');
  if (!keysOnly(input, ['positionId', 'format', 'content']) || !validUuid(input.positionId) || input.format !== 'SYNTHETIC_CSV_V1') fail('invalid_import');
  const position = await db.prepare("SELECT id,status FROM finance_position WHERE id=?").bind(input.positionId).first();
  if (!position) throw notFound();
  if (position.status !== 'ACTIVE') throw new AppError(409, 'position_inactive');
  const rows = parseSyntheticCsv(input.content);
  const fileHash = await sha256(input.content);
  if (await db.prepare('SELECT 1 FROM finance_import_batch WHERE file_sha256=?').bind(fileHash).first()) throw new AppError(409, 'duplicate_import');
  const prints = await fingerprints(input.positionId, rows);
  const existing = new Set();
  for (let index = 0; index < prints.length; index += 50) {
    const chunk = prints.slice(index, index + 50);
    for (const row of (await db.prepare(`SELECT fingerprint FROM finance_movement WHERE fingerprint IN (${chunk.map(() => '?').join(',')})`)
      .bind(...chunk).all()).results) existing.add(row.fingerprint);
  }
  const batchId = uuid(), created = [];
  for (const [index, row] of rows.entries()) {
    if (existing.has(prints[index])) continue;
    // A near match (same position, date and amount, different identity) is imported flagged for review,
    // never dropped silently.
    const near = await db.prepare(`SELECT 1 FROM finance_movement WHERE position_id=? AND operation_date=? AND amount_cents=? AND state='ACTIVE' LIMIT 1`)
      .bind(input.positionId, row.operationDate, row.amountCents).first();
    created.push({ ...row, id: uuid(), batchRow: index + 1, fingerprint: prints[index], flagged: !!near });
  }
  const flagged = created.filter(row => row.flagged).length;
  await commit(db, [
    db.prepare(`INSERT INTO finance_import_batch(id,position_id,source_format,file_sha256,row_count,created_count,duplicate_count,flagged_count,
      status,imported_by,imported_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(batchId, input.positionId, input.format, fileHash, rows.length,
      created.length, rows.length - created.length, flagged, flagged ? 'PARTIALLY_FLAGGED' : 'IMPORTED', context.userId, now),
    ...created.flatMap(row => [
      db.prepare(`INSERT INTO finance_movement(id,position_id,operation_date,value_date,amount_cents,origin,import_batch_id,batch_row,bank_reference,
        fingerprint,display_label,auxiliary_balance_cents,review_flag,created_by,created_at) VALUES(?,?,?,?,?,'IMPORT',?,?,?,?,?,?,?,?,?)`)
        .bind(row.id, input.positionId, row.operationDate, row.valueDate, row.amountCents, batchId, row.batchRow, row.reference, row.fingerprint,
          minimisedLabel(row.amountCents, row.operationDate, row.reference), row.balanceCents, row.flagged ? 'NEAR_MATCH' : null, context.userId, now),
      db.prepare('INSERT INTO finance_movement_description(movement_id,original_text) VALUES(?,?)').bind(row.id, row.description)
    ]),
    audit(db, context, requestId, 'BANK_IMPORT_CREATED', 'finance_import_batch', batchId, now),
    audit(db, context, requestId, 'MOVEMENT_IMPORTED', 'finance_import_batch', batchId, now, { metadata: { count: Math.min(created.length, 1000) } })
  ]);
  return { id: batchId, rowCount: rows.length, createdCount: created.length, duplicateCount: rows.length - created.length, flaggedCount: flagged };
}
export async function listImportBatches(db, context, requestId) {
  await allow(db, context, requestId, 'finance.movement.read', 'finance_import_batch');
  return { batches: (await db.prepare(`SELECT id,position_id AS positionId,source_format AS format,row_count AS rowCount,created_count AS createdCount,
    duplicate_count AS duplicateCount,flagged_count AS flaggedCount,status,imported_at AS importedAt FROM finance_import_batch
    ORDER BY imported_at DESC,id DESC LIMIT 100`).all()).results };
}

// ---------------------------------------------------------------- manual movements (cash, card, bank twins)
export async function createManualMovement(db, context, requestId, input, now = Date.now()) {
  await allow(db, context, requestId, 'finance.movement.classify', 'finance_movement');
  if (!keysOnly(input, ['positionId', 'operationDate', 'valueDate', 'amountCents', 'reference', 'label']) || !validUuid(input.positionId) ||
      !isDate(input.operationDate) || (input.valueDate != null && !isDate(input.valueDate)) || !signedCents(input.amountCents) ||
      (input.reference != null && (typeof input.reference !== 'string' || !input.reference.length || input.reference.length > 80)) ||
      typeof input.label !== 'string' || !input.label.trim() || input.label.length > 80) fail('invalid_movement');
  const position = await db.prepare('SELECT status FROM finance_position WHERE id=?').bind(input.positionId).first();
  if (!position) throw notFound();
  if (position.status !== 'ACTIVE') throw new AppError(409, 'position_inactive');
  const id = uuid();
  await commit(db, [
    db.prepare(`INSERT INTO finance_movement(id,position_id,operation_date,value_date,amount_cents,origin,bank_reference,fingerprint,display_label,
      created_by,created_at) VALUES(?,?,?,?,?,'MANUAL',?,?,?,?,?)`).bind(id, input.positionId, input.operationDate, input.valueDate ?? null,
      input.amountCents, input.reference ?? null, await sha256('MANUAL|' + id), input.label.trim(), context.userId, now),
    audit(db, context, requestId, 'MOVEMENT_CREATED_MANUAL', 'finance_movement', id, now)
  ]);
  return { id, allocationVersion: 0, reviewVersion: 1 };
}

// ---------------------------------------------------------------- reads
const MOVEMENT_FIELDS = `m.id,m.position_id AS positionId,m.operation_date AS operationDate,m.value_date AS valueDate,m.amount_cents AS amountCents,
  m.origin,m.import_batch_id AS importBatchId,m.display_label AS label,m.bank_reference AS reference,m.auxiliary_balance_cents AS auxiliaryBalanceCents,
  m.review_flag AS reviewFlag,m.state,m.duplicate_of_id AS duplicateOfId,m.allocation_version AS allocationVersion,m.review_version AS reviewVersion,
  b.allocated_cents AS allocatedCents,b.unallocated_cents AS unallocatedCents`;
export async function listMovements(db, context, requestId, params) {
  await allow(db, context, requestId, 'finance.movement.read', 'finance_movement');
  const filters = [], binds = [];
  const positionId = params?.get('positionId'), from = params?.get('from'), to = params?.get('to'), state = params?.get('state') ?? 'ACTIVE';
  if (positionId) { if (!validUuid(positionId)) fail('invalid_filter'); filters.push('m.position_id=?'); binds.push(positionId); }
  if (from) { if (!isDate(from)) fail('invalid_filter'); filters.push('m.operation_date>=?'); binds.push(from); }
  if (to) { if (!isDate(to)) fail('invalid_filter'); filters.push('m.operation_date<=?'); binds.push(to); }
  if (!['ACTIVE', 'VOID_DUPLICATE'].includes(state)) fail('invalid_filter');
  filters.push('m.state=?'); binds.push(state);
  if (params?.get('pending') === '1') filters.push('(b.unallocated_cents>0 OR m.review_flag IS NOT NULL)');
  const page = pageRequest(params, ['string', 'string']);
  if (page.after) { filters.push('(m.operation_date<? OR (m.operation_date=? AND m.id<?))'); binds.push(page.after[0], page.after[0], page.after[1]); }
  const rows = (await db.prepare(`SELECT ${MOVEMENT_FIELDS} FROM finance_movement m
    LEFT JOIN finance_movement_allocation_balance b ON b.movement_id=m.id WHERE ${filters.join(' AND ')}
    ORDER BY m.operation_date DESC,m.id DESC LIMIT ?`).bind(...binds, page.limit + 1).all()).results;
  const result = pageResult(rows, page.limit, row => [row.operationDate, row.id]);
  return { movements: result.items, nextCursor: result.nextCursor };
}
const ALLOCATION_FIELDS = `id,kind,amount_cents AS amountCents,round_id AS roundId,budget_line_id AS budgetLineId,expense_id AS expenseId,
  paired_movement_id AS pairedMovementId,activity_id AS activityId,section_id AS sectionId,set_version AS setVersion,created_at AS createdAt`;
export async function movementDetail(db, context, requestId, id) {
  await allow(db, context, requestId, 'finance.movement.read', 'finance_movement', validUuid(id) ? id : null);
  const movement = await db.prepare(`SELECT ${MOVEMENT_FIELDS} FROM finance_movement m
    LEFT JOIN finance_movement_allocation_balance b ON b.movement_id=m.id WHERE m.id=?`).bind(requireUuid(id)).first();
  if (!movement) throw notFound();
  const allocations = (await db.prepare(`SELECT ${ALLOCATION_FIELDS} FROM finance_allocation WHERE movement_id=? AND set_version=?
    ORDER BY created_at,id`).bind(id, movement.allocationVersion).all()).results;
  return { movement, allocations, previousSets: Math.max(0, movement.allocationVersion - 1) };
}
// The protected original description: explicit permission, audited without the value (LEGAL DECISION REQUIRED).
export async function revealDescription(db, context, requestId, id) {
  await allow(db, context, requestId, 'finance.bank_description.reveal', 'finance_movement', validUuid(id) ? id : null);
  const row = await db.prepare('SELECT original_text FROM finance_movement_description WHERE movement_id=?').bind(requireUuid(id)).first();
  if (!row) throw notFound();
  await append(db, { requestId, actorUserId: context.userId, sessionId: context.sessionId, action: 'BANK_DESCRIPTION_REVEALED',
    resourceType: 'finance_movement', resourceId: id, result: 'SUCCESS' });
  return { description: row.original_text };
}

// ---------------------------------------------------------------- duplicates and review flags
export async function voidDuplicate(db, context, requestId, id, input, now = Date.now()) {
  await allow(db, context, requestId, 'finance.movement.classify', 'finance_movement', validUuid(id) ? id : null);
  if (!keysOnly(input, ['duplicateOfId', 'expectedReviewVersion']) || !validUuid(input.duplicateOfId) || !version(input.expectedReviewVersion)) fail('invalid_duplicate_void');
  const row = await db.prepare('SELECT state FROM finance_movement WHERE id=?').bind(requireUuid(id)).first();
  if (!row) throw notFound();
  if (row.state !== 'ACTIVE' || input.duplicateOfId === id) throw new AppError(409, 'invalid_duplicate_void');
  await commit(db, [
    db.prepare(`UPDATE finance_movement SET ${versionCas('review_version')},state='VOID_DUPLICATE',duplicate_of_id=?,voided_by=?,voided_at=?,
      review_flag=NULL WHERE id=?`).bind(input.expectedReviewVersion, input.duplicateOfId, context.userId, now, id),
    audit(db, context, requestId, 'MOVEMENT_VOIDED_DUPLICATE', 'finance_movement', id, now)
  ], 'stale_movement');
  return { id, state: 'VOID_DUPLICATE' };
}
export async function clearReviewFlag(db, context, requestId, id, input, now = Date.now()) {
  await allow(db, context, requestId, 'finance.movement.classify', 'finance_movement', validUuid(id) ? id : null);
  if (!keysOnly(input, ['expectedReviewVersion']) || !version(input.expectedReviewVersion)) fail('invalid_version');
  const row = await db.prepare('SELECT state,review_flag FROM finance_movement WHERE id=?').bind(requireUuid(id)).first();
  if (!row) throw notFound();
  if (row.state !== 'ACTIVE' || !row.review_flag) throw new AppError(409, 'invalid_transition');
  await commit(db, [
    db.prepare(`UPDATE finance_movement SET ${versionCas('review_version')},review_flag=NULL WHERE id=?`).bind(input.expectedReviewVersion, id),
    audit(db, context, requestId, 'MOVEMENT_NEAR_MATCH_CLEARED', 'finance_movement', id, now)
  ], 'stale_movement');
  return { id, reviewFlag: null };
}

// ---------------------------------------------------------------- allocations
const ENABLED = new Set(['INCOME', 'EXPENSE_SETTLEMENT', 'EXPENSE_REFUND', 'INTERNAL_TRANSFER']);
function validAllocations(list) {
  if (!Array.isArray(list) || list.length > 20) fail('invalid_allocation');
  for (const item of list) {
    if (!keysOnly(item, ['kind', 'amountCents', 'budgetLineId', 'expenseId', 'pairedMovementId', 'activityId', 'sectionId']) ||
        typeof item.kind !== 'string' || !cents(item.amountCents) || !optionalId(item.budgetLineId) || !optionalId(item.expenseId) ||
        !optionalId(item.pairedMovementId) || !optionalId(item.activityId) || !optionalId(item.sectionId)) fail('invalid_allocation');
    if (!ENABLED.has(item.kind)) throw new AppError(409, 'allocation_kind_not_enabled');
    const targets = { INCOME: 'budgetLineId', EXPENSE_SETTLEMENT: 'expenseId', EXPENSE_REFUND: 'expenseId', INTERNAL_TRANSFER: 'pairedMovementId' };
    if (['budgetLineId', 'expenseId', 'pairedMovementId'].some(key => (key === targets[item.kind]) !== (item[key] != null))) fail('invalid_allocation');
    if (item.kind !== 'INCOME' && (item.activityId != null || item.sectionId != null)) fail('invalid_allocation');
  }
}
async function allocationRows(db, context, movementId, setVersion, list, now) {
  const statements = [];
  for (const item of list) {
    let roundId = null;
    if (item.kind === 'INCOME') {
      const line = await db.prepare('SELECT round_id FROM finance_budget_line WHERE id=?').bind(item.budgetLineId).first();
      if (!line) throw new AppError(409, 'invalid_income_allocation');
      roundId = line.round_id;
    }
    statements.push(db.prepare(`INSERT INTO finance_allocation(id,movement_id,set_version,kind,amount_cents,round_id,budget_line_id,expense_id,
      paired_movement_id,activity_id,section_id,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(uuid(), movementId, setVersion, item.kind, item.amountCents, roundId, item.budgetLineId ?? null, item.expenseId ?? null,
        item.pairedMovementId ?? null, item.activityId ?? null, item.sectionId ?? null, context.userId, now));
  }
  return statements;
}
/** Replace the current allocation set of a movement (an empty list clears it). History is kept. */
export async function allocateMovement(db, context, requestId, id, input, now = Date.now()) {
  await allow(db, context, requestId, 'finance.movement.classify', 'finance_movement', validUuid(id) ? id : null);
  if (!keysOnly(input, ['expectedVersion', 'allocations']) || !version(input.expectedVersion)) fail('invalid_allocation');
  validAllocations(input.allocations);
  const movement = await db.prepare('SELECT state,allocation_version FROM finance_movement WHERE id=?').bind(requireUuid(id)).first();
  if (!movement) throw notFound();
  if (movement.state !== 'ACTIVE') throw new AppError(409, 'movement_voided');
  const next = input.expectedVersion + 1;
  await commit(db, [
    db.prepare(`UPDATE finance_movement SET ${versionCas('allocation_version')} WHERE id=?`).bind(input.expectedVersion, id),
    ...await allocationRows(db, context, id, next, input.allocations, now),
    audit(db, context, requestId, input.expectedVersion === 0 ? 'MOVEMENT_CLASSIFIED' : 'MOVEMENT_RECLASSIFIED', 'finance_movement', id, now)
  ], 'stale_movement');
  return { id, allocationVersion: next };
}
/** Pair two movements as one internal transfer (bank ↔ cash, card settlement later): both whole amounts,
 *  opposite signs, different positions — written together, never counted as income or expense. */
export async function recordInternalTransfer(db, context, requestId, input, now = Date.now()) {
  await allow(db, context, requestId, 'finance.movement.classify', 'finance_movement');
  if (!keysOnly(input, ['fromMovementId', 'toMovementId', 'fromExpectedVersion', 'toExpectedVersion']) || !validUuid(input.fromMovementId) ||
      !validUuid(input.toMovementId) || input.fromMovementId === input.toMovementId || !version(input.fromExpectedVersion) ||
      !version(input.toExpectedVersion)) fail('invalid_internal_transfer');
  const rows = (await db.prepare('SELECT id,state,amount_cents FROM finance_movement WHERE id IN (?,?)').bind(input.fromMovementId, input.toMovementId).all()).results;
  if (rows.length !== 2) throw notFound();
  const from = rows.find(row => row.id === input.fromMovementId);
  await commit(db, [
    db.prepare(`UPDATE finance_movement SET ${versionCas('allocation_version')} WHERE id=?`).bind(input.fromExpectedVersion, input.fromMovementId),
    db.prepare(`UPDATE finance_movement SET ${versionCas('allocation_version')} WHERE id=?`).bind(input.toExpectedVersion, input.toMovementId),
    ...await allocationRows(db, context, input.fromMovementId, input.fromExpectedVersion + 1,
      [{ kind: 'INTERNAL_TRANSFER', amountCents: Math.abs(from.amount_cents), pairedMovementId: input.toMovementId }], now),
    ...await allocationRows(db, context, input.toMovementId, input.toExpectedVersion + 1,
      [{ kind: 'INTERNAL_TRANSFER', amountCents: Math.abs(from.amount_cents), pairedMovementId: input.fromMovementId }], now),
    audit(db, context, requestId, input.fromExpectedVersion === 0 ? 'MOVEMENT_CLASSIFIED' : 'MOVEMENT_RECLASSIFIED', 'finance_movement', input.fromMovementId, now),
    audit(db, context, requestId, input.toExpectedVersion === 0 ? 'MOVEMENT_CLASSIFIED' : 'MOVEMENT_RECLASSIFIED', 'finance_movement', input.toMovementId, now)
  ], 'stale_movement');
  return { fromAllocationVersion: input.fromExpectedVersion + 1, toAllocationVersion: input.toExpectedVersion + 1 };
}
