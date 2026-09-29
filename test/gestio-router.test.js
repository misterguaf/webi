// 3.5D hash router: parsing, formatting, push vs replace, back/forward and login restore.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRouter, formatHash, parseHash, sameRoute } from '../gestio/public/router.js';

const UUID = '00000000-0000-4000-8000-000000000801';

// Minimal browser history: pushState/replaceState change the hash silently, back/forward fire popstate.
function fakeWindow(initial = '') {
  const entries = [{ hash: initial, state: null }];
  let index = 0;
  const listeners = { popstate: [], hashchange: [] };
  const win = {
    location: { get hash() { return entries[index].hash; }, set hash(value) {
      entries.splice(index + 1); entries.push({ hash: value, state: null }); index++;
      for (const listener of listeners.hashchange) listener();
    } },
    history: {
      scrollRestoration: 'auto',
      get state() { return entries[index].state; },
      get length() { return entries.length; },
      pushState(state, _title, hash) { entries.splice(index + 1); entries.push({ hash, state }); index++; },
      replaceState(state, _title, hash) { entries[index] = { hash, state }; },
      back() { if (index > 0) { index--; for (const listener of listeners.popstate) listener(); } },
      forward() { if (index < entries.length - 1) { index++; for (const listener of listeners.popstate) listener(); } }
    },
    addEventListener(name, listener) { listeners[name].push(listener); },
    entries: () => entries.map(entry => entry.hash)
  };
  return win;
}

test('parseHash reads page, path and query, and falls back safely', () => {
  assert.deepEqual(parseHash(''), { page: 'inici', path: [], query: {} });
  assert.deepEqual(parseHash('#inici'), { page: 'inici', path: [], query: {} }, 'legacy brand link');
  assert.deepEqual(parseHash('#/activitats'), { page: 'activitats', path: [], query: {} });
  assert.deepEqual(parseHash(`#/activitats/${UUID}/inscripcions?filtre=per-revisar`),
    { page: 'activitats', path: [UUID, 'inscripcions'], query: { filtre: 'per-revisar' } });
  assert.deepEqual(parseHash('#/activitats?estat=esborranys&seccio=TROPA&quan=proximes&q=eixida%20d%C3%A0'),
    { page: 'activitats', path: [], query: { estat: 'esborranys', seccio: 'TROPA', quan: 'proximes', q: 'eixida dà' } });
  assert.deepEqual(parseHash('#/desconeguda/x'), { page: 'inici', path: [], query: {} }, 'unknown pages go home');
  assert.deepEqual(parseHash('#/activitats/<script>/x').path, ['x'], 'unsafe segments are dropped');
  assert.deepEqual(parseHash('#/activitats?q=%E0%A4%A&Bad=1&ok=' + 'x'.repeat(121)).query, {}, 'malformed, uppercase and oversized keys ignored');
});

test('formatHash round-trips and omits empty query values', () => {
  const route = { page: 'activitats', path: [UUID, 'informacio'], query: { q: 'Eixida dà', estat: '' } };
  assert.equal(formatHash(route), `#/activitats/${UUID}/informacio?q=Eixida%20d%C3%A0`);
  assert.deepEqual(parseHash(formatHash(route)), { page: 'activitats', path: [UUID, 'informacio'], query: { q: 'Eixida dà' } });
  assert.ok(sameRoute({ page: 'quotes' }, parseHash('#/quotes')));
});

test('push creates history entries, replace does not, and back/forward re-announce routes', () => {
  const win = fakeWindow('#/inici');
  const seen = [];
  const router = createRouter({ win, onChange: (route, info) => seen.push([formatHash(route), info.source]) });
  assert.equal(win.history.scrollRestoration, 'manual');
  assert.equal(router.canGoBack(), false, 'a deep link has no in-app history');
  router.go({ page: 'activitats' });
  router.go({ page: 'activitats', query: { q: 'e' } }, { replace: true });
  router.go({ page: 'activitats', query: { q: 'ei' } }, { replace: true });
  router.go({ page: 'activitats', path: [UUID] });
  assert.equal(router.canGoBack(), true);
  assert.deepEqual(win.entries(), ['#/inici', '#/activitats?q=ei', `#/activitats/${UUID}`], 'filter keystrokes do not fill history');
  router.go({ page: 'activitats', path: [UUID] });
  assert.equal(seen.length, 4, 'navigating to the current route is a no-op');
  win.history.back();
  assert.deepEqual(seen.at(-1), ['#/activitats?q=ei', 'history']);
  assert.deepEqual(router.current(), { page: 'activitats', path: [], query: { q: 'ei' } });
  win.history.forward();
  assert.deepEqual(seen.at(-1), [`#/activitats/${UUID}`, 'history']);
  win.history.back(); win.history.back();
  assert.equal(router.current().page, 'inici');
  assert.equal(router.canGoBack(), false);
});

test('manual hash edits are followed and start() restores the route kept during login', () => {
  const win = fakeWindow(`#/activitats/${UUID}/informacio`);
  const seen = [];
  const router = createRouter({ win, onChange: route => seen.push(formatHash(route)) });
  router.start();
  assert.deepEqual(seen, [`#/activitats/${UUID}/informacio`]);
  win.location.hash = '#/quotes';
  assert.deepEqual(seen.at(-1), '#/quotes');
  win.location.hash = '#/quotes';
  assert.equal(seen.filter(hash => hash === '#/quotes').length, 1);
});

test('without a browser history the router still announces routes (non-browser hosts and tests)', () => {
  const seen = [];
  const router = createRouter({ win: undefined, onChange: route => seen.push(route.page) });
  router.go({ page: 'quotes' });
  router.go({ page: 'quotes' });
  router.go({ page: 'quotes' }, { force: true });
  assert.deepEqual(seen, ['quotes', 'quotes']);
});
