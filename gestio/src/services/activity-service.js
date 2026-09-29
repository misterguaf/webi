import { pageRequest, pageResult } from '../pagination.js';
import { versionCas } from '../concurrency.js';
import { authorize } from '../policy.js';
import { statement } from '../domains/audit/repository.js';
import { AppError, requirePermission, requireUuid, validUuid } from './common.js';

const text=(value,max,{required=false}={})=>{
  if (typeof value!=='string' || value.length>max || (required && !value.trim())) throw new AppError(400,'invalid_activity');
  return value.trim();
};
const integer=(value,min,max)=>{
  if (!Number.isSafeInteger(value) || value<min || value>max) throw new AppError(400,'invalid_activity');
  return value;
};
const keys=new Set(['name','audience','sectionIds','location','startsAt','endsAt','registrationDeadline',
  'priceCents','shortDescription','materials','specialNotice','transportOptions']);
function validate(input) {
  if (!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(key=>!keys.has(key))) throw new AppError(400,'invalid_activity');
  const audience=input.audience;
  if (!['SECTIONS','GENERAL'].includes(audience)) throw new AppError(400,'invalid_activity');
  const sectionIds=input.sectionIds;
  if (!Array.isArray(sectionIds) || sectionIds.some(id=>!validUuid(id)) || new Set(sectionIds).size!==sectionIds.length ||
      (audience==='GENERAL' && sectionIds.length!==0) || (audience==='SECTIONS' && (sectionIds.length<1 || sectionIds.length>4))) throw new AppError(400,'invalid_activity');
  const startsAt=integer(input.startsAt,0,4102444800000);
  const endsAt=integer(input.endsAt,0,4102444800000);
  const deadline=integer(input.registrationDeadline,0,4102444800000);
  if (endsAt<=startsAt || deadline>startsAt) throw new AppError(400,'invalid_activity');
  const options=input.transportOptions??[];
  if (!Array.isArray(options) || (options.length!==0 && options.length!==2) ||
      (options.length===2 && new Set(options.map(option=>option?.code)).size!==2)) throw new AppError(400,'invalid_activity');
  for (const option of options) {
    if (!['GROUP','FAMILY'].includes(option?.code)) throw new AppError(400,'invalid_activity');
    integer(option.adjustmentCents,-1000000,1000000);
    // Product decision (3.5D): transport arranged by the family costs the group nothing.
    if (option.code==='FAMILY' && option.adjustmentCents!==0) throw new AppError(400,'invalid_activity');
  }
  const priceCents=integer(input.priceCents,0,1000000);
  if (options.some(option=>priceCents+option.adjustmentCents<0 || priceCents+option.adjustmentCents>1000000)) throw new AppError(400,'invalid_activity');
  return {name:text(input.name,120,{required:true}),audience,sectionIds,
    location:text(input.location,160,{required:true}),startsAt,endsAt,deadline,priceCents,
    shortDescription:text(input.shortDescription??'',600),materials:text(input.materials??'',400),
    specialNotice:text(input.specialNotice??'',400),options};
}
async function sectionsFor(db,id) {
  return (await db.prepare('SELECT section_id FROM activity_section WHERE activity_id=? ORDER BY section_id').bind(id).all()).results.map(row=>row.section_id);
}
export async function activityById(db,id) {
  requireUuid(id);
  const row=await db.prepare('SELECT * FROM activity WHERE id=?').bind(id).first();
  if (!row) throw new AppError(404,'not_found');
  const options=(await db.prepare('SELECT code,price_adjustment_cents FROM activity_transport_option WHERE activity_id=? ORDER BY code').bind(id).all()).results;
  return {...row,sectionIds:await sectionsFor(db,id),transportOptions:options};
}
async function manage(db,context,requestId,audience,sectionIds) {
  if (audience==='GENERAL') return requirePermission(db,context,requestId,'activities.general.manage',{resourceType:'activity'});
  for (const id of sectionIds) await requirePermission(db,context,requestId,'activities.manage',{sectionId:id,resourceType:'activity'});
}
async function knownSections(db,ids) {
  if (!ids.length) return;
  const rows=await db.prepare(`SELECT id FROM section WHERE id IN (${ids.map(()=>'?').join(',')})`).bind(...ids).all();
  if (rows.results.length!==ids.length) throw new AppError(400,'invalid_activity');
}
export async function createActivity(db,context,requestId,input,now=Date.now()) {
  const data=validate(input);
  await manage(db,context,requestId,data.audience,data.sectionIds);
  await knownSections(db,data.sectionIds);
  const id=crypto.randomUUID(),code='ACT-'+crypto.randomUUID().replaceAll('-','').slice(0,24).toUpperCase();
  await db.batch([
    db.prepare(`INSERT INTO activity(id,public_code,name,status,audience,location,starts_at,ends_at,registration_deadline,
      price_cents,currency,short_description,materials,special_notice,created_by,created_at,updated_at)
      VALUES(?,?,?,'DRAFT',?,?,?,?,?,?,'EUR',?,?,?,?,?,?)`).bind(id,code,data.name,data.audience,data.location,data.startsAt,
      data.endsAt,data.deadline,data.priceCents,data.shortDescription,data.materials,data.specialNotice,context.userId,now,now),
    ...data.sectionIds.map(sectionId=>db.prepare('INSERT INTO activity_section(activity_id,section_id) VALUES(?,?)').bind(id,sectionId)),
    ...data.options.map(option=>db.prepare('INSERT INTO activity_transport_option(activity_id,code,price_adjustment_cents) VALUES(?,?,?)')
      .bind(id,option.code,option.adjustmentCents)),
    statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,action:'ACTIVITY_CREATED',resourceType:'activity',resourceId:id,occurredAt:now})
  ]);
  return {id,publicCode:code,status:'DRAFT',version:1};
}
// Optimistic concurrency (3.5D): every write names the version the user saw. A stale version is
// refused before any work, and the compare-and-set inside the batch catches races between requests
// (src/concurrency.js): the whole batch, audit included, aborts and nothing is overwritten.
function expectedVersion(input,code) {
  const value=input?.expectedVersion;
  if (!Number.isSafeInteger(value) || value<1) throw new AppError(400,code);
  return value;
}
function assertFresh(current,expected) {
  if (current.version!==expected) throw new AppError(409,'stale_activity');
}
async function staleOr(db,id,expected,error) {
  const current=await db.prepare('SELECT version FROM activity WHERE id=?').bind(id).first();
  if (!current || current.version!==expected) return new AppError(409,'stale_activity');
  const message=String(error?.message??'');
  if (message.includes('activity_terms_locked') || message.includes('activity_sections_locked') ||
      message.includes('activity_transport_locked')) return new AppError(409,'activity_terms_locked');
  return error;
}
const hasRegistrations=async(db,id)=>!!await db.prepare('SELECT 1 FROM activity_registration WHERE activity_id=? LIMIT 1').bind(id).first();
export async function updateActivity(db,context,requestId,id,input,now=Date.now()) {
  const {expectedVersion:_version,...terms}=input??{};
  const expected=expectedVersion(input,'invalid_activity');
  const current=await activityById(db,id),data=validate(terms);
  await manage(db,context,requestId,current.audience,current.sectionIds);
  await manage(db,context,requestId,data.audience,data.sectionIds);
  await knownSections(db,data.sectionIds);
  assertFresh(current,expected);
  if (current.status==='CLOSED') throw new AppError(409,'activity_closed');
  const registrations=await hasRegistrations(db,id);
  const sectionChanged=JSON.stringify(current.sectionIds)!==JSON.stringify([...data.sectionIds].sort());
  const currentOptions=current.transportOptions.map(row=>row.code+':'+row.price_adjustment_cents).join(',');
  const nextOptions=[...data.options].sort((a,b)=>a.code.localeCompare(b.code)).map(row=>row.code+':'+row.adjustmentCents).join(',');
  const optionsChanged=currentOptions!==nextOptions;
  if (registrations && (current.audience!==data.audience || current.price_cents!==data.priceCents ||
      current.starts_at!==data.startsAt || current.ends_at!==data.endsAt || current.registration_deadline!==data.deadline ||
      sectionChanged || optionsChanged)) throw new AppError(409,'activity_terms_locked');
  try {
    await db.batch([
      db.prepare(`UPDATE activity SET ${versionCas('version')},name=?,audience=?,location=?,starts_at=?,ends_at=?,registration_deadline=?,
        price_cents=?,short_description=?,materials=?,special_notice=?,updated_at=? WHERE id=?`).bind(expected,data.name,data.audience,
        data.location,data.startsAt,data.endsAt,data.deadline,data.priceCents,data.shortDescription,data.materials,data.specialNotice,now,id),
      ...(sectionChanged?[db.prepare('DELETE FROM activity_section WHERE activity_id=?').bind(id),
        ...data.sectionIds.map(sectionId=>db.prepare('INSERT INTO activity_section(activity_id,section_id) VALUES(?,?)').bind(id,sectionId))]:[]),
      ...(optionsChanged?[db.prepare('DELETE FROM activity_transport_option WHERE activity_id=?').bind(id),
        ...data.options.map(option=>db.prepare('INSERT INTO activity_transport_option(activity_id,code,price_adjustment_cents) VALUES(?,?,?)')
          .bind(id,option.code,option.adjustmentCents))]:[]),
      statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,action:'ACTIVITY_UPDATED',resourceType:'activity',resourceId:id,occurredAt:now})
    ]);
  } catch (error) { throw await staleOr(db,id,expected,error); }
  return {id,version:expected+1};
}
export async function transitionActivity(db,context,requestId,id,target,input,now=Date.now()) {
  const expected=expectedVersion(input,'invalid_request');
  const current=await activityById(db,id);
  await manage(db,context,requestId,current.audience,current.sectionIds);
  assertFresh(current,expected);
  if (!((current.status==='DRAFT' && target==='PUBLISHED') || (current.status==='PUBLISHED' && target==='CLOSED')))
    throw new AppError(409,'invalid_transition');
  if (target==='PUBLISHED' && current.registration_deadline<now) throw new AppError(409,'expired_deadline');
  try {
    await db.batch([
      db.prepare(`UPDATE activity SET ${versionCas('version')},status=?,updated_at=? WHERE id=?`).bind(expected,target,now,id),
      statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,
        action:target==='PUBLISHED'?'ACTIVITY_PUBLISHED':'ACTIVITY_CLOSED',resourceType:'activity',resourceId:id,occurredAt:now})
    ]);
  } catch (error) { throw await staleOr(db,id,expected,error); }
  return {id,status:target,version:expected+1};
}
// Discard (3.5D, product decision): only a DRAFT without registrations, by someone who may manage it,
// with the version they confirmed. PUBLISHED and CLOSED activities are never deleted. The guard is
// repeated inside the batch so a registration or transition racing the request aborts everything,
// and the RESTRICT foreign keys on registrations remain the last line of defence.
export async function discardActivity(db,context,requestId,id,input,now=Date.now()) {
  const expected=expectedVersion(input,'invalid_request');
  const current=await activityById(db,id);
  await manage(db,context,requestId,current.audience,current.sectionIds);
  assertFresh(current,expected);
  if (current.status!=='DRAFT') throw new AppError(409,'invalid_transition');
  if (await hasRegistrations(db,id)) throw new AppError(409,'activity_has_registrations');
  try {
    await db.batch([
      db.prepare(`UPDATE activity SET version=CASE WHEN version=? AND status='DRAFT'
        AND NOT EXISTS(SELECT 1 FROM activity_registration WHERE activity_id=?) THEN version+1 ELSE NULL END WHERE id=?`).bind(expected,id,id),
      db.prepare('DELETE FROM activity_transport_option WHERE activity_id=?').bind(id),
      db.prepare('DELETE FROM activity_section WHERE activity_id=?').bind(id),
      db.prepare("DELETE FROM activity WHERE id=? AND status='DRAFT'").bind(id),
      statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,action:'ACTIVITY_DISCARDED',resourceType:'activity',resourceId:id,occurredAt:now})
    ]);
  } catch (error) {
    const row=await db.prepare('SELECT version,status FROM activity WHERE id=?').bind(id).first();
    if (!row || row.version!==expected) throw new AppError(409,'stale_activity');
    if (row.status!=='DRAFT') throw new AppError(409,'invalid_transition');
    if (await hasRegistrations(db,id)) throw new AppError(409,'activity_has_registrations');
    throw error;
  }
  return {id,discarded:true};
}

// Registration summary (3.5D, B1): aggregates computed with exactly the scope of
// GET /api/activities/:id/registrations — registrations submitted for a section the reviewer covers,
// or all of them for group-wide reviewers. No personal data; `null` without an overlapping scope.
async function reviewScope(db,context) {
  const review=await authorize(db,context,{permission:'activities.registration.review',mode:'list'});
  if (!review.allow) return null;
  const sections=(await db.prepare('SELECT id,code FROM section ORDER BY id').all()).results;
  return {sections:review.sections,codeOf:new Map(sections.map(row=>[row.id,row.code]))};
}
function summarySql(scope) {
  if (!scope) return {sql:'NULL AS registration_summary',values:[]};
  const filter=scope.sections===null?'':` AND r.submitted_section_id IN (${scope.sections.map(()=>'?').join(',')})`;
  return {sql:`(SELECT json_object('total',count(*),
      'needsReview',coalesce(sum(r.status='NEEDS_PARTICIPANT_REVIEW'),0),
      'awaitingPayment',coalesce(sum(r.status='AWAITING_PAYMENT_REVIEW'),0),
      'confirmed',coalesce(sum(r.status='CONFIRMED'),0),'rejected',coalesce(sum(r.status='REJECTED'),0))
    FROM activity_registration r WHERE r.activity_id=a.id${filter}) AS registration_summary`,values:scope.sections??[]};
}
export function summaryFor(scope,audience,sectionIds,raw) {
  if (!scope || raw==null) return null;
  const counts=typeof raw==='string'?JSON.parse(raw):raw;
  if (scope.sections===null) return {scope:'ALL',sections:[],...counts};
  const reviewer=/** @type {string[]} */ (scope.sections);
  if (audience==='SECTIONS') {
    const shared=sectionIds.filter(id=>reviewer.includes(id));
    if (!shared.length) return null;
    if (shared.length===sectionIds.length) return {scope:'ALL',sections:[],...counts};
    return {scope:'PARTIAL',sections:shared.map(id=>scope.codeOf.get(id)).filter(Boolean),...counts};
  }
  return {scope:'PARTIAL',sections:[...scope.codeOf.keys()].filter(id=>reviewer.includes(id)).map(id=>scope.codeOf.get(id)),...counts};
}

// Read (3.5D, B4): GENERAL activities concern every section, so any holder of activities.read may
// consult them; managing them still requires activities.general.manage. SECTIONS activities are
// readable with read scope over at least one targeted section — the same rule as the list — and
// outside it the answer is 404 like a missing activity.
async function requireRead(db,context,requestId,activity) {
  const read=await authorize(db,context,{permission:'activities.read',mode:'list'});
  if (read.allow && (activity.audience==='GENERAL' || read.sections===null ||
      activity.sectionIds.some(sectionId=>read.sections?.includes(sectionId)))) return;
  const resource={resourceType:'activity',resourceId:activity.id};
  if (activity.audience==='GENERAL') { await requirePermission(db,context,requestId,'activities.general.manage',resource); return; }
  if (!read.allow) await requirePermission(db,context,requestId,'activities.read',{mode:'list',...resource});
  await requirePermission(db,context,requestId,'activities.read',{sectionId:activity.sectionIds[0],conceal:true,...resource});
}
export async function activityDetail(db,context,requestId,id) {
  const activity=await activityById(db,id);
  await requireRead(db,context,requestId,activity);
  const scope=await reviewScope(db,context),summary=summarySql(scope);
  const extra=await db.prepare(`SELECT ${summary.sql},EXISTS(SELECT 1 FROM activity_registration WHERE activity_id=a.id) AS terms_locked,
    (SELECT group_concat(s.code,', ') FROM activity_section x JOIN section s ON s.id=x.section_id WHERE x.activity_id=a.id) AS sections
    FROM activity a WHERE a.id=?`).bind(...summary.values,id).first();
  const {created_by:_creator,...visible}=activity;
  // termsLocked mirrors the database trigger: once any registration exists, audience, sections, dates,
  // price and transport can no longer change. A boolean only; no registration data is exposed.
  return {...visible,sections:extra?.sections??null,termsLocked:!!extra?.terms_locked,
    registrations:summaryFor(scope,activity.audience,activity.sectionIds,extra?.registration_summary)};
}
export async function listAdminActivities(db,context,requestId,params) {
  const page=pageRequest(params,['number','string']);
  const scoped=await authorize(db,context,{permission:'activities.read',mode:'list'});
  const general=await authorize(db,context,{permission:'activities.general.manage'});
  if (!scoped.allow && !general.allow) throw new AppError(403,'forbidden');
  const clauses=[],values=[];
  if (scoped.allow && scoped.sections===null) clauses.push('1=1');
  else if (scoped.allow && scoped.sections.length) {
    clauses.push(`EXISTS(SELECT 1 FROM activity_section x WHERE x.activity_id=a.id AND x.section_id IN (${scoped.sections.map(()=>'?').join(',')}))`);
    values.push(...scoped.sections);
  }
  clauses.push("a.audience='GENERAL'");
  const scope=await reviewScope(db,context),summary=summarySql(scope);
  const rows=await db.prepare(`SELECT a.id,a.public_code,a.name,a.status,a.audience,a.starts_at,a.ends_at,a.registration_deadline,
    a.price_cents,a.location,a.version,${summary.sql},
    (SELECT group_concat(s.code,', ') FROM activity_section x JOIN section s ON s.id=x.section_id WHERE x.activity_id=a.id) AS sections,
    (SELECT group_concat(x.section_id) FROM activity_section x WHERE x.activity_id=a.id) AS section_ids
    FROM activity a WHERE (${clauses.join(' OR ')})${page.after?' AND (a.starts_at<? OR (a.starts_at=? AND a.id<?))':''}
    ORDER BY a.starts_at DESC,a.id DESC LIMIT ?`)
    .bind(...summary.values,...values,...(page.after?[page.after[0],page.after[0],page.after[1]]:[]),page.limit+1).all();
  const result=pageResult(rows.results,page.limit,row=>[row.starts_at,row.id]);
  const activities=result.items.map(({registration_summary,section_ids,...row})=>({...row,
    registrations:summaryFor(scope,row.audience,section_ids?section_ids.split(','):[],registration_summary)}));
  return {activities,nextCursor:result.nextCursor};
}
export async function publicActivities(db) {
  const rows=await db.prepare(`SELECT a.public_code,a.name,a.audience,a.starts_at,a.ends_at,a.registration_deadline,a.price_cents,a.currency,
    a.location,a.short_description,a.materials,a.special_notice,
    (SELECT group_concat(s.code,',') FROM activity_section x JOIN section s ON s.id=x.section_id WHERE x.activity_id=a.id) AS sections
    FROM activity a WHERE a.status='PUBLISHED' ORDER BY a.starts_at,a.id LIMIT 100`).all();
  const result=[];
  for (const row of rows.results) {
    const options=(await db.prepare('SELECT code,price_adjustment_cents FROM activity_transport_option WHERE activity_id=(SELECT id FROM activity WHERE public_code=?) ORDER BY code')
      .bind(row.public_code).all()).results;
    result.push({publicCode:row.public_code,name:row.name,audience:row.audience,sections:row.sections?.split(',')??[],
      startsAt:row.starts_at,endsAt:row.ends_at,registrationDeadline:row.registration_deadline,priceCents:row.price_cents,
      currency:row.currency,location:row.location,shortDescription:row.short_description,materials:row.materials,
      specialNotice:row.special_notice,transportOptions:options.map(option=>({code:option.code,adjustmentCents:option.price_adjustment_cents}))});
  }
  return result;
}
