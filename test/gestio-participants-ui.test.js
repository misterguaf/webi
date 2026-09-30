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

test('editor validation mirrors the backend; a provisional record may omit the birth date', () => {
  const now = Date.UTC(2026, 0, 1);
  const sectionIds = { TROPA: 's2', ESCOLTA: 's3' };
  const base = { name: ' Aina Fictícia ', birthDate: '', sectionCode: 'TROPA', provenance: '', provenanceNote: '' };
  const create = model.validateEditor(base, { mode: 'create', sectionIds, now });
  assert.equal(create.valid, true);
  assert.deepEqual(create.body, { name: 'Aina Fictícia', sectionId: 's2', birthDate: null, provenance: null, provenanceNote: null });
  const full = model.validateEditor({ ...base, birthDate: '2015-04-02', provenance: 'ALTRES', provenanceNote: 'Fitxa de paper' }, { mode: 'create', sectionIds, now });
  assert.deepEqual(full.body.birthDate, '2015-04-02');
  assert.equal(full.body.provenance, 'ALTRES');
  assert.deepEqual(Object.keys(model.validateEditor({ ...base, name: '' }, { mode: 'create', sectionIds, now }).errors), ['name']);
  assert.equal(model.validateEditor({ ...base, sectionCode: '' }, { mode: 'create', sectionIds, now }).errors.audience, 'Tria la secció');
  assert.equal(model.validateEditor({ ...base, birthDate: '3000-01-01' }, { mode: 'create', sectionIds, now }).errors.birthDate, 'Data no vàlida');
  const edit = model.validateEditor({ ...base, birthDate: '2015-04-02' }, { mode: 'edit', sectionIds, now });
  assert.equal('sectionId' in edit.body, false, 'edit never changes the section');
});

test('duplicate detection matches exact names in the loaded (in-scope) list only', () => {
  const rows = [p('a', { display_name: 'Joan Exemple', birth_date: '2014-01-01' }),
    p('b', { display_name: 'Joan Exemple', birth_date: '2015-02-02' }), p('c', { display_name: 'Marta Exemple' })];
  assert.deepEqual(model.findDuplicates(rows, 'joan exemple').map(r => r.id).sort(), ['a', 'b']);
  assert.deepEqual(model.findDuplicates(rows, 'Joan Exemple', '2015-02-02')[0].id, 'b', 'same birth date ranks first');
  assert.deepEqual(model.findDuplicates(rows, 'x'), [], 'needs at least 2 characters');
  assert.deepEqual(model.findDuplicates(rows, 'Ningú'), []);
});

test('family and review labels distinguish communicated, accredited and reviewed', () => {
  assert.equal(model.relationshipLabel('LEGAL_GUARDIAN'), 'Tutela legal');
  assert.equal(model.contactKindLabel('PHONE'), 'Telèfon');
  assert.equal(model.representationLine({ legalRepresentative: false }), null);
  assert.equal(model.representationLine({ legalRepresentative: true, representationBasis: 'COMUNICAT', representationPending: true }), 'Representant legal · comunicat · pendent de revisió');
  assert.equal(model.representationLine({ legalRepresentative: true, representationBasis: 'ACREDITAT', representationReviewed: true }), 'Representant legal · acreditat · revisat per Secretaria');
  assert.doesNotMatch(model.representationLine({ legalRepresentative: true, representationBasis: 'ACREDITAT', representationReviewed: true }), /verificat/);
  assert.equal(model.reviewKindLabel('GUARDIAN_DATA_REQUEST'), 'Sol·licitud de canvi en un tutor');
  assert.equal(model.reviewStatusLabel('ESCALATED'), 'Escalada');
});

test('accessible row name includes name, section, status and pending, never contact data', () => {
  const name = model.accessibleRowName(p('x', { display_name: 'Aina Fictícia', completeness: { complete: false, missing: ['guardian'] } }), S);
  assert.match(name, /^Aina Fictícia, Tropa, Actiu, informació pendent$/);
});
