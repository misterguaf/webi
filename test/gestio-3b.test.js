import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBackup, restoreBackup } from '../gestio/scripts/recovery.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const wrangler=resolve(root,'node_modules/.bin/wrangler');
const running=new Map();
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const pdf=Buffer.from('%PDF-1.4\n%synthetic annual-fee fixture\n1 0 obj <<>> endobj\n%%EOF');
const evidence={nom:'justificant-sintetic.pdf',tipus:'application/pdf',base64:pdf.toString('base64')};
function run(cwd,args) {
  const result=spawnSync(wrangler,args,{cwd,encoding:'utf8',maxBuffer:8*1024*1024,env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
  assert.equal(result.status,0,(result.stderr||result.stdout||'').slice(-1800));return result.stdout;
}
function rows(cwd,state,sql) {
  return JSON.parse(run(cwd,['d1','execute','parpallo-gestio-local','--local','--persist-to',state,
    '--config','wrangler.toml','--command',sql,'--json']))[0].results;
}
async function freePort() {const server=createServer();await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const port=server.address().port;await new Promise(done=>server.close(done));return port;}
async function start(cwd,state,path,environment=null,registry=null) {
  const port=await freePort(),base='http://127.0.0.1:'+port;
  let inspectorPort=await freePort();while(inspectorPort===port)inspectorPort=await freePort();
  const args=['dev','--local','--persist-to',state,'--config','wrangler.toml'];
  if(environment)args.push('--env',environment);
  args.push('--ip','127.0.0.1','--port',String(port),'--inspector-port',String(inspectorPort));
  // A private dev registry makes the portal's service binding resolve to this test's Gestió only.
  const child=spawn(wrangler,args,{cwd,env:{...process.env,WRANGLER_SEND_METRICS:'false',
    ...(registry?{WRANGLER_REGISTRY_PATH:registry}:{})}});
  let logs='';child.stdout.on('data',chunk=>{logs+=chunk.toString();});child.stderr.on('data',chunk=>{logs+=chunk.toString();});
  const until=Date.now()+25_000;
  while(Date.now()<until){if(child.exitCode!==null)break;
    try{if((await fetch(base+path,{signal:AbortSignal.timeout(2000)})).ok){
      running.set(base,()=>`exit=${child.exitCode} logs=${logs.slice(-2500)}`);return {child,base};
    }}catch{}
    await new Promise(done=>setTimeout(done,100));}
  child.kill('SIGTERM');throw new Error('Worker unavailable: '+logs.slice(-3000));
}
async function stop(worker) {if(!worker)return;running.delete(worker.base);worker.child.kill('SIGTERM');
  await new Promise(done=>{if(worker.child.exitCode!==null)return done();
    const timer=setTimeout(()=>worker.child.kill('SIGKILL'),5000);worker.child.once('exit',()=>{clearTimeout(timer);done();});});
  await stop(worker.host);}
// The portal has no D1/R2 binding (audit A1): it needs the Gestió PortalIntake entrypoint running.
async function startPortal(portalDir,gestioDir,state,registry) {
  const host=await start(gestioDir,state,'/api/dev/identities',null,registry);
  try {return {...await start(portalDir,state,'/','local',registry),host};}
  catch(error){await stop(host);throw error;}
}
async function request(base,path,{method='GET',cookie='',csrf='',body,origin=base,ip='192.0.2.1'}={}) {
  let response;
  try {response=await fetch(base+path,{method,signal:AbortSignal.timeout(15_000),headers:{
    ...(cookie?{Cookie:cookie}:{}),...(method!=='GET'?{Origin:origin}:{}),
    ...(csrf?{'X-CSRF-Token':csrf}:{}),'CF-Connecting-IP':ip,
    ...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body!==undefined?JSON.stringify(body):undefined});}
  catch(error){throw new Error(`${method} ${path} connection failed: ${error?.cause?.code||error?.message||error}; ${running.get(base)?.()||'worker unknown'}`);}
  let data=null;try{data=await response.json();}catch{}
  return {status:response.status,data,cookie:response.headers.get('set-cookie')};
}
async function getText(base,path) {
  try {const response=await fetch(base+path,{signal:AbortSignal.timeout(15_000)});
    return {status:response.status,body:await response.text()};}
  catch(error){throw new Error(`GET ${path} connection failed: ${error?.cause?.code||error?.message||error}; ${running.get(base)?.()||'worker unknown'}`);}
}
const child=(name,birthDate,section)=>{const words=name.split(' ');return {nom:words.shift(),cognoms:words.join(' '),naixement:birthDate,seccio:section};};
const submission=(children,extra={})=>({roundCode:'2026/2027',fills:children,tutor:'Persona remitent fictícia',
  telefon:'600123456',email:'fee-receipt@example.test',declaredAmountCents:50000,privacitat:true,
  idempotencyKey:crypto.randomUUID().replaceAll('-',''),malnom:'',_ts:'',comprovant:evidence,...extra});
const as=(base,cookie,path,body,method='POST')=>request(base,path,{cookie,method,body});

test('FASE 3B: annual fees, authorization, payments, allocations, outbox and restore', {timeout:240_000},async()=>{
  const temp=mkdtempSync(join(tmpdir(),'parpallo-3b-'));
  const gestio=join(temp,'gestio'),portal=join(temp,'portal');
  cpSync(resolve(root,'gestio'),gestio,{recursive:true,filter:path=>!path.split('/').includes('.wrangler')});
  symlinkSync(resolve(root,'node_modules'),join(temp,'node_modules'));
  cpSync(resolve(root,'portal'),portal,{recursive:true});
  mkdirSync(join(temp,'api'),{recursive:true});
  cpSync(resolve(root,'api/_lib'),join(temp,'api/_lib'),{recursive:true});
  const state=join(gestio,'.wrangler','state'),registry=join(temp,'wrangler-registry');let worker;
  try {
    run(gestio,['d1','migrations','apply','parpallo-gestio-local','--local','--persist-to',state,'--config','wrangler.toml']);
    run(gestio,['d1','execute','parpallo-gestio-local','--local','--persist-to',state,'--config','wrangler.toml','--file','seed.sql','--yes']);
    run(gestio,['d1','execute','parpallo-gestio-local','--local','--persist-to',state,'--config','wrangler.toml','--command',
      `INSERT INTO participant(id,display_name,current_section_id,status,birth_date) VALUES
      ('${id(953)}','Alba Prova (ficticio)','${id(2)}','ACTIVE','2013-01-01'),
      ('${id(954)}','Bruna Prova (ficticio)','${id(2)}','ACTIVE','2013-02-02');
      INSERT INTO participant_contact(participant_id,notification_email,verified_at) VALUES
      ('${id(953)}','same-family-contact@example.test',1700000000000),
      ('${id(954)}','same-family-contact@example.test',1700000000000)`,'--yes']);
    assert.equal(rows(gestio,state,'SELECT count(*) AS n FROM annual_fee_round')[0].n,1);
    assert.equal(rows(gestio,state,'SELECT count(*) AS n FROM annual_fee_obligation')[0].n,0);
    assert.equal(rows(gestio,state,'SELECT count(*) AS n FROM annual_fee_family_group')[0].n,0);
    worker=await start(gestio,state,'/api/dev/identities');
    const gestioPage=await getText(worker.base,'/');assert.equal(gestioPage.status,200);
    assert.match(gestioPage.body,/feePanel|Quota anual/);
    const feeUi=await getText(worker.base,'/fees.js');assert.equal(feeUi.status,200);
    assert.match(feeUi.body,/setupFees/);
    const login=async subject=>{const row=await as(worker.base,'','/api/dev/login',{subject});assert.equal(row.status,200);
      return row.cookie.split(';')[0];};
    const group=await login('seed-101'),treasury=await login('seed-104'),tech=await login('seed-107');
    const round=id(901);
    assert.equal((await request(worker.base,'/api/fees/rounds',{cookie:tech})).status,403);
    assert.equal((await request(worker.base,'/api/fees/rounds',{cookie:treasury})).status,200);
    const future=await as(worker.base,treasury,'/api/fees/rounds',{code:'2027/2028',isOpen:false,
      baseCents:12000,deadlineAt:null,accountHolder:'Titular fictici alternatiu',
      iban:'ES0000000000000000000000',conceptTemplate:'Cuota Anual {Nombre educando}'});
    assert.equal(future.status,201,'a future round must be data-configurable');
    assert.equal((await request(worker.base,'/api/fees/rounds',{cookie:treasury})).data.rounds
      .find(row=>row.id===future.data.id).base_cents,12000);
    let futureObligationId='';
    for(const participantId of [id(953),id(954)]) {
      const noInference=await as(worker.base,treasury,'/api/fees/obligations',
        {roundId:future.data.id,participantId});
      assert.equal(noInference.status,201);assert.equal(noInference.data.amountDueCents,12000);
      assert.equal(noInference.data.siblingOrdinal,1,'shared surname/email are not sibling evidence');
      if(!futureObligationId)futureObligationId=noInference.data.id;
    }
    assert.equal((await request(worker.base,`/api/fees/rounds/${future.data.id}/groups`,{cookie:treasury})).data.groups.length,0);
    assert.equal((await as(worker.base,treasury,`/api/fees/rounds/${future.data.id}`,{baseCents:13000},'PATCH')).status,200);
    const futureHistory=await request(worker.base,`/api/fees/rounds/${future.data.id}/revisions`,{cookie:treasury});
    assert.equal(futureHistory.status,200);assert.equal(futureHistory.data.revisions[0].previous_base_cents,12000);
    assert.equal(futureHistory.data.revisions[0].new_base_cents,13000);
    assert.equal((await request(worker.base,`/api/fees/obligations/${futureObligationId}`,{cookie:treasury})).data.obligation.amount_due_cents,12000,
      'a future round price change must not silently rewrite existing obligations');
    assert.equal((await as(worker.base,treasury,`/api/fees/obligations/${futureObligationId}`,
      {amountDueCents:13000},'PATCH')).status,200);
    const amountHistory=await request(worker.base,`/api/fees/obligations/${futureObligationId}`,{cookie:treasury});
    assert.equal(amountHistory.data.amountRevisions[0].previous_amount_cents,12000);
    assert.equal(amountHistory.data.amountRevisions[0].new_amount_cents,13000);
    assert.equal((await as(worker.base,treasury,`/api/fees/rounds/${round}`,{deadlineAt:Date.now()-86_400_000},'PATCH')).status,200);
    const groupResult=await as(worker.base,treasury,'/api/fees/groups',{
      roundId:round,reference:'DEMO-SIBLINGS-001',participantIds:[id(501),id(502),id(503),id(504),id(505)]});
    assert.equal(groupResult.status,201);
    const obligationIds=new Map();
    for(let ordinal=1;ordinal<=5;ordinal++) {
      const result=await as(worker.base,treasury,'/api/fees/obligations',{roundId:round,participantId:id(500+ordinal)});
      assert.equal(result.status,201);assert.equal(result.data.siblingOrdinal,ordinal);
      assert.equal(result.data.amountDueCents,ordinal<3?10000:5000);
      obligationIds.set(500+ordinal,result.data.id);
    }
    const obligationId=n=>obligationIds.get(n);
    assert.equal((await request(worker.base,`/api/fees/rounds/${round}/groups`,{cookie:treasury})).data.groups.length,5);
    assert.equal((await as(worker.base,tech,`/api/fees/obligations/${obligationId(501)}/installments`,
    {parts:[{amountCents:5000},{amountCents:5000}]})).status,403);
    assert.equal((await as(worker.base,treasury,`/api/fees/obligations/${obligationId(501)}/installments`,
      {parts:[{amountCents:5000},{amountCents:5000}]})).status,201);
    assert.equal((await as(worker.base,group,`/api/fees/obligations/${obligationId(502)}/installments`,
      {parts:[{amountCents:3000,targetAt:null},{amountCents:7000,targetAt:null}]})).status,201);
    assert.equal((await as(worker.base,group,`/api/fees/obligations/${obligationId(503)}/installments`,
      {parts:[{amountCents:2500},{amountCents:2500}],reason:'motiu familiar'})).status,400,
    'a correction reason requires an existing plan target');
    assert.equal((await as(worker.base,treasury,`/api/fees/obligations/${obligationId(503)}/installments`,
      {parts:[{amountCents:2000},{amountCents:2000},{amountCents:1000}]})).status,201);
    const firstPlan=(await request(worker.base,`/api/fees/obligations/${obligationId(501)}`,{cookie:treasury})).data.installmentPlan;
    const secondPlan=(await request(worker.base,`/api/fees/obligations/${obligationId(502)}`,{cookie:treasury})).data.installmentPlan;
    const thirdPlan=(await request(worker.base,`/api/fees/obligations/${obligationId(503)}`,{cookie:treasury})).data.installmentPlan;
    assert.equal([...firstPlan.parts,...secondPlan.parts].filter(part=>part.target_at===null).length,4);
    assert.deepEqual(thirdPlan.parts.map(part=>part.planned_cents),[2000,2000,1000]);
    await stop(worker);worker=null;

    worker=await startPortal(portal,gestio,state,registry);
    assert.equal((await getText(worker.base,'/')).status,200);
    assert.match(readFileSync(join(portal,'public/index.html'),'utf8'),/fee-form|quota/);
    const auth=await request(worker.base,'/api/portal/session',{method:'POST',body:{password:'families-demo'}});
    assert.equal(auth.status,200);const cookie=auth.cookie.split(';')[0],csrf=auth.data.csrf;
    const config=await request(worker.base,'/api/portal/config',{cookie});assert.equal(config.status,200);
    assert.equal(config.data.quota.baseCents,10000);assert.ok(config.data.quota.deadlineAt<Date.now());
    const children=[child('Participante Manada A (ficticio)','2017-06-12','EST'),
      child('Participante Tropa A (ficticio)','2013-05-18','TRO'),
      child('Participante Tropa B (ficticio)','2012-11-03','TRO')];
    const original=submission(children);const send=(body,ip,token=csrf,origin=worker.base)=>request(worker.base,'/api/cuota',
      {method:'POST',cookie,csrf:token,origin,ip,body});
    assert.equal((await send(original,'192.0.2.10','')).status,403);
    assert.equal((await send(original,'192.0.2.11',csrf,'https://evil.invalid')).status,403);
    assert.equal((await send({...original,comprovant:undefined},'192.0.2.12')).status,400);
    assert.equal((await send({...original,comprovant:{...evidence,nom:'../evidence.png'}},'192.0.2.13')).status,400);
    assert.equal((await send({...original,fills:[null]},'192.0.2.14')).status,400);
    assert.equal((await send({...original,priceCents:1},'192.0.2.15')).status,400);
    const submitted=await send(original,'192.0.2.16');assert.equal(submitted.status,202);
    assert.equal((await send(original,'192.0.2.17')).status,202);
    assert.equal(submitted.data.referencia,(await send(original,'192.0.2.18')).data.referencia);
    const ambiguousName='Participant Doble (ficticio)';
    await stop(worker);worker=null;
    assert.equal(rows(gestio,state,'SELECT count(*) AS n FROM annual_fee_payment')[0].n,1);
    run(gestio,['d1','execute','parpallo-gestio-local','--local','--persist-to',state,'--config','wrangler.toml','--command',
      `INSERT INTO participant(id,display_name,current_section_id,status,birth_date) VALUES
      ('${id(951)}','${ambiguousName}','${id(2)}','ACTIVE','2013-05-18'),
      ('${id(952)}','${ambiguousName}','${id(2)}','ACTIVE','2013-05-18')`,'--yes']);
    worker=await startPortal(portal,gestio,state,registry);
    const again=await request(worker.base,'/api/portal/session',{method:'POST',body:{password:'families-demo'}});
    const cookie2=again.cookie.split(';')[0],csrf2=again.data.csrf;
    const send2=(body,ip)=>request(worker.base,'/api/cuota',{method:'POST',cookie:cookie2,csrf:csrf2,ip,body});
    const ambiguous=await send2(submission([child(ambiguousName,'2013-05-18','TRO')]),'192.0.2.21');
    const missing=await send2(submission([child('Persona Inexistent (fictícia)','2013-05-18','TRO')]),'192.0.2.22');
    assert.equal(ambiguous.status,202);assert.equal(missing.status,202);
    assert.equal(ambiguous.data.message.va,missing.data.message.va);
    assert.doesNotMatch(JSON.stringify(ambiguous.data),/candidate|participantId|matchStatus/i);
    assert.equal((await send2(submission([children[1]],{declaredAmountCents:1}),'192.0.2.23')).status,202);
    await stop(worker);worker=null;
    assert.equal(rows(gestio,state,`SELECT count(*) AS n FROM annual_fee_family_group WHERE round_id='${round}'`)[0].n,1,
      'same receipt email and phone on multiple submissions must not create a family group');

    worker=await start(gestio,state,'/api/dev/identities');
    const treasury2=await login('seed-104'),group2=await login('seed-101');
    const payments=await request(worker.base,`/api/fees/rounds/${round}/payments`,{cookie:treasury2});
    assert.equal(payments.status,200);assert.equal(payments.data.payments.length,4);
    const primary=payments.data.payments.find(row=>row.id===submitted.data.referencia);
    assert.equal(primary.pending_matches,0);assert.equal(primary.verified_amount_cents,null);
    const delegate=await login('seed-105'),tech2=await login('seed-107');
    assert.equal((await request(worker.base,`/api/fees/rounds/${round}/payments`,{cookie:delegate})).status,403);
    const delegated=await as(worker.base,tech2,'/api/delegations',{userId:id(105),
      permissionCode:'finance.fee.payment.review',sectionId:id(2),authorizedBy:id(101),
      authorizationReference:'DEMO-FEE-TROPA-001',expiresAt:Date.now()+7*86_400_000});
    assert.equal(delegated.status,201);
    assert.equal((await request(worker.base,`/api/fees/rounds/${round}/payments`,{cookie:delegate})).status,403,
      'a pending fee-review delegation is not effective');
    assert.equal((await request(worker.base,'/api/fees/review-rounds',{cookie:delegate})).status,403);
    assert.equal((await as(worker.base,group2,`/api/delegations/${delegated.data.id}/confirm`,{})).status,200,
      'named authoriser confirms before ratification (M3)');
    assert.equal((await as(worker.base,group2,`/api/delegations/${delegated.data.id}/ratify`,
      {ratificationReference:'DEMO-FEE-RATIFIED-001'})).status,200);
    const scoped=await request(worker.base,`/api/fees/rounds/${round}/payments`,{cookie:delegate});
    assert.equal(scoped.status,200);assert.ok(!scoped.data.payments.some(row=>row.id===primary.id),
      'a Tropa delegate cannot see a multi-section payment');
    const reviewRounds=await request(worker.base,'/api/fees/review-rounds',{cookie:delegate});
    assert.equal(reviewRounds.status,200);assert.deepEqual(Object.keys(reviewRounds.data.rounds[0]).sort(),['code','id']);
    const pendingId=scoped.data.payments.find(row=>row.pending_matches>0).id;
    const pendingDetail=await request(worker.base,`/api/fees/payments/${pendingId}`,{cookie:delegate});
    assert.equal(pendingDetail.status,200);
    const candidates=await request(worker.base,`/api/fees/people/${pendingDetail.data.people[0].id}/candidates`,{cookie:delegate});
    assert.equal(candidates.status,200);
    assert.ok(candidates.data.candidates.some(person=>person.id===id(502)));
    assert.ok(!candidates.data.candidates.some(person=>person.id===id(501)),
      'delegated candidate search remains section-scoped');
    assert.equal((await request(worker.base,`/api/fees/payments/${primary.id}`,{cookie:delegate})).status,404,
      'audit L1: an out-of-scope payment is not confirmed to exist');
    assert.equal((await as(worker.base,group2,`/api/delegations/${delegated.data.id}/revoke`,{})).status,200);
    assert.equal((await request(worker.base,`/api/fees/rounds/${round}/payments`,{cookie:delegate})).status,403);
    const detail=await request(worker.base,`/api/fees/payments/${primary.id}`,{cookie:treasury2});
    assert.equal(detail.status,200);assert.equal(detail.data.people.length,3);
    assert.ok(detail.data.people.every(person=>person.match_status==='CLEAR' && !('submitted_birth_date' in person)));
    assert.equal((await request(worker.base,`/api/fees/evidence/${primary.evidence_id}`,{cookie:treasury2})).status,200);
    assert.equal((await as(worker.base,treasury2,`/api/fees/payments/${primary.id}/review`,
      {verifiedAmountCents:20000,allocations:[{obligationId:obligationId(501),amountCents:10000},
        {obligationId:obligationId(502),amountCents:5000},{obligationId:obligationId(503),amountCents:6000}]})).status,400,
    'allocation sum above verified amount must be rejected atomically');
    assert.equal((await request(worker.base,`/api/fees/payments/${primary.id}`,{cookie:treasury2})).data.allocations.length,0);
    assert.equal((await as(worker.base,treasury2,`/api/fees/payments/${primary.id}/review`,
      {verifiedAmountCents:20000,allocations:[{obligationId:obligationId(501),amountCents:10000},
        {obligationId:obligationId(502),amountCents:4500},{obligationId:obligationId(503),amountCents:5500}]})).status,200);
    const states=(await request(worker.base,`/api/fees/rounds/${round}/obligations`,{cookie:treasury2})).data.obligations;
    assert.deepEqual(states.sort((a,b)=>a.participant_id.localeCompare(b.participant_id)).map(row=>row.status),
      ['PAID','PARTIAL','ISSUE','PENDING','PENDING']);
    const opened=(await request(worker.base,`/api/fees/rounds/${round}/issues`,{cookie:treasury2})).data.issues;
    assert.equal(opened.filter(row=>row.code==='OVERPAYMENT' && row.status==='OPEN').length,1);
    const low=payments.data.payments.find(row=>row.declared_amount_cents===1);
    assert.equal((await as(worker.base,treasury2,`/api/fees/payments/${low.id}/review`,
      {verifiedAmountCents:5000,allocations:[{obligationId:obligationId(502),amountCents:5000}]})).status,200,
    'declared amount must not control verified amount');
    assert.equal((await request(worker.base,`/api/fees/obligations/${obligationId(502)}`,{cookie:treasury2})).data.obligation.status,'PARTIAL');
    assert.equal((await as(worker.base,treasury2,'/api/dev/notifications/drain',{})).status,403);
    const firstDrain=await as(worker.base,group2,'/api/dev/notifications/drain',{});
    assert.equal(firstDrain.status,200);
    assert.equal(firstDrain.data.sent,7,'five fee notices plus two seeded activity notices; the disputed confirmation remains queued');
    const metrics=await request(worker.base,`/api/fees/rounds/${round}/metrics`,{cookie:treasury2});
    assert.equal(metrics.status,200);assert.equal(metrics.data.metrics.expectedCents,35000);
    assert.equal(metrics.data.metrics.verifiedAllocatedCents,25000);
    assert.equal((await request(worker.base,`/api/fees/rounds/${round}/metrics`,{cookie:await login('seed-107')})).status,403);
    const issue=opened.find(row=>row.code==='OVERPAYMENT').id;
    assert.equal((await as(worker.base,treasury2,`/api/fees/issues/${issue}/resolve`,{})).status,200);
    assert.equal((await request(worker.base,`/api/fees/obligations/${obligationId(503)}`,{cookie:treasury2})).data.obligation.status,'ISSUE',
      'excess allocation still requires a financial correction after closing its workflow issue');
    assert.equal((await as(worker.base,treasury2,`/api/fees/payments/${primary.id}/allocations`,
      {expectedVersion:detail.data.payment.allocation_version,allocations:[{obligationId:obligationId(501),amountCents:10000},
        {obligationId:obligationId(502),amountCents:5000},{obligationId:obligationId(503),amountCents:5000}]},'PATCH')).status,200);
    const revisedDetail=await request(worker.base,`/api/fees/payments/${primary.id}`,{cookie:treasury2});
    assert.equal(revisedDetail.data.allocationRevisions.length,2);
    const child503Revision=revisedDetail.data.allocationRevisions.find(row=>row.obligation_id===obligationId(503));
    assert.equal(child503Revision.previous_amount_cents,5500);
    assert.equal(child503Revision.new_amount_cents,5000);
    assert.equal((await request(worker.base,`/api/fees/obligations/${obligationId(503)}`,{cookie:treasury2})).data.obligation.status,'PAID');
    assert.equal((await request(worker.base,`/api/fees/obligations/${obligationId(502)}`,{cookie:treasury2})).data.obligation.status,'PAID');
    assert.equal((await as(worker.base,treasury2,`/api/fees/payments/${primary.id}/allocations`,
      {expectedVersion:revisedDetail.data.payment.allocation_version,allocations:[{obligationId:obligationId(501),amountCents:15000},
        {obligationId:obligationId(502),amountCents:5000},{obligationId:obligationId(503),amountCents:5000}]},'PATCH')).status,400);
    assert.equal((await request(worker.base,`/api/fees/obligations/${obligationId(501)}`,{cookie:treasury2})).data.obligation.allocated_cents,10000,
      'rejected revision must not change prior allocations');
    const finalDrain=await as(worker.base,group2,'/api/dev/notifications/drain',{});
    assert.equal(finalDrain.status,200);
    assert.equal(finalDrain.data.sent,1,'confirmation follows correction of the overpayment');
    await stop(worker);worker=null;
    assert.equal(rows(gestio,state,'SELECT count(*) AS n FROM annual_fee_notification_outbox')[0].n,5);
    assert.equal(rows(gestio,state,'SELECT count(*) AS n FROM annual_fee_notification_capture')[0].n,5);
    assert.equal(rows(gestio,state,'SELECT count(*) AS n FROM annual_fee_issue_outbox')[0].n,1);
    assert.equal(rows(gestio,state,'SELECT count(*) AS n FROM annual_fee_issue_capture')[0].n,1);
    for(const action of ['FEE_BASE_CHANGED','FEE_DEADLINE_CHANGED','FEE_AMOUNT_OVERRIDDEN'])
      assert.equal(rows(gestio,state,`SELECT count(*) AS n FROM audit_event WHERE action='${action}'`)[0].n,1,
        `${action} must leave one audit event`);
    assert.equal(rows(gestio,state,"SELECT count(*) AS n FROM audit_event WHERE action='FEE_ALLOCATION_REVISED'")[0].n,1);
    const backup=join(temp,'fee-backup'),restored=join(temp,'restored-state');
    createBackup(backup,join(gestio,'wrangler.toml'));
    restoreBackup(backup,restored,join(gestio,'wrangler.toml'));
    assert.equal(rows(gestio,restored,'PRAGMA foreign_key_check').length,0);
    assert.equal(rows(gestio,restored,`SELECT count(*) AS n FROM annual_fee_obligation o
      WHERE o.family_group_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM annual_fee_family_member m
        WHERE m.group_id=o.family_group_id AND m.round_id=o.round_id
          AND m.participant_id=o.participant_id AND m.sibling_ordinal=o.sibling_ordinal)`)[0].n,0);
    assert.equal(rows(gestio,restored,'SELECT count(*) AS n FROM annual_fee_payment')[0].n,4);
    assert.equal(rows(gestio,restored,'SELECT count(*) AS n FROM annual_fee_allocation')[0].n,4);
    assert.equal(rows(gestio,restored,'SELECT count(*) AS n FROM annual_fee_installment_plan')[0].n,3);
    assert.equal(rows(gestio,restored,'SELECT count(*) AS n FROM annual_fee_installment_part')[0].n,7);
    assert.equal(rows(gestio,restored,`SELECT status FROM annual_fee_obligation_status WHERE participant_id='${id(502)}'`)[0].status,'PAID');
    assert.equal(rows(gestio,restored,`SELECT status FROM annual_fee_obligation_status WHERE participant_id='${id(503)}'`)[0].status,'PAID');
    assert.equal(rows(gestio,restored,'SELECT count(*) AS n FROM annual_fee_issue')[0].n,1);
    assert.equal(rows(gestio,restored,'SELECT count(*) AS n FROM annual_fee_notification_capture')[0].n,5);
    assert.equal(rows(gestio,restored,'SELECT count(*) AS n FROM annual_fee_issue_capture')[0].n,1);
    assert.equal(rows(gestio,restored,'SELECT count(*) AS n FROM annual_fee_family_correction_gate')[0].n,0);
    assert.equal(rows(gestio,restored,`SELECT unallocated_cents FROM annual_fee_payment_balance WHERE id='${primary.id}'`)[0].unallocated_cents,0);
    assert.equal(rows(gestio,restored,'SELECT count(*) AS n FROM annual_fee_round_revision')[0].n,2);
    assert.equal(rows(gestio,restored,'SELECT count(*) AS n FROM annual_fee_amount_revision')[0].n,1);
    assert.equal(rows(gestio,restored,'SELECT count(*) AS n FROM annual_fee_allocation_revision')[0].n,2);
    assert.doesNotMatch(readFileSync(resolve(root,'portal/worker.js'),'utf8'),/handleQuota|SHEETS_WEBHOOK_URL|DriveApp/);
  } finally {await stop(worker);rmSync(temp,{recursive:true,force:true});}
});
