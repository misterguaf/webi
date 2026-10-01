// FASE 3.5F Batch 1 — migration 0018: rebuild of activity_registration / payment_evidence /
// notification_outbox / notification_capture without losing rows, ids or relations, plus the new
// registration invariants (registration section, WITHDRAWN, escalation, correction history, purge).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, id, migrations, root } from './helpers/gestio-sqlite.js';

const TROPA = id(2), ESCOLTA = id(3), MANADA = id(1);
const TABLES = ['activity_registration', 'payment_evidence', 'notification_outbox', 'notification_capture'];
const dump = (sql, table) => sql.prepare(`SELECT * FROM ${table} ORDER BY 1`).all();

function upTo17() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  for (const name of readdirSync(migrations).filter(n => n.endsWith('.sql') && n < '0018').sort())
    sql.exec(readFileSync(join(migrations, name), 'utf8'));
  sql.exec(readFileSync(join(root, 'gestio/seed.sql'), 'utf8'));
  return sql;
}
const apply18 = sql => sql.exec(readFileSync(join(migrations, '0018_registrations_v1.sql'), 'utf8'));
function legacyRegistration(sql, n, { activity = id(801), section = TROPA, participant = null, status = 'NEEDS_PARTICIPANT_REVIEW', birth = null, amount = 0 } = {}) {
  sql.prepare(`INSERT INTO activity_registration(id,activity_id,participant_id,submitted_name,match_key,submitted_section_id,receipt_email,
    expected_amount_cents,match_status,status,consent_version,participation_terms_version,participation_authorized_at,privacy_notice_version,
    privacy_notice_acknowledged_at,idempotency_key,payload_sha256,created_at,updated_at,submitted_by_name,contact_phone,submitted_birth_date)
    VALUES(?,?,?,'Sol·licitud fictícia','sollicitud ficticia',?,?,?,?,?,'DEPRECATED','DEMO-3A-PARTICIPATION-V1',1,'DEMO-3A-PRIVACY-NOTICE-V1',1,?,?,1,1,'Tutor fictici','600000000',?)`)
    .run(id(n), activity, participant, section, `migracio${n}@example.test`, amount,
      participant ? 'CLEAR' : status === 'REJECTED' ? 'REJECTED' : 'AMBIGUOUS', status, `migration-key-${String(n).padStart(8, '0')}`, '0'.repeat(64), birth);
}

test('0018 copies every registration, evidence, outbox and capture row unchanged with its id and relations', () => {
  const sql = upTo17();
  try {
    // One row in each pre-0018 state (the seed already holds CONFIRMED and AWAITING_PAYMENT_REVIEW).
    legacyRegistration(sql, 60001, { birth: '2013-02-03' });
    legacyRegistration(sql, 60002, { status: 'REJECTED' });
    legacyRegistration(sql, 60003, { participant: id(502), status: 'CONFIRMED', activity: id(802), amount: 1200 });
    sql.exec(`INSERT INTO notification_capture(outbox_id,recipient_email,subject,body,captured_at)
      VALUES('${id(841)}','familia503@example.test','Assumpte (prova)','Cos (prova)',2)`);
    const before = Object.fromEntries(TABLES.map(t => [t, dump(sql, t)]));
    apply18(sql);
    for (const table of TABLES) {
      const after = dump(sql, table);
      assert.equal(after.length, before[table].length, table);
      for (const [index, row] of before[table].entries())
        for (const [key, value] of Object.entries(row)) assert.equal(after[index][key], value, `${table}.${key}`);
    }
    const regs = dump(sql, 'activity_registration');
    assert.ok(regs.every(r => r.registration_section_id === r.submitted_section_id), 'registration section backfilled from the declared one');
    assert.ok(regs.every(r => r.version === 1 && r.review_level === 'SECTION' && r.withdrawn_at === null));
    assert.equal(sql.prepare('PRAGMA foreign_key_check').all().length, 0);
    assert.equal(sql.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    const fks = t => sql.prepare(`PRAGMA foreign_key_list(${t})`).all().map(r => r.table);
    assert.ok(fks('payment_evidence').includes('activity_registration'));
    assert.ok(fks('notification_outbox').includes('activity_registration'));
    assert.deepEqual(fks('notification_capture'), ['notification_outbox']);
    assert.equal(sql.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE '%_v18'").get().n, 0);
  } finally { sql.close(); }
});

test('0018 recreates every trigger and index, and the activity locks still hold', () => {
  const f = fixture();
  try {
    const objects = new Set(f.sql.prepare("SELECT type||':'||name AS o FROM sqlite_master").all().map(r => r.o));
    for (const name of ['trigger:activity_registration_transition', 'trigger:registration_birthdate_only_pending_insert',
      'trigger:registration_birthdate_only_pending_update', 'trigger:registration_authorizations_required_insert',
      'trigger:registration_authorizations_immutable_update', 'trigger:registration_declared_section_immutable',
      'trigger:registration_section_on_insert', 'trigger:registration_section_fill', 'trigger:registration_section_correction_guard',
      'trigger:registration_withdrawal_immutable', 'trigger:registration_escalation_pending_only', 'trigger:payment_review_transition',
      'trigger:payment_evidence_purge_once', 'trigger:notification_delivery_transition', 'trigger:activity_terms_locked',
      'trigger:activity_section_locked_insert', 'trigger:activity_section_locked_delete', 'trigger:activity_transport_locked_insert',
      'trigger:activity_transport_locked_delete', 'trigger:activity_registration_section_change_no_update',
      'trigger:activity_registration_section_change_no_delete', 'index:activity_registration_member_unique',
      'index:activity_registration_pending_unique', 'index:activity_registration_activity_idx', 'index:activity_registration_section_idx',
      'index:notification_outbox_pending_idx'])
      assert.ok(objects.has(name), name);
    // Activity 802 has registrations in the seed: price, sections and transport stay locked.
    assert.throws(() => f.sql.exec(`UPDATE activity SET price_cents=price_cents+1 WHERE id='${id(802)}'`), /activity_terms_locked/);
    assert.throws(() => f.sql.exec(`DELETE FROM activity_transport_option WHERE activity_id='${id(802)}'`), /activity_transport_locked/);
    assert.throws(() => f.sql.exec(`INSERT INTO activity_section(activity_id,section_id) VALUES('${id(802)}','${MANADA}')`), /activity_sections_locked/);
  } finally { f.close(); }
});

test('registration invariants: transitions with WITHDRAWN, declared section immutable, correction guard, history', () => {
  const f = fixture();
  try {
    f.sql.exec(`INSERT INTO activity(id,public_code,name,status,audience,location,starts_at,ends_at,registration_deadline,price_cents,currency,
      short_description,materials,special_notice,created_by,created_at,updated_at) VALUES('${id(60100)}','DEMO-GENERAL-MIGRA','Activitat general fictícia',
      'PUBLISHED','GENERAL','Lloc fictici',2209075200000,2209161600000,2208988800000,0,'EUR','Prova','','','${id(101)}',1,1)`);
    legacyRegistration(f.sql, 60010, { activity: id(60100), birth: '2013-02-03' });
    const row = () => f.sql.prepare('SELECT * FROM activity_registration WHERE id=?').get(id(60010));
    assert.equal(row().registration_section_id, TROPA, 'filled from the declared section');
    assert.throws(() => f.sql.exec(`UPDATE activity_registration SET submitted_section_id='${ESCOLTA}' WHERE id='${id(60010)}'`), /declared_section_immutable/);
    // A GENERAL activity admits any section; correction allowed while pending.
    f.sql.exec(`UPDATE activity_registration SET registration_section_id='${ESCOLTA}' WHERE id='${id(60010)}'`);
    assert.equal(row().submitted_section_id, TROPA);
    assert.throws(() => f.sql.exec(`UPDATE activity_registration SET registration_section_id=NULL WHERE id='${id(60010)}'`), /registration_section_locked/);
    // Withdrawal from pending clears nothing but must carry its facts and drop the declared birth date.
    assert.throws(() => f.sql.exec(`UPDATE activity_registration SET status='WITHDRAWN' WHERE id='${id(60010)}'`), /CHECK|birthdate/);
    f.sql.exec(`UPDATE activity_registration SET status='WITHDRAWN',withdrawn_at=5,withdrawn_by='${id(101)}',withdrawal_source='FAMILY_COMMUNICATION',
      submitted_birth_date=NULL WHERE id='${id(60010)}'`);
    assert.throws(() => f.sql.exec(`UPDATE activity_registration SET status='CONFIRMED' WHERE id='${id(60010)}'`), /invalid_registration_transition/);
    assert.throws(() => f.sql.exec(`UPDATE activity_registration SET withdrawal_source='OTHER' WHERE id='${id(60010)}'`), /withdrawal_immutable/);
    assert.throws(() => f.sql.exec(`UPDATE activity_registration SET registration_section_id='${TROPA}' WHERE id='${id(60010)}'`), /registration_section_locked/);
    // A confirmed registration can be withdrawn but never rejected; its section is frozen.
    assert.throws(() => f.sql.exec(`UPDATE activity_registration SET status='REJECTED',match_status='REJECTED',participant_id=NULL WHERE id='${id(821)}'`));
    assert.throws(() => f.sql.exec(`UPDATE activity_registration SET registration_section_id='${ESCOLTA}' WHERE id='${id(821)}'`), /registration_section_locked/);
    f.sql.exec(`UPDATE activity_registration SET status='WITHDRAWN',withdrawn_at=5,withdrawn_by='${id(101)}',withdrawal_source='OTHER' WHERE id='${id(821)}'`);
    // SECTIONS activity 802 (Escolta): correction to a section outside the audience is refused.
    legacyRegistration(f.sql, 60011, { activity: id(802), section: ESCOLTA });
    assert.throws(() => f.sql.exec(`UPDATE activity_registration SET registration_section_id='${TROPA}' WHERE id='${id(60011)}'`), /registration_section_locked/);
    // Escalation only while pending; history rows are append-only.
    f.sql.exec(`UPDATE activity_registration SET review_level='GLOBAL',escalation_reason='REVIEWER_REQUEST',escalated_at=6 WHERE id='${id(60011)}'`);
    assert.throws(() => f.sql.exec(`UPDATE activity_registration SET review_level='GLOBAL',escalation_reason='REVIEWER_REQUEST',escalated_at=6 WHERE id='${id(822)}'`), /invalid_registration_transition/);
    f.sql.exec(`INSERT INTO activity_registration_section_change(id,registration_id,from_section_id,to_section_id,reason,changed_by,changed_at)
      VALUES('${id(60020)}','${id(60011)}','${ESCOLTA}','${TROPA}','CORRECTION','${id(101)}',7)`);
    assert.throws(() => f.sql.exec(`UPDATE activity_registration_section_change SET changed_at=8`), /history_immutable/);
    assert.throws(() => f.sql.exec(`DELETE FROM activity_registration_section_change`), /history_immutable/);
  } finally { f.close(); }
});

test('a withdrawn registration no longer blocks a new one; evidence purge is once and only for verified evidence', () => {
  const f = fixture();
  try {
    // 821: participant 503 on activity 801.
    assert.throws(() => legacyRegistration(f.sql, 60030, { participant: id(503), status: 'CONFIRMED' }), /UNIQUE/);
    f.sql.exec(`UPDATE activity_registration SET status='WITHDRAWN',withdrawn_at=5,withdrawn_by='${id(101)}',withdrawal_source='FAMILY_COMMUNICATION' WHERE id='${id(821)}'`);
    legacyRegistration(f.sql, 60030, { participant: id(503), status: 'CONFIRMED' });
    assert.equal(f.sql.prepare("SELECT count(*) AS n FROM activity_registration WHERE participant_id=? AND activity_id=?").get(id(503), id(801)).n, 2);
    // Evidence 831 is pending: it cannot be purged.
    assert.throws(() => f.sql.exec(`UPDATE payment_evidence SET object_purged_at=9,object_purge_reason='RETENTION_POLICY' WHERE id='${id(831)}'`), /CHECK/);
    f.sql.exec(`UPDATE payment_evidence SET review_status='VERIFIED' WHERE id='${id(831)}'`);
    f.sql.exec(`UPDATE payment_evidence SET object_purged_at=9,object_purge_reason='RETENTION_POLICY' WHERE id='${id(831)}'`);
    assert.throws(() => f.sql.exec(`UPDATE payment_evidence SET object_purged_at=10 WHERE id='${id(831)}'`), /payment_evidence_purged/);
    // New notice kinds exist.
    f.sql.exec(`INSERT INTO notification_outbox(id,registration_id,kind,recipient_email,status,created_at) VALUES('${id(60040)}','${id(821)}','WITHDRAWN','demo821@example.test','PENDING',1)`);
    f.sql.exec(`INSERT INTO notification_outbox(id,registration_id,kind,recipient_email,status,created_at) VALUES('${id(60041)}','${id(60030)}','REJECTED','prova@example.test','PENDING',1)`);
  } finally { f.close(); }
});

test('0018 grants the contact permission and Secretaria global review without activities.manage', () => {
  const f = fixture();
  try {
    const roles = code => f.sql.prepare('SELECT role_code FROM role_permission WHERE permission_code=? ORDER BY 1').all(code).map(r => r.role_code);
    assert.deepEqual(roles('activities.registration.contact.read'), ['GROUP_COORDINATOR', 'SECRETARY', 'SECTION_COORDINATOR', 'SECTION_DELEGATE']);
    assert.ok(roles('activities.read').includes('SECRETARY'));
    assert.ok(roles('activities.registration.review').includes('SECRETARY'));
    assert.ok(!roles('activities.manage').includes('SECRETARY'));
    assert.ok(!roles('activities.general.manage').includes('SECRETARY'));
    assert.ok(!roles('finance.payment.verify').includes('SECTION_COORDINATOR'));
    assert.ok(!roles('activities.read').includes('TREASURY'));
  } finally { f.close(); }
});
