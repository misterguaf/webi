// FASE 3.5G.2A (extensió) — general incomes as economic facts (TREASURY.md §34.3). The bank movement only
// confirms the money; reconciliation is derived from the current INCOME allocations that name the income.
import { versionCas } from '../../concurrency.js';
import { AppError, requireUuid, validUuid } from '../../services/common.js';
import { allow, audit, cents, commit, fail, isDate, keysOnly, notFound, optionalId, uuid, version } from './shared.js';
import { budgetLineLabels } from './read-models.js';

const INCOME_FIELDS = `i.id,i.round_id AS roundId,i.income_date AS incomeDate,i.concept,i.total_cents AS totalCents,
  i.budget_line_id AS budgetLineId,i.counterparty_id AS counterpartyId,c.display_name AS counterpartyName,i.status,i.version,
  i.created_at AS createdAt,i.voided_at AS voidedAt,
  COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a WHERE a.income_id=i.id),0) AS reconciledCents`;
const INCOME_FROM = 'finance_income i LEFT JOIN finance_counterparty c ON c.id=i.counterparty_id';
/** Derived, never stored: VOID, RECONCILED, PARTIAL or PENDING. */
export const incomeState = row => row.status === 'VOID' ? 'VOID' : row.reconciledCents >= row.totalCents ? 'RECONCILED'
  : row.reconciledCents > 0 ? 'PARTIAL' : 'PENDING';
const shape = (row, lines) => ({ ...row, state: incomeState(row), pendingCents: row.status === 'VOID' ? 0 : row.totalCents - row.reconciledCents,
  budgetLine: lines.get(row.budgetLineId) ?? null });

export function validIncome(input, creating) {
  if (creating || input.roundId !== undefined) if (!validUuid(input.roundId)) fail('invalid_income');
  if (creating || input.incomeDate !== undefined) if (!isDate(input.incomeDate)) fail('invalid_income');
  if (creating || input.concept !== undefined) if (typeof input.concept !== 'string' || !input.concept.trim() || input.concept.length > 120) fail('invalid_income');
  if (creating || input.totalCents !== undefined) if (!cents(input.totalCents)) fail('invalid_income');
  if (creating || input.budgetLineId !== undefined) if (!validUuid(input.budgetLineId)) fail('invalid_income');
  if (input.counterpartyId !== undefined && !optionalId(input.counterpartyId)) fail('invalid_income');
}
export const insertIncome = (db, context, id, input, now) => db.prepare(`INSERT INTO finance_income(id,round_id,income_date,concept,total_cents,
  budget_line_id,counterparty_id,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(id, input.roundId, input.incomeDate,
  input.concept.trim(), input.totalCents, input.budgetLineId, input.counterpartyId ?? null, context.userId, now, now);

/** A known income before its bank movement: pending reconciliation, no movement invented. */
export async function createIncome(db, context, requestId, input, now = Date.now()) {
  await allow(db, context, requestId, 'finance.income.manage', 'finance_income');
  if (!keysOnly(input, ['roundId', 'incomeDate', 'concept', 'totalCents', 'budgetLineId', 'counterpartyId'])) fail('invalid_income');
  validIncome(input, true);
  const id = uuid();
  await commit(db, [insertIncome(db, context, id, input, now), audit(db, context, requestId, 'INCOME_CREATED', 'finance_income', id, now)]);
  return { id, version: 1 };
}

export async function listIncomes(db, context, requestId, params) {
  await allow(db, context, requestId, 'finance.income.read', 'finance_income');
  const roundId = params?.get('roundId'), state = params?.get('state'), from = params?.get('from'), to = params?.get('to');
  const budgetLineId = params?.get('budgetLineId'), counterpartyId = params?.get('counterpartyId');
  if (!roundId || !validUuid(roundId)) fail('invalid_filter');
  const filters = ['i.round_id=?'], binds = [roundId];
  if (from) { if (!isDate(from)) fail('invalid_filter'); filters.push('i.income_date>=?'); binds.push(from); }
  if (to) { if (!isDate(to)) fail('invalid_filter'); filters.push('i.income_date<=?'); binds.push(to); }
  if (counterpartyId) { if (!validUuid(counterpartyId)) fail('invalid_filter'); filters.push('i.counterparty_id=?'); binds.push(counterpartyId); }
  if (budgetLineId) {
    if (!validUuid(budgetLineId)) fail('invalid_filter');
    filters.push(`i.budget_line_id IN (WITH RECURSIVE t(id) AS (SELECT ? UNION ALL SELECT l.id FROM finance_budget_line l JOIN t ON l.parent_id=t.id) SELECT id FROM t)`);
    binds.push(budgetLineId);
  }
  if (state && !['PENDING', 'PARTIAL', 'RECONCILED', 'VOID', 'OPEN'].includes(state)) fail('invalid_filter');
  const rows = (await db.prepare(`SELECT ${INCOME_FIELDS} FROM ${INCOME_FROM} WHERE ${filters.join(' AND ')}
    ORDER BY i.income_date DESC,i.id DESC LIMIT 500`).bind(...binds).all()).results;
  const lines = await budgetLineLabels(db, rows.map(row => row.budgetLineId));
  // OPEN = still waiting for money (pending or partial), the candidates for a reconciliation.
  const shaped = rows.map(row => shape(row, lines)).filter(row => !state || row.state === state || (state === 'OPEN' && ['PENDING', 'PARTIAL'].includes(row.state)));
  return { incomes: shaped };
}

export async function incomeDetail(db, context, requestId, id) {
  await allow(db, context, requestId, 'finance.income.read', 'finance_income', validUuid(id) ? id : null);
  const row = await db.prepare(`SELECT ${INCOME_FIELDS} FROM ${INCOME_FROM} WHERE i.id=?`).bind(requireUuid(id)).first();
  if (!row) throw notFound();
  const lines = await budgetLineLabels(db, [row.budgetLineId]);
  const income = shape(row, lines);
  const movements = (await db.prepare(`SELECT a.movement_id AS movementId,a.amount_cents AS amountCents,m.operation_date AS operationDate,
    m.amount_cents AS movementAmountCents,m.display_label AS label,p.name AS positionName FROM finance_allocation_current a
    JOIN finance_movement m ON m.id=a.movement_id JOIN finance_position p ON p.id=m.position_id WHERE a.income_id=? ORDER BY m.operation_date,a.id`)
    .bind(id).all()).results;
  const revisions = (await db.prepare(`SELECT r.previous_version AS previousVersion,r.previous_income_date AS previousIncomeDate,
    r.previous_concept AS previousConcept,r.previous_total_cents AS previousTotalCents,r.previous_budget_line_id AS previousBudgetLineId,
    r.changed_at AS changedAt FROM finance_income_revision r WHERE r.income_id=? ORDER BY r.previous_version DESC`).bind(id).all()).results;
  const previousLines = await budgetLineLabels(db, revisions.map(rev => rev.previousBudgetLineId));
  // Movements that could collect it: incoming, active, not flagged, with something still unallocated.
  const candidates = income.state === 'PENDING' || income.state === 'PARTIAL' ? (await db.prepare(`SELECT m.id,m.operation_date AS operationDate,
    m.amount_cents AS amountCents,m.display_label AS label,p.name AS positionName,m.allocation_version AS allocationVersion,
    COALESCE(b.unallocated_cents,m.amount_cents) AS unallocatedCents FROM finance_movement m JOIN finance_position p ON p.id=m.position_id
    LEFT JOIN finance_movement_allocation_balance b ON b.movement_id=m.id
    WHERE m.state='ACTIVE' AND m.review_flag IS NULL AND m.amount_cents>0 AND COALESCE(b.unallocated_cents,m.amount_cents)>0
    ORDER BY (COALESCE(b.unallocated_cents,m.amount_cents)=?) DESC,abs(julianday(m.operation_date)-julianday(?)),m.id LIMIT 10`)
    .bind(income.pendingCents, income.incomeDate).all()).results : [];
  return { income, movements, candidates,
    revisions: revisions.map(({ previousBudgetLineId, ...rev }) => ({ ...rev, previousBudgetLine: previousLines.get(previousBudgetLineId) ?? null })) };
}

/** Correction without destruction: the previous values stay in finance_income_revision. */
export async function reviseIncome(db, context, requestId, id, input, now = Date.now()) {
  await allow(db, context, requestId, 'finance.income.manage', 'finance_income', validUuid(id) ? id : null);
  const row = await db.prepare('SELECT * FROM finance_income WHERE id=?').bind(requireUuid(id)).first();
  if (!row) throw notFound();
  if (!keysOnly(input, ['incomeDate', 'concept', 'totalCents', 'budgetLineId', 'counterpartyId', 'expectedVersion']) || !version(input.expectedVersion)) fail('invalid_income');
  validIncome(input, false);
  if (row.status !== 'ACTIVE') throw new AppError(409, 'invalid_transition');
  await commit(db, [
    db.prepare(`INSERT INTO finance_income_revision(id,income_id,previous_version,previous_income_date,previous_concept,previous_total_cents,
      previous_budget_line_id,previous_counterparty_id,changed_by,changed_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(uuid(), id, row.version,
      row.income_date, row.concept, row.total_cents, row.budget_line_id, row.counterparty_id, context.userId, now),
    db.prepare(`UPDATE finance_income SET ${versionCas('version')},income_date=?,concept=?,total_cents=?,budget_line_id=?,counterparty_id=?,updated_at=?
      WHERE id=?`).bind(input.expectedVersion, input.incomeDate ?? row.income_date, input.concept?.trim() ?? row.concept, input.totalCents ?? row.total_cents,
      input.budgetLineId ?? row.budget_line_id, input.counterpartyId === undefined ? row.counterparty_id : input.counterpartyId, now, id),
    audit(db, context, requestId, 'INCOME_REVISED', 'finance_income', id, now)
  ], 'stale_income');
  return { id, version: input.expectedVersion + 1 };
}

/** Void an income recorded by mistake; refused while a movement still collects it. */
export async function voidIncome(db, context, requestId, id, input, now = Date.now()) {
  await allow(db, context, requestId, 'finance.income.manage', 'finance_income', validUuid(id) ? id : null);
  const row = await db.prepare('SELECT status FROM finance_income WHERE id=?').bind(requireUuid(id)).first();
  if (!row) throw notFound();
  if (!keysOnly(input, ['expectedVersion']) || !version(input.expectedVersion)) fail('invalid_income');
  if (row.status !== 'ACTIVE') throw new AppError(409, 'invalid_transition');
  if (await db.prepare('SELECT 1 FROM finance_allocation_current WHERE income_id=?').bind(id).first()) throw new AppError(409, 'income_reconciled');
  await commit(db, [
    db.prepare(`UPDATE finance_income SET ${versionCas('version')},status='VOID',voided_by=?,voided_at=?,updated_at=? WHERE id=?`)
      .bind(input.expectedVersion, context.userId, now, now, id),
    audit(db, context, requestId, 'INCOME_VOIDED', 'finance_income', id, now)
  ], 'stale_income');
  return { id, status: 'VOID' };
}
