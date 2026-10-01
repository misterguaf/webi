// 3.5F Inscripcions UI model (pure): labels, filters, capability-derived actions, correction targets,
// withdrawal defaults, confirmed grouping and queue lines. The server enforces every rule.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as model from '../gestio/public/views/registrations/model.js';

const S = [{ id: 's1', code: 'MANADA' }, { id: 's2', code: 'TROPA' }, { id: 's3', code: 'ESCOLTA' }, { id: 's4', code: 'CLAN' }];
const scope = (...codes) => ({ all: false, sections: S.filter(s => codes.includes(s.code)) });
const caps = registrations => ({ registrations: { review: null, reviewGlobal: false, readContacts: null, verifyPayments: null, ...registrations } });
const row = over => ({ id: 'r', status: 'NEEDS_PARTICIPANT_REVIEW', review_level: 'SECTION', registration_section_id: 's2', submitted_name: 'Nom', created_at: 0, ...over });

test('labels are Valencian, never backend codes; withdrawal is its own state', () => {
  for (const state of ['NEEDS_PARTICIPANT_REVIEW', 'AWAITING_PAYMENT_REVIEW', 'CONFIRMED', 'REJECTED', 'WITHDRAWN'])
    assert.doesNotMatch(model.registrationStateLabel(state), /[A-Z_]{3,}/);
  assert.equal(model.registrationStateLabel('WITHDRAWN'), 'Retirada');
  assert.notEqual(model.registrationStateLabel('WITHDRAWN'), model.registrationStateLabel('REJECTED'));
  assert.equal(model.paymentStateLabel('ISSUE'), 'Incidència');
  assert.equal(model.ESCALATION_LABELS.POSSIBLE_OTHER_SECTION, 'Possible secció diferent');
});

test('tab filters: Retirades only when present; payment filter only for paid activities', () => {
  const rows = [row(), row({ status: 'CONFIRMED' })];
  assert.deepEqual(model.visibleFilters(rows, { paid: false }).map(f => f.value), ['totes', 'per-revisar', 'confirmades', 'rebutjades']);
  assert.ok(model.visibleFilters([...rows, row({ status: 'WITHDRAWN' })], { paid: true }).some(f => f.value === 'retirades'));
});

test('actions: escalated rows only for global reviewers; correction within audience and authority', () => {
  const tropa = caps({ review: scope('TROPA') });
  const group = caps({ review: { all: true, sections: [] } });
  const sections = { audience: 'SECTIONS', sectionIds: ['s2'] }, general = { audience: 'GENERAL' };
  assert.deepEqual(model.rowActions(sections, tropa, row(), S), ['escalate', 'withdraw'], 'Tropa-only activity: nothing to correct to');
  assert.deepEqual(model.rowActions(general, tropa, row(), S), ['escalate', 'withdraw'], 'Tropa reviewer has no authority over other sections');
  assert.deepEqual(model.correctionTargets(general, group, row(), S).map(s => s.code), ['MANADA', 'ESCOLTA', 'CLAN']);
  assert.deepEqual(model.correctionTargets(general, caps({ review: scope('TROPA', 'ESCOLTA') }), row(), S).map(s => s.code), ['ESCOLTA']);
  assert.deepEqual(model.rowActions(general, tropa, row({ review_level: 'GLOBAL' }), S), [], 'escalated: nothing for a section reviewer');
  assert.deepEqual(model.rowActions(general, group, row({ review_level: 'GLOBAL' }), S), ['correct-section', 'withdraw']);
  assert.deepEqual(model.rowActions(general, tropa, row({ status: 'CONFIRMED' }), S), ['withdraw']);
  assert.deepEqual(model.rowActions(general, tropa, row({ status: 'REJECTED' }), S), []);
  assert.equal(model.isActionable(tropa, row({ registration_section_id: 's3' })), false);
});

test('contact reveal follows the contact capability; withdrawal notice defaults to the source', () => {
  assert.equal(model.canRevealContact(caps({ readContacts: scope('TROPA') }), row()), true);
  assert.equal(model.canRevealContact(caps({ review: scope('TROPA') }), row()), false, 'reviewing does not imply contact');
  assert.equal(model.defaultNotify('FAMILY_COMMUNICATION'), true);
  assert.equal(model.defaultNotify('OTHER'), false);
});

test('rows: linked participant name, declared section, withdrawal date; accessible name without contact data', () => {
  const short = () => '1 d’oct.';
  const r = row({ status: 'WITHDRAWN', withdrawn_at: 1, declared_section_id: 's3', participant: { id: 'p', name: 'Aina Fictícia' }, transport_code: 'GROUP' });
  assert.equal(model.displayName(r), 'Aina Fictícia');
  assert.equal(model.secondaryLine(r, { audience: 'GENERAL' }, S, short),
    'Sol·licitada el 1 d’oct. · Tropa · Declarada a Escolta · Transport del grup · Retirada el 1 d’oct.');
  assert.equal(model.accessibleRowName({ ...r, review_level: 'GLOBAL' }), 'Aina Fictícia, Retirada, en revisió global');
});

test('confirmed list grouped by section with transport totals', () => {
  const rows = [{ name: 'Zoe', registration_section_id: 's3', transport_code: 'GROUP' }, { name: 'Ana', registration_section_id: 's2', transport_code: 'FAMILY' },
    { name: 'Bru', registration_section_id: 's2', transport_code: 'GROUP' }];
  assert.deepEqual(model.groupConfirmed(rows, S).map(g => [g.label, g.rows.map(r => r.name)]), [['Tropa', ['Ana', 'Bru']], ['Escolta', ['Zoe']]]);
  assert.deepEqual(model.transportTotals(rows), { group: 2, family: 1 });
});
