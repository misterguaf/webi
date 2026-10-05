import { versionCas } from '../../concurrency.js';
import { AppError, requireUuid, validUuid } from '../../services/common.js';
import { allow, audit, commit, fail, keysOnly, notFound, uuid } from './shared.js';

function schedule(input, total) {
  if (!Array.isArray(input) || input.length < 2 || input.length > 100 ||
      input.some(part => !keysOnly(part, ['amountCents','targetAt']) ||
        !Number.isSafeInteger(part.amountCents) || part.amountCents < 1 || part.amountCents > 1000000 ||
        (part.targetAt != null && (!Number.isSafeInteger(part.targetAt) || part.targetAt < 0))) ||
      input.reduce((sum, part) => sum + part.amountCents, 0) !== total)
    fail('invalid_activity_installment_total');
  return input;
}

export async function correctActivityPrice(db, context, requestId, registrationId, input, now = Date.now()) {
  await allow(db, context, requestId, 'finance.activity.installment.authorize', 'activity_registration',
    validUuid(registrationId) ? registrationId : null);
  if (!keysOnly(input, ['amountCents','expectedVersion','reason','planParts']) ||
      !Number.isSafeInteger(input.amountCents) || input.amountCents < 1 || input.amountCents > 1000000 ||
      !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 ||
      typeof input.reason !== 'string' || input.reason.trim().length < 3 || input.reason.trim().length > 240)
    fail('invalid_activity_price_correction');
  const row = await db.prepare(`SELECT r.*,
    COALESCE((SELECT sum(a.amount_cents) FROM activity_payment_allocation a WHERE a.registration_id=r.id),0) AS raw_paid_cents,
    COALESCE((SELECT sum(o.amount_cents) FROM finance_overpayment o WHERE o.registration_id=r.id),0) AS claimed_cents
    FROM activity_registration r WHERE r.id=?`).bind(requireUuid(registrationId)).first();
  if (!row) throw notFound();
  if (!row.finance_round_id || !['NEEDS_PARTICIPANT_REVIEW','AWAITING_PAYMENT_REVIEW','CONFIRMED'].includes(row.status) ||
      row.expected_amount_cents < 1 || row.version !== input.expectedVersion ||
      row.expected_amount_cents === input.amountCents)
    throw new AppError(409, 'invalid_activity_price_correction');
  const plan = await db.prepare("SELECT id,current_revision FROM activity_installment_plan WHERE registration_id=? AND status='ACTIVE'")
    .bind(registrationId).first();
  if (plan && (!input.planParts || plan.current_revision >= 100))
    throw new AppError(409, 'activity_installment_plan_revision_required');
  if (!plan && input.planParts != null) fail('invalid_activity_price_correction');
  const parts = plan ? schedule(input.planParts, input.amountCents) : [];
  const newBase = Math.max(row.price_base_cents, input.amountCents);
  const newDiscount = newBase - input.amountCents;
  let excess = row.raw_paid_cents - row.claimed_cents - input.amountCents;
  const claims = [];
  if (excess > 0) {
    const sources = (await db.prepare(`SELECT a.id,a.amount_cents,e.review_status
      FROM activity_payment_allocation a LEFT JOIN payment_evidence e ON e.id=a.evidence_id
      WHERE a.registration_id=? ORDER BY a.created_at DESC,a.id DESC`).bind(registrationId).all()).results;
    if (sources.some(source => source.review_status != null && source.review_status !== 'VERIFIED'))
      throw new AppError(409, 'activity_payment_review_required');
    if (sources.reduce((sum, source) => sum + source.amount_cents, 0) < row.raw_paid_cents)
      throw new AppError(409, 'activity_payment_review_required');
    const claimId = uuid();
    claims.push({ id: claimId, amountCents: excess });
  }
  const revisionId = uuid();
  await commit(db, [
    db.prepare(`INSERT INTO activity_price_correction_gate
      (registration_id,reason,opened_at,target_due_cents,opened_by) VALUES(?,?,?,?,?)`)
      .bind(registrationId,input.reason.trim(),now,input.amountCents,context.userId),
    ...claims.map(claim => db.prepare(`INSERT INTO finance_overpayment
      (id,round_id,registration_id,recipient_email,cause,amount_cents,created_by,created_at)
      VALUES(?,?,?,?,'PRICE_CORRECTION',?,?,?)`).bind(claim.id,row.finance_round_id,registrationId,
        row.receipt_email,claim.amountCents,context.userId,now)),
    db.prepare(`UPDATE activity_registration SET ${versionCas('version')},expected_amount_cents=?,price_base_cents=?,
      price_discount_cents=?,updated_at=? WHERE id=?`).bind(input.expectedVersion,input.amountCents,newBase,newDiscount,now,registrationId),
    db.prepare(`INSERT INTO activity_price_revision(id,registration_id,previous_amount_cents,new_amount_cents,
      previous_discount_cents,new_discount_cents,reason,changed_by,changed_at) VALUES(?,?,?,?,?,?,?,?,?)`)
      .bind(revisionId,registrationId,row.expected_amount_cents,input.amountCents,row.price_discount_cents,
        newDiscount,input.reason.trim(),context.userId,now),
    ...(plan ? [
      db.prepare(`INSERT INTO activity_installment_revision
        (plan_id,revision,total_cents,reason,authorized_by,authorized_at) VALUES(?,?,?,?,?,?)`)
        .bind(plan.id,plan.current_revision+1,input.amountCents,input.reason.trim(),context.userId,now),
      ...parts.map((part,index) => db.prepare(`INSERT INTO activity_installment_part
        (plan_id,revision,ordinal,planned_cents,target_at) VALUES(?,?,?,?,?)`)
        .bind(plan.id,plan.current_revision+1,index+1,part.amountCents,part.targetAt??null)),
      db.prepare(`UPDATE activity_installment_plan SET ${versionCas('current_revision')},total_cents=? WHERE id=?`)
        .bind(plan.current_revision,input.amountCents,plan.id)
    ] : []),
    audit(db,context,requestId,'ACTIVITY_PRICE_CORRECTED','activity_registration',registrationId,now),
    ...claims.map(claim => audit(db,context,requestId,'FAMILY_OVERPAYMENT_CREATED','finance_overpayment',claim.id,now)),
    db.prepare('DELETE FROM activity_price_correction_gate WHERE registration_id=?').bind(registrationId)
  ], 'stale_activity_price');
  return { id: registrationId, revisionId, amountCents: input.amountCents,
    overpaymentIds: claims.map(claim => claim.id), planRevision: plan ? plan.current_revision + 1 : null };
}

export async function activityPriceHistory(db, context, requestId, registrationId) {
  await allow(db, context, requestId, 'finance.activity.installment.authorize', 'activity_registration',
    validUuid(registrationId) ? registrationId : null);
  if (!await db.prepare('SELECT 1 FROM activity_registration WHERE id=?').bind(requireUuid(registrationId)).first())
    throw notFound();
  return { revisions: (await db.prepare(`SELECT id,previous_amount_cents AS previousAmountCents,
    new_amount_cents AS newAmountCents,previous_discount_cents AS previousDiscountCents,
    new_discount_cents AS newDiscountCents,reason,changed_at AS changedAt
    FROM activity_price_revision WHERE registration_id=? ORDER BY changed_at DESC,id DESC`)
    .bind(registrationId).all()).results };
}
