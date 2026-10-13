import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture,id } from './helpers/gestio-sqlite.js';
import { nextDue,madridDay } from '../gestio/src/services/task-service.js';
const input=(extra={})=>({title:'Preparar reunió fictícia',requestKey:crypto.randomUUID(),...extra});
async function setup(){const f=fixture();for(const n of [101,102,103,104,105,107])await f.login(n);return f;}
test('tasks: owner privacy, idempotent create, edits, stale changes, complete/reopen and archive',async()=>{
 const f=await setup();try{
  const value=input({dueDate:'2027-01-31',dueTime:'17:00'});
  const created=await f.request(102,'/api/tasks',{method:'POST',body:value});assert.equal(created.status,201,JSON.stringify(created.data));
  const path='/api/tasks/'+created.data.id;
  assert.equal((await f.request(102,'/api/tasks',{method:'POST',body:value})).data.id,created.data.id);
  for(const n of [101,103,107]){assert.equal((await f.request(n,path)).status,404);assert.equal((await f.request(n,'/api/tasks?view=all')).data.tasks.length,0);}
  assert.equal((await f.request(102,path,{method:'PATCH',body:{...value,title:'Nou títol fictici',expectedVersion:1}})).status,200);
  assert.equal((await f.request(102,path,{method:'PATCH',body:{...value,expectedVersion:1}})).status,409);
  assert.equal((await f.request(102,path+'/complete',{method:'POST',body:{expectedVersion:2}})).status,200);
  assert.equal((await f.request(102,path+'/reopen',{method:'POST',body:{expectedVersion:3}})).status,200);
  assert.equal((await f.request(102,path+'/archive',{method:'POST',body:{expectedVersion:4}})).status,200);
  assert.equal((await f.request(102,path)).status,404);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM task').get().n,1);
  assert.ok(!JSON.stringify(f.sql.prepare("SELECT * FROM audit_event WHERE resource_type='task'").all()).includes('Nou títol'));
 }finally{f.close();}
});
test('tasks: named sharing does not share sections; assignees complete but do not edit; inactive recipients refused',async()=>{
 const f=await setup();try{
  const created=await f.request(102,'/api/tasks',{method:'POST',body:input({visibility:'NAMED',members:[{userId:id(103),responsible:true}]})});
  assert.equal(created.status,201,JSON.stringify(created.data));const path='/api/tasks/'+created.data.id;
  assert.equal((await f.request(103,path)).status,200);assert.equal((await f.request(101,path)).status,404);
  assert.equal((await f.request(103,path,{method:'PATCH',body:input({expectedVersion:1})})).status,403);
  assert.equal((await f.request(103,path+'/complete',{method:'POST',body:{expectedVersion:1}})).status,200);
  f.sql.prepare("UPDATE app_user SET status='DISABLED' WHERE id=?").run(id(103));
  assert.equal((await f.request(103,path)).status,401);
  assert.equal((await f.request(102,'/api/tasks',{method:'POST',body:input({visibility:'NAMED',members:[{userId:id(103),responsible:true}]})})).status,400);
 }finally{f.close();}
});
test('tasks: section and group authority use current capability scope, TECH_ADMIN no bypass',async()=>{
 const f=await setup();try{
  const value=input({visibility:'SECTION',sectionId:id(2),members:[{userId:id(102),responsible:true}]});
  const created=await f.request(102,'/api/tasks',{method:'POST',body:value});assert.equal(created.status,201,JSON.stringify(created.data));
  const path='/api/tasks/'+created.data.id;
  assert.equal((await f.request(103,path)).status,404);assert.equal((await f.request(107,path)).status,404);
  assert.equal((await f.request(103,'/api/tasks',{method:'POST',body:value})).status,403);
  assert.equal((await f.request(102,'/api/tasks',{method:'POST',body:input({visibility:'GROUP'})})).status,403);
  const group=await f.request(101,'/api/tasks',{method:'POST',body:input({visibility:'GROUP'})});assert.equal(group.status,201);
  assert.equal((await f.request(102,'/api/tasks/'+group.data.id)).status,200);
  f.sql.prepare("UPDATE user_permission_grant SET revoked_at=? WHERE user_id=? AND permission_code='tasks.section.read'").run(Date.now(),id(102));
  assert.equal((await f.request(102,path)).status,404);
  assert.equal((await f.request(102,'/api/tasks?view=all')).data.tasks.some(t=>t.id===created.data.id),false);
 }finally{f.close();}
});
test('tasks: recurrence creates just one next occurrence; monthly anchor and Madrid dates are deterministic',async()=>{
 assert.equal(nextDue('2027-01-31','MONTHLY',31),'2027-02-28');assert.equal(nextDue('2027-02-28','MONTHLY',31),'2027-03-31');
 assert.equal(madridDay(Date.parse('2026-10-12T22:30:00Z')),'2026-10-13');
 const f=await setup();try{
  const created=await f.request(102,'/api/tasks',{method:'POST',body:input({dueDate:'2027-01-31',recurrence:'MONTHLY'})});
  const path='/api/tasks/'+created.data.id;
  assert.equal((await f.request(102,path+'/complete',{method:'POST',body:{expectedVersion:1}})).status,200);
  assert.equal((await f.request(102,path+'/complete',{method:'POST',body:{expectedVersion:1}})).status,409);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM task').get().n,2);
  assert.equal((await f.request(102,path+'/reopen',{method:'POST',body:{expectedVersion:2}})).status,200);
  assert.equal((await f.request(102,path+'/complete',{method:'POST',body:{expectedVersion:3}})).status,200);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM task').get().n,2);
  assert.equal((await f.request(102,'/api/tasks?view=all&from=2027-02-01&to=2027-02-28')).data.tasks[0].dueDate,'2027-02-28');
 }finally{f.close();}
});
