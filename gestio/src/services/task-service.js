import { authorize } from '../policy.js';
import { AppError, requirePermission, requireUuid, validUuid } from './common.js';
import { statement } from '../domains/audit/repository.js';
import { versionCas } from '../concurrency.js';

const clean=value=>typeof value==='string'?value.trim():'';
export const madridDay=(now=Date.now())=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Madrid'}).format(now);
const madridTime=(now=Date.now())=>new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Madrid',hour:'2-digit',minute:'2-digit',hour12:false}).format(now);
const day=value=>typeof value==='string' && /^20\d\d-\d\d-\d\d$/.test(value) &&
  !Number.isNaN(Date.parse(value+'T12:00:00Z')) && new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
const audit=(db,ctx,requestId,action,id,now)=>statement(db,{requestId,actorUserId:ctx.userId,sessionId:ctx.sessionId,
  action,resourceType:'task',resourceId:id,occurredAt:now});
async function commit(db,rows) {
  try {await db.batch(rows);}
  catch(error) {if (/task.version|invalid_task_revision/.test(String(error.message))) throw new AppError(409,'stale_task');throw error;}
}
async function scope(db,ctx) {
  const [section,group]=await Promise.all([
    authorize(db,ctx,{permission:'tasks.section.read',mode:'list'}),
    authorize(db,ctx,{permission:'tasks.group.read'})]);
  const parts=["(t.visibility='PERSONAL' AND t.owner_id=?)",
    "(t.visibility='NAMED' AND (t.owner_id=? OR EXISTS(SELECT 1 FROM task_member m WHERE m.task_id=t.id AND m.user_id=?)))"];
  const binds=[ctx.userId,ctx.userId,ctx.userId];
  if(section.allow) {
    if(section.sections===null) parts.push("t.visibility='SECTION'");
    else if(section.sections.length) {parts.push("(t.visibility='SECTION' AND t.section_id IN ("+section.sections.map(()=>'?').join(',')+"))");binds.push(...section.sections);}
  }
  if(group.allow) parts.push("t.visibility='GROUP'");
  return {sql:'('+parts.join(' OR ')+')',binds};
}
async function manageScope(db,ctx,requestId,visibility,sectionId) {
  if(visibility==='SECTION') await requirePermission(db,ctx,requestId,'tasks.section.manage',{sectionId,resourceType:'task'});
  if(visibility==='GROUP') await requirePermission(db,ctx,requestId,'tasks.group.manage',{resourceType:'task'});
}
export async function taskUsers(db,ctx,requestId,params) {
  const sectionId=params.get('sectionId'),visibility=params.get('visibility')||'NAMED';
  if(!['NAMED','SECTION','GROUP'].includes(visibility) || (sectionId&&!validUuid(sectionId))) throw new AppError(400,'invalid_task');
  await manageScope(db,ctx,requestId,visibility,sectionId);
  const binds=[Date.now(),Date.now()];
  let condition='';
  if(visibility==='SECTION') {
    condition=" AND (ur.section_id=? OR (ur.section_id IS NULL AND ur.role_code IN ('GROUP_COORDINATOR','TREASURY','SECRETARY')))";
    binds.push(sectionId);
  }
  return {users:(await db.prepare(`SELECT DISTINCT u.id,u.display_name AS name FROM app_user u JOIN user_role ur ON ur.user_id=u.id
    WHERE u.status='ACTIVE' AND ur.revoked_at IS NULL AND ur.valid_from<=? AND (ur.expires_at IS NULL OR ur.expires_at>?)
    AND ur.role_code!='CRM_MANAGER'${condition} ORDER BY u.display_name,u.id LIMIT 300`).bind(...binds).all()).results};
}
function validate(input) {
  const keys=['title','description','visibility','sectionId','dueDate','dueTime','recurrence','members','requestKey','expectedVersion'];
  if(!input || Object.keys(input).some(key=>!keys.includes(key))) throw new AppError(400,'invalid_task');
  const value={title:clean(input.title),description:clean(input.description)||null,visibility:input.visibility??'PERSONAL',
    sectionId:input.sectionId??null,dueDate:input.dueDate||null,dueTime:input.dueTime||null,recurrence:input.recurrence||null,
    members:input.members??[]};
  if(!value.title || value.title.length>160 || (value.description?.length??0)>2000 ||
    !['PERSONAL','NAMED','SECTION','GROUP'].includes(value.visibility) ||
    (value.visibility==='SECTION')!==(value.sectionId!==null) || (value.sectionId&&!validUuid(value.sectionId)) ||
    (value.dueDate&&!day(value.dueDate)) || (value.dueTime&&(!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.dueTime)||!value.dueDate)) ||
    (value.recurrence&&(!['DAILY','WEEKLY','MONTHLY'].includes(value.recurrence)||!value.dueDate)) ||
    !Array.isArray(value.members) || value.members.length>30 || value.members.some(m=>!validUuid(m.userId)||typeof m.responsible!=='boolean' ||
      Object.keys(m).some(key=>!['userId','responsible'].includes(key))) ||
    new Set(value.members.map(m=>m.userId)).size!==value.members.length ||
    (value.visibility==='PERSONAL' && value.members.length) || (value.visibility==='NAMED'&&!value.members.length))
    throw new AppError(400,'invalid_task');
  return value;
}
async function eligible(db,ctx,requestId,value) {
  await manageScope(db,ctx,requestId,value.visibility,value.sectionId);
  if(!value.members.length)return;
  const users=await taskUsers(db,ctx,requestId,new URLSearchParams({visibility:value.visibility,
    ...(value.sectionId?{sectionId:value.sectionId}:{})}));
  if(value.members.some(m=>!users.users.some(u=>u.id===m.userId))) throw new AppError(400,'invalid_task_assignee');
}
const memberStatements=(db,id,members)=>members.map(m=>db.prepare('INSERT INTO task_member(task_id,user_id,responsible) VALUES(?,?,?)')
  .bind(id,m.userId,m.responsible?1:0));
export async function createTask(db,ctx,requestId,input,now=Date.now()) {
  const value=validate(input);
  if(!validUuid(input.requestKey)) throw new AppError(400,'invalid_task');
  await eligible(db,ctx,requestId,value);
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))]
    .map(n=>n.toString(16).padStart(2,'0')).join('');
  const prior=await db.prepare('SELECT id,request_hash FROM task WHERE owner_id=? AND request_key=?').bind(ctx.userId,input.requestKey).first();
  if(prior) {if(prior.request_hash!==hash)throw new AppError(409,'task_request_conflict');return {id:prior.id,replayed:true};}
  const id=crypto.randomUUID();
  try {await commit(db,[
    db.prepare(`INSERT INTO task(id,owner_id,title,description,visibility,section_id,due_date,due_time,recurrence,recurrence_day,
      created_at,updated_at,request_key,request_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,ctx.userId,value.title,
      value.description,value.visibility,value.sectionId,value.dueDate,value.dueTime,value.recurrence,
      value.recurrence?Number(value.dueDate.slice(-2)):null,now,now,input.requestKey,hash),
    ...memberStatements(db,id,value.members),audit(db,ctx,requestId,'TASK_CREATED',id,now),
    ...(value.members.length?[audit(db,ctx,requestId,'TASK_ASSIGNED',id,now)]:[])]);
  } catch(error) {
    if(/task.owner_id, task.request_key/.test(String(error.message))) {
      const same=await db.prepare('SELECT id,request_hash FROM task WHERE owner_id=? AND request_key=?').bind(ctx.userId,input.requestKey).first();
      if(same?.request_hash===hash)return {id:same.id,replayed:true};
      throw new AppError(409,'task_request_conflict');
    } throw error;
  }
  return {id};
}
async function load(db,ctx,id) {
  requireUuid(id);const access=await scope(db,ctx);
  const row=await db.prepare(`SELECT t.* FROM task t WHERE t.id=? AND t.archived_at IS NULL AND ${access.sql}`)
    .bind(id,...access.binds).first();
  if(!row)throw new AppError(404,'not_found');return row;
}
async function rights(db,ctx,row) {
  const permission=row.visibility==='SECTION'?'tasks.section.manage':row.visibility==='GROUP'?'tasks.group.manage':null;
  const manager=permission?(await authorize(db,ctx,{permission,...(row.section_id?{sectionId:row.section_id}:{})})).allow:row.owner_id===ctx.userId;
  const assigned=!!await db.prepare('SELECT 1 FROM task_member WHERE task_id=? AND user_id=? AND responsible=1').bind(row.id,ctx.userId).first();
  return {edit:manager,complete:manager||assigned};
}
const project=row=>({id:row.id,title:row.title,description:row.description,visibility:row.visibility,sectionId:row.section_id,
  ownerId:row.owner_id,dueDate:row.due_date,dueTime:row.due_time,recurrence:row.recurrence,status:row.status,
  createdAt:row.created_at,updatedAt:row.updated_at,completedAt:row.completed_at,completedBy:row.completed_by,version:row.version});
export async function taskDetail(db,ctx,requestId,id) {
  const row=await load(db,ctx,id);
  const members=(await db.prepare(`SELECT m.user_id AS userId,u.display_name AS name,m.responsible FROM task_member m
    JOIN app_user u ON u.id=m.user_id WHERE m.task_id=? ORDER BY u.display_name`).bind(id).all()).results;
  return {task:{...project(row),members:members.map(m=>({...m,responsible:!!m.responsible}))},actions:await rights(db,ctx,row)};
}
export async function listTasks(db,ctx,requestId,params,now=Date.now()) {
  const view=params.get('view')||'mine',status=params.get('status'),from=params.get('from'),to=params.get('to'),cursor=params.get('cursor');
  const sectionId=params.get('sectionId');
  if(!['mine','today','upcoming','shared','completed','section','group','all'].includes(view) ||
    (status&&!['PENDING','COMPLETED'].includes(status)) || (from&&!day(from)) || (to&&!day(to)) ||
    (cursor&&!validUuid(cursor)) || (sectionId&&!validUuid(sectionId)))throw new AppError(400,'invalid_filter');
  const access=await scope(db,ctx),where=['t.archived_at IS NULL',access.sql],binds=[...access.binds];
  if(view==='mine'){where.push('(t.owner_id=? OR EXISTS(SELECT 1 FROM task_member m WHERE m.task_id=t.id AND m.user_id=? AND m.responsible=1))');binds.push(ctx.userId,ctx.userId);}
  if(view==='shared')where.push("t.visibility!='PERSONAL'");
  if(view==='section')where.push("t.visibility='SECTION'");
  if(view==='group')where.push("t.visibility='GROUP'");
  if(view==='today'){where.push('t.due_date=?');binds.push(madridDay(now));}
  if(view==='upcoming'){where.push("t.due_date>=? AND t.status='PENDING'");binds.push(madridDay(now));}
  if(status||view==='completed'){where.push('t.status=?');binds.push(status||'COMPLETED');}
  if(from){where.push('t.due_date>=?');binds.push(from);}
  if(to){where.push('t.due_date<=?');binds.push(to);}
  if(sectionId){where.push('t.section_id=?');binds.push(sectionId);}
  if(cursor){where.push('t.id>?');binds.push(cursor);}
  const limit=Math.min(100,Math.max(1,Number(params.get('limit'))||50));
  const rows=(await db.prepare(`SELECT t.* FROM task t WHERE ${where.join(' AND ')} ORDER BY t.id LIMIT ?`).bind(...binds,limit+1).all()).results;
  const selected=rows.slice(0,limit);
  return {tasks:await Promise.all(selected.map(async row=>({...project(row),actions:await rights(db,ctx,row)}))),
    nextCursor:rows.length>limit?selected.at(-1).id:null,today:madridDay(now)};
}
export async function taskSummary(db,ctx,now=Date.now()) {
  const access=await scope(db,ctx);
  return db.prepare(`SELECT count(CASE WHEN t.status='PENDING' AND t.due_date=? THEN 1 END) AS today,
    count(CASE WHEN t.status='PENDING' AND (t.due_date<? OR (t.due_date=? AND t.due_time<?)) THEN 1 END) AS overdue,
    count(CASE WHEN t.status='PENDING' AND (t.owner_id=? OR EXISTS(SELECT 1 FROM task_member m
      WHERE m.task_id=t.id AND m.user_id=? AND m.responsible=1)) THEN 1 END) AS assigned
    FROM task t WHERE t.archived_at IS NULL AND ${access.sql}`)
    .bind(madridDay(now),madridDay(now),madridDay(now),madridTime(now),ctx.userId,ctx.userId,...access.binds).first();
}
export async function editTask(db,ctx,requestId,id,input,now=Date.now()) {
  const row=await load(db,ctx,id),actions=await rights(db,ctx,row);
  if(!actions.edit)throw new AppError(403,'forbidden');
  const value=validate(input);
  if(row.owner_id!==ctx.userId && ['PERSONAL','NAMED'].includes(value.visibility))throw new AppError(403,'forbidden');
  if(input.expectedVersion!==row.version)throw new AppError(409,'stale_task');
  await eligible(db,ctx,requestId,value);
  await commit(db,[db.prepare(`UPDATE task SET title=?,description=?,visibility=?,section_id=?,due_date=?,due_time=?,
    recurrence=?,recurrence_day=?,updated_at=?,${versionCas('version')} WHERE id=?`).bind(value.title,value.description,
      value.visibility,value.sectionId,value.dueDate,value.dueTime,value.recurrence,value.recurrence?Number(value.dueDate.slice(-2)):null,
      now,input.expectedVersion,id),db.prepare('DELETE FROM task_member WHERE task_id=?').bind(id),
    ...memberStatements(db,id,value.members),audit(db,ctx,requestId,'TASK_UPDATED',id,now),
    audit(db,ctx,requestId,'TASK_SHARED',id,now),audit(db,ctx,requestId,'TASK_ASSIGNED',id,now)]);
  return {id};
}
export function nextDue(date,recurrence,anchor=Number(date.slice(-2))) {
  const d=new Date(date+'T12:00:00Z');
  if(recurrence==='MONTHLY') {d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+1);const end=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(anchor,end));}
  else d.setUTCDate(d.getUTCDate()+(recurrence==='WEEKLY'?7:1));
  return d.toISOString().slice(0,10);
}
export async function transitionTask(db,ctx,requestId,id,action,input,now=Date.now()) {
  const row=await load(db,ctx,id),actions=await rights(db,ctx,row);
  if(!(action==='archive'?actions.edit:actions.complete))throw new AppError(403,'forbidden');
  if(!input||Object.keys(input).some(k=>k!=='expectedVersion')||input.expectedVersion!==row.version)throw new AppError(409,'stale_task');
  const completed=action==='complete';
  if(action!=='archive'&&row.status===(completed?'COMPLETED':'PENDING'))throw new AppError(409,'invalid_task_transition');
  const statements=[db.prepare(`UPDATE task SET status=?,completed_at=?,completed_by=?,archived_at=?,updated_at=?,
    ${versionCas('version')} WHERE id=?`).bind(action==='archive'?row.status:completed?'COMPLETED':'PENDING',
    action==='archive'?row.completed_at:completed?now:null,action==='archive'?row.completed_by:completed?ctx.userId:null,
    action==='archive'?now:null,now,input.expectedVersion,id),audit(db,ctx,requestId,action==='archive'?'TASK_ARCHIVED':
      completed?'TASK_COMPLETED':'TASK_REOPENED',id,now)];
  if(completed&&row.recurrence) {
    const next=crypto.randomUUID(),due=nextDue(row.due_date,row.recurrence,row.recurrence_day);
    statements.push(db.prepare(`INSERT OR IGNORE INTO task(id,owner_id,title,description,visibility,section_id,due_date,due_time,recurrence,
      recurrence_day,previous_id,created_at,updated_at,request_key,request_hash)
      SELECT ?,owner_id,title,description,visibility,section_id,?,due_time,recurrence,recurrence_day,id,?,?,?,request_hash FROM task WHERE id=?`)
      .bind(next,due,now,now,next,id),
      db.prepare(`INSERT INTO task_member(task_id,user_id,responsible) SELECT ?,user_id,responsible FROM task_member
        WHERE task_id=? AND EXISTS(SELECT 1 FROM task WHERE id=?)`).bind(next,id,next));
  }
  await commit(db,statements);return {id};
}
