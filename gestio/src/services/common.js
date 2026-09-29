import { authorize } from '../policy.js';
import { append } from '../domains/audit/repository.js';
import { permissionDefinition } from '../permissions.js';
export class AppError extends Error {
  constructor(status,code) { super(code); this.status=status; this.code=code; }
}
export const validUuid = value => typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function requireUuid(value) { if (!validUuid(value)) throw new AppError(404,'not_found'); return value; }
export async function requirePermission(db,context,requestId,permission,details={}) {
  const decision=await authorize(db,context,{permission,...details});
  if (!decision.allow) {
    await append(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,action:'AUTHZ_DENY',
      resourceType:details.resourceType??(details.participantId?'participant':'app_user'),resourceId:details.resourceId??details.participantId??null,
      result:'DENY',reasonCode:decision.reason});
    throw new AppError(403,'forbidden');
  }
  return decision;
}
// Group-wide authority: GLOBAL permissions evaluate as themselves, SCOPED ones need 'all-sections'.
export async function requireGroupWide(db,context,requestId,permission,details={}) {
  const mode=permissionDefinition(permission)?.kind==='SCOPED'?'all-sections':null;
  return requirePermission(db,context,requestId,permission,{...details,mode});
}
export function requireFresh(session, now=Date.now()) {
  if (now-session.created_at>5*60*1000) throw new AppError(403,'fresh_session_required');
}
