// FASE 3.5I — reconcile a bank receipt with annual quotas in ONE atomic batch, reusing the canonical services:
// the Quotes review (feeReviewPlan: verified amount + allocations to obligations) and the Treasury allocation set
// (movementAllocationPlan: FEE_PAYMENT link of the movement). Two cases:
//   • a family proof waiting for review (Inscripcions / portal): that payment is verified and linked;
//   • no proof: the canonical Quotes payment is created for the transfer (origin BANK, linked to the movement).
// A quota is recognised once: allocations never exceed what is still pending (checked again inside the batch, so
// two simultaneous confirmations cannot both cover the same quota), the bank link never exceeds the allocated
// amount (finance_fee_receipt_guard) nor the movement (finance_allocation_not_above_movement), and Treasury income
// is min(bank link, Quotes allocation) per payment (finance_round_economics). Nothing here runs without a person.
import { feeReviewPlan } from '../../services/annual-fee-service.js';
import { AppError, requirePermission, requireUuid, validUuid } from '../../services/common.js';
import { matchKey } from '../../services/registration-service.js';
import { allow, audit, cents, conflict, fail, keysOnly, uuid, version } from './shared.js';
import { currentAllocationPayload, movementAllocationPlan } from './movements.js';

const encoder = new TextEncoder();
const sha256 = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)))]
  .map(byte => byte.toString(16).padStart(2, '0')).join('');
const OVERCOVERED = 'NOT NULL constraint failed: annual_fee_payment.allocation_version';

export async function reconcileFeeFromMovement(db, context, requestId, movementId, input, now = Date.now()) {
  await allow(db, context, requestId, 'finance.movement.classify', 'finance_movement', validUuid(movementId) ? movementId : null);
  await allow(db, context, requestId, 'finance.treasury.read', 'finance_movement', validUuid(movementId) ? movementId : null);
  if (!keysOnly(input, ['expectedVersion', 'paymentId', 'allocations']) || !version(input.expectedVersion) ||
      (input.paymentId != null && !validUuid(input.paymentId)) || !Array.isArray(input.allocations) ||
      input.allocations.length < 1 || input.allocations.length > 8 ||
      input.allocations.some(item => !keysOnly(item, ['obligationId', 'amountCents']) || !validUuid(item.obligationId) || !cents(item.amountCents)) ||
      new Set(input.allocations.map(item => item.obligationId)).size !== input.allocations.length) fail('invalid_fee_reconciliation');
  const movement = await db.prepare(`SELECT m.id,m.state,m.amount_cents AS amountCents,m.allocation_version AS allocationVersion,p.kind,
      COALESCE(b.unallocated_cents,abs(m.amount_cents)) AS unallocatedCents
    FROM finance_movement m JOIN finance_position p ON p.id=m.position_id LEFT JOIN finance_movement_allocation_balance b ON b.movement_id=m.id
    WHERE m.id=?`).bind(requireUuid(movementId)).first();
  if (!movement) throw new AppError(404, 'not_found');
  if (movement.state !== 'ACTIVE') throw new AppError(409, 'movement_voided');
  if (movement.kind !== 'BANK' || movement.amountCents <= 0) throw new AppError(409, 'invalid_fee_reconciliation');
  if (movement.allocationVersion !== input.expectedVersion) throw new AppError(409, 'stale_movement');

  // Obligations still pending in a quota round linked to a Treasury round; the amount never exceeds what is pending.
  const obligations = [];
  for (const item of input.allocations) {
    const row = await db.prepare(`SELECT s.id,s.round_id AS roundId,s.participant_id AS participantId,s.display_name AS name,
        s.current_section_id AS sectionId,s.amount_due_cents-s.allocated_cents AS pendingCents
      FROM annual_fee_obligation_status s WHERE s.id=? AND EXISTS(SELECT 1 FROM finance_round r WHERE r.annual_fee_round_id=s.round_id)`)
      .bind(item.obligationId).first();
    if (!row) throw new AppError(404, 'not_found');
    await requirePermission(db, context, requestId, 'finance.fee.payment.review',
      { sectionId: row.sectionId, resourceType: 'annual_fee_obligation', resourceId: row.id, conceal: true });
    if (item.amountCents > row.pendingCents) throw new AppError(409, 'fee_obligation_already_covered');
    obligations.push({ ...row, amountCents: item.amountCents });
  }
  if (new Set(obligations.map(row => row.roundId)).size !== 1) fail('invalid_fee_reconciliation');
  const roundId = obligations[0].roundId;
  const total = obligations.reduce((sum, row) => sum + row.amountCents, 0);
  if (total > movement.unallocatedCents) throw new AppError(409, 'allocation_exceeds_movement');
  const review = { verifiedAmountCents: total, allocations: obligations.map(row => ({ obligationId: row.id, amountCents: row.amountCents })) };

  let paymentId, statements;
  if (input.paymentId) {
    // A family proof waiting for review: the same Quotes review, now confirmed by the bank.
    const payment = await db.prepare('SELECT * FROM annual_fee_payment WHERE id=?').bind(input.paymentId).first();
    if (!payment || payment.origin !== 'FAMILY' || payment.round_id !== roundId) throw new AppError(404, 'not_found');
    const people = (await db.prepare(`SELECT s.id,s.participant_id,s.match_status,COALESCE(p.current_section_id,s.section_id) AS section_id
      FROM annual_fee_submission_person s LEFT JOIN participant p ON p.id=s.participant_id WHERE s.payment_id=?`).bind(payment.id).all()).results;
    for (const person of people) await requirePermission(db, context, requestId, 'finance.fee.payment.review',
      { sectionId: person.section_id, resourceType: 'annual_fee_submission_person', resourceId: person.id, conceal: true });
    paymentId = payment.id;
    statements = await feeReviewPlan(db, context, requestId, payment, people, review, now);
  } else {
    // No proof: the canonical Quotes payment of this transfer, created, verified and allocated in the same batch.
    paymentId = uuid();
    const payment = { id: paymentId, round_id: roundId, review_status: 'PENDING_REVIEW', verified_amount_cents: null, receipt_email: '' };
    const people = obligations.map(row => ({ id: uuid(), participant_id: row.participantId, match_status: 'RESOLVED', row }));
    statements = [
      db.prepare(`INSERT INTO annual_fee_payment(id,round_id,receipt_email,submitted_by_name,contact_phone,declared_amount_cents,idempotency_key,
        payload_sha256,privacy_notice_version,privacy_notice_acknowledged_at,created_at,origin,source_movement_id)
        VALUES(?,?,'','Moviment bancari',NULL,?,?,?,'BANK-RECONCILIATION',?,?,'BANK',?)`)
        .bind(paymentId, roundId, total, `bank-${paymentId}`, await sha256(`${movementId}|${JSON.stringify(review)}`), now, now, movementId),
      ...people.map(person => db.prepare(`INSERT INTO annual_fee_submission_person(id,payment_id,submitted_name,match_key,submitted_birth_date,
        section_id,participant_id,match_status,reviewed_by,reviewed_at) VALUES(?,?,?,?,NULL,?,?,'RESOLVED',?,?)`)
        .bind(person.id, paymentId, person.row.name, matchKey(person.row.name), person.row.sectionId, person.participant_id, context.userId, now)),
      audit(db, context, requestId, 'FEE_BANK_PAYMENT_RECORDED', 'annual_fee_payment', paymentId, now, { metadata: { amountCents: total } }),
      ...await feeReviewPlan(db, context, requestId, payment, people, review, now, { notify: false })
    ];
  }
  // The bank link keeps whatever the movement already carries (a camp in the same transfer, another quota…).
  const plan = await movementAllocationPlan(db, context, requestId, movementId, { expectedVersion: input.expectedVersion,
    allocations: [...await currentAllocationPayload(db, movementId), { kind: 'FEE_PAYMENT', feePaymentId: paymentId, amountCents: total }] }, now);
  // Re-checked inside the batch: if another confirmation covered one of these quotas meanwhile, nothing is written.
  const guard = db.prepare(`UPDATE annual_fee_payment SET allocation_version=CASE WHEN EXISTS(SELECT 1 FROM annual_fee_obligation_status s
      WHERE s.id IN (${obligations.map(() => '?').join(',')}) AND s.allocated_cents>s.amount_due_cents) THEN NULL ELSE allocation_version END WHERE id=?`)
    .bind(...obligations.map(row => row.id), paymentId);
  try { await db.batch([...statements, ...plan.statements, guard]); }
  catch (error) {
    if (String(error?.message ?? '').includes(OVERCOVERED)) throw new AppError(409, 'fee_obligation_already_covered');
    throw conflict(error, 'stale_movement');
  }
  return { movementId, paymentId, allocationVersion: plan.next, origin: input.paymentId ? 'FAMILY' : 'BANK',
    obligations: obligations.map(row => ({ id: row.id, amountCents: row.amountCents })) };
}
