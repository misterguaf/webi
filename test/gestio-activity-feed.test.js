// FASE 3.5H.3 — Activitat: a safe, human projection of audit_event. Actor always named; subject named only
// when the viewer could identify it anyway; no content (contact, amounts, bank descriptions); links only for
// resources the viewer can already open; routine technical noise omitted.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, id } from './helpers/gestio-sqlite.js';
import { append } from '../gestio/src/domains/audit/repository.js';

const TROPA_P = id(502), ESCULTA_P = id(504);
async function setup() {
  const f = fixture();
  for (const user of [101, 102, 103, 104, 105, 106, 107]) await f.login(user);
  const feed = async (user, query = '') => (await f.request(user, `/api/activity${query ? `?${query}` : ''}`)).data;
  const record = (actor, action, resourceType, resourceId, extra = {}) => append(f.db, { requestId: crypto.randomUUID(), actorUserId: id(actor),
    action, resourceType, resourceId, ...extra });
  return { f, feed, record };
}

test('routine technical noise is omitted: logins, sessions, AUTHZ decisions, list loads and own-session housekeeping', async () => {
  const s = await setup();
  try {
    await s.f.request(105, '/api/participants');
    await s.f.request(104, '/api/admissions');                       // AUTHZ_DENY
    await s.f.request(105, '/api/me');
    await s.f.login(105);                                              // another session for the same person
    const own = s.f.sql.prepare('SELECT id FROM app_session WHERE user_id=? ORDER BY created_at LIMIT 1').get(id(105)).id;
    await s.f.request(105, `/api/me/sessions/${own}`, { method: 'DELETE' });
    assert.ok(s.f.sql.prepare("SELECT count(*) AS n FROM audit_event WHERE action IN ('AUTHZ_DENY','AUTH_SESSION_REVOKED')").get().n >= 2, 'the raw audit has them');
    const { items } = await s.feed(101);
    assert.deepEqual(items, [], 'none of it is activity');
  } finally { s.f.close(); }
});

test('actor always visible; participant identity follows the viewer’s own permissions; links only when openable', async () => {
  const s = await setup();
  try {
    await s.record(105, 'DATA_UPDATED', 'participant', ESCULTA_P);
    const forEsculta = (await s.feed(103)).items[0];
    assert.equal(forEsculta.text, 'Secretaría (ficticia) ha modificat la fitxa de Participante Esculta A (ficticio).');
    assert.deepEqual(forEsculta.link, { page: 'participants', path: [ESCULTA_P] }, 'the Esculta coordinator can open it');
    assert.deepEqual(forEsculta.actor, { id: id(105), name: 'Secretaría (ficticia)' });
    for (const viewer of [102, 104, 107]) {
      const item = (await s.feed(viewer)).items[0];
      assert.equal(item.text, 'Secretaría (ficticia) ha modificat la fitxa d’un educand.', `redacted for ${viewer}`);
      assert.equal(item.link, null, `no link for ${viewer}`);
      assert.ok(!JSON.stringify(item).includes(ESCULTA_P), 'not even the id');
    }
    // Text search runs over the projected (redacted) text only: a hidden name never matches.
    assert.equal((await s.feed(102, 'q=Esculta')).items.length, 0);
    assert.equal((await s.feed(103, 'q=Esculta')).items.length, 1);
    assert.equal((await s.feed(102, 'q=secretaria')).items.length, 1, 'search by actor name');
    // Filters: category, kind, actor, date.
    assert.equal((await s.feed(103, 'category=treasury')).items.length, 0);
    assert.equal((await s.feed(103, 'category=participants&kind=change')).items.length, 1);
    assert.equal((await s.feed(103, `actor=${id(101)}`)).items.length, 0);
    assert.equal((await s.feed(103, 'from=2999-01-01')).items.length, 0);
    assert.equal((await s.f.request(103, '/api/activity?category=raw')).status, 400);
    assert.equal((await s.f.request(103, '/api/activity?action=AUTHZ_DENY')).status, 400, 'no raw audit filters from the client');
  } finally { s.f.close(); }
});

test('sensitive content is never projected: contact values, metadata amounts, bank descriptions, health', async () => {
  const s = await setup();
  try {
    // A real, audited contact consultation by the Tropa coordinator.
    const contact = crypto.randomUUID();
    s.f.sql.prepare("INSERT INTO contact_point(id,participant_id,kind,value,purpose,is_primary,created_at) VALUES(?,?,'PHONE','600 987 654','GENERAL',1,1)").run(contact, TROPA_P);
    const consulted = await s.f.request(102, `/api/contacts/${contact}`);
    assert.equal(consulted.status, 200, JSON.stringify(consulted.data));
    await s.record(104, 'BANK_DESCRIPTION_REVEALED', 'finance_movement', id(9901));
    await s.record(104, 'FEE_PAYMENT_VERIFIED', 'annual_fee_payment', id(9902), { metadata: { amountCents: 4321 } });
    await s.record(101, 'HEALTH_ACCESS_GRANTED', 'health_access_grant', id(9903));
    const forTropa = await s.feed(102);
    assert.ok(forTropa.items.some(item => item.text === 'Coordinación Tropa (ficticia) ha consultat les dades de contacte de Participante Tropa A (ficticio).'),
      JSON.stringify(forTropa.items.map(item => item.text)));
    const texts = Object.fromEntries((await s.feed(104)).items.map(item => [item.category, item]));
    const body = JSON.stringify(await s.feed(104));
    for (const secret of ['600 987 654', '987', '4321', '43,21', id(9901), id(9902), id(9903)])
      assert.ok(!body.includes(secret), `never projected: ${secret}`);
    for (const item of (await s.feed(104)).items) assert.deepEqual(Object.keys(item).sort(), ['actor', 'at', 'category', 'id', 'kind', 'link', 'text'], 'no raw audit fields');
    assert.ok(body.includes('ha consultat la descripció bancària original d’un moviment'));
    assert.ok(body.includes('Coordinación general (ficticia) ha concedit un accés a dades de salut.'));
    assert.equal(texts.health.category, 'health');
    // Treasury items link to the module only when the viewer reads Tresoreria; never to a movement.
    const bank = (await s.feed(104, 'category=treasury')).items.find(item => item.text.includes('descripció bancària'));
    assert.deepEqual(bank.link, { page: 'tresoreria', path: [] });
    assert.equal((await s.feed(102, 'category=treasury')).items.find(item => item.text.includes('descripció bancària')).link, null);
  } finally { s.f.close(); }
});

test('admissions and administration: request names follow admissions scope; actor and target user named; incident descriptions never shown', async () => {
  const s = await setup();
  try {
    s.f.sql.prepare(`INSERT INTO admission_request(id,received_at,source,given_name,family_names,birth_date,requested_section_id,guardian_name,contact_phone,
      contact_email,data_consent,contact_consent,updated_at) VALUES(?,1,'PUBLIC_FORM','Aina','Demo (fictícia)','2010-01-01',?,'Pare Demo (fictici)','600000001','aina@example.test',1,1,1)`)
      .run(id(9911), id(3));
    await s.record(105, 'ADMISSION_REVIEW_STARTED', 'admission_request', id(9911));
    const esculta = (await s.feed(103)).items[0];
    assert.equal(esculta.text, 'Secretaría (ficticia) ha començat la revisió de la sol·licitud d’alta d’Aina Demo (fictícia).');
    assert.deepEqual(esculta.link, { page: 'participants', path: ['altes', id(9911)] });
    const tropa = (await s.feed(102)).items[0];
    assert.equal(tropa.text, 'Secretaría (ficticia) ha començat la revisió de la sol·licitud d’alta d’una persona.');
    assert.equal(tropa.link, null);
    assert.ok(!JSON.stringify(await s.feed(103)).includes('aina@example.test'));
    // Administration: a permission granted to someone.
    const granted = await s.f.request(105, `/api/users/${id(107)}/permissions`, { method: 'POST', body: { permissionCode: 'admin.incidents.manage' } });
    assert.equal(granted.status, 201, JSON.stringify(granted.data));
    const admin = (await s.feed(102, 'category=administration')).items[0];
    assert.equal(admin.text, 'Secretaría (ficticia) ha concedit un permís a Técnica (ficticia).');
    assert.equal(admin.link, null, 'no user administration link without auth.user.manage');
    assert.deepEqual((await s.feed(105, 'category=administration')).items[0].link, { page: 'administracio', path: ['usuaris', id(107)] });
    // Incidents: the report is activity; its description is not.
    await s.f.request(104, '/api/work-incidents', { method: 'POST', body: { type: 'DATA', title: 'Dada estranya', description: 'Text intern SECRET-XYZ', module: 'quotes' } });
    const reported = (await s.feed(102, 'category=administration')).items[0];
    assert.equal(reported.text, 'Tesorería (ficticia) ha reportat una incidència.');
    assert.equal(reported.link, null, 'another person’s report is not openable');
    assert.ok((await s.feed(104, 'category=administration')).items[0].link.path[0], 'the reporter can open their own');
    assert.ok(!JSON.stringify(await s.feed(105)).includes('SECRET-XYZ') && !JSON.stringify(await s.feed(105)).includes('Dada estranya'));
  } finally { s.f.close(); }
});

test('pagination: a stable cursor walks the whole projection without repeats', async () => {
  const s = await setup();
  try {
    for (let i = 0; i < 30; i++) await s.record(105, 'DATA_UPDATED', 'participant', TROPA_P, { occurredAt: 1_800_000_000_000 + i });
    const first = await s.feed(102);
    assert.equal(first.items.length, 25);
    assert.ok(first.nextCursor);
    const second = await s.feed(102, `cursor=${first.nextCursor}`);
    assert.equal(second.items.length, 5);
    assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 30);
    assert.equal(second.nextCursor, null);
  } finally { s.f.close(); }
});

test('D1 limit: the projection query binds at most 100 parameters and only catalogued actions', async () => {
  const { queryForActivity } = await import('../gestio/src/domains/audit/repository.js');
  const { ACTIONS } = await import('../gestio/src/domains/audit/repository.js');
  let bound = null, sql = '';
  const db = { prepare(query) { sql = query; return { bind(...values) { bound = values; return { all: async () => ({ results: [] }) }; } }; } };
  await queryForActivity(db, { actions: [...ACTIONS], actorId: '00000000-0000-4000-8000-000000000105', from: 1, to: 2, limit: 50 });
  assert.ok(bound.length <= 100, `bound ${bound.length}`);
  assert.match(sql, /action IN \('AUTH_LOGIN_SUCCESS'/);
  await assert.rejects(queryForActivity(db, { actions: ["X') OR 1=1 --"] }), /INVALID_AUDIT_FILTER/);
});
