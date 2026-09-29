import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBackup, restoreBackup } from '../gestio/scripts/recovery.js';
import { validateSyntheticEvidence } from '../gestio/src/services/evidence-service.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const wrangler=resolve(root,'node_modules/.bin/wrangler');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
function run(cwd,args) {
  const result=spawnSync(wrangler,args,{cwd,encoding:'utf8',maxBuffer:8*1024*1024,
    env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
  assert.equal(result.status,0,(result.stderr||result.stdout||'').slice(-2200));
  return result.stdout;
}
function rows(cwd,state,sql) {
  return JSON.parse(run(cwd,['d1','execute','parpallo-gestio-local','--local','--persist-to',state,
    '--config','wrangler.toml','--command',sql,'--json']))[0].results;
}
async function freePort() {
  const server=createServer();await new Promise(resolveReady=>server.listen(0,'127.0.0.1',resolveReady));
  const port=server.address().port;await new Promise(resolveReady=>server.close(resolveReady));return port;
}
async function start(cwd,state,readyPath,environment=null,registry=null) {
  const port=await freePort(),base='http://127.0.0.1:'+port;
  let inspectorPort=await freePort();while(inspectorPort===port)inspectorPort=await freePort();
  const args=['dev','--local','--persist-to',state,'--config','wrangler.toml'];
  if(environment)args.push('--env',environment);
  args.push('--ip','127.0.0.1','--port',String(port),'--inspector-port',String(inspectorPort));
  // A private dev registry makes the portal's service binding resolve to this test's Gestió only.
  const child=spawn(wrangler,args,
    {cwd,env:{...process.env,WRANGLER_SEND_METRICS:'false',...(registry?{WRANGLER_REGISTRY_PATH:registry}:{})}});
  let logs='';child.stdout.on('data',chunk=>{logs+=chunk.toString();});child.stderr.on('data',chunk=>{logs+=chunk.toString();});
  const deadline=Date.now()+25_000;
  while(Date.now()<deadline){
    if(child.exitCode!==null)break;
    try{if((await fetch(base+readyPath,{signal:AbortSignal.timeout(2000)})).ok)return {child,base};}catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  child.kill('SIGTERM');throw new Error('Worker unavailable: '+logs);
}
async function stop(worker) {
  if(!worker)return;worker.child.kill('SIGTERM');
  await new Promise(resolveReady=>{if(worker.child.exitCode!==null)return resolveReady();
    const timer=setTimeout(()=>worker.child.kill('SIGKILL'),5000);
    worker.child.once('exit',()=>{clearTimeout(timer);resolveReady();});});
  await stop(worker.host);
}
// The portal has no D1/R2 binding (audit A1): it needs the Gestió PortalIntake entrypoint running.
async function startPortal(portalDir,gestioDir,state,registry) {
  const host=await start(gestioDir,state,'/api/dev/identities',null,registry);
  try {return {...await start(portalDir,state,'/','local',registry),host};}
  catch(error){await stop(host);throw error;}
}
async function request(base,path,{method='GET',cookie='',csrf='',body,origin=base,ip}={}) {
  let response;
  try{response=await fetch(base+path,{method,signal:AbortSignal.timeout(15000),headers:{...(cookie?{Cookie:cookie}:{}),
    ...(method!=='GET'?{Origin:origin}:{}),...(ip?{'CF-Connecting-IP':ip}:{}),
    ...(csrf?{'X-CSRF-Token':csrf}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},
    body:body!==undefined?JSON.stringify(body):undefined});}
  catch(error){throw new Error(`request ${method} ${path} failed to complete: ${error?.message||error}`);}
  let data=null;try{data=await response.json();}catch{}
  return {status:response.status,data,cookie:response.headers.get('set-cookie'),headers:response.headers};
}
const later=days=>Date.now()+days*24*60*60*1000;
const activity=(audience,sectionIds,priceCents=0,transportOptions=[])=>({
  name:'Activitat completament fictícia',audience,sectionIds,location:'Lloc fictici',
  startsAt:later(7),endsAt:later(8),registrationDeadline:later(6),priceCents,
  shortDescription:'Només una prova',materials:'',specialNotice:'',transportOptions
});
const portalInput=(publicCode,participantName,sectionCode='TRO',birthDate='2013-05-18',extra={})=>{
  const words=participantName.split(/\s+/);
  return {participantNom:words.shift(),participantCognoms:words.join(' '),naixement:birthDate,seccio:sectionCode,
    activitatId:publicCode,tutor:'Persona remitenta fictícia',telefon:'600123456',email:'sollicitant@example.test',
    transportCode:null,participacio:true,privacitat:true,idioma:'va',
    idempotencyKey:crypto.randomUUID().replaceAll('-',''),malnom:'',_ts:'',...extra};
};
const pdf=Buffer.from('%PDF-1.4\n%synthetic local fixture\n1 0 obj <<>> endobj\n%%EOF');
const evidence={filename:'demo-justificant.pdf',mime:'application/pdf',dataBase64:pdf.toString('base64')};

test('FASE 3A: oversized or non-synthetic evidence is rejected before storage',async()=>{
  const huge=Buffer.alloc(4*1024*1024+1,65);pdf.copy(huge);huge.write('synthetic',100);
  await assert.rejects(validateSyntheticEvidence({...evidence,dataBase64:huge.toString('base64')}),error=>error.status===400 || error.status===413);
  await assert.rejects(validateSyntheticEvidence({...evidence,dataBase64:Buffer.from('%PDF-1.4\nnot a demo\n').toString('base64')}),
    error=>error.code==='synthetic_evidence_required');
  await assert.rejects(validateSyntheticEvidence({...evidence,filename:'../demo-justificant.pdf'}),
    error=>error.code==='invalid_evidence','shared evidence storage rejects path-like names for activities and fees');
  await assert.rejects(validateSyntheticEvidence({...evidence,filename:'..\\demo-justificant.pdf'}),
    error=>error.code==='invalid_evidence');
  await assert.rejects(validateSyntheticEvidence({...evidence,filename:'..／demo-justificant.pdf'}),
    error=>error.code==='invalid_evidence');
  assert.equal((await validateSyntheticEvidence({...evidence,filename:'justificant..pdf'})).mime,'application/pdf');
});

test('FASE 3A: activity, family intake, matching, payment, delegation, outbox and restore', {timeout:240_000},async()=>{
  const temp=mkdtempSync(join(tmpdir(),'parpallo-3a-'));
  const gestio=join(temp,'gestio'),family=join(temp,'family'),portal=join(temp,'portal');
  cpSync(resolve(root,'gestio'),gestio,{recursive:true,filter:path=>!path.split('/').includes('.wrangler')});
  cpSync(resolve(root,'family'),family,{recursive:true});
  cpSync(resolve(root,'portal'),portal,{recursive:true});
  mkdirSync(join(temp,'api'),{recursive:true});
  cpSync(resolve(root,'api/_lib'),join(temp,'api/_lib'),{recursive:true});
  mkdirSync(join(temp,'data'),{recursive:true});
  // Bundle-only stub for the legacy activity catalogue import; no live catalogue is copied.
  cpSync(resolve(root,'test/fixtures/empty-activities.synthetic.json'),join(temp,'data/activitats.json'));
  const state=join(gestio,'.wrangler','state');
  let worker;
  try{
    run(gestio,['d1','migrations','apply','parpallo-gestio-local','--local','--persist-to',state,'--config','wrangler.toml']);
    run(gestio,['d1','execute','parpallo-gestio-local','--local','--persist-to',state,'--config','wrangler.toml','--file','seed.sql','--yes']);
    // Preserve the 3A closed-quota scenario despite the new 3B synthetic open-round seed.
    run(gestio,['d1','execute','parpallo-gestio-local','--local','--persist-to',state,'--config','wrangler.toml',
      '--command','UPDATE annual_fee_round SET is_open=0','--yes']);
    worker=await start(gestio,state,'/api/dev/identities');
    const login=async subject=>{
      const result=await request(worker.base,'/api/dev/login',{method:'POST',body:{subject}});
      assert.equal(result.status,200);return result.cookie.split(';')[0];
    };
    const group=await login('seed-101'),troop=await login('seed-102'),tech=await login('seed-107');
    const create=(cookie,body)=>request(worker.base,'/api/activities',{method:'POST',cookie,body});
    const free=await create(troop,activity('SECTIONS',[id(2)]));assert.equal(free.status,201);
    assert.equal((await create(troop,activity('SECTIONS',[id(3)]))).status,403);
    assert.equal((await create(tech,activity('SECTIONS',[id(2)]))).status,403);
    const general=await create(group,activity('GENERAL',[]));assert.equal(general.status,201);
    assert.equal((await request(worker.base,'/api/activities/'+general.data.id,{method:'PATCH',cookie:troop,
      body:{...activity('GENERAL',[]),name:'General editada per Tropa (fictícia)',expectedVersion:1}})).status,200);
    assert.equal((await create(troop,activity('GENERAL',[]))).status,201);
    const paid=await create(troop,activity('SECTIONS',[id(2)],1200,[{code:'GROUP',adjustmentCents:300},{code:'FAMILY',adjustmentCents:0}]));
    assert.equal(paid.status,201);
    const closed=await create(troop,activity('SECTIONS',[id(2)]));assert.equal(closed.status,201);
    for(const item of [free,paid,closed])assert.equal((await request(worker.base,`/api/activities/${item.data.id}/publish`,{method:'POST',cookie:troop,
      body:{expectedVersion:1}})).status,200);
    assert.equal((await request(worker.base,`/api/activities/${closed.data.id}/close`,{method:'POST',cookie:troop,body:{expectedVersion:2}})).status,200);
    assert.equal((await request(worker.base,'/api/delegations',{method:'POST',cookie:tech,body:{userId:id(105),permissionCode:'finance.payment.verify',
      sectionId:id(2),authorizedBy:id(107),authorizationReference:'DEMO-UNAUTH-001',expiresAt:later(10)}})).status,403);
    const delegated=await request(worker.base,'/api/delegations',{method:'POST',cookie:tech,body:{userId:id(105),
      permissionCode:'finance.payment.verify',sectionId:id(2),authorizedBy:id(101),
      authorizationReference:'DEMO-FIN-TROPA-001',expiresAt:later(10)}});
    assert.equal(delegated.status,201);assert.equal(delegated.data.ratificationStatus,'PENDING_RATIFICATION');
    assert.equal(delegated.data.authorizationStatus,'PENDING_CONFIRMATION','TECH_ADMIN cannot attribute an authorisation (M3)');
    assert.equal((await request(worker.base,`/api/delegations/${delegated.data.id}/ratify`,{method:'POST',cookie:group,
      body:{ratificationReference:'DEMO-CONSELL-001'}})).status,409,'ratification waits for the named authoriser');
    assert.equal((await request(worker.base,`/api/delegations/${delegated.data.id}/confirm`,{method:'POST',cookie:troop,body:{}})).status,403,
      'only the named authoriser confirms');
    assert.equal((await request(worker.base,`/api/delegations/${delegated.data.id}/confirm`,{method:'POST',cookie:group,body:{}})).status,200);
    assert.equal((await request(worker.base,`/api/delegations/${delegated.data.id}/ratify`,{method:'POST',cookie:group,
      body:{ratificationReference:'DEMO-CONSELL-001'}})).status,200);
    await stop(worker);worker=null;

    // Synthetic fixtures: exact duplicates and a same-name/wrong-date candidate.
    run(gestio,['d1','execute','parpallo-gestio-local','--local','--persist-to',state,'--config','wrangler.toml','--command',
      `INSERT INTO participant(id,display_name,current_section_id,status,birth_date) VALUES
      ('${id(901)}','Participant Doble (ficticio)','${id(2)}','ACTIVE','2013-05-18'),
      ('${id(902)}','Participant Doble (ficticio)','${id(2)}','ACTIVE','2013-05-18')`,'--yes']);
    run(gestio,['d1','execute','parpallo-gestio-local','--local','--persist-to',state,'--config','wrangler.toml','--command',
      `INSERT INTO activity(id,public_code,name,status,audience,location,starts_at,ends_at,registration_deadline,price_cents,currency,
        short_description,materials,special_notice,created_by,created_at,updated_at) SELECT '${id(906)}','DEMO-EXPIRED',name,'PUBLISHED',audience,location,starts_at,ends_at,${Date.now()-1000},price_cents,currency,short_description,materials,special_notice,created_by,created_at,updated_at FROM activity WHERE public_code='DEMO-DRAFT'`,'--yes']);
    run(gestio,['d1','execute','parpallo-gestio-local','--local','--persist-to',state,'--config','wrangler.toml','--command',
      `INSERT INTO activity_section(activity_id,section_id) VALUES('${id(906)}','${id(2)}')`,'--yes']);
    assert.match(readFileSync(resolve(family,'README.md'),'utf8'),/DEPRECATED \/ CANDIDATE_FOR_REMOVAL/);
    assert.match(readFileSync(resolve(family,'worker.js'),'utf8'),/DEPRECATED/);
    worker=await startPortal(portal,gestio,state,join(temp,'wrangler-registry'));
    const page=await fetch(worker.base+'/',{signal:AbortSignal.timeout(15000)});assert.equal(page.status,200);
    const pageHtml=await page.text();assert.match(pageHtml,/Grup Scout Parpalló/);
    const activityHtml=readFileSync(resolve(portal,'public/index.html'),'utf8');
    assert.match(activityHtml,/Autoritze la participació en l'activitat triada/);
    assert.match(activityHtml,/He llegit la <a href="https:\/\/grupscoutparpallo.com\/privacitat.html"/);
    assert.doesNotMatch(activityHtml,/name="imatge"|Autoritze l'ús d'imatge|Autorizo el uso de imagen/);
    assert.doesNotMatch(readFileSync(resolve(portal,'public/portal.js'),'utf8'),/imatge/);
    const portalLogin=await request(worker.base,'/api/portal/session',{method:'POST',body:{password:'families-demo'}});
    assert.equal(portalLogin.status,200);const portalCookie=portalLogin.cookie.split(';')[0];
    const authenticatedPage=await fetch(worker.base+'/',{headers:{Cookie:portalCookie}});
    assert.equal(authenticatedPage.status,200);
    assert.match(await authenticatedPage.text(),/Autoritze la participació en l'activitat triada/);
    const session=await request(worker.base,'/api/portal/session',{cookie:portalCookie});assert.equal(session.status,200);
    assert.equal(session.data.csrf,portalLogin.data.csrf);
    const config=await request(worker.base,'/api/portal/config',{cookie:portalCookie});assert.equal(config.status,200);
    const catalog=config.data.activitats;
    assert.ok(catalog.some(row=>row.publicCode===free.data.publicCode));
    assert.ok(catalog.some(row=>row.publicCode===paid.data.publicCode));
    assert.ok(!catalog.some(row=>row.publicCode===closed.data.publicCode));
    assert.ok(!catalog.some(row=>row.publicCode==='DEMO-DRAFT'));
    assert.equal(config.data.quota.oberta,false);
    for(const path of ['/api/participants','/api/participants/'+id(502),'/api/registrations','/api/payments'])
      assert.equal((await request(worker.base,path,{cookie:portalCookie})).status,404);
    const syntheticIp=n=>`192.0.2.${n}`;
    const submit=(body,csrf=session.data.csrf,origin=worker.base,ip='127.0.0.1')=>request(worker.base,'/api/inscripcio',
      {method:'POST',cookie:portalCookie,csrf,origin,ip,body});
    const clearInput=portalInput(free.data.publicCode,'Participante Tropa A (ficticio)','TRO','2013-05-18');
    assert.equal((await request(worker.base,'/api/inscripcio',{method:'PUT',cookie:portalCookie,csrf:session.data.csrf,
      body:clearInput})).status,405,'activity intake is POST-only');
    assert.equal((await submit(clearInput,'' )).status,403,'CSRF remains mandatory');
    assert.equal((await submit(clearInput,session.data.csrf,'https://other.invalid')).status,403,'Origin remains restricted');
    for(const [index,invalid] of [{participacio:false},{privacitat:false},{imatge:false}].entries())
      assert.equal((await submit({...clearInput,...invalid},session.data.csrf,worker.base,syntheticIp(40+index))).status,400);
    for(const [index,forbidden] of [{dni:'00000000X'},{observacions:'salut fictícia'},{priceCents:0},{status:'CONFIRMED'}].entries())
      assert.equal((await submit({...clearInput,...forbidden},session.data.csrf,worker.base,syntheticIp(10+index))).status,400);
    const spamCount=rows(gestio,state,'SELECT count(*) AS n FROM activity_registration')[0].n;
    assert.equal((await submit({...clearInput,malnom:'bot'},session.data.csrf,worker.base,syntheticIp(20))).status,202);
    assert.equal(rows(gestio,state,'SELECT count(*) AS n FROM activity_registration')[0].n,spamCount);
    const clear=await submit(clearInput);assert.equal(clear.status,202);
    assert.deepEqual(clear.data,{ok:true,message:clear.data.message});
    assert.equal((await submit(clearInput)).status,202);
    assert.equal((await submit({...clearInput,idempotencyKey:crypto.randomUUID().replaceAll('-','')})).status,202);
    const wrongBirth=await submit(portalInput(free.data.publicCode,'Participante Tropa A (ficticio)','TRO','2010-01-01'),session.data.csrf,worker.base,syntheticIp(21));
    const ambiguous=await submit(portalInput(free.data.publicCode,'Participant Doble (ficticio)','TRO','2013-05-18'),session.data.csrf,worker.base,syntheticIp(22));
    const noMatchInput=portalInput(free.data.publicCode,'Persona Desconocida (ficticio)','TRO','2013-05-18');
    const noMatch=await submit(noMatchInput,session.data.csrf,worker.base,syntheticIp(23));
    assert.equal(ambiguous.status,202);assert.deepEqual(ambiguous.data,clear.data);
    assert.deepEqual(wrongBirth.data,clear.data);assert.deepEqual(noMatch.data,clear.data);
    assert.equal((await submit(noMatchInput,session.data.csrf,worker.base,syntheticIp(36))).status,202,'same pending intake is idempotent');
    assert.equal((await submit({...noMatchInput,naixement:'2014-05-18'},session.data.csrf,worker.base,syntheticIp(37))).status,409,
      'changing the temporarily retained birth date with the same idempotency key conflicts');
    const secondBirth=await submit(portalInput(free.data.publicCode,'Persona Desconocida (ficticio)','TRO','2014-05-18'),
      session.data.csrf,worker.base,syntheticIp(38));
    assert.equal(secondBirth.status,202);
    assert.deepEqual(secondBirth.data,noMatch.data,'different pending identities must not enumerate');
    assert.equal(rows(gestio,state,`SELECT count(*) AS n FROM activity_registration WHERE activity_id='${free.data.id}'
      AND submitted_name='Persona Desconocida (ficticio)' AND status='NEEDS_PARTICIPANT_REVIEW'`)[0].n,2,
    'distinct submitted dates must not silently collapse pending applications');
    // Audit M8: registration review lives in views/registrations.js, candidate labels in labels.js.
    assert.match(readFileSync(resolve(gestio,'public/views/registrations.js'),'utf8'),/registration\.submitted_birth_date/);
    assert.match(readFileSync(resolve(gestio,'public/labels.js'),'utf8'),/person\.birth_date/);
    const clan=await submit(portalInput('DEMO-GENERAL','Persona Clan Desconocida (ficticio)','CLA','2007-08-09',{telefon:''}),session.data.csrf,worker.base,syntheticIp(24));
    assert.equal(clan.status,202,'optional phone must not block submission');
    const paymentInput=portalInput(paid.data.publicCode,'Participante Tropa B (ficticio)','TRO','2012-11-03',{transportCode:'GROUP'});
    assert.equal((await submit(paymentInput,session.data.csrf,worker.base,syntheticIp(25))).status,400,'paid activity requires its evidence');
    const portalEvidence={nom:'demo-justificant.pdf',tipus:'application/pdf',base64:pdf.toString('base64')};
    for(const [index,bad] of [
      {...paymentInput,priceCents:0,comprovant:portalEvidence},
      {...paymentInput,status:'CONFIRMED',comprovant:portalEvidence},
      {...paymentInput,comprovant:{...portalEvidence,nom:'demo-fals.png'}},
      {...paymentInput,comprovant:{...portalEvidence,tipus:'image/png'}},
      {...paymentInput,seccio:'ESC',comprovant:portalEvidence},
      {...paymentInput,paymentStatus:'VERIFIED',comprovant:portalEvidence},
    ].entries()) assert.equal((await submit(bad,session.data.csrf,worker.base,syntheticIp(26+index))).status,400);
    assert.equal((await submit({...paymentInput,comprovant:portalEvidence},session.data.csrf,worker.base,syntheticIp(32))).status,202);
    assert.equal((await submit(portalInput(closed.data.publicCode,'Participante Tropa A (ficticio)'),session.data.csrf,worker.base,syntheticIp(33))).status,404);
    assert.equal((await submit(portalInput('DEMO-EXPIRED','Participante Tropa A (ficticio)'),session.data.csrf,worker.base,syntheticIp(34))).status,409);
    assert.equal((await submit(portalInput('ACT-TAMPERED-CODE','Participante Tropa A (ficticio)'),session.data.csrf,worker.base,syntheticIp(35))).status,404);
    const storedClear=rows(gestio,state,`SELECT * FROM activity_registration WHERE activity_id='${free.data.id}' AND participant_id='${id(502)}'`)[0];
    assert.equal(storedClear.submitted_birth_date,null,'clear match must not retain a duplicate birth date');
    assert.equal(storedClear.submitted_by_name,'Persona remitenta fictícia');
    assert.equal(storedClear.receipt_email,'sollicitant@example.test');
    assert.equal(storedClear.contact_phone,'600123456');
    assert.equal(storedClear.participation_terms_version,'DEMO-3A-PARTICIPATION-V1');
    assert.ok(storedClear.participation_authorized_at>0);
    assert.equal(storedClear.privacy_notice_version,'DEMO-3A-PRIVACY-NOTICE-V1');
    assert.ok(storedClear.privacy_notice_acknowledged_at>0);
    assert.equal(storedClear.consent_version,'DEPRECATED');
    assert.equal(rows(gestio,state,"SELECT count(*) AS n FROM pragma_table_info('activity_registration') WHERE name='imatge'")[0].n,0);
    assert.equal(rows(gestio,state,`SELECT birth_date FROM participant WHERE id='${id(502)}'`)[0].birth_date,'2013-05-18',
      'portal submission must not update participant master data');
    assert.equal(rows(gestio,state,`SELECT count(*) AS n FROM audit_event WHERE metadata_json LIKE '%2013-05-18%' OR metadata_json LIKE '%sollicitant@example.test%'`)[0].n,0,
      'audit metadata must not copy submission values');
    assert.doesNotMatch(readFileSync(resolve(portal,'worker.js'),'utf8'),/handleInscripcio|data\/activitats|Google Drive|Google Sheets/);
    await stop(worker);worker=null;

    worker=await start(gestio,state,'/api/dev/identities');
    const relogin=async subject=>{const result=await request(worker.base,'/api/dev/login',{method:'POST',body:{subject}});assert.equal(result.status,200);return result.cookie.split(';')[0];};
    const group2=await relogin('seed-101'),delegate=await relogin('seed-105'),treasury=await relogin('seed-104'),troop2=await relogin('seed-102');
    const freeRows=await request(worker.base,`/api/activities/${free.data.id}/registrations`,{cookie:delegate});
    assert.equal(freeRows.status,200);
    assert.equal((await request(worker.base,`/api/activities/${id(802)}/registrations`,{cookie:delegate})).status,404,
      'audit L1: an out-of-scope activity is not confirmed to exist');
    const confirmed=freeRows.data.registrations.find(row=>row.participant_id===id(502));
    assert.equal(confirmed.status,'CONFIRMED');
    assert.equal(confirmed.submitted_birth_date,null);
    assert.equal(confirmed.submitted_by_name,'Persona remitenta fictícia');
    assert.equal(confirmed.receipt_email,'sollicitant@example.test');
    assert.equal(freeRows.data.registrations.filter(row=>row.participant_id===id(502)).length,1);
    const ambiguousRow=freeRows.data.registrations.find(row=>row.match_status==='AMBIGUOUS' && row.submitted_name==='Participant Doble (ficticio)');
    const wrongBirthRow=freeRows.data.registrations.find(row=>row.match_status==='AMBIGUOUS' && row.submitted_name==='Participante Tropa A (ficticio)');
    const unknownRow=freeRows.data.registrations.find(row=>row.match_status==='NONE');
    assert.equal(ambiguousRow.status,'NEEDS_PARTICIPANT_REVIEW');assert.ok(unknownRow);assert.ok(wrongBirthRow);
    assert.equal(ambiguousRow.submitted_birth_date,'2013-05-18');
    assert.equal(wrongBirthRow.submitted_birth_date,'2010-01-01');
    const candidates=await request(worker.base,`/api/registrations/${ambiguousRow.id}/candidates`,{cookie:delegate});
    assert.equal(candidates.status,200);assert.ok(candidates.data.candidates.some(row=>row.id===id(901) && row.birth_date==='2013-05-18'));
    assert.equal((await request(worker.base,`/api/registrations/${ambiguousRow.id}/review`,{method:'POST',cookie:delegate,
      body:{decision:'MATCH',participantId:id(901)}})).data.status,'CONFIRMED');
    assert.equal(rows(gestio,state,`SELECT submitted_birth_date FROM activity_registration WHERE id='${ambiguousRow.id}'`)[0].submitted_birth_date,null);
    assert.equal((await request(worker.base,`/api/registrations/${unknownRow.id}/review`,{method:'POST',cookie:delegate,
      body:{decision:'REJECT'}})).data.status,'REJECTED');
    assert.equal((await request(worker.base,`/api/registrations/${wrongBirthRow.id}/review`,{method:'POST',cookie:delegate,
      body:{decision:'REJECT'}})).data.status,'REJECTED');
    assert.equal(rows(gestio,state,`SELECT submitted_birth_date FROM activity_registration WHERE id='${wrongBirthRow.id}'`)[0].submitted_birth_date,null);
    const clanRow=rows(gestio,state,`SELECT id FROM activity_registration WHERE submitted_name='Persona Clan Desconocida (ficticio)'`)[0];
    assert.equal((await request(worker.base,`/api/registrations/${clanRow.id}/review`,{method:'POST',cookie:delegate,
      body:{decision:'REJECT'}})).status,403);
    const payments=await request(worker.base,'/api/payments',{cookie:treasury});assert.equal(payments.status,200);
    const paidRow=payments.data.payments.find(row=>row.activity_name==='Activitat completament fictícia' && row.expected_amount_cents===1500);
    assert.ok(paidRow);assert.equal(paidRow.review_status,'PENDING_REVIEW');
    assert.equal((await request(worker.base,`/api/payments/${paidRow.id}/review`,{method:'POST',cookie:troop2,body:{decision:'VERIFIED'}})).status,403);
    const evidenceResponse=await fetch(worker.base+`/api/payments/${paidRow.id}/evidence`,{headers:{Cookie:treasury}});
    assert.equal(evidenceResponse.status,200);assert.match(evidenceResponse.headers.get('content-disposition'),/attachment/);
    assert.equal((await request(worker.base,`/api/payments/${paidRow.id}/review`,{method:'POST',cookie:treasury,body:{decision:'ISSUE'}})).data.status,'ISSUE');
    assert.equal(rows(gestio,state,`SELECT recipient_email FROM notification_outbox WHERE registration_id='${paidRow.registration_id}' AND kind='PAYMENT_ISSUE'`)[0].recipient_email,'sollicitant@example.test');
    assert.equal((await request(worker.base,`/api/payments/${paidRow.id}/review`,{method:'POST',cookie:delegate,body:{decision:'VERIFIED'}})).data.status,'VERIFIED');
    assert.equal((await request(worker.base,`/api/payments/${paidRow.id}/review`,{method:'POST',cookie:delegate,body:{decision:'VERIFIED'}})).status,409);
    const paidRegistration=rows(gestio,state,`SELECT status FROM activity_registration WHERE id='${paidRow.registration_id}'`)[0];
    assert.equal(paidRegistration.status,'CONFIRMED');
    assert.equal(rows(gestio,state,`SELECT birth_date FROM participant WHERE id='${id(503)}'`)[0].birth_date,'2012-11-03');
    assert.equal(rows(gestio,state,`SELECT notification_email FROM participant_contact WHERE participant_id='${id(503)}'`)[0].notification_email,'familia503@example.test');
    assert.equal((await request(worker.base,`/api/delegations/${delegated.data.id}/revoke`,{method:'POST',cookie:group2})).status,200);
    assert.equal((await request(worker.base,'/api/payments',{cookie:delegate})).status,403);
    const failed=await request(worker.base,'/api/dev/notifications/drain',{method:'POST',cookie:group2,body:{failSynthetic:true}});
    assert.equal(failed.status,200);assert.ok(failed.data.failed>0);
    const delivered=await request(worker.base,'/api/dev/notifications/drain',{method:'POST',cookie:group2,body:{}});
    assert.equal(delivered.status,200);assert.ok(delivered.data.sent>0);
    assert.ok(rows(gestio,state,"SELECT outbox_id FROM notification_capture WHERE body LIKE '%Preu:%' LIMIT 1").length>0);
    assert.equal(rows(gestio,state,"SELECT count(*) AS n FROM audit_event WHERE metadata_json LIKE '%Preu:%'")[0].n,0);
    await stop(worker);worker=null;
    const stale=spawnSync(wrangler,['d1','execute','parpallo-gestio-local','--local','--persist-to',state,'--config','wrangler.toml',
      '--command',`UPDATE payment_evidence SET review_status='VERIFIED' WHERE id='${paidRow.id}'`,'--yes'],
    {cwd:gestio,encoding:'utf8',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
    assert.notEqual(stale.status,0,'a stale payment review must fail at the database boundary');

    const backup=join(temp,'approved-backup'),restored=join(temp,'restored-state');
    const manifest=createBackup(backup,join(gestio,'wrangler.toml'));
    assert.ok(manifest.table_counts.activity_registration>=5);
    assert.ok(manifest.table_counts.payment_evidence>=2);
    assert.ok(manifest.table_counts.delegated_permission>=2);
    assert.ok(manifest.table_counts.notification_outbox>=4);
    restoreBackup(backup,restored,join(gestio,'wrangler.toml'));
    assert.equal(rows(gestio,restored,'SELECT count(*) AS n FROM activity_registration')[0].n,manifest.table_counts.activity_registration);
    const restoredClear=rows(gestio,restored,`SELECT participation_terms_version,participation_authorized_at,
      privacy_notice_version,privacy_notice_acknowledged_at FROM activity_registration WHERE id='${storedClear.id}'`)[0];
    assert.equal(restoredClear.participation_terms_version,storedClear.participation_terms_version);
    assert.equal(restoredClear.participation_authorized_at,storedClear.participation_authorized_at);
    assert.equal(restoredClear.privacy_notice_version,storedClear.privacy_notice_version);
    assert.equal(restoredClear.privacy_notice_acknowledged_at,storedClear.privacy_notice_acknowledged_at);
    assert.equal(rows(gestio,restored,'SELECT count(*) AS n FROM notification_outbox')[0].n,manifest.table_counts.notification_outbox);
    assert.equal(rows(gestio,restored,'SELECT count(*) AS n FROM delegated_permission')[0].n,manifest.table_counts.delegated_permission);
  }finally{await stop(worker);rmSync(temp,{recursive:true,force:true});}
});
