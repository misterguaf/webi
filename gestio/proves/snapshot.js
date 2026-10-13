// Gestió «proves»: build-time snapshot of the synthetic demo and the plan that restores it.
// Runs in Node only (deploy and nightly reset preparation). The demo is built exactly like `npm run demo:reset`
// (all migrations + seed.sql + demo + treasury demos) on node:sqlite, then turned into ordered SQL:
// drop triggers → delete rows (children first) → insert rows (parents first) → recreate triggers.
// The plan is packed into small batches so that each nightly cron invocation stays inside D1/Workers free limits.
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDemoData, buildTreasuryDemo, buildTreasuryEvidenceBackfill, buildTreasuryIncomeDemo, buildTreasuryOperationsDemo,
  TREASURY_DEMO_ROUND_ID, TREASURY_INCOME_MARKER_ID, TREASURY_OPERATIONS_MARKER_ID } from '../demo/data.js';

const gestio = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(gestio, 'migrations');

// D1 limits (free plan): 100 KB per statement, 50 queries per invocation. Margins kept on purpose.
export const LIMITS = Object.freeze({ statementBytes: 90_000, rowsPerInsert: 400, statementsPerBatch: 40, batchBytes: 900_000 });

export function migrationNames() {
  return readdirSync(migrationsDir).filter(name => name.endsWith('.sql')).sort();
}

/** The demo database, built as `npm run demo:reset` builds it. */
export function buildDemoDatabase({ now = Date.now() } = {}) {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  for (const name of migrationNames()) sql.exec(readFileSync(join(migrationsDir, name), 'utf8'));
  sql.exec(readFileSync(join(gestio, 'seed.sql'), 'utf8'));
  const demo = buildDemoData({ now });
  sql.exec(demo.sql);
  const has = query => !!sql.prepare(query).get();
  sql.exec(buildTreasuryDemo());
  if (!has(`SELECT 1 FROM finance_movement WHERE id='${TREASURY_OPERATIONS_MARKER_ID}'`) &&
      has(`SELECT 1 FROM finance_round WHERE id='${TREASURY_DEMO_ROUND_ID}' AND status='OPEN'`)) sql.exec(buildTreasuryOperationsDemo());
  if (!has(`SELECT 1 FROM finance_income WHERE id='${TREASURY_INCOME_MARKER_ID}'`) &&
      has(`SELECT 1 FROM finance_movement WHERE id='${TREASURY_OPERATIONS_MARKER_ID}' AND allocation_version=0`)) sql.exec(buildTreasuryIncomeDemo());
  const missing = [21301, 21302, 22301, 22302].filter(number => has(`SELECT 1 FROM finance_expense
    WHERE id='00000000-0000-4000-8000-${String(number).padStart(12, '0')}' AND NOT EXISTS(
      SELECT 1 FROM finance_expense_evidence WHERE expense_id=finance_expense.id AND object_purged_at IS NULL)`));
  if (missing.length) sql.exec(buildTreasuryEvidenceBackfill(missing));
  if (sql.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Demo snapshot has foreign-key violations');
  return { sql, demo };
}

const quoteId = name => `"${name.replaceAll('"', '""')}"`;
function literal(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('Non-finite number in snapshot'); return String(value); }
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString('hex')}'`;
  if (typeof value === 'string') {
    if (value.includes('\u0000')) throw new Error('NUL in snapshot string');
    return `'${value.replaceAll("'", "''")}'`;
  }
  throw new Error(`Unsupported value in snapshot: ${typeof value}`);
}

/** Parents before children (foreign keys); self references are allowed (rows keep their rowid order). */
export function topologicalTables(sql, tables) {
  const parents = new Map(tables.map(table => [table, new Set(sql.prepare(`PRAGMA foreign_key_list(${quoteId(table)})`).all()
    .map(row => row.table).filter(parent => parent !== table && tables.includes(parent)))]));
  const ordered = [], state = new Map();
  const visit = (table, path) => {
    if (state.get(table) === 'done') return;
    if (state.get(table) === 'visiting') throw new Error(`Foreign-key cycle: ${[...path, table].join(' → ')}`);
    state.set(table, 'visiting');
    for (const parent of [...parents.get(table)].sort()) visit(parent, [...path, table]);
    state.set(table, 'done'); ordered.push(table);
  };
  for (const table of [...tables].sort()) visit(table, []);
  return ordered;
}

function insertStatements(sql, table) {
  const columns = sql.prepare(`PRAGMA table_info(${quoteId(table)})`).all().map(column => column.name);
  const withoutRowid = /WITHOUT\s+ROWID/i.test(sql.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table).sql);
  const rows = sql.prepare(`SELECT ${columns.map(quoteId).join(',')} FROM ${quoteId(table)}${withoutRowid ? '' : ' ORDER BY rowid'}`);
  rows.setReadBigInts?.(true);
  const head = `INSERT INTO ${quoteId(table)}(${columns.map(quoteId).join(',')}) VALUES `;
  const statements = [];
  let values = [], size = head.length;
  const flush = () => { if (values.length) statements.push(head + values.join(',')); values = []; size = head.length; };
  for (const row of rows.iterate()) {
    const tuple = `(${columns.map(column => literal(row[column])).join(',')})`;
    if (head.length + tuple.length > LIMITS.statementBytes) throw new Error(`Row too large for one D1 statement in ${table}`);
    if (values.length >= LIMITS.rowsPerInsert || size + tuple.length + 1 > LIMITS.statementBytes) flush();
    values.push(tuple); size += tuple.length + 1;
  }
  flush();
  return statements;
}

/** Ordered statements that turn any database with the same schema into the demo snapshot. */
export function restorePlan(sql) {
  const tables = sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
  const ordered = topologicalTables(sql, tables);
  const triggers = sql.prepare("SELECT name, sql FROM sqlite_master WHERE type='trigger' ORDER BY name").all();
  const counts = Object.fromEntries(ordered.map(table => [table, Number(sql.prepare(`SELECT count(*) AS n FROM ${quoteId(table)}`).get().n)]));
  const creates = triggers.map(trigger => {
    const statement = trigger.sql.replace(/^\s*CREATE\s+TRIGGER\s+(?!IF\s+NOT\s+EXISTS)/i, 'CREATE TRIGGER IF NOT EXISTS ');
    if (statement === trigger.sql && !/IF\s+NOT\s+EXISTS/i.test(statement)) throw new Error(`Unexpected trigger SQL: ${trigger.name}`);
    return statement;
  });
  return {
    tables: ordered, counts, triggers: triggers.map(trigger => trigger.name),
    drops: triggers.map(trigger => `DROP TRIGGER IF EXISTS ${quoteId(trigger.name)}`),
    deletes: [...ordered].reverse().map(table => `DELETE FROM ${quoteId(table)}`),
    inserts: ordered.flatMap(table => insertStatements(sql, table)),
    creates
  };
}

/** Packs statements into batches; every batch starts by deferring foreign keys to its commit. */
export function packBatches(statements) {
  const batches = [];
  let current = [], bytes = 0;
  for (const statement of statements) {
    if (current.length && (current.length + 1 >= LIMITS.statementsPerBatch || bytes + statement.length > LIMITS.batchBytes)) {
      batches.push(current); current = []; bytes = 0;
    }
    current.push(statement); bytes += statement.length;
  }
  if (current.length) batches.push(current);
  return batches;
}

export function buildProvesSnapshot({ now = Date.now() } = {}) {
  const built = buildDemoDatabase({ now });
  try { return snapshotFrom(built); } finally { built.sql.close(); }
}

/** The snapshot of an already built demo database (left open for the caller). */
export function snapshotFrom({ sql, demo }) {
  {
    const plan = restorePlan(sql);
    const statements = [...plan.drops, ...plan.deletes, ...plan.inserts, ...plan.creates];
    const migrations = migrationNames();
    // Tables whose rows point at stored evidence: the placeholder storage reads the detected type from them.
    const evidenceTables = plan.tables.filter(table => {
      const columns = sql.prepare(`PRAGMA table_info(${quoteId(table)})`).all().map(column => column.name);
      return columns.includes('object_key') && columns.includes('detected_mime');
    });
    return {
      id: `${migrations.at(-1)}:${createHash('sha256').update(JSON.stringify(statements)).digest('hex').slice(0, 16)}`,
      evidenceTables,
      latestMigration: migrations.at(-1), migrations: migrations.length,
      tables: plan.tables, triggers: plan.triggers, counts: plan.counts,
      rows: Object.values(plan.counts).reduce((sum, n) => sum + n, 0),
      batches: packBatches(statements),
      placeholders: { pdf: Buffer.from(demo.pdf).toString('base64'), png: Buffer.from(demo.png).toString('base64') }
    };
  }
}

/** One SQL file for `wrangler d1 execute --remote --file` (first load and manual reset from a computer). */
export function restoreSqlFile(snapshot) {
  return ['PRAGMA defer_foreign_keys = true;', ...snapshot.batches.flat().map(statement => `${statement};`), ''].join('\n');
}
