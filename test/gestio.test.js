import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { PORT_ARGS, readyBase } from './helpers/wrangler-port.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertEnvironment, verifyAccessJwt } from '../gestio/src/auth.js';
import worker from '../gestio/worker.js';
import { retentionDeleteStatement } from '../gestio/src/domains/audit/repository.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const gestio = resolve(root, 'gestio');
const wrangler = resolve(root, 'node_modules/.bin/wrangler');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

test('Access JWT RS256: firma, issuer, audience, tiempos y subject', async () => {
  const keypair = await crypto.subtle.generateKey({ name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256' },true,['sign','verify']);
  const publicKey = { ...await crypto.subtle.exportKey('jwk',keypair.publicKey),kid:'local-test',alg:'RS256',use:'sig' };
  const b64 = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
  const sign = async claims => {
    const head=b64({alg:'RS256',kid:'local-test',typ:'JWT'}), body=b64(claims);
    const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keypair.privateKey,new TextEncoder().encode(`${head}.${body}`));
    return `${head}.${body}.${Buffer.from(signature).toString('base64url')}`;
  };
  const now=Date.now(), claims={iss:'https://test.cloudflareaccess.com',aud:['expected'],sub:'subject-1',type:'app',iat:Math.floor(now/1000)-1,nbf:Math.floor(now/1000)-1,exp:Math.floor(now/1000)+60};
  const options={issuer:claims.iss,audience:'expected',jwks:{keys:[publicKey]},now};
  assert.equal((await verifyAccessJwt(await sign(claims),options)).subject,'subject-1');
  await assert.rejects(verifyAccessJwt(await sign({...claims,iss:'https://other.cloudflareaccess.com'}),options));
  await assert.rejects(verifyAccessJwt(await sign({...claims,aud:['wrong']}),options));
  await assert.rejects(verifyAccessJwt(await sign({...claims,exp:Math.floor(now/1000)-1}),options));
  await assert.rejects(verifyAccessJwt(await sign({...claims,sub:''}),options));
  const valid=await sign(claims);
  const [header,body,signature]=valid.split('.');
  const tamperedSignature=(signature[0]==='A'?'B':'A')+signature.slice(1);
  await assert.rejects(verifyAccessJwt(`${header}.${body}.${tamperedSignature}`,options));
  assert.throws(() => assertEnvironment({ APP_ENV:'production', DEV_IDENTITY_PROVIDER:'enabled', DB:{} }));
  const unsafeStart=spawnSync(process.execPath,['gestio/scripts/local.js','dev'],{cwd:root,encoding:'utf8',env:{...process.env,APP_ENV:'production',DEV_IDENTITY_PROVIDER:'enabled'}});
  assert.notEqual(unsafeStart.status,0);
  assert.match(unsafeStart.stderr,/production with dev identity provider is forbidden/);
  const unsafeDeploy=spawnSync(process.execPath,['gestio/scripts/deploy.js'],{cwd:root,encoding:'utf8'});
  assert.notEqual(unsafeDeploy.status,0);
  const controlled=await worker.fetch(new Request('http://127.0.0.1/api/me'),{APP_ENV:'production',DEV_IDENTITY_PROVIDER:'enabled',DB:{}});
  assert.equal(controlled.status,500);
  assert.equal((await controlled.json()).requestId,controlled.headers.get('x-request-id'));
});

test('D1 local: migrar, seed, matriz, scope, sesiones y suspensión', { timeout: 90_000 }, async () => {
  const state=mkdtempSync(resolve(tmpdir(),'parpallo-gestio-test-'));
  const run = args => {
    const result=spawnSync(wrangler,args,{cwd:gestio,encoding:'utf8',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
    assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);
  };
  const rejectSql = sql => {
    const result=spawnSync(wrangler,['d1','execute','parpallo-gestio-local','--local','--persist-to',state,'--config','wrangler.toml','--command',sql,'--yes'],
      {cwd:gestio,encoding:'utf8',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
    assert.notEqual(result.status,0,`Unexpected success: ${sql}`);
  };
  let child, logs='';
  try {
    run(['d1','migrations','apply','parpallo-gestio-local','--local','--persist-to',state,'--config','wrangler.toml']);
    run(['d1','execute','parpallo-gestio-local','--local','--persist-to',state,'--config','wrangler.toml','--file','seed.sql','--yes']);
    rejectSql(`INSERT INTO app_session VALUES('${id(900)}','${id(999)}','fk-canary',1,1,2,NULL,NULL)`);
    rejectSql(`INSERT INTO user_role(id,user_id,role_code,section_id,valid_from,justification) VALUES('${id(901)}','${id(101)}','UNKNOWN',NULL,1,'synthetic')`);
    rejectSql(`INSERT INTO health_access_grant(id,user_id,participant_id,purpose,valid_from,expires_at,justification) VALUES('${id(902)}','${id(102)}','${id(999)}','activity-safety',1,2,'synthetic')`);
    child=spawn(wrangler,['dev','--local','--persist-to',state,...PORT_ARGS,'--config','wrangler.toml'],{cwd:gestio,env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
    child.stdout.on('data',chunk => { logs+=chunk.toString(); }); child.stderr.on('data',chunk => { logs+=chunk.toString(); });
    let base=null, ready=false;
    for(let i=0;i<250;i++) { if(child.exitCode !== null) break; base=readyBase(logs); try { if(base && (await fetch(`${base}/api/dev/identities`)).ok){ready=true;break;} } catch {} await new Promise(r=>setTimeout(r,100)); }
    assert.ok(ready,logs);
    const request=async (path,{method='GET',cookie='',body}={}) => {
      const response=await fetch(`${base}${path}`,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(method!=='GET'?{Origin:base}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
      return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie'),requestId:response.headers.get('x-request-id')};
    };
    const login=async subject => {const response=await request('/api/dev/login',{method:'POST',body:{subject}});assert.equal(response.status,200,`${JSON.stringify(response.data)}\n${logs}`);return response.cookie.split(';')[0];};
    assert.equal((await request('/api/participants')).status,401);
    assert.equal((await request('/api/participants',{cookie:'gestio_session=invalid'})).status,401);
    const group=await login('seed-101'), tropa=await login('seed-102'), escolta=await login('seed-103');
    const treasury=await login('seed-104'), secretary=await login('seed-105'), crm=await login('seed-106'), tech=await login('seed-107');
    assert.equal((await request('/api/audit/events',{cookie:tech})).status,403);
    const firstAudit=await request('/api/audit/events?limit=2',{cookie:group});
    assert.equal(firstAudit.status,200);assert.equal(firstAudit.data.events.length,2);
    assert.ok(firstAudit.data.nextCursor);
    assert.equal((await request(`/api/audit/events?limit=2&cursor=${firstAudit.data.nextCursor}`,{cookie:group})).status,200);
    assert.equal((await request('/api/audit/events?limit=51',{cookie:group})).status,400);
    const scope=await request('/api/participants',{cookie:tropa});
    assert.equal(scope.status,200);assert.deepEqual(scope.data.participants.map(p=>p.id),[id(502),id(503)]);
    assert.equal((await request(`/api/participants/${id(504)}`,{cookie:tropa})).status,404);
    assert.equal((await request(`/api/participants/${id(502)}`,{cookie:escolta})).status,404);
    assert.equal((await request(`/api/participants/${id(502)}`,{cookie:group})).status,200);
    assert.deepEqual((await request('/api/participants?section_id='+id(504),{cookie:tropa})).data.participants.map(p=>p.id),[id(502),id(503)]); // scope cliente ignorado
    assert.equal((await request('/api/participants',{cookie:secretary})).status,200);
    for(const cookie of [treasury,crm,tech]) assert.equal((await request('/api/participants',{cookie})).status,403);
    const health=async (cookie,participantId,purpose='activity-safety') => request('/api/dev/policy/health',{method:'POST',cookie,body:{participantId,purpose}});
    assert.equal((await health(tropa,id(502))).data.allowed,true);
    assert.equal((await health(tropa,id(503))).data.allowed,false); // grant expirado
    assert.equal((await health(tropa,id(504))).data.allowed,false); // otra sección
    assert.equal((await health(tropa,id(502),'unapproved')).data.allowed,false);
    assert.equal((await health(treasury,id(502))).data.allowed,false);
    assert.equal((await health(tech,id(502))).data.allowed,false);
    run(['d1','execute','parpallo-gestio-local','--local','--persist-to',state,'--config','wrangler.toml','--command',`UPDATE health_access_grant SET revoked_at=2000000000000 WHERE id='${id(601)}'`,'--yes']);
    assert.equal((await health(tropa,id(502))).data.allowed,false); // revocado
    const grant=await request('/api/health-grants',{method:'POST',cookie:group,body:{userId:id(102),participantId:id(503),purpose:'activity-safety',expiresAt:Date.now()+60_000}});
    assert.equal(grant.status,201,JSON.stringify(grant.data));
    assert.equal((await health(tropa,id(503))).data.allowed,true);
    assert.equal((await request(`/api/health-grants/${grant.data.id}`,{method:'DELETE',cookie:group})).status,200);
    assert.equal((await health(tropa,id(503))).data.allowed,false);
    const canaries={password:'CANARY_PASSWORD_2A',token:'CANARY_TOKEN_2A',cookie:'CANARY_COOKIE_2A',jwt:'CANARY_JWT_2A',
      dni:'CANARY_DNI_2A',allergy:'CANARY_ALLERGY_2A',medication:'CANARY_MEDICATION_2A',diagnosis:'CANARY_DIAGNOSIS_2A',
      requestBody:'CANARY_FULL_BODY_2A'};
    const role=await request(`/api/users/${id(106)}/roles`,{method:'POST',cookie:group,
      body:{roleCode:'SECTION_DELEGATE',sectionId:id(2),expiresAt:Date.now()+60_000,...canaries}});
    assert.equal(role.status,201,JSON.stringify(role.data));
    const roleAudit=await request(`/api/audit/events?requestId=${role.requestId}`,{cookie:group});
    for (const value of Object.values(canaries)) assert.ok(!JSON.stringify(roleAudit.data).includes(value),value);
    assert.equal((await request(`/api/users/${id(106)}/roles/${role.data.id}`,{method:'DELETE',cookie:group})).status,200);
    run(['d1','execute','parpallo-gestio-local','--local','--persist-to',state,'--config','wrangler.toml','--command',
      "CREATE TRIGGER synthetic_audit_failure BEFORE INSERT ON audit_event BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END",'--yes']);
    const rolledBack=await request(`/api/users/${id(107)}/roles`,{method:'POST',cookie:group,
      body:{roleCode:'SECTION_DELEGATE',sectionId:id(2),expiresAt:Date.now()+60_000}});
    assert.equal(rolledBack.status,500);
    run(['d1','execute','parpallo-gestio-local','--local','--persist-to',state,'--config','wrangler.toml','--command','DROP TRIGGER synthetic_audit_failure','--yes']);
    const retried=await request(`/api/users/${id(107)}/roles`,{method:'POST',cookie:group,
      body:{roleCode:'SECTION_DELEGATE',sectionId:id(2),expiresAt:Date.now()+60_000}});
    assert.equal(retried.status,201,'role insert must roll back if audit insert fails');
    assert.equal((await request(`/api/users/${id(107)}/roles/${retried.data.id}`,{method:'DELETE',cookie:group})).status,200);
    assert.equal((await request(`/api/users/${id(104)}/disable`,{method:'POST',cookie:group})).status,200);
    assert.equal((await request('/api/me',{cookie:treasury})).status,401);
    assert.equal((await request(`/api/users/${id(104)}/enable`,{method:'POST',cookie:group})).status,200);
    const treasuryAfterEnable=await login('seed-104');
    assert.deepEqual((await request('/api/me',{cookie:treasuryAfterEnable})).data.roles,[]); // no stale grants resurrect
    run(['d1','execute','parpallo-gestio-local','--local','--persist-to',state,'--config','wrangler.toml','--command',`UPDATE user_permission_grant SET revoked_at=2000000000000 WHERE user_id='${id(105)}'`,'--yes']);
    assert.equal((await request('/api/participants',{cookie:secretary})).status,403); // rol sin permiso explícito
    run(['d1','execute','parpallo-gestio-local','--local','--persist-to',state,'--config','wrangler.toml','--command',`UPDATE app_user SET status='DISABLED',disabled_at=2000000000000 WHERE id='${id(105)}'`,'--yes']);
    assert.equal((await request('/api/me',{cookie:secretary})).status,401);
    run(['d1','execute','parpallo-gestio-local','--local','--persist-to',state,'--config','wrangler.toml','--command',`UPDATE app_session SET absolute_expires_at=created_at+1 WHERE user_id='${id(104)}'`,'--yes']);
    assert.equal((await request('/api/me',{cookie:treasury})).status,401); // expiración absoluta
    run(['d1','execute','parpallo-gestio-local','--local','--persist-to',state,'--config','wrangler.toml','--command',`UPDATE app_session SET last_seen_at=1 WHERE user_id='${id(106)}'`,'--yes']);
    assert.equal((await request('/api/me',{cookie:crm})).status,401); // idle
    const secondEscolta=await login('seed-103');
    const ownSessions=await request('/api/me/sessions',{cookie:escolta});
    const otherSession=ownSessions.data.sessions.find(s=>!s.current);
    assert.ok(otherSession);
    assert.equal((await request(`/api/me/sessions/${otherSession.id}`,{method:'DELETE',cookie:escolta})).status,200);
    assert.equal((await request('/api/me',{cookie:secondEscolta})).status,401);
    assert.equal((await request('/api/me',{cookie:escolta})).status,200);
    run(['d1','execute','parpallo-gestio-local','--local','--persist-to',state,'--config','wrangler.toml','--command',`UPDATE user_role SET expires_at=1700000001000 WHERE user_id='${id(103)}'`,'--yes']);
    assert.equal((await request('/api/participants',{cookie:escolta})).status,403); // rol caducado
    assert.equal((await request('/api/users/'+id(102)+'/suspend',{method:'POST',cookie:tech})).status,403);
    assert.equal((await request('/api/me/sessions/revoke-all',{method:'POST',cookie:tech})).status,200);
    assert.equal((await request('/api/me',{cookie:tech})).status,401);
    const sessions=await request('/api/me/sessions',{cookie:tropa});
    assert.equal(sessions.status,200);assert.ok(sessions.data.sessions.length>=1);
    assert.ok(!JSON.stringify(sessions.data).includes('token_hash'));
    run(['d1','execute','parpallo-gestio-local','--local','--persist-to',state,'--config','wrangler.toml','--command',`UPDATE user_permission_grant SET expires_at=1700000001000 WHERE user_id='${id(102)}' AND permission_code='participants.profile.read'`,'--yes']);
    assert.equal((await request('/api/participants',{cookie:tropa})).status,403); // permiso caducado
    const secondTropa=await login('seed-102');
    const suspended=await request('/api/users/'+id(102)+'/suspend',{method:'POST',cookie:group});
    assert.equal(suspended.status,200,JSON.stringify(suspended.data));
    assert.equal((await request('/api/me',{cookie:tropa})).status,401);
    assert.equal((await request('/api/me',{cookie:secondTropa})).status,401);
    assert.equal((await request('/api/dev/login',{method:'POST',body:{subject:'seed-102'}})).status,401);
    rejectSql(`INSERT INTO user_role(id,user_id,role_code,section_id,valid_from,justification) VALUES('${id(903)}','${id(102)}','SECTION_COORDINATOR','${id(2)}',1,'synthetic')`);
    const logout=await request('/api/logout',{method:'POST',cookie:escolta});assert.equal(logout.status,200);
    assert.equal((await request('/api/me',{cookie:escolta})).status,401);
    const auditPage=await request('/api/audit/events?limit=50',{cookie:group});
    assert.equal(auditPage.status,200);
    for (const action of ['AUTH_LOGIN_SUCCESS','AUTH_SESSION_CREATED','AUTHZ_DENY','HEALTH_ACCESS_GRANTED',
      'HEALTH_ACCESS_REVOKED','ROLE_ASSIGNED','ROLE_REMOVED','AUTH_SESSION_REVOKED','USER_SECURITY_SUSPENDED']) {
      assert.ok(auditPage.data.events.some(event=>event.action===action),action);
    }
    const readTrace=await request(`/api/audit/events?requestId=${auditPage.requestId}`,{cookie:group});
    assert.deepEqual(readTrace.data.events.map(event=>event.action).sort(),['AUDIT_LOG_READ','AUTHZ_ALLOW']);
    const denied=await request('/api/audit/events?action=AUTHZ_DENY',{cookie:group});
    assert.ok(denied.data.events.some(event=>event.actor_user_id===id(107) && event.resource_type==='audit_event'));
    const event=denied.data.events.find(row=>row.resource_type==='participant' && row.resource_id===id(504));
    assert.ok(event,'cross-section denial was audited');
    const incident=await request('/api/incidents',{method:'POST',cookie:group,body:{severity:'LOW',summaryCode:'TEST_SCENARIO'}});
    assert.equal(incident.status,201,JSON.stringify(incident.data));
    assert.equal((await request(`/api/incidents/${incident.data.id}/holds`,{method:'POST',cookie:group,body:{eventId:event.id}})).status,201);
    run(['d1','execute','parpallo-gestio-local','--local','--persist-to',state,'--config','wrangler.toml','--command',`UPDATE audit_event SET occurred_at=1700000000000 WHERE id='${event.id}'`,'--yes']);
    let retentionSql='';
    retentionDeleteStatement({prepare(sql){retentionSql=sql;return {bind(){return null;}};}},Date.now()-1000);
    const deleteSql=retentionSql.replace('?',String(Date.now()-1000));
    run(['d1','execute','parpallo-gestio-local','--local','--persist-to',state,'--config','wrangler.toml','--command',deleteSql,'--yes']);
    assert.equal((await request(`/api/audit/events?requestId=${event.request_id}`,{cookie:group})).data.events.some(row=>row.id===event.id),true);
    assert.equal((await request(`/api/incidents/${incident.data.id}/holds/${event.id}`,{method:'DELETE',cookie:group})).status,200);
    run(['d1','execute','parpallo-gestio-local','--local','--persist-to',state,'--config','wrangler.toml','--command',deleteSql,'--yes']);
    assert.equal((await request(`/api/audit/events?requestId=${event.request_id}`,{cookie:group})).data.events.some(row=>row.id===event.id),false);
    assert.equal((await request('/api/audit/events',{cookie:group})).status,200);
    assert.ok(uuidLike(scope.requestId));
  } finally {
    if(child) {child.kill('SIGTERM');await new Promise(r=>setTimeout(r,300));}
    rmSync(state,{recursive:true,force:true});
  }
});
function uuidLike(value){return /^[0-9a-f-]{36}$/.test(value || '');}
