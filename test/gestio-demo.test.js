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
  assert.equal(demo.evidenceKeys.length, 26);
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
  assert.deepEqual(data.registrations, [[16]]);
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
    query("INSERT INTO participant(id,display_name,current_section_id,status,birth_date) VALUES('00000000-0000-4000-8000-000000099999','Extra Demo','00000000-0000-4000-8000-000000000001','ACTIVE','2017-01-01')");
    run('node', [cli, 'seed'], temp);
    assert.equal(query('SELECT COUNT(*) n FROM participant')[0].n, 41);
    assert.equal(query('SELECT COUNT(*) n FROM audit_event WHERE action=\'DEMO_DATASET_SEEDED\'')[0].n, 1);
    assert.equal(query('SELECT COUNT(*) n FROM annual_fee_payment')[0].n, 19);
    assert.match(run('node', [cli, 'reset'], temp), /Demo ready:/);
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
