// FASE 3.5G.1 — per-round budget catalogue, budget and budget revisions (TREASURY.md §14).
// Tresoreria prepares and proposes; Coordinació general approves. initial ≠ current: the approved
// planned amounts are frozen and current = initial + approved revisions. Lines are never deleted.
import { versionCas } from '../../concurrency.js';
import { AppError, requireUuid, validUuid } from '../../services/common.js';
import { allow, audit, commit, fail, isDate, keysOnly, notFound, optionalId, uuid, version } from './shared.js';

const NATURES = ['INCOME', 'EXPENSE', 'RESERVE_USE', 'RESERVE_CONTRIBUTION'];
const LINE_FIELDS = `l.id,l.code,l.name,l.parent_id AS parentId,l.sort_order AS sortOrder,l.nature,l.economic_group AS economicGroup,
  l.activity_id AS activityId,l.section_id AS sectionId,l.status,l.planned_cents AS plannedCents,l.version,
  a.initial_cents AS initialCents,a.current_cents AS currentCents,
  EXISTS(SELECT 1 FROM finance_budget_line c WHERE c.parent_id=l.id) AS hasChildren`;

async function round(db, id) {
  const row = await db.prepare('SELECT id,status FROM finance_round WHERE id=?').bind(requireUuid(id)).first();
  if (!row) throw notFound();
  return row;
}
export async function listBudgetRounds(db, context, requestId) {
  await allow(db, context, requestId, 'finance.budget.read', 'finance_budget');
  return { rounds: (await db.prepare(`SELECT id,code,status FROM finance_round ORDER BY period_start DESC`).all()).results };
}
export async function getBudget(db, context, requestId, roundId) {
  await allow(db, context, requestId, 'finance.budget.read', 'finance_budget');
  await round(db, roundId);
  const budget = await db.prepare(`SELECT id,status,version,proposed_at AS proposedAt,approved_at AS approvedAt,
    external_approval_date AS externalApprovalDate,external_approval_reference AS externalApprovalReference FROM finance_budget WHERE round_id=?`)
    .bind(roundId).first();
  const lines = (await db.prepare(`SELECT ${LINE_FIELDS} FROM finance_budget_line l LEFT JOIN finance_budget_line_amount a ON a.line_id=l.id
    WHERE l.round_id=? ORDER BY l.nature,l.sort_order,l.code`).bind(roundId).all()).results.map(row => ({ ...row, hasChildren: !!row.hasChildren }));
  const revisions = budget ? (await db.prepare(`SELECT id,line_id AS lineId,delta_cents AS deltaCents,status,version,proposed_at AS proposedAt,
    decided_at AS decidedAt FROM finance_budget_revision WHERE budget_id=? ORDER BY proposed_at DESC,id DESC`).bind(budget.id).all()).results : [];
  // Realised amounts are derived, never written back into the approved budget. Expense refunds reduce
  // the original expense's lines proportionally; the last line receives the rounding remainder.
  const actual = new Map();
  const add = (lineId, cents) => actual.set(lineId, (actual.get(lineId) ?? 0) + cents);
  const incomeRows = (await db.prepare(`SELECT a.budget_line_id AS lineId,sum(a.amount_cents) AS cents
    FROM finance_allocation_current a WHERE a.round_id=? AND a.kind='INCOME'
    GROUP BY a.budget_line_id`).bind(roundId).all()).results;
  for (const row of incomeRows) add(row.lineId, row.cents);
  // Fee and activity receipts retain their own obligations. Budget actuals use the same
  // recognised caps and refund subtraction as finance_round_economics; bank excess is not income.
  const familyIncome = await db.prepare(`SELECT
    COALESCE((SELECT sum(min(
      COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a
        WHERE a.kind='FEE_PAYMENT' AND a.fee_payment_id=p.id),0),
      COALESCE((SELECT sum(a.amount_cents) FROM annual_fee_allocation a WHERE a.payment_id=p.id),0)
        -COALESCE((SELECT sum(o.amount_cents) FROM finance_overpayment o
          WHERE o.fee_payment_id=p.id AND o.cause='PRICE_CORRECTION'),0)))
      FROM annual_fee_payment p JOIN finance_round r ON r.annual_fee_round_id=p.round_id
      WHERE r.id=?),0) AS feeCents`).bind(roundId).first();
  if (familyIncome.feeCents > 0) {
    const feeLines=lines.filter(line => line.nature==='INCOME' && line.code==='1.1' && !line.hasChildren && line.status==='ACTIVE');
    if (feeLines.length!==1) throw new AppError(409,'treasury_export_mapping_missing');
    add(feeLines[0].id,familyIncome.feeCents);
  }
  const activityIncome=(await db.prepare(`SELECT ar.activity_id AS activityId,
    sum(max(0,min(COALESCE((SELECT sum(f.amount_cents) FROM finance_allocation_current f
      JOIN activity_payment_allocation pa ON pa.id=f.activity_allocation_id
      WHERE f.kind='ACTIVITY_PAYMENT' AND pa.registration_id=ar.id),0),ar.expected_amount_cents)
      -min(COALESCE((SELECT sum(f.amount_cents) FROM finance_allocation_current f
        JOIN activity_payment_allocation pa ON pa.id=f.activity_allocation_id
        WHERE f.kind='FAMILY_REFUND' AND pa.registration_id=ar.id),0),
        COALESCE((SELECT sum(f.amount_cents) FROM finance_allocation_current f
          JOIN activity_payment_allocation pa ON pa.id=f.activity_allocation_id
          WHERE f.kind='ACTIVITY_PAYMENT' AND pa.registration_id=ar.id),0)))) AS cents
    FROM activity_registration ar WHERE ar.finance_round_id=? GROUP BY ar.activity_id`).bind(roundId).all()).results;
  for (const row of activityIncome) if (row.cents>0) {
    const matches=lines.filter(line => line.nature==='INCOME' && line.activityId===row.activityId &&
      !line.hasChildren && line.status==='ACTIVE');
    if (matches.length!==1) throw new AppError(409,'treasury_export_mapping_missing');
    add(matches[0].id,row.cents);
  }
  const expenses = (await db.prepare(`SELECT e.id,e.total_cents AS totalCents,l.budget_line_id AS lineId,
    l.line_no AS lineNo,l.amount_cents AS amountCents
    FROM finance_expense e JOIN finance_expense_line l ON l.expense_id=e.id AND l.lines_version=e.lines_version
    WHERE e.round_id=? AND e.status='RECOGNISED' ORDER BY e.id,l.line_no`).bind(roundId).all()).results;
  const refundRows = (await db.prepare(`SELECT a.expense_id AS expenseId,sum(a.amount_cents) AS cents
    FROM finance_allocation_current a JOIN finance_expense e ON e.id=a.expense_id
    WHERE e.round_id=? AND a.kind='EXPENSE_REFUND' GROUP BY a.expense_id`).bind(roundId).all()).results;
  const refunds = new Map(refundRows.map(row => [row.expenseId, row.cents]));
  for (let index = 0; index < expenses.length;) {
    const id = expenses[index].id, group = [];
    while (index < expenses.length && expenses[index].id === id) group.push(expenses[index++]);
    const refund = refunds.get(id) ?? 0;
    let assignedRefund = 0;
    group.forEach((line, position) => {
      const part = position === group.length - 1 ? refund - assignedRefund :
        Math.floor(refund * line.amountCents / line.totalCents);
      assignedRefund += part;
      add(line.lineId, line.amountCents - part);
    });
  }
  const children = new Map();
  for (const line of lines) if (line.parentId) {
    if (!children.has(line.parentId)) children.set(line.parentId, []);
    children.get(line.parentId).push(line.id);
  }
  const subtotal = (id, seen = new Set()) => {
    if (seen.has(id)) return 0;
    seen.add(id);
    return (actual.get(id) ?? 0) + (children.get(id) ?? []).reduce((sum, child) => sum + subtotal(child, seen), 0);
  };
  const compared = lines.map(line => {
    const actualCents = subtotal(line.id);
    const currentCents = line.currentCents ?? null;
    return { ...line, actualCents, varianceCents: currentCents === null ? null : actualCents - currentCents,
      overrunCents: line.nature === 'EXPENSE' && currentCents !== null ? Math.max(0, actualCents - currentCents) : 0 };
  });
  return { budget: budget ?? null, lines: compared, revisions };
}
/** FASE 3.5G.2A — the line picker: names and codes of the active lines of one nature (no amounts), so
 *  people who classify or record expenses can choose an assignable leaf without reading the budget. */
export async function assignableLines(db, context, requestId, roundId, params) {
  const nature = params?.get('nature') ?? 'EXPENSE';
  if (!['INCOME', 'EXPENSE'].includes(nature)) fail('invalid_filter');
  await allow(db, context, requestId, nature === 'INCOME' ? 'finance.movement.read' : 'finance.expense.read', 'finance_budget_line');
  await round(db, roundId);
  const lines = (await db.prepare(`SELECT l.id,l.code,l.name,l.parent_id AS parentId,
    NOT EXISTS(SELECT 1 FROM finance_budget_line c WHERE c.parent_id=l.id) AS assignable FROM finance_budget_line l
    WHERE l.round_id=? AND l.nature=? AND l.status='ACTIVE' ORDER BY l.sort_order,l.code`).bind(roundId, nature).all()).results;
  return { nature, lines: lines.map(row => ({ ...row, assignable: !!row.assignable })) };
}
export async function createBudget(db, context, requestId, roundId, now = Date.now()) {
  await allow(db, context, requestId, 'finance.budget.propose', 'finance_budget');
  const row = await round(db, roundId);
  if (row.status === 'CLOSED') throw new AppError(409, 'finance_round_closed');
  const id = uuid();
  await commit(db, [
    db.prepare('INSERT INTO finance_budget(id,round_id,created_by,created_at) VALUES(?,?,?,?)').bind(id, roundId, context.userId, now),
    audit(db, context, requestId, 'BUDGET_CREATED', 'finance_budget', id, now)
  ]);
  return { id, status: 'DRAFT', version: 1 };
}
function validLine(input, creating) {
  const allowed = creating ? ['roundId', 'code', 'name', 'parentId', 'sortOrder', 'nature', 'economicGroup', 'activityId', 'sectionId', 'plannedCents']
    : ['code', 'name', 'parentId', 'sortOrder', 'status', 'plannedCents', 'economicGroup', 'expectedVersion'];
  if (!keysOnly(input, allowed)) fail('invalid_budget_line');
  if (creating && (!validUuid(input.roundId) || !NATURES.includes(input.nature))) fail('invalid_budget_line');
  if ((creating || input.code !== undefined) && (typeof input.code !== 'string' || !/^[0-9A-Za-z.]{1,20}$/.test(input.code))) fail('invalid_budget_line');
  if ((creating || input.name !== undefined) && (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120)) fail('invalid_budget_line');
  if (input.parentId !== undefined && !optionalId(input.parentId)) fail('invalid_budget_line');
  if (input.sortOrder !== undefined && (!Number.isSafeInteger(input.sortOrder) || input.sortOrder < 0 || input.sortOrder > 10000)) fail('invalid_budget_line');
  if (input.plannedCents !== undefined && input.plannedCents !== null &&
      (!Number.isSafeInteger(input.plannedCents) || input.plannedCents < 0 || input.plannedCents > 100000000)) fail('invalid_budget_line');
  if (input.economicGroup !== undefined && input.economicGroup !== null &&
      (typeof input.economicGroup !== 'string' || !input.economicGroup.trim() || input.economicGroup.length > 40)) fail('invalid_budget_line');
  if (creating && (!optionalId(input.activityId) || !optionalId(input.sectionId))) fail('invalid_budget_line');
  if (!creating && input.status !== undefined && !['ACTIVE', 'INACTIVE'].includes(input.status)) fail('invalid_budget_line');
  if (!creating && !version(input.expectedVersion)) fail('invalid_version');
}
export async function createLine(db, context, requestId, input, now = Date.now()) {
  await allow(db, context, requestId, 'finance.budget.propose', 'finance_budget_line');
  validLine(input, true);
  await round(db, input.roundId);
  const id = uuid();
  await commit(db, [
    db.prepare(`INSERT INTO finance_budget_line(id,round_id,code,name,parent_id,sort_order,nature,economic_group,activity_id,section_id,planned_cents,
      created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, input.roundId, input.code, input.name.trim(), input.parentId ?? null,
      input.sortOrder ?? 0, input.nature, input.economicGroup?.trim() ?? null, input.activityId ?? null, input.sectionId ?? null,
      input.plannedCents ?? null, context.userId, now, now),
    audit(db, context, requestId, 'BUDGET_LINE_CREATED', 'finance_budget_line', id, now)
  ]);
  return { id, version: 1 };
}
/** Rename, renumber, move a leaf, change its planned amount before approval, deactivate or reactivate. */
export async function updateLine(db, context, requestId, id, input, now = Date.now()) {
  await allow(db, context, requestId, 'finance.budget.propose', 'finance_budget_line', validUuid(id) ? id : null);
  const row = await db.prepare('SELECT * FROM finance_budget_line WHERE id=?').bind(requireUuid(id)).first();
  if (!row) throw notFound();
  validLine(input, false);
  const next = { code: input.code ?? row.code, name: input.name?.trim() ?? row.name,
    parent: input.parentId === undefined ? row.parent_id : input.parentId, sort: input.sortOrder ?? row.sort_order,
    status: input.status ?? row.status, planned: input.plannedCents === undefined ? row.planned_cents : input.plannedCents,
    group: input.economicGroup === undefined ? row.economic_group : input.economicGroup?.trim() ?? null };
  if (next.parent === id) throw new AppError(409, 'invalid_budget_line');
  await commit(db, [
    db.prepare(`INSERT INTO finance_budget_line_revision(id,line_id,previous_version,previous_code,previous_name,previous_parent_id,previous_sort_order,
      previous_status,previous_planned_cents,changed_by,changed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(uuid(), id, row.version, row.code, row.name,
      row.parent_id, row.sort_order, row.status, row.planned_cents, context.userId, now),
    db.prepare(`UPDATE finance_budget_line SET ${versionCas('version')},code=?,name=?,parent_id=?,sort_order=?,status=?,planned_cents=?,economic_group=?,
      updated_at=? WHERE id=?`).bind(input.expectedVersion, next.code, next.name, next.parent, next.sort, next.status, next.planned, next.group, now, id),
    audit(db, context, requestId, next.status === 'INACTIVE' && row.status === 'ACTIVE' ? 'BUDGET_LINE_DEACTIVATED' : 'BUDGET_LINE_REVISED',
      'finance_budget_line', id, now)
  ], 'stale_budget_line');
  return { id, version: input.expectedVersion + 1 };
}
const BUDGET_STEPS = {
  propose: { permission: 'finance.budget.propose', from: 'DRAFT', to: 'PROPOSED', set: 'proposed_by=?,proposed_at=?', action: 'BUDGET_PROPOSED' },
  return: { permission: 'finance.budget.approve', from: 'PROPOSED', to: 'DRAFT', set: 'proposed_by=NULL,proposed_at=NULL', action: 'BUDGET_RETURNED_TO_DRAFT' },
  approve: { permission: 'finance.budget.approve', from: 'PROPOSED', to: 'APPROVED',
    set: 'approved_by=?,approved_at=?,external_approval_date=?,external_approval_reference=?', action: 'BUDGET_APPROVED' }
};
function externalApproval(input) {
  if (input.externalApprovalDate != null && !isDate(input.externalApprovalDate)) fail('invalid_budget');
  if (input.externalApprovalReference != null && (typeof input.externalApprovalReference !== 'string' ||
    !input.externalApprovalReference.trim() || input.externalApprovalReference.length > 80)) fail('invalid_budget');
}
export async function transitionBudget(db, context, requestId, id, kind, input, now = Date.now()) {
  const step = BUDGET_STEPS[kind];
  await allow(db, context, requestId, step.permission, 'finance_budget', validUuid(id) ? id : null);
  const row = await db.prepare('SELECT * FROM finance_budget WHERE id=?').bind(requireUuid(id)).first();
  if (!row) throw notFound();
  if (!keysOnly(input, kind === 'approve' ? ['expectedVersion', 'externalApprovalDate', 'externalApprovalReference'] : ['expectedVersion']) ||
      !version(input.expectedVersion)) fail('invalid_budget');
  if (kind === 'approve') externalApproval(input);
  if (row.status !== step.from) throw new AppError(409, 'invalid_transition');
  const binds = kind === 'propose' ? [context.userId, now] : kind === 'approve'
    ? [context.userId, now, input.externalApprovalDate ?? null, input.externalApprovalReference?.trim() ?? null] : [];
  await commit(db, [
    db.prepare(`UPDATE finance_budget SET ${versionCas('version')},status=?,${step.set} WHERE id=?`).bind(input.expectedVersion, step.to, ...binds, id),
    audit(db, context, requestId, step.action, 'finance_budget', id, now)
  ], 'stale_budget');
  return { id, status: step.to, version: input.expectedVersion + 1 };
}
export async function proposeRevision(db, context, requestId, input, now = Date.now()) {
  await allow(db, context, requestId, 'finance.budget.propose', 'finance_budget_revision');
  if (!keysOnly(input, ['budgetId', 'lineId', 'deltaCents']) || !validUuid(input.budgetId) || !validUuid(input.lineId) ||
      !Number.isSafeInteger(input.deltaCents) || input.deltaCents === 0 || Math.abs(input.deltaCents) > 100000000) fail('invalid_budget_revision');
  if (!await db.prepare('SELECT 1 FROM finance_budget WHERE id=?').bind(input.budgetId).first()) throw notFound();
  const id = uuid();
  await commit(db, [
    db.prepare(`INSERT INTO finance_budget_revision(id,budget_id,line_id,delta_cents,proposed_by,proposed_at) VALUES(?,?,?,?,?,?)`)
      .bind(id, input.budgetId, input.lineId, input.deltaCents, context.userId, now),
    audit(db, context, requestId, 'BUDGET_REVISION_PROPOSED', 'finance_budget_revision', id, now)
  ]);
  return { id, status: 'PROPOSED', version: 1 };
}
export async function decideRevision(db, context, requestId, id, input, now = Date.now()) {
  await allow(db, context, requestId, 'finance.budget.approve', 'finance_budget_revision', validUuid(id) ? id : null);
  const row = await db.prepare('SELECT status FROM finance_budget_revision WHERE id=?').bind(requireUuid(id)).first();
  if (!row) throw notFound();
  if (!keysOnly(input, ['decision', 'expectedVersion', 'externalApprovalDate', 'externalApprovalReference']) ||
      !['APPROVE', 'REJECT'].includes(input.decision) || !version(input.expectedVersion)) fail('invalid_budget_revision');
  externalApproval(input);
  if (row.status !== 'PROPOSED') throw new AppError(409, 'invalid_transition');
  const status = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  await commit(db, [
    db.prepare(`UPDATE finance_budget_revision SET ${versionCas('version')},status=?,decided_by=?,decided_at=?,external_approval_date=?,
      external_approval_reference=? WHERE id=?`).bind(input.expectedVersion, status, context.userId, now, input.externalApprovalDate ?? null,
      input.externalApprovalReference?.trim() ?? null, id),
    audit(db, context, requestId, status === 'APPROVED' ? 'BUDGET_REVISION_APPROVED' : 'BUDGET_REVISION_REJECTED', 'finance_budget_revision', id, now)
  ], 'stale_budget_revision');
  return { id, status, version: input.expectedVersion + 1 };
}
