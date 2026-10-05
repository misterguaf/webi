// FASE 3.5H.2 — Noves altes: the existing public form feeds an AdmissionRequest in Gestió; workflow states,
// scope by section, delegated capability, matching (ambiguous blocks, clear needs confirmation, none creates),
// atomic acceptance with guardian/contacts and provenance, neutral public response, no health data.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, id, root } from './helpers/gestio-sqlite.js';
import { PortalIntake } from '../gestio/src/intake.js';
import { handleAlta } from '../api/_lib/handler.js';
import { newSession } from '../gestio/src/auth.js';

const MANADA = id(1), TROPA = id(2), ESCOLTA = id(3);
let ip = 0;
const form = over => ({ nom: 'Lluna', cognoms: 'Demo (fictícia)', naixement: '2016-05-04', seccio: 'Estol (8-11)', tutor: 'Mare Demo (fictícia)',
  telefon: '600 000 111', email: 'familia.lluna@example.test', conegut: 'Per amics', dades: 'on', contacte: 'on', ...over });

async function setup() {
  const f = fixture();
  for (const user of [101, 102, 103, 104, 105, 107]) await f.login(user);
  const env = { DB: f.db, EVIDENCE_STORAGE: f.storage, APP_ENV: 'development' };
  const intake = { fetch: request => PortalIntake.fetch(request, env) };
  // The existing public endpoint, with the Gestió service binding.
  const submit = async (over = {}, withIntake = true) => handleAlta({ method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
    rawBody: JSON.stringify(form(over)), env: withIntake ? { GESTIO_INTAKE: intake } : {}, ip: `10.0.0.${++ip}` });
  const call = (user, path, method = 'GET', body) => f.request(user, path, { method, body });
  const latest = () => f.sql.prepare('SELECT * FROM admission_request ORDER BY received_at DESC, rowid DESC LIMIT 1').get();
  const act = (user, requestId, op, body = {}) => {
    const row = f.sql.prepare('SELECT version FROM admission_request WHERE id=?').get(requestId);
    return call(user, `/api/admissions/${requestId}/${op}`, 'POST', { expectedVersion: row.version, ...body });
  };
  const loginAs = async (key, userId) => {
    f.token[key] = (await newSession(f.db, userId)).token;
    const session = f.sql.prepare('SELECT id FROM app_session WHERE user_id=? ORDER BY created_at DESC LIMIT 1').get(userId);
    f.context[key] = { userId, sessionId: session.id, status: 'ACTIVE' };
  };
  const count = (sql, ...args) => f.sql.prepare(sql).get(...args).n;
  return { f, submit, call, latest, act, loginAs, count };
}

test('the existing public form creates an AdmissionRequest in Gestió with a neutral answer; no second form, no health data', async () => {
  const s = await setup();
  try {
    const response = await s.submit();
    assert.equal(response.status, 200);
    const body = JSON.parse(response.body);
    assert.deepEqual(Object.keys(body).sort(), ['message', 'ok'], 'neutral: no id, no matching outcome');
    const row = s.latest();
    assert.deepEqual([row.status, row.given_name, row.requested_section_id, row.section_id, row.source], ['PENDING', 'Lluna', MANADA, null, 'PUBLIC_FORM']);
    assert.equal(s.count("SELECT count(*) AS n FROM admission_request_event WHERE action='RECEIVED'"), 1);
    const received = s.f.sql.prepare("SELECT * FROM audit_event WHERE action='ADMISSION_RECEIVED'").get();
    assert.ok(received && !JSON.stringify(received).includes('Lluna') && !JSON.stringify(received).includes('example.test'), 'minimal audit');
    // Health fields are refused by the existing form; the admission table has no health column at all.
    assert.equal((await s.submit({ alergia: 'pols' })).status, 400);
    const columns = s.f.sql.prepare('PRAGMA table_info(admission_request)').all().map(column => column.name).join(',');
    assert.doesNotMatch(columns, /health|salut|alerg|medic|dni|vacun/i);
    // Same answer whether or not the person already exists (no enumeration).
    s.f.sql.exec(`INSERT INTO participant(id,display_name,current_section_id,status,birth_date) VALUES('${id(9701)}','Pere Demo (fictici)','${TROPA}','ACTIVE','2014-01-01')`);
    const existing = await s.submit({ nom: 'Pere', cognoms: 'Demo (fictici)', naixement: '2014-01-01', seccio: 'Tropa (11-14)' });
    assert.equal(existing.body, response.body);
    // Direct intake rejects unknown fields and non-synthetic people.
    const direct = body => PortalIntake.fetch(new Request('https://gestio-intake.internal/v1/admissions', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), { DB: s.f.db, EVIDENCE_STORAGE: s.f.storage, APP_ENV: 'development' });
    assert.equal((await direct({ givenName: 'Real', familyNames: 'Persona', birthDate: '2015-01-01', guardianName: 'Real', contactPhone: '600000000',
      contactEmail: 'a@example.test', dataConsent: true, contactConsent: true })).status, 400);
    assert.equal((await direct({ givenName: 'A', familyNames: 'B (fictici)', birthDate: '2015-01-01', guardianName: 'C (fictici)', contactPhone: '600000000',
      contactEmail: 'a@example.test', dataConsent: true, contactConsent: true, allergy: 'x' })).status, 400);
    // There is exactly one public membership form, and it is the existing one.
    const forms = readdirSync(join(root, 'site')).filter(name => name.endsWith('.html')).filter(name => readFileSync(join(root, 'site', name), 'utf8').includes('/api/alta'));
    assert.deepEqual(forms, ['fersescout.html']);
    // Without the binding (current deployment) the legacy path stays; it never touches Gestió.
    const before = s.count('SELECT count(*) AS n FROM admission_request');
    await s.submit({}, false);
    assert.equal(s.count('SELECT count(*) AS n FROM admission_request'), before);
  } finally { s.f.close(); }
});

test('workflow: PENDING → IN_REVIEW ⇄ WAITLISTED → REJECTED; WITHDRAWN distinct; impossible transitions refused; history kept', async () => {
  const s = await setup();
  try {
    await s.submit(); const a = s.latest().id;
    assert.equal((await s.act(105, a, 'start-review')).data.status, 'IN_REVIEW');
    assert.equal((await s.act(105, a, 'start-review')).data.error, 'invalid_transition');
    assert.equal((await s.act(105, a, 'waitlist')).data.status, 'WAITLISTED');
    assert.equal((await s.call(105, '/api/admissions?status=WAITLISTED')).data.admissions.length, 1, 'waitlist is a real state');
    assert.equal((await s.act(105, a, 'return-to-review')).data.status, 'IN_REVIEW');
    assert.equal((await s.act(105, a, 'reject', { category: 'FREE TEXT' })).status, 400, 'a category, never free text');
    assert.equal((await s.act(105, a, 'reject', { category: 'NO_PLACES' })).data.status, 'REJECTED');
    assert.equal((await s.act(105, a, 'return-to-review')).data.error, 'invalid_transition', 'REJECTED is final');
    assert.equal((await s.call(105, '/api/admissions/' + a, 'POST', { expectedVersion: 1 })).status, 404);
    const history = (await s.call(105, `/api/admissions/${a}`)).data.events.map(event => event.action);
    assert.deepEqual(history, ['RECEIVED', 'REVIEW_STARTED', 'WAITLISTED', 'RETURNED_TO_REVIEW', 'REJECTED']);
    await s.submit({ nom: 'Arnau', email: 'arnau@example.test' }); const b = s.latest().id;
    assert.equal((await s.act(105, b, 'withdraw')).data.status, 'WITHDRAWN');
    assert.equal(s.f.sql.prepare('SELECT rejection_category FROM admission_request WHERE id=?').get(b).rejection_category, null, 'withdrawn ≠ rejected');
    assert.equal(s.count('SELECT count(*) AS n FROM participant WHERE provenance_note=?', 'Noves altes'), 0, 'no participant from waitlist, rejection or withdrawal');
    assert.throws(() => s.f.sql.exec(`DELETE FROM admission_request WHERE id='${a}'`), /admission_immutable/);
    // Stale version: nothing written.
    await s.submit({ nom: 'Mar', email: 'mar@example.test' }); const c = s.latest().id;
    assert.equal((await s.call(105, `/api/admissions/${c}/start-review`, 'POST', { expectedVersion: 7 })).data.error, 'stale_admission');
    assert.equal(s.count("SELECT count(*) AS n FROM admission_request_event WHERE request_id=? AND action='REVIEW_STARTED'", c), 0);
  } finally { s.f.close(); }
});

test('scope: Secretaria and Coordinació general everywhere; section coordinators only their section, including deciding; cross-section 404', async () => {
  const s = await setup();
  try {
    await s.submit({ nom: 'Tropa1', seccio: 'Tropa (11-14)', naixement: '2013-02-02', email: 't1@example.test' }); const tropa = s.latest().id;
    await s.submit({ nom: 'Escolta1', seccio: 'Escoltes (14-17)', naixement: '2010-02-02', email: 'e1@example.test' }); const escolta = s.latest().id;
    await s.submit({ nom: 'SenseSeccio', seccio: '', naixement: '2012-02-02', email: 's1@example.test' }); const none = s.latest().id;
    for (const user of [101, 105]) assert.equal((await s.call(user, '/api/admissions')).data.admissions.length, 3, `group-wide ${user}`);
    assert.deepEqual((await s.call(102, '/api/admissions')).data.admissions.map(row => row.id), [tropa], 'Tropa coordinator: only Tropa');
    assert.equal((await s.call(102, `/api/admissions/${escolta}`)).status, 404);
    assert.equal((await s.call(102, `/api/admissions/${none}`)).status, 404, 'a request without section is group-wide only');
    assert.equal((await s.act(102, escolta, 'start-review')).status, 404);
    for (const user of [104, 107]) assert.equal((await s.call(user, '/api/admissions')).status, 403, `no admissions for ${user}`);
    // The Tropa coordinator runs and decides its section; it cannot move a request to another section.
    assert.equal((await s.act(102, tropa, 'start-review')).status, 200);
    assert.equal((await s.act(102, tropa, 'section', { section: 'ESCOLTA' })).data.error, 'section_out_of_scope');
    assert.equal((await s.act(102, tropa, 'section', { section: 'TROPA' })).status, 200);
    const accepted = await s.act(102, tropa, 'accept');
    assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
    assert.equal(accepted.data.created, true);
    assert.equal((await s.act(103, escolta, 'reject', { category: 'NO_PLACES' })).data.status, 'REJECTED', 'Escolta coordinator decides Escolta');
  } finally { s.f.close(); }
});

test('delegated admissions.decide works only within its section', async () => {
  const s = await setup();
  try {
    const delegate = (await s.call(101, '/api/admin/users', 'POST', { displayName: 'Suport Altes (fictici)', roles: [
      { roleCode: 'SECTION_DELEGATE', sectionId: TROPA, expiresAt: Date.now() + 30 * 86400000, permissions: ['participants.profile.read'] }] })).data.id;
    for (const permissionCode of ['admissions.read', 'admissions.decide'])
      assert.equal((await s.call(101, '/api/delegations', 'POST', { userId: delegate, permissionCode, sectionId: TROPA, authorizedBy: id(101),
        authorizationReference: `DEMO-H2-${permissionCode.replace('.', '-').toUpperCase()}` })).status, 201);
    await s.loginAs('d', delegate);
    await s.submit({ nom: 'Tropa2', seccio: 'Tropa (11-14)', naixement: '2013-03-03', email: 't2@example.test' }); const tropa = s.latest().id;
    await s.submit({ nom: 'Manada2', seccio: 'Estol (8-11)', naixement: '2017-03-03', email: 'm2@example.test' }); const manada = s.latest().id;
    assert.equal((await s.act(105, tropa, 'start-review')).status, 200);
    const reject = await s.f.request('d', `/api/admissions/${tropa}/reject`, { method: 'POST', body: { expectedVersion: 2, category: 'OTHER' } });
    assert.equal(reject.data.status, 'REJECTED', 'delegated decide in Tropa');
    assert.equal((await s.f.request('d', `/api/admissions/${manada}/reject`, { method: 'POST', body: { expectedVersion: 1, category: 'OTHER' } })).status, 404,
      'never in Manada');
    assert.equal((await s.f.request('d', `/api/admissions/${manada}/start-review`, { method: 'POST', body: { expectedVersion: 1 } })).status, 403,
      'no manage capability was delegated');
  } finally { s.f.close(); }
});

test('acceptance: no match creates the participant graph atomically; ambiguous blocks; a clear match needs confirmation and never duplicates', async () => {
  const s = await setup();
  try {
    // NO MATCH (minor): participant + Manada episode + guardian + contacts, linked, contact cleared from the request.
    await s.submit(); const a = s.latest().id;
    await s.act(105, a, 'start-review');
    assert.equal((await s.act(105, a, 'accept')).data.error, 'section_not_confirmed', 'the public section is not trusted');
    await s.act(105, a, 'section', { section: 'MANADA' });
    const accepted = await s.act(105, a, 'accept');
    assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
    const participant = s.f.sql.prepare('SELECT * FROM participant WHERE id=?').get(accepted.data.participantId);
    assert.deepEqual([participant.display_name, participant.current_section_id, participant.status, participant.birth_date, participant.provenance_note],
      ['Lluna Demo (fictícia)', MANADA, 'ACTIVE', '2016-05-04', 'Noves altes']);
    assert.equal(s.count("SELECT count(*) AS n FROM participant_section_membership WHERE participant_id=? AND ended_at IS NULL AND start_reason='ENROLMENT'", participant.id), 1);
    const guardian = s.f.sql.prepare('SELECT g.id,g.display_name FROM participant_guardian pg JOIN guardian g ON g.id=pg.guardian_id WHERE pg.participant_id=? AND pg.ended_at IS NULL').get(participant.id);
    assert.equal(guardian.display_name, 'Mare Demo (fictícia)');
    assert.deepEqual(s.f.sql.prepare('SELECT kind FROM contact_point WHERE guardian_id=? ORDER BY kind').all(guardian.id).map(row => row.kind), ['EMAIL', 'PHONE']);
    const row = s.f.sql.prepare('SELECT * FROM admission_request WHERE id=?').get(a);
    assert.deepEqual([row.status, row.participant_id, row.contact_phone, row.contact_email, row.guardian_name], ['ACCEPTED', participant.id, null, null, null],
      'linked to the participant; contact lives in Participants only');
    // Basic completeness of the new minor (name, birth date, section, guardian, contact) is met.
    const detail = (await s.call(105, `/api/participants/${participant.id}`)).data.participant;
    assert.deepEqual(detail.completeness, { complete: true, missing: [] }, 'name, birth date, section, guardian and contact');
    // ADULT: own contact, no guardian.
    await s.submit({ nom: 'Clara', cognoms: 'Adulta (fictícia)', naixement: '2004-01-01', seccio: 'Clan (17-21)', email: 'clara@example.test' }); const adult = s.latest().id;
    await s.act(105, adult, 'start-review'); await s.act(105, adult, 'section', { section: 'CLAN' });
    const adultParticipant = (await s.act(105, adult, 'accept')).data.participantId;
    assert.equal(s.count('SELECT count(*) AS n FROM contact_point WHERE participant_id=?', adultParticipant), 2);
    assert.equal(s.count('SELECT count(*) AS n FROM participant_guardian WHERE participant_id=?', adultParticipant), 0);
    // CLEAR MATCH (a former member, inactive): explicit confirmation links and reactivates; no duplicate.
    s.f.sql.exec(`INSERT INTO participant(id,display_name,current_section_id,status,birth_date) VALUES('${id(9801)}','Biel Antic (fictici)','${TROPA}','INACTIVE','2012-06-06')`);
    await s.submit({ nom: 'Biel', cognoms: 'Antic (fictici)', naixement: '2012-06-06', seccio: 'Tropa (11-14)', email: 'biel@example.test' }); const clear = s.latest().id;
    await s.act(105, clear, 'start-review'); await s.act(105, clear, 'section', { section: 'TROPA' });
    const match = (await s.call(105, `/api/admissions/${clear}`)).data.match;
    assert.deepEqual([match.status, match.participant.id], ['CLEAR', id(9801)]);
    assert.equal((await s.act(105, clear, 'accept')).data.error, 'admission_link_confirmation_required');
    const before = s.count('SELECT count(*) AS n FROM participant');
    const linked = await s.act(105, clear, 'accept', { linkParticipantId: id(9801) });
    assert.deepEqual([linked.status, linked.data.participantId, linked.data.created], [200, id(9801), false]);
    assert.equal(s.count('SELECT count(*) AS n FROM participant'), before, 'no duplicate participant');
    assert.equal(s.f.sql.prepare('SELECT status FROM participant WHERE id=?').get(id(9801)).status, 'ACTIVE', 'former member reactivated');
    // AMBIGUOUS: two people with that name → blocked; only a group-wide reviewer resolves; the coordinator gets no list.
    s.f.sql.exec(`INSERT INTO participant(id,display_name,current_section_id,status,birth_date) VALUES
      ('${id(9802)}','Nil Repetit (fictici)','${TROPA}','ACTIVE','2013-07-07'),('${id(9803)}','Nil Repetit (fictici)','${ESCOLTA}','ACTIVE','2011-07-07')`);
    await s.submit({ nom: 'Nil', cognoms: 'Repetit (fictici)', naixement: '2013-09-09', seccio: 'Tropa (11-14)', email: 'nil@example.test' }); const amb = s.latest().id;
    await s.act(102, amb, 'start-review'); await s.act(102, amb, 'section', { section: 'TROPA' });
    const participantsBefore = s.count('SELECT count(*) AS n FROM participant');
    assert.equal((await s.act(102, amb, 'accept')).data.error, 'admission_match_ambiguous');
    assert.equal(s.count('SELECT count(*) AS n FROM participant'), participantsBefore, 'nothing created');
    assert.equal(s.f.sql.prepare('SELECT match_status FROM admission_request WHERE id=?').get(amb).match_status, 'AMBIGUOUS', 'flagged for manual review');
    const coordView = (await s.call(102, `/api/admissions/${amb}`)).data.match;
    assert.equal(coordView.candidates, null, 'no candidate list for a section coordinator');
    assert.equal((await s.act(102, amb, 'resolve-match', { decision: 'DIFFERENT_PERSON' })).status, 403);
    const reviewer = (await s.call(105, `/api/admissions/${amb}`)).data.match;
    assert.equal(reviewer.candidates.length, 2, 'Secretaria sees the candidates internally');
    assert.equal((await s.act(105, amb, 'resolve-match', { decision: 'DIFFERENT_PERSON' })).data.matchStatus, 'RESOLVED_NEW');
    const resolved = await s.act(102, amb, 'accept');
    assert.equal(resolved.data.created, true, 'explicit resolution, then explicit creation');
  } finally { s.f.close(); }
});
