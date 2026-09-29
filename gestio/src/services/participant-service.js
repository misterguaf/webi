import { pageRequest, pageResult } from '../pagination.js';
import { authorize } from '../policy.js';
import * as participants from '../domains/participants/repository.js';
import { append } from '../domains/audit/repository.js';
import { AppError, requireUuid } from './common.js';

async function decisionEvent(db,context,requestId,allow,reasonCode,resourceId=null) {
  await append(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,
    action:allow?'AUTHZ_ALLOW':'AUTHZ_DENY',result:allow?'ALLOW':'DENY',resourceType:'participant',resourceId,reasonCode});
}
export async function list(db,context,requestId,params) {
  const decision=await authorize(db,context,{permission:'participants.profile.read',mode:'list'});
  if (!decision.allow) {
    await decisionEvent(db,context,requestId,false,decision.reason);
    throw new AppError(403,'forbidden');
  }
  const page=pageRequest(params,['string','string']);
  const rows=await participants.listScoped(db,decision,page);
  await decisionEvent(db,context,requestId,true,'ALLOW'); // no data leaves Worker if audit fails
  const result=pageResult(rows,page.limit,row=>[row.display_name,row.id]);
  return {participants:result.items,nextCursor:result.nextCursor};
}
export async function find(db,context,requestId,id) {
  requireUuid(id);
  const decision=await authorize(db,context,{permission:'participants.profile.read',mode:'list'});
  const row=decision.allow?await participants.findScoped(db,decision,id):null;
  if (!row) {
    await decisionEvent(db,context,requestId,false,'NOT_FOUND_OR_OUT_OF_SCOPE',id);
    throw new AppError(404,'not_found');
  }
  await decisionEvent(db,context,requestId,true,'ALLOW',id);
  return {...row,sectionHistory:await participants.sectionHistory(db,id)};
}
export async function healthPolicyCheck(db,context,requestId,participantId,purpose) {
  requireUuid(participantId);
  if (typeof purpose!=='string' || !/^[a-z-]{1,100}$/.test(purpose)) throw new AppError(400,'invalid_request');
  const decision=await authorize(db,context,{permission:'health.record.read',participantId,purpose});
  await decisionEvent(db,context,requestId,decision.allow,decision.reason,participantId);
  return {allowed:decision.allow,reason:decision.reason};
}
