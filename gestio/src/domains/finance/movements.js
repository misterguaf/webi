// FASE 3.5G.1 — import batches, immutable movements and typed allocations (TREASURY.md §7–§9, §24).
// A movement is a financial fact; its economic meaning lives only in its current allocation set.
import { versionCas } from '../../concurrency.js';
import { pageRequest, pageResult } from '../../pagination.js';
import { append } from '../audit/repository.js';
import { AppError, requireUuid, validUuid } from '../../services/common.js';
import { allow, audit, cents, commit, fail, isDate, keysOnly, notFound, optionalId, signedCents, syntheticName, uuid, version } from './shared.js';
import { describeAllocations, expenseSummaries } from './read-models.js';
import { insertIncome, validIncome } from './incomes.js';
import { authorize } from '../../policy.js';
import { prepareExpenseEvidence, evidenceStatements, commitWithEvidence } from './evidence.js';

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
const MOVEMENT_FIELDS = `m.id,m.position_id AS positionId,p.name AS positionName,p.kind AS positionKind,m.operation_date AS operationDate,
  m.value_date AS valueDate,m.amount_cents AS amountCents,m.origin,m.import_batch_id AS importBatchId,m.display_label AS label,
  m.bank_reference AS reference,m.auxiliary_balance_cents AS auxiliaryBalanceCents,m.review_flag AS reviewFlag,m.state,
  m.duplicate_of_id AS duplicateOfId,m.allocation_version AS allocationVersion,m.review_version AS reviewVersion,
  COALESCE(b.allocated_cents,0) AS allocatedCents,COALESCE(b.unallocated_cents,0) AS unallocatedCents`;
const MOVEMENT_FROM = `finance_movement m JOIN finance_position p ON p.id=m.position_id
  LEFT JOIN finance_movement_allocation_balance b ON b.movement_id=m.id`;
// Status shown to people (derived): void duplicate, possible duplicate, pending, partial, classified.
export const movementStatus = row => row.state === 'VOID_DUPLICATE' ? 'VOID_DUPLICATE' : row.reviewFlag ? 'POSSIBLE_DUPLICATE'
  : row.allocatedCents === 0 ? 'PENDING' : row.unallocatedCents > 0 ? 'PARTIAL' : 'CLASSIFIED';
const STATUS_FILTERS = {
  pending: 'm.state=\'ACTIVE\' AND m.review_flag IS NULL AND COALESCE(b.allocated_cents,0)=0',
  partial: 'm.state=\'ACTIVE\' AND m.review_flag IS NULL AND COALESCE(b.allocated_cents,0)>0 AND b.unallocated_cents>0',
  classified: 'm.state=\'ACTIVE\' AND m.review_flag IS NULL AND COALESCE(b.unallocated_cents,1)=0',
  attention: 'm.state=\'ACTIVE\' AND (m.review_flag IS NOT NULL OR b.unallocated_cents>0)',
  duplicates: 'm.state=\'ACTIVE\' AND m.review_flag IS NOT NULL',
  voided: 'm.state=\'VOID_DUPLICATE\''
};
/** Current allocations of several movements, summarised for a list row. */
async function classificationSummaries(db, context, rows, reimbursementDetails) {
  const active = rows.filter(row => row.allocationVersion > 0 && row.state === 'ACTIVE');
  if (!active.length) return new Map();
  const allocations = (await db.prepare(`SELECT a.movement_id AS movementId,a.kind,a.amount_cents AS amountCents,a.budget_line_id AS budgetLineId,
    a.expense_id AS expenseId,a.paired_movement_id AS pairedMovementId,a.income_id AS incomeId,
    a.reimbursement_id AS reimbursementId,a.fee_payment_id AS feePaymentId,
    a.activity_allocation_id AS activityAllocationId FROM finance_allocation_current a
    WHERE a.movement_id IN (${active.map(() => '?').join(',')}) ORDER BY a.created_at,a.id`).bind(...active.map(row => row.id)).all()).results;
  const receiptDetails = (await authorize(db, context, { permission: 'finance.treasury.read' })).allow;
  const described = await describeAllocations(db, allocations, { reimbursementDetails, receiptDetails });
  const byMovement = new Map();
  allocations.forEach((row, index) => {
    if (!byMovement.has(row.movementId)) byMovement.set(row.movementId, []);
    byMovement.get(row.movementId).push(described[index]);
  });
  return byMovement;
}
export async function listMovements(db, context, requestId, params) {
  await allow(db, context, requestId, 'finance.movement.read', 'finance_movement');
  const filters = [], binds = [];
  const positionId = params?.get('positionId'), from = params?.get('from'), to = params?.get('to');
  const status = params?.get('status') ?? (params?.get('state') === 'VOID_DUPLICATE' ? 'voided' : null), direction = params?.get('direction'), q = params?.get('q');
  if (positionId) { if (!validUuid(positionId)) fail('invalid_filter'); filters.push('m.position_id=?'); binds.push(positionId); }
  if (from) { if (!isDate(from)) fail('invalid_filter'); filters.push('m.operation_date>=?'); binds.push(from); }
  if (to) { if (!isDate(to)) fail('invalid_filter'); filters.push('m.operation_date<=?'); binds.push(to); }
  if (status) { if (!STATUS_FILTERS[status]) fail('invalid_filter'); filters.push(STATUS_FILTERS[status]); }
  else filters.push("m.state='ACTIVE'");
  if (params?.get('pending') === '1') filters.push(STATUS_FILTERS.attention);
  if (direction) { if (!['in', 'out'].includes(direction)) fail('invalid_filter'); filters.push(direction === 'in' ? 'm.amount_cents>0' : 'm.amount_cents<0'); }
  // Search covers the minimised projection only (label, reference, position), never the original description.
  if (q) {
    if (typeof q !== 'string' || q.length > 80) fail('invalid_filter');
    filters.push("(m.display_label LIKE ? ESCAPE '\\' OR m.bank_reference LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\')");
    const like = '%' + q.trim().replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_') + '%';
    binds.push(like, like, like);
  }
  const page = pageRequest(params, ['string', 'string']);
  if (page.after) { filters.push('(m.operation_date<? OR (m.operation_date=? AND m.id<?))'); binds.push(page.after[0], page.after[0], page.after[1]); }
  const rows = (await db.prepare(`SELECT ${MOVEMENT_FIELDS} FROM ${MOVEMENT_FROM} WHERE ${filters.join(' AND ')}
    ORDER BY m.operation_date DESC,m.id DESC LIMIT ?`).bind(...binds, page.limit + 1).all()).results;
  const result = pageResult(rows, page.limit, row => [row.operationDate, row.id]);
  const reimbursementDetails = (await authorize(db, context, { permission: 'finance.expense.read' })).allow;
  const summaries = await classificationSummaries(db, context, result.items, reimbursementDetails);
  return { movements: result.items.map(row => ({ ...row, status: movementStatus(row), classification: summaries.get(row.id) ?? [] })),
    nextCursor: result.nextCursor };
}
const ALLOCATION_FIELDS = `id,kind,amount_cents AS amountCents,round_id AS roundId,budget_line_id AS budgetLineId,expense_id AS expenseId,
  paired_movement_id AS pairedMovementId,income_id AS incomeId,reimbursement_id AS reimbursementId,
  fee_payment_id AS feePaymentId,activity_allocation_id AS activityAllocationId,
  activity_id AS activityId,section_id AS sectionId,set_version AS setVersion,created_at AS createdAt`;
const brief = row => ({ id: row.id, operationDate: row.operationDate, amountCents: row.amountCents, label: row.label, positionName: row.positionName,
  positionKind: row.positionKind, status: movementStatus(row), allocationVersion: row.allocationVersion, reviewVersion: row.reviewVersion });
export async function movementDetail(db, context, requestId, id) {
  await allow(db, context, requestId, 'finance.movement.read', 'finance_movement', validUuid(id) ? id : null);
  const movement = await db.prepare(`SELECT ${MOVEMENT_FIELDS} FROM ${MOVEMENT_FROM} WHERE m.id=?`).bind(requireUuid(id)).first();
  if (!movement) throw notFound();
  const sets = (await db.prepare(`SELECT ${ALLOCATION_FIELDS} FROM finance_allocation WHERE movement_id=? ORDER BY set_version,created_at,id`)
    .bind(id).all()).results;
  const reimbursementDetails = (await authorize(db, context, { permission: 'finance.expense.read' })).allow;
  const receiptDetails = (await authorize(db, context, { permission: 'finance.treasury.read' })).allow;
  const described = await describeAllocations(db, sets, { reimbursementDetails, receiptDetails });
  const current = described.filter((_, index) => sets[index].setVersion === movement.allocationVersion);
  // Classification history: every earlier set, newest first (kept, never rewritten).
  const history = [];
  for (let version = movement.allocationVersion - 1; version >= 1; version--) {
    const items = described.filter((_, index) => sets[index].setVersion === version);
    const createdAt = sets.find(row => row.setVersion === version + 1)?.createdAt ?? null;
    history.push({ replacedAt: createdAt, allocations: items });
  }
  const batch = movement.importBatchId ? await db.prepare(`SELECT source_format AS format,imported_at AS importedAt FROM finance_import_batch WHERE id=?`)
    .bind(movement.importBatchId).first() : null;
  const duplicateOf = movement.duplicateOfId ? await db.prepare(`SELECT ${MOVEMENT_FIELDS} FROM ${MOVEMENT_FROM} WHERE m.id=?`).bind(movement.duplicateOfId).first() : null;
  // Candidates offered by the screen: possible originals of a flagged movement, and transfer pairs.
  const duplicateCandidates = movement.state === 'ACTIVE' ? (await db.prepare(`SELECT ${MOVEMENT_FIELDS} FROM ${MOVEMENT_FROM}
    WHERE m.position_id=? AND m.amount_cents=? AND m.operation_date=? AND m.id!=? AND m.state='ACTIVE' ORDER BY m.created_at LIMIT 5`)
    .bind(movement.positionId, movement.amountCents, movement.operationDate, id).all()).results.map(brief) : [];
  const transferCandidates = movement.state === 'ACTIVE' ? (await db.prepare(`SELECT ${MOVEMENT_FIELDS} FROM ${MOVEMENT_FROM}
    WHERE m.position_id!=? AND m.amount_cents=? AND m.state='ACTIVE' AND COALESCE(b.allocated_cents,0)=0
    ORDER BY abs(julianday(m.operation_date)-julianday(?)),m.id LIMIT 8`).bind(movement.positionId, -movement.amountCents, movement.operationDate)
    .all()).results.map(brief) : [];
  const hasDescription = !!await db.prepare('SELECT 1 FROM finance_movement_description WHERE movement_id=?').bind(id).first();
  return { movement: { ...movement, status: movementStatus(movement), origin: movement.origin, importedAt: batch?.importedAt ?? null, hasDescription },
    allocations: current, history, duplicateOf: duplicateOf ? brief(duplicateOf) : null, duplicateCandidates, transferCandidates };
}

/** Suggestions are only candidates. Treasury must select the target and amount explicitly. */
export async function receiptCandidates(db, context, requestId, id) {
  await allow(db, context, requestId, 'finance.treasury.read', 'finance_movement', validUuid(id) ? id : null);
  await allow(db, context, requestId, 'finance.movement.classify', 'finance_movement', validUuid(id) ? id : null);
  const movement = await db.prepare(`SELECT m.amount_cents,m.operation_date,p.kind,b.unallocated_cents
    FROM finance_movement m JOIN finance_position p ON p.id=m.position_id
    JOIN finance_movement_allocation_balance b ON b.movement_id=m.id
    WHERE m.id=? AND m.state='ACTIVE'`).bind(requireUuid(id)).first();
  if (!movement) throw notFound();
  if (movement.kind !== 'BANK' || movement.amount_cents <= 0) return { fees: [], activities: [] };
  const fees = (await db.prepare(`SELECT p.id,r.code AS roundCode,
    (SELECT count(*) FROM annual_fee_allocation a WHERE a.payment_id=p.id) AS obligations,
    (SELECT COALESCE(sum(a.amount_cents),0) FROM annual_fee_allocation a WHERE a.payment_id=p.id)
      -COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a
        WHERE a.kind='FEE_PAYMENT' AND a.fee_payment_id=p.id),0) AS outstandingCents,
    p.reviewed_at AS reviewedAt
    FROM annual_fee_payment p JOIN annual_fee_round r ON r.id=p.round_id
    JOIN finance_round fr ON fr.annual_fee_round_id=p.round_id
    WHERE p.review_status='VERIFIED' AND p.verified_amount_cents IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM annual_fee_issue i WHERE i.payment_id=p.id AND i.status='OPEN')
    ORDER BY abs(outstandingCents-?),abs(julianday(date(p.reviewed_at/1000,'unixepoch'))-julianday(?)),p.id LIMIT 30`)
    .bind(movement.unallocated_cents,movement.operation_date).all()).results.filter(row => row.outstandingCents > 0);
  const activities = (await db.prepare(`SELECT pa.id,a.name AS activityName,
    COALESCE(p.display_name,'Inscripció pendent de vincular') AS participantName,
    pa.amount_cents-COALESCE((SELECT sum(x.amount_cents) FROM finance_allocation_current x
      WHERE x.kind='ACTIVITY_PAYMENT' AND x.activity_allocation_id=pa.id),0) AS outstandingCents,
    pa.created_at AS verifiedAt
    FROM activity_payment_allocation pa JOIN activity_registration ar ON ar.id=pa.registration_id
    JOIN activity a ON a.id=ar.activity_id LEFT JOIN participant p ON p.id=ar.participant_id
    LEFT JOIN payment_evidence e ON e.id=pa.evidence_id
    WHERE ar.finance_round_id IS NOT NULL AND (pa.evidence_id IS NULL OR e.review_status='VERIFIED')
    ORDER BY abs(outstandingCents-?),abs(julianday(date(pa.created_at/1000,'unixepoch'))-julianday(?)),pa.id LIMIT 30`)
    .bind(movement.unallocated_cents,movement.operation_date).all()).results.filter(row => row.outstandingCents > 0);
  return { fees, activities, suggestionOnly: true };
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
/** Existing set rows → payload that keeps them (an income link carries its own line). */
const keptAllocations = rows => rows.map(row => Object.fromEntries(Object.entries(row)
  .filter(([key, value]) => value !== null && !(key === 'budgetLineId' && row.incomeId))));
const ENABLED = new Set(['INCOME', 'EXPENSE_SETTLEMENT', 'EXPENSE_REFUND', 'INTERNAL_TRANSFER',
  'REIMBURSEMENT_SETTLEMENT', 'FEE_PAYMENT', 'ACTIVITY_PAYMENT']);
function validAllocations(list) {
  if (!Array.isArray(list) || list.length > 20) fail('invalid_allocation');
  for (const item of list) {
    if (!keysOnly(item, ['kind', 'amountCents', 'budgetLineId', 'expenseId', 'pairedMovementId', 'incomeId',
      'reimbursementId', 'feePaymentId', 'activityAllocationId', 'activityId', 'sectionId']) ||
        typeof item.kind !== 'string' || !cents(item.amountCents) || !optionalId(item.budgetLineId) || !optionalId(item.expenseId) ||
        !optionalId(item.pairedMovementId) || !optionalId(item.incomeId) || !optionalId(item.reimbursementId) ||
        !optionalId(item.feePaymentId) || !optionalId(item.activityAllocationId) ||
        !optionalId(item.activityId) || !optionalId(item.sectionId)) fail('invalid_allocation');
    // An income allocation names a budget line, or an income (which brings its own line).
    if (item.incomeId != null && (item.kind !== 'INCOME' || item.budgetLineId != null)) fail('invalid_allocation');
    if (!ENABLED.has(item.kind)) throw new AppError(409, 'allocation_kind_not_enabled');
    const targets = { INCOME: 'budgetLineId', EXPENSE_SETTLEMENT: 'expenseId', EXPENSE_REFUND: 'expenseId',
      INTERNAL_TRANSFER: 'pairedMovementId', REIMBURSEMENT_SETTLEMENT: 'reimbursementId',
      FEE_PAYMENT: 'feePaymentId', ACTIVITY_PAYMENT: 'activityAllocationId' };
    const target = item.incomeId != null ? { ...item, budgetLineId: 'income' } : item;
    if (['budgetLineId', 'expenseId', 'pairedMovementId', 'reimbursementId', 'feePaymentId', 'activityAllocationId']
      .some(key => (key === targets[item.kind]) !== (target[key] != null))) fail('invalid_allocation');
    if (item.kind !== 'INCOME' && (item.activityId != null || item.sectionId != null)) fail('invalid_allocation');
  }
}
async function allocationRows(db, context, movementId, setVersion, list, now) {
  const statements = [];
  for (const item of list) {
    let roundId = null;
    let budgetLineId = item.budgetLineId ?? null;
    if (item.kind === 'INCOME' && item.incomeId != null) {
      // An income created in the same batch is passed in; otherwise it must already exist and be active.
      const income = item.newIncome ?? await db.prepare("SELECT round_id,budget_line_id FROM finance_income WHERE id=? AND status='ACTIVE'").bind(item.incomeId).first();
      if (!income) throw new AppError(409, 'invalid_income_allocation');
      roundId = income.round_id; budgetLineId = income.budget_line_id;
    } else if (item.kind === 'INCOME') {
      const line = await db.prepare('SELECT round_id FROM finance_budget_line WHERE id=?').bind(item.budgetLineId).first();
      if (!line) throw new AppError(409, 'invalid_income_allocation');
      roundId = line.round_id;
    }
    statements.push(db.prepare(`INSERT INTO finance_allocation(id,movement_id,set_version,kind,amount_cents,round_id,budget_line_id,expense_id,
      paired_movement_id,income_id,reimbursement_id,fee_payment_id,activity_allocation_id,
      activity_id,section_id,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(uuid(), movementId, setVersion, item.kind, item.amountCents, roundId, budgetLineId, item.expenseId ?? null,
        item.pairedMovementId ?? null, item.incomeId ?? null, item.reimbursementId ?? null,
        item.feePaymentId ?? null, item.activityAllocationId ?? null,
        item.activityId ?? null, item.sectionId ?? null, context.userId, now));
  }
  return statements;
}
/** Replace the current allocation set of a movement (an empty list clears it). History is kept. */
export async function allocateMovement(db, context, requestId, id, input, now = Date.now()) {
  await allow(db, context, requestId, 'finance.movement.classify', 'finance_movement', validUuid(id) ? id : null);
  if (!keysOnly(input, ['expectedVersion', 'allocations', 'reason']) || !version(input.expectedVersion)) fail('invalid_allocation');
  validAllocations(input.allocations);
  if (input.allocations.some(item => item.kind === 'FEE_PAYMENT'))
    await allow(db, context, requestId, 'finance.treasury.read', 'finance_movement', id);
  if (input.allocations.some(item => item.kind === 'ACTIVITY_PAYMENT'))
    await allow(db, context, requestId, 'finance.treasury.read', 'finance_movement', id);
  const movement = await db.prepare(`SELECT m.state,m.amount_cents,m.allocation_version,p.kind AS position_kind FROM finance_movement m
    JOIN finance_position p ON p.id=m.position_id WHERE m.id=?`).bind(requireUuid(id)).first();
  if (!movement) throw notFound();
  if (movement.state !== 'ACTIVE') throw new AppError(409, 'movement_voided');
  if (movement.allocation_version !== input.expectedVersion) throw new AppError(409, 'stale_movement');
  const prior = movement.allocation_version > 0 ? (await db.prepare(`SELECT kind,amount_cents AS amountCents,
    budget_line_id AS budgetLineId,expense_id AS expenseId,paired_movement_id AS pairedMovementId,
    income_id AS incomeId,reimbursement_id AS reimbursementId,fee_payment_id AS feePaymentId,
    activity_allocation_id AS activityAllocationId,activity_id AS activityId,section_id AS sectionId
    FROM finance_allocation_current WHERE movement_id=?`).bind(id).all()).results : [];
  if (prior.some(item => ['FEE_PAYMENT', 'ACTIVITY_PAYMENT'].includes(item.kind)))
    await allow(db, context, requestId, 'finance.treasury.read', 'finance_movement', id);
  const identity = item => JSON.stringify([item.kind,item.amountCents,item.incomeId ? null : item.budgetLineId,
    item.expenseId,item.pairedMovementId,item.incomeId,item.reimbursementId,item.feePaymentId,
    item.activityAllocationId,item.activityId,item.sectionId]);
  const remaining = input.allocations.map(identity);
  const changesPrior = prior.some(item => { const index = remaining.indexOf(identity(item));
    if (index < 0) return true;
    remaining.splice(index, 1); return false;
  });
  const reimbursements = input.allocations.filter(item => item.kind === 'REIMBURSEMENT_SETTLEMENT');
  const priorReimbursements = movement.allocation_version > 0 ? (await db.prepare(`SELECT DISTINCT reimbursement_id AS id
    FROM finance_allocation_current WHERE movement_id=? AND kind='REIMBURSEMENT_SETTLEMENT'`).bind(id).all()).results.map(row => row.id) : [];
  if (reimbursements.length || priorReimbursements.length)
    await allow(db, context, requestId, 'finance.expense.read', 'finance_reimbursement');
  if (changesPrior && (typeof input.reason !== 'string' || input.reason.trim().length < 3 || input.reason.trim().length > 240))
    throw new AppError(400, 'allocation_correction_reason_required');
  if (input.reason !== undefined && (typeof input.reason !== 'string' || input.reason.trim().length < 3 || input.reason.trim().length > 240))
    fail('invalid_allocation');
  if (reimbursements.length) {
    if (movement.amount_cents >= 0 || movement.position_kind !== 'BANK') throw new AppError(409, 'invalid_reimbursement_settlement');
    const ids = [...new Set(reimbursements.map(item => item.reimbursementId))];
    const rows = (await db.prepare(`SELECT r.id,r.recipient_id,r.amount_cents,r.status,e.status AS expense_status,e.payment_method,
      e.advanced_by_id,r.cancelled_at,EXISTS(SELECT 1 FROM finance_expense_evidence d WHERE d.expense_id=e.id
        AND d.object_purged_at IS NULL AND d.superseded_at IS NULL) AS has_evidence,
      COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a WHERE a.reimbursement_id=r.id AND a.movement_id!=?),0) AS settled_elsewhere
      FROM finance_reimbursement r JOIN finance_expense e ON e.id=r.expense_id WHERE r.id IN (${ids.map(() => '?').join(',')})`)
      .bind(id, ...ids).all()).results;
    if (rows.length !== ids.length || new Set(rows.map(row => row.recipient_id)).size !== 1 || rows.some(row =>
      row.status !== 'APPROVED' || row.cancelled_at != null || row.expense_status !== 'RECOGNISED' || row.payment_method !== 'ADVANCED' ||
      row.advanced_by_id !== row.recipient_id || !row.has_evidence ||
      row.settled_elsewhere + reimbursements.filter(item => item.reimbursementId === row.id)
        .reduce((sum, item) => sum + item.amountCents, 0) > row.amount_cents))
      throw new AppError(409, 'invalid_reimbursement_settlement');
  }
  const next = input.expectedVersion + 1;
  await commit(db, [
    ...(changesPrior ? [db.prepare(`INSERT INTO finance_allocation_correction(movement_id,set_version,reason,changed_by,changed_at)
      VALUES(?,?,?,?,?)`).bind(id, next, input.reason.trim(), context.userId, now)] : []),
    db.prepare(`UPDATE finance_movement SET ${versionCas('allocation_version')} WHERE id=?`).bind(input.expectedVersion, id),
    ...await allocationRows(db, context, id, next, input.allocations, now),
    audit(db, context, requestId, input.expectedVersion === 0 ? 'MOVEMENT_CLASSIFIED' : 'MOVEMENT_RECLASSIFIED', 'finance_movement', id, now),
    ...(changesPrior ? [audit(db, context, requestId, 'FINANCE_ALLOCATION_CORRECTED', 'finance_movement', id, now)] : []),
    ...[...new Set([...priorReimbursements, ...idsForAudit(input.allocations, 'REIMBURSEMENT_SETTLEMENT')])].map(reimbursementId =>
      audit(db, context, requestId, input.expectedVersion === 0 ? 'REIMBURSEMENT_SETTLED' : 'REIMBURSEMENT_SETTLEMENT_REVISED',
        'finance_reimbursement', reimbursementId, now, { metadata: { amountCents: reimbursements.filter(item =>
          item.reimbursementId === reimbursementId).reduce((sum, item) => sum + item.amountCents, 0) } })),
    ...[...new Set(input.allocations.map(item => item.incomeId).filter(Boolean))]
      .map(incomeId => audit(db, context, requestId, 'INCOME_RECONCILED', 'finance_income', incomeId, now)),
    ...[...new Set([...prior, ...input.allocations].map(item => item.feePaymentId).filter(Boolean))]
      .map(paymentId => audit(db, context, requestId, 'FEE_RECEIPT_RECONCILED', 'annual_fee_payment', paymentId, now)),
    ...[...new Set([...prior, ...input.allocations].map(item => item.activityAllocationId).filter(Boolean))]
      .map(allocationId => audit(db, context, requestId, 'ACTIVITY_RECEIPT_RECONCILED', 'activity_payment_allocation', allocationId, now))
  ], 'stale_movement');
  return { id, allocationVersion: next };
}
const idsForAudit = (allocations, kind) => [...new Set(allocations.filter(item => item.kind === kind).map(item => item.reimbursementId))];
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

/** Classify an outgoing bank/card/cash movement as a new expense in one step: the expense is recognised
 *  (a direct treasury expense, paid by the position's method) and settled by this movement, keeping the
 *  movement's other current allocations. One economic fact, counted once. */
export async function expenseFromMovement(db, storage, context, requestId, id, input, now = Date.now()) {
  await allow(db, context, requestId, 'finance.movement.classify', 'finance_movement', validUuid(id) ? id : null);
  await allow(db, context, requestId, 'finance.expense.manage', 'finance_expense');
  if (!keysOnly(input, ['expectedVersion', 'roundId', 'expenseDate', 'concept', 'counterpartyId', 'supplierLabel', 'lines', 'evidence']) ||
      !version(input.expectedVersion) || !validUuid(input.roundId) || !isDate(input.expenseDate) ||
      typeof input.concept !== 'string' || !input.concept.trim() || input.concept.length > 120 || !optionalId(input.counterpartyId) ||
      (input.supplierLabel != null && (!syntheticName(input.supplierLabel) || input.supplierLabel.length > 80)) ||
      !Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 50) fail('invalid_expense');
  for (const line of input.lines) if (!keysOnly(line, ['budgetLineId', 'amountCents', 'activityId', 'sectionId']) || !validUuid(line.budgetLineId) ||
      !cents(line.amountCents) || !optionalId(line.activityId) || !optionalId(line.sectionId)) fail('invalid_expense');
  if (!input.evidence) throw new AppError(409, 'expense_evidence_required');
  const movement = await db.prepare(`SELECT m.state,m.amount_cents,m.allocation_version,p.kind FROM finance_movement m JOIN finance_position p ON p.id=m.position_id
    WHERE m.id=?`).bind(requireUuid(id)).first();
  if (!movement) throw notFound();
  if (movement.state !== 'ACTIVE') throw new AppError(409, 'movement_voided');
  if (movement.amount_cents >= 0) throw new AppError(409, 'invalid_allocation_direction');
  const total = input.lines.reduce((sum, line) => sum + line.amountCents, 0);
  const existing = (await db.prepare(`SELECT kind,amount_cents AS amountCents,budget_line_id AS budgetLineId,expense_id AS expenseId,
    paired_movement_id AS pairedMovementId,income_id AS incomeId,reimbursement_id AS reimbursementId,
    fee_payment_id AS feePaymentId,activity_allocation_id AS activityAllocationId,
    activity_id AS activityId,section_id AS sectionId FROM finance_allocation WHERE movement_id=? AND set_version=?
    ORDER BY created_at,id`).bind(id, movement.allocation_version).all()).results;
  if (movement.allocation_version !== input.expectedVersion) throw new AppError(409, 'stale_movement');
  const expenseId = uuid(), next = input.expectedVersion + 1;
  const keep = keptAllocations(existing);
  const evidence = await prepareExpenseEvidence(input.evidence);
  await commitWithEvidence(db, storage, evidence, [
    db.prepare(`INSERT INTO finance_expense(id,round_id,expense_date,concept,counterparty_id,supplier_label,total_cents,payment_method,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(expenseId, input.roundId, input.expenseDate, input.concept.trim(), input.counterpartyId ?? null,
      input.supplierLabel?.trim() ?? null, total, movement.kind, context.userId, now, now),
    ...input.lines.map((line, index) => db.prepare(`INSERT INTO finance_expense_line(expense_id,lines_version,line_no,budget_line_id,amount_cents,activity_id,section_id)
      VALUES(?,1,?,?,?,?,?)`).bind(expenseId, index + 1, line.budgetLineId, line.amountCents, line.activityId ?? null, line.sectionId ?? null)),
    ...evidenceStatements(db, context, requestId, expenseId, evidence, now),
    db.prepare(`UPDATE finance_expense SET version=2,status='RECOGNISED',recognized_by=?,recognized_at=?,updated_at=? WHERE id=? AND version=1`)
      .bind(context.userId, now, now, expenseId),
    db.prepare(`UPDATE finance_movement SET ${versionCas('allocation_version')} WHERE id=?`).bind(input.expectedVersion, id),
    ...await allocationRows(db, context, id, next, [...keep, { kind: 'EXPENSE_SETTLEMENT', amountCents: total, expenseId }], now),
    audit(db, context, requestId, 'EXPENSE_RECOGNISED', 'finance_expense', expenseId, now),
    audit(db, context, requestId, input.expectedVersion === 0 ? 'MOVEMENT_CLASSIFIED' : 'MOVEMENT_RECLASSIFIED', 'finance_movement', id, now)
  ], 'stale_movement');
  return { expenseId, allocationVersion: next };
}

/** Inici de Tresoreria: what needs attention now, from the blocks the user may read. */
/** Classify an incoming movement as a new general income in one step: the income is created and
 *  collected by this movement (an INCOME allocation that names it), so it counts once. Existing parts of
 *  the set are kept. Symmetric to expenseFromMovement. */
export async function incomeFromMovement(db, context, requestId, id, input, now = Date.now()) {
  await allow(db, context, requestId, 'finance.movement.classify', 'finance_movement', validUuid(id) ? id : null);
  await allow(db, context, requestId, 'finance.income.manage', 'finance_income');
  if (!keysOnly(input, ['expectedVersion', 'roundId', 'incomeDate', 'concept', 'totalCents', 'budgetLineId', 'counterpartyId']) ||
      !version(input.expectedVersion)) fail('invalid_income');
  validIncome(input, true);
  const movement = await db.prepare('SELECT state,amount_cents,allocation_version FROM finance_movement WHERE id=?').bind(requireUuid(id)).first();
  if (!movement) throw notFound();
  if (movement.state !== 'ACTIVE') throw new AppError(409, 'movement_voided');
  if (movement.amount_cents <= 0) throw new AppError(409, 'invalid_allocation_direction');
  if (movement.allocation_version !== input.expectedVersion) throw new AppError(409, 'stale_movement');
  const existing = (await db.prepare(`SELECT kind,amount_cents AS amountCents,budget_line_id AS budgetLineId,expense_id AS expenseId,
    paired_movement_id AS pairedMovementId,income_id AS incomeId,reimbursement_id AS reimbursementId,
    fee_payment_id AS feePaymentId,activity_allocation_id AS activityAllocationId,
    activity_id AS activityId,section_id AS sectionId FROM finance_allocation
    WHERE movement_id=? AND set_version=? ORDER BY created_at,id`).bind(id, movement.allocation_version).all()).results;
  const incomeId = uuid(), next = input.expectedVersion + 1;
  await commit(db, [
    insertIncome(db, context, incomeId, input, now),
    db.prepare(`UPDATE finance_movement SET ${versionCas('allocation_version')} WHERE id=?`).bind(input.expectedVersion, id),
    ...await allocationRows(db, context, id, next, [...keptAllocations(existing),
      { kind: 'INCOME', amountCents: input.totalCents, incomeId, newIncome: { round_id: input.roundId, budget_line_id: input.budgetLineId } }], now),
    audit(db, context, requestId, 'INCOME_CREATED', 'finance_income', incomeId, now),
    audit(db, context, requestId, 'INCOME_RECONCILED', 'finance_income', incomeId, now),
    audit(db, context, requestId, input.expectedVersion === 0 ? 'MOVEMENT_CLASSIFIED' : 'MOVEMENT_RECLASSIFIED', 'finance_movement', id, now)
  ], 'stale_movement');
  return { incomeId, allocationVersion: next };
}
export async function treasurySummary(db, context, requestId) {
  const can = async permission => (await authorize(db, context, { permission })).allow;
  const [treasury, movementsRead, expensesRead, incomesRead] = await Promise.all(['finance.treasury.read', 'finance.movement.read', 'finance.expense.read',
    'finance.income.read'].map(can));
  if (!treasury && !movementsRead && !expensesRead && !incomesRead) await allow(db, context, requestId, 'finance.treasury.read', 'finance_round');
  const round = await db.prepare("SELECT id,code,period_start AS periodStart,period_end AS periodEnd,status FROM finance_round WHERE status='OPEN'").first();
  const result = { round: round ?? null };
  if (treasury && round) {
    const positions = (await db.prepare('SELECT id,kind,name,status FROM finance_position WHERE status=\'ACTIVE\' ORDER BY kind,name').all()).results;
    result.positions = await Promise.all(positions.map(async position => {
      const opening = await db.prepare('SELECT amount_cents FROM finance_opening_balance_current WHERE round_id=? AND position_id=?').bind(round.id, position.id).first();
      const moved = await db.prepare(`SELECT COALESCE(sum(amount_cents),0) AS total FROM finance_movement WHERE position_id=? AND state='ACTIVE'
        AND operation_date>=? AND operation_date<=?`).bind(position.id, round.periodStart, round.periodEnd).first();
      const balance = (opening?.amount_cents ?? 0) + moved.total;
      return { id: position.id, kind: position.kind, name: position.name, balanceCents: balance, hasOpening: !!opening };
    }));
  }
  // Position names for filters and pickers (no balances unless treasury.read, above).
  if (movementsRead || expensesRead || incomesRead) result.positionOptions = (await db.prepare(`SELECT id,kind,name,status FROM finance_position ORDER BY kind,name,id`).all()).results;
  if (movementsRead) {
    const counts = await db.prepare(`SELECT
      (SELECT count(*) FROM ${MOVEMENT_FROM} WHERE ${STATUS_FILTERS.pending}) AS pending,
      (SELECT count(*) FROM ${MOVEMENT_FROM} WHERE ${STATUS_FILTERS.partial}) AS partial,
      (SELECT count(*) FROM ${MOVEMENT_FROM} WHERE ${STATUS_FILTERS.duplicates}) AS duplicates,
      (SELECT count(*) FROM ${MOVEMENT_FROM} WHERE ${STATUS_FILTERS.pending} AND m.amount_cents>0) AS unidentifiedIncoming`).first();
    const recent = (await db.prepare(`SELECT ${MOVEMENT_FIELDS} FROM ${MOVEMENT_FROM} WHERE m.state='ACTIVE' ORDER BY m.operation_date DESC,m.id DESC LIMIT 5`).all()).results;
    const batches = (await db.prepare(`SELECT b.id,p.name AS positionName,b.source_format AS format,b.row_count AS rowCount,b.created_count AS createdCount,
      b.duplicate_count AS duplicateCount,b.flagged_count AS flaggedCount,b.status,b.imported_at AS importedAt FROM finance_import_batch b
      JOIN finance_position p ON p.id=b.position_id ORDER BY b.imported_at DESC LIMIT 3`).all()).results;
    result.movements = { pendingCount: counts.pending, partialCount: counts.partial, duplicateCount: counts.duplicates, unidentifiedIncomingCount: counts.unidentifiedIncoming,
      recent: recent.map(row => ({ ...brief(row), allocatedCents: row.allocatedCents })), recentBatches: batches };
  }
  if (expensesRead && round) {
    const proposed = await db.prepare(`SELECT count(*) AS n,COALESCE(sum(total_cents),0) AS total FROM finance_expense WHERE round_id=? AND status='PROPOSED'`)
      .bind(round.id).first();
    const recent = (await db.prepare(`SELECT id FROM finance_expense WHERE round_id=? AND status='RECOGNISED' ORDER BY recognized_at DESC,id DESC LIMIT 5`)
      .bind(round.id).all()).results.map(row => row.id);
    const summaries = await expenseSummaries(db, recent);
    result.expenses = { proposedCount: proposed.n, proposedCents: proposed.total, recentRecognised: recent.map(expenseId => summaries.get(expenseId)) };
  }
  if (incomesRead && round) {
    const open = await db.prepare(`SELECT count(*) AS n,COALESCE(sum(i.total_cents-COALESCE(x.reconciled,0)),0) AS pending FROM finance_income i
      LEFT JOIN (SELECT income_id,sum(amount_cents) AS reconciled FROM finance_allocation_current WHERE income_id IS NOT NULL GROUP BY income_id) x
        ON x.income_id=i.id
      WHERE i.round_id=? AND i.status='ACTIVE' AND COALESCE(x.reconciled,0)<i.total_cents`).bind(round.id).first();
    result.incomes = { pendingCount: open.n, pendingCents: open.pending };
  }
  return result;
}
