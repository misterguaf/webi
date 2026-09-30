// 3.5D Activitats UI model: filters, grouping, signals, capability derivation, editor validation and
// copy. Pure functions only (views/activities/model.js); the DOM is validated in the browser.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as model from '../gestio/public/views/activities/model.js';

const DAY = 86400000, NOW = Date.UTC(2026, 9, 15, 10);
const TROPA = { id: 's2', code: 'TROPA' }, ESCOLTA = { id: 's3', code: 'ESCOLTA' };
const caps = activities => ({ version: 1, activities: { read: null, manage: null, manageGeneral: false,
  reviewRegistrations: null, verifyPayments: null, ...activities } });
const row = (id, overrides = {}) => ({ id, name: `Activitat ${id}`, status: 'PUBLISHED', audience: 'SECTIONS', sections: 'TROPA',
  location: 'Lloc fictici', public_code: `ACT-${id.toUpperCase()}`, price_cents: 0, version: 1,
  starts_at: NOW + 10 * DAY, ends_at: NOW + 11 * DAY, registration_deadline: NOW + 5 * DAY, registrations: null, ...overrides });

test('filters: URL values are validated, defaults are silent and serialisation drops defaults', () => {
  assert.deepEqual(model.parseFilters({ estat: 'esborranys', seccio: 'TROPA', quan: 'proximes', q: 'eixida' }),
    { estat: 'esborranys', seccio: 'TROPA', quan: 'proximes', q: 'eixida' });
  assert.deepEqual(model.parseFilters({ estat: 'DROP TABLE', seccio: 'ROVERS', quan: 'sempre', extra: 'x' }), model.DEFAULT_FILTERS);
  assert.deepEqual(model.filtersToQuery({ estat: '', seccio: 'tot-el-grup', quan: '', q: 'dà' }), { seccio: 'tot-el-grup', q: 'dà' });
  assert.equal(model.activeFilterCount({ estat: 'tancades', seccio: 'TROPA', quan: 'passades', q: 'x' }), 2);
  assert.equal(model.filtersDiffer(model.DEFAULT_FILTERS), false);
});

test('filtering: accent-insensitive search on name, location and public code; section, time and status rules', () => {
  const rows = [row('a', { name: 'Eixida a la Muntanya' }), row('b', { location: 'Alcoi', audience: 'GENERAL', sections: '' }),
    row('c', { status: 'DRAFT', sections: 'TROPA, ESCOLTA' }), row('d', { status: 'CLOSED', starts_at: NOW - 30 * DAY, ends_at: NOW - 29 * DAY }),
    row('e', { starts_at: NOW - 5 * DAY, ends_at: NOW - 4 * DAY })];
  const apply = filters => model.filterActivities(rows, { ...model.DEFAULT_FILTERS, ...filters }, NOW).map(activity => activity.id);
  assert.deepEqual(apply({ q: 'MUNTÀNYA' }), ['a']);
  assert.deepEqual(apply({ q: 'alcoi' }), ['b']);
  assert.deepEqual(apply({ q: 'act-c' }), ['c'], 'the internal code matches but is never a label');
  assert.deepEqual(apply({ seccio: 'ESCOLTA' }), ['c'], 'multi-section activities match any of their sections');
  assert.deepEqual(apply({ seccio: 'tot-el-grup' }), ['b']);
  assert.deepEqual(apply({ estat: 'tancades' }), ['d', 'e'], 'ended-but-published rows appear with the closed ones');
  assert.deepEqual(apply({ estat: 'publicades' }), ['a', 'b', 'e']);
  assert.deepEqual(apply({ estat: 'esborranys' }), ['c']);
  assert.deepEqual(apply({ quan: 'passades' }), ['d', 'e']);
  assert.deepEqual(apply({ quan: 'proximes' }), ['a', 'b', 'c']);
  assert.deepEqual(model.statusCounts(rows, { ...model.DEFAULT_FILTERS, q: 'activitat' }, NOW), { '': 4, publicades: 2, esborranys: 1, tancades: 2 });
  assert.deepEqual(model.sectionOptions(rows).map(option => option.value), ['', 'tot-el-grup', 'TROPA', 'ESCOLTA']);
});

test('grouping and ordering follow §5.4', () => {
  const rows = [
    row('late', { starts_at: NOW + 30 * DAY, ends_at: NOW + 31 * DAY, registration_deadline: NOW + 20 * DAY }),
    row('closedDeadline', { starts_at: NOW + 2 * DAY, ends_at: NOW + 3 * DAY, registration_deadline: NOW - DAY }),
    row('soon', { starts_at: NOW + 8 * DAY, ends_at: NOW + 9 * DAY, registration_deadline: NOW + DAY }),
    row('draftB', { status: 'DRAFT', starts_at: NOW + 50 * DAY, ends_at: NOW + 51 * DAY }),
    row('draftA', { status: 'DRAFT', starts_at: NOW + 40 * DAY, ends_at: NOW + 41 * DAY }),
    row('ended', { starts_at: NOW - 3 * DAY, ends_at: NOW - 2 * DAY, registration_deadline: NOW - 9 * DAY }),
    row('closed', { status: 'CLOSED', starts_at: NOW - 60 * DAY, ends_at: NOW - 58 * DAY })];
  const groups = model.groupActivities(rows, NOW);
  assert.deepEqual(groups.map(group => [group.label, group.rows.map(activity => activity.id)]), [
    ['En marxa i pròximes', ['soon', 'late', 'closedDeadline']],
    ['Esborranys', ['draftA', 'draftB']],
    ['Passades i tancades', ['ended', 'closed']]]);
  assert.deepEqual(model.flatActivities(rows, NOW).map(activity => activity.id).slice(0, 3), ['soon', 'late', 'closedDeadline']);
});

test('timing phases and deadline copy are derived from authoritative dates', () => {
  assert.equal(model.phase(row('x', { registration_deadline: NOW + 3 * DAY }), NOW), 'open');
  assert.equal(model.phase(row('x', { registration_deadline: NOW + DAY }), NOW), 'deadline-soon');
  assert.equal(model.phase(row('x', { registration_deadline: NOW - DAY }), NOW), 'registration-closed');
  assert.equal(model.phase(row('x', { starts_at: NOW - DAY, ends_at: NOW + DAY, registration_deadline: NOW - 2 * DAY }), NOW), 'in-progress');
  assert.equal(model.phase(row('x', { starts_at: NOW - 3 * DAY, ends_at: NOW - DAY }), NOW), 'ended');
  assert.equal(model.phase(row('x', { status: 'CLOSED' }), NOW), 'closed');
  assert.equal(model.deadlineSignal(NOW + 3 * DAY, NOW), 'Termini en 3 dies');
  assert.equal(model.deadlineSignal(NOW + DAY / 2, NOW), 'Últim dia');
  assert.equal(model.deadlineSignal(NOW - 1, NOW), 'Termini tancat');
  assert.equal(model.timingLine(row('x', { status: 'DRAFT', registration_deadline: NOW - DAY }), NOW), 'El termini ja ha passat');
  assert.equal(model.timingLine(row('x', { starts_at: NOW - 3 * DAY, ends_at: NOW - DAY }), NOW), 'Finalitzada · pendent de tancar');
});

test('signals: at most two, by priority; partial counts are labelled; unknown counts are never shown as 0', () => {
  const summary = (total, extra = {}) => ({ scope: 'ALL', sections: [], total, needsReview: 0, awaitingPayment: 0, confirmed: total, rejected: 0, ...extra });
  const texts = activity => model.signals(activity, NOW).map(signal => signal.text);
  assert.deepEqual(texts(row('a', { registrations: summary(12, { needsReview: 3 }), price_cents: 1500 })), ['3 per revisar', '12 inscripcions']);
  assert.deepEqual(texts(row('b', { registrations: { ...summary(12), scope: 'PARTIAL', sections: ['TROPA'] } })), ['12 inscripcions de Tropa', 'Termini en 5 dies']);
  assert.deepEqual(texts(row('c', { price_cents: 1500 })), ['Termini en 5 dies', '15,00\u00a0€'], 'no count without review scope');
  assert.deepEqual(texts(row('d', { registrations: summary(0) })), ['0 inscripcions', 'Termini en 5 dies'], 'a known zero is shown');
  assert.deepEqual(texts(row('e', { starts_at: NOW - 3 * DAY, ends_at: NOW - DAY })), ['Pendent de tancar', 'Gratuïta']);
  assert.deepEqual(texts(row('f', { status: 'DRAFT' })), [], 'drafts show the continue affordance instead');
  assert.deepEqual(texts(row('g', { status: 'CLOSED', registrations: summary(1) })), ['1 inscripció']);
  assert.equal(model.signals(row('h', { registration_deadline: NOW + DAY }), NOW)[0].tone, 'warning');
  assert.deepEqual(texts(row('s', { registration_deadline: NOW + 30 * 3600000, registrations: summary(20, { needsReview: 6 }) })),
    ['6 per revisar', 'Termini en 2 dies'], 'a deadline under 48h is never hidden behind the count');
  assert.equal(model.registrationsText({ ...summary(4), scope: 'PARTIAL', sections: ['TROPA', 'ESCOLTA'] }), '4 inscripcions de Tropa i Escolta');
  assert.equal(model.registrationsText(null), null);
  assert.match(model.accessibleRowName(row('i', { registrations: summary(12) }), NOW), /^Activitat i, Publicada, Tropa, .*, 12 inscripcions$/);
});

test('capabilities: manage mirrors the server rule; GENERAL read never implies manage', () => {
  const tropaCoordinator = caps({ read: { all: false, sections: [TROPA] }, manage: { all: false, sections: [TROPA] }, manageGeneral: true,
    reviewRegistrations: { all: false, sections: [TROPA] } });
  const delegate = caps({ read: { all: false, sections: [TROPA] } });
  const general = row('g', { audience: 'GENERAL', sections: '' }), mixed = row('m', { sections: 'TROPA, ESCOLTA' }), escolta = row('e', { sections: 'ESCOLTA' });
  assert.equal(model.canManage(row('t'), tropaCoordinator), true);
  assert.equal(model.canManage(general, tropaCoordinator), true);
  assert.equal(model.canManage(mixed, tropaCoordinator), false);
  assert.equal(model.canManage(general, delegate), false);
  assert.equal(model.canManage(escolta, caps({ manage: { all: true, sections: [] } })), true);
  assert.equal(model.readOnlyReason(mixed, tropaCoordinator), 'Només lectura · inclou seccions que no gestiones');
  assert.equal(model.readOnlyReason(general, delegate), 'Només lectura');
  assert.equal(model.canReview(general, tropaCoordinator), true);
  assert.equal(model.canReview(escolta, tropaCoordinator), false);
  assert.equal(model.canReview(row('t'), delegate), false);
  assert.equal(model.canVerifyPayments(row('free'), caps({ verifyPayments: { all: true, sections: [] } })), false, 'free activities have no payments');
  assert.equal(model.canCreate(delegate), false);
  assert.equal(model.canCreate(caps({ manageGeneral: true })), true);
  assert.deepEqual(model.manageableSections(tropaCoordinator), ['TROPA']);
  assert.equal(model.scopeSubtitle(tropaCoordinator), 'Tropa i activitats de tot el grup');
  assert.equal(model.scopeSubtitle(delegate), 'Tropa i activitats de tot el grup · només lectura');
  assert.equal(model.scopeSubtitle(caps({ read: { all: true, sections: [] } })), null);
  assert.deepEqual(model.sectionCodes(row('x', { sections: 'ESCOLTA, TROPA' })), ['TROPA', 'ESCOLTA']);
  assert.equal(model.scopeLabel(mixed), 'Tropa · Escolta');
});

test('editor: euros, inline rules mirroring the backend and family transport fixed at 0 €', () => {
  assert.equal(model.parseEuros('15,5'), 1550);
  assert.equal(model.parseEuros('15.50 €'), 1550);
  assert.equal(model.parseEuros('-3'), null);
  assert.equal(model.parseEuros('-3', { allowNegative: true }), -300);
  assert.equal(model.parseEuros('1e3'), null);
  assert.equal(model.centsToInput(1500), '15');
  assert.equal(model.centsToInput(1550), '15,50');
  const sectionIds = { TROPA: 's2', ESCOLTA: 's3' };
  const base = { ...model.editorValues(null), name: ' Eixida ', audience: 'SECTIONS', sections: ['TROPA'], location: 'Lloc',
    startsAt: model.toLocalInput(NOW + 10 * DAY), endsAt: model.toLocalInput(NOW + 11 * DAY), deadline: model.toLocalInput(NOW + 5 * DAY) };
  const ok = model.validateEditor({ ...base, paid: true, price: '15', transport: true, transportSupplement: '-3' }, { sectionIds, now: NOW });
  assert.equal(ok.valid, true);
  assert.deepEqual(ok.body.transportOptions, [{ code: 'GROUP', adjustmentCents: -300 }, { code: 'FAMILY', adjustmentCents: 0 }]);
  assert.deepEqual(ok.body.sectionIds, ['s2']);
  assert.equal(ok.body.name, 'Eixida');
  assert.equal(ok.body.priceCents, 1500);
  const bad = model.validateEditor({ ...base, name: '', endsAt: base.startsAt, deadline: model.toLocalInput(NOW + 20 * DAY),
    sections: [], paid: true, price: 'abc', transport: true, transportSupplement: '-20' }, { sectionIds, now: NOW });
  assert.deepEqual(Object.keys(bad.errors).sort(), ['audience', 'deadline', 'endsAt', 'name', 'price', 'transportSupplement']);
  assert.equal(bad.errors.endsAt, 'El final ha de ser posterior a l’inici');
  assert.equal(bad.errors.deadline, 'El termini ha de ser abans de l’inici');
  const past = model.validateEditor({ ...base, deadline: model.toLocalInput(NOW - DAY) }, { sectionIds, now: NOW });
  assert.equal(past.valid, true, 'a past deadline can be saved');
  assert.match(past.notes.deadline, /no publicar/);
  assert.equal(model.validateEditor({ ...base, transport: true, transportSupplement: '-1' }, { sectionIds, now: NOW }).errors.transportSupplement,
    'El preu amb transport del grup ha d’estar entre 0 i 10.000,00 €', 'free + discount would go below 0');
  const general = model.validateEditor({ ...base, audience: 'GENERAL', sections: ['TROPA'] }, { sectionIds, now: NOW });
  assert.deepEqual(general.body.sectionIds, []);
  const values = model.editorValues({ ...row('v', { price_cents: 1500 }), transportOptions: [{ code: 'GROUP', price_adjustment_cents: 300 },
    { code: 'FAMILY', price_adjustment_cents: 0 }], short_description: 'Descripció' });
  assert.deepEqual([values.paid, values.price, values.transport, values.transportSupplement, values.shortDescription], [true, '15', true, '3', 'Descripció']);
});

test('copy: backend codes map to human Valencian messages and never leak', () => {
  assert.equal(model.errorCopy('stale_activity'), 'Esta activitat ha canviat mentre l’editaves. Actualitza-la abans de guardar.');
  assert.equal(model.errorCopy('not_found'), 'No tens accés a aquesta activitat o ja no existeix.');
  assert.equal(model.errorCopy('activity_has_registrations'), 'Aquest esborrany ja té inscripcions i no es pot descartar.');
  assert.equal(model.errorCopy('weird_code'), 'No s’ha pogut completar l’acció. Torna-ho a provar.');
  for (const code of ['invalid_activity', 'forbidden', 'expired_deadline', 'invalid_transition', 'activity_terms_locked'])
    assert.doesNotMatch(model.errorCopy(code), /_|[A-Z]{4,}/);
  assert.equal(model.priceLabel(0), 'Gratuïta');
  assert.equal(model.formatMoney(1500), '15,00\u00a0€');
  assert.equal(model.signedMoney(-300), '−3,00\u00a0€');
});
