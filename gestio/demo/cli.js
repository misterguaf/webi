import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDemoData, buildTreasuryDemo, buildTreasuryEvidenceBackfill, buildTreasuryIncomeDemo, buildTreasuryOperationsDemo, demoPdf, treasuryExpenseEvidenceKeys,
  DEMO_MARKER_ID, TREASURY_DEMO_ROUND_ID, TREASURY_INCOME_MARKER_ID, TREASURY_OPERATIONS_MARKER_ID } from './data.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(root, '..');
const state = resolve(root, '.wrangler', 'state');
const wrangler = resolve(repo, 'node_modules', '.bin', 'wrangler');
const database = 'parpallo-gestio-local';
const bucket = 'parpallo-evidence-local';
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
for (const key of Object.keys(env)) if (/^(CLOUDFLARE_|CF_|WRANGLER_API_TOKEN|WRANGLER_ACCOUNT_ID)/.test(key)) delete env[key];

export function assertLocalConfig(config, nodeEnv = process.env) {
  const required = [
    /^name\s*=\s*"parpallo-gestio-local"\s*$/m,
    /^APP_ENV\s*=\s*"development"\s*$/m,
    /^DEV_IDENTITY_PROVIDER\s*=\s*"enabled"\s*$/m,
    /^database_name\s*=\s*"parpallo-gestio-local"\s*$/m,
    /^database_id\s*=\s*"00000000-0000-0000-0000-000000000001"\s*$/m,
    /^bucket_name\s*=\s*"parpallo-evidence-local"\s*$/m
  ];
  if (required.some(pattern => !pattern.test(config)) ||
      nodeEnv.APP_ENV === 'production' || nodeEnv.NODE_ENV === 'production' ||
      /\[env\.|\bremote\s*=\s*true\b/i.test(config)) {
    throw new Error('Demo commands require the exact local development D1/R2 configuration');
  }
}
export function localD1Args(commandArgs) {
  return ['d1', ...commandArgs, database, '--local', '--persist-to', state, '--config', resolve(root, 'wrangler.toml')];
}
export function localR2Args(key, file, contentType = 'application/pdf') {
  return ['r2', 'object', 'put', `${bucket}/${key}`, '--file', file, '--content-type', contentType,
    '--local', '--persist-to', state, '--config', resolve(root, 'wrangler.toml')];
}
function assertStatePath() {
  if (state !== resolve(root, '.wrangler', 'state')) throw new Error('Unsafe local state path');
  for (const path of [resolve(root, '.wrangler'), state]) {
    try { if (lstatSync(path).isSymbolicLink()) throw new Error(`Symlink refused: ${path}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
function assertPortFree() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', error => reject(error.code === 'EADDRINUSE'
      ? new Error('Stop the local Gestió server on 127.0.0.1:8788 before demo:seed or demo:reset') : error));
    server.listen(8788, '127.0.0.1', () => server.close(error => error ? reject(error) : resolvePort()));
  });
}
function run(args, { capture = false } = {}) {
  const result = spawnSync(wrangler, args, { cwd: root, env, encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`Local Wrangler command failed: ${result.error?.message || result.stderr || result.status}`);
  return result.stdout;
}
function execute(sql) {
  const raw = run(localD1Args(['execute', '--command', sql, '--json']), { capture: true });
  const parsed = JSON.parse(raw.slice(raw.indexOf('[')));
  return parsed[0]?.results || [];
}
function count(table) { return execute(`SELECT COUNT(*) AS n FROM ${table}`)[0].n; }
function markerExists() { return execute(`SELECT COUNT(*) AS n FROM audit_event WHERE id='${DEMO_MARKER_ID}'`)[0].n > 0; }
const canonicalBase = {app_user:7,participant:5,section:4,activity:5,activity_registration:2,
  annual_fee_round:1,annual_fee_obligation:0,annual_fee_payment:0,annual_fee_family_group:0};
function baseCounts() { return Object.fromEntries(Object.keys(canonicalBase).map(table => [table, count(table)])); }
function assertCanonicalBase(actual) {
  if (Object.keys(canonicalBase).some(table => actual[table] !== canonicalBase[table])) {
    throw new Error(`Existing local D1 is not the canonical seed (${JSON.stringify(actual)}). Use npm run demo:reset to rebuild it.`);
  }
}
function verify(expected) {
  const mapping = {participants:'participant',activities:'activity',registrations:'activity_registration',
    rounds:'annual_fee_round',obligations:'annual_fee_obligation',payments:'annual_fee_payment'};
  for (const [label, table] of Object.entries(mapping)) if (count(table) < expected[label]) throw new Error(`Incomplete demo: ${label}`);
  if (execute('PRAGMA foreign_key_check').length) throw new Error('Demo has foreign-key violations');
  if (execute('SELECT COUNT(*) AS n FROM annual_fee_family_correction_gate')[0].n) throw new Error('Open family correction gate');
  if (!markerExists()) throw new Error('Demo marker missing');
}
// 3.5G.1: the treasury demo is applied once, also to a local D1 that already holds the earlier demo.
// 3.5G.2A: the operations demo is added on top the same way (once, keyed by its first movement).
function applySql(prefix, sqlText) {
  const temporary = mkdtempSync(resolve(tmpdir(), prefix));
  try {
    const sql = resolve(temporary, 'treasury.sql');
    writeFileSync(sql, sqlText);
    run(localD1Args(['execute', '--file', sql, '--yes']), { capture: true });
  } finally { rmSync(temporary, { recursive: true, force: true }); }
  if (execute('PRAGMA foreign_key_check').length) throw new Error('Treasury demo has foreign-key violations');
}
function putTreasuryReceipts(numbers) {
  const temporary = mkdtempSync(resolve(tmpdir(), 'gestio-expense-receipts-'));
  try {
    const pdf = resolve(temporary, 'synthetic-receipt.pdf');
    writeFileSync(pdf, demoPdf());
    for (const key of treasuryExpenseEvidenceKeys(numbers)) run(localR2Args(key, pdf), { capture: true });
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
function ensureTreasuryDemo() {
  let added = false;
  if (count('finance_round') === 0) { putTreasuryReceipts([21301, 21302]); applySql('gestio-treasury-demo-', buildTreasuryDemo()); added = true; }
  if (!execute(`SELECT 1 AS present FROM finance_movement WHERE id='${TREASURY_OPERATIONS_MARKER_ID}'`).length &&
      execute(`SELECT 1 AS present FROM finance_round WHERE id='${TREASURY_DEMO_ROUND_ID}' AND status='OPEN'`).length) {
    putTreasuryReceipts([22301, 22302]); applySql('gestio-treasury-ops-demo-', buildTreasuryOperationsDemo()); added = true;
  }
  // 3.5G.2A income extension: needs the operations demo (its lines and movements) and is added once.
  if (!execute(`SELECT 1 AS present FROM finance_income WHERE id='${TREASURY_INCOME_MARKER_ID}'`).length &&
      execute(`SELECT 1 AS present FROM finance_movement WHERE id='${TREASURY_OPERATIONS_MARKER_ID}' AND allocation_version=0`).length) {
    applySql('gestio-treasury-income-demo-', buildTreasuryIncomeDemo()); added = true;
  }
  // Existing local G.2A demos may predate mandatory expense receipts. Backfill only their fixed
  // synthetic records; repeat seeding leaves already populated receipt metadata untouched.
  const missingReceipts = [21301, 21302, 22301, 22302].filter(number => execute(`SELECT 1 AS present FROM finance_expense
    WHERE id='00000000-0000-4000-8000-${String(number).padStart(12, '0')}' AND NOT EXISTS(
      SELECT 1 FROM finance_expense_evidence WHERE expense_id=finance_expense.id AND object_purged_at IS NULL)`).length);
  if (missingReceipts.length) {
    putTreasuryReceipts(missingReceipts);
    applySql('gestio-treasury-receipts-', buildTreasuryEvidenceBackfill(missingReceipts));
    added = true;
  }
  return added;
}
function seed() {
  run(localD1Args(['migrations', 'apply']), { capture: true });
  const demo = buildDemoData();
  if (markerExists()) {
    verify(demo.expected);
    const added = ensureTreasuryDemo();
    console.log(added ? 'Demo dataset already present; treasury demo added.' : 'Demo dataset already present; left existing local changes untouched.');
    return;
  }
  let base = baseCounts();
  // Sections are reference data created by migration 0012; "empty" means no people or business rows.
  if (Object.entries(base).every(([table, value]) => table === 'section' || value === 0)) {
    run(localD1Args(['execute', '--file', resolve(root, 'seed.sql'), '--yes']), { capture: true });
    base = baseCounts();
  }
  assertCanonicalBase(base);
  const temporary = mkdtempSync(resolve(tmpdir(), 'gestio-demo-'));
  try {
    const pdf = resolve(temporary, 'synthetic-evidence.pdf');
    const sql = resolve(temporary, 'demo.sql');
    const png = resolve(temporary, 'synthetic-evidence.png');
    writeFileSync(pdf, demo.pdf);
    writeFileSync(png, demo.png);
    writeFileSync(sql, demo.sql);
    for (const key of demo.evidenceKeys) run(localR2Args(key, pdf), { capture: true });
    for (const key of demo.imageKeys) run(localR2Args(key, png, 'image/png'), { capture: true });
    run(localD1Args(['execute', '--file', sql, '--yes']), { capture: true });
    verify(demo.expected);
    ensureTreasuryDemo();
    console.log(`Demo ready: ${demo.expected.participants} participants, ${demo.expected.activities} activities, ${demo.expected.obligations} annual fee obligations.`);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
export async function main(args = process.argv.slice(2)) {
  if (args.length !== 1 || !['seed', 'reset'].includes(args[0])) throw new Error('Use exactly demo:seed or demo:reset; extra flags are refused');
  assertLocalConfig(readFileSync(resolve(root, 'wrangler.toml'), 'utf8'));
  assertStatePath();
  if (!existsSync(wrangler)) throw new Error('Run npm ci first');
  await assertPortFree();
  if (args[0] === 'reset') {
    rmSync(state, { recursive: true, force: true });
    run(localD1Args(['migrations', 'apply']), { capture: true });
    run(localD1Args(['execute', '--file', resolve(root, 'seed.sql'), '--yes']), { capture: true });
  }
  seed();
}
if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
