import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { assertLocalConfig, localD1Args, localR2Args, main } from '../gestio/demo/cli.js';
import { buildDemoData } from '../gestio/demo/data.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = readFileSync(resolve(repo, 'gestio/wrangler.toml'), 'utf8');
const wrangler = resolve(repo, 'node_modules/.bin/wrangler');

function run(command, args, cwd) {
  const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, env });
  assert.equal(result.status, 0, `${command} ${args.slice(0, 3).join(' ')}: ${result.stderr || result.stdout}`);
  return result.stdout;
}

test('demo commands are pinned to the local development D1/R2 and reject remote options', async () => {
  assertLocalConfig(config);
  assert.throws(() => assertLocalConfig(config.replace('APP_ENV = "development"', 'APP_ENV = "production"')));
  assert.throws(() => assertLocalConfig(config.replace('database_name = "parpallo-gestio-local"', 'database_name = "remote"')));
  assert.throws(() => assertLocalConfig(config, { APP_ENV: 'production' }));
  assert.throws(() => assertLocalConfig(config, { NODE_ENV: 'production' }));
  const d1 = localD1Args(['execute', '--command', 'SELECT 1']);
  const r2 = localR2Args('synthetic/example.pdf', '/tmp/example.pdf');
  for (const args of [d1, r2]) {
    assert.ok(args.includes('--local'));
    assert.ok(args.includes('--persist-to'));
    assert.ok(!args.includes('--remote'));
    assert.match(args.join(' '), /gestio\/\.wrangler\/state/);
  }
  await assert.rejects(main(['reset', '--remote']), /extra flags/);
  await assert.rejects(main(['seed', '--remote']), /extra flags/);
});

test('synthetic fixture fits the migrated SQLite constraints and exercises fee states', () => {
  const demo = buildDemoData();
  assert.equal(demo.evidenceKeys.length, 38, '3.5F: two further payment attempts on one registration');
  assert.equal(demo.imageKeys.length, 1, '3.5F: one PNG receipt');
  assert.deepEqual([...demo.png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.match(demo.png.subarray(0, 1024).toString('latin1'), /synthetic/);
  assert.match(demo.pdf.toString('utf8'), /SYNTHETIC DEMO/);
  assert.doesNotMatch(demo.sql, /@[a-z0-9.-]+\.(?:com|es|org)\b/i);
  const emails=[...demo.sql.matchAll(/[a-z0-9._-]+@[a-z0-9.-]+/gi)].map(match=>match[0]);
  assert.ok(emails.length>0);
  assert.ok(emails.every(email=>email.endsWith('@example.test')),'demo recipients must satisfy the existing synthetic notification rule');
  // Validated in-process with node:sqlite. The former python3 variant read the SQL from /dev/stdin,
  // which fails on Linux (ENXIO) because spawnSync gives the child a socket as stdin (CI regression).
  const sql = new DatabaseSync(':memory:');
  let data;
  try {
    sql.exec('PRAGMA foreign_keys=ON');
    for (const name of readdirSync(resolve(repo, 'gestio/migrations')).filter(name => name.endsWith('.sql')).sort())
      sql.exec(readFileSync(resolve(repo, 'gestio/migrations', name), 'utf8'));
    sql.exec(readFileSync(resolve(repo, 'gestio/seed.sql'), 'utf8'));
    sql.exec(demo.sql);
    const q = query => sql.prepare(query).all().map(row => Object.values(row));
    data = { fk: q('PRAGMA foreign_key_check'),
      status: q('SELECT status,count(*) FROM annual_fee_obligation_status GROUP BY status ORDER BY status'),
      family: q('SELECT size,count(*) FROM (SELECT count(*) size FROM annual_fee_family_member GROUP BY group_id) GROUP BY size ORDER BY size'),
      shared: q('SELECT count(*) FROM (SELECT payment_id FROM annual_fee_allocation GROUP BY payment_id HAVING count(*)>1)'),
      installments: q('SELECT count(*) FROM annual_fee_installment_plan'),
      residual: q("SELECT count(*) FROM annual_fee_payment_balance WHERE review_status='VERIFIED' AND unallocated_cents>0"),
      registrations: q('SELECT count(*) FROM activity_registration') };
  } finally { sql.close(); }
  assert.deepEqual(data.fk, []);
  assert.deepEqual(data.status, [['ISSUE', 7], ['PAID', 12], ['PARTIAL', 10], ['PENDING', 11]]);
  assert.deepEqual(data.family, [[2, 3], [3, 4], [4, 3]]);
  assert.deepEqual(data.shared, [[2]]);
  assert.deepEqual(data.installments, [[3]]);
  assert.deepEqual(data.residual, [[1]]);
  assert.deepEqual(data.registrations, [[43]]);
});

// 3.5D (ACTIVITIES.md §21): D1–D12 hold whenever the demo is rebuilt, because dates are relative to seeding.
test('demo activity scenarios are relative to the seed time and cover D1–D12', () => {
  for (const now of [Date.UTC(2026, 8, 30, 1), Date.UTC(2027, 1, 14, 22, 30)]) {
    const demo = buildDemoData({ now });
    const sql = new DatabaseSync(':memory:');
    try {
      sql.exec('PRAGMA foreign_keys=ON');
      for (const name of readdirSync(resolve(repo, 'gestio/migrations')).filter(name => name.endsWith('.sql')).sort())
        sql.exec(readFileSync(resolve(repo, 'gestio/migrations', name), 'utf8'));
      sql.exec(readFileSync(resolve(repo, 'gestio/seed.sql'), 'utf8'));
      sql.exec(demo.sql);
      const one = (query, ...args) => sql.prepare(query).get(...args);
      const activity = code => one('SELECT * FROM activity WHERE public_code=?', code);
      const count = (code, extra = '') => one(`SELECT count(*) n FROM activity_registration r JOIN activity a ON a.id=r.activity_id WHERE a.public_code=?${extra}`, code).n;
      const HOUR = 3600000;
      const general = activity('DEMO-GENERAL-OPEN');
      assert.equal(general.audience, 'GENERAL'); assert.equal(general.status, 'PUBLISHED');
      assert.ok(count('DEMO-GENERAL-OPEN', " AND r.status='NEEDS_PARTICIPANT_REVIEW'") >= 1, 'D1 has a pending review');
      const tropa = activity('DEMO-TROPA-PAID');
      assert.ok(tropa.registration_deadline > now && tropa.registration_deadline - now < 48 * HOUR, 'D2 deadline in under 48h');
      assert.ok(count('DEMO-TROPA-PAID') >= 20, 'D2 has many registrations');
      for (const status of ['CONFIRMED', 'NEEDS_PARTICIPANT_REVIEW', 'AWAITING_PAYMENT_REVIEW', 'REJECTED'])
        assert.ok(count('DEMO-TROPA-PAID', ` AND r.status='${status}'`) >= 1, `D2 ${status}`);
      assert.deepEqual(sql.prepare(`SELECT DISTINCT e.review_status s FROM payment_evidence e JOIN activity_registration r ON r.id=e.registration_id
        WHERE r.activity_id=? ORDER BY 1`).all(tropa.id).map(row => row.s), ['ISSUE', 'PENDING_REVIEW', 'VERIFIED'], 'D12');
      assert.equal(count('DEMO-MANADA-FREE'), 0, 'D3 published without registrations');
      assert.equal(activity('DEMO-NEW-DRAFT').status, 'DRAFT'); assert.equal(count('DEMO-NEW-DRAFT'), 0, 'D4 discardable');
      const late = activity('DEMO-ESCOLTA-DRAFT');
      assert.ok(late.status === 'DRAFT' && late.registration_deadline < now && late.price_cents > 0, 'D5');
      const running = activity('DEMO-CLAN-NOW');
      assert.ok(running.starts_at <= now && now <= running.ends_at, 'D6 in progress');
      const ended = activity('DEMO-ESCOLTA-ENDED');
      assert.ok(ended.status === 'PUBLISHED' && ended.ends_at < now, 'D7 ended, pending close');
      const closed = activity('DEMO-TROPA-PAST');
      assert.ok(closed.status === 'CLOSED' && closed.ends_at < now && count('DEMO-TROPA-PAST') > 0, 'D8');
      assert.ok(one("SELECT count(*) n FROM activity WHERE price_cents=0").n > 0 && one("SELECT count(*) n FROM activity WHERE price_cents>0").n > 0, 'D9');
      const transport = sql.prepare('SELECT code,price_adjustment_cents c FROM activity_transport_option WHERE activity_id=? ORDER BY code')
        .all(activity('DEMO-CLAN-PAID').id).map(row => [row.code, row.c]);
      assert.deepEqual(transport, [['FAMILY', 0], ['GROUP', 300]], 'D10 family transport costs 0 €');
      assert.equal(one('SELECT count(*) n FROM activity_section WHERE activity_id=?', activity('DEMO-MIXED-OPEN').id).n, 2, 'D11 mixed');
      // 3.5F Inscripcions scenarios (REGISTRATIONS.md).
      assert.ok(one("SELECT count(*) n FROM activity_registration WHERE status='WITHDRAWN' AND participant_id IS NULL").n >= 1, 'withdrawn pending request');
      assert.ok(one(`SELECT count(*) n FROM activity_registration r JOIN payment_evidence e ON e.registration_id=r.id
        WHERE r.status='WITHDRAWN' AND e.review_status='VERIFIED'`).n >= 1, 'withdrawn with a verified payment');
      assert.ok(one(`SELECT count(*) n FROM (SELECT participant_id FROM activity_registration WHERE participant_id IS NOT NULL
        GROUP BY activity_id,participant_id HAVING sum(status='WITHDRAWN')>=1 AND sum(status='CONFIRMED')>=1)`).n >= 1, 'new registration after a withdrawal');
      assert.deepEqual(sql.prepare("SELECT escalation_reason r FROM activity_registration WHERE review_level='GLOBAL' ORDER BY 1").all().map(row => row.r),
        ['POSSIBLE_OTHER_SECTION', 'REVIEWER_REQUEST'], 'automatic and manual escalation');
      assert.equal(one('SELECT count(*) n FROM activity_registration WHERE registration_section_id IS NOT submitted_section_id').n,
        one('SELECT count(*) n FROM activity_registration_section_change').n, 'every corrected section has its history');
      assert.ok(one("SELECT count(*) n FROM activity_registration WHERE match_status='RESOLVED' AND reviewed_by IS NOT NULL").n >= 1, 'manual link');
      assert.ok(one("SELECT count(*) n FROM payment_evidence WHERE detected_mime='image/png'").n >= 1, 'image evidence');
      assert.ok(one(`SELECT count(*) n FROM activity_payment_balance b JOIN payment_evidence e ON e.registration_id=b.registration_id
        WHERE b.paid_cents>0 AND b.paid_cents<b.due_cents AND e.review_status='VERIFIED'`).n >= 1, 'partial payment');
      assert.ok(one(`SELECT count(*) n FROM activity_payment_balance b JOIN payment_evidence e ON e.registration_id=b.registration_id
        WHERE b.paid_cents>0 AND b.paid_cents<b.due_cents AND e.review_status='ISSUE'`).n >= 1, 'incidence keeping a verified instalment');
      assert.ok(one(`SELECT count(*) n FROM (SELECT e.registration_id FROM payment_evidence e JOIN activity_payment_balance b ON b.registration_id=e.registration_id
        WHERE b.paid_cents>0 AND b.paid_cents<b.due_cents GROUP BY e.registration_id
        HAVING count(*)>=3 AND sum(e.review_status='ISSUE')>=1 AND sum(e.review_status='VERIFIED')>=2)`).n >= 1, 'several attempts: partial with an open incidence');
      assert.equal(one(`SELECT count(*) n FROM payment_evidence e JOIN activity_payment_balance b ON b.registration_id=e.registration_id
        WHERE e.review_status='VERIFIED' AND b.paid_cents=0`).n, 0, 'every verified proof has its verified amount');
      assert.equal(one(`SELECT count(*) n FROM activity_registration r JOIN activity_payment_balance b ON b.registration_id=r.id
        WHERE r.status='CONFIRMED' AND b.due_cents>0 AND b.paid_cents<b.due_cents`).n, 0, 'confirmed paid registrations are fully paid');
      assert.ok(one("SELECT count(*) n FROM payment_evidence WHERE detected_mime='application/pdf'").n >= 1, 'PDF evidence');
      assert.equal(one("SELECT count(*) n FROM activity_registration WHERE submitted_birth_date IS NOT NULL AND status!='NEEDS_PARTICIPANT_REVIEW'").n, 0);
      assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), []);
      assert.ok(sql.prepare('SELECT created_at FROM activity_registration').all().every(row => row.created_at < now), 'registrations precede the seed');
    } finally { sql.close(); }
  }
});

test('empty local seed, repeat seed, and reset preserve isolation and restore a known state', () => {
  const temp = mkdtempSync(resolve(tmpdir(), 'gestio-demo-test-'));
  const local = resolve(temp, 'gestio');
  try {
    mkdirSync(resolve(local, 'demo'), { recursive: true });
    mkdirSync(resolve(temp, 'node_modules/.bin'), { recursive: true });
    cpSync(resolve(repo, 'gestio/migrations'), resolve(local, 'migrations'), { recursive: true });
    for (const file of ['seed.sql', 'wrangler.toml']) copyFileSync(resolve(repo, 'gestio', file), resolve(local, file));
    for (const file of ['cli.js', 'data.js']) copyFileSync(resolve(repo, 'gestio/demo', file), resolve(local, 'demo', file));
    symlinkSync(wrangler, resolve(temp, 'node_modules/.bin/wrangler'));
    const cli = resolve(local, 'demo/cli.js');
    const seedOutput = run('node', [cli, 'seed'], temp);
    assert.match(seedOutput, /Demo ready:/);
    const db = ['d1', 'execute', 'parpallo-gestio-local', '--local', '--persist-to', resolve(local, '.wrangler/state'),
      '--config', resolve(local, 'wrangler.toml')];
    const query = sql => {
      const output = run(wrangler, [...db, '--command', sql, '--json'], local);
      return JSON.parse(output.slice(output.indexOf('[')))[0].results;
    };
    assert.deepEqual(query('SELECT status,count(*) n FROM annual_fee_obligation_status GROUP BY status ORDER BY status')
      .map(row => [row.status, row.n]), [['ISSUE', 7], ['PAID', 12], ['PARTIAL', 10], ['PENDING', 11]]);
    assert.deepEqual(query('PRAGMA foreign_key_check'), []);
    // 3.5G.1 treasury demo: the cash cycle counts nothing, cash and card expenses once, the proposal not at all.
    assert.deepEqual(query('SELECT income_cents,expense_gross_cents,proposed_expense_cents FROM finance_round_economics'),
      [{ income_cents: 10000, expense_gross_cents: 46000, proposed_expense_cents: 2500 }]);
    query("INSERT INTO participant(id,display_name,current_section_id,status,birth_date) VALUES('00000000-0000-4000-8000-000000099999','Extra Demo','00000000-0000-4000-8000-000000000001','ACTIVE','2017-01-01')");
    run('node', [cli, 'seed'], temp);
    assert.equal(query('SELECT COUNT(*) n FROM participant')[0].n, 41);
    assert.equal(query('SELECT COUNT(*) n FROM audit_event WHERE action=\'DEMO_DATASET_SEEDED\'')[0].n, 1);
    assert.equal(query('SELECT COUNT(*) n FROM annual_fee_payment')[0].n, 19);
    assert.equal(query('SELECT COUNT(*) n FROM finance_movement')[0].n, 7, 'repeat seed adds no treasury data twice');
    assert.match(run('node', [cli, 'reset'], temp), /Demo ready:/);
    assert.equal(query('SELECT COUNT(*) n FROM finance_round')[0].n, 1);
    assert.equal(query('SELECT COUNT(*) n FROM participant')[0].n, 40);
    assert.equal(query('SELECT COUNT(*) n FROM annual_fee_payment')[0].n, 19);
    const html = readFileSync(resolve(repo, 'gestio/public/index.html'), 'utf8');
    const app = readFileSync(resolve(repo, 'gestio/public/views/activities.js'), 'utf8'); // audit M8: activity view module
    assert.match(html, /class="page-header-actions"><button id="newActivity"/);
    assert.equal((html.match(/id="newActivity"/g) || []).length, 1);
    assert.doesNotMatch(html, /id="activityForm"/, '3.5D: the legacy form embedded in the list is gone');
    assert.match(app, /fetchAllPages\(call, '\/api\/activities', 'activities'\)/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
