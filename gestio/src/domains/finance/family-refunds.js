// Family refunds are liabilities to a recipient, not ordinary expenses or scouter reimbursements.
import { AppError, requireUuid, validUuid } from '../../services/common.js';
import { allow, audit, cents, commit, fail, keysOnly, notFound, uuid } from './shared.js';

async function authority(db, context, requestId, resourceId = null) {
  await allow(db, context, requestId, 'finance.treasury.read', 'finance_family_refund', resourceId);
  await allow(db, context, requestId, 'finance.movement.classify', 'finance_family_refund', resourceId);
}

export async function refundOverpayment(db, context, requestId, overpaymentId, now = Date.now()) {
  await authority(db, context, requestId, validUuid(overpaymentId) ? overpaymentId : null);
  const claim = await db.prepare(`SELECT id,round_id,recipient_email,amount_cents,status,
    COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a
      WHERE a.kind='FAMILY_OVERPAYMENT' AND a.overpayment_id=o.id),0) AS reconciled_cents
    FROM finance_overpayment o WHERE id=?`).bind(requireUuid(overpaymentId)).first();
  if (!claim) throw notFound();
  if (claim.status !== 'OPEN' || !claim.round_id || claim.reconciled_cents !== claim.amount_cents ||
      await db.prepare('SELECT 1 FROM finance_family_refund WHERE overpayment_id=?')
    .bind(overpaymentId).first()) throw new AppError(409, 'family_refund_already_due');
  const id = uuid();
  await commit(db, [db.prepare(`INSERT INTO finance_family_refund
    (id,round_id,overpayment_id,recipient_email,cause,amount_cents,created_by,created_at)
    VALUES(?,?,?,?,'OVERPAYMENT_REFUND',?,?,?)`).bind(id,claim.round_id,claim.id,claim.recipient_email,
      claim.amount_cents,context.userId,now),
  audit(db,context,requestId,'FAMILY_REFUND_DUE','finance_family_refund',id,now)]);
  return { id, amountCents: claim.amount_cents, cause: 'OVERPAYMENT_REFUND' };
}

export async function decideWithdrawalRefund(db, context, requestId, registrationId, input, now = Date.now()) {
  await authority(db, context, requestId, validUuid(registrationId) ? registrationId : null);
  if (!keysOnly(input, ['decision','amountCents','reason']) ||
      !['FULL','PARTIAL','NONE'].includes(input.decision) ||
      typeof input.reason !== 'string' || input.reason.trim().length < 3 || input.reason.trim().length > 240 ||
      !Number.isSafeInteger(input.amountCents) || input.amountCents < 0) fail('invalid_family_refund_decision');
  const registration = await db.prepare(`SELECT r.id,r.status,r.finance_round_id,r.receipt_email,b.paid_cents
    FROM activity_registration r JOIN activity_payment_balance b ON b.registration_id=r.id WHERE r.id=?`)
    .bind(requireUuid(registrationId)).first();
  if (!registration) throw notFound();
  if (registration.status !== 'WITHDRAWN' || !registration.finance_round_id)
    throw new AppError(409, 'invalid_family_refund_decision');
  const sources = (await db.prepare(`SELECT a.id,a.amount_cents FROM activity_payment_allocation a
    WHERE a.registration_id=? AND NOT EXISTS(SELECT 1 FROM finance_family_refund f WHERE f.activity_allocation_id=a.id)
    ORDER BY a.created_at,a.id`).bind(registrationId).all()).results;
  const available = sources.reduce((sum, row) => sum + row.amount_cents, 0);
  if ((input.decision === 'NONE' && input.amountCents !== 0) ||
      (input.decision === 'FULL' && input.amountCents !== available) ||
      (input.decision === 'PARTIAL' && (!cents(input.amountCents) || input.amountCents >= available)) ||
      (input.decision !== 'NONE' && available === 0)) fail('invalid_family_refund_decision');
  const decisionId = uuid(), refunds = [];
  let remaining = input.amountCents;
  for (const source of sources) {
    if (remaining === 0) break;
    const amountCents = Math.min(source.amount_cents, remaining);
    refunds.push({ id: uuid(), sourceId: source.id, amountCents });
    remaining -= amountCents;
  }
  await commit(db, [db.prepare(`INSERT INTO finance_family_refund_decision
    (id,registration_id,decision,basis_paid_cents,reason,authorized_by,authorized_at)
    VALUES(?,?,?,?,?,?,?)`).bind(decisionId,registrationId,input.decision,registration.paid_cents,
      input.reason.trim(),context.userId,now),
  ...refunds.map(refund => db.prepare(`INSERT INTO finance_family_refund
    (id,round_id,activity_allocation_id,recipient_email,cause,amount_cents,decision_id,created_by,created_at)
    VALUES(?,?,?,?,'ACTIVITY_WITHDRAWAL_REFUND',?,?,?,?)`).bind(refund.id,registration.finance_round_id,
      refund.sourceId,registration.receipt_email,refund.amountCents,decisionId,context.userId,now)),
  audit(db,context,requestId,'FAMILY_REFUND_DECIDED','finance_family_refund_decision',decisionId,now,
    { metadata: { amountCents: input.amountCents } }),
  ...refunds.map(refund => audit(db,context,requestId,'FAMILY_REFUND_DUE','finance_family_refund',refund.id,now))]);
  return { id: decisionId, decision: input.decision, amountCents: input.amountCents,
    refundIds: refunds.map(refund => refund.id) };
}

export async function listFamilyRefunds(db, context, requestId, params) {
  await allow(db,context,requestId,'finance.treasury.read','finance_family_refund');
  const roundId = params?.get('roundId');
  if (roundId && !validUuid(roundId)) fail('invalid_family_refund_filter');
  const rows = (await db.prepare(`SELECT f.id,f.round_id AS roundId,f.activity_allocation_id AS activityAllocationId,
    f.overpayment_id AS overpaymentId,f.recipient_email AS recipientEmail,f.cause,
    f.amount_cents AS amountCents,f.created_at AS createdAt,
    COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a WHERE a.kind='FAMILY_REFUND'
      AND ((f.activity_allocation_id IS NOT NULL AND a.activity_allocation_id=f.activity_allocation_id)
        OR (f.overpayment_id IS NOT NULL AND a.overpayment_id=f.overpayment_id))),0) AS settledCents
    FROM finance_family_refund f ${roundId ? 'WHERE f.round_id=?' : ''}
    ORDER BY f.created_at DESC,f.id DESC LIMIT 100`).bind(...(roundId ? [roundId] : [])).all()).results;
  return { refunds: rows.map(row => ({ ...row, status: row.settledCents === row.amountCents ? 'SETTLED' :
    row.settledCents > 0 ? 'PARTIAL' : 'DUE' })) };
}
