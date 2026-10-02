import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createBackup, verifyBackup, restoreBackup } from '../gestio/scripts/recovery.js';
import { assertAllowedEgress } from '../api/_lib/environment.js';
import { runRetention } from '../gestio/src/services/audit-service.js';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const gestio=resolve(repo,'gestio');
const wrangler=resolve(repo,'node_modules/.bin/wrangler');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
function run(cwd,args) {
  const result=spawnSync(wrangler,args,{cwd,encoding:'utf8',maxBuffer:4*1024*1024,
    env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
  assert.equal(result.status,0,(result.stderr||result.stdout||'').slice(-2000));
}
function runNpm(script,args) {
  const npm=process.platform==='win32'?'npm.cmd':'npm';
  const result=spawnSync(npm,['run',script,'--',...args],{cwd:repo,encoding:'utf8',maxBuffer:4*1024*1024,
    env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
  assert.equal(result.status,0,(result.stderr||result.stdout||'').slice(-2000));
  return result.stdout;
}
function localD1Adapter(cwd,state) {
  const literal=value=>value===null?'NULL':typeof value==='number'?String(value):"'"+String(value).replaceAll("'","''")+"'";
  const execute=(sql,params)=>{
    let index=0;
    const bound=sql.replaceAll('?',()=>literal(params[index++]));
    assert.equal(index,params.length);
    const result=spawnSync(wrangler,['d1','execute','parpallo-gestio-local','--local','--persist-to',state,
      '--config','wrangler.toml','--command',bound,'--json'],{cwd,encoding:'utf8',maxBuffer:4*1024*1024,
      env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
    assert.equal(result.status,0,(result.stderr||result.stdout||'').slice(-2000));
    const response=JSON.parse(result.stdout)[0];
    assert.equal(response.success,true);
    // Wrangler's CLI JSON omits D1 batch change counts; row survival is checked below.
    return {...response,meta:{...response.meta,changes:response.meta?.changes??0}};
  };
  return {
    prepare(sql) {return {bind(...params) {return {
      sql,params,
      async first() {return execute(sql,params).results[0]??null;}
    };}};},
    async batch(statements) {return statements.map(item=>execute(item.sql,item.params));}
  };
}
async function freePort() {
  const server=createServer();
  await new Promise(resolveReady=>server.listen(0,'127.0.0.1',resolveReady));
  const port=server.address().port;
  await new Promise(resolveReady=>server.close(resolveReady));
  return port;
}
async function startWorker(cwd,state) {
  const port=await freePort(),base='http://127.0.0.1:'+port;
  const child=spawn(wrangler,['dev','--local','--persist-to',state,'--ip','127.0.0.1',
    '--port',String(port),'--config','wrangler.toml'],{cwd,env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
  let logs='';
  let closed=false,spawnError=null;
  const capture=chunk=>{logs=(logs+chunk.toString()).slice(-8000);};
  child.stdout.on('data',capture);
  child.stderr.on('data',capture);
  child.on('error',error=>{spawnError=error;});
  const close=new Promise(resolveClosed=>child.once('close',()=>{closed=true;resolveClosed();}));
  const worker={child,close};
  for (let i=0;i<100;i++) {
    if (closed || spawnError) break;
    try { const response=await fetch(base+'/api/dev/identities',{signal:AbortSignal.timeout(1000)});if(response.ok) {
      const request=async (path,{method='GET',cookie='',body}={})=>{
        try {
          const response=await fetch(base+path,{method,signal:AbortSignal.timeout(15000),headers:{
            ...(cookie?{Cookie:cookie}:{}),...(method!=='GET'?{Origin:base}:{}),
            ...(body?{'Content-Type':'application/json'}:{})
          },body:body?JSON.stringify(body):undefined});
          return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie'),requestId:response.headers.get('x-request-id')};
        } catch(error) {
          throw new Error(`Worker ${method} ${path} failed; exit=${child.exitCode}, signal=${child.signalCode}, closed=${closed}; logs=${logs.slice(-2000)}`,{cause:error});
        }
      };
      const login=async subject=>{
        const response=await request('/api/dev/login',{method:'POST',body:{subject}});
        assert.equal(response.status,200,logs.slice(-1200));
        return response.cookie.split(';')[0];
      };
      return {...worker,request,login};
    }} catch {}
    await new Promise(r=>setTimeout(r,100));
  }
  await stopWorker(worker);
  throw new Error(`Worker did not start; exit=${child.exitCode}, signal=${child.signalCode}; ${spawnError?.message??''}; logs=${logs.slice(-2000)}`);
}
async function stopWorker(worker) {
  if (!worker) return;
  if (worker.child.exitCode===null && worker.child.signalCode===null) worker.child.kill('SIGTERM');
  const timer=setTimeout(()=>worker.child.kill('SIGKILL'),5000);
  try {await worker.close;} finally {clearTimeout(timer);}
}

test('FASE 2B: backup, rejection, disaster and D1 restore with application invariants', {timeout:150_000}, async()=>{
  const temp=mkdtempSync(join(tmpdir(),'parpallo-2b-drill-'));
  const isolated=join(temp,'gestio');
  cpSync(gestio,isolated,{recursive:true,filter:path=>!path.split('/').includes('.wrangler')});
  const config=join(isolated,'wrangler.toml');
  const sourceState=join(isolated,'.wrangler','state');
  const backup=join(temp,'approved-backup');
  const restored=join(temp,'restored-state');
  let worker;
  try {
    run(isolated,['d1','migrations','apply','parpallo-gestio-local','--local','--config','wrangler.toml']);
    run(isolated,['d1','execute','parpallo-gestio-local','--local','--config','wrangler.toml','--file','seed.sql','--yes']);
    worker=await startWorker(isolated,sourceState);
    const group=await worker.login('seed-101');
    const crm=await worker.login('seed-106');
    const troop=await worker.login('seed-102');
    assert.equal((await worker.request('/api/participants',{cookie:troop})).status,200);
    const audit=await worker.request('/api/audit/events?action=AUTH_LOGIN_SUCCESS&actorId='+id(101),{cookie:group});
    assert.equal(audit.status,200);
    const protectedEvent=audit.data.events[0];
    assert.ok(protectedEvent?.id);
    const incident=await worker.request('/api/incidents',{method:'POST',cookie:group,
      body:{severity:'LOW',summaryCode:'TEST_SCENARIO'}});
    assert.equal(incident.status,201);
    assert.equal((await worker.request('/api/incidents/'+incident.data.id+'/holds',{method:'POST',cookie:group,
      body:{eventId:protectedEvent.id}})).status,201);
    // Two episodes of the same guardian relationship (3.5E): ended, then linked again.
    const guardianLink=await worker.request('/api/participants/'+id(502)+'/guardians',{method:'POST',cookie:group,
      body:{name:'Tutora Copia (ficticia)',relationship:'PARENT',legalRepresentative:true}});
    assert.equal(guardianLink.status,201);
    const episodeGuardian=guardianLink.data.guardianId;
    assert.equal((await worker.request('/api/participants/'+id(502)+'/guardians/'+episodeGuardian,{method:'DELETE',cookie:group})).status,200);
    assert.equal((await worker.request('/api/participants/'+id(502)+'/guardians',{method:'POST',cookie:group,
      body:{guardianId:episodeGuardian,relationship:'PARENT'}})).status,201);
    // 3.5F: a withdrawn registration and a corrected section must survive backup and restore.
    const confirmedSeed=await worker.request('/api/activities/'+id(801)+'/registrations',{cookie:group});
    const toWithdraw=confirmedSeed.data.registrations.find(row=>row.id===id(821));
    assert.equal((await worker.request('/api/registrations/'+id(821)+'/withdraw',{method:'POST',cookie:group,
      body:{source:'FAMILY_COMMUNICATION',expectedVersion:toWithdraw.version}})).status,200);
    run(isolated,['d1','execute','parpallo-gestio-local','--local','--config','wrangler.toml','--command',
      "INSERT INTO activity_registration(id,activity_id,submitted_name,match_key,submitted_section_id,receipt_email,expected_amount_cents,match_status,status,"+
      "consent_version,participation_terms_version,participation_authorized_at,privacy_notice_version,privacy_notice_acknowledged_at,idempotency_key,payload_sha256,"+
      "created_at,updated_at,submitted_birth_date) VALUES('"+id(860)+"','"+id(803)+"','Persona Recuperació (ficticia)','persona recuperacio ficticia','"+id(2)+
      "','recuperacio@example.test',0,'NONE','NEEDS_PARTICIPANT_REVIEW','DEPRECATED','DEMO-3A-PARTICIPATION-V1',1,'DEMO-3A-PRIVACY-NOTICE-V1',1,"+
      "'recovery-correction-0001','"+'0'.repeat(64)+"',1,1,'2012-02-02')",'--yes']);
    assert.equal((await worker.request('/api/registrations/'+id(860)+'/section',{method:'POST',cookie:group,
      body:{sectionId:id(4),expectedVersion:1}})).status,200);
    // 3.5F instalments: a partial verified amount must survive backup and restore.
    const seedPayment=(await worker.request('/api/payments/'+id(831),{cookie:group})).data.payment;
    assert.equal((await worker.request('/api/payments/'+id(831)+'/review',{method:'POST',cookie:group,
      body:{decision:'VERIFIED',amountCents:500,expectedVersion:seedPayment.registrationVersion}})).data.paymentState,'PARTIAL');
    // A second payment attempt (another proof) for the same registration, verified for the rest.
    run(isolated,['d1','execute','parpallo-gestio-local','--local','--config','wrangler.toml','--command',
      "INSERT INTO payment_evidence(id,registration_id,object_key,sha256,size_bytes,detected_mime,review_status,created_at) VALUES('"+id(870)+"','"+id(822)+
      "','synthetic/recovery-attempt-b','"+'1'.repeat(64)+"',20,'application/pdf','PENDING_REVIEW',2)",'--yes']);
    const secondAttempt=(await worker.request('/api/payments/'+id(870),{cookie:group})).data.payment;
    assert.equal(secondAttempt.attempts,2);
    assert.equal((await worker.request('/api/payments/'+id(870)+'/review',{method:'POST',cookie:group,
      body:{decision:'VERIFIED',amountCents:700,expectedVersion:secondAttempt.registrationVersion}})).data.paymentState,'PAID');
    // 3.5G.1 financial foundation: round, positions, opening balance, an import, an internal transfer, a settled
    // card expense and an approved budget with a revision must survive backup and restore.
    const treasurer=await worker.login('seed-104');
    const finance=(path,body,method='POST',cookie=treasurer)=>worker.request('/api/finance/'+path,{method,cookie,body});
    const round=(await finance('rounds',{code:'2026/2027',periodStart:'2026-10-01',periodEnd:'2027-09-30'})).data.id;
    assert.equal((await finance('rounds/'+round+'/open',{expectedVersion:1})).status,200);
    const bank=(await finance('positions',{kind:'BANK',name:'Compte corrent'})).data.id;
    const card=(await finance('positions',{kind:'CARD',name:'Targeta'})).data.id;
    const cash=(await finance('positions',{kind:'CASH',name:'Caixa'})).data.id;
    assert.equal((await finance('rounds/'+round+'/opening-balances',{positionId:bank,amountCents:1500000,expectedRevision:0})).status,201);
    const imported=await finance('import-batches',{positionId:bank,format:'SYNTHETIC_CSV_V1',content:['# synthetic',
      'operation_date,value_date,amount_cents,reference,description,balance_cents','2026-11-03,,10000,R-1,TRF. Família Recuperació (fictícia),1510000',
      '2026-11-04,,-50000,,Retirada de caixer (fictici),1460000'].join('\n')});
    assert.equal(imported.data.createdCount,2);
    const bankMoves=(await worker.request('/api/finance/movements?positionId='+bank,{cookie:treasurer})).data.movements;
    const cashIn=(await finance('movements',{positionId:cash,operationDate:'2026-11-04',amountCents:50000,label:'Entrada a caixa'})).data.id;
    assert.equal((await finance('internal-transfers',{fromMovementId:bankMoves.find(row=>row.amountCents===-50000).id,toMovementId:cashIn,
      fromExpectedVersion:0,toExpectedVersion:0})).status,201);
    const root=(await finance('budget-lines',{roundId:round,code:'2',name:'Campaments',nature:'EXPENSE'})).data.id;
    const kitchen=(await finance('budget-lines',{roundId:round,code:'2.1',name:'Cuina',nature:'EXPENSE',parentId:root,plannedCents:100000})).data.id;
    const budget=(await finance('rounds/'+round+'/budget',{})).data.id;
    assert.equal((await finance('budgets/'+budget+'/propose',{expectedVersion:1})).status,200);
    assert.equal((await finance('budgets/'+budget+'/approve',{expectedVersion:2},'POST',group)).status,200);
    const revision=(await finance('budget-revisions',{budgetId:budget,lineId:kitchen,deltaCents:5000})).data.id;
    assert.equal((await finance('budget-revisions/'+revision+'/decision',{decision:'APPROVE',expectedVersion:1},'POST',group)).status,200);
    const expense=(await finance('expenses',{roundId:round,expenseDate:'2026-11-05',totalCents:3000,paymentMethod:'CARD',
      lines:[{budgetLineId:kitchen,amountCents:3000}],recognise:true})).data.id;
    const purchase=(await finance('movements',{positionId:card,operationDate:'2026-11-05',amountCents:-3000,label:'Compra amb targeta'})).data.id;
    assert.equal((await finance('movements/'+purchase+'/allocations',{expectedVersion:0,allocations:[{kind:'EXPENSE_SETTLEMENT',amountCents:3000,expenseId:expense}]})).status,200);
    assert.equal((await worker.request('/api/users/'+id(106)+'/suspend',{method:'POST',cookie:group})).status,200);
    assert.equal((await worker.request('/api/me',{cookie:crm})).status,401);
    await stopWorker(worker);worker=null;

    assert.match(runNpm('db:backup',['--config',config,'--output',backup]),/BACKUP_CREATED/);
    const manifest=verifyBackup(backup,config).manifest;
    assert.equal(manifest.synthetic,true);
    assert.equal(manifest.environment,'local-development');
    assert.equal(manifest.schema_version,28);
    assert.deepEqual(manifest.migrations,['0001_identity_policy.sql','0002_domain_audit_incidents.sql',
      '0003_activities_registrations.sql','0004_submission_matching_data.sql',
      '0005_registration_authorizations.sql','0006_annual_fees.sql','0007_annual_fee_integrity.sql',
      '0008_annual_fee_hardening.sql','0009_annual_fee_final_integrity.sql','0010_scoped_fee_status.sql',
      '0011_participant_domain.sql','0012_authorization_catalog_and_identity_provisioning.sql',
      '0013_privilege_governance.sql','0014_activity_version.sql','0015_participant_management.sql','0016_guardians_contacts_review.sql',
      '0017_guardian_relationship_episodes.sql','0018_registrations_v1.sql',
      '0019_activity_payment_allocations.sql','0020_payment_attempts.sql',
      '0021_issue_notices_per_attempt.sql','0022_financial_delegation.sql','0023_finance_rounds_positions.sql',
      '0024_finance_movements.sql','0025_finance_counterparties_budget.sql','0026_finance_expenses_allocations.sql',
      '0027_finance_permissions.sql','0028_finance_expense_concept.sql']);
    assert.equal(manifest.table_counts.participant_section_membership,manifest.table_counts.participant,
      'every seeded participant has exactly one section membership row');
    assert.equal(manifest.table_counts.security_incident,1);
    assert.equal(manifest.table_counts.incident_audit_hold,1);
    assert.ok(manifest.table_counts.audit_event>0);
    assert.ok(manifest.table_counts.app_session>=3);
    assert.ok(manifest.table_counts.activity>=5);
    assert.ok(manifest.table_counts.activity_registration>=2);
    assert.ok(manifest.table_counts.payment_evidence>=1);
    assert.ok(manifest.table_counts.delegated_permission>=1);
    assert.ok(manifest.table_counts.notification_outbox>=2);
    assert.equal(manifest.table_counts.annual_fee_round,1);
    assert.equal(manifest.table_counts.annual_fee_payment,0);
    assert.equal(manifest.table_counts.finance_round,1);
    assert.equal(manifest.table_counts.finance_movement,4);
    assert.equal(manifest.table_counts.finance_movement_description,2);
    assert.equal(manifest.table_counts.finance_allocation,3);
    assert.equal(manifest.table_counts.finance_budget_revision,1);
    for (const object of ['table:annual_fee_family_revision','table:annual_fee_family_revision_member',
      'trigger:annual_fee_payment_no_unverify_allocated','trigger:annual_fee_confirm_delivery_guard',
      'trigger:annual_fee_installment_total_insert',
      'trigger:annual_fee_installment_immutable_delete',
      'trigger:annual_fee_obligation_installment_total_update','view:annual_fee_installment_part',
      'view:annual_fee_payment_balance','trigger:annual_fee_payment_allocated_review_guard',
      'trigger:annual_fee_family_member_delete_guard','index:annual_fee_family_member_binding_unique',
      'trigger:annual_fee_family_member_binding_insert','trigger:annual_fee_obligation_member_update',
      'table:annual_fee_issue_outbox',
      'table:annual_fee_issue_capture'])
      assert.ok(manifest.schema_objects.includes(object),`${object} must survive backup and restore`);
    assert.equal(verifyBackup(backup,config).manifest.sql_sha256,manifest.sql_sha256);
    assert.match(runNpm('db:backup:verify',['--config',config,'--backup',backup]),/BACKUP_VERIFIED/);
    const dump=readFileSync(join(backup,'dump.sql'),'utf8');
    const plainToken=group.split('=')[1];
    assert.ok(!dump.includes(plainToken),'usable session token must not be in dump');
    assert.match(dump,/token_hash/);
    for(const canary of ['CF_API_TOKEN_CANARY_2B','ACCESS_CLIENT_SECRET_CANARY_2B','CANARY_PLAINTEXT_SESSION_2B']) {
      assert.ok(!dump.includes(canary),canary);
    }
    assert.equal(manifest.sql_sha256,createHash('sha256').update(dump).digest('hex'));
    assert.throws(()=>restoreBackup(backup,sourceState,config),/TARGET_EXISTS/);

    const corrupted=join(temp,'corrupted-backup');
    cpSync(backup,corrupted,{recursive:true});
    writeFileSync(join(corrupted,'dump.sql'),dump.slice(0,Math.floor(dump.length/2)));
    assert.throws(()=>verifyBackup(corrupted,config));
    assert.ok(!existsSync(join(temp,'corrupted-restored')));
    assert.throws(()=>restoreBackup(corrupted,join(temp,'corrupted-restored'),config));
    assert.ok(!existsSync(join(temp,'corrupted-restored')));
    const incompatible=join(temp,'incompatible-backup');
    cpSync(backup,incompatible,{recursive:true});
    const wrong=JSON.parse(readFileSync(join(incompatible,'manifest.json'),'utf8'));
    wrong.format_version=999;
    writeFileSync(join(incompatible,'manifest.json'),JSON.stringify(wrong));
    assert.throws(()=>verifyBackup(incompatible,config),/INCOMPATIBLE_BACKUP/);
    const wrongSchema=join(temp,'wrong-schema-backup');
    cpSync(backup,wrongSchema,{recursive:true});
    const wrongVersion=JSON.parse(readFileSync(join(wrongSchema,'manifest.json'),'utf8'));
    wrongVersion.schema_version=999;
    writeFileSync(join(wrongSchema,'manifest.json'),JSON.stringify(wrongVersion));
    assert.throws(()=>verifyBackup(wrongSchema,config),/BACKUP_INTEGRITY_FAILED/);
    const wrongHash=join(temp,'wrong-hash-backup');
    cpSync(backup,wrongHash,{recursive:true});
    const wrongChecksum=JSON.parse(readFileSync(join(wrongHash,'manifest.json'),'utf8'));
    wrongChecksum.sql_sha256='0'.repeat(64);
    writeFileSync(join(wrongHash,'manifest.json'),JSON.stringify(wrongChecksum));
    assert.throws(()=>verifyBackup(wrongHash,config),/BACKUP_INTEGRITY_FAILED/);
    const secretBackup=join(temp,'secret-backup');
    cpSync(backup,secretBackup,{recursive:true});
    writeFileSync(join(secretBackup,'dump.sql'),dump+'\n-- CF_API_TOKEN_CANARY_2B\n');
    assert.throws(()=>verifyBackup(secretBackup,config),/SECRET_PATTERN_DETECTED/);

    // Temporary bad change, never a versioned migration: backup verifier must refuse it.
    run(isolated,['d1','execute','parpallo-gestio-local','--local','--config','wrangler.toml','--command',
      "UPDATE user_role SET revoked_at=2000000000000 WHERE user_id='"+id(102)+"'",'--yes']);
    assert.throws(()=>createBackup(join(temp,'bad-backup'),config),/AUTH_INVARIANT_FAILED/);
    assert.ok(!existsSync(join(temp,'bad-backup')));

    const restoreStarted=Date.now();
    const restoreOutput=runNpm('db:restore',['--config',config,'--backup',backup,'--dest-state',restored]);
    assert.match(restoreOutput,/RESTORE_STARTED/);
    assert.match(restoreOutput,/RESTORE_SUCCEEDED/);
    const restoreMs=Date.now()-restoreStarted;
    assert.ok(restoreMs>0);
    assert.throws(()=>restoreBackup(backup,restored,config),/TARGET_EXISTS/);
    const restoredBusiness=spawnSync(wrangler,['d1','execute','parpallo-gestio-local','--local','--persist-to',restored,
      '--config','wrangler.toml','--command',"SELECT (SELECT count(*) FROM activity) AS activities,(SELECT count(*) FROM activity_registration) AS registrations,(SELECT count(*) FROM payment_evidence) AS evidence,(SELECT count(*) FROM delegated_permission) AS delegations,(SELECT count(*) FROM notification_outbox) AS outbox",'--json'],
      {cwd:isolated,encoding:'utf8',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
    assert.equal(restoredBusiness.status,0);
    const restoredCounts=JSON.parse(restoredBusiness.stdout)[0].results[0];
    assert.equal(restoredCounts.activities,manifest.table_counts.activity);
    assert.equal(restoredCounts.registrations,manifest.table_counts.activity_registration);
    assert.equal(restoredCounts.evidence,manifest.table_counts.payment_evidence);
    assert.equal(restoredCounts.delegations,manifest.table_counts.delegated_permission);
    assert.equal(restoredCounts.outbox,manifest.table_counts.notification_outbox);
    const restoredFinance=spawnSync(wrangler,['d1','execute','parpallo-gestio-local','--local','--persist-to',restored,
      '--config','wrangler.toml','--command',"SELECT (SELECT expense_gross_cents FROM finance_round_economics) AS expenses,(SELECT income_cents FROM finance_round_economics) AS income,"+
      "(SELECT count(*) FROM finance_allocation_current) AS current_allocations,(SELECT current_cents FROM finance_budget_line_amount a JOIN finance_budget_line l ON l.id=a.line_id WHERE l.code='2') AS budget_current",'--json'],
      {cwd:isolated,encoding:'utf8',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
    assert.equal(restoredFinance.status,0);
    assert.deepEqual(JSON.parse(restoredFinance.stdout)[0].results[0],{expenses:3000,income:0,current_allocations:3,budget_current:105000},
      'the transfer counts nothing, the card expense once; current budget = initial + approved revision');
    const restoredFeeSchema=spawnSync(wrangler,['d1','execute','parpallo-gestio-local','--local','--persist-to',restored,
      '--config','wrangler.toml','--command',"SELECT (SELECT count(*) FROM annual_fee_installment_part) AS parts,(SELECT count(*) FROM annual_fee_family_revision) AS family_revisions",'--json'],
      {cwd:isolated,encoding:'utf8',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
    assert.equal(restoredFeeSchema.status,0);
    assert.deepEqual(JSON.parse(restoredFeeSchema.stdout)[0].results.map(row=>[row.parts,row.family_revisions]),[[0,0]]);
    assert.equal(manifest.table_counts.participant_guardian,2);
    assert.equal(manifest.table_counts.activity_registration_section_change,1);
    assert.equal(manifest.table_counts.activity_payment_allocation,2);
    assert.ok(manifest.schema_objects.includes('view:activity_payment_balance'));
    for (const object of ['trigger:registration_section_correction_guard','trigger:registration_withdrawal_immutable',
      'trigger:activity_registration_section_change_no_delete','trigger:activity_terms_locked'])
      assert.ok(manifest.schema_objects.includes(object),`${object} must survive backup and restore`);
    const restoredRegistrations=spawnSync(wrangler,['d1','execute','parpallo-gestio-local','--local','--persist-to',restored,
      '--config','wrangler.toml','--command',"SELECT (SELECT status||':'||withdrawal_source FROM activity_registration WHERE id='"+id(821)+"') AS withdrawn,"+
      "(SELECT submitted_section_id||'>'||registration_section_id FROM activity_registration WHERE id='"+id(860)+"') AS corrected,"+
      "(SELECT paid_cents||'/'||due_cents FROM activity_payment_balance WHERE registration_id='"+id(822)+"') AS paid,"+
      "(SELECT group_concat(e.id||':'||(SELECT sum(a.amount_cents) FROM activity_payment_allocation a WHERE a.evidence_id=e.id),',') FROM "+
      "(SELECT id FROM payment_evidence WHERE registration_id='"+id(822)+"' ORDER BY created_at DESC) e) AS attempts",'--json'],
      {cwd:isolated,encoding:'utf8',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
    assert.equal(restoredRegistrations.status,0);
    assert.deepEqual(JSON.parse(restoredRegistrations.stdout)[0].results[0],
      {withdrawn:'WITHDRAWN:FAMILY_COMMUNICATION',corrected:id(2)+'>'+id(4),paid:'1200/1200',attempts:id(831)+':500,'+id(870)+':700'});
    for (const object of ['index:participant_guardian_current_unique','trigger:participant_guardian_history_immutable',
      'trigger:participant_guardian_no_delete','trigger:participant_guardian_episode_order'])
      assert.ok(manifest.schema_objects.includes(object),`${object} must survive backup and restore`);
    const restoredEpisodes=spawnSync(wrangler,['d1','execute','parpallo-gestio-local','--local','--persist-to',restored,
      '--config','wrangler.toml','--command',"SELECT id,ended_at IS NOT NULL AS ended,created_by,ended_by FROM participant_guardian WHERE guardian_id='"+episodeGuardian+"' ORDER BY started_at",'--json'],
      {cwd:isolated,encoding:'utf8',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
    assert.equal(restoredEpisodes.status,0);
    const episodes=JSON.parse(restoredEpisodes.stdout)[0].results;
    assert.deepEqual(episodes.map(row=>[row.ended,row.created_by,row.ended_by]),[[1,id(101),id(101)],[0,id(101),null]]);
    assert.notEqual(episodes[0].id,episodes[1].id);
    // The restored database still refuses to erase relationship history.
    const eraseHistory=spawnSync(wrangler,['d1','execute','parpallo-gestio-local','--local','--persist-to',restored,
      '--config','wrangler.toml','--command',"DELETE FROM participant_guardian WHERE id='"+episodes[0].id+"'",'--yes'],
      {cwd:isolated,encoding:'utf8',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
    assert.notEqual(eraseHistory.status,0);
    worker=await startWorker(isolated,restored);
    assert.equal((await worker.request('/api/me',{cookie:group})).status,200); // hashed session persisted
    const troopRestored=await worker.login('seed-102');
    const list=await worker.request('/api/participants',{cookie:troopRestored});
    const restoredFamily=await worker.request('/api/participants/'+id(502)+'/familia',{cookie:troopRestored});
    assert.deepEqual(restoredFamily.data.guardians.filter(row=>row.id===episodeGuardian).map(row=>row.ended),[false,true]);
    assert.deepEqual(list.data.participants.map(row=>row.id),[id(502),id(503)]);
    assert.equal((await worker.request('/api/participants/'+id(504),{cookie:troopRestored})).status,404);
    const tech=await worker.login('seed-107');
    assert.equal((await worker.request('/api/participants',{cookie:tech})).status,403);
    const treasury=await worker.login('seed-104');
    const health=(cookie,participantId)=>worker.request('/api/dev/policy/health',{method:'POST',cookie,
      body:{participantId,purpose:'activity-safety'}});
    assert.equal((await health(treasury,id(502))).data.allowed,false);
    assert.equal((await health(troopRestored,id(503))).data.allowed,false); // expired grant
    assert.equal((await worker.request('/api/dev/login',{method:'POST',body:{subject:'seed-106'}})).status,401);
    assert.equal((await worker.request('/api/audit/events?requestId='+protectedEvent.request_id,{cookie:group}))
      .data.events.some(row=>row.id===protectedEvent.id),true);
    await stopWorker(worker);worker=null;
    run(isolated,['d1','execute','parpallo-gestio-local','--local','--persist-to',restored,
      '--config','wrangler.toml','--command',"UPDATE audit_event SET occurred_at=1 WHERE id='"+protectedEvent.id+"'",'--yes']);
    run(isolated,['d1','execute','parpallo-gestio-local','--local','--persist-to',restored,
      '--config','wrangler.toml','--command',
      "UPDATE retention_policy SET enabled=1,retention_ms=1 WHERE category='AUDIT_EVENT'",'--yes']);
    const lifecycle=await runRetention(localD1Adapter(isolated,restored),{requestId:randomUUID(),now:2000});
    assert.deepEqual(lifecycle,{auditDeleted:0,sessionsDeleted:0,enabled:true});
    worker=await startWorker(isolated,restored);
    assert.equal((await worker.request('/api/audit/events?requestId='+protectedEvent.request_id,{cookie:group}))
      .data.events.some(row=>row.id===protectedEvent.id),true);
    const continuing=await worker.request('/api/participants',{cookie:group});
    assert.equal(continuing.status,200);
    assert.equal((await worker.request('/api/audit/events?requestId='+continuing.requestId,{cookie:group}))
      .data.events.some(row=>row.action==='AUTHZ_ALLOW'),true);
    assert.throws(()=>assertAllowedEgress('https://script.google.com/macros/s/prod/exec',
      {APP_ENV:'development'}),/bloquejat/);
    assert.match(readFileSync(config,'utf8'),/APP_ENV = "development"/);
    process.stdout.write('DRILL_RESTORE_MS '+restoreMs+'\n');
  } finally {
    await stopWorker(worker);
    rmSync(temp,{recursive:true,force:true});
  }
});
