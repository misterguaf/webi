// Audit A2: participant domain foundation — membership history, guardians (N:M), contact points,
// consents — plus the authorisation catalogue that now exists without the synthetic seed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, id, migrations, root } from './helpers/gestio-sqlite.js';

const MANADA = id(1), TROPA = id(2), ESCOLTA = id(3);
const history = (sql, participant) => sql.prepare(`SELECT section_id,ended_at IS NULL AS open,start_reason,end_reason
  FROM participant_section_membership WHERE participant_id=? ORDER BY started_at,rowid`).all(participant)
  .map(row => ({ ...row, open: !!row.open }));

test('a clean install without the synthetic seed already has sections, roles, permissions and the default matrix', () => {
  const clean = new DatabaseSync(':memory:'), seeded = fixture();
  try {
    clean.exec('PRAGMA foreign_keys=ON');
    for (const name of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort())
      clean.exec(readFileSync(join(migrations, name), 'utf8'));
    for (const table of ['section', 'role', 'permission', 'role_permission'])
      assert.deepEqual(clean.prepare(`SELECT * FROM ${table} ORDER BY 1`).all().map(row => JSON.stringify(row)).sort(),
        seeded.sql.prepare(`SELECT * FROM ${table} ORDER BY 1`).all().map(row => JSON.stringify(row)).sort(), table);
    assert.equal(clean.prepare('SELECT count(*) AS n FROM app_user').get().n, 0, 'no identities without explicit provisioning');
  } finally { clean.close(); seeded.close(); }
});

test('existing databases are backfilled: one membership per participant and contacts mirrored', () => {
  const sql = new DatabaseSync(':memory:');
  try {
    sql.exec('PRAGMA foreign_keys=ON');
    const names = readdirSync(migrations).filter(name => name.endsWith('.sql')).sort();
    for (const name of names.filter(name => name < '0011_')) sql.exec(readFileSync(join(migrations, name), 'utf8'));
    sql.exec(readFileSync(join(root, 'gestio/seed.sql'), 'utf8'));
    for (const name of names.filter(name => name >= '0011_')) sql.exec(readFileSync(join(migrations, name), 'utf8'));
    assert.equal(sql.prepare("SELECT count(*) AS n FROM participant_section_membership WHERE start_reason='BACKFILL' AND ended_at IS NULL").get().n, 5);
    assert.equal(sql.prepare("SELECT count(*) AS n FROM contact_point WHERE kind='EMAIL' AND purpose='NOTIFICATIONS' AND is_primary=1").get().n, 5);
    assert.equal(sql.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { sql.close(); }
});

test('membership history follows the current-section projection and is append-only', () => {
  const f = fixture();
  try {
    const p = id(7001);
    f.sql.exec(`INSERT INTO participant(id,display_name,current_section_id,status,birth_date) VALUES('${p}','Nou Educand (ficticio)','${MANADA}','ACTIVE','2016-01-01')`);
    assert.deepEqual(history(f.sql, p), [{ section_id: MANADA, open: true, start_reason: 'ENROLMENT', end_reason: null }]);
    f.sql.exec(`UPDATE participant SET current_section_id='${TROPA}' WHERE id='${p}'`);
    f.sql.exec(`UPDATE participant SET status='INACTIVE' WHERE id='${p}'`);
    f.sql.exec(`UPDATE participant SET status='ACTIVE' WHERE id='${p}'`);
    f.sql.exec(`UPDATE participant SET current_section_id='${ESCOLTA}',display_name='Nou Educand Canviat (ficticio)' WHERE id='${p}'`);
    assert.deepEqual(history(f.sql, p), [
      { section_id: MANADA, open: false, start_reason: 'ENROLMENT', end_reason: 'TRANSFER' },
      { section_id: TROPA, open: false, start_reason: 'TRANSFER', end_reason: 'DEACTIVATION' },
      { section_id: TROPA, open: false, start_reason: 'REACTIVATION', end_reason: 'TRANSFER' },
      { section_id: ESCOLTA, open: true, start_reason: 'TRANSFER', end_reason: null }
    ]);
    const open = f.sql.prepare('SELECT id FROM participant_section_membership WHERE participant_id=? AND ended_at IS NULL').get(p).id;
    assert.throws(() => f.sql.exec(`UPDATE participant_section_membership SET section_id='${MANADA}' WHERE id='${open}'`), /membership_history_immutable/);
    assert.throws(() => f.sql.exec(`DELETE FROM participant_section_membership WHERE participant_id='${p}'`), /membership_history_immutable/);
    assert.throws(() => f.sql.exec(`INSERT INTO participant_section_membership(id,participant_id,section_id,started_at,start_reason)
      VALUES('${id(7002)}','${id(502)}','${MANADA}',1,'TRANSFER')`), /membership_projection_mismatch/);
  } finally { f.close(); }
});

test('participant detail exposes section history; scope follows the current section only', async () => {
  const f = fixture();
  try {
    await f.login(102); await f.login(103);
    f.sql.exec(`UPDATE participant SET current_section_id='${ESCOLTA}' WHERE id='${id(502)}'`);
    const escolta = await f.request(103, `/api/participants/${id(502)}`);
    assert.equal(escolta.status, 200);
    assert.deepEqual(escolta.data.participant.sectionHistory.map(row => row.section_code), ['TROPA', 'ESCOLTA']);
    assert.equal((await f.request(102, `/api/participants/${id(502)}`)).status, 404, 'historical section keeps no access');
  } finally { f.close(); }
});

test('guardians are N:M; contact points have one owner and one current primary per kind', () => {
  const f = fixture();
  try {
    f.sql.exec(`INSERT INTO guardian(id,display_name,created_at,updated_at) VALUES
      ('${id(7101)}','Tutora A (fictícia)',1,1),('${id(7102)}','Tutor B (fictici)',1,1);
      INSERT INTO participant_guardian(participant_id,guardian_id,relationship,legal_representative,started_at) VALUES
      ('${id(502)}','${id(7101)}','PARENT',1,1),('${id(503)}','${id(7101)}','PARENT',1,1),('${id(502)}','${id(7102)}','LEGAL_GUARDIAN',1,1)`);
    assert.equal(f.sql.prepare('SELECT count(*) AS n FROM participant_guardian WHERE guardian_id=?').get(id(7101)).n, 2);
    assert.equal(f.sql.prepare('SELECT count(*) AS n FROM participant_guardian WHERE participant_id=?').get(id(502)).n, 2);
    assert.throws(() => f.sql.exec(`INSERT INTO participant_guardian(participant_id,guardian_id,relationship,started_at)
      VALUES('${id(502)}','${id(7101)}','OTHER',2)`), /UNIQUE|PRIMARY/);
    const contact = (owner, extra = '') => `INSERT INTO contact_point(id,${owner},kind,value,purpose,is_primary,created_at)${extra}`;
    f.sql.exec(`${contact('guardian_id')} VALUES('${id(7201)}','${id(7101)}','EMAIL','tutora@example.test','GENERAL',1,1)`);
    f.sql.exec(`${contact('guardian_id')} VALUES('${id(7202)}','${id(7101)}','PHONE','+34 600 000 000','GENERAL',1,1)`);
    assert.throws(() => f.sql.exec(`${contact('guardian_id')} VALUES('${id(7203)}','${id(7101)}','EMAIL','altra@example.test','GENERAL',1,1)`), /UNIQUE/);
    assert.throws(() => f.sql.exec(`INSERT INTO contact_point(id,participant_id,guardian_id,kind,value,created_at)
      VALUES('${id(7204)}','${id(502)}','${id(7101)}','EMAIL','doble@example.test',1)`), /CHECK/);
    assert.throws(() => f.sql.exec(`${contact('guardian_id')} VALUES('${id(7205)}','${id(7102)}','EMAIL','no-es-un-correu','GENERAL',0,1)`), /CHECK/);
    assert.throws(() => f.sql.exec(`${contact('guardian_id')} VALUES('${id(7206)}','${id(7102)}','PHONE','telefon;drop','GENERAL',0,1)`), /CHECK/);
    f.sql.exec(`UPDATE participant_contact SET notification_email='nou502@example.test' WHERE participant_id='${id(502)}'`);
    assert.equal(f.sql.prepare(`SELECT value FROM contact_point WHERE participant_id=? AND purpose='NOTIFICATIONS'`).get(id(502)).value,
      'nou502@example.test', 'legacy participant_contact stays mirrored');
  } finally { f.close(); }
});

test('consents are append-only and the current view reflects the latest decision', () => {
  const f = fixture();
  try {
    f.sql.exec(`INSERT INTO consent_record(id,participant_id,consent_code,document_version,decision,decided_at,source,recorded_at) VALUES
      ('${id(7301)}','${id(502)}','ACTIVITY_PARTICIPATION','DEMO-V1','GRANTED',100,'PORTAL',100),
      ('${id(7302)}','${id(502)}','ACTIVITY_PARTICIPATION','DEMO-V1','WITHDRAWN',200,'GESTIO',200),
      ('${id(7303)}','${id(503)}','ACTIVITY_PARTICIPATION','DEMO-V1','GRANTED',150,'PAPER',150)`);
    const current = f.sql.prepare('SELECT participant_id,decision FROM participant_consent_current ORDER BY participant_id').all();
    assert.deepEqual(current.map(row => [row.participant_id, row.decision]), [[id(502), 'WITHDRAWN'], [id(503), 'GRANTED']]);
    assert.throws(() => f.sql.exec(`UPDATE consent_record SET decision='GRANTED' WHERE id='${id(7302)}'`), /consent_history_immutable/);
    assert.throws(() => f.sql.exec(`DELETE FROM consent_record WHERE id='${id(7301)}'`), /consent_history_immutable/);
    assert.throws(() => f.sql.exec(`INSERT INTO consent_record(id,participant_id,consent_code,document_version,decision,decided_at,source,recorded_at)
      VALUES('${id(7304)}','${id(502)}','lower-case','V1','GRANTED',1,'PORTAL',1)`), /CHECK/);
  } finally { f.close(); }
});
