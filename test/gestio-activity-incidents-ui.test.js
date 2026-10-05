// FASE 3.5H.3 — Activitat and Incidències i millores UI: categories, filters, day grouping, server-only links,
// incident labels/actions/filters, module pre-fill from the previous page, and shell wiring.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as feed from '../gestio/public/views/activity-feed/model.js';
import * as incidents from '../gestio/public/views/incidents/model.js';
import { PAGES } from '../gestio/public/router.js';

const source = file => readFileSync(join(import.meta.dirname, '..', 'gestio/public', file), 'utf8');
// Code without its comments (comments may legitimately say what is NOT implemented).
const code = file => source(file).replace(/^\s*\/\/.*$/gm, '');

test('Activitat: the six categories, safe filters only, and links only from the server', () => {
  assert.deepEqual(feed.CATEGORIES.map(item => item.label), ['Tots', 'Participants', 'Activitats', 'Tresoreria', 'Salut', 'Administració']);
  const filters = feed.parseFilters({ categoria: 'treasury', tipus: 'read', persona: '00000000-0000-4000-8000-000000000105', des: '2026-10-01', fins: 'ahir', q: ' pagament ', action: 'AUTHZ_DENY' });
  assert.deepEqual(filters, { categoria: 'treasury', tipus: 'read', persona: '00000000-0000-4000-8000-000000000105', des: '2026-10-01', fins: '', q: 'pagament' });
  assert.equal(feed.apiQuery(filters, 'abc'), 'category=treasury&kind=read&actor=00000000-0000-4000-8000-000000000105&from=2026-10-01&q=pagament&cursor=abc');
  assert.deepEqual(feed.parseFilters({ categoria: 'raw_audit', persona: 'pepe' }), { categoria: '', tipus: '', persona: '', des: '', fins: '', q: '' });
  assert.equal(feed.hrefOf({ page: 'participants', path: ['altes', 'x'] }), '#/participants/altes/x');
  assert.equal(feed.hrefOf(null), null);
  assert.match(feed.emptyCopy({ categoria: 'health' }), /Salut arribarà/);
  const now = Date.parse('2026-10-05T12:00:00');
  const groups = feed.groupByDay([{ at: now }, { at: now - 3600000 }, { at: now - 86400000 }, { at: now - 5 * 86400000 }], now);
  assert.deepEqual(groups.map(group => [group.label, group.items.length]).slice(0, 2), [['Avui', 2], ['Ahir', 1]]);
  const view = source('views/activity-feed.js');
  assert.ok(view.includes('hrefOf(item.link)'), 'links are taken from the server item');
  assert.doesNotMatch(view, /innerHTML|localStorage|metadata|resource_id/);
});

test('Incidències: types, states, no priority, actions by state for managers only, module from the previous page', () => {
  assert.deepEqual(incidents.TYPES.map(item => item.value), ['ERROR', 'IMPROVEMENT', 'ACCESS', 'DATA', 'OTHER']);
  assert.deepEqual(Object.keys(incidents.STATUS), ['OPEN', 'IN_PROGRESS', 'RESOLVED']);
  assert.doesNotMatch(JSON.stringify(incidents) + code('views/incidents.js'), /priorit|urgent|severity|P0/i);
  assert.deepEqual(incidents.actionsFor({ status: 'OPEN' }, true), ['start', 'resolve']);
  assert.deepEqual(incidents.actionsFor({ status: 'IN_PROGRESS' }, true), ['resolve']);
  assert.deepEqual(incidents.actionsFor({ status: 'RESOLVED' }, true), ['reopen']);
  assert.deepEqual(incidents.actionsFor({ status: 'OPEN' }, false), [], 'a reporter never manages');
  assert.deepEqual(incidents.parseFilters({ vista: 'totes', modul: 'quotes' }, false), { vista: 'meues', estat: '', tipus: '', modul: '', entorn: '' }, 'no "Totes" without the capability');
  assert.deepEqual(incidents.parseFilters({ vista: 'totes', estat: 'OPEN', tipus: 'DATA', modul: 'quotes' }, true), { vista: 'totes', estat: 'OPEN', tipus: 'DATA', modul: 'quotes', entorn: '' });
  assert.equal(incidents.apiQuery({ vista: 'totes', estat: 'OPEN', tipus: '', modul: 'quotes' }), 'vista=totes&status=OPEN&module=quotes');
  assert.equal(incidents.moduleFromPage('tresoreria'), 'tresoreria');
  assert.equal(incidents.moduleFromPage('incidencies'), 'altres');
  assert.ok(incidents.RESOLUTION_SUGGESTIONS.includes('Corregit en la nova versió.') && incidents.RESOLUTION_SUGGESTIONS.includes('No s’implementarà de moment.'));
  for (const code of ['invalid_incident', 'stale_incident', 'invalid_transition', 'not_found']) assert.doesNotMatch(incidents.errorCopy({ code }), /_/);
});

test('shell wiring: Activitat and Incidències i millores are pages for everyone; badge only for managers', () => {
  assert.ok(PAGES.includes('activitat') && PAGES.includes('incidencies'));
  const shell = source('shell.js'), app = source('app.js'), html = source('index.html'), view = code('views/incidents.js');
  assert.match(shell, /id:'activitat',label:'Activitat'/);
  assert.match(shell, /id:'incidencies',label:'Incidències i millores'/);
  assert.ok(html.includes('id="activityFeedView"') && html.includes('id="incidentsView"') && html.includes('id="icon-activity"'));
  assert.match(app, /createActivityFeedView\(/);
  assert.match(app, /createIncidentsView\(\{[^}]*onNavigate \}\)/);
  assert.match(view, /onNavigate\(page => \{ if \(page !== 'incidencies'\) previousPage = page; \}\)/);
  assert.match(view, /moduleFromPage\(previousPage\)/);
  assert.match(view, /available: \(\) => true/);
  assert.match(view, /if \(!manage\(\)\) \{ setNavBadge\('incidencies', 0\)/, 'the OPEN badge is for managers only');
  for (const op of ['start', 'resolve', 'reopen']) assert.ok(view.includes(`'${op}'`), op);
  assert.ok(view.includes('/api/work-incidents/${id}/${step}`'));
  assert.doesNotMatch(view, /innerHTML|localStorage|attachment|comment/i);
});

test('environment labels: PRODUCTION → PRODUCCIÓ, STAGING → PROVES, LOCAL → LOCAL; filter for managers only; never in the report form', () => {
  assert.deepEqual(['PRODUCTION', 'STAGING', 'LOCAL'].map(value => incidents.environmentOf(value).label), ['PRODUCCIÓ', 'PROVES', 'LOCAL']);
  assert.equal(incidents.parseFilters({ vista: 'totes', entorn: 'STAGING' }, true).entorn, 'STAGING');
  assert.equal(incidents.parseFilters({ vista: 'totes', entorn: 'MARS' }, true).entorn, '');
  assert.equal(incidents.parseFilters({ entorn: 'STAGING' }, false).entorn, '', 'reporters have no environment filter');
  assert.equal(incidents.apiQuery({ vista: 'totes', estat: '', tipus: '', modul: '', entorn: 'PRODUCTION' }), 'vista=totes&environment=PRODUCTION');
  const view = code('views/incidents.js');
  const form = view.slice(view.indexOf('async function report()'), view.indexOf('async function renderList()'));
  assert.doesNotMatch(form, /environment|entorn|ENVIRONMENTS/i, 'the reporter never chooses it');
  assert.match(view, /select\('Entorn', 'entorn'/);
  assert.match(view, /filters\.vista === 'totes' \? envBadge\(item\.environment\)/, 'badge in the management view');
});
