import { versionCas } from '../../concurrency.js';
import { activityPrice } from '../../services/activity-pricing.js';
import { AppError, requireUuid, validUuid } from '../../services/common.js';
import { allow, audit, commit, fail, keysOnly, notFound, uuid } from './shared.js';

function parts(input) {
  if (!Array.isArray(input) || input.length < 2 || input.length > 100 ||
      input.some(part => !keysOnly(part, ['amountCents', 'targetAt']) ||
        !Number.isSafeInteger(part.amountCents) || part.amountCents < 1 || part.amountCents > 1000000 ||
        (part.targetAt != null && (!Number.isSafeInteger(part.targetAt) || part.targetAt < 0))))
    fail('invalid_activity_installment_plan');
  const total = input.reduce((sum, part) => sum + part.amountCents, 0);
  if (total > 1000000) fail('invalid_activity_installment_plan');
  return total;
}
async function target(db, activityId, participantId, transportCode) {
  const activity = await db.prepare('SELECT id,status,price_cents,starts_at FROM activity WHERE id=?')
    .bind(requireUuid(activityId)).first();
  const participant = await db.prepare("SELECT id FROM participant WHERE id=? AND status='ACTIVE'")
    .bind(requireUuid(participantId)).first();
  if (!activity || !participant || activity.status !== 'PUBLISHED' || activity.price_cents <= 0)
    throw new AppError(409, 'invalid_activity_installment_plan');
  const options = (await db.prepare('SELECT code,price_adjustment_cents FROM activity_transport_option WHERE activity_id=?')
    .bind(activityId).all()).results;
  if ((!options.length && transportCode != null) || (options.length && !options.some(row => row.code === transportCode)))
    fail('invalid_activity_installment_plan');
  const baseCents = activity.price_cents + (options.find(row => row.code === transportCode)?.price_adjustment_cents ?? 0);
  if (baseCents < 1 || baseCents > 1000000) fail('invalid_activity_installment_plan');
  return activityPrice(db, { baseCents, startsAt: activity.starts_at, participantId });
}
const planParts = (db, planId, revision, schedule) => schedule.map((part, index) =>
  db.prepare(`INSERT INTO activity_installment_part(plan_id,revision,ordinal,planned_cents,target_at)
    VALUES(?,?,?,?,?)`).bind(planId, revision, index + 1, part.amountCents, part.targetAt ?? null));

export async function authorizeActivityPlan(db, context, requestId, input, now = Date.now()) {
  await allow(db, context, requestId, 'finance.activity.installment.authorize', 'activity_installment_plan');
  if (!keysOnly(input, ['activityId', 'participantId', 'transportCode', 'parts']) ||
      !validUuid(input.activityId) || !validUuid(input.participantId) ||
      (input.transportCode != null && !['GROUP', 'FAMILY'].includes(input.transportCode)))
    fail('invalid_activity_installment_plan');
  const total = parts(input.parts);
  const price = await target(db, input.activityId, input.participantId, input.transportCode ?? null);
  if (price.amountCents !== total) fail('invalid_activity_installment_total');
  if (await db.prepare(`SELECT 1 FROM activity_registration WHERE activity_id=? AND participant_id=?
    AND status NOT IN ('REJECTED','WITHDRAWN')`).bind(input.activityId, input.participantId).first())
    throw new AppError(409, 'registration_already_submitted');
  const id = uuid();
  await commit(db, [
    db.prepare(`INSERT INTO activity_installment_plan
      (id,activity_id,participant_id,transport_code,total_cents,status,authorized_by,authorized_at)
      VALUES(?,?,?,?,?,'DRAFT',?,?)`).bind(id, input.activityId, input.participantId,
        input.transportCode ?? null, total, context.userId, now),
    db.prepare(`INSERT INTO activity_installment_revision
      (plan_id,revision,total_cents,authorized_by,authorized_at) VALUES(?,1,?,?,?)`)
      .bind(id, total, context.userId, now),
    ...planParts(db, id, 1, input.parts),
    db.prepare("UPDATE activity_installment_plan SET status='ACTIVE' WHERE id=? AND status='DRAFT'").bind(id),
    audit(db, context, requestId, 'ACTIVITY_INSTALLMENT_PLAN_AUTHORIZED', 'activity_installment_plan', id, now)
  ]);
  return { id, revision: 1, totalCents: total };
}

export async function reviseActivityPlan(db, context, requestId, id, input, now = Date.now()) {
  await allow(db, context, requestId, 'finance.activity.installment.authorize', 'activity_installment_plan',
    validUuid(id) ? id : null);
  const plan = await db.prepare('SELECT * FROM activity_installment_plan WHERE id=?').bind(requireUuid(id)).first();
  if (!plan) throw notFound();
  if (!keysOnly(input, ['parts', 'reason', 'expectedRevision']) || !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 1 || typeof input.reason !== 'string' ||
      input.reason.trim().length < 3 || input.reason.trim().length > 240)
    fail('invalid_activity_installment_plan');
  const total = parts(input.parts);
  if (plan.status !== 'ACTIVE' || plan.current_revision !== input.expectedRevision || plan.current_revision >= 100)
    throw new AppError(409, 'stale_activity_installment_plan');
  const due = plan.registration_id ? await db.prepare('SELECT expected_amount_cents AS cents FROM activity_registration WHERE id=?')
    .bind(plan.registration_id).first() : await target(db, plan.activity_id, plan.participant_id, plan.transport_code);
  if (total !== (plan.registration_id ? due.cents : due.amountCents)) fail('invalid_activity_installment_total');
  const revision = plan.current_revision + 1;
  try { await commit(db, [
    db.prepare(`INSERT INTO activity_installment_revision
      (plan_id,revision,total_cents,reason,authorized_by,authorized_at) VALUES(?,?,?,?,?,?)`)
      .bind(id, revision, total, input.reason.trim(), context.userId, now),
    ...planParts(db, id, revision, input.parts),
    db.prepare(`UPDATE activity_installment_plan SET ${versionCas('current_revision')},total_cents=? WHERE id=?`)
      .bind(input.expectedRevision, total, id),
    audit(db, context, requestId, 'ACTIVITY_INSTALLMENT_PLAN_CORRECTED', 'activity_installment_plan', id, now)
  ]); } catch (error) {
    if (String(error?.message ?? '').includes('NOT NULL constraint failed: activity_installment_plan.current_revision'))
      throw new AppError(409, 'stale_activity_installment_plan');
    throw error;
  }
  return { id, revision, totalCents: total };
}

export async function activityPlanDetail(db, context, requestId, id) {
  await allow(db, context, requestId, 'finance.activity.installment.authorize', 'activity_installment_plan',
    validUuid(id) ? id : null);
  const plan = await db.prepare(`SELECT id,activity_id AS activityId,participant_id AS participantId,
    registration_id AS registrationId,transport_code AS transportCode,total_cents AS totalCents,
    status,current_revision AS currentRevision,authorized_at AS authorizedAt
    FROM activity_installment_plan WHERE id=?`).bind(requireUuid(id)).first();
  if (!plan) throw notFound();
  const revisions = (await db.prepare(`SELECT revision,total_cents AS totalCents,reason,authorized_at AS authorizedAt
    FROM activity_installment_revision WHERE plan_id=? ORDER BY revision DESC`).bind(id).all()).results;
  for (const revision of revisions) revision.parts = (await db.prepare(`SELECT ordinal,planned_cents AS amountCents,target_at AS targetAt
    FROM activity_installment_part WHERE plan_id=? AND revision=? ORDER BY ordinal`)
    .bind(id, revision.revision).all()).results;
  return { plan, revisions };
}

export async function planForRegistration(db,context,requestId,registrationId) {
  await allow(db,context,requestId,'finance.activity.installment.authorize','activity_registration',
    validUuid(registrationId)?registrationId:null);
  const registration=await db.prepare('SELECT id FROM activity_registration WHERE id=?')
    .bind(requireUuid(registrationId)).first();
  if (!registration) throw notFound();
  const plan=await db.prepare(`SELECT id,total_cents AS totalCents,current_revision AS currentRevision
    FROM activity_installment_plan WHERE registration_id=? AND status='ACTIVE'`)
    .bind(registrationId).first();
  if (!plan) return {plan:null};
  plan.parts=(await db.prepare(`SELECT ordinal,planned_cents AS amountCents,target_at AS targetAt
    FROM activity_installment_part WHERE plan_id=? AND revision=? ORDER BY ordinal`)
    .bind(plan.id,plan.currentRevision).all()).results;
  return {plan};
}

export async function activityPlanCandidates(db,context,requestId,params) {
  await allow(db,context,requestId,'finance.activity.installment.authorize','activity_installment_plan');
  const activityId=params?.get('activityId'),search=params?.get('q')?.trim();
  if (!validUuid(activityId) || !search || search.length<2 || search.length>60)
    fail('invalid_activity_installment_search');
  const activity=await db.prepare("SELECT id,audience,status,price_cents,starts_at FROM activity WHERE id=?")
    .bind(activityId).first();
  if (!activity || activity.status!=='PUBLISHED' || activity.price_cents<=0)
    throw new AppError(409,'invalid_activity_installment_plan');
  const escaped=search.replaceAll('\\','\\\\').replaceAll('%','\\%').replaceAll('_','\\_');
  const rows=(await db.prepare(`SELECT p.id,p.display_name AS name,s.code AS sectionCode
    FROM participant p JOIN section s ON s.id=p.current_section_id
    WHERE p.status='ACTIVE' AND p.display_name LIKE ? ESCAPE '\\'
      AND (?='GENERAL' OR EXISTS(SELECT 1 FROM activity_section x
        WHERE x.activity_id=? AND x.section_id=p.current_section_id))
      AND NOT EXISTS(SELECT 1 FROM activity_registration r WHERE r.activity_id=? AND r.participant_id=p.id
        AND r.status NOT IN ('REJECTED','WITHDRAWN'))
    ORDER BY p.display_name,p.id LIMIT 20`)
    .bind(`%${escaped}%`,activity.audience,activityId,activityId).all()).results;
  const options=(await db.prepare('SELECT code,price_adjustment_cents FROM activity_transport_option WHERE activity_id=?')
    .bind(activityId).all()).results;
  for(const row of rows){
    row.prices={};
    for(const option of options.length?options:[{code:'NONE',price_adjustment_cents:0}])
      row.prices[option.code]=(await activityPrice(db,{baseCents:activity.price_cents+option.price_adjustment_cents,
        startsAt:activity.starts_at,participantId:row.id})).amountCents;
  }
  return {candidates:rows};
}
