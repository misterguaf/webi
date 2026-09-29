// Audit M7: one auditable environment policy; no synthetic or environment fences scattered in services.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { assertRuntime, DATA_MODE, devIdentityEnabled, hostAllowed, portalIntakeEnabled, runtimeEnvironment, synthetic }
  from '../gestio/src/environment-policy.js';
import { fixture, root } from './helpers/gestio-sqlite.js';

const local = new URL('http://127.0.0.1:8788/'), remote = new URL('https://gestio.grupscoutparpallo.com/');

test('runtime environments are explicit: local-synthetic, test and production', () => {
  assert.equal(runtimeEnvironment({ APP_ENV: 'development' }), 'local-synthetic');
  assert.equal(runtimeEnvironment({ APP_ENV: 'test' }), 'test');
  assert.equal(runtimeEnvironment({ APP_ENV: 'production' }), 'production');
  for (const APP_ENV of [undefined, '', 'staging', 'PRODUCTION']) assert.throws(() => runtimeEnvironment({ APP_ENV }));
  assert.equal(DATA_MODE, 'SYNTHETIC_ONLY', 'opening production is a reviewed change to environment-policy.js');
});

test('production refuses the dev identity provider, local-only features and family intake', () => {
  const production = { APP_ENV: 'production', DB: {}, EVIDENCE_STORAGE: {}, ACCESS_ISSUER: 'x', ACCESS_AUDIENCE: 'y' };
  assert.throws(() => assertRuntime({ ...production, DEV_IDENTITY_PROVIDER: 'enabled' }), /cannot be enabled/);
  assert.throws(() => assertRuntime({ ...production, ACCESS_AUDIENCE: '' }), /Access/);
  assert.throws(() => assertRuntime({ APP_ENV: 'test' }), /D1/);
  assert.equal(assertRuntime(production), 'production');
  assert.equal(devIdentityEnabled({ ...production, DEV_IDENTITY_PROVIDER: 'enabled' }, local), false);
  assert.equal(portalIntakeEnabled(production), false);
  assert.equal(hostAllowed(production, remote), true);
  for (const APP_ENV of ['development', 'test']) {
    const env = { APP_ENV, DB: {}, EVIDENCE_STORAGE: {}, DEV_IDENTITY_PROVIDER: 'enabled' };
    assert.equal(devIdentityEnabled(env, local), true);
    assert.equal(devIdentityEnabled(env, remote), false, 'dev login only on loopback');
    assert.equal(hostAllowed(env, remote), false);
    assert.equal(portalIntakeEnabled(env), true);
    assert.equal(portalIntakeEnabled({ ...env, EVIDENCE_STORAGE: undefined }), false);
  }
});

test('synthetic fences behave as before', () => {
  assert.equal(synthetic.email('persona@example.test'), true);
  assert.equal(synthetic.email('persona@gmail.com'), false);
  assert.equal(synthetic.reference('DEMO-AUTH-TROPA-001'), true);
  assert.equal(synthetic.reference('ACTA-2026-01'), false);
  assert.equal(synthetic.evidence(new TextEncoder().encode('%PDF-1.4 synthetic')), true);
  assert.equal(synthetic.evidence(new TextEncoder().encode('%PDF-1.4 real bank receipt')), false);
});

test('no service or worker hard-codes synthetic markers or reads APP_ENV directly', () => {
  const files = [join(root, 'gestio/worker.js'), ...readdirSync(join(root, 'gestio/src'), { recursive: true })
    .filter(name => String(name).endsWith('.js') && !String(name).endsWith('environment-policy.js'))
    .map(name => join(root, 'gestio/src', String(name)))];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /@example\.test|['"]DEMO-|\^DEMO-|['"]synthetic['"]|SYNTHETIC_PHASE|APP_ENV/, file);
  }
});

test('Gestió serves APP_ENV=test on loopback like the local synthetic runtime', async () => {
  const f = fixture();
  try {
    await f.login(101);
    const response = await f.request(101, '/api/me', { env: { APP_ENV: 'test' } });
    assert.equal(response.status, 200);
    const outside = await (await import('../gestio/worker.js')).default.fetch(new Request('https://gestio.example.test/api/me'),
      { DB: f.db, APP_ENV: 'test' });
    assert.equal(outside.status, 403);
  } finally { f.close(); }
});
