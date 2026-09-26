import test from 'node:test';
import assert from 'node:assert/strict';
import { statement, queryAuthorized, retentionDeleteStatement } from '../gestio/src/domains/audit/repository.js';
import { runRetention } from '../gestio/src/services/audit-service.js';
import { listScoped, findScoped } from '../gestio/src/domains/participants/repository.js';

const id=()=>crypto.randomUUID();
const fakeDb=() => {
  const calls=[];
  return {calls,prepare(sql){
    const item={sql,values:[]};calls.push(item);
    return {bind(...values){item.values=values;return this;},async all(){return {results:[]};},async first(){return null;},async run(){return {meta:{changes:1}};}};
  },async batch(items){return items.map(()=>({meta:{changes:1}}));}};
};

test('audit repository: taxonomy, metadata allowlist, filters and cursor bounded', async () => {
  const db=fakeDb(), requestId=id();
  statement(db,{requestId,action:'AUTHZ_DENY',resourceType:'participant',resourceId:id(),result:'DENY',reasonCode:'OUT_OF_SCOPE',metadata:{count:1}});
  assert.match(db.calls.at(-1).sql,/INSERT INTO audit_event/);
  assert.equal(db.calls.at(-1).values[11],'{"count":1}');
  for (const forbidden of ['password','token','cookie','jwt','dni','allergy','medication','diagnosis','requestBody']) {
    assert.throws(()=>statement(db,{requestId,action:'AUTHZ_DENY',metadata:{[forbidden]:'CANARY_SECRET'}}),/AUDIT_METADATA_REJECTED/);
  }
  assert.throws(()=>statement(db,{requestId,action:'UNKNOWN'}),/AUDIT_EVENT_REJECTED/);
  await assert.rejects(queryAuthorized(db,{limit:51}),/INVALID_AUDIT_FILTER/);
  await assert.rejects(queryAuthorized(db,{actorId:"x' OR 1=1 --"}),/INVALID_AUDIT_FILTER/);
  await assert.rejects(queryAuthorized(db,{cursor:'invalid'}),/INVALID_AUDIT_CURSOR/);
  const page=await queryAuthorized(db,{limit:3,action:'AUTHZ_DENY'});
  assert.deepEqual(page,{events:[],nextCursor:null});
  assert.match(db.calls.at(-1).sql,/action=\?/);
  assert.equal(db.calls.at(-1).values.at(-1),4);
});

test('participant repository: fail closed and always SQL-scoped', async () => {
  const db=fakeDb();
  await assert.rejects(listScoped(db,{allow:false}),/PARTICIPANT_SCOPE_REQUIRED/);
  await assert.rejects(findScoped(db,{allow:false},id()),/PARTICIPANT_SCOPE_REQUIRED/);
  assert.equal(db.calls.length,0);
  await listScoped(db,{allow:true,sections:[id()]});
  assert.match(db.calls.at(-1).sql,/current_section_id/);
  assert.ok(db.calls.at(-1).values.length>0);
  await findScoped(db,{allow:true,sections:[id()]},id());
  assert.match(db.calls.at(-1).sql,/current_section_id/);
});

test('retention disabled by default; enabled job uses held-event exclusion', async () => {
  const db=fakeDb(), requestId=id();
  db.prepare=(sql)=>({bind(...values){return {async first(){return {enabled:0,retention_ms:null};},sql,values};}});
  assert.deepEqual(await runRetention(db,{requestId}),{auditDeleted:0,sessionsDeleted:0,enabled:false});
  let sql='';
  retentionDeleteStatement({prepare(query){sql=query;return {bind(){return null;}};}},100);
  assert.match(sql,/incident_audit_hold/);
  assert.match(sql,/released_at IS NULL/);
  assert.throws(()=>retentionDeleteStatement(db,-1),/INVALID_RETENTION_CUTOFF/);
});
