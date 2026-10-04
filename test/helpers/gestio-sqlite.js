// Shared in-memory D1 stand-in for fast Gestió tests: all migrations + synthetic seed on node:sqlite.
// Real workerd/D1 behaviour is covered separately by the Wrangler smoke suite.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../../gestio/worker.js';
import { newSession } from '../../gestio/src/auth.js';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const migrations = join(root, 'gestio/migrations');
export const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');

export function d1(sql) {
  return {
    prepare(query) {
      let params = [];
      const statement = {
        bind(...values) { params = values; return statement; },
        async first() { return sql.prepare(query).get(...params) ?? null; },
        async all() { return { results: sql.prepare(query).all(...params) }; },
        async run() { return { meta: { changes: sql.prepare(query).run(...params).changes } }; },
        execute() { return sql.prepare(query).run(...params); }
      };
      return statement;
    },
    async batch(statements) {
      sql.exec('BEGIN');
      try { const result = statements.map(statement => statement.execute()); sql.exec('COMMIT'); return result; }
      catch (error) { sql.exec('ROLLBACK'); throw error; }
    }
  };
}

export function fixture({ seed = true } = {}) {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  for (const name of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort())
    sql.exec(readFileSync(join(migrations, name), 'utf8'));
  if (seed) sql.exec(readFileSync(join(root, 'gestio/seed.sql'), 'utf8'));
  const db = d1(sql);
  const context = {}, token = {};
  const objects = new Map();
  const storage = {
    async put(key, bytes) { objects.set(key, Uint8Array.from(bytes)); },
    async get(key) { const bytes = objects.get(key); return bytes ? { body: bytes } : null; },
    async head(key) { return objects.has(key) ? { key } : null; },
    async delete(key) { objects.delete(key); }
  };
  return {
    sql, db, context, token, storage,
    async login(number) {
      token[number] = (await newSession(db, id(number))).token;
      const session = sql.prepare('SELECT id FROM app_session WHERE user_id=? ORDER BY created_at DESC LIMIT 1').get(id(number));
      context[number] = { userId: id(number), sessionId: session.id, status: 'ACTIVE' };
    },
    async request(number, path, { method = 'GET', body, env = {} } = {}) {
      const response = await worker.fetch(new Request('http://127.0.0.1:8788' + path, {
        method,
        headers: { Cookie: `gestio_session=${token[number]}`, ...(method !== 'GET' ? { Origin: 'http://127.0.0.1:8788' } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
      }), { DB: db, EVIDENCE_STORAGE: storage, APP_ENV: 'development', DEV_IDENTITY_PROVIDER: 'enabled', ...env });
      const text = await response.text();
      let data = null; try { data = JSON.parse(text); } catch { data = text; }
      return { status: response.status, data, headers: response.headers };
    },
    denials(number) {
      return sql.prepare("SELECT count(*) AS n FROM audit_event WHERE actor_user_id=? AND action='AUTHZ_DENY'").get(id(number)).n;
    },
    close() { sql.close(); }
  };
}
