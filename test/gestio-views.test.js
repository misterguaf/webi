// Audit M8: the view registry owns load/unload/enter; app.js stays a composition root.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createViewRegistry } from '../gestio/public/view-registry.js';
import { root } from './helpers/gestio-sqlite.js';

function withBody(signedIn, run) {
  const previous = globalThis.document;
  let authenticated = signedIn;
  globalThis.document = { body: { classList: { contains: name => name === 'shell-authenticated' && authenticated } } };
  return Promise.resolve(run(value => { authenticated = value; })).finally(() => { globalThis.document = previous; });
}
const view = (id, page, events, { available = true, onLoad } = {}) => ({ id, page,
  available: () => available, load: async () => { events.push(`load:${id}`); await onLoad?.(); },
  unload: () => events.push(`unload:${id}`), enter: () => events.push(`enter:${id}`) });

test('views load in order, unavailable views are unloaded, and loading stops when the session ends', async () => {
  await withBody(true, async setSignedIn => {
    const events = [];
    const registry = createViewRegistry([view('a', 'inici', events),
      view('b', 'quotes', events, { available: false }),
      view('c', 'quotes', events, { onLoad: () => setSignedIn(false) }),
      view('d', 'participants', events)]);
    await registry.loadAll({ capabilities: {} });
    assert.deepEqual(events, ['load:a', 'unload:b', 'load:c'], 'a 401 during c stops the sequence before d');
  });
});

test('enter targets only available views of the entered page; unloadAll clears everything; ids are unique', async () => {
  await withBody(true, () => {
    const events = [];
    const registry = createViewRegistry([view('a', 'quotes', events), view('b', 'quotes', events, { available: false }), view('c', 'inici', events)]);
    registry.enter('quotes', { capabilities: {} });
    registry.enter('quotes', null);
    registry.unloadAll();
    assert.deepEqual(events, ['enter:a', 'unload:a', 'unload:b', 'unload:c']);
    assert.throws(() => createViewRegistry([view('x', 'inici', []), view('x', 'quotes', [])]), /Duplicate view/);
  });
});

test('app.js is a composition root without screen logic', () => {
  const app = readFileSync(join(root, 'gestio/public/app.js'), 'utf8');
  assert.ok(app.split('\n').length < 80, 'screens belong in views/*');
  assert.doesNotMatch(app, /\/api\/(activities|participants|payments|fees|registrations)/);
});
