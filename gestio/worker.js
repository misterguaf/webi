import { assertEnvironment, cookieHeader, cookieToken, DEV_ISSUER, getSession, verifyAccessRequest } from './src/auth.js';
import * as identities from './src/domains/auth/repository.js';
import * as organization from './src/domains/organization/repository.js';
import * as auth from './src/services/auth-service.js';
import * as participants from './src/services/participant-service.js';
import * as family from './src/services/participant-family-service.js';
import * as participantReviews from './src/services/participant-review-service.js';
import * as audit from './src/services/audit-service.js';
import * as security from './src/services/security-service.js';
import * as activities from './src/services/activity-service.js';
import * as registrations from './src/services/registration-service.js';
import * as delegations from './src/services/delegation-service.js';
import * as notifications from './src/services/notification-service.js';
import * as fees from './src/services/annual-fee-service.js';
import * as feeMetrics from './src/services/annual-fee-metrics.js';
import { scopedFeeStatus } from './src/services/annual-fee-status.js';
import * as capabilityService from './src/services/capability-service.js';
import * as identityService from './src/services/identity-service.js';
import { AppError } from './src/services/common.js';
import { financeRoute } from './src/domains/finance/routes.js';
import { devIdentityEnabled, hostAllowed, runtimeEnvironment } from './src/environment-policy.js';

// Named entrypoint for the portal service binding only; never routed from the public handler below.
export { PortalIntake } from './src/intake.js';

// Audit L2: strict CSP without 'unsafe-inline' and no framing. CSSOM style changes stay allowed.
const PAGE_CSP="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; "+
  "font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const API_CSP="default-src 'none'; frame-ancestors 'none'";
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff','Content-Security-Policy':API_CSP,'X-Frame-Options':'DENY',...headers }
});
const devEnabled = (env,url) => devIdentityEnabled(env,url);

async function readJson(request,maxBytes=2048) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) throw new AppError(400,'invalid_request');
  if (Number(request.headers.get('Content-Length')||0)>maxBytes) throw new AppError(413,'body_too_large');
  const reader=request.body?.getReader();
  if (!reader) throw new AppError(400,'invalid_request');
  let size=0;const chunks=[];
  for (;;) {
    const {value,done}=await reader.read();
    if (done) break;
    size+=value.byteLength;
    if (size>maxBytes) { await reader.cancel();throw new AppError(413,'body_too_large'); }
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
    if (runtimeEnvironment(env)!=='production') throw new AppError(404,'not_found');
    let identity;
    try {identity=await verifyAccessRequest(request,env);} catch {await auth.loginFailed(db,requestId);throw new AppError(401,'invalid_identity');}
    // Unknown subject: bind it only through an open invitation for the same verified e-mail.
    const user=await identities.findIdentityUser(db,identity.issuer,identity.subject)??
      await identityService.claimInvitedIdentity(db,requestId,identity);
    if (!user) {await auth.loginFailed(db,requestId);throw new AppError(401,'invalid_identity');}
    await identities.markIdentitySeen(db,{issuer:identity.issuer,subject:identity.subject,email:identity.email,now:Date.now()});
    return sessionResponse(db,user,requestId,url);
  }

  const session=await getSession(db,cookieToken(request));
  if (!session) throw new AppError(401,'unauthenticated');
  const context={userId:session.user_id,sessionId:session.session_id,status:session.status};
  if (path==='/api/me' && method==='GET') return json({user:{id:context.userId,displayName:session.display_name,status:session.status},
    roles:await organization.currentRoles(db,context.userId,Date.now()),
    capabilities:await capabilityService.capabilities(db,context),requestId});
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
  if (path==='/api/participants/follow-up' && method==='GET') return json({...await participants.followUp(db,context,requestId),requestId});
  if (path==='/api/participants' && method==='GET') return json({...await participants.list(db,context,requestId,url.searchParams),requestId});
  if (path==='/api/participants' && method==='POST') return json({...await participants.createParticipant(db,context,requestId,await readJson(request)),requestId},201);
  match=path.match(/^\/api\/participants\/([^/]+)$/);
  if (match && method==='GET') return json({participant:await participants.find(db,context,requestId,match[1]),requestId});
  if (match && method==='PATCH') return json({...await participants.updateParticipant(db,context,requestId,match[1],await readJson(request)),requestId});
  match=path.match(/^\/api\/participants\/([^/]+)\/(deactivate|reactivate)$/);
  if (match && method==='POST') return json({...await participants.setParticipantActive(db,context,requestId,match[1],match[2]==='reactivate',await readJson(request)),requestId});
  match=path.match(/^\/api\/participants\/([^/]+)\/section$/);
  if (match && method==='POST') return json({...await participants.changeParticipantSection(db,context,requestId,match[1],await readJson(request)),requestId});
  // 3.5E family: guardians, contacts and legal representation (participant-scoped).
  match=path.match(/^\/api\/participants\/([^/]+)\/familia$/);
  if (match && method==='GET') return json({...await family.familia(db,context,requestId,match[1]),requestId});
  match=path.match(/^\/api\/participants\/([^/]+)\/representation$/);
  if (match && method==='GET') return json({history:await family.representationHistory(db,context,requestId,match[1]),requestId});
  match=path.match(/^\/api\/participants\/([^/]+)\/guardians$/);
  if (match && method==='POST') return json({...await family.addGuardian(db,context,requestId,match[1],await readJson(request)),requestId},201);
  match=path.match(/^\/api\/participants\/([^/]+)\/guardians\/([^/]+)$/);
  if (match && method==='DELETE') return json({...await family.endGuardianRelationship(db,context,requestId,match[1],match[2]),requestId});
  match=path.match(/^\/api\/participants\/([^/]+)\/guardians\/([^/]+)\/representation$/);
  if (match && method==='POST') return json({...await family.setRepresentation(db,context,requestId,match[1],match[2],await readJson(request)),requestId});
  match=path.match(/^\/api\/participants\/([^/]+)\/guardians\/([^/]+)\/accredit$/);
  if (match && method==='POST') return json({...await family.accreditRepresentation(db,context,requestId,match[1],match[2],await readJson(request)),requestId});
  match=path.match(/^\/api\/participants\/([^/]+)\/contacts$/);
  if (match && method==='POST') return json({...await family.addContact(db,context,requestId,match[1],await readJson(request)),requestId},201);
  match=path.match(/^\/api\/participants\/([^/]+)\/contacts\/([^/]+)$/);
  if (match && method==='DELETE') return json({...await family.endContact(db,context,requestId,match[1],match[2]),requestId});
  match=path.match(/^\/api\/contacts\/([^/]+)$/);
  if (match && method==='GET') return json({contact:await family.consultContact(db,context,requestId,match[1]),requestId});
  // 3.5E administrative review queue (Secretaria).
  if (path==='/api/participant-reviews' && method==='GET') return json({...await participantReviews.listReviews(db,context,requestId,url.searchParams),requestId});
  if (path==='/api/participant-reviews/summary' && method==='GET') return json({...await participantReviews.reviewSummary(db,context,requestId),requestId});
  match=path.match(/^\/api\/participant-reviews\/([^/]+)\/(acknowledge|incidence|escalate|resolve|apply|reject)$/);
  if (match && method==='POST') {
    const id=match[1];
    if (match[2]==='acknowledge') return json({...await participantReviews.acknowledgeReview(db,context,requestId,id),requestId});
    if (match[2]==='incidence') return json({...await participantReviews.raiseIncidence(db,context,requestId,id,await readJson(request)),requestId});
    if (match[2]==='escalate') return json({...await participantReviews.escalateReview(db,context,requestId,id),requestId});
    if (match[2]==='resolve') return json({...await participantReviews.resolveReview(db,context,requestId,id),requestId});
    if (match[2]==='apply') return json({...await participantReviews.applyChangeRequest(db,context,requestId,id),requestId});
    return json({...await participantReviews.rejectChangeRequest(db,context,requestId,id),requestId});
  }
  if (path==='/api/dev/policy/health' && method==='POST' && devEnabled(env,url)) {
    const body=await readJson(request);
    return json({...await participants.healthPolicyCheck(db,context,requestId,body.participantId,body.purpose),requestId});
  }
  if (path==='/api/audit/events' && method==='GET') return json({...await audit.readAudit(db,context,requestId,url.searchParams),requestId});

  if (path==='/api/activities' && method==='GET') return json({...await activities.listAdminActivities(db,context,requestId,url.searchParams),requestId});
  if (path==='/api/activities' && method==='POST') return json({...await activities.createActivity(db,context,requestId,await readJson(request)),requestId},201);
  match=path.match(/^\/api\/activities\/([^/]+)$/);
  if (match && method==='PATCH') return json({...await activities.updateActivity(db,context,requestId,match[1],await readJson(request)),requestId});
  if (match && method==='GET') return json({activity:await activities.activityDetail(db,context,requestId,match[1]),requestId});
  if (match && method==='DELETE') return json({...await activities.discardActivity(db,context,requestId,match[1],await readJson(request)),requestId});
  match=path.match(/^\/api\/activities\/([^/]+)\/(publish|close)$/);
  if (match && method==='POST') return json({...await activities.transitionActivity(db,context,requestId,match[1],
    match[2]==='publish'?'PUBLISHED':'CLOSED',await readJson(request)),requestId});
  match=path.match(/^\/api\/activities\/([^/]+)\/registrations$/);
  if (match && method==='GET') return json({...await registrations.listRegistrations(db,context,requestId,match[1],url.searchParams),requestId});
  match=path.match(/^\/api\/activities\/([^/]+)\/registrations\/confirmed$/);
  if (match && method==='GET') return json({...await registrations.confirmedList(db,context,requestId,match[1]),requestId});
  if (path==='/api/registrations/queue' && method==='GET') return json({...await registrations.registrationQueue(db,context,requestId,url.searchParams),requestId});
  if (path==='/api/registrations/queue/summary' && method==='GET') return json({...await registrations.queueSummary(db,context,requestId),requestId});
  match=path.match(/^\/api\/registrations\/([^/]+)\/contact$/);
  if (match && method==='GET') return json({contact:await registrations.registrationContact(db,context,requestId,match[1]),requestId});
  match=path.match(/^\/api\/registrations\/([^/]+)\/(escalate|section|withdraw)$/);
  if (match && method==='POST') {
    const action={escalate:registrations.escalateRegistration,section:registrations.correctSection,withdraw:registrations.withdrawRegistration}[match[2]];
    return json({...await action(db,context,requestId,match[1],await readJson(request)),requestId});
  }
  match=path.match(/^\/api\/registrations\/([^/]+)\/review$/);
  if (match && method==='POST') return json({...await registrations.reviewMatch(db,context,requestId,match[1],await readJson(request)),requestId});
  match=path.match(/^\/api\/registrations\/([^/]+)\/candidates$/);
  if (match && method==='GET') return json({...await registrations.reviewCandidates(db,context,requestId,match[1],url.searchParams.get('search')),requestId});
  if (path==='/api/payments' && method==='GET') return json({...await registrations.listPayments(db,context,requestId,url.searchParams),requestId});
  match=path.match(/^\/api\/payments\/([^/]+)$/);
  if (match && method==='GET') return json({...await registrations.paymentDetail(db,context,requestId,match[1]),requestId});
  match=path.match(/^\/api\/payments\/([^/]+)\/review$/);
  if (match && method==='POST') {
    return json({...await registrations.reviewPayment(db,context,requestId,match[1],await readJson(request)),requestId});
  }
  match=path.match(/^\/api\/payments\/([^/]+)\/evidence$/);
  if (match && method==='GET') return registrations.evidenceDownload(db,env.EVIDENCE_STORAGE,context,requestId,match[1],url.searchParams.get('mode')??'download');
  if (path==='/api/delegations' && method==='GET') return json({...await delegations.listDelegations(db,context,requestId,url.searchParams),requestId});
  if (path==='/api/delegations' && method==='POST') return json({...await delegations.grantDelegation(db,context,session,requestId,await readJson(request)),requestId},201);
  match=path.match(/^\/api\/delegations\/([^/]+)\/(ratify|revoke|confirm)$/);
  if (match && method==='POST') return json({...await (match[2]==='ratify'
    ?delegations.ratifyDelegation(db,context,session,requestId,match[1],await readJson(request))
    :match[2]==='confirm'?delegations.confirmDelegation(db,context,session,requestId,match[1])
    :delegations.revokeDelegation(db,context,session,requestId,match[1])),requestId});
  if (path==='/api/dev/notifications/drain' && method==='POST') {
    if (!devEnabled(env,url)) throw new AppError(404,'not_found');
    const body=await readJson(request);
    if (Object.keys(body).some(key=>key!=='failSynthetic') || (body.failSynthetic!=null && typeof body.failSynthetic!=='boolean'))
      throw new AppError(400,'invalid_request');
    return json({...await notifications.drainFake(db,context,requestId,body),requestId});
  }

  if (path==='/api/fees/status' && method==='GET') return json({...await scopedFeeStatus(db,context,requestId,url.searchParams.get('roundId'),url.searchParams),requestId});
  if (path==='/api/fees/rounds' && method==='GET') return json({rounds:await fees.listRounds(db,context,requestId),requestId});
  if (path==='/api/fees/review-rounds' && method==='GET') return json({rounds:await fees.listReviewRounds(db,context,requestId),requestId});
  if (path==='/api/fees/rounds' && method==='POST') return json({...await fees.createRound(db,context,requestId,await readJson(request)),requestId},201);
  match=path.match(/^\/api\/fees\/rounds\/([^/]+)$/);
  if (match && method==='PATCH') return json({...await fees.updateRound(db,context,requestId,match[1],await readJson(request)),requestId});
  match=path.match(/^\/api\/fees\/rounds\/([^/]+)\/revisions$/);
  if (match && method==='GET') return json({revisions:await fees.roundRevisions(db,context,requestId,match[1]),requestId});
  match=path.match(/^\/api\/fees\/rounds\/([^/]+)\/(obligations|metrics|payments|participants|groups|issues)$/);
  if (match && method==='GET') {
    const id=match[1],kind=match[2];
    if (kind==='obligations') return json({...await feeMetrics.listObligations(db,context,requestId,
      {roundId:id,sectionId:url.searchParams.get('sectionId'),status:url.searchParams.get('status'),
        search:url.searchParams.get('search')??'',params:url.searchParams}),requestId});
    if (kind==='metrics') return json({metrics:await feeMetrics.feeMetrics(db,context,requestId,id),requestId});
    if (kind==='payments') return json({...await fees.listFeePayments(db,context,requestId,id,url.searchParams),requestId});
    if (kind==='participants') return json({...await fees.searchFeeParticipants(db,context,requestId,id,
      url.searchParams.get('search')??''),requestId});
    if (kind==='groups') return json({...await fees.listFamilyGroups(db,context,requestId,id,url.searchParams),requestId});
    return json({...await fees.listFeeIssues(db,context,requestId,id,url.searchParams),requestId});
  }
  if (path==='/api/fees/family-rounds' && method==='GET') return json({rounds:await fees.listFamilyRounds(db,context,requestId),requestId});
  if (path==='/api/fees/groups' && method==='POST') return json({...await fees.createFamilyGroup(db,context,requestId,await readJson(request)),requestId},201);
  match=path.match(/^\/api\/fees\/groups\/([^/]+)$/);
  if (match && method==='PATCH') return json({...await fees.correctFamilyGroup(db,context,requestId,match[1],await readJson(request)),requestId});
  match=path.match(/^\/api\/fees\/groups\/([^/]+)\/revisions$/);
  if (match && method==='GET') return json({revisions:await fees.familyGroupRevisions(db,context,requestId,match[1]),requestId});
  if (path==='/api/fees/obligations' && method==='POST') return json({...await fees.createObligation(db,context,requestId,await readJson(request)),requestId},201);
  match=path.match(/^\/api\/fees\/obligations\/([^/]+)$/);
  if (match && method==='GET') return json({...await fees.feeObligationDetail(db,context,requestId,match[1]),requestId});
  if (match && method==='PATCH') return json({...await fees.overrideAmount(db,context,requestId,match[1],await readJson(request)),requestId});
  match=path.match(/^\/api\/fees\/obligations\/([^/]+)\/installments$/);
  if (match && method==='POST') return json({...await fees.authorizeInstallments(db,context,requestId,match[1],await readJson(request)),requestId},201);
  match=path.match(/^\/api\/fees\/payments\/([^/]+)$/);
  if (match && method==='GET') return json({...await fees.feePaymentDetail(db,context,requestId,match[1]),requestId});
  match=path.match(/^\/api\/fees\/payments\/([^/]+)\/review$/);
  if (match && method==='POST') return json({...await fees.reviewFeePayment(db,context,requestId,match[1],await readJson(request)),requestId});
  match=path.match(/^\/api\/fees\/payments\/([^/]+)\/allocations$/);
  if (match && method==='PATCH') return json({...await fees.reviseFeeAllocations(db,context,requestId,match[1],await readJson(request)),requestId});
  match=path.match(/^\/api\/fees\/people\/([^/]+)\/review$/);
  if (match && method==='POST') return json({...await fees.reviewFeeMatch(db,context,requestId,match[1],await readJson(request)),requestId});
  match=path.match(/^\/api\/fees\/people\/([^/]+)\/candidates$/);
  if (match && method==='GET') return json({...await fees.feeMatchCandidates(db,context,requestId,match[1],url.searchParams.get('search')),requestId});
  match=path.match(/^\/api\/fees\/payments\/([^/]+)\/contact$/);
  if (match && method==='GET') return json({contact:await fees.feePaymentContact(db,context,requestId,match[1]),requestId});
  match=path.match(/^\/api\/fees\/evidence\/([^/]+)$/);
  if (match && method==='GET') return fees.feeEvidenceDownload(db,env.EVIDENCE_STORAGE,context,requestId,match[1],url.searchParams.get('mode')??'download');
  if (path==='/api/fees/issues' && method==='POST') return json({...await fees.openFeeIssue(db,context,requestId,await readJson(request)),requestId},201);
  match=path.match(/^\/api\/fees\/issues\/([^/]+)\/resolve$/);
  if (match && method==='POST') return json({...await fees.resolveFeeIssue(db,context,requestId,match[1]),requestId});
  // 3.5G.1 financial foundation (TREASURY.md): rounds, positions, movements, allocations, expenses, budget.
  if (path.startsWith('/api/finance/')) {
    const response=await financeRoute({db,storage:env.EVIDENCE_STORAGE,context,requestId,method,path,url,request,json,readJson});
    if (response) return response;
  }

  if (path==='/api/users' && method==='GET') return json({...await identityService.listUsers(db,context,requestId,url.searchParams),requestId});
  if (path==='/api/users' && method==='POST') return json({...await identityService.createUser(db,context,session,requestId,await readJson(request)),requestId},201);
  match=path.match(/^\/api\/users\/([^/]+)$/);
  if (match && method==='GET') return json({...await identityService.userDetail(db,context,requestId,match[1]),requestId});
  match=path.match(/^\/api\/users\/([^/]+)\/invitations$/);
  if (match && method==='POST') return json({...await identityService.inviteIdentity(db,context,session,requestId,env,match[1],await readJson(request)),requestId},201);
  match=path.match(/^\/api\/users\/([^/]+)\/invitations\/([^/]+)$/);
  if (match && method==='DELETE') {await identityService.revokeInvitation(db,context,session,requestId,match[1],match[2]);return json({ok:true,requestId});}
  match=path.match(/^\/api\/users\/([^/]+)\/identities\/([^/]+)$/);
  if (match && method==='DELETE') {await identityService.revokeIdentity(db,context,session,requestId,match[1],match[2]);return json({ok:true,requestId});}
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
      if (!hostAllowed(env,url)) throw new AppError(403,'local_only');
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
      headers.set('Content-Security-Policy',PAGE_CSP);
      headers.set('X-Frame-Options','DENY');
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
