import { ABSOLUTE_MS, prepareNewSession } from '../auth.js';
import * as auth from '../domains/auth/repository.js';
import { statement, append } from '../domains/audit/repository.js';
import { AppError, requireUuid } from './common.js';

export async function loginFailed(db,requestId,reasonCode='INVALID_IDENTITY') {
  await append(db,{requestId,action:'AUTH_LOGIN_FAILED',result:'DENY',reasonCode,resourceType:'app_user'});
}
export async function issueSession(db,user,requestId) {
  const now=Date.now();
  const session=await prepareNewSession(db,user.id,now);
  await db.batch([
    session.statement,
    statement(db,{requestId,actorUserId:user.id,sessionId:session.id,action:'AUTH_LOGIN_SUCCESS',
      resourceType:'app_user',resourceId:user.id,result:'SUCCESS',occurredAt:now}),
    statement(db,{requestId,actorUserId:user.id,sessionId:session.id,action:'AUTH_SESSION_CREATED',
      resourceType:'app_session',resourceId:session.id,result:'SUCCESS',occurredAt:now})
  ]);
  return { user:{id:user.id,displayName:user.display_name,status:user.status},token:session.token,id:session.id,maxAge:Math.floor(ABSOLUTE_MS/1000) };
}
export async function listOwnSessions(db,context,now=Date.now()) {
  return (await auth.ownSessions(db,context.userId,now)).map(session=>({...session,current:session.id===context.sessionId}));
}
export async function logout(db,context,requestId,now=Date.now()) {
  await db.batch([
    auth.revokeSessionStatement(db,context.sessionId,context.userId,now,'LOGOUT'),
    statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,action:'AUTH_LOGOUT',
      resourceType:'app_session',resourceId:context.sessionId,occurredAt:now})
  ]);
}
export async function revokeOne(db,context,requestId,id,now=Date.now()) {
  requireUuid(id);
  if (!await auth.ownedSession(db,id,context.userId)) throw new AppError(404,'not_found');
  await db.batch([
    auth.revokeSessionStatement(db,id,context.userId,now,'USER_REVOKED'),
    statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,action:'AUTH_SESSION_REVOKED',
      resourceType:'app_session',resourceId:id,occurredAt:now})
  ]);
}
export async function revokeAll(db,context,requestId,now=Date.now()) {
  await db.batch([
    auth.revokeAllStatements(db,context.userId,now,'REVOKE_ALL'),
    statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,action:'AUTH_ALL_SESSIONS_REVOKED',
      resourceType:'app_user',resourceId:context.userId,occurredAt:now})
  ]);
}
