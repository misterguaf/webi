// Audit M6: no silent truncation. Lists above 100 rows paginate with a cursor, keep scope, and the
// UI follows cursors to show complete lists.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createObligation } from '../gestio/src/services/annual-fee-service.js';
import { fetchAllPages } from '../gestio/public/api.js';
import { fixture, id } from './helpers/gestio-sqlite.js';

const TROPA = id(2), ESCOLTA = id(3);
async function walk(f, user, path, key) {
  const seen = [];
  let cursor = null, pages = 0;
  do {
    const response = await f.request(user, cursor ? `${path}${path.includes('?') ? '&' : '?'}cursor=${cursor}` : path);
    assert.equal(response.status, 200, path);
    seen.push(...response.data[key]);
    cursor = response.data.nextCursor;
    pages++;
  } while (cursor);
  return { seen, pages };
}
function bulkParticipants(f, count, { section = TROPA, base = 20000 } = {}) {
  const rows = Array.from({ length: count }, (_, n) =>
    `('${id(base + n)}','Educand ${String(base + n)} (ficticio)','${section}','ACTIVE','2013-01-01')`);
  f.sql.exec(`INSERT INTO participant(id,display_name,current_section_id,status,birth_date) VALUES ${rows.join(',')}`);
}

test('participants: 150 extra rows page by cursor without gaps, duplicates or scope leaks', async () => {
  const f = fixture();
  try {
    await f.login(101); await f.login(102);
    bulkParticipants(f, 150);
    bulkParticipants(f, 10, { section: ESCOLTA, base: 30000 });
    const first = await f.request(101, '/api/participants');
    assert.equal(first.data.participants.length, 100);
    assert.ok(first.data.nextCursor, 'a truncated first page says so');
    const all = await walk(f, 101, '/api/participants', 'participants');
    const active = f.sql.prepare("SELECT count(*) AS n FROM participant WHERE status='ACTIVE'").get().n;
    assert.equal(all.seen.length, active);
    assert.equal(new Set(all.seen.map(row => row.id)).size, active);
    const troop = await walk(f, 102, '/api/participants?limit=40', 'participants');
    assert.ok(troop.pages >= 4);
    assert.ok(troop.seen.every(row => row.current_section_id === TROPA));
    assert.equal(troop.seen.length, f.sql.prepare("SELECT count(*) AS n FROM participant WHERE status='ACTIVE' AND current_section_id=?").get(TROPA).n);
    for (const bad of ['?limit=0', '?limit=201', '?cursor=***', '?cursor=W10', `?cursor=${Buffer.from('[1,2]').toString('base64url')}`])
      assert.equal((await f.request(101, '/api/participants' + bad)).status, 400, bad);
  } finally { f.close(); }
});

test('fee obligations, basic fee status and registrations above 100 rows are complete across pages', async () => {
  const f = fixture();
  try {
    for (const user of [101, 102, 104]) await f.login(user);
    bulkParticipants(f, 130);
    for (let n = 0; n < 130; n++) await createObligation(f.db, f.context[104], crypto.randomUUID(), { roundId: id(901), participantId: id(20000 + n) });
    const obligations = await walk(f, 104, `/api/fees/rounds/${id(901)}/obligations`, 'obligations');
    assert.equal(obligations.pages, 2);
    assert.equal(new Set(obligations.seen.map(row => row.id)).size, 130);
    const statuses = await walk(f, 102, '/api/fees/status', 'statuses');
    assert.equal(statuses.seen.length, 130);
    assert.ok(statuses.seen.every(row => row.sectionCode === 'TROPA'));

    const values = Array.from({ length: 120 }, (_, n) => `('${id(40000 + n)}','${id(801)}',NULL,'Sol·licitud ${n} (ficticio)','sollicitud ${n} ficticio',
      '${TROPA}','pagination@example.test',0,'NONE','NEEDS_PARTICIPANT_REVIEW','DEPRECATED','DEMO-3A-PARTICIPATION-V1',1,'DEMO-3A-PRIVACY-NOTICE-V1',1,
      'pagination-key-${String(n).padStart(8, '0')}','${'0'.repeat(64)}',${1700000000000 + n},${1700000000000 + n},'2013-01-01')`);
    f.sql.exec(`INSERT INTO activity_registration(id,activity_id,participant_id,submitted_name,match_key,submitted_section_id,receipt_email,
      expected_amount_cents,match_status,status,consent_version,participation_terms_version,participation_authorized_at,privacy_notice_version,
      privacy_notice_acknowledged_at,idempotency_key,payload_sha256,created_at,updated_at,submitted_birth_date) VALUES ${values.join(',')}`);
    const registrations = await walk(f, 101, `/api/activities/${id(801)}/registrations`, 'registrations');
    assert.equal(registrations.seen.length, 121, '120 synthetic + 1 seed registration');
    assert.equal(registrations.pages, 2);
  } finally { f.close(); }
});

test('UI helper follows cursors and refuses to show an endless list as complete', async () => {
  const pages = { '/api/x': { rows: [1, 2], nextCursor: 'b' }, '/api/x?cursor=b': { rows: [3], nextCursor: 'c' }, '/api/x?cursor=c': { rows: [4], nextCursor: null } };
  const calls = [];
  const result = await fetchAllPages(async path => { calls.push(path); return pages[path]; }, '/api/x', 'rows');
  assert.deepEqual(result.rows, [1, 2, 3, 4]);
  assert.equal(result.nextCursor, null);
  assert.equal(calls.length, 3);
  await assert.rejects(fetchAllPages(async () => ({ rows: [1], nextCursor: 'again' }), '/api/y', 'rows', { maxPages: 3 }),
    /massa llarga/);
});
