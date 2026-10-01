// Phase 3.5D backend support for Activitats: optimistic concurrency, discard draft, scoped
// registration counts in the list read model, GENERAL read vs manage, termsLocked and the
// family-transport rule. Runs on the node:sqlite D1 stand-in with the synthetic seed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, id } from './helpers/gestio-sqlite.js';

const MANADA = id(1), TROPA = id(2), ESCOLTA = id(3);
const TROPA_PUBLISHED = id(801), ESCOLTA_PAID = id(802), GENERAL = id(803), TROPA_DRAFT = id(804), TROPA_CLOSED = id(805);
const DAY = 86400000;
const USERS = [101, 102, 103, 104, 105, 106, 107];

async function setup() {
  const f = fixture();
  for (const user of USERS) await f.login(user);
  return f;
}
const terms = (overrides = {}) => {
  const start = Date.now() + 30 * DAY;
  return { name: 'Eixida fictícia de prova', audience: 'SECTIONS', sectionIds: [TROPA], location: 'Lloc fictici',
    startsAt: start, endsAt: start + DAY, registrationDeadline: start - 2 * DAY, priceCents: 0,
    shortDescription: '', materials: '', specialNotice: '', transportOptions: [], ...overrides };
};
const auditCount = (f, action, resourceId) =>
  f.sql.prepare('SELECT count(*) AS n FROM audit_event WHERE action=? AND resource_id=?').get(action, resourceId).n;
const version = (f, activityId) => f.sql.prepare('SELECT version FROM activity WHERE id=?').get(activityId)?.version;
function register(f, n, activityId, sectionId, status = 'NEEDS_PARTICIPANT_REVIEW', participant = null) {
  f.sql.prepare(`INSERT INTO activity_registration(id,activity_id,participant_id,submitted_name,match_key,submitted_section_id,
    receipt_email,transport_code,expected_amount_cents,match_status,status,consent_version,participation_terms_version,
    participation_authorized_at,privacy_notice_version,privacy_notice_acknowledged_at,idempotency_key,payload_sha256,created_at,updated_at)
    VALUES(?,?,?,'Sol·licitud fictícia','sollicitud ficticia',?,?,NULL,0,?,?,'DEPRECATED','DEMO-3A-PARTICIPATION-V1',1,
    'DEMO-3A-PRIVACY-NOTICE-V1',1,?,?,1,1)`)
    .run(id(n), activityId, participant, sectionId, `prova${n}@example.test`,
      participant ? 'CLEAR' : status === 'REJECTED' ? 'REJECTED' : 'NONE', status,
      `test-registration-${String(n).padStart(8, '0')}`, '0'.repeat(64));
}
// A synthetic read-only user: SECTION_DELEGATE Tropa with the activities.read grant and no review delegation.
function readOnlyTropa(f) {
  f.sql.exec(`INSERT INTO user_role(id,user_id,role_code,section_id,valid_from,expires_at,granted_by,justification)
    VALUES('${id(9601)}','${id(106)}','SECTION_DELEGATE','${TROPA}',1700000000000,4102444800000,'${id(101)}','Fixture sintètic de només lectura');
    INSERT INTO user_permission_grant(id,user_id,permission_code,valid_from,granted_by,justification)
    VALUES('${id(9602)}','${id(106)}','activities.read',1700000000000,'${id(101)}','Fixture sintètic de només lectura')`);
}

test('migration 0014: every activity has a NOT NULL version starting at 1 and a stale compare-and-set aborts', () => {
  const f = fixture();
  try {
    const column = f.sql.prepare("SELECT * FROM pragma_table_info('activity') WHERE name='version'").get();
    assert.equal(column.notnull, 1);
    assert.equal(column.dflt_value, '1');
    assert.deepEqual([...new Set(f.sql.prepare('SELECT version FROM activity').all().map(row => row.version))], [1]);
    assert.throws(() => f.sql.prepare('UPDATE activity SET version=CASE WHEN version=? THEN version+1 ELSE NULL END WHERE id=?')
      .run(7, TROPA_DRAFT), /NOT NULL/);
    assert.throws(() => f.sql.prepare('UPDATE activity SET version=0 WHERE id=?').run(TROPA_DRAFT), /CHECK/);
  } finally { f.close(); }
});

test('concurrency: the second editor of the same version gets 409 stale_activity and the first change survives', async () => {
  const f = await setup();
  try {
    const seen = (await f.request(101, `/api/activities/${TROPA_DRAFT}`)).data.activity;
    assert.equal(seen.version, 1);
    const first = await f.request(101, `/api/activities/${TROPA_DRAFT}`, { method: 'PATCH',
      body: { ...terms({ name: 'Primer editor' }), expectedVersion: seen.version } });
    assert.equal(first.status, 200);
    assert.equal(first.data.version, 2);
    const second = await f.request(102, `/api/activities/${TROPA_DRAFT}`, { method: 'PATCH',
      body: { ...terms({ name: 'Segon editor' }), expectedVersion: seen.version } });
    assert.equal(second.status, 409);
    assert.equal(second.data.error, 'stale_activity');
    const stored = f.sql.prepare('SELECT name,version FROM activity WHERE id=?').get(TROPA_DRAFT);
    assert.deepEqual({ ...stored }, { name: 'Primer editor', version: 2 });
    assert.equal(f.sql.prepare("SELECT count(*) AS n FROM audit_event WHERE action='ACTIVITY_UPDATED' AND actor_user_id=?").get(id(102)).n, 0,
      'no audit event for a write that did not happen');
    assert.equal(auditCount(f, 'ACTIVITY_UPDATED', TROPA_DRAFT), 1);
  } finally { f.close(); }
});

test('concurrency: racing writes that both pass the pre-check are caught by the compare-and-set inside the batch', async () => {
  const f = await setup();
  try {
    const results = await Promise.all(['Carrera A', 'Carrera B'].map(name => f.request(102, `/api/activities/${TROPA_DRAFT}`,
      { method: 'PATCH', body: { ...terms({ name }), expectedVersion: 1 } })));
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    assert.equal(results.find(result => result.status === 409).data.error, 'stale_activity');
    const winner = results.findIndex(result => result.status === 200);
    assert.equal(f.sql.prepare('SELECT name FROM activity WHERE id=?').get(TROPA_DRAFT).name, ['Carrera A', 'Carrera B'][winner]);
    assert.equal(version(f, TROPA_DRAFT), 2);
    assert.equal(auditCount(f, 'ACTIVITY_UPDATED', TROPA_DRAFT), 1);
  } finally { f.close(); }
});

test('concurrency: every write requires expectedVersion; publish and close are version-checked too', async () => {
  const f = await setup();
  try {
    const patch = await f.request(102, `/api/activities/${TROPA_DRAFT}`, { method: 'PATCH', body: terms() });
    assert.deepEqual([patch.status, patch.data.error], [400, 'invalid_activity']);
    for (const body of [{}, { expectedVersion: '1' }, { expectedVersion: 0 }]) {
      const response = await f.request(102, `/api/activities/${TROPA_DRAFT}/publish`, { method: 'POST', body });
      assert.deepEqual([response.status, response.data.error], [400, 'invalid_request'], JSON.stringify(body));
    }
    const noBody = await f.request(102, `/api/activities/${TROPA_DRAFT}/publish`, { method: 'POST' });
    assert.equal(noBody.status, 400);

    const stalePublish = await f.request(102, `/api/activities/${TROPA_DRAFT}/publish`, { method: 'POST', body: { expectedVersion: 2 } });
    assert.deepEqual([stalePublish.status, stalePublish.data.error], [409, 'stale_activity']);
    assert.equal(f.sql.prepare('SELECT status FROM activity WHERE id=?').get(TROPA_DRAFT).status, 'DRAFT');
    assert.equal(auditCount(f, 'ACTIVITY_PUBLISHED', TROPA_DRAFT), 0);

    const published = await f.request(102, `/api/activities/${TROPA_DRAFT}/publish`, { method: 'POST', body: { expectedVersion: 1 } });
    assert.deepEqual([published.status, published.data.status, published.data.version], [200, 'PUBLISHED', 2]);
    const staleClose = await f.request(102, `/api/activities/${TROPA_DRAFT}/close`, { method: 'POST', body: { expectedVersion: 1 } });
    assert.deepEqual([staleClose.status, staleClose.data.error], [409, 'stale_activity']);
    assert.equal(auditCount(f, 'ACTIVITY_CLOSED', TROPA_DRAFT), 0);
    const closed = await f.request(102, `/api/activities/${TROPA_DRAFT}/close`, { method: 'POST', body: { expectedVersion: 2 } });
    assert.deepEqual([closed.status, closed.data.version], [200, 3]);
  } finally { f.close(); }
});

test('concurrency: authorisation is decided before the version, so a stale request never reveals versions to outsiders', async () => {
  const f = await setup();
  try {
    const response = await f.request(103, `/api/activities/${TROPA_DRAFT}`, { method: 'PATCH', body: { ...terms(), expectedVersion: 99 } });
    assert.equal(response.status, 403);
  } finally { f.close(); }
});

test('discard: a manager removes a DRAFT without registrations atomically, audited, with the confirmed version', async () => {
  const f = await setup();
  try {
    const created = await f.request(102, '/api/activities', { method: 'POST', body: terms({
      transportOptions: [{ code: 'GROUP', adjustmentCents: 300 }, { code: 'FAMILY', adjustmentCents: 0 }] }) });
    assert.equal(created.status, 201);
    assert.equal(created.data.version, 1);
    const target = created.data.id;
    const stale = await f.request(102, `/api/activities/${target}`, { method: 'DELETE', body: { expectedVersion: 2 } });
    assert.deepEqual([stale.status, stale.data.error], [409, 'stale_activity']);
    const denied = await f.request(103, `/api/activities/${target}`, { method: 'DELETE', body: { expectedVersion: 1 } });
    assert.equal(denied.status, 403, 'Escolta coordinator cannot discard a Tropa draft');
    assert.equal(auditCount(f, 'ACTIVITY_DISCARDED', target), 0);

    const discarded = await f.request(102, `/api/activities/${target}`, { method: 'DELETE', body: { expectedVersion: 1 } });
    assert.deepEqual([discarded.status, discarded.data.discarded], [200, true]);
    for (const table of ['activity', 'activity_section', 'activity_transport_option'])
      assert.equal(f.sql.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${table === 'activity' ? 'id' : 'activity_id'}=?`).get(target).n, 0, table);
    assert.equal(auditCount(f, 'ACTIVITY_DISCARDED', target), 1);
    assert.equal((await f.request(102, `/api/activities/${target}`)).status, 404);
  } finally { f.close(); }
});

test('discard: PUBLISHED and CLOSED are never deleted, and a draft with registrations is refused with a domain error', async () => {
  const f = await setup();
  try {
    for (const target of [TROPA_PUBLISHED, TROPA_CLOSED]) {
      const response = await f.request(101, `/api/activities/${target}`, { method: 'DELETE', body: { expectedVersion: 1 } });
      assert.deepEqual([response.status, response.data.error], [409, 'invalid_transition']);
      assert.ok(f.sql.prepare('SELECT 1 FROM activity WHERE id=?').get(target));
    }
    register(f, 9001, TROPA_DRAFT, TROPA);
    const response = await f.request(102, `/api/activities/${TROPA_DRAFT}`, { method: 'DELETE', body: { expectedVersion: 1 } });
    assert.deepEqual([response.status, response.data.error], [409, 'activity_has_registrations']);
    assert.ok(f.sql.prepare('SELECT 1 FROM activity WHERE id=?').get(TROPA_DRAFT));
    const missing = await f.request(102, `/api/activities/${TROPA_DRAFT}`, { method: 'DELETE' });
    assert.equal(missing.status, 400);
  } finally { f.close(); }
});

test('discard: a registration arriving after the pre-check aborts the whole batch inside the database', async () => {
  const f = await setup();
  try {
    const { discardActivity } = await import('../gestio/src/services/activity-service.js');
    register(f, 9002, TROPA_DRAFT, TROPA);
    // Simulate the race: the service's registration pre-check does not see the row yet.
    const racing = { ...f.db, batch: f.db.batch, prepare(query) {
      const statement = f.db.prepare(query);
      if (/SELECT 1 FROM activity_registration WHERE activity_id=\? LIMIT 1/.test(query)) {
        let calls = 0;
        return { bind: () => ({ first: async () => (calls++ === 0 && !racing.done ? (racing.done = true, null) : { 1: 1 }) }) };
      }
      return statement;
    } };
    await assert.rejects(discardActivity(racing, f.context[102], 'request', TROPA_DRAFT, { expectedVersion: 1 }),
      error => error.status === 409 && error.code === 'activity_has_registrations');
    assert.ok(f.sql.prepare('SELECT 1 FROM activity WHERE id=?').get(TROPA_DRAFT));
    assert.equal(f.sql.prepare('SELECT count(*) AS n FROM activity_section WHERE activity_id=?').get(TROPA_DRAFT).n, 1);
    assert.equal(version(f, TROPA_DRAFT), 1);
    assert.equal(auditCount(f, 'ACTIVITY_DISCARDED', TROPA_DRAFT), 0);
  } finally { f.close(); }
});

test('list read model: counts are scoped like the registration list, labelled PARTIAL, and absent without review scope', async () => {
  const f = await setup();
  try {
    readOnlyTropa(f);
    register(f, 9101, GENERAL, TROPA, 'CONFIRMED', id(502));
    register(f, 9102, GENERAL, TROPA);
    register(f, 9103, GENERAL, ESCOLTA, 'CONFIRMED', id(504));
    register(f, 9104, GENERAL, MANADA, 'REJECTED');
    const rows = async user => Object.fromEntries((await f.request(user, '/api/activities')).data.activities.map(row => [row.id, row]));

    const group = await rows(101);
    assert.deepEqual(group[GENERAL].registrations, { scope: 'ALL', sections: [], total: 4, needsReview: 1, escalated: 0, actionable: 1, awaitingPayment: 0, confirmed: 2, rejected: 1, withdrawn: 0 });
    assert.equal(group[TROPA_PUBLISHED].registrations.total, 1);
    assert.equal(group[TROPA_DRAFT].version, 1);

    const tropa = await rows(102);
    assert.deepEqual(tropa[GENERAL].registrations, { scope: 'PARTIAL', sections: ['TROPA'], total: 2, needsReview: 1, escalated: 0, actionable: 1, awaitingPayment: 0, confirmed: 1, rejected: 0, withdrawn: 0 },
      'a Tropa reviewer never receives the global total of a GENERAL activity');
    assert.deepEqual(tropa[TROPA_PUBLISHED].registrations.scope, 'ALL');
    assert.equal(tropa[ESCOLTA_PAID], undefined);

    assert.equal((await f.request(105, '/api/activities')).status, 403, 'a reviewer without activities.read does not list activities');

    const readOnly = await rows(106);
    assert.ok(readOnly[GENERAL], 'read-only users list GENERAL activities');
    assert.equal(readOnly[GENERAL].registrations, null, 'no count without review scope');
    assert.equal(readOnly[TROPA_PUBLISHED].registrations, null);
    for (const row of Object.values(readOnly)) assert.equal(row.registrations, null);
  } finally { f.close(); }
});

test('list read model: mixed activities are PARTIAL for a single-section reviewer and SECTIONS without overlap get no count', async () => {
  const f = await setup();
  try {
    f.sql.exec(`INSERT INTO activity_section(activity_id,section_id) VALUES('${TROPA_DRAFT}','${ESCOLTA}')`);
    register(f, 9201, TROPA_DRAFT, TROPA, 'CONFIRMED', id(502));
    const tropa = Object.fromEntries((await f.request(102, '/api/activities')).data.activities.map(row => [row.id, row]));
    assert.deepEqual(tropa[TROPA_DRAFT].registrations, { scope: 'PARTIAL', sections: ['TROPA'], total: 1, needsReview: 0, escalated: 0, actionable: 0, awaitingPayment: 0, confirmed: 1, rejected: 0, withdrawn: 0 });
    const { summaryFor } = await import('../gestio/src/services/activity-service.js');
    assert.equal(summaryFor({ sections: [ESCOLTA], codeOf: new Map([[ESCOLTA, 'ESCOLTA']]) }, 'SECTIONS', [TROPA], '{"total":3}'), null);
  } finally { f.close(); }
});

test('list read model: registration counts use a constant number of queries whatever the number of activities', async () => {
  const f = await setup();
  try {
    const { listAdminActivities } = await import('../gestio/src/services/activity-service.js');
    const counting = () => {
      const counter = { queries: 0 };
      counter.db = { ...f.db, prepare(query) { counter.queries++; return f.db.prepare(query); } };
      return counter;
    };
    const before = counting();
    await listAdminActivities(before.db, f.context[101], 'request', new URLSearchParams());
    for (let n = 0; n < 30; n++) {
      const created = await f.request(101, '/api/activities', { method: 'POST', body: terms({ name: `Activitat de volum ${n}` }) });
      assert.equal(created.status, 201);
    }
    const after = counting();
    const result = await listAdminActivities(after.db, f.context[101], 'request', new URLSearchParams());
    assert.ok(result.activities.length >= 35);
    assert.equal(after.queries, before.queries, 'no per-activity request or query');
  } finally { f.close(); }
});

test('GENERAL read vs manage: any activities.read holder consults GENERAL; managing still requires the grant', async () => {
  const f = await setup();
  try {
    readOnlyTropa(f);
    for (const user of [101, 102, 103, 106]) {
      const detail = await f.request(user, `/api/activities/${GENERAL}`);
      assert.equal(detail.status, 200, `user ${user} reads GENERAL`);
      assert.ok((await f.request(user, '/api/activities')).data.activities.some(row => row.id === GENERAL), `user ${user} lists GENERAL`);
    }
    for (const user of [104, 105, 107]) assert.equal((await f.request(user, `/api/activities/${GENERAL}`)).status, 403, `user ${user} has no activities.read`);
    const edit = body => ({ method: 'PATCH', body: { ...terms({ audience: 'GENERAL', sectionIds: [] }), ...body, expectedVersion: 1 } });
    assert.equal((await f.request(103, `/api/activities/${GENERAL}`, edit({}))).status, 403, 'Escolta coordinator lacks the GENERAL grant');
    assert.equal((await f.request(105, `/api/activities/${GENERAL}`, edit({}))).status, 403, 'section delegate cannot manage');
    assert.equal((await f.request(106, `/api/activities/${GENERAL}`, edit({}))).status, 403, 'read-only user cannot manage');
    assert.equal((await f.request(103, `/api/activities/${GENERAL}/close`, { method: 'POST', body: { expectedVersion: 1 } })).status, 403);
    assert.equal((await f.request(102, `/api/activities/${GENERAL}`, edit({ name: 'General editada per Tropa' }))).status, 200,
      'SECTION_COORDINATOR keeps activities.general.manage by product decision');
  } finally { f.close(); }
});

test('SECTIONS read: a mixed activity is readable but not manageable with one of its sections; outside scope stays 404', async () => {
  const f = await setup();
  try {
    f.sql.exec(`INSERT INTO activity_section(activity_id,section_id) VALUES('${TROPA_DRAFT}','${ESCOLTA}')`);
    for (const user of [102, 103]) {
      assert.equal((await f.request(user, `/api/activities/${TROPA_DRAFT}`)).status, 200, `user ${user} reads the mixed activity`);
      assert.ok((await f.request(user, '/api/activities')).data.activities.some(row => row.id === TROPA_DRAFT));
      const edit = await f.request(user, `/api/activities/${TROPA_DRAFT}`, { method: 'PATCH',
        body: { ...terms({ sectionIds: [TROPA, ESCOLTA] }), expectedVersion: 1 } });
      assert.equal(edit.status, 403, `user ${user} cannot manage a section outside their scope`);
    }
    assert.equal((await f.request(101, `/api/activities/${TROPA_DRAFT}`, { method: 'PATCH',
      body: { ...terms({ sectionIds: [TROPA, ESCOLTA] }), expectedVersion: 1 } })).status, 200);
    const outside = await f.request(103, `/api/activities/${TROPA_PUBLISHED}`);
    assert.equal(outside.status, 404);
  } finally { f.close(); }
});

test('detail: termsLocked is derived from registrations, the summary matches the list and no creator id is exposed', async () => {
  const f = await setup();
  try {
    const locked = (await f.request(101, `/api/activities/${TROPA_PUBLISHED}`)).data.activity;
    assert.equal(locked.termsLocked, true);
    assert.equal(locked.registrations.total, 1);
    assert.equal(locked.version, 1);
    assert.equal(locked.sections, 'TROPA');
    assert.equal('created_by' in locked, false);
    const open = (await f.request(102, `/api/activities/${TROPA_DRAFT}`)).data.activity;
    assert.equal(open.termsLocked, false);
    const general = (await f.request(102, `/api/activities/${GENERAL}`)).data.activity;
    assert.equal(general.registrations.scope, 'PARTIAL');
    assert.deepEqual(general.registrations.sections, ['TROPA']);
    readOnlyTropa(f);
    const readOnly = (await f.request(106, `/api/activities/${TROPA_PUBLISHED}`)).data.activity;
    assert.equal(readOnly.registrations, null);
    assert.equal(readOnly.termsLocked, true);
  } finally { f.close(); }
});

test('transport: arranged by the family always costs 0 €, on create and on edit; other values are rejected', async () => {
  const f = await setup();
  try {
    const transport = family => ({ transportOptions: [{ code: 'GROUP', adjustmentCents: 300 }, { code: 'FAMILY', adjustmentCents: family }] });
    for (const family of [100, -100]) {
      const response = await f.request(102, '/api/activities', { method: 'POST', body: terms({ priceCents: 1500, ...transport(family) }) });
      assert.deepEqual([response.status, response.data.error], [400, 'invalid_activity'], `FAMILY ${family}`);
    }
    const created = await f.request(102, '/api/activities', { method: 'POST', body: terms({ priceCents: 1500, ...transport(0) }) });
    assert.equal(created.status, 201);
    const edited = await f.request(102, `/api/activities/${created.data.id}`, { method: 'PATCH',
      body: { ...terms({ priceCents: 1500, ...transport(50) }), expectedVersion: 1 } });
    assert.deepEqual([edited.status, edited.data.error], [400, 'invalid_activity']);
    assert.equal(version(f, created.data.id), 1);
    const discount = await f.request(102, `/api/activities/${created.data.id}`, { method: 'PATCH',
      body: { ...terms({ priceCents: 1500, transportOptions: [{ code: 'GROUP', adjustmentCents: -500 }, { code: 'FAMILY', adjustmentCents: 0 }] }), expectedVersion: 1 } });
    assert.equal(discount.status, 200, 'the group supplement may still be a discount');
  } finally { f.close(); }
});

test('support data for the UI: section catalogue in capabilities and transport choice in the registration list', async () => {
  const f = await setup();
  try {
    const me = (await f.request(102, '/api/me')).data.capabilities;
    assert.deepEqual(me.sections.map(section => section.code).sort(), ['CLAN', 'ESCOLTA', 'MANADA', 'TROPA']);
    assert.deepEqual(Object.keys(me.sections[0]).sort(), ['code', 'id'], 'reference data only');
    const rows = (await f.request(103, `/api/activities/${ESCOLTA_PAID}/registrations`)).data.registrations;
    assert.equal(rows[0].transport_code, 'FAMILY');
  } finally { f.close(); }
});

// 3.5D closure: a mixed activity never widens a section scope. Reading it is allowed with one section;
// everything that touches people, money or state stays inside the caller's own sections.
test('mixed activity: registrations, candidates, reviews and transitions stay strictly inside the section scope', async () => {
  const f = await setup();
  try {
    f.sql.exec(`INSERT INTO activity_section(activity_id,section_id) VALUES('${TROPA_DRAFT}','${ESCOLTA}')`);
    f.sql.exec(`UPDATE activity SET status='PUBLISHED' WHERE id='${TROPA_DRAFT}'`);
    register(f, 9301, TROPA_DRAFT, TROPA);
    register(f, 9302, TROPA_DRAFT, ESCOLTA);
    register(f, 9303, TROPA_DRAFT, ESCOLTA, 'CONFIRMED', id(504));
    const MIXED = TROPA_DRAFT;
    const ids = async user => (await f.request(user, `/api/activities/${MIXED}/registrations`)).data.registrations.map(row => row.id).sort();
    assert.deepEqual(await ids(102), [id(9301)], 'Tropa reviewer receives only Tropa registrations');
    assert.deepEqual(await ids(103), [id(9302), id(9303)], 'Escolta reviewer receives only Escolta registrations');
    assert.equal((await ids(101)).length, 3);

    const tropaView = (await f.request(102, `/api/activities/${MIXED}`)).data.activity.registrations;
    assert.deepEqual([tropaView.scope, tropaView.sections, tropaView.total], ['PARTIAL', ['TROPA'], 1], 'no total or count from Escolta');
    const escoltaView = (await f.request(103, `/api/activities/${MIXED}`)).data.activity.registrations;
    assert.deepEqual([escoltaView.scope, escoltaView.sections, escoltaView.total], ['PARTIAL', ['ESCOLTA'], 2]);

    // Another section's pending registration: no candidates, no review, and no confirmation that it exists.
    const candidates = await f.request(102, `/api/registrations/${id(9302)}/candidates`);
    assert.equal(candidates.status, 404);
    for (const body of [{ decision: 'REJECT' }, { decision: 'MATCH', participantId: id(504) }]) {
      const review = await f.request(102, `/api/registrations/${id(9302)}/review`, { method: 'POST', body });
      assert.equal(review.status, 404, `${JSON.stringify(body)}: out of scope is indistinguishable from missing (3.5F)`);
    }
    // Linking an own-section registration to a participant of the other section is refused too.
    const cross = await f.request(102, `/api/registrations/${id(9301)}/review`, { method: 'POST', body: { decision: 'MATCH', participantId: id(504), expectedVersion: 1 } });
    assert.equal(cross.status, 404, 'a participant outside the reviewer scope is indistinguishable from a missing one');
    assert.equal(f.sql.prepare('SELECT status FROM activity_registration WHERE id=?').get(id(9302)).status, 'NEEDS_PARTICIPANT_REVIEW');
    assert.equal(f.sql.prepare('SELECT participant_id FROM activity_registration WHERE id=?').get(id(9301)).participant_id, null);
    const own = await f.request(102, `/api/registrations/${id(9301)}/candidates`);
    assert.equal(own.status, 200);
    assert.ok(own.data.candidates.every(person => person.section_code === 'TROPA'), 'candidates never come from another section');

    // State changes need manage scope over every section of the activity.
    for (const user of [102, 103]) {
      assert.equal((await f.request(user, `/api/activities/${MIXED}/close`, { method: 'POST', body: { expectedVersion: 1 } })).status, 403);
      assert.equal((await f.request(user, `/api/activities/${MIXED}`, { method: 'DELETE', body: { expectedVersion: 1 } })).status, 403);
      const shrink = await f.request(user, `/api/activities/${MIXED}`, { method: 'PATCH',
        body: { ...terms({ sectionIds: [user === 102 ? TROPA : ESCOLTA] }), expectedVersion: 1 } });
      assert.equal(shrink.status, 403, 'a single-section coordinator cannot take over a mixed activity');
    }
    assert.equal(f.sql.prepare('SELECT status FROM activity WHERE id=?').get(MIXED).status, 'PUBLISHED');
    assert.equal(version(f, MIXED), 1);
    // And a section coordinator cannot turn an own activity into a mixed one.
    const widen = await f.request(102, `/api/activities/${TROPA_PUBLISHED}`, { method: 'PATCH',
      body: { ...terms({ sectionIds: [TROPA, ESCOLTA] }), expectedVersion: 1 } });
    assert.equal(widen.status, 403);
  } finally { f.close(); }
});

test('terms lock still applies with the right version and closed activities cannot be edited', async () => {
  const f = await setup();
  try {
    const locked = await f.request(102, `/api/activities/${TROPA_PUBLISHED}`, { method: 'PATCH',
      body: { ...terms({ priceCents: 500 }), expectedVersion: 1 } });
    assert.deepEqual([locked.status, locked.data.error], [409, 'activity_terms_locked']);
    const closed = await f.request(102, `/api/activities/${TROPA_CLOSED}`, { method: 'PATCH', body: { ...terms(), expectedVersion: 1 } });
    assert.deepEqual([closed.status, closed.data.error], [409, 'activity_closed']);
  } finally { f.close(); }
});
