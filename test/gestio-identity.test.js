// Identity provisioning without manual SQL: create user, invite Access identity by verified e-mail,
// bind on first Access login, revoke. No self-registration, no self-provisioning.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../gestio/worker.js';
import { newSession } from '../gestio/src/auth.js';
import { claimInvitedIdentity, inviteIdentity } from '../gestio/src/services/identity-service.js';
import { fixture, id } from './helpers/gestio-sqlite.js';

const ISSUER = 'https://parpallo-test.cloudflareaccess.com', AUDIENCE = 'gestio-test-aud';
const production = db => ({ DB: db, APP_ENV: 'production', ACCESS_ISSUER: ISSUER, ACCESS_AUDIENCE: AUDIENCE });

async function accessSigner() {
  const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...await crypto.subtle.exportKey('jwk', keys.publicKey), kid: 'test-kid', alg: 'RS256', use: 'sig' };
  const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const sign = async claims => {
    const head = b64({ alg: 'RS256', kid: 'test-kid', typ: 'JWT' }), body = b64(claims);
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(`${head}.${body}`));
    return `${head}.${body}.${Buffer.from(signature).toString('base64url')}`;
  };
  const token = (sub, email) => {
    const now = Math.floor(Date.now() / 1000);
    return sign({ iss: ISSUER, aud: [AUDIENCE], sub, email, type: 'app', iat: now - 1, nbf: now - 1, exp: now + 60 });
  };
  return { jwks: { keys: [jwk] }, token };
}
async function accessLogin(db, jwt) {
  return worker.fetch(new Request('https://gestio.example.test/api/auth/access', { method: 'POST',
    headers: { Origin: 'https://gestio.example.test', 'Cf-Access-Jwt-Assertion': jwt } }), production(db));
}

test('coordination creates fictitious users; other roles and non-synthetic names are refused', async () => {
  const f = fixture();
  try {
    for (const user of [101, 102, 107]) await f.login(user);
    const created = await f.request(101, '/api/users', { method: 'POST', body: { displayName: 'Nova Monitora (fictícia)' } });
    assert.equal(created.status, 201);
    assert.equal((await f.request(101, '/api/users', { method: 'POST', body: { displayName: 'Persona Real' } })).status, 400);
    assert.equal((await f.request(107, '/api/users', { method: 'POST', body: { displayName: 'Tècnic (fictici)' } })).status, 403);
    assert.equal((await f.request(102, '/api/users', { method: 'POST', body: { displayName: 'Tropa (fictici)' } })).status, 403);
    const detail = await f.request(101, `/api/users/${created.data.id}`);
    assert.deepEqual([detail.data.roles, detail.data.grants, detail.data.identities], [[], [], []], 'a new person has no access');
    assert.equal(f.sql.prepare("SELECT count(*) AS n FROM audit_event WHERE action='USER_CREATED' AND resource_id=?").get(created.data.id).n, 1);
  } finally { f.close(); }
});

test('invitation rules: no self-invitation, synthetic e-mail, single open invitation, active user', async () => {
  const f = fixture();
  try {
    await f.login(101);
    const user = (await f.request(101, '/api/users', { method: 'POST', body: { displayName: 'Convidada (fictícia)' } })).data.id;
    assert.equal((await f.request(101, `/api/users/${user}/invitations`, { method: 'POST', body: { email: 'Convidada@Example.test' } })).status, 201);
    assert.equal((await f.request(101, `/api/users/${user}/invitations`, { method: 'POST', body: { email: 'convidada@example.test' } })).status, 409);
    assert.equal((await f.request(101, `/api/users/${user}/invitations`, { method: 'POST', body: { email: 'real@gmail.com' } })).status, 400);
    assert.equal((await f.request(101, `/api/users/${id(101)}/invitations`, { method: 'POST', body: { email: 'jo@example.test' } })).status, 403);
    const stored = { ...f.sql.prepare('SELECT issuer,email FROM auth_identity_invitation WHERE user_id=?').get(user) };
    assert.deepEqual(stored, { issuer: 'urn:parpallo:local-synthetic', email: 'convidada@example.test' });
  } finally { f.close(); }
});

test('first Access login binds the invited subject once; unknown or revoked identities are refused', async () => {
  const f = fixture();
  const original = globalThis.fetch;
  try {
    const signer = await accessSigner();
    globalThis.fetch = async url => String(url) === `${ISSUER}/cdn-cgi/access/certs` ? Response.json(signer.jwks) : original(url);
    await f.login(101);
    const admin = { ...f.context[101] };
    const user = (await f.request(101, '/api/users', { method: 'POST', body: { displayName: 'Monitor Nou (fictici)' } })).data.id;
    const session = f.sql.prepare('SELECT created_at FROM app_session WHERE id=?').get(admin.sessionId);
    await inviteIdentity(f.db, admin, session, crypto.randomUUID(), production(f.db), user, { email: 'monitor.nou@example.test' });

    assert.equal((await accessLogin(f.db, await signer.token('access-sub-unknown', 'ningu@example.test'))).status, 401,
      'no invitation, no account: there is no self-registration');
    const first = await accessLogin(f.db, await signer.token('access-sub-1', 'MONITOR.NOU@example.test'));
    assert.equal(first.status, 200);
    assert.match(first.headers.get('set-cookie'), /__Host-gestio_session=.*Secure/);
    assert.equal((await first.json()).user.id, user);
    assert.equal((await accessLogin(f.db, await signer.token('access-sub-1', 'monitor.nou@example.test'))).status, 200, 'bound subject logs in');
    assert.equal((await accessLogin(f.db, await signer.token('access-sub-2', 'monitor.nou@example.test'))).status, 401,
      'a consumed invitation cannot bind a second subject');
    assert.equal(f.sql.prepare("SELECT count(*) AS n FROM audit_event WHERE action='IDENTITY_LINKED'").get().n, 1);

    const identity = f.sql.prepare('SELECT id FROM auth_identity WHERE subject=?').get('access-sub-1').id;
    assert.equal((await f.request(101, `/api/users/${user}/identities/${identity}`, { method: 'DELETE' })).status, 200);
    assert.equal(f.sql.prepare("SELECT count(*) AS n FROM app_session WHERE user_id=? AND revoked_at IS NULL").get(user).n, 0);
    assert.equal((await accessLogin(f.db, await signer.token('access-sub-1', 'monitor.nou@example.test'))).status, 401,
      'a revoked identity is not silently re-linked');
  } finally { globalThis.fetch = original; f.close(); }
});

test('expired or revoked invitations never bind; a stale session cannot provision', async () => {
  const f = fixture();
  try {
    await f.login(101);
    const user = (await f.request(101, '/api/users', { method: 'POST', body: { displayName: 'Caducada (fictícia)' } })).data.id;
    const invitation = (await f.request(101, `/api/users/${user}/invitations`, { method: 'POST', body: { email: 'caducada@example.test' } })).data.id;
    assert.equal((await f.request(101, `/api/users/${user}/invitations/${invitation}`, { method: 'DELETE' })).status, 200);
    assert.equal(await claimInvitedIdentity(f.db, crypto.randomUUID(),
      { issuer: 'urn:parpallo:local-synthetic', subject: 'sub-x', email: 'caducada@example.test' }), null);
    f.sql.exec(`INSERT INTO auth_identity_invitation(id,user_id,issuer,email,created_by,created_at,expires_at)
      VALUES('${id(8801)}','${user}','urn:parpallo:local-synthetic','caducada@example.test','${id(101)}',1,2)`);
    assert.equal(await claimInvitedIdentity(f.db, crypto.randomUUID(),
      { issuer: 'urn:parpallo:local-synthetic', subject: 'sub-y', email: 'caducada@example.test' }), null);
    // A session older than the recent-authentication window cannot create people.
    const stale = await newSession(f.db, id(101), Date.now() - 10 * 60 * 1000);
    const response = await worker.fetch(new Request('http://127.0.0.1:8788/api/users', { method: 'POST',
      headers: { Cookie: `gestio_session=${stale.token}`, Origin: 'http://127.0.0.1:8788', 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'Sessió antiga (fictícia)' }) }), { DB: f.db, APP_ENV: 'development', DEV_IDENTITY_PROVIDER: 'enabled' });
    assert.ok([401, 403].includes(response.status));
  } finally { f.close(); }
});
