// Gestió «proves» runtime (gestioproves.grupscoutparpallo.com). It wraps the unchanged Gestió Worker with:
// 1. an Access gate: every request must carry a valid Cloudflare Access JWT (defence in depth behind the
//    Access e-mail allow-list configured at the edge);
// 2. placeholder evidence storage: no R2 bucket; uploads are validated by Gestió and then discarded, and
//    «view proof» always returns a fictitious placeholder of the right kind;
// 3. a nightly reset to the demo snapshot, one small batch per cron invocation (D1/Workers free limits),
//    with Gestió answering 503 «maintenance» while it runs. Data stays synthetic (DATA_MODE = SYNTHETIC_ONLY).
import { verifyAccessJwt } from '../src/auth.js';

const STATE_TABLE = 'proves_reset_state';
const JWKS_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const text = (body, status, headers = {}) => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8',
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow, noarchive', ...headers } });
const json = (data, status) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Retry-After': '600' } });
const decode = base64 => Uint8Array.from(atob(base64), char => char.charCodeAt(0));

/** Configuration this runtime accepts: the production runtime declared as STAGING with Access and the demo selector. */
export function provesConfigured(env) {
  return env?.APP_ENV === 'production' && env.DEPLOYMENT_ENVIRONMENT === 'STAGING' && env.STAGING_DEMO_LOGIN === 'enabled' &&
    typeof env.ACCESS_ISSUER === 'string' && /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_ISSUER) &&
    typeof env.ACCESS_AUDIENCE === 'string' && /^[a-f0-9]{64}$/.test(env.ACCESS_AUDIENCE) && !!env.DB && !env.EVIDENCE_STORAGE;
}

export function createAccessGate({ fetchImpl = (input, init) => fetch(input, init), now = () => Date.now() } = {}) {
  let cached = null;
  async function jwks(issuer, refresh) {
    if (!refresh && cached && cached.issuer === issuer && now() - cached.at < JWKS_TTL_MS) return cached.keys;
    const response = await fetchImpl(new URL('/cdn-cgi/access/certs', issuer), { redirect: 'error' });
    if (!response.ok) throw new Error('JWKS unavailable');
    cached = { issuer, keys: await response.json(), at: now() };
    return cached.keys;
  }
  return async function verify(request, env) {
    const token = request.headers.get('Cf-Access-Jwt-Assertion');
    if (!token) return false;
    const options = { issuer: env.ACCESS_ISSUER, audience: env.ACCESS_AUDIENCE, now: now() };
    try { await verifyAccessJwt(token, { ...options, jwks: await jwks(env.ACCESS_ISSUER, false) }); return true; }
    catch {
      // Access rotates its signing keys: refresh once before refusing.
      try { await verifyAccessJwt(token, { ...options, jwks: await jwks(env.ACCESS_ISSUER, true) }); return true; }
      catch { return false; }
    }
  };
}

/** R2 stand-in: nothing is stored or read back; the evidence type comes from the D1 row (never the client). */
export function placeholderStorage(db, snapshot) {
  const pdf = decode(snapshot.placeholders.pdf), png = decode(snapshot.placeholders.png);
  async function isImage(key) {
    if (/\.(png|jpe?g|webp)$/i.test(key)) return true;
    if (/\.pdf$/i.test(key)) return false;
    for (const table of snapshot.evidenceTables) {
      const row = await db.prepare(`SELECT detected_mime AS mime FROM "${table}" WHERE object_key=?`).bind(key).first();
      if (row) return String(row.mime).startsWith('image/');
    }
    return false;
  }
  return {
    async put(key) { return { key }; },
    async head(key) { return { key }; },
    async get(key) { return { key, body: (await isImage(key)) ? png : pdf }; },
    async delete() {}
  };
}

async function ensureState(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS ${STATE_TABLE}(id INTEGER PRIMARY KEY CHECK(id=1), status TEXT NOT NULL,
    snapshot_id TEXT, next_batch INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, fingerprint TEXT,
    started_day TEXT, started_at INTEGER, finished_at INTEGER, last_error TEXT)`).run();
  await db.prepare(`INSERT OR IGNORE INTO ${STATE_TABLE}(id,status) VALUES (1,'IDLE')`).run();
  return db.prepare(`SELECT * FROM ${STATE_TABLE} WHERE id=1`).first();
}

export async function resetRunning(db) {
  try { return (await db.prepare(`SELECT status FROM ${STATE_TABLE} WHERE id=1`).first())?.status === 'RUNNING'; }
  catch { return false; }
}

/** Changes since the last reset. Every write needs a Gestió session and every sign-in creates one, so the sessions
 * (count and newest rowid) plus the newest audit event reveal any use. Shallow on purpose: D1 refuses deep
 * expressions and long compound SELECTs. */
async function fingerprint(db, snapshot) {
  const row = await db.prepare(`SELECT (SELECT count(*) FROM app_session) AS sessions, (SELECT coalesce(max(rowid),0) FROM app_session) AS session,
    (SELECT coalesce(max(rowid),0) FROM audit_event) AS audit`).first();
  return `${snapshot.id}|${row.sessions}:${row.session}:${row.audit}`;
}

/** One cron tick (every minute of the reset hour): start once per UTC day if anything changed, else advance one batch. */
export async function resetTick(db, snapshot, now = Date.now()) {
  const state = await ensureState(db);
  const day = new Date(now).toISOString().slice(0, 10);
  if (state.status !== 'RUNNING') {
    if (state.started_day === day) return { action: 'idle' };
    const latest = await db.prepare('SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1').first().catch(() => null);
    if (latest?.name !== snapshot.latestMigration) {
      await db.prepare(`UPDATE ${STATE_TABLE} SET started_day=?, last_error=? WHERE id=1`).bind(day, 'schema_mismatch').run();
      console.error('proves reset skipped: schema mismatch', { remote: latest?.name ?? null, snapshot: snapshot.latestMigration });
      return { action: 'schema_mismatch' };
    }
    if (state.fingerprint && state.fingerprint === await fingerprint(db, snapshot)) {
      await db.prepare(`UPDATE ${STATE_TABLE} SET started_day=? WHERE id=1`).bind(day).run();
      return { action: 'unchanged' };
    }
    await db.prepare(`UPDATE ${STATE_TABLE} SET status='RUNNING', snapshot_id=?, next_batch=0, attempts=0, started_day=?, started_at=?,
      finished_at=NULL, last_error=NULL WHERE id=1`).bind(snapshot.id, day, now).run();
    return { action: 'started' };
  }
  if (state.snapshot_id !== snapshot.id) {
    // A deploy changed the snapshot mid-reset: start again with the new plan.
    await db.prepare(`UPDATE ${STATE_TABLE} SET snapshot_id=?, next_batch=0, attempts=0 WHERE id=1`).bind(snapshot.id).run();
    return { action: 'restarted' };
  }
  const index = Number(state.next_batch);
  if (index >= snapshot.batches.length) return finish(db, snapshot, now);
  try {
    await db.batch([db.prepare('PRAGMA defer_foreign_keys = true'), ...snapshot.batches[index].map(statement => db.prepare(statement)),
      db.prepare(`UPDATE ${STATE_TABLE} SET next_batch=?, attempts=0 WHERE id=1`).bind(index + 1)]);
  } catch (error) {
    const attempts = Number(state.attempts) + 1;
    await db.prepare(`UPDATE ${STATE_TABLE} SET attempts=?, last_error=? WHERE id=1`).bind(attempts, `batch ${index}: ${String(error?.message ?? error).slice(0, 300)}`).run();
    console.error('proves reset batch failed', { index, attempts });
    if (attempts >= MAX_ATTEMPTS) throw error;
    return { action: 'retry', batch: index };
  }
  if (index + 1 >= snapshot.batches.length) return finish(db, snapshot, now);
  return { action: 'batch', batch: index };
}

async function finish(db, snapshot, now) {
  await db.prepare(`UPDATE ${STATE_TABLE} SET status='IDLE', next_batch=0, finished_at=?, fingerprint=? WHERE id=1`)
    .bind(now, await fingerprint(db, snapshot)).run();
  return { action: 'finished' };
}

export function createProvesWorker({ app, snapshot, verifyAccess = createAccessGate() }) {
  return {
    async fetch(request, env, ctx) {
      if (!provesConfigured(env)) return text('Configuració de l’entorn de proves incompleta.', 500);
      if (!await verifyAccess(request, env)) return text('Accés restringit. Entra des de gestioproves.grupscoutparpallo.com amb un correu autoritzat.', 403);
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/') && await resetRunning(env.DB))
        return json({ error: 'maintenance', message: 'L’entorn de proves s’està reiniciant amb les dades de demostració. Torna-ho a provar d’ací a uns minuts.' }, 503);
      return app.fetch(request, { ...env, EVIDENCE_STORAGE: placeholderStorage(env.DB, snapshot) }, ctx);
    },
    async scheduled(controller, env) {
      if (!provesConfigured(env)) throw new Error('proves configuration incomplete');
      const result = await resetTick(env.DB, snapshot, controller.scheduledTime ?? Date.now());
      if (result.action !== 'idle') console.log('proves reset', result);
    }
  };
}
