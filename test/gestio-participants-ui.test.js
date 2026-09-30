// 3.5E Participants UI model: filters (no name in the URL), grouping, completeness and history labels,
// capability derivation. Pure functions only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as model from '../gestio/public/views/participants/model.js';

const S = [{ id: 's1', code: 'MANADA' }, { id: 's2', code: 'TROPA' }, { id: 's3', code: 'ESCOLTA' }, { id: 's4', code: 'CLAN' }];
const caps = participants => ({ version: 1, sections: S, participants: { read: null, manage: null, readContacts: null, ...participants } });
const p = (id, over = {}) => ({ id, display_name: `Nom ${id}`, current_section_id: 's2', status: 'ACTIVE',
  completeness: { complete: true, missing: [] }, ...over });

test('filters: only seccio/estat/completitud are URL-backed; the name never is', () => {
  assert.deepEqual(model.parseFilters({ seccio: 'TROPA', estat: 'de-baixa', completitud: 'pendents' }),
    { seccio: 'TROPA', estat: 'de-baixa', completitud: 'pendents' });
  assert.deepEqual(model.parseFilters({ seccio: 'ROVERS', estat: 'x', completitud: 'y', q: 'Anna' }), model.DEFAULT_FILTERS);
  assert.deepEqual(model.filtersToQuery({ seccio: 'TROPA', estat: '', completitud: 'pendents', q: 'Anna' }), { seccio: 'TROPA', completitud: 'pendents' });
  assert.equal('q' in model.filtersToQuery({ seccio: '', estat: '', completitud: '' }), false);
  assert.equal(model.activeFilterCount({ seccio: 'TROPA', estat: 'de-baixa', completitud: 'pendents' }), 2, 'estat is not a "narrowing" chip');
});

test('filtering: section, completeness and accent-insensitive name search (in memory)', () => {
  const rows = [p('a', { display_name: 'Aina Fictícia', current_section_id: 's2' }),
    p('b', { display_name: 'Bru Fictici', current_section_id: 's3', completeness: { complete: false, missing: ['guardian'] } }),
    p('c', { display_name: 'Cèlia Fictícia', current_section_id: 's2', completeness: { complete: false, missing: ['contact'] } })];
  const apply = (filters, search = '') => model.filterParticipants(rows, { ...model.DEFAULT_FILTERS, ...filters }, S, search).map(r => r.id);
  assert.deepEqual(apply({ seccio: 'TROPA' }), ['a', 'c']);
  assert.deepEqual(apply({ completitud: 'pendents' }), ['b', 'c']);
  assert.deepEqual(apply({}, 'CELIA'), ['c']);
  assert.deepEqual(apply({ seccio: 'TROPA', completitud: 'pendents' }, 'fict'), ['c']);
  assert.deepEqual(model.sectionOptions(rows, S).map(o => o.value), ['', 'TROPA', 'ESCOLTA']);
});

test('grouping keeps section order and sorts names', () => {
  const rows = [p('1', { display_name: 'Zoe', current_section_id: 's3' }), p('2', { display_name: 'Ana', current_section_id: 's2' }),
    p('3', { display_name: 'Bru', current_section_id: 's2' })];
  const groups = model.groupBySection(rows, S);
  assert.deepEqual(groups.map(g => [g.code, g.rows.map(r => r.display_name)]), [['TROPA', ['Ana', 'Bru']], ['ESCOLTA', ['Zoe']]]);
});

test('completeness and history labels are human Valencian, never codes', () => {
  assert.equal(model.completenessSignal({ complete: true, missing: [] }), null);
  assert.deepEqual(model.completenessSignal({ complete: false, missing: ['guardian'] }), { text: 'Informació pendent', tone: 'attention' });
  assert.equal(model.missingSummary(['birthDate']), 'Falta la data de naixement');
  assert.equal(model.missingSummary(['guardian', 'contact']), 'Falten un tutor i un contacte');
  assert.equal(model.missingSummary([]), null);
  for (const reason of ['ENROLMENT', 'TRANSFER', 'DEACTIVATION', 'REACTIVATION', 'BACKFILL'])
    assert.doesNotMatch(model.historyReason(reason), /[A-Z_]{3,}/);
  assert.equal(model.historyReason('BACKFILL'), 'registre inicial');
  assert.equal(model.statusLabel('ACTIVE'), 'Actiu');
  assert.equal(model.statusLabel('INACTIVE'), 'De baixa');
  assert.equal(model.feeLabel('PAID'), 'Pagada');
  assert.equal(model.initials('Maria Font (fictícia)'), 'MF');
});

test('capability derivation for management scope and the list subtitle', () => {
  const tropa = caps({ read: { all: false, sections: [{ id: 's2', code: 'TROPA' }] }, manage: { all: false, sections: [{ id: 's2', code: 'TROPA' }] } });
  assert.deepEqual(model.manageableSections(tropa), ['TROPA']);
  assert.equal(model.canCreate(tropa), true);
  assert.equal(model.canManageSection(tropa, 'TROPA'), true);
  assert.equal(model.canManageSection(tropa, 'ESCOLTA'), false);
  assert.equal(model.scopeSubtitle(tropa), 'Tropa');
  const group = caps({ read: { all: true, sections: [] }, manage: { all: true, sections: [] } });
  assert.deepEqual(model.manageableSections(group), ['MANADA', 'TROPA', 'ESCOLTA', 'CLAN']);
  assert.equal(model.scopeSubtitle(group), null);
  assert.equal(model.canCreate(caps({})), false);
  assert.equal(model.canManageSection(caps({}), 'TROPA'), false);
});

test('accessible row name includes name, section, status and pending, never contact data', () => {
  const name = model.accessibleRowName(p('x', { display_name: 'Aina Fictícia', completeness: { complete: false, missing: ['guardian'] } }), S);
  assert.match(name, /^Aina Fictícia, Tropa, Actiu, informació pendent$/);
});
