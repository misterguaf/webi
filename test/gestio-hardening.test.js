// Low-severity audit findings: L1 concealment of out-of-scope reads, L2 security headers,
// L3 current-section semantics in fee metrics, L4 optimistic concurrency helper.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createObligation, reviewFeePayment, submitFee } from '../gestio/src/services/annual-fee-service.js';
import { feeMetrics } from '../gestio/src/services/annual-fee-metrics.js';
import { versionCas } from '../gestio/src/concurrency.js';
import { fixture, id, root } from './helpers/gestio-sqlite.js';

const ESCOLTA = id(3);
const pdf = Buffer.from('%PDF-1.4\n%synthetic hardening fixture\n%%EOF');

test('L1: out-of-scope single-resource reads answer 404 like missing ones; lack of permission stays 403', async () => {
  const f = fixture();
  try {
    await f.login(103); await f.login(107);
    const tropaActivity = id(801);
    const missing = await f.request(103, `/api/activities/${id(899)}`);
    const outOfScope = await f.request(103, `/api/activities/${tropaActivity}`);
    assert.equal(missing.status, 404);
    assert.equal(outOfScope.status, 404, 'Escolta coordinator cannot confirm a Tropa activity exists');
    assert.deepEqual(Object.keys(outOfScope.data).sort(), Object.keys(missing.data).sort());
    assert.equal((await f.request(103, `/api/activities/${tropaActivity}/registrations`)).status, 404);
    assert.equal((await f.request(107, `/api/activities/${tropaActivity}`)).status, 403, 'no permission at all: 403');
    assert.ok(f.sql.prepare("SELECT count(*) AS n FROM audit_event WHERE actor_user_id=? AND action='AUTHZ_DENY' AND reason_code='OUT_OF_SCOPE'")
      .get(id(103)).n >= 1, 'concealed denials are still audited');
  } finally { f.close(); }
});

test('L2: Gestió pages carry a strict CSP without unsafe-inline and cannot be framed', async () => {
  const worker = (await import('../gestio/worker.js')).default;
  const f = fixture();
  try {
    const env = { DB: f.db, APP_ENV: 'test', ASSETS: { fetch: async () => new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } }) } };
    const page = await worker.fetch(new Request('http://127.0.0.1:8788/'), env);
    const csp = page.headers.get('content-security-policy');
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /script-src 'self'/);
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
    assert.equal(page.headers.get('x-frame-options'), 'DENY');
    const api = await worker.fetch(new Request('http://127.0.0.1:8788/api/me'), env);
    assert.match(api.headers.get('content-security-policy'), /default-src 'none'/);
    const html = readFileSync(join(root, 'gestio/public/index.html'), 'utf8');
    assert.doesNotMatch(html, /<script>(?!<\/script>)|<script(?![^>]*\bsrc=)[^>]*>|\sstyle="|\son[a-z]+="/,
      'no inline script, style attribute or inline handler in the page');
  } finally { f.close(); }
});

test('L3: scoped fee metrics count a matched payment by the participant CURRENT section', async () => {
  const f = fixture();
  try {
    // A deliberately section-scoped finance.fee.read holder (Tropa coordinator) to exercise the scoped branch.
    f.sql.exec(`INSERT INTO role_permission VALUES('SECTION_COORDINATOR','finance.fee.read');
      INSERT INTO user_permission_grant(id,user_id,permission_code,valid_from,justification)
      VALUES('${id(9920)}','${id(102)}','finance.fee.read',1,'Fixture')`);
    await f.login(101); await f.login(102);
    const obligation = (await createObligation(f.db, f.context[101], crypto.randomUUID(), { roundId: id(901), participantId: id(502) })).id;
    const payment = (await submitFee(f.db, { put: async () => {}, delete: async () => {} }, { roundCode: '2026/2027',
      children: [{ name: 'Participante Tropa A (ficticio)', birthDate: '2013-05-18', sectionCode: 'TROPA' }],
      submittedByName: 'Família fictícia', contactPhone: null, receiptEmail: 'metrics@example.test', declaredAmountCents: 15000,
      privacyAcknowledged: true, privacyNoticeVersion: 'DEMO-3B-PRIVACY-NOTICE-V1', idempotencyKey: crypto.randomUUID().replaceAll('-', ''),
      evidence: { filename: 'j.pdf', mime: 'application/pdf', dataBase64: pdf.toString('base64') } }, crypto.randomUUID())).reference;
    await reviewFeePayment(f.db, f.context[101], crypto.randomUUID(), payment,
      { verifiedAmountCents: 15000, allocations: [{ obligationId: obligation, amountCents: 10000 }] });
    assert.equal((await feeMetrics(f.db, f.context[102], crypto.randomUUID(), id(901))).unallocatedVerifiedCents, 5000);
    f.sql.exec(`UPDATE participant SET current_section_id='${ESCOLTA}' WHERE id='${id(502)}'`);
    assert.equal((await feeMetrics(f.db, f.context[102], crypto.randomUUID(), id(901))).unallocatedVerifiedCents, 0,
      'declared Tropa no longer counts once the participant is in Escolta');
    assert.equal((await feeMetrics(f.db, f.context[101], crypto.randomUUID(), id(901))).unallocatedVerifiedCents, 5000);
  } finally { f.close(); }
});

test('L4: the version compare-and-set helper is explicit and rejects unsafe column names', () => {
  assert.equal(versionCas('version'), 'version=CASE WHEN version=? THEN version+1 ELSE NULL END');
  assert.throws(() => versionCas('version; DROP TABLE x'), /INVALID_COLUMN/);
});
