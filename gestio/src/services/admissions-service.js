// FASE 3.5H.2 — Noves altes (docs/decisions/ADMIN_DECISIONS.md, H.2). The existing public form feeds an
// AdmissionRequest through the PortalIntake service binding; Gestió runs the workflow. Scope is the request's
// confirmed section, or the requested one until confirmed. Matching never leaves Gestió and is never automatic:
// an ambiguous match blocks acceptance until a group-wide reviewer resolves it.
import { authorize } from '../policy.js';
import { append, statement } from '../domains/audit/repository.js';
import { synthetic } from '../environment-policy.js';
import { AppError, requirePermission, requireUuid, validUuid } from './common.js';
import { matchKey } from './registration-service.js';
import { versionCas } from '../concurrency.js';
import { isAdult } from './participant-service.js';
import { openSystemIncidentStatements, resolveSystemIncidentStatements } from './work-incident-service.js';

// 3.5H.3: an ambiguous match is a deterministic blocker → exactly one linked SYSTEM incident (reference only).
const ambiguityKey = id => `ADMISSION_MATCH_AMBIGUOUS:${id}`;
const resolveAmbiguity = (db, context, requestId, id, resolution, now) =>
  resolveSystemIncidentStatements(db, context, { key: ambiguityKey(id), resolution, requestId }, now);

// Public section labels of the existing form → existing section codes (no second section truth).
export const PUBLIC_SECTION_CODES = Object.freeze({ 'Estol (8-11)': 'MANADA', 'Tropa (11-14)': 'TROPA', 'Escoltes (14-17)': 'ESCOLTA', 'Clan (17-21)': 'CLAN' });
const SECTION_CODES = new Set(['MANADA', 'TROPA', 'ESCOLTA', 'CLAN']);
export const STATES = ['PENDING', 'IN_REVIEW', 'WAITLISTED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'];
const OPEN = ['IN_REVIEW', 'WAITLISTED'];
const REJECTION = new Set(['NO_PLACES', 'AGE_OR_SECTION', 'DUPLICATE', 'OTHER']);
const INTAKE_KEYS = new Set(['givenName', 'familyNames', 'birthDate', 'sectionLabel', 'guardianName', 'contactPhone', 'contactEmail',
  'heardFrom', 'dataConsent', 'contactConsent']);
const audit = (db, context, requestId, action, id, now, reasonCode = null) => statement(db, { requestId, actorUserId: context?.userId ?? null,
  sessionId: context?.sessionId ?? null, action, resourceType: 'admission_request', resourceId: id, reasonCode, occurredAt: now });
const event = (db, { requestId: id, action, from, to, actor = null, sectionId = null, category = null }, now) => db.prepare(`INSERT INTO
  admission_request_event(id,request_id,action,from_status,to_status,actor_user_id,section_id,category,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
  .bind(crypto.randomUUID(), id, action, from, to, actor, sectionId, category, now);
// Run an atomic batch whose first statement is a version compare-and-set; a stale version aborts everything.
async function commit(db, statements) {
  try { return await db.batch(statements); }
  catch (error) { if (/NOT NULL constraint failed: (admission_request|participant)\.version/.test(String(error?.message))) throw new AppError(409, 'stale_admission'); throw error; }
}
const clean = value => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim() : '';
const sectionIdOf = async (db, code) => (await db.prepare('SELECT id FROM section WHERE code=?').bind(code).first())?.id ?? null;

// ---------------------------------------------------------------- public intake (write-only, neutral)
export async function submitAdmission(db, input, requestId, now = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !INTAKE_KEYS.has(key))) throw new AppError(400, 'invalid_admission');
  const givenName = clean(input.givenName), familyNames = clean(input.familyNames), guardianName = clean(input.guardianName);
  const phone = clean(input.contactPhone), email = clean(input.contactEmail).toLowerCase(), heardFrom = clean(input.heardFrom);
  const birthDate = typeof input.birthDate === 'string' ? input.birthDate : '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(birthDate) ? new Date(`${birthDate}T00:00:00Z`) : null;
  const sectionCode = input.sectionLabel ? PUBLIC_SECTION_CODES[input.sectionLabel] : null;
  const digits = phone.replace(/\D/g, '');
  if (!givenName || givenName.length > 80 || !familyNames || familyNames.length > 120 || !guardianName || guardianName.length > 120 ||
      !date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== birthDate || date.getTime() > now ||
      (input.sectionLabel && !sectionCode) || !/^[0-9+()\s.\-]{6,24}$/.test(phone) || digits.length < 6 || digits.length > 15 ||
      !/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email) || email.length > 254 || heardFrom.length > 200 ||
      input.dataConsent !== true || input.contactConsent !== true) throw new AppError(400, 'invalid_admission');
  // DATA_MODE=SYNTHETIC_ONLY: Gestió accepts only visibly fictitious people and test addresses.
  if (!synthetic.personName(`${givenName} ${familyNames}`) || !synthetic.personName(guardianName) || !synthetic.email(email))
    throw new AppError(400, 'invalid_admission');
  const id = crypto.randomUUID(), requested = sectionCode ? await sectionIdOf(db, sectionCode) : null;
  await db.batch([
    db.prepare(`INSERT INTO admission_request(id,received_at,source,given_name,family_names,birth_date,requested_section_id,guardian_name,
      contact_phone,contact_email,heard_from,data_consent,contact_consent,updated_at) VALUES(?,?,'PUBLIC_FORM',?,?,?,?,?,?,?,?,1,1,?)`)
      .bind(id, now, givenName, familyNames, birthDate, requested, guardianName, phone, email, heardFrom || null, now),
    event(db, { requestId: id, action: 'RECEIVED', from: null, to: 'PENDING', sectionId: requested }, now),
    audit(db, null, requestId, 'ADMISSION_RECEIVED', id, now)]);
  // Neutral: no identifier, no matching outcome, nothing about other requests.
  return { ok: true };
}

// ---------------------------------------------------------------- authorisation by the request's section
const scopeKey = row => row.section_id ?? row.requested_section_id ?? null;
const covers = (decision, sectionId) => decision.allow && (decision.sections === null || (sectionId !== null && decision.sections.includes(sectionId)));
async function deny(db, context, requestId, reason, id) {
  await append(db, { requestId, actorUserId: context.userId, sessionId: context.sessionId, action: 'AUTHZ_DENY', result: 'DENY',
    resourceType: 'admission_request', resourceId: id, reasonCode: reason });
}
/** Uniform 403 without the capability anywhere; 404 for a request outside scope (no cross-section IDOR). */
async function requireOn(db, context, requestId, id, permission) {
  requireUuid(id);
  const decision = await authorize(db, context, { permission, mode: 'list' });
  if (!decision.allow) { await deny(db, context, requestId, decision.reason, id); throw new AppError(403, 'forbidden'); }
  const row = await db.prepare('SELECT * FROM admission_request WHERE id=?').bind(id).first();
  if (!row || !covers(decision, scopeKey(row))) { await deny(db, context, requestId, row ? 'OUT_OF_SCOPE' : 'NOT_FOUND', id); throw new AppError(404, 'not_found'); }
  return { row, decision };
}
const versionOf = input => {
  if (!Number.isSafeInteger(input?.expectedVersion) || input.expectedVersion < 1) throw new AppError(400, 'invalid_request');
  return input.expectedVersion;
};

// ---------------------------------------------------------------- inbox and detail
export async function listAdmissions(db, context, requestId, params) {
  const decision = await requirePermission(db, context, requestId, 'admissions.read', { mode: 'list', resourceType: 'admission_request' });
  const filters = [], binds = [];
  const status = params?.get('status'), section = params?.get('section'), q = params?.get('q'), from = params?.get('from'), to = params?.get('to');
  if (status) { if (!STATES.includes(status)) throw new AppError(400, 'invalid_filter'); filters.push('a.status=?'); binds.push(status); }
  else filters.push("a.status IN ('PENDING','IN_REVIEW','WAITLISTED')");
  if (section) { if (!SECTION_CODES.has(section)) throw new AppError(400, 'invalid_filter'); filters.push('s.code=?'); binds.push(section); }
  if (from) { if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new AppError(400, 'invalid_filter'); filters.push('a.received_at>=?'); binds.push(Date.parse(`${from}T00:00:00Z`)); }
  if (to) { if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new AppError(400, 'invalid_filter'); filters.push('a.received_at<?'); binds.push(Date.parse(`${to}T00:00:00Z`) + 86400000); }
  if (decision.sections !== null) { filters.push(`COALESCE(a.section_id,a.requested_section_id) IN (${decision.sections.map(() => '?').join(',')})`); binds.push(...decision.sections); }
  const rows = (await db.prepare(`SELECT a.id,a.status,a.given_name,a.family_names,a.birth_date,a.received_at,a.match_status,a.version,
      s.code AS section_code,(a.section_id IS NOT NULL) AS section_confirmed FROM admission_request a
      LEFT JOIN section s ON s.id=COALESCE(a.section_id,a.requested_section_id)
    WHERE ${filters.join(' AND ')} ORDER BY CASE a.status WHEN 'PENDING' THEN 0 WHEN 'IN_REVIEW' THEN 1 WHEN 'WAITLISTED' THEN 2 ELSE 3 END,a.received_at LIMIT 500`)
    .bind(...binds).all()).results;
  const needle = q ? matchKey(String(q).slice(0, 80)) : '';
  return { admissions: rows.filter(row => !needle || matchKey(`${row.given_name} ${row.family_names}`).includes(needle))
    .map(row => ({ ...row, section_confirmed: !!row.section_confirmed })) };
}

/** Matching against every participant (any status): exact name key + birth date. Never automatic identity. */
export async function matchParticipants(db, row) {
  const key = matchKey(`${row.given_name} ${row.family_names}`);
  const people = (await db.prepare('SELECT id,display_name,birth_date,status,current_section_id,version FROM participant LIMIT 5001').all()).results;
  if (people.length > 5000) return { status: 'AMBIGUOUS', participant: null }; // fail closed until indexed matching exists
  const sameName = people.filter(person => matchKey(person.display_name) === key);
  const exact = sameName.filter(person => person.birth_date === row.birth_date);
  if (exact.length === 1 && sameName.length === 1) return { status: 'CLEAR', participant: exact[0] };
  if (!sameName.length) return { status: 'NONE', participant: null };
  return { status: 'AMBIGUOUS', participant: null, candidates: sameName };
}

export async function admissionDetail(db, context, requestId, id) {
  const { row } = await requireOn(db, context, requestId, id, 'admissions.read');
  const can = async permission => covers(await authorize(db, context, { permission, mode: 'list' }), scopeKey(row));
  const [manage, decide] = [await can('admissions.manage'), await can('admissions.decide')];
  const sections = new Map((await db.prepare('SELECT id,code,display_name FROM section').all()).results.map(item => [item.id, item]));
  const events = (await db.prepare(`SELECT e.action,e.from_status,e.to_status,e.category,e.created_at,s.code AS section_code,u.display_name AS actor_name
    FROM admission_request_event e LEFT JOIN section s ON s.id=e.section_id LEFT JOIN app_user u ON u.id=e.actor_user_id
    WHERE e.request_id=? ORDER BY e.created_at,e.rowid`).bind(id).all()).results;
  // Contact values only for people who run the workflow; matching only for those who can decide.
  let match = null;
  if (decide && OPEN.includes(row.status)) {
    const found = row.match_status?.startsWith('RESOLVED') ? { status: row.match_status } : await matchParticipants(db, row);
    const profile = await authorize(db, context, { permission: 'participants.profile.read', mode: 'list' });
    const visible = person => person && covers(profile, person.current_section_id);
    const groupWide = (await authorize(db, context, { permission: 'admissions.decide', mode: 'all-sections' })).allow && profile.allow && profile.sections === null;
    match = { status: found.status,
      participant: visible(found.participant) ? { id: found.participant.id, name: found.participant.display_name, active: found.participant.status === 'ACTIVE',
        section: sections.get(found.participant.current_section_id)?.code ?? null } : null,
      // Candidate list only for group-wide reviewers who can also see every participant (manual resolution).
      candidates: found.status === 'AMBIGUOUS' && groupWide ? found.candidates?.map(person => ({ id: person.id, name: person.display_name,
        birthDate: person.birth_date, active: person.status === 'ACTIVE', section: sections.get(person.current_section_id)?.code ?? null })) ?? [] : null,
      canResolve: groupWide };
  }
  // A linked participant is navigable only for viewers who can read that person in Participants anyway.
  let participantId = null;
  if (row.participant_id) {
    const person = await db.prepare('SELECT current_section_id FROM participant WHERE id=?').bind(row.participant_id).first();
    if (person && covers(await authorize(db, context, { permission: 'participants.profile.read', mode: 'list' }), person.current_section_id)) participantId = row.participant_id;
  }
  return { admission: {
    id: row.id, status: row.status, givenName: row.given_name, familyNames: row.family_names, birthDate: row.birth_date,
    adult: isAdult(row.birth_date), receivedAt: row.received_at, version: row.version, heardFrom: manage ? row.heard_from : null,
    requestedSection: sections.get(row.requested_section_id)?.code ?? null, section: sections.get(row.section_id)?.code ?? null,
    contact: manage && !row.contact_transferred_at ? { guardianName: row.guardian_name, phone: row.contact_phone, email: row.contact_email } : null,
    contactTransferred: !!row.contact_transferred_at, participantId, participantLinked: !!row.participant_id, rejectionCategory: row.rejection_category,
    matchStatus: row.match_status }, events, match, actions: { manage, decide } };
}

// ---------------------------------------------------------------- workflow
const TRANSITIONS = {
  'start-review': { permission: 'admissions.manage', from: ['PENDING'], to: 'IN_REVIEW', action: 'REVIEW_STARTED', audit: 'ADMISSION_REVIEW_STARTED' },
  waitlist: { permission: 'admissions.manage', from: ['PENDING', 'IN_REVIEW'], to: 'WAITLISTED', action: 'WAITLISTED', audit: 'ADMISSION_WAITLISTED' },
  'return-to-review': { permission: 'admissions.manage', from: ['WAITLISTED'], to: 'IN_REVIEW', action: 'RETURNED_TO_REVIEW', audit: 'ADMISSION_RETURNED_TO_REVIEW' },
  withdraw: { permission: 'admissions.manage', from: ['PENDING', 'IN_REVIEW', 'WAITLISTED'], to: 'WITHDRAWN', action: 'WITHDRAWN', audit: 'ADMISSION_WITHDRAWN' },
  reject: { permission: 'admissions.decide', from: ['PENDING', 'IN_REVIEW', 'WAITLISTED'], to: 'REJECTED', action: 'REJECTED', audit: 'ADMISSION_REJECTED' }
};
export async function transition(db, context, requestId, id, kind, input, now = Date.now()) {
  const step = TRANSITIONS[kind];
  if (!step) throw new AppError(404, 'not_found');
  const { row } = await requireOn(db, context, requestId, id, step.permission);
  const expected = versionOf(input);
  if (Object.keys(input).some(key => !['expectedVersion', 'category'].includes(key))) throw new AppError(400, 'invalid_request');
  const category = kind === 'reject' ? input.category : null;
  if (kind === 'reject' && !REJECTION.has(category)) throw new AppError(400, 'invalid_rejection');
  if (!step.from.includes(row.status)) throw new AppError(409, 'invalid_transition');
  await commit(db, [
    db.prepare(`UPDATE admission_request SET ${versionCas('version')},status=?,rejection_category=?,updated_at=? WHERE id=?`)
      .bind(expected, step.to, category, now, id),
    event(db, { requestId: id, action: step.action, from: row.status, to: step.to, actor: context.userId, category }, now),
    audit(db, context, requestId, step.audit, id, now, category),
    ...(['REJECTED', 'WITHDRAWN'].includes(step.to) ? await resolveAmbiguity(db, context, requestId, id, 'La sol·licitud s’ha tancat sense alta.', now) : [])]);
  return { id, status: step.to, version: expected + 1 };
}

/** Confirm the operational section (untrusted public choice until then). Both sections must be in scope. */
export async function confirmSection(db, context, requestId, id, input, now = Date.now()) {
  const { row, decision } = await requireOn(db, context, requestId, id, 'admissions.manage');
  const expected = versionOf(input);
  if (!SECTION_CODES.has(input.section)) throw new AppError(400, 'invalid_section');
  if (!OPEN.includes(row.status) && row.status !== 'PENDING') throw new AppError(409, 'invalid_transition');
  const sectionId = await sectionIdOf(db, input.section);
  if (!covers(decision, sectionId)) throw new AppError(403, 'section_out_of_scope');
  await commit(db, [
    db.prepare(`UPDATE admission_request SET ${versionCas('version')},section_id=?,updated_at=? WHERE id=?`).bind(expected, sectionId, now, id),
    event(db, { requestId: id, action: 'SECTION_CONFIRMED', from: row.status, to: row.status, actor: context.userId, sectionId }, now),
    audit(db, context, requestId, 'ADMISSION_SECTION_CONFIRMED', id, now)]);
  return { id, version: expected + 1 };
}

/** Manual resolution of an ambiguous match: group-wide reviewers who can see every participant. */
export async function resolveMatch(db, context, requestId, id, input, now = Date.now()) {
  const { row } = await requireOn(db, context, requestId, id, 'admissions.decide');
  await requirePermission(db, context, requestId, 'admissions.decide', { mode: 'all-sections', resourceType: 'admission_request', resourceId: id });
  await requirePermission(db, context, requestId, 'participants.profile.read', { mode: 'all-sections', resourceType: 'admission_request', resourceId: id });
  const expected = versionOf(input);
  if (!OPEN.includes(row.status) || !['DIFFERENT_PERSON', 'SAME_PERSON'].includes(input.decision)) throw new AppError(400, 'invalid_resolution');
  const found = await matchParticipants(db, row);
  if (found.status === 'NONE') throw new AppError(409, 'nothing_to_resolve');
  let participantId = null;
  if (input.decision === 'SAME_PERSON') {
    if (!validUuid(input.participantId) || !(found.candidates ?? [found.participant]).some(person => person?.id === input.participantId))
      throw new AppError(400, 'invalid_resolution');
    participantId = input.participantId;
  }
  const status = participantId ? 'RESOLVED_EXISTING' : 'RESOLVED_NEW';
  await commit(db, [
    db.prepare(`UPDATE admission_request SET ${versionCas('version')},match_status=?,match_participant_id=?,updated_at=? WHERE id=?`)
      .bind(expected, status, participantId, now, id),
    event(db, { requestId: id, action: 'MATCH_RESOLVED', from: row.status, to: row.status, actor: context.userId, category: status }, now),
    audit(db, context, requestId, 'ADMISSION_MATCH_RESOLVED', id, now, status),
    ...await resolveAmbiguity(db, context, requestId, id, 'Coincidència resolta a Noves altes.', now)]);
  return { id, matchStatus: status, version: expected + 1 };
}

/**
 * ACCEPT: explicit, atomic. NONE (or resolved as a different person) creates the participant with its section
 * episode, guardian and contacts; CLEAR (or resolved as the same person) links the known participant after
 * explicit confirmation (`linkParticipantId`), reactivating a former member; AMBIGUOUS blocks.
 */
export async function acceptAdmission(db, context, requestId, id, input, now = Date.now()) {
  const { row, decision } = await requireOn(db, context, requestId, id, 'admissions.decide');
  const expected = versionOf(input);
  if (Object.keys(input).some(key => !['expectedVersion', 'linkParticipantId'].includes(key))) throw new AppError(400, 'invalid_request');
  if (!OPEN.includes(row.status)) throw new AppError(409, 'invalid_transition');
  if (!row.section_id) throw new AppError(409, 'section_not_confirmed');
  if (!covers(decision, row.section_id)) throw new AppError(403, 'section_out_of_scope');
  let target = null;
  if (row.match_status === 'RESOLVED_EXISTING') target = await db.prepare('SELECT * FROM participant WHERE id=?').bind(row.match_participant_id).first();
  else if (row.match_status !== 'RESOLVED_NEW') {
    const found = await matchParticipants(db, row);
    if (found.status === 'AMBIGUOUS') {
      // Review flag on the request plus one SYSTEM incident; repeated attempts reuse it (unique key).
      await db.batch([
        ...(row.match_status !== 'AMBIGUOUS' ? [db.prepare("UPDATE admission_request SET match_status='AMBIGUOUS' WHERE id=? AND version=?").bind(id, expected)] : []),
        ...openSystemIncidentStatements(db, { key: ambiguityKey(id), type: 'DATA', title: 'Coincidència ambigua en una sol·licitud d’alta',
          module: 'participants', resourceType: 'admission_request', resourceId: id, requestId }, now)]);
      throw new AppError(409, 'admission_match_ambiguous');
    }
    if (found.status === 'CLEAR') target = found.participant;
  }
  // First statement: the request's compare-and-set, so a stale accept writes nothing at all.
  const statements = [db.prepare(`UPDATE admission_request SET ${versionCas('version')} WHERE id=?`).bind(expected, id)];
  let participantId, created = false;
  if (target) {
    // Linking a known person needs explicit confirmation of exactly that participant.
    if (input.linkParticipantId !== target.id) throw new AppError(409, 'admission_link_confirmation_required');
    // An active participant elsewhere outside the decider's scope is Secretaria's call (nothing disclosed).
    if (target.status === 'ACTIVE' && !covers(decision, target.current_section_id)) throw new AppError(409, 'admission_match_requires_secretary');
    participantId = target.id;
    if (target.status !== 'ACTIVE') statements.push(db.prepare(`UPDATE participant SET ${versionCas('version')},status='ACTIVE',current_section_id=?,updated_at=? WHERE id=?`)
      .bind(target.version, row.section_id, now, target.id));
  } else {
    if (input.linkParticipantId !== undefined) throw new AppError(400, 'invalid_request');
    participantId = crypto.randomUUID(); created = true;
    const name = `${row.given_name} ${row.family_names}`;
    statements.push(db.prepare(`INSERT INTO participant(id,display_name,current_section_id,status,birth_date,version,created_at,updated_at,created_by,provenance,provenance_note)
      VALUES(?,?,?,'ACTIVE',?,1,?,?,?,'COMUNICACIO_FAMILIA','Noves altes')`).bind(participantId, name, row.section_id, row.birth_date, now, now, context.userId),
      statement(db, { requestId, actorUserId: context.userId, sessionId: context.sessionId, action: 'DATA_CREATED', resourceType: 'participant', resourceId: participantId, occurredAt: now }));
    const contacts = [['PHONE', row.contact_phone, 'GENERAL'], ['EMAIL', row.contact_email, 'NOTIFICATIONS']].filter(([, value]) => value);
    if (isAdult(row.birth_date, now)) {
      for (const [kind, value, purpose] of contacts) statements.push(db.prepare(`INSERT INTO contact_point(id,participant_id,kind,value,purpose,is_primary,created_at)
        VALUES(?,?,?,?,?,1,?)`).bind(crypto.randomUUID(), participantId, kind, value, purpose, now));
    } else {
      const guardianId = crypto.randomUUID(), relationshipId = crypto.randomUUID();
      statements.push(db.prepare("INSERT INTO guardian(id,display_name,status,created_at,updated_at) VALUES(?,?,'ACTIVE',?,?)").bind(guardianId, row.guardian_name, now, now),
        db.prepare(`INSERT INTO participant_guardian(id,participant_id,guardian_id,relationship,legal_representative,started_at,representation_basis,recorded_by,
          provenance,updated_at,created_by) VALUES(?,?,?,'OTHER',0,?,NULL,?,'COMUNICACIO_FAMILIA',?,?)`).bind(relationshipId, participantId, guardianId, now, context.userId, now, context.userId),
        statement(db, { requestId, actorUserId: context.userId, sessionId: context.sessionId, action: 'DATA_CREATED', resourceType: 'participant_guardian', resourceId: relationshipId, occurredAt: now }),
        ...contacts.map(([kind, value, purpose]) => db.prepare(`INSERT INTO contact_point(id,guardian_id,kind,value,purpose,is_primary,created_at)
          VALUES(?,?,?,?,?,1,?)`).bind(crypto.randomUUID(), guardianId, kind, value, purpose, now)));
    }
  }
  const matchStatus = row.match_status?.startsWith('RESOLVED') ? row.match_status : target ? 'CLEAR' : 'NONE';
  // Contact moves to Participants for a new person (and is cleared here); for a known person it stays on the
  // request until reviewed, never duplicated automatically.
  statements.push(db.prepare(`UPDATE admission_request SET status='ACCEPTED',participant_id=?,match_status=?,updated_at=?
      ${created ? ',guardian_name=NULL,contact_phone=NULL,contact_email=NULL,contact_transferred_at=?' : ''} WHERE id=?`)
      .bind(participantId, matchStatus, now, ...(created ? [now] : []), id),
    event(db, { requestId: id, action: 'ACCEPTED', from: row.status, to: 'ACCEPTED', actor: context.userId, sectionId: row.section_id, category: created ? 'NEW' : 'LINKED' }, now),
    audit(db, context, requestId, 'ADMISSION_ACCEPTED', id, now, created ? 'NEW_PARTICIPANT' : 'LINKED_PARTICIPANT'));
  // One batch: an ACCEPTED request never points to a half-created participant graph.
  await commit(db, statements);
  return { id, status: 'ACCEPTED', participantId, created };
}
