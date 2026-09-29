import { statement } from '../domains/audit/repository.js';
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
      input.participationTermsVersion!=='DEMO-3A-PARTICIPATION-V1' ||
      input.privacyNoticeVersion!=='DEMO-3A-PRIVACY-NOTICE-V1') throw new AppError(400,'invalid_registration');
}
export async function findMatch(db,name,birthDate,sectionId,allowedSections) {
  const rows=(await db.prepare('SELECT id,display_name,current_section_id,birth_date FROM participant WHERE status=? ORDER BY id LIMIT 1001')
    .bind('ACTIVE').all()).results;
  if (rows.length>1000) return {status:'AMBIGUOUS',participant:null}; // fail closed until indexed matching exists
  const sameIdentity=rows.filter(row=>matchKey(row.display_name)===name && (!sectionId || row.current_section_id===sectionId) &&
    (!allowedSections.length || allowedSections.includes(row.current_section_id)));
  const candidates=sameIdentity.filter(row=>row.birth_date===birthDate);
  if (candidates.length===1) return {status:'CLEAR',participant:candidates[0]};
  if (candidates.length>1 || sameIdentity.length) return {status:'AMBIGUOUS',participant:null};
  return {status:'NONE',participant:null};
}
function notificationStatements(db,registrationId,items,now,requestId) {
  const result=[];
  for (const [kind,email] of items) {
    const queued=queueStatement(db,registrationId,kind,email,now);
    result.push(queued.statement,statement(db,{requestId,action:'NOTIFICATION_QUEUED',resourceType:'notification_outbox',
      resourceId:queued.id,occurredAt:now}));
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
  const duplicate=matched.participant
    ?await db.prepare("SELECT id FROM activity_registration WHERE activity_id=? AND participant_id=? AND status!='REJECTED'")
      .bind(activity.id,matched.participant.id).first()
    :await db.prepare(`SELECT id FROM activity_registration WHERE activity_id=? AND match_key=? AND COALESCE(submitted_section_id,'')=?
      AND submitted_birth_date=? AND participant_id IS NULL AND status='NEEDS_PARTICIPANT_REVIEW'`)
      .bind(activity.id,key,sectionId??'',input.birthDate).first();
  if (duplicate) return {ok:true};
  const id=crypto.randomUUID(),evidenceId=crypto.randomUUID(),objectKey=evidence?evidenceKey():null;
  const status=matched.status==='CLEAR'?(amount===0?'CONFIRMED':'AWAITING_PAYMENT_REVIEW'):'NEEDS_PARTICIPANT_REVIEW';
  const notifications=[['RECEIVED',input.receiptEmail.toLowerCase()]];
  if (matched.status==='CLEAR') {
    if (status==='CONFIRMED') notifications.push(['CONFIRMED',input.receiptEmail.toLowerCase()]);
    if (status==='AWAITING_PAYMENT_REVIEW') notifications.push(['PENDING_PAYMENT',input.receiptEmail.toLowerCase()]);
  }
  if (evidence) await storeEvidence(storage,objectKey,evidence);
  try {
    await db.batch([
      db.prepare(`INSERT INTO activity_registration(id,activity_id,participant_id,submitted_name,match_key,submitted_section_id,receipt_email,
        submitted_by_name,contact_phone,submitted_birth_date,
        transport_code,expected_amount_cents,match_status,status,consent_version,
        participation_terms_version,participation_authorized_at,privacy_notice_version,privacy_notice_acknowledged_at,
        idempotency_key,payload_sha256,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,activity.id,matched.participant?.id??null,input.participantName.trim(),key,
        sectionId,input.receiptEmail.toLowerCase(),input.submittedByName.trim(),input.contactPhone?.trim()||null,
        matched.status==='CLEAR'?null:input.birthDate,input.transportCode??null,amount,matched.status,status,'DEPRECATED',
        input.participationTermsVersion,now,input.privacyNoticeVersion,now,input.idempotencyKey,payloadHash,now,now),
      ...(evidence?[db.prepare(`INSERT INTO payment_evidence(id,registration_id,object_key,sha256,size_bytes,detected_mime,review_status,created_at)
        VALUES(?,?,?,?,?,?,'PENDING_REVIEW',?)`).bind(evidenceId,id,objectKey,evidence.sha256,evidence.bytes.length,evidence.mime,now)]:[]),
      statement(db,{requestId,action:'REGISTRATION_RECEIVED',resourceType:'activity_registration',resourceId:id,occurredAt:now}),
      statement(db,{requestId,action:matched.status==='CLEAR'?'REGISTRATION_MATCHED':'REGISTRATION_MATCH_REVIEW_REQUIRED',
        resourceType:'activity_registration',resourceId:id,occurredAt:now}),
      ...(status==='CONFIRMED'?[statement(db,{requestId,action:'REGISTRATION_CONFIRMED',resourceType:'activity_registration',resourceId:id,occurredAt:now})]:[]),
      ...(evidence?[statement(db,{requestId,action:'PAYMENT_EVIDENCE_RECEIVED',resourceType:'payment_evidence',resourceId:evidenceId,occurredAt:now})]:[]),
      ...notificationStatements(db,id,notifications,now,requestId)
    ]);
  } catch(error) {
    if (objectKey) await storage.delete(objectKey).catch(()=>{});
    if (await existingIdempotency(db,input.idempotencyKey,payloadHash,input.birthDate)) return {ok:true};
    const raced=matched.participant
      ?await db.prepare("SELECT 1 FROM activity_registration WHERE activity_id=? AND participant_id=? AND status!='REJECTED'")
        .bind(activity.id,matched.participant.id).first()
      :await db.prepare(`SELECT 1 FROM activity_registration WHERE activity_id=? AND match_key=? AND COALESCE(submitted_section_id,'')=?
        AND submitted_birth_date=? AND participant_id IS NULL AND status='NEEDS_PARTICIPANT_REVIEW'`)
        .bind(activity.id,key,sectionId??'',input.birthDate).first();
    if (raced) return {ok:true};
    throw error;
  }
  return {ok:true}; // identical external shape for clear, ambiguous and no match
}

async function registration(db,id) {
  requireUuid(id);
  const row=await db.prepare(`SELECT r.*,a.audience,a.status AS activity_status,a.name AS activity_name
    FROM activity_registration r JOIN activity a ON a.id=r.activity_id WHERE r.id=?`).bind(id).first();
  if (!row) throw new AppError(404,'not_found');
  return row;
}
// A registration without a known section can only be reviewed with group-wide authority.
async function reviewDecision(db,context,requestId,row,permission,sectionId=row.submitted_section_id) {
  return requirePermission(db,context,requestId,permission,
    {...(sectionId?{sectionId}:{mode:'all-sections'}),resourceType:'activity_registration',resourceId:row.id});
}
export async function listRegistrations(db,context,requestId,activityId) {
  requireUuid(activityId);
  const activity=await db.prepare('SELECT id,audience FROM activity WHERE id=?').bind(activityId).first();
  if (!activity) throw new AppError(404,'not_found');
  const decision=await requirePermission(db,context,requestId,'activities.registration.review',{mode:'list',resourceType:'activity',resourceId:activityId});
  const activitySections=await audienceSections(db,activityId);
  if (activity.audience==='SECTIONS' && decision.sections!==null &&
      !activitySections.some(sectionId=>decision.sections.includes(sectionId))) throw new AppError(403,'forbidden');
  const scope=decision.sections===null?'':` AND r.submitted_section_id IN (${decision.sections.map(()=>'?').join(',')})`;
  const rows=await db.prepare(`SELECT r.id,r.submitted_name,r.submitted_by_name,r.contact_phone,r.receipt_email,
    r.submitted_birth_date,r.submitted_section_id,r.participant_id,r.match_status,r.status,
    r.expected_amount_cents,r.created_at,p.review_status AS payment_status FROM activity_registration r
    LEFT JOIN payment_evidence p ON p.registration_id=r.id WHERE r.activity_id=?${scope} ORDER BY r.created_at DESC LIMIT 100`)
    .bind(activityId,...(decision.sections??[])).all();
  return rows.results;
}
export async function reviewCandidates(db,context,requestId,id) {
  const row=await registration(db,id);
  if (row.status!=='NEEDS_PARTICIPANT_REVIEW') throw new AppError(409,'invalid_transition');
  const decision=await reviewDecision(db,context,requestId,row,'activities.registration.review');
  const allowed=row.audience==='GENERAL'?[]:await audienceSections(db,row.activity_id);
  const scoped=decision.sections===null?allowed:allowed.length?allowed.filter(sectionId=>decision.sections.includes(sectionId)):decision.sections;
  if (decision.sections!==null && !scoped.length) return [];
  const filter=scoped.length?` AND p.current_section_id IN (${scoped.map(()=>'?').join(',')})`:'';
  const rows=await db.prepare(`SELECT p.id,p.display_name,p.birth_date,s.code AS section_code FROM participant p JOIN section s ON s.id=p.current_section_id
    WHERE p.status='ACTIVE'${filter} ORDER BY p.display_name LIMIT 100`).bind(...scoped).all();
  return rows.results;
}
export async function reviewMatch(db,context,requestId,id,input,now=Date.now()) {
  const row=await registration(db,id);
  if (row.status!=='NEEDS_PARTICIPANT_REVIEW') throw new AppError(409,'invalid_transition');
  if (!input || !['MATCH','REJECT'].includes(input.decision) || Object.keys(input).some(key=>!['decision','participantId'].includes(key)))
    throw new AppError(400,'invalid_review');
  let participant=null;
  if (input.decision==='MATCH') {
    requireUuid(input.participantId);
    participant=await db.prepare('SELECT id,current_section_id FROM participant WHERE id=? AND status=?').bind(input.participantId,'ACTIVE').first();
    if (!participant) throw new AppError(404,'not_found');
    const eligible=row.audience==='GENERAL' || !!await db.prepare('SELECT 1 FROM activity_section WHERE activity_id=? AND section_id=?')
      .bind(row.activity_id,participant.current_section_id).first();
    if (!eligible || (row.submitted_section_id && row.submitted_section_id!==participant.current_section_id)) throw new AppError(403,'forbidden');
  } else if (input.participantId!=null) throw new AppError(400,'invalid_review');
  await reviewDecision(db,context,requestId,row,'activities.registration.review',participant?.current_section_id??row.submitted_section_id);
  const next=input.decision==='REJECT'?'REJECTED':row.expected_amount_cents===0?'CONFIRMED':'AWAITING_PAYMENT_REVIEW';
  const notify=[];
  if (participant) {
    if (next==='CONFIRMED') notify.push(['CONFIRMED',row.receipt_email]);
    if (next==='AWAITING_PAYMENT_REVIEW') notify.push(['PENDING_PAYMENT',row.receipt_email]);
  }
  await db.batch([
    db.prepare(`UPDATE activity_registration SET participant_id=?,match_status=?,status=?,submitted_birth_date=NULL,
      reviewed_by=?,reviewed_at=?,updated_at=? WHERE id=?`).bind(participant?.id??null,participant?'RESOLVED':'REJECTED',next,context.userId,now,now,id),
    statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,
      action:participant?'REGISTRATION_MATCH_RESOLVED':'REGISTRATION_REJECTED',resourceType:'activity_registration',resourceId:id,occurredAt:now}),
    ...(next==='CONFIRMED'?[statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,
      action:'REGISTRATION_CONFIRMED',resourceType:'activity_registration',resourceId:id,occurredAt:now})]:[]),
    ...notificationStatements(db,id,notify,now,requestId)
  ]);
  return {id,status:next};
}
export async function listPayments(db,context,requestId) {
  const decision=await requirePermission(db,context,requestId,'finance.payment.verify',{mode:'list',resourceType:'payment_evidence'});
  const scope=decision.sections===null?'':` AND p.current_section_id IN (${decision.sections.map(()=>'?').join(',')})`;
  const rows=await db.prepare(`SELECT e.id,e.review_status,e.size_bytes,e.detected_mime,r.id AS registration_id,r.status AS registration_status,
    r.submitted_name,r.expected_amount_cents,a.name AS activity_name,p.current_section_id FROM payment_evidence e
    JOIN activity_registration r ON r.id=e.registration_id JOIN activity a ON a.id=r.activity_id
    LEFT JOIN participant p ON p.id=r.participant_id WHERE r.status='AWAITING_PAYMENT_REVIEW'${scope}
    ORDER BY r.created_at DESC LIMIT 100`).bind(...(decision.sections??[])).all();
  return rows.results;
}
async function payment(db,id) {
  requireUuid(id);
  const row=await db.prepare(`SELECT e.*,r.id AS registration_id,r.participant_id,r.receipt_email,
    r.status AS registration_status,r.submitted_section_id FROM payment_evidence e
    JOIN activity_registration r ON r.id=e.registration_id WHERE e.id=?`).bind(id).first();
  if (!row) throw new AppError(404,'not_found');
  return row;
}
async function paymentAccess(db,context,requestId,row) {
  const participant=row.participant_id?await db.prepare('SELECT current_section_id FROM participant WHERE id=?').bind(row.participant_id).first():null;
  await reviewDecision(db,context,requestId,{...row,id:row.registration_id},'finance.payment.verify',
    participant?.current_section_id??row.submitted_section_id);
}
export async function evidenceDownload(db,storage,context,requestId,id) {
  const row=await payment(db,id);
  await paymentAccess(db,context,requestId,row);
  return readEvidence(storage,row.object_key);
}
export async function reviewPayment(db,context,requestId,id,decision,now=Date.now()) {
  if (!['VERIFIED','ISSUE'].includes(decision)) throw new AppError(400,'invalid_review');
  const row=await payment(db,id);
  await paymentAccess(db,context,requestId,row);
  if (row.registration_status!=='AWAITING_PAYMENT_REVIEW' || row.review_status==='VERIFIED' ||
      (row.review_status==='ISSUE' && decision==='ISSUE')) throw new AppError(409,'invalid_transition');
  const kind=decision==='VERIFIED'?'CONFIRMED':'PAYMENT_ISSUE';
  const queued=queueStatement(db,row.registration_id,kind,row.receipt_email,now);
  await db.batch([
    db.prepare('UPDATE payment_evidence SET review_status=?,reviewed_by=?,reviewed_at=? WHERE id=?')
      .bind(decision,context.userId,now,id),
    ...(decision==='VERIFIED'?[db.prepare(`UPDATE activity_registration SET status='CONFIRMED',updated_at=?
      WHERE id=?`).bind(now,row.registration_id)]:[]),
    statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,
      action:decision==='VERIFIED'?'PAYMENT_VERIFIED':'PAYMENT_ISSUE',resourceType:'payment_evidence',resourceId:id,occurredAt:now}),
    ...(decision==='VERIFIED'?[statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,
      action:'REGISTRATION_CONFIRMED',resourceType:'activity_registration',resourceId:row.registration_id,occurredAt:now})]:[]),
    ...(queued?[queued.statement,statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,
      action:'NOTIFICATION_QUEUED',resourceType:'notification_outbox',resourceId:queued.id,occurredAt:now})]:[])
  ]);
  return {id,status:decision};
}
