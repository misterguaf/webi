// Transitional facade: Phase 1 call sites map to the constrained domain repository.
import { append, statement } from './domains/audit/repository.js';
export function eventStatement(db, {requestId,type,actor=null,subject=null,resource=null,reason=null,now=Date.now()}) {
  return statement(db,{requestId,actorUserId:actor,action:type,resourceType:resource==='session'?'app_session':resource,
    resourceId:subject,result:type==='AUTHZ_DENY'?'DENY':type==='AUTHZ_ALLOW'?'ALLOW':'SUCCESS',reasonCode:reason,occurredAt:now});
}
export async function writeEvent(db, detail) { await append(db,{requestId:detail.requestId,actorUserId:detail.actor??null,
  action:detail.type,resourceType:detail.resource==='session'?'app_session':detail.resource??null,
  resourceId:detail.subject??null,result:detail.type==='AUTHZ_DENY'?'DENY':detail.type==='AUTHZ_ALLOW'?'ALLOW':'SUCCESS',reasonCode:detail.reason??null}); }
export async function writeDecision(db, requestId, context, decision, action, resource) {
  await append(db,{requestId,actorUserId:context?.userId??null,sessionId:context?.sessionId??null,
    action:decision.allow?'AUTHZ_ALLOW':'AUTHZ_DENY',resourceType:resource,result:decision.allow?'ALLOW':'DENY',reasonCode:decision.reason});
}
