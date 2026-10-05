// A claim for received family money above a fee or activity obligation. The source supplies the
// recipient and round; the caller cannot invent either. It is deliberately absent from income.
import { AppError, validUuid } from '../../services/common.js';
import { allow, audit, cents, commit, fail, keysOnly, uuid } from './shared.js';

export async function createOverpayment(db, context, requestId, input, now = Date.now()) {
  await allow(db, context, requestId, 'finance.treasury.read', 'finance_overpayment');
  await allow(db, context, requestId, 'finance.movement.classify', 'finance_overpayment');
  if (!keysOnly(input, ['feePaymentId','registrationId','amountCents','cause']) ||
      Number(!!input.feePaymentId) + Number(!!input.registrationId) !== 1 ||
      !cents(input.amountCents) || input.cause !== 'PAYMENT_EXCESS' ||
      (input.feePaymentId && !validUuid(input.feePaymentId)) ||
      (input.registrationId && !validUuid(input.registrationId))) fail('invalid_family_overpayment');
  let source;
  if (input.feePaymentId) {
    source = await db.prepare(`SELECT r.id AS round_id,p.receipt_email AS recipient_email,
      b.unallocated_cents AS available_cents FROM annual_fee_payment p
      JOIN finance_round r ON r.annual_fee_round_id=p.round_id
      JOIN annual_fee_payment_balance b ON b.id=p.id
      WHERE p.id=? AND p.review_status='VERIFIED'`).bind(input.feePaymentId).first();
  } else {
    source = await db.prepare(`SELECT r.finance_round_id AS round_id,r.receipt_email AS recipient_email,
      b.paid_cents-b.due_cents AS available_cents
      FROM activity_registration r JOIN activity_payment_balance b ON b.registration_id=r.id
      WHERE r.id=?`).bind(input.registrationId).first();
  }
  if (!source?.round_id || source.available_cents < input.amountCents)
    throw new AppError(409, 'invalid_family_overpayment');
  const id = uuid();
  await commit(db, [db.prepare(`INSERT INTO finance_overpayment
    (id,round_id,registration_id,fee_payment_id,recipient_email,cause,amount_cents,created_by,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).bind(id,source.round_id,input.registrationId ?? null,
      input.feePaymentId ?? null,source.recipient_email,input.cause,input.amountCents,context.userId,now),
  audit(db,context,requestId,'FAMILY_OVERPAYMENT_CREATED','finance_overpayment',id,now)]);
  return { id, roundId: source.round_id, amountCents: input.amountCents, status: 'OPEN' };
}

export async function listOverpayments(db, context, requestId, params) {
  await allow(db, context, requestId, 'finance.treasury.read', 'finance_overpayment');
  const roundId = params?.get('roundId'), status = params?.get('status');
  if ((roundId && !validUuid(roundId)) || (status && !['OPEN','RESOLVED'].includes(status)))
    fail('invalid_family_overpayment_filter');
  const where = [], binds = [];
  if (roundId) { where.push('o.round_id=?'); binds.push(roundId); }
  if (status) { where.push('o.status=?'); binds.push(status); }
  const rows = (await db.prepare(`SELECT o.id,o.round_id AS roundId,o.registration_id AS registrationId,
    o.fee_payment_id AS feePaymentId,o.recipient_email AS recipientEmail,o.cause,
    o.amount_cents AS amountCents,o.status,o.created_at AS createdAt,
    EXISTS(SELECT 1 FROM finance_family_refund f WHERE f.overpayment_id=o.id) AS refundDue,
    COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a
      WHERE a.kind='FAMILY_OVERPAYMENT' AND a.overpayment_id=o.id),0) AS reconciledCents
    FROM finance_overpayment o ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY o.created_at DESC,o.id DESC LIMIT 100`).bind(...binds).all()).results;
  return { overpayments: rows.map(row => ({...row,refundDue:!!row.refundDue})) };
}
