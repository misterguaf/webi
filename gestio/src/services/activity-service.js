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
  return {id,publicCode:code,status:'DRAFT'};
}
export async function updateActivity(db,context,requestId,id,input,now=Date.now()) {
  const current=await activityById(db,id),data=validate(input);
  await manage(db,context,requestId,current.audience,current.sectionIds);
  await manage(db,context,requestId,data.audience,data.sectionIds);
  await knownSections(db,data.sectionIds);
  if (current.status==='CLOSED') throw new AppError(409,'activity_closed');
  const registrations=await db.prepare('SELECT 1 FROM activity_registration WHERE activity_id=? LIMIT 1').bind(id).first();
  const sectionChanged=JSON.stringify(current.sectionIds)!==JSON.stringify([...data.sectionIds].sort());
  const currentOptions=(await db.prepare('SELECT code,price_adjustment_cents FROM activity_transport_option WHERE activity_id=? ORDER BY code').bind(id).all()).results
    .map(row=>row.code+':'+row.price_adjustment_cents).join(',');
  const nextOptions=[...data.options].sort((a,b)=>a.code.localeCompare(b.code)).map(row=>row.code+':'+row.adjustmentCents).join(',');
  const optionsChanged=currentOptions!==nextOptions;
  if (registrations && (current.audience!==data.audience || current.price_cents!==data.priceCents ||
      current.starts_at!==data.startsAt || current.ends_at!==data.endsAt || current.registration_deadline!==data.deadline ||
      sectionChanged || optionsChanged)) throw new AppError(409,'activity_terms_locked');
  await db.batch([
    db.prepare(`UPDATE activity SET name=?,audience=?,location=?,starts_at=?,ends_at=?,registration_deadline=?,price_cents=?,
      short_description=?,materials=?,special_notice=?,updated_at=? WHERE id=?`).bind(data.name,data.audience,data.location,data.startsAt,
      data.endsAt,data.deadline,data.priceCents,data.shortDescription,data.materials,data.specialNotice,now,id),
    ...(sectionChanged?[db.prepare('DELETE FROM activity_section WHERE activity_id=?').bind(id),
      ...data.sectionIds.map(sectionId=>db.prepare('INSERT INTO activity_section(activity_id,section_id) VALUES(?,?)').bind(id,sectionId))]:[]),
    ...(optionsChanged?[db.prepare('DELETE FROM activity_transport_option WHERE activity_id=?').bind(id),
      ...data.options.map(option=>db.prepare('INSERT INTO activity_transport_option(activity_id,code,price_adjustment_cents) VALUES(?,?,?)')
        .bind(id,option.code,option.adjustmentCents))]:[]),
    statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,action:'ACTIVITY_UPDATED',resourceType:'activity',resourceId:id,occurredAt:now})
  ]);
  return {id};
}
export async function transitionActivity(db,context,requestId,id,target,now=Date.now()) {
  const current=await activityById(db,id);
  await manage(db,context,requestId,current.audience,current.sectionIds);
  if (!((current.status==='DRAFT' && target==='PUBLISHED') || (current.status==='PUBLISHED' && target==='CLOSED')))
    throw new AppError(409,'invalid_transition');
  if (target==='PUBLISHED' && current.registration_deadline<now) throw new AppError(409,'expired_deadline');
  await db.batch([
    db.prepare('UPDATE activity SET status=?,updated_at=? WHERE id=?').bind(target,now,id),
    statement(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,
      action:target==='PUBLISHED'?'ACTIVITY_PUBLISHED':'ACTIVITY_CLOSED',resourceType:'activity',resourceId:id,occurredAt:now})
  ]);
  return {id,status:target};
}
export async function listAdminActivities(db,context,requestId) {
  const scoped=await authorize(db,context,{permission:'activities.read'});
  const general=await authorize(db,context,{permission:'activities.general.manage'});
  if (!scoped.allow && !general.allow) throw new AppError(403,'forbidden');
  const clauses=[],params=[];
  if (scoped.allow && scoped.sections===null) clauses.push('1=1');
  else if (scoped.allow && scoped.sections.length) {
    clauses.push(`EXISTS(SELECT 1 FROM activity_section x WHERE x.activity_id=a.id AND x.section_id IN (${scoped.sections.map(()=>'?').join(',')}))`);
    params.push(...scoped.sections);
  }
  if (general.allow) clauses.push("a.audience='GENERAL'");
  const rows=await db.prepare(`SELECT a.id,a.public_code,a.name,a.status,a.audience,a.starts_at,a.ends_at,a.registration_deadline,
    a.price_cents,a.location,(SELECT group_concat(s.code,', ') FROM activity_section x JOIN section s ON s.id=x.section_id WHERE x.activity_id=a.id) AS sections
    FROM activity a WHERE (${clauses.join(' OR ')}) ORDER BY a.starts_at DESC LIMIT 100`).bind(...params).all();
  return rows.results;
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
