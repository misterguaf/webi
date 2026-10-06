// FASE 3.5I-Q — family annual-fee proof through the existing write-only portal (portal → PortalIntake → D1).
// A proof is not a verified payment: it creates a payment attempt with private evidence, matched server-side;
// the Quotes status only changes after Treasury verifies and allocates. Public answers stay neutral.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import portal from '../portal/worker.js';
import { PortalIntake } from '../gestio/worker.js';
import { _reset } from '../api/_lib/ratelimit.js';
import { fixture, id } from './helpers/gestio-sqlite.js';

const ORIGIN = 'https://inscripcions.example.test';
const pdf = Buffer.from('%PDF-1.4\n%synthetic portal quota fixture\n%%EOF');
beforeEach(() => _reset());

async function setup() {
  const f = fixture();
  const objects = new Map();
  const storage = { objects, put: async (key, value) => { objects.set(key, value); }, delete: async key => { objects.delete(key); },
    get: async key => objects.has(key) ? { body: objects.get(key) } : null };
  const gestioEnv = { APP_ENV: 'test', DB: f.db, EVIDENCE_STORAGE: storage };
  const env = { PORTAL_ACCESS_PASSWORD: 'families-prova', PORTAL_SESSION_SECRET: 'secret-de-sessio-prou-llarg-per-a-proves',
    PORTAL_SESSION_VERSION: 'test', PORTAL_ALLOWED_ORIGIN: ORIGIN, ASSETS: { fetch: async () => new Response('asset') },
    GESTIO_INTAKE: { fetch: request => PortalIntake.fetch(request, gestioEnv) } };
  const login = await portal.fetch(new Request(ORIGIN + '/api/portal/session', { method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.20' }, body: JSON.stringify({ password: 'families-prova' }) }), env);
  const auth = { cookie: login.headers.get('set-cookie').split(';')[0], csrf: (await login.json()).csrf };
  let ip = 40;
  const send = body => portal.fetch(new Request(ORIGIN + '/api/cuota', { method: 'POST', headers: { Origin: ORIGIN, Cookie: auth.cookie, 'X-CSRF-Token': auth.csrf,
    'Content-Type': 'application/json', 'CF-Connecting-IP': `198.51.100.${ip++}` }, body: JSON.stringify(body) }), env);
  const fee = (child, extra = {}) => ({ roundCode: '2026/2027', fills: [child], tutor: 'Mare fictícia', telefon: '', email: 'quota@example.test',
    declaredAmountCents: 10000, privacitat: true, idempotencyKey: crypto.randomUUID().replaceAll('-', ''), malnom: '', _ts: '',
    comprovant: { nom: 'justificant.pdf', tipus: 'application/pdf', base64: pdf.toString('base64') }, ...extra });
  for (const user of [102, 104]) await f.login(user);
  return { f, storage, send, fee };
}
const clearChild = { nom: 'Participante', cognoms: 'Tropa A (ficticio)', naixement: '2013-05-18', seccio: 'TRO' };

test('a family uploads annual-fee proof: neutral answer, private evidence, server-side matching, and the quota is NOT marked paid', async () => {
  const s = await setup();
  try {
    // Treasury has the obligation for this person; before the proof it is pending.
    assert.equal((await s.f.request(104, '/api/fees/obligations', { method: 'POST', body: { roundId: id(901), participantId: id(502) } })).status, 201);
    const response = await s.send(s.fee(clearChild));
    assert.equal(response.status, 202);
    const body = await response.json();
    assert.deepEqual(Object.keys(body).sort(), ['message', 'ok', 'referencia']);
    assert.doesNotMatch(JSON.stringify(body), /candidate|participant|match|CLEAR|synthetic\/|object|url|http/i, 'no identity, matching or storage detail');
    assert.equal(s.storage.objects.size, 1, 'evidence stored privately (no public URL exists)');
    const person = s.f.sql.prepare('SELECT participant_id,match_status FROM annual_fee_submission_person ORDER BY rowid DESC LIMIT 1').get();
    assert.deepEqual({ ...person }, { participant_id: id(502), match_status: 'CLEAR' }, 'matched server-side');
    // Proof ≠ verified payment: Quotes stays PENDING; Treasury sees the proof waiting; the coordinator only the status.
    const treasury = (await s.f.request(104, `/api/quotes/participants/${id(502)}`)).data.quota;
    assert.equal(treasury.status, 'PENDING');
    assert.equal(treasury.proofs.length, 1);
    assert.equal(treasury.proofs[0].reviewStatus, 'PENDING_REVIEW');
    const coordinator = (await s.f.request(102, `/api/quotes/participants/${id(502)}`)).data;
    assert.deepEqual([coordinator.mode, coordinator.quota.status], ['basic', 'PENDING']);
    assert.equal(coordinator.quota.proofs, undefined);
  } finally { s.f.close(); }
});

test('clear, ambiguous and unknown children get the same public answer; candidates are never returned', async () => {
  const s = await setup();
  try {
    s.f.sql.exec(`INSERT INTO participant(id,display_name,current_section_id,status,birth_date) VALUES
      ('${id(9301)}','Nil Doble (fictici)','${id(2)}','ACTIVE','2013-01-01'),('${id(9302)}','Nil Doble (fictici)','${id(2)}','ACTIVE','2013-01-01')`);
    const answers = [];
    for (const child of [clearChild, { nom: 'Nil', cognoms: 'Doble (fictici)', naixement: '2013-01-01', seccio: 'TRO' },
      { nom: 'Ningú', cognoms: 'Desconegut (fictici)', naixement: '2012-02-02', seccio: 'TRO' }]) {
      const response = await s.send(s.fee(child));
      const body = await response.json();
      answers.push([response.status, Object.keys(body).sort().join(','), body.message]);
    }
    assert.equal(new Set(answers.map(answer => JSON.stringify(answer))).size, 1, JSON.stringify(answers));
    assert.deepEqual(s.f.sql.prepare('SELECT match_status FROM annual_fee_submission_person ORDER BY rowid').all().map(row => row.match_status), ['CLEAR', 'AMBIGUOUS', 'NONE']);
  } finally { s.f.close(); }
});

test('sensitive or forged fields are rejected: DNI, health, internal ids; invalid or oversized evidence; replays are idempotent', async () => {
  const s = await setup();
  try {
    for (const extra of [{ dni: '00000000T' }, { alergies: 'pols' }, { salut: 'x' }, { participantId: id(502) }, { obligationId: id(3001) }])
      assert.equal((await s.send(s.fee(clearChild, extra))).status, 400, JSON.stringify(Object.keys(extra)));
    for (const child of [{ ...clearChild, dni: '00000000T' }, { ...clearChild, participantId: id(502) }, { ...clearChild, medicacio: 'x' }])
      assert.equal((await s.send(s.fee(child))).status, 400, JSON.stringify(Object.keys(child)));
    assert.equal((await s.send(s.fee(clearChild, { comprovant: { nom: 'x.txt', tipus: 'text/plain', base64: Buffer.from('hola').toString('base64') } }))).status, 400);
    const huge = Buffer.alloc(6 * 1024 * 1024, 65).toString('base64');
    assert.ok([400, 413].includes((await s.send(s.fee(clearChild, { comprovant: { nom: 'gran.pdf', tipus: 'application/pdf', base64: huge } }))).status));
    assert.equal(s.f.sql.prepare('SELECT count(*) n FROM annual_fee_payment').get().n, 0, 'nothing stored from rejected submissions');
    // Replay: same idempotency key and payload → same reference, one payment.
    const once = s.fee(clearChild);
    const first = await (await s.send(once)).json(), second = await (await s.send(once)).json();
    assert.equal(first.referencia, second.referencia);
    assert.equal(s.f.sql.prepare('SELECT count(*) n FROM annual_fee_payment').get().n, 1);
    assert.equal(s.storage.objects.size, 1);
    const audit = JSON.stringify(s.f.sql.prepare("SELECT * FROM audit_event WHERE action IN ('FEE_SUBMISSION_RECEIVED','FEE_EVIDENCE_RECEIVED')").all());
    assert.doesNotMatch(audit, /quota@example\.test|Participante|JVBER|%PDF/, 'no contact values or evidence content in the audit');
  } finally { s.f.close(); }
});
