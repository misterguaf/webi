// FASE 3.5H.3 — Activitat (docs/decisions/ADMIN_DECISIONS.md, H.3). A safe, human-readable PROJECTION of the
// existing audit (audit_event); it is not a second audit truth and stores nothing. Rules:
//   - only the whitelisted, meaningful actions below (anything else — logins, AUTHZ decisions, list loads,
//     notifications, automatic intakes, retention — is omitted);
//   - the actor is always named (internal accountability);
//   - the subject (participant, request, activity) is named only if the viewer could identify it through their
//     own ordinary permissions, otherwise a generic noun is used;
//   - never content: no metadata, amounts, contact values, health, evidence, bank descriptions or free text;
//   - a link is returned only when the viewer can already open that resource (the server decides, not the UI).
import { queryForActivity } from '../domains/audit/repository.js';
import { capabilities } from './capability-service.js';
import { AppError, validUuid } from './common.js';
import { matchKey } from './registration-service.js';

export const CATEGORIES = Object.freeze(['participants', 'activities', 'treasury', 'health', 'administration']);
export const KINDS = Object.freeze(['create', 'change', 'decide', 'read', 'access']);

// action → [category, kind, subject kind, verb phrase]. In the phrase, `{s}` is the subject noun phrase.
// Subject kinds: participant, admission, activity, registration, user, incident, none.
const A = (category, kind, subject, phrase) => Object.freeze({ category, kind, subject, phrase });
const CATALOGUE = Object.freeze({
  // Participants (DATA_* events are mapped by resource type below).
  SENSITIVE_DATA_READ: null,
  ADMISSION_RECEIVED: A('participants', 'create', 'admission', 'ha enviat la sol·licitud d’alta {s}'),
  ADMISSION_REVIEW_STARTED: A('participants', 'change', 'admission', 'ha començat la revisió de la sol·licitud d’alta {s}'),
  ADMISSION_WAITLISTED: A('participants', 'decide', 'admission', 'ha passat a la llista d’espera la sol·licitud d’alta {s}'),
  ADMISSION_RETURNED_TO_REVIEW: A('participants', 'change', 'admission', 'ha tornat a revisió la sol·licitud d’alta {s}'),
  ADMISSION_SECTION_CONFIRMED: A('participants', 'change', 'admission', 'ha confirmat la secció de la sol·licitud d’alta {s}'),
  ADMISSION_MATCH_RESOLVED: A('participants', 'decide', 'admission', 'ha resolt una coincidència de la sol·licitud d’alta {s}'),
  ADMISSION_ACCEPTED: A('participants', 'decide', 'admission', 'ha acceptat la sol·licitud d’alta {s}'),
  ADMISSION_REJECTED: A('participants', 'decide', 'admission', 'ha rebutjat la sol·licitud d’alta {s}'),
  ADMISSION_WITHDRAWN: A('participants', 'decide', 'admission', 'ha marcat com a retirada la sol·licitud d’alta {s}'),
  // Activitats i inscripcions.
  ACTIVITY_CREATED: A('activities', 'create', 'activity', 'ha creat {s}'),
  ACTIVITY_UPDATED: A('activities', 'change', 'activity', 'ha modificat {s}'),
  ACTIVITY_PUBLISHED: A('activities', 'decide', 'activity', 'ha publicat {s}'),
  ACTIVITY_CLOSED: A('activities', 'decide', 'activity', 'ha tancat {s}'),
  ACTIVITY_DISCARDED: A('activities', 'decide', 'activity', 'ha descartat {s}'),
  ACTIVITY_PRICE_CORRECTED: A('activities', 'change', 'activity', 'ha corregit el preu {s:de}'),
  REGISTRATION_CONFIRMED: A('activities', 'decide', 'registration', 'ha confirmat {s}'),
  REGISTRATION_REJECTED: A('activities', 'decide', 'registration', 'ha rebutjat {s}'),
  REGISTRATION_WITHDRAWN: A('activities', 'decide', 'registration', 'ha retirat {s}'),
  REGISTRATION_MATCH_RESOLVED: A('activities', 'decide', 'registration', 'ha revisat la persona {s:de}'),
  REGISTRATION_SECTION_CORRECTED: A('activities', 'change', 'registration', 'ha corregit la secció {s:de}'),
  REGISTRATION_ESCALATED: A('activities', 'change', 'registration', 'ha enviat a revisió global {s}'),
  // Tresoreria i quotes (never amounts, descriptions or evidence contents).
  PAYMENT_VERIFIED: A('treasury', 'decide', 'none', 'ha verificat un pagament d’activitat'),
  PAYMENT_ISSUE: A('treasury', 'decide', 'none', 'ha marcat una incidència en un pagament d’activitat'),
  PAYMENT_EVIDENCE_VIEWED: A('treasury', 'read', 'none', 'ha consultat un justificant de pagament'),
  PAYMENT_EVIDENCE_DOWNLOADED: A('treasury', 'read', 'none', 'ha descarregat un justificant de pagament'),
  FEE_ROUND_CREATED: A('treasury', 'create', 'none', 'ha creat una ronda de quotes'),
  FEE_ROUND_UPDATED: A('treasury', 'change', 'none', 'ha modificat una ronda de quotes'),
  FEE_BASE_CHANGED: A('treasury', 'change', 'none', 'ha canviat l’import base de les quotes'),
  FEE_DEADLINE_CHANGED: A('treasury', 'change', 'none', 'ha canviat el termini de les quotes'),
  FEE_FAMILY_GROUP_CREATED: A('treasury', 'create', 'none', 'ha creat una unitat familiar de quotes'),
  FEE_FAMILY_CORRECTED: A('treasury', 'change', 'none', 'ha corregit una unitat familiar de quotes'),
  FEE_DISCOUNT_APPLIED: A('treasury', 'change', 'none', 'ha aplicat un descompte de quota'),
  FEE_OBLIGATION_CREATED: A('treasury', 'create', 'none', 'ha creat una quota'),
  FEE_AMOUNT_OVERRIDDEN: A('treasury', 'change', 'none', 'ha corregit l’import d’una quota'),
  FEE_MATCH_REVIEWED: A('treasury', 'decide', 'none', 'ha revisat la persona d’un pagament de quota'),
  FEE_PAYMENT_VERIFIED: A('treasury', 'decide', 'none', 'ha verificat un pagament de quota'),
  FEE_ALLOCATION_REVISED: A('treasury', 'change', 'none', 'ha corregit l’assignació d’un pagament de quota'),
  FEE_ISSUE_OPENED: A('treasury', 'change', 'none', 'ha obert una incidència de quota'),
  FEE_ISSUE_RESOLVED: A('treasury', 'decide', 'none', 'ha resolt una incidència de quota'),
  FEE_INSTALLMENT_AUTHORIZED: A('treasury', 'decide', 'none', 'ha autoritzat terminis d’una quota'),
  FEE_EVIDENCE_VIEWED: A('treasury', 'read', 'none', 'ha consultat un justificant de quota'),
  FEE_EVIDENCE_DOWNLOADED: A('treasury', 'read', 'none', 'ha descarregat un justificant de quota'),
  TREASURY_ROUND_CREATED: A('treasury', 'create', 'none', 'ha creat una ronda econòmica'),
  TREASURY_ROUND_UPDATED: A('treasury', 'change', 'none', 'ha modificat una ronda econòmica'),
  TREASURY_ROUND_OPENED: A('treasury', 'decide', 'none', 'ha obert una ronda econòmica'),
  TREASURY_ROUND_CLOSING_STARTED: A('treasury', 'decide', 'none', 'ha començat el tancament d’una ronda econòmica'),
  TREASURY_ROUND_CLOSING_CANCELLED: A('treasury', 'decide', 'none', 'ha cancel·lat el tancament d’una ronda econòmica'),
  TREASURY_ROUND_CLOSED: A('treasury', 'decide', 'none', 'ha tancat una ronda econòmica'),
  RESERVE_CONTRIBUTION_RECORDED: A('treasury', 'change', 'none', 'ha registrat una aportació a reserves'),
  RESERVE_APPLICATION_RECORDED: A('treasury', 'change', 'none', 'ha registrat un ús de reserves'),
  FINANCIAL_POSITION_CREATED: A('treasury', 'create', 'none', 'ha creat un compte'),
  FINANCIAL_POSITION_UPDATED: A('treasury', 'change', 'none', 'ha modificat un compte'),
  OPENING_BALANCE_RECORDED: A('treasury', 'change', 'none', 'ha registrat un saldo inicial'),
  RESERVES_RECORDED: A('treasury', 'change', 'none', 'ha registrat les reserves inicials'),
  BANK_IMPORT_CREATED: A('treasury', 'create', 'none', 'ha importat un extracte bancari'),
  MOVEMENT_CREATED_MANUAL: A('treasury', 'create', 'none', 'ha registrat un moviment manual'),
  MOVEMENT_VOIDED_DUPLICATE: A('treasury', 'change', 'none', 'ha anul·lat un moviment duplicat'),
  MOVEMENT_CLASSIFIED: A('treasury', 'change', 'none', 'ha classificat un moviment'),
  MOVEMENT_RECLASSIFIED: A('treasury', 'change', 'none', 'ha reclassificat un moviment'),
  FINANCE_ALLOCATION_CORRECTED: A('treasury', 'change', 'none', 'ha corregit l’assignació d’un moviment'),
  BANK_DESCRIPTION_REVEALED: A('treasury', 'read', 'none', 'ha consultat la descripció bancària original d’un moviment'),
  FEE_RECEIPT_RECONCILED: A('treasury', 'decide', 'none', 'ha conciliat un pagament de quota'),
  ACTIVITY_RECEIPT_RECONCILED: A('treasury', 'decide', 'none', 'ha conciliat un pagament d’activitat'),
  FAMILY_OVERPAYMENT_CREATED: A('treasury', 'create', 'none', 'ha registrat un excés de pagament d’una família'),
  FAMILY_OVERPAYMENT_RECONCILED: A('treasury', 'decide', 'none', 'ha conciliat un excés de pagament'),
  FAMILY_REFUND_DUE: A('treasury', 'create', 'none', 'ha registrat una devolució pendent'),
  FAMILY_REFUND_DECIDED: A('treasury', 'decide', 'none', 'ha decidit una devolució a una família'),
  FAMILY_REFUND_RECONCILED: A('treasury', 'decide', 'none', 'ha conciliat una devolució'),
  ACTIVITY_INSTALLMENT_PLAN_AUTHORIZED: A('treasury', 'decide', 'none', 'ha autoritzat terminis d’una activitat'),
  ACTIVITY_INSTALLMENT_PLAN_CORRECTED: A('treasury', 'change', 'none', 'ha corregit terminis d’una activitat'),
  COUNTERPARTY_CREATED: A('treasury', 'create', 'none', 'ha creat una contrapart'),
  COUNTERPARTY_REVISED: A('treasury', 'change', 'none', 'ha modificat una contrapart'),
  EXPENSE_PROPOSED: A('treasury', 'create', 'none', 'ha proposat una despesa'),
  EXPENSE_RECOGNISED: A('treasury', 'decide', 'none', 'ha reconegut una despesa'),
  EXPENSE_REVISED: A('treasury', 'change', 'none', 'ha revisat una despesa'),
  EXPENSE_REJECTED: A('treasury', 'decide', 'none', 'ha rebutjat una despesa'),
  EXPENSE_VOIDED: A('treasury', 'decide', 'none', 'ha anul·lat una despesa'),
  EXPENSE_CORRECTED: A('treasury', 'change', 'none', 'ha corregit una despesa'),
  EXPENSE_CANCELLED: A('treasury', 'decide', 'none', 'ha cancel·lat una despesa'),
  EXPENSE_EVIDENCE_VIEWED: A('treasury', 'read', 'none', 'ha consultat un justificant de despesa'),
  EXPENSE_EVIDENCE_DOWNLOADED: A('treasury', 'read', 'none', 'ha descarregat un justificant de despesa'),
  REIMBURSEMENT_CREATED: A('treasury', 'create', 'none', 'ha registrat un reemborsament'),
  REIMBURSEMENT_APPROVED: A('treasury', 'decide', 'none', 'ha aprovat un reemborsament'),
  REIMBURSEMENT_SELF_APPROVED: A('treasury', 'decide', 'none', 'ha aprovat un reemborsament propi'),
  REIMBURSEMENT_SETTLED: A('treasury', 'decide', 'none', 'ha liquidat un reemborsament'),
  REIMBURSEMENT_CORRECTED: A('treasury', 'change', 'none', 'ha corregit un reemborsament'),
  REIMBURSEMENT_CANCELLED: A('treasury', 'decide', 'none', 'ha cancel·lat un reemborsament'),
  INCOME_CREATED: A('treasury', 'create', 'none', 'ha registrat un ingrés'),
  INCOME_REVISED: A('treasury', 'change', 'none', 'ha revisat un ingrés'),
  INCOME_RECONCILED: A('treasury', 'decide', 'none', 'ha conciliat un ingrés'),
  INCOME_VOIDED: A('treasury', 'decide', 'none', 'ha anul·lat un ingrés'),
  BUDGET_CREATED: A('treasury', 'create', 'none', 'ha creat un pressupost'),
  BUDGET_PROPOSED: A('treasury', 'decide', 'none', 'ha proposat el pressupost'),
  BUDGET_RETURNED_TO_DRAFT: A('treasury', 'decide', 'none', 'ha tornat el pressupost a esborrany'),
  BUDGET_APPROVED: A('treasury', 'decide', 'none', 'ha aprovat el pressupost'),
  BUDGET_LINE_CREATED: A('treasury', 'change', 'none', 'ha afegit una partida al pressupost'),
  BUDGET_LINE_REVISED: A('treasury', 'change', 'none', 'ha modificat una partida del pressupost'),
  BUDGET_LINE_DEACTIVATED: A('treasury', 'change', 'none', 'ha desactivat una partida del pressupost'),
  BUDGET_REVISION_PROPOSED: A('treasury', 'create', 'none', 'ha proposat una revisió del pressupost'),
  BUDGET_REVISION_APPROVED: A('treasury', 'decide', 'none', 'ha aprovat una revisió del pressupost'),
  BUDGET_REVISION_REJECTED: A('treasury', 'decide', 'none', 'ha rebutjat una revisió del pressupost'),
  EXPORT_REQUESTED: A('treasury', 'read', 'none', 'ha exportat dades econòmiques'),
  // Salut (Phase 5): only that access changed, never to whom or what.
  HEALTH_ACCESS_GRANTED: A('health', 'access', 'none', 'ha concedit un accés a dades de salut'),
  HEALTH_ACCESS_REVOKED: A('health', 'access', 'none', 'ha retirat un accés a dades de salut'),
  BREAK_GLASS_GRANTED: A('health', 'access', 'none', 'ha concedit un accés d’emergència'),
  BREAK_GLASS_USED: A('health', 'read', 'none', 'ha usat un accés d’emergència'),
  BREAK_GLASS_REVOKED: A('health', 'access', 'none', 'ha retirat un accés d’emergència'),
  // Administració.
  USER_CREATED: A('administration', 'create', 'user', 'ha creat el compte {s:de}'),
  USER_DISABLED: A('administration', 'access', 'user', 'ha desactivat el compte {s:de}'),
  USER_ENABLED: A('administration', 'access', 'user', 'ha reactivat el compte {s:de}'),
  USER_SECURITY_SUSPENDED: A('administration', 'access', 'user', 'ha suspès per seguretat el compte {s:de}'),
  ROLE_ASSIGNED: A('administration', 'access', 'user', 'ha assignat un rol {s:a}'),
  ROLE_REMOVED: A('administration', 'access', 'user', 'ha retirat un rol {s:a}'),
  PERMISSION_GRANTED: A('administration', 'access', 'user', 'ha concedit un permís {s:a}'),
  PERMISSION_REVOKED: A('administration', 'access', 'user', 'ha retirat un permís {s:a}'),
  ROLE_RATIFIED: A('administration', 'access', 'user', 'ha ratificat un rol {s:de}'),
  PERMISSION_RATIFIED: A('administration', 'access', 'user', 'ha ratificat un permís {s:de}'),
  DELEGATED_PERMISSION_GRANTED: A('administration', 'access', 'user', 'ha delegat un permís {s:a}'),
  DELEGATED_PERMISSION_RATIFIED: A('administration', 'access', 'user', 'ha ratificat una delegació {s:a}'),
  DELEGATED_PERMISSION_REVOKED: A('administration', 'access', 'user', 'ha revocat una delegació {s:a}'),
  DELEGATION_AUTHORIZATION_CONFIRMED: A('administration', 'access', 'user', 'ha confirmat l’autorització d’una delegació {s:a}'),
  IDENTITY_INVITED: A('administration', 'access', 'user', 'ha convidat {s} a accedir a Gestió'),
  IDENTITY_INVITATION_REVOKED: A('administration', 'access', 'user', 'ha retirat la invitació {s:de}'),
  IDENTITY_REVOKED: A('administration', 'access', 'user', 'ha retirat un accés d’inici de sessió {s:de}'),
  AUTH_SESSION_REVOKED: A('administration', 'access', 'user', 'ha tancat una sessió {s:de}'),
  AUTH_ALL_SESSIONS_REVOKED: A('administration', 'access', 'user', 'ha tancat totes les sessions {s:de}'),
  AUDIT_LOG_READ: A('administration', 'read', 'none', 'ha consultat el registre d’auditoria'),
  INCIDENT_OPENED: A('administration', 'create', 'none', 'ha obert un incident de seguretat'),
  WORK_INCIDENT_REPORTED: A('administration', 'create', 'incident', 'ha reportat {s}'),
  WORK_INCIDENT_SYSTEM_OPENED: A('administration', 'create', 'incident', 'ha obert {s}'),
  WORK_INCIDENT_STARTED: A('administration', 'change', 'incident', 'ha començat a treballar en {s}'),
  WORK_INCIDENT_RESOLVED: A('administration', 'decide', 'incident', 'ha resolt {s}'),
  WORK_INCIDENT_REOPENED: A('administration', 'change', 'incident', 'ha reobert {s}')
});
// DATA_* and SENSITIVE_DATA_READ are generic audit actions: their meaning comes from the resource type.
const BY_RESOURCE = Object.freeze({
  DATA_CREATED: { participant: A('participants', 'create', 'participant', 'ha creat la fitxa {s:de}'),
    participant_guardian: A('participants', 'change', 'participant', 'ha afegit un tutor {s:a}'),
    contact_point: A('participants', 'change', 'participant', 'ha afegit un contacte {s:a}') },
  DATA_UPDATED: { participant: A('participants', 'change', 'participant', 'ha modificat la fitxa {s:de}'),
    participant_guardian: A('participants', 'change', 'participant', 'ha modificat la relació de tutoria {s:de}'),
    contact_point: A('participants', 'change', 'participant', 'ha modificat un contacte {s:de}'),
    participant_review: A('participants', 'decide', 'participant', 'ha gestionat una revisió administrativa {s:de}') },
  DATA_DELETED: { participant_guardian: A('participants', 'change', 'participant', 'ha tancat una relació de tutoria {s:de}'),
    contact_point: A('participants', 'change', 'participant', 'ha retirat un contacte {s:de}') },
  SENSITIVE_DATA_READ: { contact_point: A('participants', 'read', 'participant', 'ha consultat les dades de contacte {s:de}'),
    activity_registration: A('activities', 'read', 'registration', 'ha consultat el contacte {s:de}'),
    annual_fee_payment: A('treasury', 'read', 'none', 'ha consultat el contacte d’un pagament de quota') }
});
const ACTIONS = Object.freeze([...Object.keys(CATALOGUE).filter(action => CATALOGUE[action]), ...Object.keys(BY_RESOURCE)]);
const entryOf = row => CATALOGUE[row.action] ?? BY_RESOURCE[row.action]?.[row.resource_type] ?? null;
const actionsWhere = predicate => [...new Set([
  ...Object.entries(CATALOGUE).filter(([, entry]) => entry && predicate(entry)).map(([action]) => action),
  ...Object.entries(BY_RESOURCE).filter(([, byType]) => Object.values(byType).some(predicate)).map(([action]) => action)])];

// Generic nouns when the viewer may not identify the subject (and the article each verb phrase needs).
const GENERIC = { participant: 'un educand', admission: 'd’una persona', activity: 'una activitat', registration: 'una inscripció',
  user: 'una persona usuària', incident: 'una incidència' };
const join = (prep, noun) => {
  if (!prep) return noun;
  if (noun.startsWith('el ')) return `${prep === 'de' ? 'del' : 'al'} ${noun.slice(3)}`;
  if (prep === 'a' || noun.startsWith('l’') || noun.startsWith('la ')) return `${prep} ${noun}`;
  return /^[aeiouàèéíòóúh]/i.test(noun) ? `d’${noun}` : `de ${noun}`;
};
const phraseWith = (phrase, noun) => phrase.replace(/\{s(?::(de|a))?\}/, (_, prep) => join(prep, noun));

const covers = (scope, sectionId) => !!scope && (scope.all || (!!sectionId && scope.sections.some(section => section.id === sectionId)));
const placeholders = values => values.map(() => '?').join(',');
async function rowsFor(db, sql, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 90) out.push(...(await db.prepare(sql.replace('$IDS', placeholders(ids.slice(i, i + 90)))).bind(...ids.slice(i, i + 90)).all()).results);
  return out;
}

/** Resolve subjects for a page of rows, honouring the viewer's ordinary permissions. */
async function subjects(db, context, caps, rows) {
  const ids = type => [...new Set(rows.filter(row => row.resource_type === type && validUuid(row.resource_id)).map(row => row.resource_id))];
  const byId = list => new Map(list.map(item => [item.key, item]));
  // participant id for every participant-related resource.
  const participantOf = new Map();
  for (const id of ids('participant')) participantOf.set(id, id);
  for (const row of await rowsFor(db, 'SELECT id AS key,participant_id FROM participant_guardian WHERE id IN ($IDS)', ids('participant_guardian'))) participantOf.set(row.key, row.participant_id);
  for (const row of await rowsFor(db, 'SELECT id AS key,participant_id FROM participant_review WHERE id IN ($IDS)', ids('participant_review'))) if (row.participant_id) participantOf.set(row.key, row.participant_id);
  for (const row of await rowsFor(db, `SELECT cp.id AS key,COALESCE(cp.participant_id,(SELECT pg.participant_id FROM participant_guardian pg WHERE pg.guardian_id=cp.guardian_id
      ORDER BY pg.ended_at IS NOT NULL,pg.started_at LIMIT 1)) AS participant_id FROM contact_point cp WHERE cp.id IN ($IDS)`, ids('contact_point')))
    if (row.participant_id) participantOf.set(row.key, row.participant_id);
  const people = byId(await rowsFor(db, 'SELECT id AS key,display_name,current_section_id FROM participant WHERE id IN ($IDS)', [...new Set(participantOf.values())]));
  const admissions = byId(await rowsFor(db, `SELECT id AS key,given_name,family_names,COALESCE(section_id,requested_section_id) AS section_id
    FROM admission_request WHERE id IN ($IDS)`, ids('admission_request')));
  const registrations = byId(await rowsFor(db, 'SELECT id AS key,activity_id FROM activity_registration WHERE id IN ($IDS)', ids('activity_registration')));
  const activityIds = [...new Set([...ids('activity'), ...[...registrations.values()].map(row => row.activity_id)])];
  const activities = byId(await rowsFor(db, `SELECT a.id AS key,a.name,a.audience,(SELECT group_concat(section_id) FROM activity_section s WHERE s.activity_id=a.id) AS sections
    FROM activity a WHERE a.id IN ($IDS)`, activityIds));
  const userOf = new Map();
  for (const id of ids('app_user')) userOf.set(id, id);
  for (const [type, sql] of [['user_role', 'SELECT id AS key,user_id FROM user_role WHERE id IN ($IDS)'],
    ['user_permission_grant', 'SELECT id AS key,user_id FROM user_permission_grant WHERE id IN ($IDS)'],
    ['delegated_permission', 'SELECT id AS key,user_id FROM delegated_permission WHERE id IN ($IDS)'],
    ['app_session', 'SELECT id AS key,user_id FROM app_session WHERE id IN ($IDS)'],
    ['auth_identity', 'SELECT id AS key,user_id FROM auth_identity WHERE id IN ($IDS)'],
    ['auth_identity_invitation', 'SELECT id AS key,user_id FROM auth_identity_invitation WHERE id IN ($IDS)']])
    for (const row of await rowsFor(db, sql, ids(type))) userOf.set(row.key, row.user_id);
  const users = byId(await rowsFor(db, 'SELECT id AS key,display_name FROM app_user WHERE id IN ($IDS)', [...new Set(userOf.values())]));
  const incidents = byId(await rowsFor(db, 'SELECT id AS key,reporter_user_id FROM work_incident WHERE id IN ($IDS)', ids('work_incident')));

  const activityVisible = activity => !!activity && !!caps.activities.read && (activity.audience === 'GENERAL'
    || (activity.sections ?? '').split(',').some(sectionId => covers(caps.activities.read, sectionId)));
  return (row, kind) => {
    if (kind === 'participant') {
      const person = people.get(participantOf.get(row.resource_id));
      return person && covers(caps.participants.read, person.current_section_id)
        ? { noun: person.display_name, link: { page: 'participants', path: [person.key] } } : { noun: GENERIC.participant, link: null };
    }
    if (kind === 'admission') {
      const request = admissions.get(row.resource_id);
      return request && covers(caps.admissions.read, request.section_id)
        ? { noun: join('de', `${request.given_name} ${request.family_names}`), link: { page: 'participants', path: ['altes', request.key] } } : { noun: GENERIC.admission, link: null };
    }
    if (kind === 'activity' || kind === 'registration') {
      const activity = activities.get(kind === 'activity' ? row.resource_id : registrations.get(row.resource_id)?.activity_id);
      const visible = activityVisible(activity);
      const noun = kind === 'activity' ? (visible ? `l’activitat «${activity.name}»` : GENERIC.activity)
        : (visible ? `una inscripció a «${activity.name}»` : GENERIC.registration);
      return { noun, link: visible ? { page: 'activitats', path: [activity.key] } : null };
    }
    if (kind === 'user') {
      const user = users.get(userOf.get(row.resource_id));
      return { noun: user?.display_name ?? GENERIC.user, userId: user?.key ?? null,
        link: user && caps.administration.manageUsers ? { page: 'administracio', path: ['usuaris', user.key] } : null };
    }
    if (kind === 'incident') {
      const incident = incidents.get(row.resource_id);
      const mine = incident && (caps.incidents.manage || incident.reporter_user_id === context.userId);
      return { noun: GENERIC.incident, link: mine ? { page: 'incidencies', path: [incident.key] } : null };
    }
    return { noun: '', link: null };
  };
}
const MODULE_LINK = { treasury: caps => caps.treasury.read ? { page: 'tresoreria', path: [] } : null };

const dayStart = value => {
  if (value == null || value === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new AppError(400, 'invalid_filter');
  return Date.parse(`${value}T00:00:00Z`);
};
const FILTER_KEYS = new Set(['category', 'kind', 'actor', 'from', 'to', 'q', 'cursor']);

/** GET /api/activity — any authenticated Gestió user; no capability needed, redaction per viewer. */
export async function listActivity(db, context, requestId, params) {
  for (const key of params.keys()) if (!FILTER_KEYS.has(key)) throw new AppError(400, 'invalid_filter');
  const category = params.get('category') || null, kind = params.get('kind') || null, actor = params.get('actor') || null;
  if ((category && !CATEGORIES.includes(category)) || (kind && !KINDS.includes(kind)) || (actor && !validUuid(actor))) throw new AppError(400, 'invalid_filter');
  const from = dayStart(params.get('from')), toDay = dayStart(params.get('to')), to = toDay === null ? null : toDay + 86400000;
  const q = params.get('q') ? matchKey(String(params.get('q')).slice(0, 80)) : '';
  const actions = actionsWhere(entry => (!category || entry.category === category) && (!kind || entry.kind === kind));
  const caps = await capabilities(db, context);
  const names = new Map((await db.prepare('SELECT id,display_name FROM app_user').all()).results.map(user => [user.id, user.display_name]));
  const items = [];
  let cursor = params.get('cursor') || null, scanned = 0, nextCursor = null;
  const LIMIT = 25;
  try {
    // Post-filters (exact entry, own-session noise, text search) may drop rows: scan bounded batches.
    do {
      const batch = await queryForActivity(db, { actions, actorId: actor, from, to, cursor, limit: 50 });
      scanned += batch.rows.length;
      const resolve = await subjects(db, context, caps, batch.rows);
      for (const row of batch.rows) {
        const entry = entryOf(row);
        if (!entry || (category && entry.category !== category) || (kind && entry.kind !== kind)) continue;
        // Managing one's own sessions is routine, not activity.
        if ((row.action === 'AUTH_SESSION_REVOKED' || row.action === 'AUTH_ALL_SESSIONS_REVOKED') && row.actor_user_id
          && resolve(row, 'user').userId === row.actor_user_id) continue;
        const subject = entry.subject === 'none' ? { noun: '', link: MODULE_LINK[entry.category]?.(caps) ?? null } : resolve(row, entry.subject);
        const actorName = row.actor_user_id ? names.get(row.actor_user_id) ?? 'Una persona usuària'
          : row.action === 'ADMISSION_RECEIVED' ? 'El formulari públic' : 'Gestió';
        const text = `${actorName} ${phraseWith(entry.phrase, subject.noun)}.`.replace(/\s+\./, '.');
        if (q && !matchKey(text).includes(q)) continue;
        items.push({ id: row.id, at: row.occurred_at, category: entry.category, kind: entry.kind,
          actor: { id: row.actor_user_id ?? null, name: actorName }, text, link: subject.link });
        if (items.length === LIMIT) break;
      }
      // Resume after the last returned item when the page filled midway through a batch.
      if (items.length === LIMIT) {
        const last = items.at(-1);
        nextCursor = batch.rows.at(-1)?.id === last.id ? batch.nextCursor : encodeCursor(last.at, last.id);
        break;
      }
      nextCursor = batch.nextCursor; cursor = batch.nextCursor;
    } while (cursor && scanned < 500);
  } catch (error) {
    if (String(error?.message).startsWith('INVALID_AUDIT_')) throw new AppError(400, 'invalid_filter');
    throw error;
  }
  return { items, nextCursor };
}
// Same cursor format as the audit repository (occurred_at, id).
const encodeCursor = (time, id) => btoa(JSON.stringify([time, id])).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

/** Actors for the filter: every Gestió user name (actors are visible to every user by decision). */
export async function activityActors(db) {
  return { actors: (await db.prepare('SELECT id,display_name AS name FROM app_user ORDER BY display_name').all()).results };
}
