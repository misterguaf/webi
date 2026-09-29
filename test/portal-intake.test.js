// Audit A1: the public portal has no general database access. It reaches Gestió only through the
// narrow PortalIntake entrypoint; responses stay non-enumerating and fail closed outside local/test.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import portal from '../portal/worker.js';
import { PortalIntake } from '../gestio/worker.js';
import { _reset } from '../api/_lib/ratelimit.js';
import { fixture, id, root } from './helpers/gestio-sqlite.js';

const ORIGIN = 'https://inscripcions.example.test';
const pdf = Buffer.from('%PDF-1.4\n%synthetic portal intake fixture\n%%EOF');
const storage = () => {
  const objects = new Map();
  return { objects, put: async (key, value) => { objects.set(key, value); }, delete: async key => { objects.delete(key); },
    get: async key => objects.has(key) ? { body: objects.get(key) } : null };
};
// Any read of a data binding on the portal env would be a regression.
const guardedEnv = extra => new Proxy({
  PORTAL_ACCESS_PASSWORD: 'families-prova', PORTAL_SESSION_SECRET: 'secret-de-sessio-prou-llarg-per-a-proves',
  PORTAL_SESSION_VERSION: 'test', PORTAL_ALLOWED_ORIGIN: ORIGIN,
  ASSETS: { fetch: async request => new Response('asset:' + new URL(request.url).pathname) }, ...extra
}, { get(target, key) {
  if (['DB', 'EVIDENCE_STORAGE'].includes(key)) throw new Error(`portal touched ${String(key)}`);
  return target[key];
} });

beforeEach(() => _reset());

async function session(env) {
  const login = await portal.fetch(new Request(ORIGIN + '/api/portal/session', { method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.20' },
    body: JSON.stringify({ password: 'families-prova' }) }), env);
  assert.equal(login.status, 200);
  return { cookie: login.headers.get('set-cookie').split(';')[0], csrf: (await login.json()).csrf };
}
const post = (env, auth, path, body, ip) => portal.fetch(new Request(ORIGIN + path, { method: 'POST',
  headers: { Origin: ORIGIN, Cookie: auth.cookie, 'X-CSRF-Token': auth.csrf, 'Content-Type': 'application/json',
    'CF-Connecting-IP': ip }, body: JSON.stringify(body) }), env);
const form = (name, extra = {}) => {
  const [nom, ...cognoms] = name.split(' ');
  return { participantNom: nom, participantCognoms: cognoms.join(' '), naixement: '2013-05-18', seccio: 'TRO',
    activitatId: 'DEMO-FREE-TROPA', tutor: 'Persona fictícia', telefon: '', email: 'intake@example.test',
    participacio: true, privacitat: true, idioma: 'va', idempotencyKey: crypto.randomUUID().replaceAll('-', ''),
    malnom: '', _ts: '', ...extra };
};

test('static boundary: no data bindings and no imports from gestio in the portal Worker', () => {
  const config = readFileSync(join(root, 'portal/wrangler.toml'), 'utf8');
  assert.doesNotMatch(config, /d1_databases|r2_buckets|kv_namespaces|durable_objects/);
  assert.equal((config.match(/entrypoint = "PortalIntake"/g) || []).length, 2, 'production and local');
  for (const file of readdirSync(join(root, 'portal')).filter(name => name.endsWith('.js'))) {
    const source = readFileSync(join(root, 'portal', file), 'utf8');
    assert.doesNotMatch(source, /from\s+["'][./]*gestio\//, file);
    assert.doesNotMatch(source, /env\.DB|EVIDENCE_STORAGE/, file);
  }
  // The intake entrypoint is not reachable through Gestió's public HTTP router.
  assert.doesNotMatch(readFileSync(join(root, 'gestio/worker.js'), 'utf8'), /\/v1\/(catalog|registrations|fees)/);
});

test('portal forwards only the three intake operations and never reads a data binding', async () => {
  const calls = [];
  const env = guardedEnv({ GESTIO_INTAKE: { fetch: async request => {
    calls.push({ method: request.method, path: new URL(request.url).pathname, body: await request.json() });
    return Response.json(new URL(request.url).pathname.endsWith('catalog') ? { ok: true, activitats: [], quota: { oberta: false } }
      : { ok: true, reference: 'ref' }, { status: 202 });
  } } });
  const auth = await session(env);
  assert.equal((await portal.fetch(new Request(ORIGIN + '/api/portal/config', { headers: { Cookie: auth.cookie } }), env)).status, 200);
  assert.equal((await post(env, auth, '/api/inscripcio', form('Participante Tropa A (ficticio)'), '198.51.100.21')).status, 202);
  for (const path of ['/api/participants', '/api/payments', '/api/fees/rounds', '/api/me'])
    assert.equal((await portal.fetch(new Request(ORIGIN + path, { headers: { Cookie: auth.cookie } }), env)).status, 404, path);
  // Non-API paths are static assets; they never reach the intake binding.
  assert.match(await (await portal.fetch(new Request(ORIGIN + '/v1/catalog', { headers: { Cookie: auth.cookie } }), env)).text(), /^asset:/);
  assert.deepEqual(calls.map(call => `${call.method} ${call.path}`), ['POST /v1/catalog', 'POST /v1/registrations']);
  const registration = calls[1].body;
  assert.equal(registration.participationAccepted, true);
  assert.equal(registration.privacyAcknowledged, true);
  assert.ok(!('participationTermsVersion' in registration) && !('privacyNoticeVersion' in registration),
    'legal text versions are decided by Gestió, not by the public caller');
});

test('portal fails closed without the intake binding', async () => {
  const env = guardedEnv({});
  const auth = await session(env);
  const config = await portal.fetch(new Request(ORIGIN + '/api/portal/config', { headers: { Cookie: auth.cookie } }), env);
  assert.equal(config.status, 503);
  assert.equal((await post(env, auth, '/api/inscripcio', form('Participante Tropa A (ficticio)'), '198.51.100.22')).status, 503);
});

test('PortalIntake: narrow routes, POST only, closed in production and without storage', async () => {
  const f = fixture();
  try {
    const env = { APP_ENV: 'test', DB: f.db, EVIDENCE_STORAGE: storage() };
    const call = (path, init = {}, overrides = {}) => PortalIntake.fetch(new Request('https://gestio-intake.internal' + path,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', ...init }), { ...env, ...overrides });
    for (const path of ['/v1/participants', '/v1/sql', '/api/participants', '/v2/catalog', '/v1/catalog/../participants'])
      assert.equal((await call(path)).status, 404, path);
    assert.equal((await call('/v1/catalog', { method: 'GET', body: undefined })).status, 405);
    assert.equal((await call('/v1/registrations', { headers: { 'Content-Type': 'text/plain' } })).status, 415);
    assert.equal((await call('/v1/catalog', {}, { APP_ENV: 'production', ACCESS_ISSUER: 'x', ACCESS_AUDIENCE: 'y' })).status, 503);
    assert.equal((await call('/v1/catalog', {}, { EVIDENCE_STORAGE: undefined })).status, 503);
    assert.equal((await call('/v1/catalog', {}, { APP_ENV: 'bogus' })).status, 503);
    const catalog = await (await call('/v1/catalog')).json();
    assert.ok(catalog.activitats.length > 0);
    for (const row of catalog.activitats) {
      assert.ok(!('id' in row) && !('created_by' in row) && !('status' in row), 'public projection only');
      assert.match(row.publicCode, /^[A-Z0-9-]+$/);
    }
  } finally { f.close(); }
});

test('PortalIntake registration: identical response for clear, ambiguous and unknown people; policy sets versions', async () => {
  const f = fixture();
  try {
    f.sql.exec(`INSERT INTO participant(id,display_name,current_section_id,status,birth_date) VALUES
      ('${id(961)}','Participant Doble (ficticio)','${id(2)}','ACTIVE','2013-05-18'),
      ('${id(962)}','Participant Doble (ficticio)','${id(2)}','ACTIVE','2013-05-18')`);
    const env = { APP_ENV: 'test', DB: f.db, EVIDENCE_STORAGE: storage() };
    const submit = body => PortalIntake.fetch(new Request('https://gestio-intake.internal/v1/registrations',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env);
    const base = name => ({ publicCode: 'DEMO-FREE-TROPA', participantName: name, birthDate: '2013-05-18',
      submittedByName: 'Persona fictícia', sectionCode: 'TROPA', receiptEmail: 'intake@example.test',
      idempotencyKey: crypto.randomUUID().replaceAll('-', ''), participationAccepted: true, privacyAcknowledged: true });
    const results = [];
    for (const name of ['Participante Tropa A (ficticio)', 'Participant Doble (ficticio)', 'Persona Desconeguda (ficticio)']) {
      const response = await submit(base(name));
      results.push({ status: response.status, body: await response.json() });
    }
    assert.deepEqual(results, Array(3).fill({ status: 202, body: { ok: true } }));
    const stored = f.sql.prepare(`SELECT match_status,participation_terms_version,privacy_notice_version
      FROM activity_registration WHERE receipt_email='intake@example.test' ORDER BY match_status`).all();
    assert.deepEqual(stored.map(row => row.match_status), ['AMBIGUOUS', 'CLEAR', 'NONE']);
    assert.ok(stored.every(row => row.participation_terms_version === 'DEMO-3A-PARTICIPATION-V1'));
    for (const forged of [{ participationTermsVersion: 'X' }, { privacyNoticeVersion: 'X' }, { participantId: id(502) }, { status: 'CONFIRMED' }])
      assert.equal((await submit({ ...base('Participante Tropa A (ficticio)'), ...forged })).status, 400, JSON.stringify(forged));
    assert.equal((await submit({ ...base('Participante Tropa A (ficticio)'), privacyAcknowledged: false })).status, 400);
  } finally { f.close(); }
});

test('end to end in process: portal -> PortalIntake -> D1, with the portal holding no data binding', async () => {
  const f = fixture();
  try {
    const evidence = storage();
    const gestioEnv = { APP_ENV: 'test', DB: f.db, EVIDENCE_STORAGE: evidence };
    const env = guardedEnv({ GESTIO_INTAKE: { fetch: request => PortalIntake.fetch(request, gestioEnv) } });
    const auth = await session(env);
    const config = await (await portal.fetch(new Request(ORIGIN + '/api/portal/config', { headers: { Cookie: auth.cookie } }), env)).json();
    assert.equal(config.quota.oberta, true);
    const fee = await post(env, auth, '/api/cuota', { roundCode: '2026/2027', fills: [{ nom: 'Participante', cognoms: 'Tropa A (ficticio)',
      naixement: '2013-05-18', seccio: 'TRO' }], tutor: 'Persona fictícia', telefon: '', email: 'fee-intake@example.test',
      declaredAmountCents: 10000, privacitat: true, idempotencyKey: crypto.randomUUID().replaceAll('-', ''), malnom: '', _ts: '',
      comprovant: { nom: 'justificant.pdf', tipus: 'application/pdf', base64: pdf.toString('base64') } }, '198.51.100.30');
    assert.equal(fee.status, 202);
    const body = await fee.json();
    assert.match(body.referencia, /^[0-9a-f-]{36}$/);
    assert.doesNotMatch(JSON.stringify(body), /candidate|participantId|matchStatus|CLEAR/);
    assert.equal(f.sql.prepare("SELECT privacy_notice_version AS v FROM annual_fee_payment WHERE receipt_email='fee-intake@example.test'").get().v,
      'DEMO-3B-PRIVACY-NOTICE-V1');
    assert.equal(evidence.objects.size, 1);
    assert.equal((await post(env, auth, '/api/inscripcio', form('Participante Tropa A (ficticio)'), '198.51.100.31')).status, 202);
  } finally { f.close(); }
});
