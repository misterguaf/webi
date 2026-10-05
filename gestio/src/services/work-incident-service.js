// FASE 3.5H.3 — Incidències i millores (docs/decisions/ADMIN_DECISIONS.md, H.3). A small internal work item:
// any Gestió user reports and follows their own reports; managing every report needs admin.incidents.manage
// (explicit capability, GLOBAL). No priority, no attachments, no comments, no notifications. SYSTEM incidents
// are opened only by services for deterministic blockers, keyed so they are never duplicated, and reference
// their resource instead of copying it.
import { authorize } from '../policy.js';
import { append, conditionalStatement, statement } from '../domains/audit/repository.js';
import { versionCas } from '../concurrency.js';
import { AppError, requirePermission, requireUuid } from './common.js';
import { capabilities } from './capability-service.js';
import { DEPLOYMENT_ENVIRONMENTS } from '../environment-policy.js';

export const TYPES = Object.freeze(['ERROR', 'IMPROVEMENT', 'ACCESS', 'DATA', 'OTHER']);
export const STATUSES = Object.freeze(['OPEN', 'IN_PROGRESS', 'RESOLVED']);
export const MODULES = Object.freeze(['inici', 'activitat', 'activitats', 'inscripcions', 'quotes', 'tresoreria', 'participants', 'incidencies', 'administracio', 'altres']);
const CREATE_KEYS = new Set(['type', 'title', 'description', 'module']);
const clean = value => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim() : '';
const audit = (db, context, requestId, action, id, now, reasonCode = null) => statement(db, { requestId, actorUserId: context?.userId ?? null,
  sessionId: context?.sessionId ?? null, action, resourceType: 'work_incident', resourceId: id, reasonCode, occurredAt: now });
async function commit(db, statements) {
  try { return await db.batch(statements); }
  catch (error) { if (/NOT NULL constraint failed: work_incident\.version/.test(String(error?.message))) throw new AppError(409, 'stale_incident'); throw error; }
}
// The environment comes from the server context (worker.js → deploymentEnvironment); a missing one fails closed.
const environmentOf = value => { if (!DEPLOYMENT_ENVIRONMENTS.includes(value)) throw new Error('DEPLOYMENT_ENVIRONMENT missing'); return value; };
const canManage = async (db, context) => (await authorize(db, context, { permission: 'admin.incidents.manage' })).allow;

// ---------------------------------------------------------------- manual reports (any Gestió user)
export async function reportIncident(db, context, requestId, input, now = Date.now()) {
  if (!input || Object.keys(input).some(key => !CREATE_KEYS.has(key))) throw new AppError(400, 'invalid_incident');
  const title = clean(input.title), description = clean(input.description), module = input.module ?? null;
  if (!TYPES.includes(input.type) || title.length < 3 || title.length > 120 || description.length > 2000 || (module !== null && !MODULES.includes(module)))
    throw new AppError(400, 'invalid_incident');
  const id = crypto.randomUUID(), environment = environmentOf(context.environment);
  await db.batch([
    db.prepare(`INSERT INTO work_incident(id,type,origin,title,description,module,reporter_user_id,environment,created_at,updated_at)
      VALUES(?,?,'MANUAL',?,?,?,?,?,?,?)`).bind(id, input.type, title, description || null, module, context.userId, environment, now, now),
    audit(db, context, requestId, 'WORK_INCIDENT_REPORTED', id, now, input.type)]);
  return { id, status: 'OPEN', environment };
}

const view = (row, manager) => ({
  id: row.id, type: row.type, origin: row.origin, status: row.status, title: row.title, module: row.module, environment: row.environment,
  createdAt: row.created_at, startedAt: row.started_at, resolvedAt: row.resolved_at, resolution: row.resolution, version: row.version,
  mine: !!row.mine, reporter: manager ? row.reporter_name ?? null : null,
  // A manager sees the description; a reporter sees their own words back.
  description: manager || row.mine ? row.description : null
});
const SELECT = `SELECT w.*,u.display_name AS reporter_name,(w.reporter_user_id=?) AS mine FROM work_incident w
  LEFT JOIN app_user u ON u.id=w.reporter_user_id`;

/** GET /api/work-incidents?vista=meues|totes — own reports for anyone; every report only for managers. */
export async function listIncidents(db, context, requestId, params) {
  const scope = params.get('vista') || 'meues', status = params.get('status'), type = params.get('type'), module = params.get('module');
  const environment = params.get('environment');
  if (!['meues', 'totes'].includes(scope) || (status && !STATUSES.includes(status)) || (type && !TYPES.includes(type)) || (module && !MODULES.includes(module))
    || (environment && !DEPLOYMENT_ENVIRONMENTS.includes(environment))) throw new AppError(400, 'invalid_filter');
  if (scope === 'totes') await requirePermission(db, context, requestId, 'admin.incidents.manage', { resourceType: 'work_incident' });
  const filters = [], binds = [context.userId];
  if (scope === 'meues') { filters.push('w.reporter_user_id=?'); binds.push(context.userId); }
  if (status) { filters.push('w.status=?'); binds.push(status); }
  if (type) { filters.push('w.type=?'); binds.push(type); }
  if (module) { filters.push('w.module=?'); binds.push(module); }
  if (environment) { filters.push('w.environment=?'); binds.push(environment); }
  const rows = (await db.prepare(`${SELECT}${filters.length ? ` WHERE ${filters.join(' AND ')}` : ''}
    ORDER BY CASE w.status WHEN 'OPEN' THEN 0 WHEN 'IN_PROGRESS' THEN 1 ELSE 2 END,w.created_at DESC LIMIT 300`).bind(...binds).all()).results;
  const manager = scope === 'totes';
  return { incidents: rows.map(row => {
    const item = view(row, manager);
    // Lists never carry descriptions; the detail does.
    return { ...item, description: undefined };
  }) };
}

/** Badge: OPEN reports, for managers only (others get null, without an AUTHZ_DENY). */
export async function incidentSummary(db, context) {
  if (!await canManage(db, context)) return { open: null };
  return { open: (await db.prepare("SELECT count(*) AS n FROM work_incident WHERE status='OPEN'").first()).n };
}

async function load(db, context, requestId, id) {
  requireUuid(id);
  const row = await db.prepare(`${SELECT} WHERE w.id=?`).bind(context.userId, id).first();
  const manager = await canManage(db, context);
  // Somebody else's report is indistinguishable from a missing one (no enumeration).
  if (!row || (!manager && !row.mine)) {
    await append(db, { requestId, actorUserId: context.userId, sessionId: context.sessionId, action: 'AUTHZ_DENY', result: 'DENY',
      resourceType: 'work_incident', resourceId: id, reasonCode: row ? 'NOT_REPORTER' : 'NOT_FOUND' });
    throw new AppError(404, 'not_found');
  }
  return { row, manager };
}

export async function incidentDetail(db, context, requestId, id) {
  const { row, manager } = await load(db, context, requestId, id);
  // The referenced resource is linked only if the viewer could already open it.
  let resource = null;
  if (manager && row.resource_type === 'admission_request') {
    const request = await db.prepare('SELECT COALESCE(section_id,requested_section_id) AS section_id FROM admission_request WHERE id=?').bind(row.resource_id).first();
    const scope = (await capabilities(db, context)).admissions.read;
    const visible = !!request && !!scope && (scope.all || scope.sections.some(section => section.id === request.section_id));
    resource = { type: 'admission_request', label: 'Sol·licitud d’alta', link: visible ? { page: 'participants', path: ['altes', row.resource_id] } : null };
  }
  return { incident: { ...view(row, manager), resource }, actions: { manage: manager } };
}

// ---------------------------------------------------------------- management (admin.incidents.manage)
const STEPS = {
  start: { from: ['OPEN'], to: 'IN_PROGRESS', audit: 'WORK_INCIDENT_STARTED' },
  resolve: { from: ['OPEN', 'IN_PROGRESS'], to: 'RESOLVED', audit: 'WORK_INCIDENT_RESOLVED' },
  reopen: { from: ['RESOLVED'], to: 'OPEN', audit: 'WORK_INCIDENT_REOPENED' }
};
export async function moveIncident(db, context, requestId, id, step, input, now = Date.now()) {
  const move = STEPS[step];
  if (!move) throw new AppError(404, 'not_found');
  requireUuid(id);
  await requirePermission(db, context, requestId, 'admin.incidents.manage', { resourceType: 'work_incident', resourceId: id });
  if (!input || Object.keys(input).some(key => !['expectedVersion', 'resolution'].includes(key))) throw new AppError(400, 'invalid_request');
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) throw new AppError(400, 'invalid_request');
  const resolution = clean(input.resolution);
  if (step !== 'resolve' && input.resolution !== undefined) throw new AppError(400, 'invalid_request');
  if (resolution.length > 280) throw new AppError(400, 'invalid_resolution');
  const row = await db.prepare('SELECT status FROM work_incident WHERE id=?').bind(id).first();
  if (!row) throw new AppError(404, 'not_found');
  if (!move.from.includes(row.status)) throw new AppError(409, 'invalid_transition');
  const set = step === 'start' ? 'status=?,started_at=?,updated_at=?' : step === 'resolve' ? 'status=?,resolved_at=?,resolved_by=?,resolution=?,updated_at=?'
    : 'status=?,resolved_at=NULL,resolved_by=NULL,resolution=NULL,updated_at=?';
  const values = step === 'start' ? [move.to, now, now] : step === 'resolve' ? [move.to, now, context.userId, resolution || null, now] : [move.to, now];
  await commit(db, [
    db.prepare(`UPDATE work_incident SET ${versionCas('version')},${set} WHERE id=?`).bind(input.expectedVersion, ...values, id),
    audit(db, context, requestId, move.audit, id, now)]);
  return { id, status: move.to, version: input.expectedVersion + 1 };
}

// ---------------------------------------------------------------- SYSTEM incidents (services only)
/**
 * Statements that open the SYSTEM incident for a deterministic blocker exactly once (`key` is unique): calling
 * it again for the same blocker writes nothing. Only a title and a resource reference are stored.
 */
export function openSystemIncidentStatements(db, { key, type, title, module, resourceType, resourceId, requestId, environment }, now = Date.now()) {
  const id = crypto.randomUUID();
  return [
    db.prepare(`INSERT INTO work_incident(id,type,origin,title,module,system_key,resource_type,resource_id,environment,created_at,updated_at)
      VALUES(?,?,'SYSTEM',?,?,?,?,?,?,?,?) ON CONFLICT(system_key) DO NOTHING`)
      .bind(id, type, title, module, key, resourceType, resourceId, environmentOf(environment), now, now),
    conditionalStatement(db, { requestId, action: 'WORK_INCIDENT_SYSTEM_OPENED', resourceType: 'work_incident', resourceId: id, occurredAt: now },
      'SELECT 1 FROM work_incident WHERE id=?', [id])];
}
/** Statements that resolve the SYSTEM incident of a blocker once it no longer exists (no-op if none is open). */
export async function resolveSystemIncidentStatements(db, context, { key, resolution, requestId }, now = Date.now()) {
  const open = await db.prepare("SELECT id FROM work_incident WHERE system_key=? AND status!='RESOLVED'").bind(key).first();
  if (!open) return [];
  return [
    db.prepare(`UPDATE work_incident SET version=version+1,status='RESOLVED',resolved_at=?,resolved_by=?,resolution=?,updated_at=?
      WHERE id=? AND status!='RESOLVED'`).bind(now, context?.userId ?? null, resolution, now, open.id),
    audit(db, context, requestId, 'WORK_INCIDENT_RESOLVED', open.id, now, 'BLOCKER_CLEARED')];
}
