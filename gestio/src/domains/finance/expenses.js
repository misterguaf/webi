// FASE 3.5G.1 — minimal counterparties and expenses with versioned lines (TREASURY.md §10).
// PROPOSED ≠ RECOGNISED: only a recognised expense counts, once, whatever settles it.
import { versionCas } from '../../concurrency.js';
import { append } from '../audit/repository.js';
import { AppError, requireUuid, validUuid } from '../../services/common.js';
import { allow, audit, cents, commit, fail, isDate, keysOnly, notFound, optionalId, syntheticName, uuid, version } from './shared.js';
import { budgetLineLabels } from './read-models.js';
import { authorize } from '../../policy.js';
import { prepareExpenseEvidence, evidenceStatements, commitWithEvidence, verifiedEvidenceExists } from './evidence.js';
import { approvedReimbursementStatements } from './reimbursements.js';

// ---------------------------------------------------------------- counterparties
const COUNTERPARTY_FIELDS = 'id,kind,display_name AS displayName,user_id AS userId,status,version';
// Counterparties serve expenses and incomes: either capability is enough (the denial is audited as before).
async function allowEither(db, context, requestId, permissions, resourceType) {
  for (const permission of permissions.slice(1)) if ((await authorize(db, context, { permission })).allow) return;
  await allow(db, context, requestId, permissions[0], resourceType);
}
export async function listCounterparties(db, context, requestId) {
  await allowEither(db, context, requestId, ['finance.expense.read', 'finance.income.read'], 'finance_counterparty');
  return { counterparties: (await db.prepare(`SELECT ${COUNTERPARTY_FIELDS} FROM finance_counterparty ORDER BY display_name,id LIMIT 500`).all()).results };
}
async function activeUser(db, id) { return !!await db.prepare("SELECT 1 FROM app_user WHERE id=? AND status='ACTIVE'").bind(id).first(); }
export async function createCounterparty(db, context, requestId, input, now = Date.now()) {
  await allowEither(db, context, requestId, ['finance.expense.manage', 'finance.income.manage'], 'finance_counterparty');
  if (!keysOnly(input, ['kind', 'displayName', 'userId']) || !['PERSON', 'ORGANIZATION'].includes(input.kind) || !syntheticName(input.displayName) ||
      !optionalId(input.userId) || (input.userId != null && input.kind !== 'PERSON')) fail('invalid_counterparty');
  if (input.userId != null && !await activeUser(db, input.userId)) fail('invalid_counterparty');
  const id = uuid();
  await commit(db, [
    db.prepare(`INSERT INTO finance_counterparty(id,kind,display_name,user_id,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`)
      .bind(id, input.kind, input.displayName.trim(), input.userId ?? null, context.userId, now, now),
    audit(db, context, requestId, 'COUNTERPARTY_CREATED', 'finance_counterparty', id, now),
    ...(input.userId != null ? [audit(db, context, requestId, 'COUNTERPARTY_USER_LINKED', 'finance_counterparty', id, now)] : [])
  ]);
  return { id, version: 1 };
}
export async function updateCounterparty(db, context, requestId, id, input, now = Date.now()) {
  await allow(db, context, requestId, 'finance.expense.manage', 'finance_counterparty', validUuid(id) ? id : null);
  const row = await db.prepare('SELECT * FROM finance_counterparty WHERE id=?').bind(requireUuid(id)).first();
  if (!row) throw notFound();
  if (!keysOnly(input, ['displayName', 'userId', 'status', 'expectedVersion']) || !version(input.expectedVersion) ||
      (input.displayName !== undefined && !syntheticName(input.displayName)) || (input.userId !== undefined && !optionalId(input.userId)) ||
      (input.status !== undefined && !['ACTIVE', 'INACTIVE'].includes(input.status)) ||
      (input.userId != null && row.kind !== 'PERSON')) fail('invalid_counterparty');
  if (input.userId != null && !await activeUser(db, input.userId)) fail('invalid_counterparty');
  const userId = input.userId === undefined ? row.user_id : input.userId;
  const linkChanged = userId !== row.user_id;
  await commit(db, [
    db.prepare(`INSERT INTO finance_counterparty_revision(id,counterparty_id,previous_version,previous_display_name,previous_user_id,previous_status,
      changed_by,changed_at) VALUES(?,?,?,?,?,?,?,?)`).bind(uuid(), id, row.version, row.display_name, row.user_id, row.status, context.userId, now),
    db.prepare(`UPDATE finance_counterparty SET ${versionCas('version')},display_name=?,user_id=?,status=?,updated_at=? WHERE id=?`)
      .bind(input.expectedVersion, input.displayName?.trim() ?? row.display_name, userId, input.status ?? row.status, now, id),
    audit(db, context, requestId, 'COUNTERPARTY_REVISED', 'finance_counterparty', id, now),
    ...(linkChanged ? [audit(db, context, requestId, userId ? 'COUNTERPARTY_USER_LINKED' : 'COUNTERPARTY_USER_UNLINKED', 'finance_counterparty', id, now)] : [])
  ], 'stale_counterparty');
  return { id, version: input.expectedVersion + 1 };
}

// ---------------------------------------------------------------- expenses
const EXPENSE_FIELDS = `id,round_id AS roundId,expense_date AS expenseDate,concept,counterparty_id AS counterpartyId,supplier_label AS supplierLabel,
  total_cents AS totalCents,payment_method AS paymentMethod,advanced_by_id AS advancedById,status,lines_version AS linesVersion,version,
  created_at AS createdAt,recognized_at AS recognizedAt,rejected_at AS rejectedAt,voided_at AS voidedAt,void_reason AS voidReason`;
function validLines(lines) {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 50) fail('invalid_expense');
  for (const line of lines) if (!keysOnly(line, ['budgetLineId', 'amountCents', 'activityId', 'sectionId']) || !validUuid(line.budgetLineId) ||
    !cents(line.amountCents) || !optionalId(line.activityId) || !optionalId(line.sectionId)) fail('invalid_expense');
}
function validHeader(input, creating) {
  if (creating || input.roundId !== undefined) if (!validUuid(input.roundId)) fail('invalid_expense');
  if (creating || input.expenseDate !== undefined) if (!isDate(input.expenseDate)) fail('invalid_expense');
  if (creating || input.totalCents !== undefined) if (!cents(input.totalCents)) fail('invalid_expense');
  if (creating || input.paymentMethod !== undefined) if (!['BANK', 'CARD', 'CASH', 'ADVANCED'].includes(input.paymentMethod)) fail('invalid_expense');
  if (input.counterpartyId !== undefined && !optionalId(input.counterpartyId)) fail('invalid_expense');
  if (input.advancedById !== undefined && !optionalId(input.advancedById)) fail('invalid_expense');
  if (input.supplierLabel != null && !syntheticName(input.supplierLabel)) fail('invalid_expense');
  if (input.concept != null && (typeof input.concept !== 'string' || !input.concept.trim() || input.concept.length > 120)) fail('invalid_expense');
  if (input.supplierLabel != null && input.supplierLabel.length > 80) fail('invalid_expense');
}
const correctionReason = value => typeof value === 'string' && value.trim().length >= 3 && value.trim().length <= 240;
const lineStatements = (db, expenseId, linesVersion, lines) => lines.map((line, index) => db.prepare(`INSERT INTO finance_expense_line
  (expense_id,lines_version,line_no,budget_line_id,amount_cents,activity_id,section_id) VALUES(?,?,?,?,?,?,?)`)
  .bind(expenseId, linesVersion, index + 1, line.budgetLineId, line.amountCents, line.activityId ?? null, line.sectionId ?? null));
// Ordinary expense authority does not allow own-beneficiary recognition. The explicit Treasury
// exception is checked against the authenticated session here; D1 only checks its structural marker.
async function refuseSelfRecognition(db, context, requestId, advancedById, id) {
  if (!advancedById) return false;
  const person = await db.prepare('SELECT user_id FROM finance_counterparty WHERE id=?').bind(advancedById).first();
  if (person?.user_id && person.user_id === context.userId) {
    if ((await authorize(db, context, { permission: 'finance.reimbursement.self_approve' })).allow) return true;
    await append(db, { requestId, actorUserId: context.userId, sessionId: context.sessionId, action: 'AUTHZ_DENY',
      resourceType: 'finance_expense', resourceId: id, result: 'DENY', reasonCode: 'SELF_APPROVAL' });
    throw new AppError(403, 'self_approval');
  }
  return false;
}
/** Create a proposed expense, or recognise it with a stored receipt in the same controlled batch. */
export async function createExpense(db, storage, context, requestId, input, now = Date.now()) {
  await allow(db, context, requestId, 'finance.expense.manage', 'finance_expense');
  if (!keysOnly(input, ['roundId', 'expenseDate', 'concept', 'counterpartyId', 'supplierLabel', 'totalCents', 'paymentMethod', 'advancedById', 'lines', 'recognise', 'evidence']))
    fail('invalid_expense');
  validHeader(input, true);
  if ((input.paymentMethod === 'ADVANCED') !== (input.advancedById != null)) fail('invalid_expense');
  const recognise = input.recognise === true;
  if (input.recognise !== undefined && typeof input.recognise !== 'boolean') fail('invalid_expense');
  if (recognise && !input.evidence) throw new AppError(409, 'expense_evidence_required');
  if (input.lines !== undefined || recognise) validLines(input.lines);
  if (recognise && input.lines.reduce((sum, line) => sum + line.amountCents, 0) !== input.totalCents) throw new AppError(409, 'expense_lines_total_mismatch');
  const id = uuid();
  const selfApproved = recognise ? await refuseSelfRecognition(db, context, requestId, input.advancedById, id) : false;
  const evidence = input.evidence ? await prepareExpenseEvidence(input.evidence) : null;
  const reimbursement = recognise && input.paymentMethod === 'ADVANCED'
    ? approvedReimbursementStatements(db, context, requestId, id, input.advancedById, input.totalCents, selfApproved, now) : null;
  const statements = [
    db.prepare(`INSERT INTO finance_expense(id,round_id,expense_date,concept,counterparty_id,supplier_label,total_cents,payment_method,advanced_by_id,
      created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, input.roundId, input.expenseDate, input.concept?.trim() ?? null, input.counterpartyId ?? null,
      input.supplierLabel?.trim() ?? null, input.totalCents, input.paymentMethod, input.advancedById ?? null, context.userId, now, now),
    ...lineStatements(db, id, 1, input.lines ?? []),
    ...(evidence ? evidenceStatements(db, context, requestId, id, evidence, now) : []),
    ...(recognise ? [db.prepare(`UPDATE finance_expense SET ${versionCas('version')},status='RECOGNISED',recognized_by=?,recognized_at=?,
      self_approval_exception=?,updated_at=? WHERE id=?`).bind(1, context.userId, now, selfApproved ? 1 : 0, now, id)] : []),
    ...(reimbursement?.statements ?? []),
    audit(db, context, requestId, recognise ? 'EXPENSE_RECOGNISED' : 'EXPENSE_PROPOSED', 'finance_expense', id, now)
  ];
  if (evidence) await commitWithEvidence(db, storage, evidence, statements);
  else await commit(db, statements);
  return { id, status: recognise ? 'RECOGNISED' : 'PROPOSED', version: recognise ? 2 : 1,
    ...(reimbursement ? { reimbursementId: reimbursement.id } : {}) };
}
async function expenseRow(db, id) {
  const row = await db.prepare('SELECT * FROM finance_expense WHERE id=?').bind(requireUuid(id)).first();
  if (!row) throw notFound();
  return row;
}
/** Revision: the previous header is kept in finance_expense_revision; new lines form a new set. */
export async function reviseExpense(db, context, requestId, id, input, now = Date.now()) {
  await allow(db, context, requestId, 'finance.expense.manage', 'finance_expense', validUuid(id) ? id : null);
  const row = await expenseRow(db, id);
  if (!keysOnly(input, ['roundId', 'expenseDate', 'concept', 'counterpartyId', 'supplierLabel', 'totalCents', 'paymentMethod', 'advancedById', 'lines', 'expectedVersion', 'reason']) ||
      !version(input.expectedVersion)) fail('invalid_expense');
  validHeader(input, false);
  if (input.lines !== undefined) validLines(input.lines);
  if (!['PROPOSED', 'RECOGNISED'].includes(row.status)) throw new AppError(409, 'invalid_transition');
  if (row.status === 'RECOGNISED' && !correctionReason(input.reason)) throw new AppError(400, 'expense_correction_reason_required');
  if (row.status === 'PROPOSED' && input.reason !== undefined) fail('invalid_expense');
  const next = { round: input.roundId ?? row.round_id, date: input.expenseDate ?? row.expense_date,
    concept: input.concept === undefined ? row.concept : input.concept?.trim() ?? null,
    counterparty: input.counterpartyId === undefined ? row.counterparty_id : input.counterpartyId,
    supplier: input.supplierLabel === undefined ? row.supplier_label : input.supplierLabel?.trim() ?? null,
    total: input.totalCents ?? row.total_cents, method: input.paymentMethod ?? row.payment_method,
    advanced: input.advancedById === undefined ? row.advanced_by_id : input.advancedById };
  if ((next.method === 'ADVANCED') !== (next.advanced != null)) fail('invalid_expense');
  const newLines = input.lines !== undefined || next.round !== row.round_id;
  if (next.round !== row.round_id && input.lines === undefined) fail('expense_lines_required');
  if (row.status === 'RECOGNISED' && next.total !== row.total_cents && !input.lines) throw new AppError(409, 'expense_lines_required');
  if (row.status === 'RECOGNISED' && input.lines && input.lines.reduce((sum, line) => sum + line.amountCents, 0) !== next.total)
    throw new AppError(409, 'expense_lines_total_mismatch');
  const linesVersion = newLines ? row.lines_version + 1 : row.lines_version;
  const activeReimbursement = row.status === 'RECOGNISED' ? await db.prepare(`SELECT r.id,r.approved_by AS approvedBy,
    COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a WHERE a.reimbursement_id=r.id
      AND a.kind='REIMBURSEMENT_SETTLEMENT'),0) AS settledCents FROM finance_reimbursement r
    WHERE r.expense_id=? AND r.status='APPROVED' AND r.cancelled_at IS NULL`).bind(id).first() : null;
  const liabilityChanged = next.total !== row.total_cents || next.advanced !== row.advanced_by_id ||
    next.method !== row.payment_method;
  if (activeReimbursement?.settledCents && liabilityChanged) throw new AppError(409, 'reimbursement_settlement_locked');
  const beneficiaryUser = next.advanced ? await db.prepare('SELECT user_id AS userId FROM finance_counterparty WHERE id=?').bind(next.advanced).first() : null;
  if (activeReimbursement && next.advanced !== row.advanced_by_id && beneficiaryUser?.userId === activeReimbursement.approvedBy &&
    context.userId !== activeReimbursement.approvedBy) throw new AppError(403, 'self_approval');
  const selfRecognized = row.status === 'RECOGNISED' && next.method === 'ADVANCED' &&
    beneficiaryUser?.userId === row.recognized_by;
  if (selfRecognized && !row.self_approval_exception) {
    if (context.userId !== row.recognized_by) throw new AppError(403, 'self_approval');
    await refuseSelfRecognition(db, context, requestId, next.advanced, id);
  }
  const selfApproved = next.method === 'ADVANCED' && beneficiaryUser?.userId === context.userId
    ? await refuseSelfRecognition(db, context, requestId, next.advanced, id) : false;
  const newReimbursement = row.status === 'RECOGNISED' && next.method === 'ADVANCED' && !activeReimbursement
    ? approvedReimbursementStatements(db, context, requestId, id, next.advanced, next.total, selfApproved, now) : null;
  const revisionId = row.status === 'RECOGNISED' ? uuid() : null;
  await commit(db, [
    ...(revisionId ? [db.prepare(`INSERT INTO finance_expense_revision(id,expense_id,previous_version,previous_round_id,previous_expense_date,previous_counterparty_id,
      previous_supplier_label,previous_total_cents,previous_payment_method,previous_advanced_by_id,previous_lines_version,changed_by,changed_at,previous_concept,previous_status,reason)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(revisionId, id, row.version, row.round_id, row.expense_date, row.counterparty_id, row.supplier_label,
      row.total_cents, row.payment_method, row.advanced_by_id, row.lines_version, context.userId, now, row.concept, row.status, input.reason.trim())] : []),
    ...(newLines ? lineStatements(db, id, linesVersion, input.lines) : []),
    db.prepare(`UPDATE finance_expense SET ${versionCas('version')},round_id=?,expense_date=?,concept=?,counterparty_id=?,supplier_label=?,total_cents=?,
      payment_method=?,advanced_by_id=?,lines_version=?,self_approval_exception=?,updated_at=? WHERE id=?`).bind(input.expectedVersion, next.round, next.date, next.concept, next.counterparty,
      next.supplier, next.total, next.method, next.advanced, linesVersion, selfRecognized ? 1 : 0, now, id),
    ...(newReimbursement?.statements ?? []),
    audit(db, context, requestId, row.status === 'PROPOSED' ? 'EXPENSE_DRAFT_EDITED' : 'EXPENSE_CORRECTED', 'finance_expense', id, now),
    ...(activeReimbursement && liabilityChanged ? [audit(db, context, requestId,
      next.method === 'ADVANCED' ? 'REIMBURSEMENT_CORRECTED' : 'REIMBURSEMENT_CANCELLED',
      'finance_reimbursement', activeReimbursement.id, now)] : [])
  ], 'stale_expense');
  return { id, version: input.expectedVersion + 1, linesVersion };
}
const DECISIONS = {
  recognise: { from: 'PROPOSED', set: "status='RECOGNISED',recognized_by=?,recognized_at=?", action: 'EXPENSE_RECOGNISED', status: 'RECOGNISED' },
  reject: { from: 'PROPOSED', set: "status='REJECTED',rejected_by=?,rejected_at=?", action: 'EXPENSE_REJECTED', status: 'REJECTED' },
  void: { from: 'RECOGNISED', set: "status='VOID',voided_by=?,voided_at=?,void_reason=?", action: 'EXPENSE_VOIDED', status: 'VOID' }
};
export async function decideExpense(db, storage, context, requestId, id, kind, input, now = Date.now()) {
  await allow(db, context, requestId, 'finance.expense.manage', 'finance_expense', validUuid(id) ? id : null);
  const row = await expenseRow(db, id);
  const step = DECISIONS[kind];
  if (!keysOnly(input, kind === 'void' ? ['expectedVersion', 'reason'] : ['expectedVersion']) || !version(input.expectedVersion) ||
      (kind === 'void' && !correctionReason(input.reason))) fail('invalid_expense');
  if (row.status !== step.from) throw new AppError(409, 'invalid_transition');
  let selfApproved = false;
  if (kind === 'recognise') {
    if (!await verifiedEvidenceExists(db, storage, id)) throw new AppError(409, 'expense_evidence_required');
    selfApproved = await refuseSelfRecognition(db, context, requestId, row.advanced_by_id, id);
    const lines = await db.prepare('SELECT COALESCE(sum(amount_cents),0) AS total FROM finance_expense_line WHERE expense_id=? AND lines_version=?')
      .bind(id, row.lines_version).first();
    if (lines.total !== row.total_cents) throw new AppError(409, 'expense_lines_total_mismatch');
  }
  const activeReimbursement = kind === 'void' ? await db.prepare(`SELECT r.id,EXISTS(SELECT 1 FROM finance_allocation_current a
    WHERE a.reimbursement_id=r.id AND a.kind='REIMBURSEMENT_SETTLEMENT') AS settled FROM finance_reimbursement r
    WHERE r.expense_id=? AND r.status='APPROVED' AND r.cancelled_at IS NULL`).bind(id).first() : null;
  if (activeReimbursement?.settled) throw new AppError(409, 'reimbursement_settlement_locked');
  const reimbursement = kind === 'recognise' && row.payment_method === 'ADVANCED'
    ? approvedReimbursementStatements(db, context, requestId, id, row.advanced_by_id, row.total_cents, selfApproved, now) : null;
  await commit(db, [
    ...(kind === 'void' ? [db.prepare(`INSERT INTO finance_expense_revision(id,expense_id,previous_version,previous_round_id,previous_expense_date,
      previous_counterparty_id,previous_supplier_label,previous_total_cents,previous_payment_method,previous_advanced_by_id,
      previous_lines_version,changed_by,changed_at,previous_concept,previous_status,reason)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(uuid(), id, row.version, row.round_id, row.expense_date, row.counterparty_id,
      row.supplier_label, row.total_cents, row.payment_method, row.advanced_by_id, row.lines_version,
      context.userId, now, row.concept, row.status, input.reason.trim())] : []),
    db.prepare(`UPDATE finance_expense SET ${versionCas('version')},${step.set},self_approval_exception=?,updated_at=? WHERE id=?`)
      .bind(input.expectedVersion, context.userId, now, ...(kind === 'void' ? [['DUPLICATE', 'ERROR', 'CANCELLED'].includes(input.reason) ? input.reason : 'CANCELLED'] : []), selfApproved ? 1 : row.self_approval_exception, now, id),
    ...(reimbursement?.statements ?? []),
    audit(db, context, requestId, kind === 'void' ? 'EXPENSE_CANCELLED' : step.action, 'finance_expense', id, now),
    ...(activeReimbursement ? [audit(db, context, requestId, 'REIMBURSEMENT_CANCELLED', 'finance_reimbursement', activeReimbursement.id, now)] : [])
  ], 'stale_expense');
  return { id, status: step.status, version: input.expectedVersion + 1,
    ...(reimbursement ? { reimbursementId: reimbursement.id } : {}) };
}
export async function listExpenses(db, context, requestId, params) {
  await allow(db, context, requestId, 'finance.expense.read', 'finance_expense');
  const roundId = params?.get('roundId'), status = params?.get('status'), from = params?.get('from'), to = params?.get('to');
  const budgetLineId = params?.get('budgetLineId'), counterpartyId = params?.get('counterpartyId'), method = params?.get('method');
  const outstanding = params?.get('outstanding');
  if (!roundId || !validUuid(roundId)) fail('invalid_filter');
  if (outstanding && outstanding !== '1') fail('invalid_filter');
  const filters = ['e.round_id=?'], binds = [roundId];
  if (status) { if (!['PROPOSED', 'RECOGNISED', 'REJECTED', 'VOID'].includes(status)) fail('invalid_filter'); filters.push('e.status=?'); binds.push(status); }
  else filters.push("e.status!='VOID'");
  if (from) { if (!isDate(from)) fail('invalid_filter'); filters.push('e.expense_date>=?'); binds.push(from); }
  if (to) { if (!isDate(to)) fail('invalid_filter'); filters.push('e.expense_date<=?'); binds.push(to); }
  if (method) { if (!['BANK', 'CARD', 'CASH', 'ADVANCED'].includes(method)) fail('invalid_filter'); filters.push('e.payment_method=?'); binds.push(method); }
  if (outstanding === '1') filters.push(`r.status='APPROVED' AND r.amount_cents>COALESCE((SELECT sum(x.amount_cents)
    FROM finance_allocation_current x WHERE x.reimbursement_id=r.id AND x.kind='REIMBURSEMENT_SETTLEMENT'),0)`);
  if (counterpartyId) { if (!validUuid(counterpartyId)) fail('invalid_filter'); filters.push('(e.counterparty_id=? OR e.advanced_by_id=?)'); binds.push(counterpartyId, counterpartyId); }
  // A heading selects every line below it.
  if (budgetLineId) {
    if (!validUuid(budgetLineId)) fail('invalid_filter');
    filters.push(`EXISTS(SELECT 1 FROM finance_expense_line x WHERE x.expense_id=e.id AND x.lines_version=e.lines_version AND x.budget_line_id IN
      (WITH RECURSIVE t(id) AS (SELECT ? UNION ALL SELECT l.id FROM finance_budget_line l JOIN t ON l.parent_id=t.id) SELECT id FROM t))`);
    binds.push(budgetLineId);
  }
  const rows = (await db.prepare(`SELECT ${EXPENSE_FIELDS.replace(/(^|,)\s*/g, '$1e.')},c.display_name AS counterpartyName,a.display_name AS advancedByName,
    (SELECT count(*) FROM finance_expense_line l WHERE l.expense_id=e.id AND l.lines_version=e.lines_version) AS lineCount,
    (SELECT l.budget_line_id FROM finance_expense_line l WHERE l.expense_id=e.id AND l.lines_version=e.lines_version ORDER BY l.amount_cents DESC,l.line_no LIMIT 1) AS mainLineId,
    COALESCE((SELECT sum(x.amount_cents) FROM finance_allocation_current x WHERE x.expense_id=e.id AND x.kind='EXPENSE_SETTLEMENT'),0) AS settledCents,
    r.id AS reimbursementId,r.amount_cents AS reimbursementCents,r.status AS reimbursementStatus,
    COALESCE((SELECT sum(x.amount_cents) FROM finance_allocation_current x WHERE x.reimbursement_id=r.id
      AND x.kind='REIMBURSEMENT_SETTLEMENT'),0) AS reimbursedCents
    FROM finance_expense e LEFT JOIN finance_counterparty c ON c.id=e.counterparty_id LEFT JOIN finance_counterparty a ON a.id=e.advanced_by_id
    LEFT JOIN finance_reimbursement r ON r.expense_id=e.id AND r.status!='REJECTED' AND r.cancelled_at IS NULL
    WHERE ${filters.join(' AND ')} ORDER BY e.expense_date DESC,e.id DESC LIMIT 500`).bind(...binds).all()).results;
  const lines = await budgetLineLabels(db, rows.map(row => row.mainLineId));
  return { expenses: rows.map(({ mainLineId, ...row }) => ({ ...row,
    outstandingCents: row.reimbursementId ? Math.max(0, row.reimbursementCents - row.reimbursedCents) : null,
    mainLine: lines.get(mainLineId) ?? null })) };
}
export async function expenseDetail(db, context, requestId, id) {
  await allow(db, context, requestId, 'finance.expense.read', 'finance_expense', validUuid(id) ? id : null);
  const expense = await db.prepare(`SELECT ${EXPENSE_FIELDS} FROM finance_expense WHERE id=?`).bind(requireUuid(id)).first();
  if (!expense) throw notFound();
  const names = (await db.prepare('SELECT id,display_name,kind FROM finance_counterparty WHERE id IN (?,?)')
    .bind(expense.counterpartyId ?? '', expense.advancedById ?? '').all()).results;
  const nameOf = counterpartyId => names.find(row => row.id === counterpartyId)?.display_name ?? null;
  const rawLines = (await db.prepare(`SELECT line_no AS lineNo,budget_line_id AS budgetLineId,amount_cents AS amountCents,activity_id AS activityId,
    section_id AS sectionId FROM finance_expense_line WHERE expense_id=? AND lines_version=? ORDER BY line_no`).bind(id, expense.linesVersion).all()).results;
  const labels = await budgetLineLabels(db, rawLines.map(row => row.budgetLineId));
  const lines = rawLines.map(row => ({ ...row, budgetLine: labels.get(row.budgetLineId) ?? null }));
  const settlements = (await db.prepare(`SELECT a.movement_id AS movementId,a.kind,a.amount_cents AS amountCents,m.operation_date AS operationDate,
    m.amount_cents AS movementAmountCents,m.display_label AS movementLabel,p.name AS positionName,p.kind AS positionKind FROM finance_allocation_current a
    JOIN finance_movement m ON m.id=a.movement_id JOIN finance_position p ON p.id=m.position_id WHERE a.expense_id=? ORDER BY m.operation_date,a.id`)
    .bind(id).all()).results;
  const revisions = (await db.prepare(`SELECT previous_version AS previousVersion,previous_total_cents AS previousTotalCents,previous_concept AS previousConcept,
    previous_expense_date AS previousExpenseDate,previous_lines_version AS previousLinesVersion,previous_status AS previousStatus,
    reason,changed_at AS changedAt FROM finance_expense_revision
    WHERE expense_id=? ORDER BY previous_version DESC`).bind(id).all()).results;
  const evidence = (await db.prepare(`SELECT id,detected_mime AS mime,size_bytes AS sizeBytes,created_at AS createdAt,
    object_purged_at IS NOT NULL AS purged,superseded_at AS supersededAt FROM finance_expense_evidence WHERE expense_id=? ORDER BY created_at`).bind(id).all()).results;
  const reimbursement = await db.prepare(`SELECT r.id,r.recipient_id AS recipientId,r.amount_cents AS amountCents,r.status,
    COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a WHERE a.reimbursement_id=r.id
      AND a.kind='REIMBURSEMENT_SETTLEMENT'),0) AS settledCents FROM finance_reimbursement r
    WHERE r.expense_id=? AND r.status!='REJECTED' AND r.cancelled_at IS NULL`).bind(id).first();
  const settled = settlements.filter(row => row.kind === 'EXPENSE_SETTLEMENT').reduce((sum, row) => sum + row.amountCents, 0);
  const refunded = settlements.filter(row => row.kind === 'EXPENSE_REFUND').reduce((sum, row) => sum + row.amountCents, 0);
  return { expense: { ...expense, counterpartyName: nameOf(expense.counterpartyId), advancedByName: nameOf(expense.advancedById),
    settledCents: settled, refundedCents: refunded,
    settlementState: settled === 0 ? 'UNSETTLED' : settled < expense.totalCents ? 'PARTIAL' : 'SETTLED' },
  lines, settlements, revisions,
  evidence: evidence.filter(item => !item.supersededAt),
  evidenceHistory: evidence.filter(item => !!item.supersededAt),
  reimbursement: reimbursement ? { ...reimbursement, outstandingCents: Math.max(0, reimbursement.amountCents - reimbursement.settledCents),
    paymentState: reimbursement.settledCents === 0 ? 'PENDING' : reimbursement.settledCents < reimbursement.amountCents ? 'PARTIAL' : 'PAID' } : null };
}
