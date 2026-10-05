// FASE 3.5H.2 — Noves altes UI: labels, filters, actions by state and capability, human errors, and the
// wiring of each action to its endpoint inside Participants.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as model from '../gestio/public/views/participants/admissions-model.js';

const source = file => readFileSync(join(import.meta.dirname, '..', 'gestio/public', file), 'utf8');

test('states are human; WAITLISTED is its own visible state; withdrawn is not rejected', () => {
  assert.deepEqual(['PENDING', 'IN_REVIEW', 'WAITLISTED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'].map(code => model.statusOf(code).label),
    ['Pendent', 'En revisió', 'Llista d’espera', 'Acceptada', 'Rebutjada', 'Retirada per la família']);
  assert.equal(model.statusOf('WAITLISTED').tone, 'waitlist');
  assert.ok(model.FILTERS.some(item => item.value === 'WAITLISTED'));
  assert.ok(model.REJECTIONS.every(item => !/_/.test(item.label)), 'categories, never free text');
});

test('actions follow state and capability; impossible ones are never offered', () => {
  const all = { manage: true, decide: true };
  assert.deepEqual(model.actionsFor({ status: 'PENDING' }, all), ['start-review', 'waitlist', 'section', 'reject', 'withdraw']);
  assert.deepEqual(model.actionsFor({ status: 'IN_REVIEW' }, all), ['waitlist', 'section', 'accept', 'reject', 'withdraw']);
  assert.deepEqual(model.actionsFor({ status: 'WAITLISTED' }, all), ['return-to-review', 'section', 'accept', 'reject', 'withdraw']);
  for (const status of ['ACCEPTED', 'REJECTED', 'WITHDRAWN']) assert.deepEqual(model.actionsFor({ status }, all), [], status);
  assert.deepEqual(model.actionsFor({ status: 'IN_REVIEW' }, { manage: false, decide: true }), ['accept', 'reject'], 'decide only');
  assert.deepEqual(model.actionsFor({ status: 'IN_REVIEW' }, { manage: false, decide: false }), []);
});

test('filters and errors', () => {
  assert.deepEqual(model.parseFilters({ estat: 'WAITLISTED', seccio: 'TROPA', q: ' lluna ' }), { estat: 'WAITLISTED', seccio: 'TROPA', q: 'lluna' });
  assert.deepEqual(model.parseFilters({ estat: 'HACK', seccio: 'X' }), { estat: '', seccio: '', q: '' });
  assert.equal(model.apiQuery({ estat: 'PENDING', seccio: 'TROPA', q: 'a' }), 'status=PENDING&section=TROPA&q=a');
  for (const code of ['admission_match_ambiguous', 'admission_link_confirmation_required', 'section_not_confirmed', 'admission_match_requires_secretary', 'stale_admission'])
    assert.doesNotMatch(model.errorCopy({ code }), /_|[A-Z]{4,}/, code);
  assert.equal(model.errorCopy({ status: 403 }), 'No tens permís per fer aquesta acció.');
  assert.equal(model.ageOn('2016-05-04', Date.parse('2026-10-05T00:00:00Z')), 10);
});

test('wiring: Noves altes lives in Participants and each action reaches its endpoint; no candidate list for public users', () => {
  const view = source('views/participants/admissions.js'), participants = source('views/participants.js');
  assert.match(participants, /id === 'altes'\) renderAdmissions\(\)/);
  assert.match(participants, /me\.capabilities\.admissions\?\.read/);
  for (const op of ['start-review', 'waitlist', 'return-to-review', 'section', 'reject', 'withdraw', 'resolve-match', 'accept'])
    assert.ok(view.includes(`'${op}'`), op);
  assert.ok(view.includes('/api/admissions/${id}/${op}`'));
  assert.ok(view.includes('linkParticipantId'), 'linking a known person is an explicit confirmation');
  assert.doesNotMatch(view, /innerHTML|style=|localStorage/);
  const site = readFileSync(join(import.meta.dirname, '..', 'api/_lib/handler.js'), 'utf8');
  assert.doesNotMatch(site, /candidates|participantId|match_status/, 'the public endpoint never handles matching');
});
