// Activity registrations (3A intake; 3.5F Inscripcions v1.0, REGISTRATIONS.md v0.2).
//
// Section model (§7): submitted_section_id is what the family declared and never changes;
// registration_section_id is the operational and historical section that drives scope, counts,
// payments and lists; a participant's later section change never rewrites it.
//
// Authorisation order for every resource (§8.4): capability anywhere (403) → resource resolved within
// scope (missing and out-of-scope are the same 404) → state/version (409) → write. Lists never carry
// contact data; the submitter's contact is a separate, audited request.
import { pageRequest, pageResult } from '../pagination.js';
import { synthetic } from '../environment-policy.js';
import { authorize } from '../policy.js';
import { append, statement } from '../domains/audit/repository.js';
import { versionCas } from '../concurrency.js';
import { AppError, requirePermission, requireUuid } from './common.js';
import { evidenceKey, readEvidence, storeEvidence, validateSyntheticEvidence } from './evidence-service.js';
import { queueStatement } from './notification-service.js';

export function matchKey(value) {
  return value.normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('ca-ES')
    .replace(/[\p{P}\p{S}]/gu,' ').replace(/\s+/g,' ').trim();
}
async function hash(value) {
  const bytes=new TextEncoder().encode(JSON.stringify(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
async function existingIdempotency(db,key,payloadHash,birthDate) {
  const existing=await db.prepare(`SELECT r.id,r.payload_sha256,r.submitted_birth_date,r.participant_id,
    p.birth_date AS linked_birth_date FROM activity_registration r
    LEFT JOIN participant p ON p.id=r.participant_id WHERE r.idempotency_key=?`).bind(key).first();
  if (!existing) return false;
  if (existing.payload_sha256!==payloadHash ||
      (existing.submitted_birth_date!==null && existing.submitted_birth_date!==birthDate) ||
      (existing.participant_id && existing.linked_birth_date && existing.linked_birth_date!==birthDate))
    throw new AppError(409,'idempotency_conflict');
  return true;
}
async function audienceSections(db,activityId) {
  return (await db.prepare('SELECT section_id FROM activity_section WHERE activity_id=? ORDER BY section_id').bind(activityId).all()).results
    .map(row=>row.section_id);
}
async function activityByCode(db,code) {
  return db.prepare('SELECT * FROM activity WHERE public_code=?').bind(code).first();
}
function validateInput(input) {
  const keys=new Set(['publicCode','participantName','birthDate','submittedByName','contactPhone','sectionCode',
    'transportCode','participationTermsVersion','privacyNoticeVersion','receiptEmail','idempotencyKey','evidence']);
  const birthDate=typeof input?.birthDate==='string'?input.birthDate:'';
  const dateMatch=/^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  const date=dateMatch?new Date(`${birthDate}T00:00:00.000Z`):null;
  const validBirthDate=!!date && !Number.isNaN(date.getTime()) && date.toISOString().slice(0,10)===birthDate && date.getTime()<=Date.now();
  const submittedByName=typeof input?.submittedByName==='string'?input.submittedByName.trim():'';
  const contactPhone=input?.contactPhone==null?'':String(input.contactPhone).trim();
  if (!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>!keys.has(key)) ||
      typeof input.publicCode!=='string' || !/^[A-Z0-9-]{8,40}$/.test(input.publicCode) ||
      typeof input.participantName!=='string' || input.participantName.length>120 || matchKey(input.participantName).length<2 ||
      !validBirthDate || !submittedByName || submittedByName.length>120 ||
      (input.contactPhone!=null && (typeof input.contactPhone!=='string' || input.contactPhone.length>24 ||
        (contactPhone!=='' && (!/^[0-9+()\s.\-]{6,24}$/.test(contactPhone) ||
          contactPhone.replace(/\D/g,'').length<6 || contactPhone.replace(/\D/g,'').length>15)))) ||
      !['MANADA','TROPA','ESCOLTA','CLAN'].includes(input.sectionCode) ||
      (input.transportCode!=null && !['GROUP','FAMILY'].includes(input.transportCode)) ||
      typeof input.receiptEmail!=='string' || !/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(input.receiptEmail) || input.receiptEmail.length>254 ||
      typeof input.idempotencyKey!=='string' || !/^[A-Za-z0-9_-]{16,100}$/.test(input.idempotencyKey) ||
      input.participationTermsVersion!==synthetic.terms.activityParticipation ||
      input.privacyNoticeVersion!==synthetic.terms.activityPrivacy) throw new AppError(400,'invalid_registration');
}
// Conservative automatic matching (unchanged rules): exact name key, same birth date, current section =
// declared section, within the audience. `elsewhere` flags an exact name + birth date match in a section
// different from the declared one; it is used only to escalate, never returned or stored.
export async function findMatch(db,name,birthDate,sectionId,allowedSections) {
  const rows=(await db.prepare('SELECT id,display_name,current_section_id,birth_date FROM participant WHERE status=? ORDER BY id LIMIT 1001')
    .bind('ACTIVE').all()).results;
  if (rows.length>1000) return {status:'AMBIGUOUS',participant:null,elsewhere:false}; // fail closed until indexed matching exists
  const exact=rows.filter(row=>matchKey(row.display_name)===name);
  const sameIdentity=exact.filter(row=>(!sectionId || row.current_section_id===sectionId) &&
    (!allowedSections.length || allowedSections.includes(row.current_section_id)));
  const candidates=sameIdentity.filter(row=>row.birth_date===birthDate);
  const elsewhere=!!sectionId && exact.some(row=>row.birth_date===birthDate && row.current_section_id!==sectionId);
  if (candidates.length===1) return {status:'CLEAR',participant:candidates[0],elsewhere};
  if (candidates.length>1 || sameIdentity.length) return {status:'AMBIGUOUS',participant:null,elsewhere};
  return {status:'NONE',participant:null,elsewhere};
}
function notificationStatements(db,registrationId,items,now,requestId,context=null) {
  const result=[];
  for (const [kind,email] of items) {
    const queued=queueStatement(db,registrationId,kind,email,now);
    result.push(queued.statement,statement(db,{requestId,actorUserId:context?.userId??null,sessionId:context?.sessionId??null,
      action:'NOTIFICATION_QUEUED',resourceType:'notification_outbox',resourceId:queued.id,occurredAt:now}));
  }
  return result;
}
export async function submitRegistration(db,storage,input,requestId,now=Date.now()) {
  validateInput(input);
  const activity=await activityByCode(db,input.publicCode);
  if (!activity || activity.status!=='PUBLISHED') throw new AppError(404,'activity_unavailable');
  if (now>activity.registration_deadline) throw new AppError(409,'registration_closed');
  const sections=await audienceSections(db,activity.id);
  let sectionId=null;
  if (input.sectionCode) {
    const found=await db.prepare('SELECT id FROM section WHERE code=?').bind(input.sectionCode).first();
    sectionId=found?.id??null;
  }
  if (activity.audience==='SECTIONS') {
    if (sections.length===1 && !sectionId) sectionId=sections[0];
    if (!sectionId || !sections.includes(sectionId)) throw new AppError(400,'invalid_registration');
  }
  const options=(await db.prepare('SELECT code,price_adjustment_cents FROM activity_transport_option WHERE activity_id=?').bind(activity.id).all()).results;
  if ((options.length && !input.transportCode) || (!options.length && input.transportCode)) throw new AppError(400,'invalid_registration');
  const transport=options.find(option=>option.code===input.transportCode);
  if (options.length && !transport) throw new AppError(400,'invalid_registration');
  const amount=activity.price_cents+(transport?.price_adjustment_cents??0);
  if (amount<0 || amount>1000000) throw new AppError(400,'invalid_registration');
  if (amount>0 && !input.evidence) throw new AppError(400,'evidence_required');
  if (amount===0 && input.evidence) throw new AppError(400,'evidence_not_required');
  const evidence=amount>0?await validateSyntheticEvidence(input.evidence):null;
  const key=matchKey(input.participantName);
  // Submitted birth date is deliberately omitted: once matching is resolved,
  // no persistent fingerprint should retain a derivative of that temporary field.
  const payloadHash=await hash([activity.id,key,input.submittedByName.trim(),input.contactPhone?.trim()??'',
    sectionId,input.transportCode??null,input.receiptEmail.toLowerCase(),input.participationTermsVersion,
    input.privacyNoticeVersion,evidence?.sha256??null]);
  if (await existingIdempotency(db,input.idempotencyKey,payloadHash,input.birthDate)) return {ok:true};
  const matched=await findMatch(db,key,input.birthDate,sectionId,sections);
  // A rejected or withdrawn registration does not block a new request for the same person.
  const duplicate=matched.participant
    ?await db.prepare("SELECT id FROM activity_registration WHERE activity_id=? AND participant_id=? AND status NOT IN ('REJECTED','WITHDRAWN')")
      .bind(activity.id,matched.participant.id).first()
    :await db.prepare(`SELECT id FROM activity_registration WHERE activity_id=? AND match_key=? AND COALESCE(submitted_section_id,'')=?
      AND submitted_birth_date=? AND participant_id IS NULL AND status='NEEDS_PARTICIPANT_REVIEW'`)
      .bind(activity.id,key,sectionId??'',input.birthDate).first();
  if (duplicate) {
    // A further payment attempt (Atlas review): the same person sends a new proof for a registration that
    // is still waiting for matching or payment. It is stored as a new attempt of that registration; the
    // same file twice is one attempt. Nothing about the registration is revealed (neutral answer).
    if (evidence) await attachAttempt(db,storage,duplicate.id,evidence,requestId,now);
    return {ok:true};
  }
  const id=crypto.randomUUID(),evidenceId=crypto.randomUUID(),objectKey=evidence?evidenceKey():null;
  const status=matched.status==='CLEAR'?(amount===0?'CONFIRMED':'AWAITING_PAYMENT_REVIEW'):'NEEDS_PARTICIPANT_REVIEW';
  // Server-detected discrepancy towards another section: global review, nothing disclosed or stored.
  const escalate=status==='NEEDS_PARTICIPANT_REVIEW' && matched.elsewhere;
  const notifications=[['RECEIVED',input.receiptEmail.toLowerCase()]];
  if (matched.status==='CLEAR') {
    if (status==='CONFIRMED') notifications.push(['CONFIRMED',input.receiptEmail.toLowerCase()]);
    if (status==='AWAITING_PAYMENT_REVIEW') notifications.push(['PENDING_PAYMENT',input.receiptEmail.toLowerCase()]);
  }
  if (evidence) await storeEvidence(storage,objectKey,evidence);
  try {
    await db.batch([
      db.prepare(`INSERT INTO activity_registration(id,activity_id,participant_id,submitted_name,match_key,submitted_section_id,
        registration_section_id,receipt_email,submitted_by_name,contact_phone,submitted_birth_date,
        transport_code,expected_amount_cents,match_status,status,consent_version,
        participation_terms_version,participation_authorized_at,privacy_notice_version,privacy_notice_acknowledged_at,
        idempotency_key,payload_sha256,created_at,updated_at,review_level,escalation_reason,escalated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,activity.id,matched.participant?.id??null,input.participantName.trim(),key,
        sectionId,sectionId,input.receiptEmail.toLowerCase(),input.submittedByName.trim(),input.contactPhone?.trim()||null,
        matched.status==='CLEAR'?null:input.birthDate,input.transportCode??null,amount,matched.status,status,'DEPRECATED',
        input.participationTermsVersion,now,input.privacyNoticeVersion,now,input.idempotencyKey,payloadHash,now,now,
        escalate?'GLOBAL':'SECTION',escalate?'POSSIBLE_OTHER_SECTION':null,escalate?now:null),
      ...(evidence?[db.prepare(`INSERT INTO payment_evidence(id,registration_id,object_key,sha256,size_bytes,detected_mime,review_status,created_at)
        VALUES(?,?,?,?,?,?,'PENDING_REVIEW',?)`).bind(evidenceId,id,objectKey,evidence.sha256,evidence.bytes.length,evidence.mime,now)]:[]),
      statement(db,{requestId,action:'REGISTRATION_RECEIVED',resourceType:'activity_registration',resourceId:id,occurredAt:now}),
      statement(db,{requestId,action:matched.status==='CLEAR'?'REGISTRATION_MATCHED':'REGISTRATION_MATCH_REVIEW_REQUIRED',
        resourceType:'activity_registration',resourceId:id,occurredAt:now}),
      ...(escalate?[statement(db,{requestId,action:'REGISTRATION_ESCALATED',resourceType:'activity_registration',resourceId:id,
        reasonCode:'POSSIBLE_OTHER_SECTION',occurredAt:now})]:[]),
      ...(status==='CONFIRMED'?[statement(db,{requestId,action:'REGISTRATION_CONFIRMED',resourceType:'activity_registration',resourceId:id,occurredAt:now})]:[]),
      ...(evidence?[statement(db,{requestId,action:'PAYMENT_EVIDENCE_RECEIVED',resourceType:'payment_evidence',resourceId:evidenceId,occurredAt:now})]:[]),
      ...notificationStatements(db,id,notifications,now,requestId)
    ]);
  } catch(error) {
    if (objectKey) await storage.delete(objectKey).catch(()=>{});
    if (await existingIdempotency(db,input.idempotencyKey,payloadHash,input.birthDate)) return {ok:true};
    const raced=matched.participant
      ?await db.prepare("SELECT 1 FROM activity_registration WHERE activity_id=? AND participant_id=? AND status NOT IN ('REJECTED','WITHDRAWN')")
        .bind(activity.id,matched.participant.id).first()
      :await db.prepare(`SELECT 1 FROM activity_registration WHERE activity_id=? AND match_key=? AND COALESCE(submitted_section_id,'')=?
        AND submitted_birth_date=? AND participant_id IS NULL AND status='NEEDS_PARTICIPANT_REVIEW'`)
        .bind(activity.id,key,sectionId??'',input.birthDate).first();
    if (raced) return {ok:true};
    throw error;
  }
  return {ok:true}; // identical external shape for clear, ambiguous, escalated and no match
}

async function attachAttempt(db,storage,registrationId,evidence,requestId,now) {
  const target=await db.prepare(`SELECT id FROM activity_registration WHERE id=? AND status IN ('NEEDS_PARTICIPANT_REVIEW','AWAITING_PAYMENT_REVIEW')`)
    .bind(registrationId).first();
  if (!target) return;
  if (await db.prepare('SELECT 1 FROM payment_evidence WHERE registration_id=? AND sha256=?').bind(registrationId,evidence.sha256).first()) return;
  const evidenceId=crypto.randomUUID(),objectKey=evidenceKey();
  await storeEvidence(storage,objectKey,evidence);
  try {
    await db.batch([
      db.prepare(`INSERT INTO payment_evidence(id,registration_id,object_key,sha256,size_bytes,detected_mime,review_status,created_at)
        VALUES(?,?,?,?,?,?,'PENDING_REVIEW',?)`).bind(evidenceId,registrationId,objectKey,evidence.sha256,evidence.bytes.length,evidence.mime,now),
      statement(db,{requestId,action:'PAYMENT_EVIDENCE_RECEIVED',resourceType:'payment_evidence',resourceId:evidenceId,reasonCode:'ADDITIONAL_ATTEMPT',occurredAt:now})
    ]);
  } catch (error) { await storage.delete(objectKey).catch(()=>{}); throw error; }
}

// ---------------------------------------------------------------- authorisation helpers (§8.4)
const covers=(decision,sectionId)=>decision.sections===null || (!!sectionId && decision.sections.includes(sectionId));
const sectionFilter=(decision,column)=>decision.sections===null?'':` AND ${column} IN (${decision.sections.map(()=>'?').join(',')})`;
async function deny(db,context,requestId,reason,resourceType,resourceId) {
  await append(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,action:'AUTHZ_DENY',result:'DENY',
    resourceType,resourceId:resourceId??null,reasonCode:reason});
}
async function capability(db,context,requestId,permission,resourceType,resourceId) {
  const decision=await authorize(db,context,{permission,mode:'list'});
  if (!decision.allow) { await deny(db,context,requestId,decision.reason,resourceType,resourceId); throw new AppError(403,'forbidden'); }
  return decision;
}
// A registration within the caller's scope, or the same 404 for missing and out-of-scope ids.
async function resolveRegistration(db,context,requestId,id,permission) {
  requireUuid(id);
  const decision=await capability(db,context,requestId,permission,'activity_registration',id);
  const row=await db.prepare(`SELECT r.*,a.audience,a.status AS activity_status,a.name AS activity_name
    FROM activity_registration r JOIN activity a ON a.id=r.activity_id WHERE r.id=?`).bind(id).first();
  if (!row || !covers(decision,row.registration_section_id)) {
    await deny(db,context,requestId,row?'OUT_OF_SCOPE':'NOT_FOUND','activity_registration',id);
    throw new AppError(404,'not_found');
  }
  return {row,decision,global:decision.sections===null};
}
// A registration is "in global review" while it is pending and escalated. It stays visible to the
// section, but only global reviewers act on it (REGISTRATIONS.md §12.2). Once resolved, the level is
// kept as history and no longer restricts the section.
const inGlobalReview=row=>row.review_level==='GLOBAL' && row.status==='NEEDS_PARTICIPANT_REVIEW';
async function requireActionable(db,context,requestId,resolved) {
  if (inGlobalReview(resolved.row) && !resolved.global) {
    await deny(db,context,requestId,'GLOBAL_REVIEW_REQUIRED','activity_registration',resolved.row.id);
    throw new AppError(403,'global_review_required');
  }
}
function requireVersion(input,row) {
  if (!Number.isSafeInteger(input?.expectedVersion) || input.expectedVersion<1) throw new AppError(400,'invalid_version');
  if (input.expectedVersion!==row.version) throw new AppError(409,'stale_registration');
}
async function staleOr(db,id,expected,error) {
  const now=await db.prepare('SELECT version FROM activity_registration WHERE id=?').bind(id).first();
  if (now && now.version!==expected) throw new AppError(409,'stale_registration');
  if (String(error?.message??'').includes('invalid_registration_transition')) throw new AppError(409,'invalid_transition');
  throw error;
}
const audit=(db,context,requestId,action,resourceType,resourceId,now,reasonCode=null)=>statement(db,{requestId,actorUserId:context.userId,
  sessionId:context.sessionId,action,resourceType,resourceId,reasonCode,occurredAt:now});

// Linked participant (§16): name and id only with participants.profile.read over that participant.
async function profileScope(db,context) { return authorize(db,context,{permission:'participants.profile.read',mode:'list'}); }
const linked=(profile,row)=>row.participant_id && row.participant_name!=null && profile.allow && covers(profile,row.participant_section_id)
  ?{participant:{id:row.participant_id,name:row.participant_name}}:{};

// ---------------------------------------------------------------- activity registrations list (tab)
const LIST_FILTERS={
  'per-revisar':"r.status='NEEDS_PARTICIPANT_REVIEW'",'pendents-pagament':"r.status='AWAITING_PAYMENT_REVIEW'",
  confirmades:"r.status='CONFIRMED'",rebutjades:"r.status='REJECTED'",retirades:"r.status='WITHDRAWN'"};
export async function listRegistrations(db,context,requestId,activityId,params) {
  const page=pageRequest(params,['number','string']);
  requireUuid(activityId);
  const decision=await capability(db,context,requestId,'activities.registration.review','activity',activityId);
  const activity=await db.prepare('SELECT id,audience FROM activity WHERE id=?').bind(activityId).first();
  const activitySections=activity?await audienceSections(db,activityId):[];
  if (!activity || (activity.audience==='SECTIONS' && decision.sections!==null &&
      !activitySections.some(sectionId=>decision.sections.includes(sectionId)))) {
    await deny(db,context,requestId,activity?'OUT_OF_SCOPE':'NOT_FOUND','activity',activityId);
    throw new AppError(404,'not_found');
  }
  const estat=params?.get('estat')??null;
  if (estat!==null && !(estat in LIST_FILTERS)) throw new AppError(400,'invalid_filter');
  const rows=await db.prepare(`SELECT r.id,r.submitted_name,r.registration_section_id,
    CASE WHEN r.submitted_section_id IS NOT r.registration_section_id THEN r.submitted_section_id END AS declared_section_id,
    r.participant_id,p.display_name AS participant_name,p.current_section_id AS participant_section_id,
    r.status,r.review_level,r.escalation_reason,r.transport_code,r.expected_amount_cents,r.created_at,r.reviewed_at,r.withdrawn_at,r.withdrawal_source,r.version,
    b.paid_cents,(SELECT count(*) FROM payment_evidence x WHERE x.registration_id=r.id AND x.review_status='ISSUE') AS open_issues
    FROM activity_registration r LEFT JOIN participant p ON p.id=r.participant_id
    JOIN activity_payment_balance b ON b.registration_id=r.id
    WHERE r.activity_id=?${sectionFilter(decision,'r.registration_section_id')}${estat?` AND ${LIST_FILTERS[estat]}`:''}
    ${page.after?'AND (r.created_at<? OR (r.created_at=? AND r.id<?))':''} ORDER BY r.created_at DESC,r.id DESC LIMIT ?`)
    .bind(activityId,...(decision.sections??[]),...(page.after?[page.after[0],page.after[0],page.after[1]]:[]),page.limit+1).all();
  const result=pageResult(rows.results,page.limit,row=>[row.created_at,row.id]);
  const profile=await profileScope(db,context);
  // The escalation reason is shown only to global reviewers; section reviewers see "en revisió global".
  const global=decision.sections===null;
  return {registrations:result.items.map(({participant_id:_p,participant_name:_n,participant_section_id:_s,escalation_reason:reason,...row})=>
    ({...row,payment_status:paymentState(row.expected_amount_cents,row.paid_cents,row.open_issues),...(global && row.review_level==='GLOBAL'?{escalation_reason:reason}:{}),
      ...linked(profile,{participant_id:_p,participant_name:_n,participant_section_id:_s})})),nextCursor:result.nextCursor};
}
// Confirmed list (§17): CONFIRMED only, operational fields, grouped client-side by section.
export async function confirmedList(db,context,requestId,activityId) {
  requireUuid(activityId);
  const decision=await capability(db,context,requestId,'activities.registration.review','activity',activityId);
  const activity=await db.prepare('SELECT id,audience FROM activity WHERE id=?').bind(activityId).first();
  const activitySections=activity?await audienceSections(db,activityId):[];
  if (!activity || (activity.audience==='SECTIONS' && decision.sections!==null &&
      !activitySections.some(sectionId=>decision.sections.includes(sectionId)))) {
    await deny(db,context,requestId,activity?'OUT_OF_SCOPE':'NOT_FOUND','activity',activityId);
    throw new AppError(404,'not_found');
  }
  const rows=(await db.prepare(`SELECT r.id,r.submitted_name,r.registration_section_id,r.transport_code,
    r.participant_id,p.display_name AS participant_name,p.current_section_id AS participant_section_id
    FROM activity_registration r LEFT JOIN participant p ON p.id=r.participant_id
    WHERE r.activity_id=? AND r.status='CONFIRMED'${sectionFilter(decision,'r.registration_section_id')} ORDER BY r.submitted_name,r.id`)
    .bind(activityId,...(decision.sections??[])).all()).results;
  const profile=await profileScope(db,context);
  return {confirmed:rows.map(row=>({id:row.id,name:linked(profile,row).participant?.name??row.submitted_name,
    ...linked(profile,row),registration_section_id:row.registration_section_id,transport_code:row.transport_code}))};
}

// ---------------------------------------------------------------- matching review
// Audit M4: reviewers get match signals, not the master data of every participant. The server
// compares the declared birth date; the full date is included only for candidates whose section
// the reviewer may read through participants.profile.read. Default list = plausible matches
// (shared name token or same birth date); anything else needs an explicit name search.
const CANDIDATE_LIMIT=20;
// Particles and fixture markers are too common to signal the same person.
const IGNORED_NAME_TOKENS=new Set(['de','del','la','les','el','els','los','las','i','y','da','dos',...synthetic.nameMarkers]);
const nameTokens=value=>matchKey(value||'').split(' ').filter(token=>token.length>1 && !IGNORED_NAME_TOKENS.has(token));
export async function matchCandidates(db,context,{submittedName,submittedBirthDate,sectionIds,search=null,registrationSectionId=null}) {
  if (sectionIds!==null && !sectionIds.length) return {candidates:[],truncated:false};
  if (search!==null && (typeof search!=='string' || search.trim().length<2 || search.length>80)) throw new AppError(400,'invalid_filter');
  const filter=sectionIds===null?'':` AND p.current_section_id IN (${sectionIds.map(()=>'?').join(',')})`;
  const people=(await db.prepare(`SELECT p.id,p.display_name,p.birth_date,p.current_section_id,s.code AS section_code
    FROM participant p JOIN section s ON s.id=p.current_section_id WHERE p.status='ACTIVE'${filter}
    ORDER BY p.display_name,p.id`).bind(...(sectionIds??[])).all()).results;
  const submittedTokens=new Set(nameTokens(submittedName));
  const query=search===null?null:matchKey(search);
  const profile=await authorize(db,context,{permission:'participants.profile.read',mode:'list'});
  const canSeeBirthDate=sectionId=>profile.allow && (profile.sections===null || profile.sections.includes(sectionId));
  const scored=people.map(person=>{
    const key=matchKey(person.display_name);
    return {person,key,nameMatches:nameTokens(person.display_name).some(token=>submittedTokens.has(token)),
      birthDateMatches:!!submittedBirthDate && person.birth_date===submittedBirthDate};
  }).filter(row=>query!==null?row.key.includes(query):row.nameMatches||row.birthDateMatches)
    .sort((a,b)=>(Number(b.nameMatches)+Number(b.birthDateMatches))-(Number(a.nameMatches)+Number(a.birthDateMatches)));
  return {truncated:scored.length>CANDIDATE_LIMIT,candidates:scored.slice(0,CANDIDATE_LIMIT).map(row=>({
    id:row.person.id,display_name:row.person.display_name,section_code:row.person.section_code,
    name_matches:row.nameMatches,birth_date_matches:row.birthDateMatches,
    ...(registrationSectionId?{section_matches:row.person.current_section_id===registrationSectionId}:{}),
    ...(canSeeBirthDate(row.person.current_section_id)?{birth_date:row.person.birth_date}:{})}))};
}
export async function reviewCandidates(db,context,requestId,id,search=null) {
  const resolved=await resolveRegistration(db,context,requestId,id,'activities.registration.review');
  const {row,decision}=resolved;
  if (row.status!=='NEEDS_PARTICIPANT_REVIEW') throw new AppError(409,'invalid_transition');
  await requireActionable(db,context,requestId,resolved);
  const allowed=row.audience==='GENERAL'?[]:await audienceSections(db,row.activity_id);
  const scoped=decision.sections===null?(allowed.length?allowed:null)
    :allowed.length?allowed.filter(sectionId=>decision.sections.includes(sectionId)):decision.sections;
  const result=await matchCandidates(db,context,{submittedName:row.submitted_name,submittedBirthDate:row.submitted_birth_date,
    sectionIds:scoped,search,registrationSectionId:row.registration_section_id});
  // The declared birth date travels only here, only while pending (never in the list).
  return {...result,declared:{birthDate:row.submitted_birth_date}};
}
export async function reviewMatch(db,context,requestId,id,input,now=Date.now()) {
  const resolved=await resolveRegistration(db,context,requestId,id,'activities.registration.review');
  const {row,decision}=resolved;
  if (!input || !['MATCH','REJECT'].includes(input.decision) ||
      Object.keys(input).some(key=>!['decision','participantId','expectedVersion'].includes(key)) ||
      (input.decision==='REJECT' && input.participantId!=null)) throw new AppError(400,'invalid_review');
  if (row.status!=='NEEDS_PARTICIPANT_REVIEW') throw new AppError(409,'invalid_transition');
  await requireActionable(db,context,requestId,resolved);
  // 3.5F closure: the version is mandatory, as for every other registration write.
  requireVersion(input,row);
  const expected=row.version;
  let participant=null;
  if (input.decision==='MATCH') {
    requireUuid(input.participantId);
    participant=await db.prepare('SELECT id,current_section_id FROM participant WHERE id=? AND status=?').bind(input.participantId,'ACTIVE').first();
    // A participant outside the reviewer's scope is indistinguishable from a missing one.
    if (!participant || !covers(decision,participant.current_section_id)) {
      await deny(db,context,requestId,participant?'OUT_OF_SCOPE':'NOT_FOUND','participant',input.participantId);
      throw new AppError(404,'not_found');
    }
    const eligible=row.audience==='GENERAL' || !!await db.prepare('SELECT 1 FROM activity_section WHERE activity_id=? AND section_id=?')
      .bind(row.activity_id,participant.current_section_id).first();
    if (!eligible) throw new AppError(409,'section_not_in_audience');
    // Linking needs the registration section to be the participant's current section (correct it first).
    if (row.registration_section_id!==participant.current_section_id) throw new AppError(409,'section_mismatch');
  }
  const next=input.decision==='REJECT'?'REJECTED':row.expected_amount_cents===0?'CONFIRMED':'AWAITING_PAYMENT_REVIEW';
  const notify=[];
  if (participant) {
    if (next==='CONFIRMED') notify.push(['CONFIRMED',row.receipt_email]);
    if (next==='AWAITING_PAYMENT_REVIEW') notify.push(['PENDING_PAYMENT',row.receipt_email]);
  } else notify.push(['REJECTED',row.receipt_email]);
  try {
    await db.batch([
      db.prepare(`UPDATE activity_registration SET ${versionCas('version')},participant_id=?,match_status=?,status=?,submitted_birth_date=NULL,
        reviewed_by=?,reviewed_at=?,updated_at=? WHERE id=?`)
        .bind(expected,participant?.id??null,participant?'RESOLVED':'REJECTED',next,context.userId,now,now,id),
      audit(db,context,requestId,participant?'REGISTRATION_MATCH_RESOLVED':'REGISTRATION_REJECTED','activity_registration',id,now),
      ...(next==='CONFIRMED'?[audit(db,context,requestId,'REGISTRATION_CONFIRMED','activity_registration',id,now)]:[]),
      ...notificationStatements(db,id,notify,now,requestId,context)
    ]);
  } catch (error) {
    if (String(error?.message??'').includes('UNIQUE') && participant) throw new AppError(409,'already_registered');
    await staleOr(db,id,expected,error);
  }
  return {id,status:next};
}

// ---------------------------------------------------------------- escalation and section correction
export async function escalateRegistration(db,context,requestId,id,input,now=Date.now()) {
  const resolved=await resolveRegistration(db,context,requestId,id,'activities.registration.review');
  const {row}=resolved;
  if (!input || Object.keys(input).some(key=>key!=='expectedVersion')) throw new AppError(400,'invalid_review');
  if (row.status!=='NEEDS_PARTICIPANT_REVIEW' || row.review_level==='GLOBAL') throw new AppError(409,'invalid_transition');
  requireVersion(input,row);
  try {
    await db.batch([
      db.prepare(`UPDATE activity_registration SET ${versionCas('version')},review_level='GLOBAL',escalation_reason='REVIEWER_REQUEST',
        escalated_at=?,escalated_by=?,updated_at=? WHERE id=?`).bind(row.version,now,context.userId,now,id),
      audit(db,context,requestId,'REGISTRATION_ESCALATED','activity_registration',id,now,'REVIEWER_REQUEST')
    ]);
  } catch (error) { await staleOr(db,id,row.version,error); }
  return {id,reviewLevel:'GLOBAL'};
}
export async function correctSection(db,context,requestId,id,input,now=Date.now()) {
  const resolved=await resolveRegistration(db,context,requestId,id,'activities.registration.review');
  const {row,decision,global}=resolved;
  if (!input || Object.keys(input).some(key=>!['sectionId','expectedVersion'].includes(key))) throw new AppError(400,'invalid_section');
  requireUuid(input.sectionId);
  if (!await db.prepare('SELECT 1 FROM section WHERE id=?').bind(input.sectionId).first()) throw new AppError(400,'invalid_section');
  if (row.status!=='NEEDS_PARTICIPANT_REVIEW') throw new AppError(409,'invalid_transition');
  await requireActionable(db,context,requestId,resolved);
  // Global reviewers, or authority over both the current registration section and the target.
  if (!global && !covers(decision,input.sectionId)) {
    await deny(db,context,requestId,'OUT_OF_SCOPE','activity_registration',id);
    throw new AppError(403,'forbidden');
  }
  requireVersion(input,row);
  if (input.sectionId===row.registration_section_id) throw new AppError(409,'invalid_transition');
  if (row.audience==='SECTIONS' && !(await audienceSections(db,row.activity_id)).includes(input.sectionId))
    throw new AppError(409,'section_not_in_audience');
  try {
    await db.batch([
      db.prepare(`UPDATE activity_registration SET ${versionCas('version')},registration_section_id=?,review_level='SECTION',updated_at=? WHERE id=?`)
        .bind(row.version,input.sectionId,now,id),
      db.prepare(`INSERT INTO activity_registration_section_change(id,registration_id,from_section_id,to_section_id,reason,changed_by,changed_at)
        VALUES(?,?,?,?,'CORRECTION',?,?)`).bind(crypto.randomUUID(),id,row.registration_section_id,input.sectionId,context.userId,now),
      audit(db,context,requestId,'REGISTRATION_SECTION_CORRECTED','activity_registration',id,now,'CORRECTION')
    ]);
  } catch (error) { await staleOr(db,id,row.version,error); }
  return {id,registrationSectionId:input.sectionId};
}

// ---------------------------------------------------------------- withdrawal
const WITHDRAWABLE=new Set(['NEEDS_PARTICIPANT_REVIEW','AWAITING_PAYMENT_REVIEW','CONFIRMED']);
export async function withdrawRegistration(db,context,requestId,id,input,now=Date.now()) {
  const resolved=await resolveRegistration(db,context,requestId,id,'activities.registration.review');
  const {row}=resolved;
  if (!input || Object.keys(input).some(key=>!['source','notifyFamily','expectedVersion'].includes(key)) ||
      !['FAMILY_COMMUNICATION','OTHER'].includes(input.source) ||
      (input.notifyFamily!=null && typeof input.notifyFamily!=='boolean')) throw new AppError(400,'invalid_withdrawal');
  if (!WITHDRAWABLE.has(row.status)) throw new AppError(409,'invalid_transition');
  await requireActionable(db,context,requestId,resolved);
  requireVersion(input,row);
  // Default: confirm to the family when they communicated it; never for "other".
  const notify=input.notifyFamily??input.source==='FAMILY_COMMUNICATION';
  try {
    await db.batch([
      db.prepare(`UPDATE activity_registration SET ${versionCas('version')},status='WITHDRAWN',withdrawn_at=?,withdrawn_by=?,
        withdrawal_source=?,submitted_birth_date=NULL,updated_at=? WHERE id=?`).bind(row.version,now,context.userId,input.source,now,id),
      audit(db,context,requestId,'REGISTRATION_WITHDRAWN','activity_registration',id,now,input.source),
      ...(notify?notificationStatements(db,id,[['WITHDRAWN',row.receipt_email]],now,requestId,context):[])
    ]);
  } catch (error) { await staleOr(db,id,row.version,error); }
  return {id,status:'WITHDRAWN'};
}

// ---------------------------------------------------------------- submitter contact on demand (§11)
export async function registrationContact(db,context,requestId,id) {
  const {row}=await resolveRegistration(db,context,requestId,id,'activities.registration.contact.read');
  // Decision Borja/Atlas (3.5F closure): while a registration is in global review, only global
  // reviewers may reveal the submitter's contact, even if a section reviewer holds the contact permission.
  if (inGlobalReview(row)) {
    const review=await authorize(db,context,{permission:'activities.registration.review',mode:'list'});
    if (!review.allow || review.sections!==null) {
      await deny(db,context,requestId,'GLOBAL_REVIEW_REQUIRED','activity_registration',id);
      throw new AppError(403,'global_review_required');
    }
  }
  await append(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,action:'SENSITIVE_DATA_READ',
    resourceType:'activity_registration',resourceId:id,result:'SUCCESS',reasonCode:'REGISTRATION_CONTACT_CONSULTED'});
  return {submittedByName:row.submitted_by_name||null,phone:row.contact_phone??null,email:row.receipt_email};
}

// ---------------------------------------------------------------- global queue (§6)
const SCOUT_YEAR_START_MONTH=8; // September (0-based)
const VIEWS=new Set(['pendents','incidencies','totes']);
export async function registrationQueue(db,context,requestId,params) {
  const vista=params?.get('vista')??'pendents';
  if (!VIEWS.has(vista)) throw new AppError(400,'invalid_filter');
  const review=await authorize(db,context,{permission:'activities.registration.review',mode:'list'});
  const verify=await authorize(db,context,{permission:'finance.payment.verify',mode:'list'});
  if (!review.allow && !verify.allow) { await deny(db,context,requestId,review.reason,'activity_registration',null); throw new AppError(403,'forbidden'); }
  if (!review.allow || vista==='incidencies') return {activities:[],reviewer:!!review.allow,globalReviewer:review.allow && review.sections===null};
  const global=review.sections===null;
  const pendingAtLevel=global?"r.status='NEEDS_PARTICIPANT_REVIEW'":"r.status='NEEDS_PARTICIPANT_REVIEW' AND r.review_level='SECTION'";
  const rows=(await db.prepare(`SELECT a.id,a.name,a.status,a.audience,a.starts_at,a.registration_deadline,
    (SELECT group_concat(x.section_id) FROM activity_section x WHERE x.activity_id=a.id) AS section_ids,
    group_concat(DISTINCT r.registration_section_id) AS seen_sections,
    count(*) AS total,sum(${pendingAtLevel}) AS actionable,
    sum(r.status='NEEDS_PARTICIPANT_REVIEW' AND r.review_level='GLOBAL') AS escalated,
    sum(r.status='AWAITING_PAYMENT_REVIEW') AS awaiting_payment,sum(r.status='CONFIRMED') AS confirmed,
    sum(r.status='REJECTED') AS rejected,sum(r.status='WITHDRAWN') AS withdrawn
    FROM activity_registration r JOIN activity a ON a.id=r.activity_id
    WHERE a.status IN ('PUBLISHED','CLOSED')${sectionFilter(review,'r.registration_section_id')}
    GROUP BY a.id ${vista==='pendents'?'HAVING sum(r.status=\'NEEDS_PARTICIPANT_REVIEW\')>0':''}
    ORDER BY CASE WHEN a.registration_deadline>=? THEN 0 ELSE 1 END,a.registration_deadline,a.starts_at,a.id`)
    .bind(...(review.sections??[]),Date.now()).all()).results;
  const codes=new Map((await db.prepare('SELECT id,code FROM section').all()).results.map(row=>[row.id,row.code]));
  const yearStart=(()=>{ const d=new Date(); const y=d.getUTCMonth()>=SCOUT_YEAR_START_MONTH?d.getUTCFullYear():d.getUTCFullYear()-1; return Date.UTC(y,SCOUT_YEAR_START_MONTH,1); })();
  return {reviewer:true,globalReviewer:global,activities:rows.map(row=>{
    const sectionIds=row.section_ids?row.section_ids.split(','):[];
    const partial=!global && (row.audience==='GENERAL' || sectionIds.some(sectionId=>!review.sections.includes(sectionId)));
    return {id:row.id,name:row.name,status:row.status,startsAt:row.starts_at,registrationDeadline:row.registration_deadline,
      previous:row.status==='CLOSED' && row.starts_at<yearStart,
      scope:partial?'PARTIAL':'ALL',sections:partial?review.sections.filter(id=>row.audience==='GENERAL' || sectionIds.includes(id)).map(id=>codes.get(id)):[],
      counts:{actionable:row.actionable??0,escalated:row.escalated??0,awaitingPayment:row.awaiting_payment??0,confirmed:row.confirmed??0,
        rejected:row.rejected??0,withdrawn:row.withdrawn??0,total:row.total}};
  })};
}
// Counts for the navigation badge and the Dashboard (numbers only).
export async function queueSummary(db,context,requestId) {
  const review=await authorize(db,context,{permission:'activities.registration.review',mode:'list'});
  const verify=await authorize(db,context,{permission:'finance.payment.verify',mode:'list'});
  if (!review.allow && !verify.allow) { await deny(db,context,requestId,review.reason,'activity_registration',null); throw new AppError(403,'forbidden'); }
  let registrations=null,payments=null;
  if (review.allow) {
    const row=await db.prepare(`SELECT sum(r.review_level='SECTION') AS pending,sum(r.review_level='GLOBAL') AS escalated
      FROM activity_registration r JOIN activity a ON a.id=r.activity_id WHERE r.status='NEEDS_PARTICIPANT_REVIEW'
      AND a.status IN ('PUBLISHED','CLOSED')${sectionFilter(review,'r.registration_section_id')}`).bind(...(review.sections??[])).first();
    const pending=row?.pending??0,escalated=row?.escalated??0;
    registrations={pending,escalated,actionable:review.sections===null?pending+escalated:pending};
  }
  if (verify.allow) {
    // pending = proofs nobody has verified yet; partial = waiting for further instalments (not in the
    // badge); issues = open incidences on obligations not yet fully paid.
    // pending = attempts nobody has reviewed yet; issues = open incidences (per attempt); partial =
    // obligations partly paid, waiting for further instalments (not in the badge).
    const scope=sectionFilter(verify,'r.registration_section_id');
    const attempts=await db.prepare(`SELECT sum(e.review_status='PENDING_REVIEW') AS pending,sum(e.review_status='ISSUE') AS issues
      FROM payment_evidence e JOIN activity_registration r ON r.id=e.registration_id
      WHERE r.status IN ('AWAITING_PAYMENT_REVIEW','WITHDRAWN')${scope}`).bind(...(verify.sections??[])).first();
    const partial=await db.prepare(`SELECT count(*) AS n FROM activity_registration r JOIN activity_payment_balance b ON b.registration_id=r.id
      WHERE r.status IN ('AWAITING_PAYMENT_REVIEW','WITHDRAWN') AND b.paid_cents>0 AND b.paid_cents<b.due_cents${scope}`)
      .bind(...(verify.sections??[])).first();
    payments={pending:attempts?.pending??0,partial:partial?.n??0,issues:attempts?.issues??0};
  }
  return {registrations,payments,badge:(registrations?.actionable??0)+(payments?.pending??0)+(payments?.issues??0)};
}

// ---------------------------------------------------------------- payment projection (§14) until 3.5G
// Purpose-limited: what a verifier needs to decide, nothing that reads or manages Activitats.
// Payment state of the obligation (§9.2): derived only from verified allocations. Incidences belong to
// attempts and are reported next to it (openIssues): PARTIAL with open incidences is a valid state.
// ISSUE is shown only while nothing has been verified and an incidence is open.
export function paymentState(dueCents,paidCents,openIssues=0) {
  if (dueCents<=0) return 'NOT_REQUIRED';
  if (paidCents>=dueCents) return 'PAID';
  if (paidCents>0) return 'PARTIAL';
  return openIssues>0?'ISSUE':'PENDING';
}
const PAYMENT_VIEWS={pendents:"(e.review_status='PENDING_REVIEW' OR (e.review_status='VERIFIED' AND b.paid_cents<b.due_cents))",
  incidencies:"e.review_status='ISSUE'",totes:'1=1'};
const PAYMENT_SELECT=`SELECT e.id,e.review_status,e.detected_mime,e.size_bytes,e.created_at AS received_at,e.reviewed_at,e.object_purged_at,
  r.id AS registration_id,r.status AS registration_status,r.version AS registration_version,b.paid_cents,
  (SELECT count(*) FROM payment_evidence x WHERE x.registration_id=r.id AND x.review_status='ISSUE') AS open_issues,
  (SELECT count(*) FROM payment_evidence x WHERE x.registration_id=r.id) AS attempts,
  (SELECT COALESCE(SUM(v.amount_cents),0) FROM activity_payment_allocation v WHERE v.evidence_id=e.id) AS evidence_verified_cents,
  r.submitted_name,r.expected_amount_cents,r.transport_code,
  r.registration_section_id,r.participant_id,p.display_name AS participant_name,p.current_section_id AS participant_section_id,
  r.created_at,a.id AS activity_id,a.name AS activity_name,a.starts_at AS activity_starts_at,a.audience,
  EXISTS(SELECT 1 FROM activity_transport_option t WHERE t.activity_id=a.id) AS has_transport,s.code AS section_code
  FROM payment_evidence e JOIN activity_registration r ON r.id=e.registration_id JOIN activity a ON a.id=r.activity_id
  JOIN activity_payment_balance b ON b.registration_id=r.id
  LEFT JOIN participant p ON p.id=r.participant_id LEFT JOIN section s ON s.id=r.registration_section_id`;
function paymentRow(profile,row) {
  return {id:row.id,registrationId:row.registration_id,
    activity:{id:row.activity_id,name:row.activity_name,startsAt:row.activity_starts_at},
    submittedName:row.submitted_name,...linked(profile,row),amountCents:row.expected_amount_cents,
    paidCents:row.paid_cents,remainingCents:Math.max(0,row.expected_amount_cents-row.paid_cents),
    ...(row.has_transport?{transport:row.transport_code}:{}),...(row.audience==='GENERAL'?{section:row.section_code}:{}),
    registrationState:row.registration_status,registrationVersion:row.registration_version,
    paymentState:paymentState(row.expected_amount_cents,row.paid_cents,row.open_issues),openIssues:row.open_issues,attempts:row.attempts,
    evidenceStatus:row.review_status,evidenceVerifiedCents:row.evidence_verified_cents,
    evidence:{mime:row.detected_mime,sizeBytes:row.size_bytes,receivedAt:row.received_at,available:row.object_purged_at==null},
    reviewedAt:row.reviewed_at};
}
export async function listPayments(db,context,requestId,params) {
  const page=pageRequest(params,['number','string']);
  const decision=await capability(db,context,requestId,'finance.payment.verify','payment_evidence',null);
  const vista=params?.get('vista')??'pendents';
  if (!(vista in PAYMENT_VIEWS)) throw new AppError(400,'invalid_filter');
  const activityId=params?.get('activityId')??null;
  if (activityId!==null) requireUuid(activityId);
  // Only registrations where payment is still meaningful: awaiting review, withdrawn (money may have
  // arrived) or confirmed (verified history in "totes").
  const states=vista==='totes'?"('AWAITING_PAYMENT_REVIEW','WITHDRAWN','CONFIRMED')":"('AWAITING_PAYMENT_REVIEW','WITHDRAWN')";
  const rows=await db.prepare(`${PAYMENT_SELECT} WHERE r.status IN ${states} AND ${PAYMENT_VIEWS[vista]}
    ${activityId?'AND r.activity_id=?':''}${sectionFilter(decision,'r.registration_section_id')}
    ${page.after?'AND (r.created_at<? OR (r.created_at=? AND e.id<?))':''} ORDER BY r.created_at DESC,e.id DESC LIMIT ?`)
    .bind(...(activityId?[activityId]:[]),...(decision.sections??[]),...(page.after?[page.after[0],page.after[0],page.after[1]]:[]),page.limit+1).all();
  const result=pageResult(rows.results,page.limit,row=>[row.created_at,row.id]);
  const profile=await profileScope(db,context);
  return {payments:result.items.map(row=>paymentRow(profile,row)),nextCursor:result.nextCursor};
}
async function resolvePayment(db,context,requestId,id) {
  requireUuid(id);
  const decision=await capability(db,context,requestId,'finance.payment.verify','payment_evidence',id);
  const row=await db.prepare(`${PAYMENT_SELECT} WHERE e.id=?`).bind(id).first();
  if (!row || !covers(decision,row.registration_section_id)) {
    await deny(db,context,requestId,row?'OUT_OF_SCOPE':'NOT_FOUND','payment_evidence',id);
    throw new AppError(404,'not_found');
  }
  return row;
}
export async function paymentDetail(db,context,requestId,id) {
  const row=await resolvePayment(db,context,requestId,id);
  // Verified instalments: amount and date only (who verified stays in the audit trail).
  const allocations=(await db.prepare(`SELECT amount_cents,created_at,evidence_id FROM activity_payment_allocation WHERE registration_id=?
    ORDER BY created_at,id`).bind(row.registration_id).all()).results.map(a=>({amountCents:a.amount_cents,verifiedAt:a.created_at,
      evidenceId:a.evidence_id,thisAttempt:a.evidence_id===id}));
  return {payment:{...paymentRow(await profileScope(db,context),row),allocations}};
}
const EXTENSIONS={'application/pdf':'pdf','image/png':'png','image/jpeg':'jpg','image/webp':'webp'};
export async function evidenceDownload(db,storage,context,requestId,id,mode='download') {
  if (!['view','download'].includes(mode)) throw new AppError(400,'invalid_filter');
  const row=await resolvePayment(db,context,requestId,id);
  if (row.object_purged_at!=null) throw new AppError(410,'evidence_purged');
  const evidence=await db.prepare('SELECT object_key FROM payment_evidence WHERE id=?').bind(id).first();
  const extension=EXTENSIONS[row.detected_mime];
  if (!extension) throw new AppError(500,'invalid_evidence');
  const response=await readEvidence(storage,evidence.object_key,{mime:row.detected_mime,mode,
    filename:`justificant-${new Date(row.received_at).toISOString().slice(0,10)}.${extension}`});
  await append(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,
    action:mode==='view'?'PAYMENT_EVIDENCE_VIEWED':'PAYMENT_EVIDENCE_DOWNLOADED',resourceType:'payment_evidence',resourceId:id,result:'SUCCESS'});
  return response;
}
// Verify an amount (one instalment) or open an incidence. Instalments accumulate as allocations and are
// never overwritten; the registration is confirmed only when the obligation is covered.
export async function reviewPayment(db,context,requestId,id,input,now=Date.now()) {
  const row=await resolvePayment(db,context,requestId,id);
  if (!input || typeof input!=='object' || Object.keys(input).some(key=>!['decision','amountCents','expectedVersion'].includes(key)) ||
      !['VERIFIED','ISSUE'].includes(input.decision) || (input.decision==='ISSUE' && input.amountCents!=null)) throw new AppError(400,'invalid_review');
  const remaining=row.expected_amount_cents-row.paid_cents;
  // Per attempt: verify while something remains; flag an attempt that is not already flagged (a verified
  // attempt only while something remains). Verifying one attempt never closes another attempt's incidence.
  if (!['AWAITING_PAYMENT_REVIEW','WITHDRAWN'].includes(row.registration_status) ||
      (input.decision==='VERIFIED' && remaining<=0) ||
      (input.decision==='ISSUE' && (row.review_status==='ISSUE' || (row.review_status==='VERIFIED' && remaining<=0))))
    throw new AppError(409,'invalid_transition');
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion<1) throw new AppError(400,'invalid_version');
  if (input.expectedVersion!==row.registration_version) throw new AppError(409,'stale_payment');
  if (input.decision==='VERIFIED' && (!Number.isSafeInteger(input.amountCents) || input.amountCents<1 || input.amountCents>remaining))
    throw new AppError(400,'invalid_amount');
  const reg=await db.prepare('SELECT receipt_email FROM activity_registration WHERE id=?').bind(row.registration_id).first();
  const verified=input.decision==='VERIFIED';
  const completes=verified && input.amountCents===remaining;
  // A withdrawn registration stays withdrawn: payments are recorded, the family is not notified,
  // and nothing implies a refund (3.5G).
  const confirms=completes && row.registration_status==='AWAITING_PAYMENT_REVIEW';
  const withdrawn=row.registration_status==='WITHDRAWN';
  const allocationId=crypto.randomUUID();
  // Notices are once per kind (outbox): a later incidence after one already notified is recorded but not re-sent.
  const issueNotified=!verified && !!await db.prepare("SELECT 1 FROM notification_outbox WHERE registration_id=? AND kind='PAYMENT_ISSUE'").bind(row.registration_id).first();
  const notice=withdrawn?null:confirms?'CONFIRMED':!verified && !issueNotified?'PAYMENT_ISSUE':null;
  try {
    await db.batch([
      // Compare-and-set first: two verifiers acting on the same obligation never both succeed.
      db.prepare(`UPDATE activity_registration SET ${versionCas('version')},updated_at=? WHERE id=?`).bind(input.expectedVersion,now,row.registration_id),
      // Evidence first: the database only allows a further verification while something remains unpaid.
      db.prepare('UPDATE payment_evidence SET review_status=?,reviewed_by=?,reviewed_at=? WHERE id=?').bind(input.decision,context.userId,now,id),
      ...(verified?[db.prepare(`INSERT INTO activity_payment_allocation(id,registration_id,evidence_id,amount_cents,source,created_by,created_at)
        VALUES(?,?,?,?,'VERIFICATION',?,?)`).bind(allocationId,row.registration_id,id,input.amountCents,context.userId,now)]:[]),
      ...(confirms?[db.prepare(`UPDATE activity_registration SET status='CONFIRMED',updated_at=? WHERE id=? AND status='AWAITING_PAYMENT_REVIEW'`)
        .bind(now,row.registration_id)]:[]),
      audit(db,context,requestId,verified?'PAYMENT_VERIFIED':'PAYMENT_ISSUE','payment_evidence',id,now,verified?(completes?'PAID':'PARTIAL'):null),
      ...(verified?[audit(db,context,requestId,'DATA_CREATED','activity_payment_allocation',allocationId,now,'PAYMENT_ALLOCATION')]:[]),
      ...(confirms?[audit(db,context,requestId,'REGISTRATION_CONFIRMED','activity_registration',row.registration_id,now)]:[]),
      ...(notice?notificationStatements(db,row.registration_id,[[notice,reg.receipt_email]],now,requestId,context):[])
    ]);
  } catch (error) {
    const message=String(error?.message??'');
    const current=await db.prepare('SELECT version FROM activity_registration WHERE id=?').bind(row.registration_id).first();
    if (current && current.version!==input.expectedVersion) throw new AppError(409,'stale_payment');
    if (message.includes('invalid_payment_transition') || message.includes('invalid_payment_allocation')) throw new AppError(409,'invalid_transition');
    throw error;
  }
  const paid=row.paid_cents+(verified?input.amountCents:0);
  const openIssues=row.open_issues-(verified && row.review_status==='ISSUE'?1:0)+(verified?0:1);
  return {id,status:input.decision,paymentState:paymentState(row.expected_amount_cents,paid,openIssues),openIssues,
    paidCents:paid,remainingCents:row.expected_amount_cents-paid};
}

// ---------------------------------------------------------------- retention-ready (§15.6), not scheduled
// Deletes the R2 object of a VERIFIED evidence and records it; the row and its history stay. No job
// calls this until a retention period is approved.
export async function purgeVerifiedEvidence(db,storage,requestId,id,now=Date.now()) {
  requireUuid(id);
  const row=await db.prepare(`SELECT e.object_key,e.review_status,e.object_purged_at,b.paid_cents,b.due_cents FROM payment_evidence e
    JOIN activity_payment_balance b ON b.registration_id=e.registration_id WHERE e.id=?`).bind(id).first();
  if (!row) throw new AppError(404,'not_found');
  // Only proofs of obligations fully paid (and verified) can lose their file.
  if (row.review_status!=='VERIFIED' || row.paid_cents<row.due_cents || row.object_purged_at!=null) throw new AppError(409,'invalid_transition');
  if (!storage?.delete) throw new AppError(503,'evidence_storage_unavailable');
  await storage.delete(row.object_key);
  await db.batch([
    db.prepare("UPDATE payment_evidence SET object_purged_at=?,object_purge_reason='RETENTION_POLICY' WHERE id=? AND object_purged_at IS NULL").bind(now,id),
    statement(db,{requestId,action:'PAYMENT_EVIDENCE_PURGED',resourceType:'payment_evidence',resourceId:id,reasonCode:'RETENTION_POLICY',
      metadata:{source:'retention-job'},occurredAt:now})
  ]);
  return {id,purged:true};
}
