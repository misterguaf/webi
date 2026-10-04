// Treasury-operated liabilities. Payment state is derived from current BANK allocation sets.
import { requireUuid, validUuid } from '../../services/common.js';
import { allow, audit, fail, uuid } from './shared.js';

export function approvedReimbursementStatements(db, context, requestId, expenseId, recipientId, amountCents, selfApproved, now) {
  const id = uuid();
  return { id, statements: [
    db.prepare(`INSERT INTO finance_reimbursement(id,expense_id,recipient_id,amount_cents,created_by,created_at)
      VALUES(?,?,?,?,?,?)`).bind(id, expenseId, recipientId, amountCents, context.userId, now),
    db.prepare(`UPDATE finance_reimbursement SET status='APPROVED',approved_by=?,approved_at=?,version=2,
      self_approval_exception=? WHERE id=? AND version=1`).bind(context.userId, now, selfApproved ? 1 : 0, id),
    audit(db, context, requestId, 'REIMBURSEMENT_CREATED', 'finance_reimbursement', id, now, { metadata: { amountCents } }),
    audit(db, context, requestId, 'REIMBURSEMENT_APPROVED', 'finance_reimbursement', id, now, { metadata: { amountCents } }),
    ...(selfApproved ? [audit(db, context, requestId, 'REIMBURSEMENT_SELF_APPROVED', 'finance_reimbursement', id, now,
      { metadata: { amountCents } })] : [])
  ] };
}

export async function listReimbursements(db, context, requestId, params) {
  await allow(db, context, requestId, 'finance.expense.read', 'finance_reimbursement');
  const roundId = params?.get('roundId');
  const recipientId = params?.get('recipientId');
  const outstanding = params?.get('outstanding');
  if (!validUuid(roundId) || (recipientId && !validUuid(recipientId)) || (outstanding && outstanding !== '1')) fail('invalid_filter');
  const rows = (await db.prepare(`SELECT r.id,r.expense_id AS expenseId,r.recipient_id AS recipientId,
    c.display_name AS recipientName,r.amount_cents AS amountCents,r.status,r.version,
    e.concept,e.expense_date AS expenseDate,e.status AS expenseStatus,
    COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a
      WHERE a.reimbursement_id=r.id AND a.kind='REIMBURSEMENT_SETTLEMENT'),0) AS settledCents
    FROM finance_reimbursement r JOIN finance_expense e ON e.id=r.expense_id
    JOIN finance_counterparty c ON c.id=r.recipient_id
    WHERE e.round_id=? AND (? IS NULL OR r.recipient_id=?)
    ORDER BY c.display_name,e.expense_date,r.id LIMIT 500`).bind(requireUuid(roundId), recipientId ?? null, recipientId ?? null).all()).results;
  const projected = rows.map(row => ({ ...row, outstandingCents: Math.max(0, row.amountCents - row.settledCents),
    paymentState: row.status !== 'APPROVED' ? null : row.settledCents === 0 ? 'PENDING' : row.settledCents < row.amountCents ? 'PARTIAL' : 'PAID' }));
  return { reimbursements: outstanding === '1' ? projected.filter(row => row.status === 'APPROVED' && row.outstandingCents > 0) : projected };
}
