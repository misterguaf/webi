// FASE 3.5E — administrative review queue for Secretaria (participants.review.manage, §10.3).
// Relevant representation changes, shared-guardian change requests and possible duplicates. Acknowledging
// is not an accreditation; escalation changes no data; applying a change request performs the proposed
// guardian data operation. review.manage is group-wide, so Secretaria applies across sections.
import { pageRequest, pageResult } from '../pagination.js';
import { statement } from '../domains/audit/repository.js';
import { AppError, requirePermission, requireUuid } from './common.js';

const OPEN_STATES = ['OPEN', 'INCIDENCE', 'ESCALATED'];
async function review(db, id) {
  requireUuid(id);
  const row = await db.prepare('SELECT * FROM participant_review WHERE id=?').bind(id).first();
  if (!row) throw new AppError(404, 'not_found');
  return row;
}

export async function listReviews(db, context, requestId, params) {
  await requirePermission(db, context, requestId, 'participants.review.manage', { resourceType: 'participant_review' });
  const page = pageRequest(params, ['number', 'string']);
  const openOnly = params?.get('estat') !== 'totes';
  const where = openOnly ? `WHERE r.status IN ('OPEN','INCIDENCE','ESCALATED')` : 'WHERE 1=1';
  const rows = (await db.prepare(`SELECT r.id,r.kind,r.status,r.detail,r.payload_json,r.participant_id,r.guardian_id,r.duplicate_of,
    r.created_at,r.resolution_note,p.display_name AS participant_name,p.current_section_id,g.display_name AS guardian_name
    FROM participant_review r LEFT JOIN participant p ON p.id=r.participant_id LEFT JOIN guardian g ON g.id=r.guardian_id
    ${where}${page.after ? ` AND (r.created_at<? OR (r.created_at=? AND r.id<?))` : ''}
    ORDER BY r.created_at DESC,r.id DESC LIMIT ?`).bind(...(page.after ? [page.after[0], page.after[0], page.after[1]] : []), page.limit + 1).all()).results;
  const result = pageResult(rows, page.limit, row => [row.created_at, row.id]);
  const reviews = result.items.map(row => ({ id: row.id, kind: row.kind, status: row.status, detail: row.detail,
    payload: row.payload_json ? JSON.parse(row.payload_json) : null, participantId: row.participant_id, participantName: row.participant_name,
    guardianId: row.guardian_id, guardianName: row.guardian_name, duplicateOf: row.duplicate_of, createdAt: row.created_at, resolutionNote: row.resolution_note }));
  return { reviews, nextCursor: result.nextCursor };
}
// Scoped counts for the Dashboard: open reviews and escalations. review.manage is group-wide.
export async function reviewSummary(db, context, requestId) {
  await requirePermission(db, context, requestId, 'participants.review.manage', { resourceType: 'participant_review' });
  const open = (await db.prepare("SELECT count(*) AS n FROM participant_review WHERE status IN ('OPEN','INCIDENCE')").first()).n;
  const escalated = (await db.prepare("SELECT count(*) AS n FROM participant_review WHERE status='ESCALATED'").first()).n;
  return { open, escalated };
}
async function transition(db, context, requestId, id, next, { note = null } = {}, now = Date.now()) {
  await requirePermission(db, context, requestId, 'participants.review.manage', { resourceType: 'participant_review', resourceId: id });
  const row = await review(db, id);
  if (!OPEN_STATES.includes(row.status)) throw new AppError(409, 'invalid_transition');
  await db.batch([
    db.prepare('UPDATE participant_review SET status=?,updated_by=?,updated_at=?,resolution_note=COALESCE(?,resolution_note) WHERE id=?').bind(next, context.userId, now, note, id),
    statement(db, { requestId, actorUserId: context.userId, sessionId: context.sessionId, action: 'DATA_UPDATED', resourceType: 'participant_review', resourceId: id, occurredAt: now })
  ]);
  return { id, status: next };
}
export const acknowledgeReview = (db, c, r, id, now) => transition(db, c, r, id, 'ACKNOWLEDGED', {}, now);
export function raiseIncidence(db, c, r, id, input, now) {
  const note = input?.note ?? null;
  if (note != null && (typeof note !== 'string' || note.length > 280)) throw new AppError(400, 'invalid_review');
  return transition(db, c, r, id, 'INCIDENCE', { note }, now);
}
export const escalateReview = (db, c, r, id, now) => transition(db, c, r, id, 'ESCALATED', {}, now);
export const resolveReview = (db, c, r, id, now) => transition(db, c, r, id, 'RESOLVED', { note: 'Resolta' }, now);

// Apply a shared-guardian change request: perform the proposed operation, then resolve. Only Secretaria.
export async function applyChangeRequest(db, context, requestId, id, now = Date.now()) {
  await requirePermission(db, context, requestId, 'participants.review.manage', { resourceType: 'participant_review', resourceId: id });
  const row = await review(db, id);
  if (row.kind !== 'GUARDIAN_DATA_REQUEST' || !OPEN_STATES.includes(row.status)) throw new AppError(409, 'invalid_transition');
  const payload = row.payload_json ? JSON.parse(row.payload_json) : null;
  if (!payload) throw new AppError(409, 'invalid_transition');
  const ops = [];
  if (payload.op === 'ADD_CONTACT') {
    const cid = crypto.randomUUID();
    ops.push(db.prepare("INSERT INTO contact_point(id,guardian_id,kind,value,purpose,is_primary,created_at) VALUES(?,?,?,?,?,0,?)")
      .bind(cid, row.guardian_id, payload.kind, payload.value, payload.purpose ?? 'GENERAL', now),
    statement(db, { requestId, actorUserId: context.userId, sessionId: context.sessionId, action: 'DATA_CREATED', resourceType: 'contact_point', resourceId: cid, occurredAt: now }));
  } else if (payload.op === 'END_CONTACT') {
    ops.push(db.prepare('UPDATE contact_point SET ended_at=? WHERE id=? AND guardian_id=? AND ended_at IS NULL').bind(now, payload.contactId, row.guardian_id),
      statement(db, { requestId, actorUserId: context.userId, sessionId: context.sessionId, action: 'DATA_UPDATED', resourceType: 'contact_point', resourceId: payload.contactId, occurredAt: now }));
  } else throw new AppError(409, 'invalid_transition');
  await db.batch([...ops,
    db.prepare("UPDATE participant_review SET status='RESOLVED',updated_by=?,updated_at=?,resolution_note='Aplicada' WHERE id=?").bind(context.userId, now, id),
    statement(db, { requestId, actorUserId: context.userId, sessionId: context.sessionId, action: 'DATA_UPDATED', resourceType: 'participant_review', resourceId: id, occurredAt: now })]);
  return { id, status: 'RESOLVED', applied: true };
}
export async function rejectChangeRequest(db, context, requestId, id, now = Date.now()) {
  await requirePermission(db, context, requestId, 'participants.review.manage', { resourceType: 'participant_review', resourceId: id });
  const row = await review(db, id);
  if (row.kind !== 'GUARDIAN_DATA_REQUEST' || !OPEN_STATES.includes(row.status)) throw new AppError(409, 'invalid_transition');
  return transition(db, context, requestId, id, 'RESOLVED', { note: 'Rebutjada' }, now);
}
