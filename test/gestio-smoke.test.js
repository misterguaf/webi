// Audit M5: small, real smoke suite on workerd via `wrangler dev` (complements the fast node:sqlite
// tests). Local only: temporary D1/R2 state, private dev registry, free ports, synthetic seed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { root } from './helpers/gestio-sqlite.js';
import { PORT_ARGS, readyBase } from './helpers/wrangler-port.js';
import { unzipSync, strFromU8 } from 'fflate';

const wrangler = resolve(root, 'node_modules/.bin/wrangler');
const env = extra => ({ ...process.env, WRANGLER_SEND_METRICS: 'false', ...extra });
function run(cwd, args) {
  const result = spawnSync(wrangler, args, { cwd, encoding: 'utf8', env: env({}), maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, (result.stderr || result.stdout || '').slice(-2000));
}
async function start(cwd, { state, registry, environment = null, ready }) {
  const args = ['dev', '--local', '--persist-to', state, '--config', 'wrangler.toml', ...PORT_ARGS, ...(environment ? ['--env', environment] : [])];
  const child = spawn(wrangler, args, { cwd, env: env({ WRANGLER_REGISTRY_PATH: registry }) });
  let logs = ''; child.stdout.on('data', chunk => { logs += chunk; }); child.stderr.on('data', chunk => { logs += chunk; });
  const until = Date.now() + 30_000;
  while (Date.now() < until && child.exitCode === null) {
    const base = readyBase(logs);
    try { if (base && (await fetch(base + ready, { signal: AbortSignal.timeout(2000) })).ok) return { child, base }; } catch { /* starting */ }
    await new Promise(done => setTimeout(done, 150));
  }
  child.kill('SIGTERM'); throw new Error('worker did not start: ' + logs.slice(-2000));
}
async function stop(worker) {
  if (!worker || worker.child.exitCode !== null) return;
  worker.child.kill('SIGTERM');
  await new Promise(done => { const timer = setTimeout(() => worker.child.kill('SIGKILL'), 5000);
    worker.child.once('exit', () => { clearTimeout(timer); done(); }); });
}
async function call(base, path, { method = 'GET', cookie = '', body, headers = {} } = {}) {
  const response = await fetch(base + path, { method, signal: AbortSignal.timeout(15_000), headers: {
    ...(cookie ? { Cookie: cookie } : {}), ...(method !== 'GET' ? { Origin: base } : {}),
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
  body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = null; try { data = await response.clone().json(); } catch { /* not JSON */ }
  return { status: response.status, data, headers: response.headers, cookie: response.headers.get('set-cookie') };
}

test('smoke on workerd: Gestió headers, login, capabilities, pagination; portal reaches D1 only via PortalIntake',
  { timeout: 180_000 }, async () => {
  const temp = mkdtempSync(join(tmpdir(), 'parpallo-smoke-'));
  const gestio = join(temp, 'gestio'), portal = join(temp, 'portal');
  cpSync(resolve(root, 'gestio'), gestio, { recursive: true, filter: path => !path.split('/').includes('.wrangler') });
  symlinkSync(resolve(root,'node_modules'),join(temp,'node_modules'),'dir');
  cpSync(resolve(root, 'portal'), portal, { recursive: true });
  mkdirSync(join(temp, 'api'), { recursive: true });
  cpSync(resolve(root, 'api/_lib'), join(temp, 'api/_lib'), { recursive: true });
  const state = join(temp, 'state'), registry = join(temp, 'registry');
  let host, front;
  try {
    run(gestio, ['d1', 'migrations', 'apply', 'parpallo-gestio-local', '--local', '--persist-to', state, '--config', 'wrangler.toml']);
    run(gestio, ['d1', 'execute', 'parpallo-gestio-local', '--local', '--persist-to', state, '--config', 'wrangler.toml', '--file', 'seed.sql', '--yes']);
    host = await start(gestio, { state, registry, ready: '/api/dev/identities' });

    const page = await call(host.base, '/');
    assert.equal(page.status, 200);
    const csp = page.headers.get('content-security-policy') || '';
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /script-src 'self'(?![^;]*unsafe-inline)/);

    const login = await call(host.base, '/api/dev/login', { method: 'POST', body: { subject: 'seed-102' } });
    assert.equal(login.status, 200);
    const cookie = login.cookie.split(';')[0];
    const me = await call(host.base, '/api/me', { cookie });
    assert.equal(me.data.capabilities.version, 1);
    assert.equal(me.data.capabilities.activities.manageGeneral, true);
    assert.equal(me.data.capabilities.fees.read, null);
    const people = await call(host.base, '/api/participants?limit=1', { cookie });
    assert.equal(people.data.participants.length, 1);
    assert.ok(people.data.nextCursor, 'real D1 returns a cursor for a truncated page');
    assert.equal((await call(host.base, '/api/fees/rounds', { cookie })).status, 403);

    // G.4: the two original workbook templates are private and only authorised finance holders
    // receive a freshly generated XLSX. The section role has no Treasury export authority.
    const treasuryLogin=await call(host.base,'/api/dev/login',{method:'POST',body:{subject:'seed-104'}});
    const treasuryCookie=treasuryLogin.cookie.split(';')[0];
    const groupLogin=await call(host.base,'/api/dev/login',{method:'POST',body:{subject:'seed-101'}});
    const groupCookie=groupLogin.cookie.split(';')[0];
    const adminLogin=await call(host.base,'/api/dev/login',{method:'POST',body:{subject:'seed-107'}});
    const adminCookie=adminLogin.cookie.split(';')[0];
    const financeRound=await call(host.base,'/api/finance/rounds',{method:'POST',cookie:treasuryCookie,
      body:{code:'2026/2027',periodStart:'2026-10-01',periodEnd:'2027-09-30'}});
    assert.equal(financeRound.status,201,JSON.stringify(financeRound.data));
    const roundId=financeRound.data.id;
    assert.equal((await call(host.base,`/api/finance/rounds/${roundId}/budget`,
      {method:'POST',cookie:treasuryCookie})).status,201);
    assert.equal((await call(host.base,'/api/finance/budget-lines',{method:'POST',cookie:treasuryCookie,
      body:{roundId,code:'1.1',name:'Quotes',nature:'INCOME',plannedCents:12000}})).status,201);
    const download=async(kind,auth)=>fetch(`${host.base}/api/finance/rounds/${roundId}/export/${kind}`,
      {headers:{Cookie:auth},signal:AbortSignal.timeout(15000)});
    for (const kind of ['result','budget']) {
      const response=await download(kind,treasuryCookie);
      assert.equal(response.status,200,`${kind}: ${await response.clone().text()}`);
      assert.match(response.headers.get('content-type'),/spreadsheetml/);
      assert.match(response.headers.get('content-disposition'),/attachment; filename=/);
      assert.equal(response.headers.get('cache-control'),'no-store');
      const parts=unzipSync(new Uint8Array(await response.arrayBuffer()));
      const sheet=strFromU8(parts['xl/worksheets/sheet1.xml']);
      assert.match(sheet,kind==='budget'?/<c r="D19"[^>]*><v>120<\/v><\/c>/:
        /<c r="D19"[^>]*><f>SUM\(Cuotas!D:D\)<\/f>/);
      assert.equal((await download(kind,groupCookie)).status,200);
      assert.equal((await download(kind,cookie)).status,403);
      assert.equal((await download(kind,adminCookie)).status,403);
    }
    assert.equal((await call(host.base,'/templates/Tesorería General 26_27.xlsx')).status,404);

    front = await start(portal, { state, registry, environment: 'local', ready: '/' });
    const portalLogin = await call(front.base, '/api/portal/session', { method: 'POST', body: { password: 'families-demo' } });
    assert.equal(portalLogin.status, 200);
    const portalCookie = portalLogin.cookie.split(';')[0];
    const config = await call(front.base, '/api/portal/config', { cookie: portalCookie });
    assert.equal(config.status, 200, JSON.stringify(config.data));
    assert.ok(config.data.activitats.some(row => row.publicCode === 'DEMO-FREE-TROPA'));
    const registration = await call(front.base, '/api/inscripcio', { method: 'POST', cookie: portalCookie,
      headers: { 'X-CSRF-Token': portalLogin.data.csrf, 'CF-Connecting-IP': '192.0.2.200' },
      body: { participantNom: 'Persona', participantCognoms: 'Smoke (ficticio)', naixement: '2013-05-18', seccio: 'TRO',
        activitatId: 'DEMO-FREE-TROPA', tutor: 'Tutor smoke (fictici)', telefon: '', email: 'smoke@example.test',
        participacio: true, privacitat: true, idioma: 'va', idempotencyKey: crypto.randomUUID().replaceAll('-', ''), malnom: '', _ts: '' } });
    assert.equal(registration.status, 202, JSON.stringify(registration.data));
    const rows = await call(host.base, '/api/activities/00000000-0000-4000-8000-000000000801/registrations', { cookie });
    assert.ok(rows.data.registrations.some(row => row.submitted_name === 'Persona Smoke (ficticio)'),
      'the portal write landed in Gestió D1 through the service binding');
  } finally {
    await stop(front); await stop(host);
    rmSync(temp, { recursive: true, force: true });
  }
});
