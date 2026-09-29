import { authorize } from '../policy.js';
import { append } from '../domains/audit/repository.js';
import { permissionDefinition } from '../permissions.js';
import { RECENT_AUTHENTICATION_MS } from '../environment-policy.js';
export class AppError extends Error {
  constructor(status,code) { super(code); this.status=status; this.code=code; }
}
export const validUuid = value => typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function requireUuid(value) { if (!validUuid(value)) throw new AppError(404,'not_found'); return value; }
// `conceal: true` (single-resource reads, audit L1): a holder of the permission asking for a resource
// outside their scope gets 404, so UUIDs outside scope cannot be confirmed. The denial is still audited.
/**
 * @param {any} db @param {any} context @param {string} requestId @param {string} permission
 * @param {{sectionId?: string|null, participantId?: string|null, purpose?: string|null, mode?: 'list'|'all-sections'|null,
 *   resourceType?: string, resourceId?: string|null, conceal?: boolean}} [details]
 */
export async function requirePermission(db,context,requestId,permission,details={}) {
  const {conceal=false,...request}=details;
  const decision=await authorize(db,context,{permission,...request});
  if (!decision.allow) {
    await append(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,action:'AUTHZ_DENY',
      resourceType:request.resourceType??(request.participantId?'participant':'app_user'),resourceId:request.resourceId??request.participantId??null,
      result:'DENY',reasonCode:decision.reason});
    if (conceal && decision.reason==='OUT_OF_SCOPE') throw new AppError(404,'not_found');
    throw new AppError(403,'forbidden');
  }
  return decision;
}
// Group-wide authority: GLOBAL permissions evaluate as themselves, SCOPED ones need 'all-sections'.
export async function requireGroupWide(db,context,requestId,permission,details={}) {
  const mode=permissionDefinition(permission)?.kind==='SCOPED'?'all-sections':null;
  return requirePermission(db,context,requestId,permission,{...details,mode});
}
// Recent-authentication hook for high-impact administration (see environment-policy.js).
export function requireFresh(session, now=Date.now()) {
  if (now-session.created_at>RECENT_AUTHENTICATION_MS) throw new AppError(403,'fresh_session_required');
}
