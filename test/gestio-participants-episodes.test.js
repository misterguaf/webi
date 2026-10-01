// FASE 3.5E closure — guardian relationship episodes (migration 0017). A participant and a guardian
// may have several relationships over time: a current one at most, ended ones kept as history.
// Scope and the shared-guardian rule are unchanged; a former relationship reaches only that participant.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, id, migrations } from './helpers/gestio-sqlite.js';
import { relationshipPeriod, relinkableIds } from '../gestio/public/views/participants/model.js';

const TROPA_P = id(502), TROPA_P2 = id(503), ESCOLTA_P = id(504);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function setup() {
  const f = fixture();
  for (const user of [101, 102, 103, 104, 105]) await f.login(user);
  return f;
}
const episodes = (f, participantId, guardianId) => f.sql.prepare(`SELECT * FROM participant_guardian
  WHERE participant_id=? AND guardian_id=? ORDER BY started_at,rowid`).all(participantId, guardianId);
const link = (f, user, participantId, body) => f.request(user, `/api/participants/${participantId}/guardians`, { method: 'POST', body });
const end = (f, user, participantId, guardianId) => f.request(user, `/api/participants/${participantId}/guardians/${guardianId}`, { method: 'DELETE' });

test('episodes: active → ended → a new relationship with the same guardian, both kept in history', async () => {
  const f = await setup();
  try {
    const created = await link(f, 102, TROPA_P, { name: 'Tutora Episodis (fictícia)', relationship: 'PARENT', legalRepresentative: true });
    assert.equal(created.status, 201);
    const gid = created.data.guardianId;
    assert.match(created.data.relationshipId, UUID);
    // A: active
    let family = (await f.request(102, `/api/participants/${TROPA_P}/familia`)).data;
    assert.deepEqual(family.guardians.map(g => [g.id, g.ended]), [[gid, false]]);
    assert.equal((await link(f, 102, TROPA_P, { guardianId: gid, relationship: 'PARENT' })).status, 409, 'already linked while current');
    // A: ended
    assert.equal((await end(f, 102, TROPA_P, gid)).status, 200);
    assert.equal((await end(f, 102, TROPA_P, gid)).status, 404, 'no current relationship left to end');
    family = (await f.request(102, `/api/participants/${TROPA_P}/familia`)).data;
    assert.deepEqual(family.guardians.map(g => [g.id, g.ended]), [[gid, true]]);
    const completeness = (await f.request(102, `/api/participants/${TROPA_P}`)).data.participant.completeness;
    assert.ok(completeness.missing.includes('guardian'), 'an ended relationship does not count as a current guardian');
    // A: a new relationship with the same guardian (no other active link: reached through its own history)
    const again = await link(f, 102, TROPA_P, { guardianId: gid, relationship: 'LEGAL_GUARDIAN' });
    assert.equal(again.status, 201);
    assert.notEqual(again.data.relationshipId, created.data.relationshipId);
    const rows = episodes(f, TROPA_P, gid);
    assert.equal(rows.length, 2, 'the first episode is never deleted or overwritten');
    assert.deepEqual(rows.map(r => [r.relationship, r.ended_at != null, r.created_by, r.ended_by]),
      [['PARENT', true, id(102), id(102)], ['LEGAL_GUARDIAN', false, id(102), null]]);
    assert.equal(rows[0].legal_representative, 1, 'the ended episode keeps its representation');
    assert.equal(rows[1].legal_representative, 0, 'a new episode never inherits representation');
    assert.ok(rows[1].started_at >= rows[0].ended_at);
    // History of both episodes: read model and representation history
    family = (await f.request(102, `/api/participants/${TROPA_P}/familia`)).data;
    assert.deepEqual(family.guardians.map(g => [g.id, g.ended, g.relationship]), [[gid, false, 'LEGAL_GUARDIAN'], [gid, true, 'PARENT']]);
    assert.equal(new Set(family.guardians.map(g => g.relationshipId)).size, 2);
    assert.ok(family.guardians.every(g => typeof g.startedAt === 'number'));
    const history = (await f.request(102, `/api/participants/${TROPA_P}/representation`)).data.history.map(e => e.action).reverse();
    assert.deepEqual(history, ['SET_REPRESENTATIVE', 'RELATIONSHIP_ENDED']);
    // Audit trail names each episode, not only the guardian.
    for (const relationshipId of [created.data.relationshipId, again.data.relationshipId])
      assert.ok(f.sql.prepare("SELECT 1 FROM audit_event WHERE action='DATA_CREATED' AND resource_type='participant_guardian' AND resource_id=?").get(relationshipId));
    assert.ok(f.sql.prepare("SELECT 1 FROM audit_event WHERE action='DATA_UPDATED' AND resource_type='participant_guardian' AND resource_id=?").get(created.data.relationshipId));
    // And it can end and start again: a third episode.
    assert.equal((await end(f, 102, TROPA_P, gid)).status, 200);
    assert.equal((await link(f, 102, TROPA_P, { guardianId: gid, relationship: 'PARENT' })).status, 201);
    assert.equal(episodes(f, TROPA_P, gid).length, 3);
    assert.equal(episodes(f, TROPA_P, gid).filter(r => r.ended_at == null).length, 1);
  } finally { f.close(); }
});

test('a review from an earlier episode never marks a new episode as reviewed', async () => {
  const f = await setup();
  try {
    const gid = (await link(f, 102, TROPA_P, { name: 'Tutor Revisat (fictici)', relationship: 'PARENT', legalRepresentative: true })).data.guardianId;
    const review = (await f.request(105, '/api/participant-reviews')).data.reviews.find(r => r.guardianId === gid);
    assert.ok(review);
    assert.equal((await f.request(105, `/api/participant-reviews/${review.id}/acknowledge`, { method: 'POST', body: {} })).status, 200);
    let current = (await f.request(102, `/api/participants/${TROPA_P}/familia`)).data.guardians[0];
    assert.equal(current.representationReviewed, true);
    await end(f, 102, TROPA_P, gid);
    f.sql.prepare("UPDATE participant_review SET status='RESOLVED' WHERE guardian_id=?").run(gid);
    // Reviews belong to an episode by time; a human never ends and relinks within the same millisecond.
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal((await link(f, 102, TROPA_P, { guardianId: gid, relationship: 'PARENT', legalRepresentative: true })).status, 201);
    current = (await f.request(102, `/api/participants/${TROPA_P}/familia`)).data.guardians.find(g => !g.ended);
    assert.equal(current.representationBasis, 'COMUNICAT');
    assert.equal(current.representationReviewed, false);
    assert.equal(current.representationPending, true, 'the new episode opens its own review');
  } finally { f.close(); }
});

test('database invariants: one current episode, ended episodes immutable, no deletion, no overlap', async () => {
  const f = await setup();
  try {
    const gid = (await link(f, 102, TROPA_P, { name: 'Tutora Invariant (fictícia)', relationship: 'PARENT' })).data.guardianId;
    const insert = (rowId, startedAt) => f.sql.prepare(`INSERT INTO participant_guardian(id,participant_id,guardian_id,relationship,started_at)
      VALUES(?,?,?,'OTHER',?)`).run(rowId, TROPA_P, gid, startedAt);
    assert.throws(() => insert(id(9801), Date.now()), /UNIQUE/, 'a second current episode of the same pair');
    // Let the clock move so the ended episode has a non-empty interval (same-millisecond flake).
    await new Promise(resolve => setTimeout(resolve, 5));
    await end(f, 102, TROPA_P, gid);
    const [first] = episodes(f, TROPA_P, gid);
    assert.throws(() => insert(id(9802), first.started_at), /guardian_episode_overlap/, 'cannot start inside an ended episode');
    assert.throws(() => f.sql.prepare('UPDATE participant_guardian SET ended_at=NULL WHERE id=?').run(first.id), /history_immutable/, 'no reopening');
    assert.throws(() => f.sql.prepare("UPDATE participant_guardian SET relationship='OTHER' WHERE id=?").run(first.id), /history_immutable/);
    assert.throws(() => f.sql.prepare('DELETE FROM participant_guardian WHERE id=?').run(first.id), /history_immutable/);
    insert(id(9803), first.ended_at + 1);
    const current = f.sql.prepare('SELECT id FROM participant_guardian WHERE id=?').get(id(9803));
    assert.throws(() => f.sql.prepare('UPDATE participant_guardian SET started_at=1 WHERE id=?').run(current.id), /history_immutable/);
    assert.throws(() => f.sql.prepare('UPDATE participant_guardian SET guardian_id=? WHERE id=?').run(id(9999), current.id), /history_immutable/);
    assert.throws(() => f.sql.prepare('DELETE FROM participant_guardian WHERE id=?').run(current.id), /history_immutable/);
  } finally { f.close(); }
});

test('scope: a former relationship reaches only its own participant; other sections stay concealed', async () => {
  const f = await setup();
  try {
    const gid = (await link(f, 102, TROPA_P, { name: 'Tutora Abast (fictícia)', relationship: 'PARENT' })).data.guardianId;
    await end(f, 102, TROPA_P, gid);
    // The Escolta coordinator can neither relink it to a Tropa participant nor pull it into Escolta.
    assert.equal((await link(f, 103, TROPA_P, { guardianId: gid, relationship: 'PARENT' })).status, 404);
    assert.equal((await link(f, 103, ESCOLTA_P, { guardianId: gid, relationship: 'PARENT' })).status, 404, 'no current in-scope link and no own history');
    // Nor can the Tropa coordinator attach it to another Tropa participant: the history belongs to 502 only.
    assert.equal((await link(f, 102, TROPA_P2, { guardianId: gid, relationship: 'PARENT' })).status, 404);
    // Treasury has no guardian scope at all.
    assert.equal((await link(f, 104, TROPA_P, { guardianId: gid, relationship: 'PARENT' })).status, 403);
    assert.equal(episodes(f, TROPA_P, gid).length, 1);
    assert.equal(episodes(f, ESCOLTA_P, gid).length, 0);
    // An unknown guardian id is indistinguishable from a concealed one.
    assert.equal((await link(f, 102, TROPA_P, { guardianId: id(9990), relationship: 'PARENT' })).status, 404);
  } finally { f.close(); }
});

test('shared guardian: a new episode in one section keeps the shared-data rule and reveals nothing else', async () => {
  const f = await setup();
  try {
    // Group coordination links one guardian to a Tropa and an Escolta participant.
    const gid = (await link(f, 101, TROPA_P, { name: 'Tutor Compartit (fictici)', relationship: 'PARENT' })).data.guardianId;
    assert.equal((await link(f, 101, ESCOLTA_P, { guardianId: gid, relationship: 'PARENT' })).status, 201);
    // Tropa ends and restarts its own relationship; the Escolta relationship is untouched.
    assert.equal((await end(f, 102, TROPA_P, gid)).status, 200);
    assert.equal(episodes(f, ESCOLTA_P, gid)[0].ended_at, null);
    assert.equal((await link(f, 102, TROPA_P, { guardianId: gid, relationship: 'PARENT' })).status, 201);
    assert.equal(episodes(f, TROPA_P, gid).length, 2);
    assert.equal(episodes(f, ESCOLTA_P, gid).length, 1);
    // Shared data still goes to Secretaria for a coordinator who does not cover every linked participant.
    const add = await f.request(102, `/api/participants/${TROPA_P}/contacts`, { method: 'POST', body: { ownerType: 'guardian', guardianId: gid, kind: 'PHONE', value: '600999000' } });
    assert.equal(add.status, 201);
    assert.equal(add.data.requested, true);
    // Tropa still cannot read the Escolta participant's family or relink there.
    assert.equal((await f.request(102, `/api/participants/${ESCOLTA_P}/familia`)).status, 404);
    assert.equal((await end(f, 102, ESCOLTA_P, gid)).status, 404);
    // The Tropa family view lists only Tropa's own episodes.
    const family = (await f.request(102, `/api/participants/${TROPA_P}/familia`)).data;
    assert.equal(family.guardians.length, 2);
    assert.ok(!JSON.stringify(family).includes(ESCOLTA_P));
  } finally { f.close(); }
});

test('migration 0017 keeps every pre-existing relationship as a first episode', () => {
  const sql = new DatabaseSync(':memory:');
  try {
    sql.exec('PRAGMA foreign_keys=ON');
    const names = readdirSync(migrations).filter(name => name.endsWith('.sql')).sort();
    const before = names.filter(name => name < '0017');
    assert.ok(names.includes('0017_guardian_relationship_episodes.sql'));
    for (const name of before) sql.exec(readFileSync(join(migrations, name), 'utf8'));
    sql.exec(`INSERT INTO app_user(id,display_name,status,created_at,updated_at) VALUES('${id(8801)}','Usuari Migració (fictici)','ACTIVE',1,1)`);
    const sectionId = sql.prepare('SELECT id FROM section LIMIT 1').get().id;
    sql.exec(`INSERT INTO participant(id,display_name,current_section_id,status) VALUES('${id(8803)}','Participant Migració (fictici)','${sectionId}','ACTIVE');
      INSERT INTO guardian(id,display_name,created_at,updated_at) VALUES('${id(8804)}','Tutora Migració (fictícia)',1,1),('${id(8805)}','Tutor Migració (fictici)',1,1);
      INSERT INTO participant_guardian(participant_id,guardian_id,relationship,legal_representative,started_at,ended_at,representation_basis,recorded_by,provenance,updated_at)
      VALUES('${id(8803)}','${id(8804)}','PARENT',1,10,NULL,'ACREDITAT','${id(8801)}','DOCUMENTACIO_FISICA',10),
            ('${id(8803)}','${id(8805)}','OTHER',0,10,20,NULL,NULL,NULL,20)`);
    sql.exec(readFileSync(join(migrations, '0017_guardian_relationship_episodes.sql'), 'utf8'));
    const rows = sql.prepare('SELECT * FROM participant_guardian ORDER BY guardian_id').all();
    assert.equal(rows.length, 2);
    assert.ok(rows.every(row => UUID.test(row.id)));
    assert.deepEqual(rows.map(row => [row.guardian_id, row.relationship, row.legal_representative, row.started_at, row.ended_at,
      row.representation_basis, row.recorded_by, row.provenance, row.created_by, row.ended_by]),
      [[id(8804), 'PARENT', 1, 10, null, 'ACREDITAT', id(8801), 'DOCUMENTACIO_FISICA', id(8801), null],
        [id(8805), 'OTHER', 0, 10, 20, null, null, null, null, null]]);
    assert.equal(sql.prepare('PRAGMA foreign_key_check').all().length, 0);
    // The formerly ended pair can now start a second episode.
    sql.exec(`INSERT INTO participant_guardian(id,participant_id,guardian_id,relationship,started_at) VALUES('${id(8806)}','${id(8803)}','${id(8805)}','OTHER',30)`);
    assert.equal(sql.prepare('SELECT count(*) AS n FROM participant_guardian WHERE guardian_id=?').get(id(8805)).n, 2);
  } finally { sql.close(); }
});

test('UI model: period labels and one relink action per former guardian', () => {
  const at = (y, m) => Date.UTC(y, m - 1, 15);
  assert.equal(relationshipPeriod({ startedAt: at(2024, 3), endedAt: at(2025, 9) }), 'Des de 03/2024 fins a 09/2025');
  assert.equal(relationshipPeriod({ startedAt: at(2024, 3), endedAt: null }), 'Des de 03/2024');
  const g = (gid, rid, ended, startedAt) => ({ id: gid, relationshipId: rid, ended, startedAt });
  const rows = [g('a', 'a2', false, 3), g('a', 'a1', true, 1), g('b', 'b1', true, 1), g('b', 'b2', true, 2), g('c', 'c1', true, 1)];
  assert.deepEqual([...relinkableIds(rows)].sort(), ['b2', 'c1'], 'never for a guardian with a current relationship; latest episode only');
});
