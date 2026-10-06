// FASE 3.5I — global integration of the Gestió shell: pages offered only when usable, deep links to unusable pages
// land on Inici, access changes while Gestió is open never leave stale protected screens, session end dismisses every
// overlay, async buttons cannot double-submit, and client errors are human sentences (never raw codes).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { accessKey, createSessionSync } from '../gestio/public/session-sync.js';
import { createViewRegistry } from '../gestio/public/view-registry.js';
import { humanError } from '../gestio/public/http.js';

const source = file => readFileSync(join(import.meta.dirname, '..', 'gestio/public', file), 'utf8');
const me = (id, caps = { participants: { read: { all: true } } }) => ({ user: { id, status: 'ACTIVE' }, roles: [], capabilities: caps });

test('session sync: same access → nothing; changed capabilities → screens reloaded; another user → full reset; throttled unless forced', async () => {
  let time = 0, live = me('u1'), server = me('u1');
  const events = [];
  const sync = createSessionSync({ fetchMe: async () => server, current: () => live, now: () => time, minIntervalMs: 30_000,
    onChanged: next => { events.push(['changed', next.capabilities]); live = next; }, onUserChanged: () => { events.push(['user']); live = null; } });
  await sync.check();
  assert.deepEqual(events, [], 'unchanged access does nothing');
  server = me('u1', { participants: { read: null } });
  time = 10_000; await sync.check();
  assert.deepEqual(events, [], 'throttled on navigation');
  await sync.check({ force: true });
  assert.deepEqual(events, [['changed', { participants: { read: null } }]], 'a forced check (tab visible, 403) applies the change');
  server = me('u2'); time = 100_000; await sync.check();
  assert.deepEqual(events.at(-1), ['user'], 'another person → full reset');
  // Signed out, or the request fails (a 401 is handled by the client): nothing else happens.
  live = null; await sync.check({ force: true });
  live = me('u1'); const failing = createSessionSync({ fetchMe: async () => { throw Object.assign(new Error('x'), { status: 401 }); }, current: () => live,
    onChanged: () => events.push(['bad']), onUserChanged: () => events.push(['bad']) });
  await failing.check({ force: true });
  assert.ok(!events.some(event => event[0] === 'bad'));
  assert.notEqual(accessKey(me('u1')), accessKey(me('u1', {})), 'capabilities are part of the fingerprint');
});

test('pages are offered only when one of their views is available', () => {
  const view = (id, page, available) => ({ id, page, available: () => available, load() {}, unload() {} });
  const registry = createViewRegistry([view('dashboard', 'inici', true), view('fees', 'quotes', false), view('fee-status', 'quotes', true),
    view('participants', 'participants', false), view('treasury', 'tresoreria', false)]);
  assert.deepEqual([...registry.availablePages({})].sort(), ['inici', 'quotes']);
  const shell = source('shell.js'), app = source('app.js');
  assert.match(shell, /if\(!pageAvailable\(route\.page\)\)\{router\.go\(\{page:'inici'\},\{replace:true\}\);return\}/, 'deep links to unusable pages land on Inici');
  assert.match(shell, /pages\.filter\(page=>pageAvailable\(page\.id\)/, 'search only offers usable pages');
  assert.match(shell, /mobilePrimary=new Set\(MOBILE_PRIORITY\.filter\(id=>pageAvailable\(id\)\)\.slice\(0,4\)\)/, 'mobile bar: first four usable pages');
  assert.match(app, /setAvailablePages\(views\.availablePages\(me\.capabilities\)\); setShellSession\(me\)/, 'availability is set before the route is shown');
  assert.match(app, /onForbidden: \(\) => void sync\.check\(\{ force: true \}\)/);
  assert.match(app, /visibilityState === 'visible'\) void sync\.check\(\{ force: true \}\)/);
  assert.match(app, /dismissOverlays\(\); views\.unloadAll\(\)/, 'session end dismisses overlays before unloading screens');
});

test('async buttons are busy until settled (no double submit); overlays are dismissed at session end', async () => {
  const original = globalThis.document;
  const classes = new Set(['drawer-open']);
  globalThis.document = { body: { classList: { remove: name => classes.delete(name) } } };
  try {
    const { guardBusy, trackOverlay, dismissOverlays } = await import('../gestio/public/ui.js');
    const attributes = new Map(), node = { getAttribute: name => attributes.get(name) ?? null, setAttribute: (name, value) => attributes.set(name, value),
      removeAttribute: name => attributes.delete(name) };
    let calls = 0, release;
    const click = guardBusy(node, () => { calls++; return new Promise(resolve => { release = resolve; }); });
    click({ preventDefault() {} }); click({ preventDefault() {} });
    assert.equal(calls, 1, 'a second click while busy is ignored');
    assert.equal(attributes.get('aria-busy'), 'true');
    release(); await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(attributes.has('aria-busy'), false);
    click({ preventDefault() {} }); assert.equal(calls, 2, 'usable again once settled');
    const plain = new Map(), other = { getAttribute: name => plain.get(name) ?? null, setAttribute: (name, value) => plain.set(name, value), removeAttribute: name => plain.delete(name) };
    const sync = guardBusy(other, () => 'done'); assert.equal(sync({}), 'done'); assert.equal(plain.has('aria-busy'), false, 'synchronous handlers are untouched');
    const dismissed = [];
    const untrack = trackOverlay(() => dismissed.push('a')); trackOverlay(() => dismissed.push('b'));
    untrack();
    dismissOverlays();
    assert.deepEqual(dismissed, ['b'], 'only overlays still open are dismissed');
    assert.equal(classes.has('drawer-open'), false);
  } finally { globalThis.document = original; }
  for (const file of ['ui.js', 'views/participants.js', 'views/registrations/evidence.js', 'views/activities/list.js', 'views/treasury/forms.js'])
    assert.match(source(file), /trackOverlay\(/, `${file} registers its overlays`);
});

test('client errors are human sentences; codes and request ids never become the message', () => {
  for (const [status, code] of [[403, 'forbidden'], [404, 'not_found'], [409, 'stale_admission'], [409, 'invalid_transition'], [400, 'invalid_request'],
    [429, 'rate_limited'], [403, 'fresh_session_required'], [400, 'whatever_new_code']]) {
    const text = humanError(status, code);
    assert.doesNotMatch(text, /_|[A-Z]{4,}|[0-9a-f]{8}-/, `${status} ${code}`);
    assert.match(text, /\.$/);
  }
  assert.match(humanError(409, 'stale_activity'), /han canviat/);
  const http = source('http.js');
  assert.doesNotMatch(http, /\$\{data\.error/, 'the raw code is not interpolated into the message');
  assert.match(http, /error\.requestId = /, 'the request id stays available for support');
});

test('lists and screens drop the previous person’s data when unloaded', () => {
  assert.match(source('views/simple-views.js'), /\$\('profile'\)\.textContent = ''; \$\('roles'\)\.replaceChildren\(\); \$\('sessionList'\)\.replaceChildren\(\)/);
  assert.match(source('dashboard.js'), /for\(const id of \['dashboardFees','dashboardAttention','dashboardActivities'\]\)\$\(id\)\.replaceChildren\(\)/);
  assert.match(source('dashboard.js'), /Quotes de les teues seccions';[\s\S]{0,140}Veure quotes →/, 'the link says where it goes');
});

test('visible copy: section names (Esculta), no backend states, codes or internal ids in the legacy Quotes view', () => {
  const html = source('index.html'), fees = source('fees.js'), account = source('views/simple-views.js');
  assert.doesNotMatch(html, />Escolta</, 'the visible section name is Esculta');
  assert.doesNotMatch(html, /<option>(PENDING|PARTIAL|PAID|ISSUE)<\/option>/, 'filter options carry human labels');
  assert.doesNotMatch(html, /<pre id="feeMetrics"/);
  assert.match(fees, /sectionName\(section\)/, 'fee summary by section name');
  assert.doesNotMatch(fees, /\$\{row\.(status|review_status|match_status|code|payment_id|obligation_id)\}/, 'no raw state, code or id interpolated');
  assert.doesNotMatch(fees, /toFixed\(2\)\+' €'/, 'one money format (formatEur)');
  assert.doesNotMatch(account, /\$\{role\.role_code\}|\$\{me\.user\.status\}/, 'account shows role and state names');
  assert.match(source('shell.js'), /ROLE_LABELS\[me\.roles\[0\]\?\.role_code\]/);
});

test('common states: the global banner is for network/server failures and belongs to the page that had it; filters never send impossible values', async () => {
  const app = source('app.js');
  assert.match(app, /if \(!\(error\?\.status >= 400 && error\?\.status < 500\)\) \$\('shellLoadError'\)\.hidden = false/, '4xx are explained by each screen');
  assert.match(app, /if \(page !== shownPage\) \{ \$\('shellLoadError'\)\.hidden = true; shownPage = page; \}/, 'the banner clears on page change');
  const feed = await import('../gestio/public/views/activity-feed/model.js');
  assert.deepEqual([feed.parseFilters({ des: '2026-99-99' }).des, feed.parseFilters({ fins: '2026-02-30' }).fins, feed.parseFilters({ des: '2026-10-01' }).des], ['', '', '2026-10-01']);
});

test('cross-module links only from server-included data or usable pages; every missing-resource screen offers the way back; dialogs fit the screen', () => {
  const registrations = source('views/registrations.js');
  assert.match(registrations, /payment\.participant \? h\('a'/, 'payment → person only when the server included the person');
  assert.match(registrations, /me\?\.capabilities\?\.activities\?\.read \? h\('a'/, 'payment → activity only for people who use Activitats');
  assert.match(source('views/participants/admissions.js'), /catch \(error\) \{[\s\S]{0,400}back-link[\s\S]{0,400}'Noves altes'/);
  assert.match(source('activities.css'), /\.dialog\{width:min\(100%,440px\);max-height:calc\(100dvh - 2\*var\(--space-4\)\);overflow-y:auto/);
  assert.match(source('participants.css'), /\.participant-toolbar\{flex-wrap:wrap\}/, 'the mobile toolbar wraps instead of overflowing');
  assert.match(source('activities.css'), /\.detail-actions \.btn\{min-height:44px;min-width:0;white-space:normal/);
});

test('a late answer from an ended session is dropped: never painted into the next session, never shown as an error', async () => {
  const { createClient } = await import('../gestio/public/http.js');
  const original = globalThis.fetch;
  const pending = [];
  globalThis.fetch = () => new Promise(resolve => pending.push(resolve));
  try {
    const client = createClient({ onUnauthorized: () => {} });
    const settled = [];
    client.call('/api/participants').then(data => settled.push(['data', data]), error => settled.push(['error', error.status]));
    client.call('/api/payments').then(data => settled.push(['data', data]), error => settled.push(['error', error.status]));
    client.endSession(); // logout, expiry or another person
    pending[0]({ ok: true, status: 200, json: async () => ({ participants: ['previous person'] }) });
    pending[1]({ ok: false, status: 500, json: async () => ({ error: 'internal_error' }) });
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(settled, [], 'nothing from the previous session reaches the screens');
    const fresh = client.call('/api/me');
    pending[2]({ ok: true, status: 200, json: async () => ({ user: { id: 'next' } }) });
    assert.deepEqual(await fresh, { user: { id: 'next' } }, 'the new session works normally');
  } finally { globalThis.fetch = original; }
  assert.match(source('app.js'), /endSession\(\); dismissOverlays\(\); views\.unloadAll\(\)/);
});
