import { assertEnvironment, cookieHeader, cookieToken, DEV_ISSUER, getSession, verifyAccessRequest } from './src/auth.js';
import * as identities from './src/domains/auth/repository.js';
import * as organization from './src/domains/organization/repository.js';
import * as auth from './src/services/auth-service.js';
import * as participants from './src/services/participant-service.js';
import * as audit from './src/services/audit-service.js';
import * as security from './src/services/security-service.js';
import * as activities from './src/services/activity-service.js';
import * as registrations from './src/services/registration-service.js';
import * as delegations from './src/services/delegation-service.js';
import * as notifications from './src/services/notification-service.js';
import { AppError, requirePermission } from './src/services/common.js';

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',...headers }
});
const local = url => ['localhost','127.0.0.1'].includes(url.hostname);
const devEnabled = (env,url) => env.APP_ENV==='development' && env.DEV_IDENTITY_PROVIDER==='enabled' && local(url);

async function readJson(request) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) throw new AppError(400,'invalid_request');
  if (Number(request.headers.get('Content-Length')||0)>2048) throw new AppError(413,'body_too_large');
  const reader=request.body?.getReader();
  if (!reader) throw new AppError(400,'invalid_request');
  let size=0;const chunks=[];
  for (;;) {
    const {value,done}=await reader.read();
    if (done) break;
    size+=value.byteLength;
    if (size>2048) { await reader.cancel();throw new AppError(413,'body_too_large'); }
    chunks.push(value);
  }
  const bytes=new Uint8Array(size);let offset=0;
  for (const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try {
    const result=JSON.parse(new TextDecoder().decode(bytes));
    if (!result || typeof result!=='object' || Array.isArray(result)) throw new Error('shape');
    return result;
  } catch { throw new AppError(400,'invalid_request'); }
}

async function sessionResponse(db,user,requestId,url) {
  const issued=await auth.issueSession(db,user,requestId);
  return json({user:issued.user,requestId},200,{'Set-Cookie':cookieHeader(url,issued.token)});
}

async function api(request,env,url,requestId) {
  const db=env.DB,path=url.pathname,method=request.method;
  if (!['GET','POST','PATCH','DELETE'].includes(method)) throw new AppError(405,'method_not_allowed');
  if (method!=='GET' && request.headers.get('Origin')!==url.origin) throw new AppError(403,'invalid_origin');
  if (path==='/api/dev/identities' && method==='GET') {
    if (!devEnabled(env,url)) throw new AppError(404,'not_found');
    return json({identities:await identities.syntheticIdentities(db,DEV_ISSUER),requestId});
  }
  if (path==='/api/dev/login' && method==='POST') {
    if (!devEnabled(env,url)) throw new AppError(404,'not_found');
    const body=await readJson(request);
    if (typeof body.subject!=='string' || !/^seed-10[1-7]$/.test(body.subject)) throw new AppError(400,'invalid_request');
    const user=await identities.findIdentityUser(db,DEV_ISSUER,body.subject);
    if (!user) {await auth.loginFailed(db,requestId);throw new AppError(401,'invalid_identity');}
    return sessionResponse(db,user,requestId,url);
  }
  if (path==='/api/auth/access' && method==='POST') {
    if (env.APP_ENV!=='production') throw new AppError(404,'not_found');
    let identity;
    try {identity=await verifyAccessRequest(request,env);} catch {await auth.loginFailed(db,requestId);throw new AppError(401,'invalid_identity');}
    const user=await identities.findIdentityUser(db,identity.issuer,identity.subject);
    if (!user) {await auth.loginFailed(db,requestId);throw new AppError(401,'invalid_identity');}
    await identities.markIdentitySeen(db,{issuer:identity.issuer,subject:identity.subject,email:identity.email,now:Date.now()});
    return sessionResponse(db,user,requestId,url);
  }

  const session=await getSession(db,cookieToken(request));
  if (!session) throw new AppError(401,'unauthenticated');
  const context={userId:session.user_id,sessionId:session.session_id,status:session.status};
  if (path==='/api/me' && method==='GET') return json({user:{id:context.userId,displayName:session.display_name,status:session.status},
    roles:await organization.currentRoles(db,context.userId,Date.now()),requestId});
  if (path==='/api/me/sessions' && method==='GET') return json({sessions:await auth.listOwnSessions(db,context),requestId});
  if (path==='/api/logout' && method==='POST') {
    await auth.logout(db,context,requestId);return json({ok:true,requestId},200,{'Set-Cookie':cookieHeader(url,'',0)});
  }
  if (path==='/api/me/sessions/revoke-all' && method==='POST') {
    await auth.revokeAll(db,context,requestId);return json({ok:true,requestId},200,{'Set-Cookie':cookieHeader(url,'',0)});
  }
  let match=path.match(/^\/api\/me\/sessions\/([^/]+)$/);
  if (match && method==='DELETE') {
    await auth.revokeOne(db,context,requestId,match[1]);
    return json({ok:true,requestId},200,match[1]===context.sessionId?{'Set-Cookie':cookieHeader(url,'',0)}:{});
  }
  if (path==='/api/participants' && method==='GET') return json({participants:await participants.list(db,context,requestId),requestId});
  match=path.match(/^\/api\/participants\/([^/]+)$/);
  if (match && method==='GET') return json({participant:await participants.find(db,context,requestId,match[1]),requestId});
  if (path==='/api/dev/policy/health' && method==='POST' && devEnabled(env,url)) {
    const body=await readJson(request);
    return json({...await participants.healthPolicyCheck(db,context,requestId,body.participantId,body.purpose),requestId});
  }
  if (path==='/api/audit/events' && method==='GET') return json({...await audit.readAudit(db,context,requestId,url.searchParams),requestId});

  if (path==='/api/activities' && method==='GET') return json({activities:await activities.listAdminActivities(db,context,requestId),requestId});
  if (path==='/api/activities' && method==='POST') return json({...await activities.createActivity(db,context,requestId,await readJson(request)),requestId},201);
  match=path.match(/^\/api\/activities\/([^/]+)$/);
  if (match && method==='PATCH') return json({...await activities.updateActivity(db,context,requestId,match[1],await readJson(request)),requestId});
  if (match && method==='GET') {
    const activity=await activities.activityById(db,match[1]);
    const permission=activity.audience==='GENERAL'?'activities.general.manage':'activities.read';
    const sections=activity.sectionIds.length?activity.sectionIds:[null];
    for (const sectionId of sections) await requirePermission(db,context,requestId,permission,
      {sectionId,resourceType:'activity',resourceId:activity.id});
    return json({activity,requestId});
  }
  match=path.match(/^\/api\/activities\/([^/]+)\/(publish|close)$/);
  if (match && method==='POST') return json({...await activities.transitionActivity(db,context,requestId,match[1],
    match[2]==='publish'?'PUBLISHED':'CLOSED'),requestId});
  match=path.match(/^\/api\/activities\/([^/]+)\/registrations$/);
  if (match && method==='GET') return json({registrations:await registrations.listRegistrations(db,context,requestId,match[1]),requestId});
  match=path.match(/^\/api\/registrations\/([^/]+)\/review$/);
  if (match && method==='POST') return json({...await registrations.reviewMatch(db,context,requestId,match[1],await readJson(request)),requestId});
  match=path.match(/^\/api\/registrations\/([^/]+)\/candidates$/);
  if (match && method==='GET') return json({candidates:await registrations.reviewCandidates(db,context,requestId,match[1]),requestId});
  if (path==='/api/payments' && method==='GET') return json({payments:await registrations.listPayments(db,context,requestId),requestId});
  match=path.match(/^\/api\/payments\/([^/]+)\/review$/);
  if (match && method==='POST') {
    const body=await readJson(request);
    if (Object.keys(body).some(key=>key!=='decision')) throw new AppError(400,'invalid_review');
    return json({...await registrations.reviewPayment(db,context,requestId,match[1],body.decision),requestId});
  }
  match=path.match(/^\/api\/payments\/([^/]+)\/evidence$/);
  if (match && method==='GET') return registrations.evidenceDownload(db,env.EVIDENCE_STORAGE,context,requestId,match[1]);
  if (path==='/api/delegations' && method==='GET') return json({delegations:await delegations.listDelegations(db,context,requestId),requestId});
  if (path==='/api/delegations' && method==='POST') return json({...await delegations.grantDelegation(db,context,session,requestId,await readJson(request)),requestId},201);
  match=path.match(/^\/api\/delegations\/([^/]+)\/(ratify|revoke)$/);
  if (match && method==='POST') return json({...await (match[2]==='ratify'
    ?delegations.ratifyDelegation(db,context,session,requestId,match[1],await readJson(request))
    :delegations.revokeDelegation(db,context,session,requestId,match[1])),requestId});
  if (path==='/api/dev/notifications/drain' && method==='POST') {
    if (!devEnabled(env,url)) throw new AppError(404,'not_found');
    const body=await readJson(request);
    if (Object.keys(body).some(key=>key!=='failSynthetic') || (body.failSynthetic!=null && typeof body.failSynthetic!=='boolean'))
      throw new AppError(400,'invalid_request');
    return json({...await notifications.drainFake(db,context,requestId,body),requestId});
  }

  match=path.match(/^\/api\/users\/([^/]+)\/(suspend|disable|enable)$/);
  if (match && method==='POST') {
    if (match[2]==='suspend') await security.suspendUser(db,context,session,requestId,match[1]);
    else await security.setUserEnabled(db,context,session,requestId,match[1],match[2]==='enable');
    return json({ok:true,requestId});
  }
  match=path.match(/^\/api\/users\/([^/]+)\/roles$/);
  if (match && method==='POST') return json({...await security.assignRole(db,context,session,requestId,{...await readJson(request),userId:match[1]}),requestId},201);
  match=path.match(/^\/api\/users\/([^/]+)\/roles\/([^/]+)$/);
  if (match && method==='DELETE') {await security.removeRole(db,context,session,requestId,match[1],match[2]);return json({ok:true,requestId});}
  match=path.match(/^\/api\/users\/([^/]+)\/permissions$/);
  if (match && method==='POST') return json({...await security.grantPermission(db,context,session,requestId,{...await readJson(request),userId:match[1]}),requestId},201);
  match=path.match(/^\/api\/users\/([^/]+)\/permissions\/([^/]+)$/);
  if (match && method==='DELETE') {await security.revokePermission(db,context,session,requestId,match[1],match[2]);return json({ok:true,requestId});}
  if (path==='/api/health-grants' && method==='POST') return json({...await security.grantHealth(db,context,session,requestId,await readJson(request)),requestId},201);
  match=path.match(/^\/api\/health-grants\/([^/]+)$/);
  if (match && method==='DELETE') {await security.revokeHealth(db,context,session,requestId,match[1]);return json({ok:true,requestId});}
  if (path==='/api/incidents' && method==='POST') return json({...await security.openIncident(db,context,session,requestId,await readJson(request)),requestId},201);
  match=path.match(/^\/api\/incidents\/([^/]+)\/holds$/);
  if (match && method==='POST') {const body=await readJson(request);await security.holdAuditEvent(db,context,session,requestId,match[1],body.eventId);return json({ok:true,requestId},201);}
  match=path.match(/^\/api\/incidents\/([^/]+)\/holds\/([^/]+)$/);
  if (match && method==='DELETE') {await security.releaseAuditHold(db,context,session,requestId,match[1],match[2]);return json({ok:true,requestId});}
  throw new AppError(404,'not_found');
}

export default {
  async fetch(request,env) {
    const requestId=crypto.randomUUID();
    try {
      assertEnvironment(env);
      const url=new URL(request.url);
      if (env.APP_ENV==='development' && !local(url)) throw new AppError(403,'local_only');
      if (url.pathname.startsWith('/api/')) {
        const response=await api(request,env,url,requestId);
        response.headers.set('X-Request-ID',requestId);
        response.headers.set('Referrer-Policy','no-referrer');
        return response;
      }
      const response=await env.ASSETS.fetch(request);
      const headers=new Headers(response.headers);
      headers.set('X-Content-Type-Options','nosniff');
      headers.set('Referrer-Policy','no-referrer');
      headers.set('X-Robots-Tag','noindex, nofollow, noarchive');
      headers.set('Cache-Control','no-store');
      headers.set('X-Request-ID',requestId);
      return new Response(response.body,{status:response.status,headers});
    } catch(error) {
      if (!(error instanceof AppError)) console.error('gestio request failure',{requestId,name:error?.name});
      return json({error:error instanceof AppError?error.code:'internal_error',requestId},error instanceof AppError?error.status:500,
        {'X-Request-ID':requestId,'Referrer-Policy':'no-referrer'});
    }
  }
};
