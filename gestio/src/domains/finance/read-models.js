// FASE 3.5G.2A — human read models for the Tresoreria screens: budget line paths, allocation and
// expense summaries. Only minimised, purpose-limited fields: no bank description, no fingerprints.

/** Map of budget line id → { code, name, path, nature, roundId } for the given ids (with ancestors). */
export async function budgetLineLabels(db, ids) {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (!wanted.length) return new Map();
  const rounds = (await db.prepare(`SELECT DISTINCT round_id FROM finance_budget_line WHERE id IN (${wanted.map(() => '?').join(',')})`)
    .bind(...wanted).all()).results.map(row => row.round_id);
  if (!rounds.length) return new Map();
  const all = (await db.prepare(`SELECT id,code,name,parent_id,nature,round_id FROM finance_budget_line WHERE round_id IN (${rounds.map(() => '?').join(',')})`)
    .bind(...rounds).all()).results;
  const byId = new Map(all.map(row => [row.id, row]));
  const path = row => { const names = []; for (let node = row, guard = 0; node && guard < 20; node = byId.get(node.parent_id), guard++) names.unshift(node.name); return names; };
  return new Map(wanted.filter(id => byId.has(id)).map(id => {
    const row = byId.get(id);
    return [id, { code: row.code, name: row.name, path: path(row), nature: row.nature, roundId: row.round_id }];
  }));
}

/** Short expense summaries: concept (or supplier), counterparty, date, total, method, status. */
export async function expenseSummaries(db, ids) {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (!wanted.length) return new Map();
  const rows = (await db.prepare(`SELECT e.id,e.concept,e.supplier_label,e.expense_date,e.total_cents,e.payment_method,e.status,c.display_name AS counterparty
    FROM finance_expense e LEFT JOIN finance_counterparty c ON c.id=e.counterparty_id WHERE e.id IN (${wanted.map(() => '?').join(',')})`)
    .bind(...wanted).all()).results;
  return new Map(rows.map(row => [row.id, { id: row.id, concept: row.concept ?? row.supplier_label ?? row.counterparty ?? 'Despesa',
    counterparty: row.counterparty ?? row.supplier_label ?? null, expenseDate: row.expense_date, totalCents: row.total_cents,
    paymentMethod: row.payment_method, status: row.status }]));
}

/** Allocations with what they point to, ready for the screen. */
export async function describeAllocations(db, rows) {
  const lines = await budgetLineLabels(db, rows.map(row => row.budgetLineId));
  const expenses = await expenseSummaries(db, rows.map(row => row.expenseId));
  const incomeIds = [...new Set(rows.map(row => row.incomeId).filter(Boolean))];
  const incomes = new Map(incomeIds.length ? (await db.prepare(`SELECT id,concept,income_date,total_cents FROM finance_income WHERE id IN (${incomeIds.map(() => '?').join(',')})`)
    .bind(...incomeIds).all()).results.map(row => [row.id, { id: row.id, concept: row.concept, incomeDate: row.income_date, totalCents: row.total_cents }]) : []);
  const pairedIds = [...new Set(rows.map(row => row.pairedMovementId).filter(Boolean))];
  const paired = new Map(pairedIds.length ? (await db.prepare(`SELECT m.id,m.operation_date,m.amount_cents,p.name AS position_name,p.kind
    FROM finance_movement m JOIN finance_position p ON p.id=m.position_id WHERE m.id IN (${pairedIds.map(() => '?').join(',')})`)
    .bind(...pairedIds).all()).results.map(row => [row.id, { id: row.id, operationDate: row.operation_date, amountCents: row.amount_cents,
      positionName: row.position_name, positionKind: row.kind }]) : []);
  return rows.map(row => ({ id: row.id, kind: row.kind, amountCents: row.amountCents, sectionId: row.sectionId ?? null, activityId: row.activityId ?? null,
    budgetLineId: row.budgetLineId ?? null, expenseId: row.expenseId ?? null, pairedMovementId: row.pairedMovementId ?? null,
    incomeId: row.incomeId ?? null, income: row.incomeId ? incomes.get(row.incomeId) ?? null : null,
    budgetLine: row.budgetLineId ? lines.get(row.budgetLineId) ?? null : null,
    expense: row.expenseId ? expenses.get(row.expenseId) ?? null : null,
    pairedMovement: row.pairedMovementId ? paired.get(row.pairedMovementId) ?? null : null }));
}
