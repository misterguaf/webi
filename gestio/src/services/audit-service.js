import { append, queryAuthorized, retentionDeleteStatement, statement } from '../domains/audit/repository.js';
import { cleanupSessionsStatement } from '../domains/auth/repository.js';
import { retentionPolicy } from '../domains/security/repository.js';
import { AppError, requirePermission } from './common.js';

const FILTER_NAMES=new Set(['limit','cursor','from','to','actorId','action','resourceType','resourceId','result','requestId']);
export async function readAudit(db,context,requestId,searchParams) {
  await requirePermission(db,context,requestId,'audit.event.read',{resourceType:'audit_event'});
  const filters={};
  for (const [key,value] of searchParams) {
    if (!FILTER_NAMES.has(key) || key in filters) throw new AppError(400,'invalid_filter');
    filters[key]=value;
  }
  let page;
  try { page=await queryAuthorized(db,filters); }
  catch(error) { if (error.message.startsWith('INVALID_AUDIT_')) throw new AppError(400,'invalid_filter'); throw error; }
  await db.batch([
    statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,action:'AUTHZ_ALLOW',
      resourceType:'audit_event',result:'ALLOW',reasonCode:'ALLOW'}),
    statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,action:'AUDIT_LOG_READ',
      resourceType:'audit_event',result:'SUCCESS',metadata:{count:page.events.length}})
  ]);
  return page;
}

// No HTTP route: only an explicitly invoked local lifecycle job may call this.
// Both policies are disabled by default until legal retention periods are approved.
export async function runRetention(db,{requestId,now=Date.now()}) {
  const auditPolicy=await retentionPolicy(db,'AUDIT_EVENT');
  const sessionPolicy=await retentionPolicy(db,'APP_SESSION');
  if (!auditPolicy || !sessionPolicy) throw new Error('RETENTION_POLICY_MISSING');
  const statements=[];
  if (auditPolicy.enabled) statements.push(retentionDeleteStatement(db,now-auditPolicy.retention_ms));
  if (sessionPolicy.enabled) statements.push(cleanupSessionsStatement(db,now-sessionPolicy.retention_ms));
  if (!statements.length) return {auditDeleted:0,sessionsDeleted:0,enabled:false};
  statements.push(statement(db,{requestId,action:'RETENTION_APPLIED',resourceType:'audit_event',
    result:'SUCCESS',metadata:{source:'retention-job'},occurredAt:now}));
  const result=await db.batch(statements);
  return {auditDeleted:auditPolicy.enabled?result[0].meta.changes:0,
    sessionsDeleted:sessionPolicy.enabled?result[auditPolicy.enabled?1:0].meta.changes:0,enabled:true};
}
