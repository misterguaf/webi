// FASE 3.5E — guardians, contacts and legal representation for the Família tab (§9–§10).
// Scope is the participant's current section. A permission over one participant never reaches another:
// shared guardian data is only edited directly when the user covers every active linked participant;
// otherwise the change becomes a request for Secretaria. Contact values are returned only on an
// explicit, audited consultation and never written to logs or audit metadata.
import { authorize } from '../policy.js';
import { append, statement } from '../domains/audit/repository.js';
import { AppError, requirePermission, requireUuid, validUuid } from './common.js';

const RELATIONSHIPS = new Set(['PARENT', 'LEGAL_GUARDIAN', 'OTHER']);
const PROVENANCE = new Set(['CRM_ANTERIOR', 'DOCUMENTACIO_FISICA', 'COMUNICACIO_FAMILIA', 'ALTRES']);
const covers = (decision, sectionId) => decision.allow && (decision.sections === null || decision.sections.includes(sectionId));
async function deny(db, context, requestId, reason, resourceId, resourceType) {
  await append(db, { requestId, actorUserId: context.userId, sessionId: context.sessionId, action: 'AUTHZ_DENY',
    result: 'DENY', resourceType: resourceType ?? 'participant', resourceId: resourceId ?? null, reasonCode: reason });
}

// Uniform 403 for users who lack the permission anywhere, then a 404 that never distinguishes a
// missing participant from one in another section.
async function requireOn(db, context, requestId, participantId, permission) {
  const decision = await authorize(db, context, { permission, mode: 'list' });
  if (!decision.allow) { await deny(db, context, requestId, decision.reason, participantId); throw new AppError(403, 'forbidden'); }
  const current = await db.prepare('SELECT id,current_section_id,status FROM participant WHERE id=?').bind(participantId).first();
  if (!current || !(decision.sections === null || decision.sections.includes(current.current_section_id))) {
    await deny(db, context, requestId, current ? 'OUT_OF_SCOPE' : 'NOT_FOUND', participantId);
    throw new AppError(404, 'not_found');
  }
  return { current, decision };
}
// Shared guardian: does the user cover every active participant linked to it? Used to decide whether
// shared data (the guardian's name and contact points) can be edited directly or must go to Secretaria.
async function guardianFullyInScope(db, decision, guardianId) {
  if (decision.sections === null) return true;
  const links = (await db.prepare(`SELECT p.current_section_id AS s FROM participant_guardian pg
    JOIN participant p ON p.id=pg.participant_id WHERE pg.guardian_id=? AND pg.ended_at IS NULL`).bind(guardianId).all()).results;
  return links.every(link => decision.sections.includes(link.s));
}
async function openReview(db, context, requestId, { kind, participantId = null, guardianId = null, detail = null, payload = null, duplicateOf = null }, now) {
  const id = crypto.randomUUID();
  return [db.prepare(`INSERT INTO participant_review(id,kind,status,participant_id,guardian_id,duplicate_of,detail,payload_json,created_by,created_at)
    VALUES(?,?,'OPEN',?,?,?,?,?,?,?)`).bind(id, kind, participantId, guardianId, duplicateOf, detail, payload ? JSON.stringify(payload) : null, context.userId, now),
    statement(db, { requestId, actorUserId: context.userId, sessionId: context.sessionId, action: 'DATA_CREATED', resourceType: 'participant_review', resourceId: id, occurredAt: now })];
}

// ---------------------------------------------------------------- read model (§9.3)
export async function familia(db, context, requestId, participantId) {
  requireUuid(participantId);
  await requireOn(db, context, requestId, participantId, 'participants.contact.read');
  const guardians = (await db.prepare(`SELECT g.id,g.display_name,pg.relationship,pg.legal_representative,pg.representation_basis,
    pg.started_at,pg.ended_at FROM participant_guardian pg JOIN guardian g ON g.id=pg.guardian_id
    WHERE pg.participant_id=? ORDER BY pg.ended_at IS NOT NULL,g.display_name`).bind(participantId).all()).results;
  const contactKinds = async (column, ownerId) => (await db.prepare(
    `SELECT id,kind,purpose,is_primary FROM contact_point WHERE ${column}=? AND ended_at IS NULL ORDER BY kind,is_primary DESC`).bind(ownerId).all()).results
    .map(row => ({ id: row.id, kind: row.kind, purpose: row.purpose, isPrimary: !!row.is_primary }));
  const reviewed = async guardianId => !!await db.prepare(`SELECT 1 FROM participant_review
    WHERE kind='REPRESENTATION_CHANGE' AND participant_id=? AND guardian_id=? AND status IN ('ACKNOWLEDGED','RESOLVED')
    ORDER BY created_at DESC LIMIT 1`).bind(participantId, guardianId).first();
  const pending = async guardianId => !!await db.prepare(`SELECT 1 FROM participant_review
    WHERE kind='REPRESENTATION_CHANGE' AND participant_id=? AND guardian_id=? AND status IN ('OPEN','INCIDENCE','ESCALATED') LIMIT 1`)
    .bind(participantId, guardianId).first();
  const out = [];
  for (const g of guardians) out.push({ id: g.id, displayName: g.display_name, relationship: g.relationship,
    legalRepresentative: !!g.legal_representative, representationBasis: g.representation_basis, ended: g.ended_at != null,
    representationReviewed: g.legal_representative ? await reviewed(g.id) : false,
    representationPending: g.legal_representative ? await pending(g.id) : false,
    contacts: await contactKinds('guardian_id', g.id) });
  return { guardians: out, participantContacts: await contactKinds('participant_id', participantId) };
}

// Explicit, audited consultation of one owner's contact values (§9.2). Values never reach the log.
export async function consultContact(db, context, requestId, contactId) {
  requireUuid(contactId);
  // Uniform 403 for anyone without contact scope; the row is not even looked up.
  const decision = await authorize(db, context, { permission: 'participants.contact.read', mode: 'list' });
  if (!decision.allow) { await deny(db, context, requestId, decision.reason, contactId, 'contact_point'); throw new AppError(403, 'forbidden'); }
  const row = await db.prepare('SELECT id,participant_id,guardian_id,kind,value,purpose,is_primary FROM contact_point WHERE id=? AND ended_at IS NULL').bind(contactId).first();
  const participantId = !row ? null : (row.participant_id ?? await guardianAnchorParticipant(db, decision, row.guardian_id));
  const inScope = participantId && await db.prepare(`SELECT 1 FROM participant WHERE id=?${decision.sections === null ? '' : ` AND current_section_id IN (${decision.sections.map(() => '?').join(',')})`}`)
    .bind(participantId, ...(decision.sections ?? [])).first();
  if (!inScope) { await deny(db, context, requestId, row ? 'OUT_OF_SCOPE' : 'NOT_FOUND', contactId, 'contact_point'); throw new AppError(404, 'not_found'); }
  await append(db, { requestId, actorUserId: context.userId, sessionId: context.sessionId, action: 'SENSITIVE_DATA_READ',
    resourceType: 'contact_point', resourceId: contactId, result: 'SUCCESS', reasonCode: 'CONTACT_CONSULTED' });
  return { id: row.id, kind: row.kind, value: row.value, purpose: row.purpose, isPrimary: !!row.is_primary };
}
// An in-scope active participant linked to a guardian (so a guardian contact can be authorised).
async function guardianAnchorParticipant(db, decisionOrContext, guardianId) {
  const decision = decisionOrContext.allow !== undefined ? decisionOrContext
    : await authorize(db, decisionOrContext, { permission: 'participants.contact.read', mode: 'list' });
  if (!decision.allow) return null;
  const scope = decision.sections === null ? '' : ` AND p.current_section_id IN (${decision.sections.map(() => '?').join(',')})`;
  const row = await db.prepare(`SELECT pg.participant_id AS id FROM participant_guardian pg JOIN participant p ON p.id=pg.participant_id
    WHERE pg.guardian_id=? AND pg.ended_at IS NULL${scope} LIMIT 1`).bind(guardianId, ...(decision.sections ?? [])).first();
  return row?.id ?? null;
}

// ---------------------------------------------------------------- guardian writes
function validateGuardianInput(input, { requireName }) {
  const keys = new Set(['guardianId', 'name', 'relationship', 'legalRepresentative', 'provenance', 'provenanceNote']);
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !keys.has(key))) throw new AppError(400, 'invalid_guardian');
  if (!RELATIONSHIPS.has(input.relationship)) throw new AppError(400, 'invalid_guardian');
  if (input.legalRepresentative != null && typeof input.legalRepresentative !== 'boolean') throw new AppError(400, 'invalid_guardian');
  if (input.provenance != null && !PROVENANCE.has(input.provenance)) throw new AppError(400, 'invalid_guardian');
  if (input.provenanceNote != null && (typeof input.provenanceNote !== 'string' || input.provenanceNote.length > 200)) throw new AppError(400, 'invalid_guardian');
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (requireName && (!name || name.length > 120)) throw new AppError(400, 'invalid_guardian');
  if (name.length > 120) throw new AppError(400, 'invalid_guardian');
  return { name };
}
// Create a new guardian and link it, or link an existing one the user can already see. Nothing is
// merged; representation, when set, starts as COMUNICAT and opens a review.
export async function addGuardian(db, context, requestId, participantId, input, now = Date.now()) {
  requireUuid(participantId);
  const { name } = validateGuardianInput(input, { requireName: !input?.guardianId });
  const { decision } = await requireOn(db, context, requestId, participantId, 'participants.guardian.manage');
  const rep = input.legalRepresentative === true;
  const statements = [];
  let guardianId = input.guardianId ?? null;
  if (guardianId) {
    requireUuid(guardianId);
    // Only link a guardian already visible to the user (shares an in-scope active participant).
    if (!await guardianAnchorParticipant(db, context, guardianId)) throw new AppError(404, 'not_found');
    if (await db.prepare('SELECT 1 FROM participant_guardian WHERE participant_id=? AND guardian_id=?').bind(participantId, guardianId).first())
      throw new AppError(409, 'already_linked');
  } else {
    guardianId = crypto.randomUUID();
    statements.push(db.prepare("INSERT INTO guardian(id,display_name,status,created_at,updated_at) VALUES(?,?,'ACTIVE',?,?)").bind(guardianId, name, now, now));
  }
  statements.push(db.prepare(`INSERT INTO participant_guardian(participant_id,guardian_id,relationship,legal_representative,started_at,
    representation_basis,recorded_by,provenance,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`)
    .bind(participantId, guardianId, input.relationship, rep ? 1 : 0, now, rep ? 'COMUNICAT' : null, context.userId, input.provenance ?? null, now));
  statements.push(statement(db, { requestId, actorUserId: context.userId, sessionId: context.sessionId, action: 'DATA_CREATED', resourceType: 'participant_guardian', resourceId: guardianId, occurredAt: now }));
  if (rep) {
    statements.push(...representationEvent(db, context, { participantId, guardianId, action: 'SET_REPRESENTATIVE', basis: 'COMUNICAT', provenance: input.provenance ?? null, note: input.provenanceNote ?? null }, now));
    statements.push(...await openReview(db, context, requestId, { kind: 'REPRESENTATION_CHANGE', participantId, guardianId, detail: 'Representant legal comunicat' }, now));
  }
  await db.batch(statements);
  void decision;
  return { guardianId };
}
export async function endGuardianRelationship(db, context, requestId, participantId, guardianId, now = Date.now()) {
  requireUuid(participantId); requireUuid(guardianId);
  await requireOn(db, context, requestId, participantId, 'participants.guardian.manage');
  const link = await db.prepare('SELECT legal_representative FROM participant_guardian WHERE participant_id=? AND guardian_id=? AND ended_at IS NULL').bind(participantId, guardianId).first();
  if (!link) throw new AppError(404, 'not_found');
  const statements = [
    db.prepare('UPDATE participant_guardian SET ended_at=?,updated_at=? WHERE participant_id=? AND guardian_id=? AND ended_at IS NULL').bind(now, now, participantId, guardianId),
    statement(db, { requestId, actorUserId: context.userId, sessionId: context.sessionId, action: 'DATA_UPDATED', resourceType: 'participant_guardian', resourceId: guardianId, occurredAt: now })];
  if (link.legal_representative) {
    statements.push(...representationEvent(db, context, { participantId, guardianId, action: 'RELATIONSHIP_ENDED', basis: null, provenance: null, note: null }, now));
    statements.push(...await openReview(db, context, requestId, { kind: 'REPRESENTATION_CHANGE', participantId, guardianId, detail: 'Fi de la relació amb un representant legal' }, now));
  }
  await db.batch(statements);
  return { ended: true };
}
// Set or clear communicated legal representation (§10). Always a relevant change → review + history.
export async function setRepresentation(db, context, requestId, participantId, guardianId, input, now = Date.now()) {
  requireUuid(participantId); requireUuid(guardianId);
  if (!input || typeof input.legalRepresentative !== 'boolean' || Object.keys(input).some(key => !['legalRepresentative', 'provenance', 'provenanceNote'].includes(key)))
    throw new AppError(400, 'invalid_guardian');
  if (input.provenance != null && !PROVENANCE.has(input.provenance)) throw new AppError(400, 'invalid_guardian');
  await requireOn(db, context, requestId, participantId, 'participants.guardian.manage');
  const link = await db.prepare('SELECT legal_representative FROM participant_guardian WHERE participant_id=? AND guardian_id=? AND ended_at IS NULL').bind(participantId, guardianId).first();
  if (!link) throw new AppError(404, 'not_found');
  const next = input.legalRepresentative;
  if (!!link.legal_representative === next) throw new AppError(409, 'invalid_transition');
  await db.batch([
    db.prepare('UPDATE participant_guardian SET legal_representative=?,representation_basis=?,recorded_by=?,updated_at=? WHERE participant_id=? AND guardian_id=? AND ended_at IS NULL')
      .bind(next ? 1 : 0, next ? 'COMUNICAT' : null, context.userId, now, participantId, guardianId),
    statement(db, { requestId, actorUserId: context.userId, sessionId: context.sessionId, action: 'DATA_UPDATED', resourceType: 'participant_guardian', resourceId: guardianId, occurredAt: now }),
    ...representationEvent(db, context, { participantId, guardianId, action: next ? 'SET_REPRESENTATIVE' : 'CLEAR_REPRESENTATIVE', basis: next ? 'COMUNICAT' : null, provenance: input.provenance ?? null, note: input.provenanceNote ?? null }, now),
    ...await openReview(db, context, requestId, { kind: 'REPRESENTATION_CHANGE', participantId, guardianId, detail: next ? 'Representant legal comunicat' : 'Fi de representant legal' }, now)
  ]);
  return { legalRepresentative: next, basis: next ? 'COMUNICAT' : null };
}
// Only Secretaria / general coordination accredit (§10). Never turns a review into an accreditation.
export async function accreditRepresentation(db, context, requestId, participantId, guardianId, input, now = Date.now()) {
  requireUuid(participantId); requireUuid(guardianId);
  await requirePermission(db, context, requestId, 'participants.representation.accredit', { resourceType: 'participant_guardian', resourceId: guardianId });
  // Accreditation still needs read scope on the participant (Secretaria has it group-wide).
  await requireOn(db, context, requestId, participantId, 'participants.contact.read');
  const note = input?.provenanceNote ?? null;
  if (note != null && (typeof note !== 'string' || note.length > 200)) throw new AppError(400, 'invalid_guardian');
  const link = await db.prepare('SELECT legal_representative,representation_basis FROM participant_guardian WHERE participant_id=? AND guardian_id=? AND ended_at IS NULL').bind(participantId, guardianId).first();
  if (!link) throw new AppError(404, 'not_found');
  if (!link.legal_representative || link.representation_basis === 'ACREDITAT') throw new AppError(409, 'invalid_transition');
  await db.batch([
    db.prepare('UPDATE participant_guardian SET representation_basis=?,updated_at=? WHERE participant_id=? AND guardian_id=? AND ended_at IS NULL').bind('ACREDITAT', now, participantId, guardianId),
    statement(db, { requestId, actorUserId: context.userId, sessionId: context.sessionId, action: 'DATA_UPDATED', resourceType: 'participant_guardian', resourceId: guardianId, occurredAt: now }),
    ...representationEvent(db, context, { participantId, guardianId, action: 'ACCREDIT', basis: 'ACREDITAT', provenance: 'DOCUMENTACIO_FISICA', note }, now)
  ]);
  return { basis: 'ACREDITAT' };
}
function representationEvent(db, context, { participantId, guardianId, action, basis, provenance, note }, now) {
  const id = crypto.randomUUID();
  return [db.prepare(`INSERT INTO participant_representation_event(id,participant_id,guardian_id,action,basis,provenance,note,recorded_by,recorded_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).bind(id, participantId, guardianId, action, basis, provenance, note, context.userId, now)];
}
export async function representationHistory(db, context, requestId, participantId) {
  requireUuid(participantId);
  await requireOn(db, context, requestId, participantId, 'participants.contact.read');
  return (await db.prepare(`SELECT e.action,e.basis,e.provenance,e.recorded_at,g.display_name AS guardian
    FROM participant_representation_event e JOIN guardian g ON g.id=e.guardian_id WHERE e.participant_id=? ORDER BY e.recorded_at DESC`)
    .bind(participantId).all()).results;
}

// ---------------------------------------------------------------- contact writes
const KINDS = new Set(['EMAIL', 'PHONE']);
const PURPOSES = new Set(['GENERAL', 'NOTIFICATIONS']);
function validateContactInput(input) {
  const keys = new Set(['ownerType', 'guardianId', 'kind', 'value', 'purpose', 'isPrimary']);
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !keys.has(key))) throw new AppError(400, 'invalid_contact');
  if (!['participant', 'guardian'].includes(input.ownerType) || !KINDS.has(input.kind) || (input.purpose != null && !PURPOSES.has(input.purpose))) throw new AppError(400, 'invalid_contact');
  const value = typeof input.value === 'string' ? input.value.trim() : '';
  if (input.kind === 'EMAIL' && (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value) || value.length > 254)) throw new AppError(400, 'invalid_contact');
  if (input.kind === 'PHONE' && !/^[0-9+()\s.-]{6,24}$/.test(value)) throw new AppError(400, 'invalid_contact');
  if (input.isPrimary != null && typeof input.isPrimary !== 'boolean') throw new AppError(400, 'invalid_contact');
  return { value, purpose: input.purpose ?? 'GENERAL', isPrimary: input.isPrimary === true };
}
// Adding a contact to a participant is always direct (within scope). Adding to a guardian is direct
// only when the user covers every active linked participant; otherwise it becomes a change request.
export async function addContact(db, context, requestId, participantId, input, now = Date.now()) {
  requireUuid(participantId);
  const { value, purpose, isPrimary } = validateContactInput(input);
  const { decision } = await requireOn(db, context, requestId, participantId, 'participants.contact.manage');
  if (input.ownerType === 'guardian') {
    requireUuid(input.guardianId);
    if (!await db.prepare('SELECT 1 FROM participant_guardian WHERE participant_id=? AND guardian_id=? AND ended_at IS NULL').bind(participantId, input.guardianId).first())
      throw new AppError(404, 'not_found');
    if (!await guardianFullyInScope(db, decision, input.guardianId)) {
      // Shared beyond the user's scope: request the change, revealing nothing about other sections.
      await db.batch(await openReview(db, context, requestId, { kind: 'GUARDIAN_DATA_REQUEST', participantId, guardianId: input.guardianId,
        detail: `Afegir ${input.kind === 'EMAIL' ? 'correu' : 'telèfon'} a un tutor`, payload: { op: 'ADD_CONTACT', kind: input.kind, value, purpose } }, now));
      return { requested: true };
    }
  }
  const id = crypto.randomUUID();
  const owner = input.ownerType === 'guardian' ? { column: 'guardian_id', value: input.guardianId } : { column: 'participant_id', value: participantId };
  try {
    await db.batch([
      db.prepare(`INSERT INTO contact_point(id,${owner.column},kind,value,purpose,is_primary,created_at) VALUES(?,?,?,?,?,?,?)`)
        .bind(id, owner.value, input.kind, value, purpose, isPrimary ? 1 : 0, now),
      statement(db, { requestId, actorUserId: context.userId, sessionId: context.sessionId, action: 'DATA_CREATED', resourceType: 'contact_point', resourceId: id, occurredAt: now })
    ]);
  } catch (error) {
    if (String(error?.message ?? '').includes('UNIQUE')) throw new AppError(409, 'primary_contact_exists');
    throw error;
  }
  return { id };
}
export async function endContact(db, context, requestId, participantId, contactId, now = Date.now()) {
  requireUuid(participantId); requireUuid(contactId);
  const { decision } = await requireOn(db, context, requestId, participantId, 'participants.contact.manage');
  const row = await db.prepare('SELECT participant_id,guardian_id FROM contact_point WHERE id=? AND ended_at IS NULL').bind(contactId).first();
  if (!row) throw new AppError(404, 'not_found');
  if (row.participant_id && row.participant_id !== participantId) throw new AppError(404, 'not_found');
  if (row.guardian_id) {
    if (!await db.prepare('SELECT 1 FROM participant_guardian WHERE participant_id=? AND guardian_id=? AND ended_at IS NULL').bind(participantId, row.guardian_id).first())
      throw new AppError(404, 'not_found');
    if (!await guardianFullyInScope(db, decision, row.guardian_id)) {
      await db.batch(await openReview(db, context, requestId, { kind: 'GUARDIAN_DATA_REQUEST', participantId, guardianId: row.guardian_id,
        detail: 'Retirar un contacte d’un tutor', payload: { op: 'END_CONTACT', contactId } }, now));
      return { requested: true };
    }
  }
  await db.batch([
    db.prepare('UPDATE contact_point SET ended_at=? WHERE id=? AND ended_at IS NULL').bind(now, contactId),
    statement(db, { requestId, actorUserId: context.userId, sessionId: context.sessionId, action: 'DATA_UPDATED', resourceType: 'contact_point', resourceId: contactId, occurredAt: now })
  ]);
  return { ended: true };
}
export { guardianFullyInScope, openReview };
