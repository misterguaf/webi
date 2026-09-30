import { pageRequest, pageResult } from '../pagination.js';
import { versionCas } from '../concurrency.js';
import { authorize } from '../policy.js';
import * as participants from '../domains/participants/repository.js';
import { append, statement } from '../domains/audit/repository.js';
import { AppError, requirePermission, requireUuid, validUuid } from './common.js';

async function decisionEvent(db,context,requestId,allow,reasonCode,resourceId=null) {
  await append(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,
    action:allow?'AUTHZ_ALLOW':'AUTHZ_DENY',result:allow?'ALLOW':'DENY',resourceType:'participant',resourceId,reasonCode});
}
const covers=(decision,sectionId)=>decision.allow && (decision.sections===null || decision.sections.includes(sectionId));

// ---------------------------------------------------------------- completeness (§8.2)
// Derived, never stored. Minors under 18 need a current guardian and a current contact; participants
// of legal age (18+) need their own current contact. Without a birth date, age is unknown and the
// only reported reason is the missing birth date. A viewer without contact scope only learns whether
// the birth date is missing (guardian/contact items are not disclosed).
export function isAdult(birthDate, now=Date.now()) {
  if (!birthDate) return null;
  const b=new Date(`${birthDate}T00:00:00Z`), n=new Date(now);
  let age=n.getUTCFullYear()-b.getUTCFullYear();
  const m=n.getUTCMonth()-b.getUTCMonth();
  if (m<0 || (m===0 && n.getUTCDate()<b.getUTCDate())) age--;
  return age>=18;
}
export function completeness(flags, { canSeeContacts, now=Date.now() }) {
  const hasBirth=!!flags.birth_date, missing=[];
  if (!hasBirth) missing.push('birthDate');
  if (!canSeeContacts) return { complete: hasBirth, missing };
  if (!hasBirth) return { complete: false, missing };
  if (isAdult(flags.birth_date, now)) {
    if (!flags.has_own_contact) missing.push('contact');
  } else {
    if (!flags.has_guardian) missing.push('guardian');
    if (!flags.has_own_contact && !flags.has_guardian_contact) missing.push('contact');
  }
  return { complete: missing.length===0, missing };
}

// ---------------------------------------------------------------- reads
export async function list(db,context,requestId,params,now=Date.now()) {
  const decision=await authorize(db,context,{permission:'participants.profile.read',mode:'list'});
  if (!decision.allow) { await decisionEvent(db,context,requestId,false,decision.reason); throw new AppError(403,'forbidden'); }
  const status=params?.get('estat')==='de-baixa'?'INACTIVE':'ACTIVE';
  const contact=await authorize(db,context,{permission:'participants.contact.read',mode:'list'});
  const page=pageRequest(params,['string','string']);
  const rows=await participants.listScoped(db,decision,{limit:page.limit,after:page.after,status});
  await decisionEvent(db,context,requestId,true,'ALLOW'); // no data leaves the Worker if audit fails
  const result=pageResult(rows,page.limit,row=>[row.display_name,row.id]);
  const items=result.items.map(row=>({ id:row.id, display_name:row.display_name, current_section_id:row.current_section_id,
    status:row.status, completeness:completeness(row,{canSeeContacts:covers(contact,row.current_section_id),now}) }));
  return {participants:items,nextCursor:result.nextCursor};
}
export async function find(db,context,requestId,id,now=Date.now()) {
  requireUuid(id);
  const decision=await authorize(db,context,{permission:'participants.profile.read',mode:'list'});
  const row=decision.allow?await participants.findDetail(db,decision,id):null;
  if (!row) {
    await decisionEvent(db,context,requestId,false,decision.allow?'NOT_FOUND_OR_OUT_OF_SCOPE':decision.reason,id);
    throw new AppError(404,'not_found');
  }
  const contact=await authorize(db,context,{permission:'participants.contact.read',mode:'list'});
  await decisionEvent(db,context,requestId,true,'ALLOW',id);
  const canSeeContacts=covers(contact,row.current_section_id);
  return {
    id:row.id, displayName:row.display_name, currentSectionId:row.current_section_id, status:row.status,
    birthDate:row.birth_date, version:row.version, createdAt:row.created_at, updatedAt:row.updated_at,
    provenance:row.provenance, provenanceNote:row.provenance_note,
    completeness:completeness(row,{canSeeContacts,now}),
    sectionHistory:await participants.sectionHistory(db,id)
  };
}
export async function healthPolicyCheck(db,context,requestId,participantId,purpose) {
  requireUuid(participantId);
  if (typeof purpose!=='string' || !/^[a-z-]{1,100}$/.test(purpose)) throw new AppError(400,'invalid_request');
  const decision=await authorize(db,context,{permission:'health.record.read',participantId,purpose});
  await decisionEvent(db,context,requestId,decision.allow,decision.reason,participantId);
  return {allowed:decision.allow,reason:decision.reason};
}

// ---------------------------------------------------------------- validation
const PROVENANCE=new Set(['CRM_ANTERIOR','DOCUMENTACIO_FISICA','COMUNICACIO_FAMILIA','ALTRES']);
function nameOf(value) {
  if (typeof value!=='string') throw new AppError(400,'invalid_participant');
  const name=value.trim();
  if (!name || name.length>120) throw new AppError(400,'invalid_participant');
  return name;
}
function birthOf(value, now) {
  if (value==null || value==='') return null;
  if (typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AppError(400,'invalid_participant');
  const date=new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0,10)!==value || date.getTime()>now) throw new AppError(400,'invalid_participant');
  return value;
}
function provenanceOf(input) {
  const provenance=input.provenance??null;
  if (provenance!==null && !PROVENANCE.has(provenance)) throw new AppError(400,'invalid_participant');
  const note=input.provenanceNote??null;
  if (note!==null && (typeof note!=='string' || note.length>200)) throw new AppError(400,'invalid_participant');
  return { provenance, provenanceNote: note?note.trim()||null:null };
}
const expectedVersion=input=>{
  const value=input?.expectedVersion;
  if (!Number.isSafeInteger(value) || value<1) throw new AppError(400,'invalid_request');
  return value;
};
async function staleOr(db,id,expected,error) {
  const current=await db.prepare('SELECT version FROM participant WHERE id=?').bind(id).first();
  if (!current || current.version!==expected) return new AppError(409,'stale_participant');
  return error;
}
// Gate for management: a uniform 403 for users who cannot manage any participant, then a 404 that
// never distinguishes a missing participant from one in another section (no cross-section IDOR).
async function requireManage(db,context,requestId,id) {
  const decision=await authorize(db,context,{permission:'participants.profile.manage',mode:'list'});
  if (!decision.allow) { await decisionEvent(db,context,requestId,false,decision.reason,id); throw new AppError(403,'forbidden'); }
  const current=await participants.currentForManage(db,id);
  if (!current || !(decision.sections===null || decision.sections.includes(current.current_section_id))) {
    await decisionEvent(db,context,requestId,false,current?'OUT_OF_SCOPE':'NOT_FOUND',id);
    throw new AppError(404,'not_found');
  }
  return { current, decision };
}

// ---------------------------------------------------------------- writes
export async function createParticipant(db,context,requestId,input,now=Date.now()) {
  if (!input || typeof input!=='object' || Array.isArray(input) ||
      Object.keys(input).some(key=>!['name','sectionId','birthDate','provenance','provenanceNote'].includes(key)))
    throw new AppError(400,'invalid_participant');
  const name=nameOf(input.name), birthDate=birthOf(input.birthDate,now), { provenance, provenanceNote }=provenanceOf(input);
  if (!validUuid(input.sectionId)) throw new AppError(400,'invalid_participant');
  await requirePermission(db,context,requestId,'participants.profile.manage',{sectionId:input.sectionId,resourceType:'participant'});
  if (!await db.prepare('SELECT 1 FROM section WHERE id=?').bind(input.sectionId).first()) throw new AppError(400,'invalid_participant');
  const id=crypto.randomUUID();
  await db.batch([
    db.prepare(`INSERT INTO participant(id,display_name,current_section_id,status,birth_date,version,created_at,updated_at,created_by,provenance,provenance_note)
      VALUES(?,?,?,'ACTIVE',?,1,?,?,?,?,?)`).bind(id,name,input.sectionId,birthDate,now,now,context.userId,provenance,provenanceNote),
    statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,action:'DATA_CREATED',resourceType:'participant',resourceId:id,occurredAt:now})
  ]);
  return {id,version:1};
}
export async function updateParticipant(db,context,requestId,id,input,now=Date.now()) {
  requireUuid(id);
  if (!input || typeof input!=='object' || Array.isArray(input) ||
      Object.keys(input).some(key=>!['name','birthDate','provenance','provenanceNote','expectedVersion'].includes(key)))
    throw new AppError(400,'invalid_participant');
  const expected=expectedVersion(input);
  const name=nameOf(input.name), birthDate=birthOf(input.birthDate,now), { provenance, provenanceNote }=provenanceOf(input);
  const { current }=await requireManage(db,context,requestId,id);
  if (current.version!==expected) throw new AppError(409,'stale_participant');
  try {
    await db.batch([
      db.prepare(`UPDATE participant SET ${versionCas('version')},display_name=?,birth_date=?,provenance=?,provenance_note=?,updated_at=? WHERE id=?`)
        .bind(expected,name,birthDate,provenance,provenanceNote,now,id),
      statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,action:'DATA_UPDATED',resourceType:'participant',resourceId:id,occurredAt:now})
    ]);
  } catch (error) { throw await staleOr(db,id,expected,error); }
  return {id,version:expected+1};
}
export async function setParticipantActive(db,context,requestId,id,active,input,now=Date.now()) {
  requireUuid(id);
  const expected=expectedVersion(input);
  const { current }=await requireManage(db,context,requestId,id);
  if (current.version!==expected) throw new AppError(409,'stale_participant');
  const target=active?'ACTIVE':'INACTIVE';
  if (current.status===target) throw new AppError(409,'invalid_transition');
  try {
    await db.batch([
      db.prepare(`UPDATE participant SET ${versionCas('version')},status=?,updated_at=? WHERE id=?`).bind(expected,target,now,id),
      statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,action:'DATA_UPDATED',resourceType:'participant',resourceId:id,occurredAt:now})
    ]);
  } catch (error) { throw await staleOr(db,id,expected,error); }
  return {id,status:target,version:expected+1};
}
// Section change needs manage over the current AND the target section, so a single-section coordinator
// cannot move a participant into or out of a section they do not manage.
export async function changeParticipantSection(db,context,requestId,id,input,now=Date.now()) {
  requireUuid(id);
  if (!input || typeof input!=='object' || Array.isArray(input) ||
      Object.keys(input).some(key=>!['sectionId','expectedVersion'].includes(key)) || !validUuid(input.sectionId))
    throw new AppError(400,'invalid_participant');
  const expected=expectedVersion(input);
  const { current }=await requireManage(db,context,requestId,id);
  if (current.version!==expected) throw new AppError(409,'stale_participant');
  if (current.current_section_id===input.sectionId) throw new AppError(409,'invalid_transition');
  await requirePermission(db,context,requestId,'participants.profile.manage',{sectionId:input.sectionId,resourceType:'participant',resourceId:id});
  if (!await db.prepare('SELECT 1 FROM section WHERE id=?').bind(input.sectionId).first()) throw new AppError(400,'invalid_participant');
  if (current.status!=='ACTIVE') throw new AppError(409,'invalid_transition');
  try {
    await db.batch([
      db.prepare(`UPDATE participant SET ${versionCas('version')},current_section_id=?,updated_at=? WHERE id=?`).bind(expected,input.sectionId,now,id),
      statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,action:'DATA_UPDATED',resourceType:'participant',resourceId:id,occurredAt:now})
    ]);
  } catch (error) { throw await staleOr(db,id,expected,error); }
  return {id,sectionId:input.sectionId,version:expected+1};
}
