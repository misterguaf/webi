// Gestió «proves» (gestioproves.grupscoutparpallo.com): Access gate on every request, demo identity selector only
// for a STAGING deployment with a valid Access JWT, no R2 (placeholder evidence), and a nightly reset that restores
// the demo snapshot exactly, in small batches, with Gestió in maintenance meanwhile.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import worker from '../gestio/worker.js';
import { buildDemoDatabase, LIMITS, snapshotFrom } from '../gestio/proves/snapshot.js';
import { createAccessGate, createProvesWorker, placeholderStorage, resetRunning, resetTick } from '../gestio/proves/runtime.js';
import { assertProvesConfig } from '../gestio/scripts/proves.js';
import { fixture, root } from './helpers/gestio-sqlite.js';

const ISSUER = 'https://parpallo-proves.cloudflareaccess.com', AUDIENCE = 'a'.repeat(64);
const ORIGIN = 'https://gestioproves.grupscoutparpallo.com';
const staging = db => ({ DB: db, APP_ENV: 'production', DEPLOYMENT_ENVIRONMENT: 'STAGING', STAGING_DEMO_LOGIN: 'enabled',
  ACCESS_ISSUER: ISSUER, ACCESS_AUDIENCE: AUDIENCE });
const BUILT_AT = Date.UTC(2026, 9, 8, 12);
// The reference database stays open: the reset must reproduce it row by row.
const built = buildDemoDatabase({ now: BUILT_AT });
const snapshot = snapshotFrom(built);

async function accessSigner() {
  const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...await crypto.subtle.exportKey('jwk', keys.publicKey), kid: 'proves-kid', alg: 'RS256', use: 'sig' };
  const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = async ({ audience = AUDIENCE, issuer = ISSUER } = {}) => {
    const now = Math.floor(Date.now() / 1000);
    const head = b64({ alg: 'RS256', kid: 'proves-kid', typ: 'JWT' });
    const body = b64({ iss: issuer, aud: [audience], sub: 'access-sub', email: 'provador@example.test', type: 'app', iat: now - 1, nbf: now - 1, exp: now + 60 });
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(`${head}.${body}`));
    return `${head}.${body}.${Buffer.from(signature).toString('base64url')}`;
  };
  const fetchImpl = async url => String(url) === `${ISSUER}/cdn-cgi/access/certs` ? Response.json({ keys: [jwk] }) : new Response('no', { status: 404 });
  return { token, fetchImpl };
}

const rowsOf = (sql, table) => JSON.stringify(sql.prepare(`SELECT * FROM "${table}" ORDER BY 1`).all());
const triggerSql = sql => sql.prepare("SELECT name, sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all()
  .map(row => [row.name, row.sql.replace(/CREATE TRIGGER IF NOT EXISTS /i, 'CREATE TRIGGER ')]);

test('snapshot plan fits the free D1 limits and is a faithful copy of the demo', () => {
  assert.ok(snapshot.rows > 1000 && snapshot.tables.length > 50, `${snapshot.rows} rows`);
  for (const batch of snapshot.batches) {
    assert.ok(batch.length + 2 <= 45, 'batch + PRAGMA + state update stays under 50 queries');
    assert.ok(batch.join('').length <= LIMITS.batchBytes + LIMITS.statementBytes);
    for (const statement of batch) assert.ok(statement.length <= 100_000);
  }
  assert.deepEqual(snapshot.evidenceTables.sort(), ['annual_fee_evidence', 'finance_expense_evidence', 'payment_evidence']);
  assert.match(snapshot.latestMigration, /^\d{4}_.+\.sql$/);
  assert.equal(snapshot.counts.participant, 104);
});

test('nightly reset restores the demo exactly (rows and triggers), only when something changed, once per day', async () => {
  const reference = built.sql;
  const f = fixture();
  try {
    f.sql.exec(`CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT);
      INSERT INTO d1_migrations(name) VALUES ('${snapshot.latestMigration}')`);
    // Someone used the environment: sessions, audit and business rows that are not in the demo.
    await f.login(101);
    assert.equal((await f.request(101, '/api/users', { method: 'POST', body: { displayName: 'Provadora Nova (fictícia)' } })).status, 201);
    const day = Date.UTC(2026, 9, 9, 2, 0);
    let result = await resetTick(f.db, snapshot, day);
    assert.equal(result.action, 'started');
    assert.equal(await resetRunning(f.db), true);
    let ticks = 0;
    do { result = await resetTick(f.db, snapshot, day + (++ticks) * 60_000); } while (result.action === 'batch');
    assert.equal(result.action, 'finished');
    assert.equal(ticks, snapshot.batches.length, 'one batch per minute');
    assert.ok(ticks < 60, 'finishes inside the reset hour');
    assert.equal(await resetRunning(f.db), false);
    for (const table of snapshot.tables) assert.equal(rowsOf(f.sql, table), rowsOf(reference, table), table);
    assert.deepEqual(triggerSql(f.sql), triggerSql(reference));
    assert.equal(f.sql.prepare('PRAGMA foreign_key_check').all().length, 0);
    assert.throws(() => f.sql.exec('DELETE FROM participant_representation_event'), /no_delete|immutable|RAISE|not allowed|constraint/i, 'guard triggers are back');
    // Same day: nothing more. Next day without changes: skipped. After a change: reset again.
    assert.equal((await resetTick(f.db, snapshot, day + 3_000_000)).action, 'idle');
    assert.equal((await resetTick(f.db, snapshot, day + 86_400_000)).action, 'unchanged');
    await f.login(102);
    assert.equal((await resetTick(f.db, snapshot, day + 2 * 86_400_000)).action, 'started');
  } finally { f.close(); }
});

test('reset refuses a database whose schema differs from the snapshot', async () => {
  const f = fixture();
  try {
    f.sql.exec(`CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT);
      INSERT INTO d1_migrations(name) VALUES ('0001_older.sql')`);
    const before = f.sql.prepare('SELECT count(*) AS n FROM app_user').get().n;
    assert.equal((await resetTick(f.db, snapshot, Date.UTC(2026, 9, 9, 2))).action, 'schema_mismatch');
    assert.equal(f.sql.prepare('SELECT count(*) AS n FROM app_user').get().n, before);
  } finally { f.close(); }
});

test('every request needs a valid Access JWT; misconfiguration fails closed; maintenance answers 503', async () => {
  const signer = await accessSigner();
  const f = fixture();
  try {
    const seen = [];
    const app = { fetch: async (request, env) => { seen.push(env); return new Response('gestio'); } };
    const proves = createProvesWorker({ app, snapshot, verifyAccess: createAccessGate({ fetchImpl: signer.fetchImpl }) });
    const get = (path, headers = {}, env = staging(f.db)) => proves.fetch(new Request(ORIGIN + path, { headers }), env);
    assert.equal((await get('/')).status, 403, 'no Access JWT');
    assert.equal((await get('/', { 'Cf-Access-Jwt-Assertion': 'x.y.z' })).status, 403);
    assert.equal((await get('/', { 'Cf-Access-Jwt-Assertion': await signer.token({ audience: 'b'.repeat(64) }) })).status, 403, 'other Access app');
    const jwt = { 'Cf-Access-Jwt-Assertion': await signer.token() };
    assert.equal(await (await get('/', jwt)).text(), 'gestio');
    assert.ok(seen[0].EVIDENCE_STORAGE && seen[0].DB, 'placeholder storage instead of R2');
    for (const env of [{ ...staging(f.db), DEPLOYMENT_ENVIRONMENT: 'PRODUCTION' }, { ...staging(f.db), EVIDENCE_STORAGE: {} },
      { ...staging(f.db), ACCESS_AUDIENCE: 'REPLACE_AUD' }, { ...staging(f.db), STAGING_DEMO_LOGIN: undefined }])
      assert.equal((await get('/', jwt, env)).status, 500);
    f.sql.exec(`CREATE TABLE proves_reset_state(id INTEGER PRIMARY KEY, status TEXT); INSERT INTO proves_reset_state VALUES (1,'RUNNING')`);
    const busy = await get('/api/me', jwt);
    assert.equal(busy.status, 503);
    assert.equal((await busy.json()).error, 'maintenance');
    assert.equal((await get('/', jwt)).status, 200, 'static shell still loads');
  } finally { f.close(); }
});

test('demo identity selector: STAGING with a valid Access JWT only; local unchanged; never on production', async () => {
  const signer = await accessSigner();
  const f = fixture();
  const original = globalThis.fetch;
  try {
    globalThis.fetch = signer.fetchImpl;
    const call = async (path, env, { jwt, body } = {}) => worker.fetch(new Request(ORIGIN + path, { method: body ? 'POST' : 'GET',
      headers: { ...(jwt ? { 'Cf-Access-Jwt-Assertion': jwt } : {}), ...(body ? { Origin: ORIGIN, 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) }), env);
    const jwt = await signer.token();
    assert.equal((await call('/api/dev/identities', staging(f.db))).status, 404, 'no Access JWT, no selector');
    const listed = await call('/api/dev/identities', staging(f.db), { jwt });
    assert.equal(listed.status, 200);
    const data = await listed.json();
    assert.equal(data.environment, 'STAGING');
    assert.ok(data.identities.length >= 7);
    const login = await call('/api/dev/login', staging(f.db), { jwt, body: { subject: 'seed-104' } });
    assert.equal(login.status, 200);
    assert.match(login.headers.get('set-cookie'), /^__Host-gestio_session=.*; Secure$/);
    assert.equal((await call('/api/dev/login', staging(f.db), { body: { subject: 'seed-104' } })).status, 404);
    const production = { ...staging(f.db), DEPLOYMENT_ENVIRONMENT: 'PRODUCTION', STAGING_DEMO_LOGIN: undefined };
    assert.equal((await call('/api/dev/identities', production, { jwt })).status, 404, 'production keeps Access invitations only');
    assert.equal((await call('/api/dev/identities', { ...production, STAGING_DEMO_LOGIN: 'enabled' }, { jwt })).status, 500, 'flag refused outside STAGING');
    const local = await worker.fetch(new Request('http://127.0.0.1:8788/api/dev/identities'), { DB: f.db, APP_ENV: 'development', DEV_IDENTITY_PROVIDER: 'enabled' });
    assert.equal((await local.json()).environment, 'LOCAL');
    // Other development endpoints stay local-only.
    assert.ok([401, 404].includes((await call('/api/dev/notifications/drain', staging(f.db), { jwt, body: {} })).status));
  } finally { globalThis.fetch = original; f.close(); }
});

test('placeholder evidence: nothing stored, the type comes from the D1 row', async () => {
  const f = fixture();
  try {
    const storage = placeholderStorage(f.db, snapshot);
    const bytes = async key => Buffer.from((await storage.get(key)).body);
    assert.equal((await bytes('synthetic/demo-fee-1.pdf')).subarray(0, 5).toString(), '%PDF-');
    assert.equal((await bytes('synthetic/demo-activity-2.png'))[1], 80);
    assert.equal((await bytes('synthetic/unknown')).subarray(0, 5).toString(), '%PDF-');
    assert.deepEqual(await storage.put('synthetic/x', new Uint8Array([1])), { key: 'synthetic/x' });
  } finally { f.close(); }
});

test('deploy config: only the reviewed STAGING shape is accepted; local config untouched', () => {
  const committed = readFileSync(join(root, 'gestio/wrangler.proves.toml'), 'utf8');
  const filled = committed;
  assert.doesNotThrow(() => assertProvesConfig(filled));
  assert.throws(() => assertProvesConfig(filled.replace(/ACCESS_AUDIENCE = "[^"]*"/, 'ACCESS_AUDIENCE = "REPLACE_AUD"')), /REPLACE_/, 'placeholders block a deploy');
  for (const broken of [filled + '\n[[r2_buckets]]\nbinding = "EVIDENCE_STORAGE"\n', filled.replace('STAGING"', 'PRODUCTION"'),
    filled + '\nDEV_IDENTITY_PROVIDER = "enabled"\n', filled.replace('workers_dev = false', 'workers_dev = true'),
    filled.replace('gestioproves.grupscoutparpallo.com", custom_domain', 'gestio.grupscoutparpallo.com", custom_domain')])
    assert.throws(() => assertProvesConfig(broken));
  assert.match(committed, /^crons = \["\* 2 \* \* \*"\]$/m);
  assert.doesNotMatch(readFileSync(join(root, 'gestio/wrangler.toml'), 'utf8'), /proves|STAGING/);
  assert.match(readFileSync(join(root, 'gestio/scripts/deploy.js'), 'utf8'), /blocked/, 'production deploy stays blocked');
});

