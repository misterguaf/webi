// FASE 3.5E Batch 1 — participant management: differentiated permissions, scoped writes, optimistic
// concurrency, CRM_MANAGER retirement and age-based completeness. node:sqlite D1 stand-in.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, id } from './helpers/gestio-sqlite.js';
import { completeness, isAdult } from '../gestio/src/services/participant-service.js';
import { incompleteCount } from '../gestio/src/domains/participants/repository.js';

const MANADA = id(1), TROPA = id(2), ESCOLTA = id(3), CLAN = id(4);
const MINOR = id(502), ADULT = id(505);     // seed: 502 born 2013 (Tropa), 505 born 2007 (Clan)
const DAY = 86400000;

async function setup() {
  const f = fixture();
  for (const user of [101, 102, 103, 104, 105, 106, 107]) await f.login(user);
  return f;
}
const newParticipant = (overrides = {}) => ({ name: 'Nou Participant Fictici', sectionId: TROPA, birthDate: '2014-03-02', ...overrides });
const auditDenies = (f, user) => f.sql.prepare("SELECT count(*) AS n FROM audit_event WHERE actor_user_id=? AND action='AUTHZ_DENY'").get(id(user)).n;
const dataEvents = (f, action, resourceId) => f.sql.prepare('SELECT count(*) AS n FROM audit_event WHERE action=? AND resource_id=?').get(action, resourceId).n;
function addGuardianWithContact(f, participantId, { sectionId = TROPA } = {}) {
  const gid = crypto.randomUUID();
  f.sql.prepare("INSERT INTO guardian(id,display_name,status,created_at,updated_at) VALUES(?,?,'ACTIVE',1,1)").run(gid, 'Tutor Fictici');
  f.sql.prepare("INSERT INTO participant_guardian(id,participant_id,guardian_id,relationship,legal_representative,started_at) VALUES(?,?,?,'PARENT',1,1)").run(crypto.randomUUID(), participantId, gid);
  f.sql.prepare("INSERT INTO contact_point(id,guardian_id,kind,value,purpose,is_primary,created_at) VALUES(?,?,'PHONE','600000000','GENERAL',1,1)").run(crypto.randomUUID(), gid);
  void sectionId;
  return gid;
}

test('completeness rule: minors need guardian and contact, adults need only their own contact', () => {
  const now = Date.UTC(2026, 0, 1);
  assert.equal(isAdult('2007-06-01', now), true);
  assert.equal(isAdult('2008-06-01', now), false);
  assert.equal(isAdult(null, now), null);
  const minor = { birth_date: '2014-01-01' }, adult = { birth_date: '2006-01-01' };
  // no contacts, no guardians
  assert.deepEqual(completeness({ ...minor }, { canSeeContacts: true, now }), { complete: false, missing: ['guardian', 'contact'] });
  assert.deepEqual(completeness({ ...minor, has_guardian: 1, has_guardian_contact: 1 }, { canSeeContacts: true, now }), { complete: true, missing: [] });
  assert.deepEqual(completeness({ ...adult }, { canSeeContacts: true, now }), { complete: false, missing: ['contact'] });
  assert.deepEqual(completeness({ ...adult, has_own_contact: 1 }, { canSeeContacts: true, now }), { complete: true, missing: [] });
  assert.deepEqual(completeness({ ...adult, has_guardian_contact: 1 }, { canSeeContacts: true, now }), { complete: false, missing: ['contact'] },
    'an adult needs their OWN contact, not a guardian contact');
  // no birth date: only that is reported, whatever the contacts
  assert.deepEqual(completeness({ birth_date: null, has_guardian: 1, has_own_contact: 1 }, { canSeeContacts: true, now }), { complete: false, missing: ['birthDate'] });
  // no contact scope: only birth-date presence is knowable
  assert.deepEqual(completeness({ ...minor }, { canSeeContacts: false, now }), { complete: true, missing: [] });
  assert.deepEqual(completeness({ birth_date: null }, { canSeeContacts: false, now }), { complete: false, missing: ['birthDate'] });
});

test('create: manage scope decides the section; treasury and the retired CRM role cannot create', async () => {
  const f = await setup();
  try {
    const group = await f.request(101, '/api/participants', { method: 'POST', body: newParticipant({ sectionId: ESCOLTA }) });
    assert.equal(group.status, 201);
    assert.equal(group.data.version, 1);
    assert.equal(f.sql.prepare('SELECT current_section_id FROM participant WHERE id=?').get(group.data.id).current_section_id, ESCOLTA);
    assert.equal(dataEvents(f, 'DATA_CREATED', group.data.id), 1);
    assert.equal(f.sql.prepare("SELECT count(*) AS n FROM participant_section_membership WHERE participant_id=? AND ended_at IS NULL AND start_reason='ENROLMENT'").get(group.data.id).n, 1);

    assert.equal((await f.request(102, '/api/participants', { method: 'POST', body: newParticipant({ sectionId: TROPA }) })).status, 201, 'Tropa coordinator creates in Tropa');
    assert.equal((await f.request(102, '/api/participants', { method: 'POST', body: newParticipant({ sectionId: ESCOLTA }) })).status, 403, 'not in another section');
    assert.equal((await f.request(104, '/api/participants', { method: 'POST', body: newParticipant() })).status, 403, 'treasury has no participant management');
    assert.equal((await f.request(106, '/api/participants', { method: 'POST', body: newParticipant() })).status, 403, 'retired CRM role manages nothing');
    assert.equal((await f.request(105, '/api/participants', { method: 'POST', body: newParticipant({ sectionId: CLAN }) })).status, 201, 'Secretaria manages the whole group');
  } finally { f.close(); }
});

test('create validation: name, birth date and provenance are checked; a provisional record omits the birth date', async () => {
  const f = await setup();
  try {
    for (const body of [{ name: '', sectionId: TROPA }, { name: 'x'.repeat(121), sectionId: TROPA },
      newParticipant({ birthDate: '2013-13-40' }), newParticipant({ birthDate: '3000-01-01' }),
      newParticipant({ provenance: 'INVENTAT' }), newParticipant({ extra: 1 }), newParticipant({ sectionId: 'not-a-uuid' })])
      assert.equal((await f.request(101, '/api/participants', { method: 'POST', body })).status, 400, JSON.stringify(body));
    const provisional = await f.request(101, '/api/participants', { method: 'POST', body: { name: 'Provisional Fictici', sectionId: TROPA, provenance: 'DOCUMENTACIO_FISICA' } });
    assert.equal(provisional.status, 201);
    const detail = (await f.request(101, `/api/participants/${provisional.data.id}`)).data.participant;
    assert.equal(detail.birthDate, null);
    assert.deepEqual(detail.completeness, { complete: false, missing: ['birthDate'] });
    assert.equal(detail.provenance, 'DOCUMENTACIO_FISICA');
  } finally { f.close(); }
});

test('IDOR: a section coordinator cannot read, edit, move or deactivate a participant outside their section', async () => {
  const f = await setup();
  try {
    // 103 = Escolta coordinator; MINOR (502) is in Tropa.
    assert.equal((await f.request(103, `/api/participants/${MINOR}`)).status, 404, 'read is concealed');
    const edit = await f.request(103, `/api/participants/${MINOR}`, { method: 'PATCH', body: { name: 'Robat', expectedVersion: 1 } });
    assert.equal(edit.status, 404, 'edit is concealed, never 403');
    assert.equal((await f.request(103, `/api/participants/${MINOR}/deactivate`, { method: 'POST', body: { expectedVersion: 1 } })).status, 404);
    assert.equal((await f.request(103, `/api/participants/${MINOR}/section`, { method: 'POST', body: { sectionId: ESCOLTA, expectedVersion: 1 } })).status, 404);
    // A missing id is indistinguishable from an out-of-scope one.
    assert.equal((await f.request(103, `/api/participants/${id(90909)}`, { method: 'PATCH', body: { name: 'x', expectedVersion: 1 } })).status, 404);
    // No participant management at all: a uniform 403, never revealing existence.
    assert.equal((await f.request(104, `/api/participants/${MINOR}`, { method: 'PATCH', body: { name: 'x', expectedVersion: 1 } })).status, 403);
    assert.equal(f.sql.prepare('SELECT display_name FROM participant WHERE id=?').get(MINOR).display_name, 'Participante Tropa A (ficticio)');
    assert.ok(auditDenies(f, 103) >= 4, 'concealed denials are still audited');
  } finally { f.close(); }
});

test('edit: optimistic concurrency — the second writer of a version is refused and the first survives', async () => {
  const f = await setup();
  try {
    const seen = (await f.request(102, `/api/participants/${MINOR}`)).data.participant;
    assert.equal(seen.version, 1);
    const first = await f.request(102, `/api/participants/${MINOR}`, { method: 'PATCH', body: { name: 'Primer Nom', birthDate: '2013-05-18', expectedVersion: 1 } });
    assert.equal(first.status, 200);
    assert.equal(first.data.version, 2);
    const second = await f.request(102, `/api/participants/${MINOR}`, { method: 'PATCH', body: { name: 'Segon Nom', expectedVersion: 1 } });
    assert.equal(second.status, 409);
    assert.equal(second.data.error, 'stale_participant');
    const row = f.sql.prepare('SELECT display_name,version FROM participant WHERE id=?').get(MINOR);
    assert.deepEqual({ ...row }, { display_name: 'Primer Nom', version: 2 });
    assert.equal(dataEvents(f, 'DATA_UPDATED', MINOR), 1, 'the refused write left no audit');
    // Racing writers on the same version: one wins, the compare-and-set aborts the other.
    const race = await Promise.all(['A', 'B'].map(n => f.request(102, `/api/participants/${MINOR}`, { method: 'PATCH', body: { name: `Nom ${n}`, expectedVersion: 2 } })));
    assert.deepEqual(race.map(r => r.status).sort(), [200, 409]);
    assert.equal(f.sql.prepare('SELECT version FROM participant WHERE id=?').get(MINOR).version, 3);
  } finally { f.close(); }
});

test('deactivate and reactivate keep history and toggle membership; repeats are conflicts', async () => {
  const f = await setup();
  try {
    const v = (await f.request(102, `/api/participants/${MINOR}`)).data.participant.version;
    const off = await f.request(102, `/api/participants/${MINOR}/deactivate`, { method: 'POST', body: { expectedVersion: v } });
    assert.deepEqual([off.status, off.data.status], [200, 'INACTIVE']);
    assert.equal((await f.request(102, `/api/participants/${MINOR}/deactivate`, { method: 'POST', body: { expectedVersion: v + 1 } })).status, 409, 'already inactive');
    // Now invisible in the default list, visible under de-baixa.
    const active = (await f.request(102, '/api/participants?estat=actius')).data.participants.map(p => p.id);
    assert.ok(!active.includes(MINOR));
    const inactive = (await f.request(102, '/api/participants?estat=de-baixa')).data.participants.map(p => p.id);
    assert.ok(inactive.includes(MINOR));
    const on = await f.request(102, `/api/participants/${MINOR}/reactivate`, { method: 'POST', body: { expectedVersion: v + 1 } });
    assert.deepEqual([on.status, on.data.status], [200, 'ACTIVE']);
    const reasons = f.sql.prepare('SELECT start_reason FROM participant_section_membership WHERE participant_id=? ORDER BY started_at,rowid').all(MINOR).map(r => r.start_reason);
    assert.deepEqual(reasons, ['ENROLMENT', 'REACTIVATION']); // fixture() inserts after migration 0011, so the trigger records ENROLMENT
  } finally { f.close(); }
});

test('section change needs manage over both the current and the target section; history is kept', async () => {
  const f = await setup();
  try {
    const v = () => (f.sql.prepare('SELECT version FROM participant WHERE id=?').get(MINOR).version);
    // Tropa coordinator can manage the current section but not Escolta → 403.
    assert.equal((await f.request(102, `/api/participants/${MINOR}/section`, { method: 'POST', body: { sectionId: ESCOLTA, expectedVersion: v() } })).status, 403);
    assert.equal(f.sql.prepare('SELECT current_section_id FROM participant WHERE id=?').get(MINOR).current_section_id, TROPA);
    // Group coordinator moves it; the old membership closes as TRANSFER and a new one opens.
    const move = await f.request(101, `/api/participants/${MINOR}/section`, { method: 'POST', body: { sectionId: ESCOLTA, expectedVersion: v() } });
    assert.deepEqual([move.status, move.data.sectionId], [200, ESCOLTA]);
    const history = f.sql.prepare('SELECT section_id,ended_at IS NULL AS open,end_reason FROM participant_section_membership WHERE participant_id=? ORDER BY started_at,rowid').all(MINOR);
    assert.equal(history.length, 2);
    assert.equal(history[0].end_reason, 'TRANSFER');
    assert.equal(history[1].open, 1);
    // The former Tropa coordinator now loses access.
    assert.equal((await f.request(102, `/api/participants/${MINOR}`)).status, 404);
    // Moving to the same section is rejected.
    assert.equal((await f.request(101, `/api/participants/${MINOR}/section`, { method: 'POST', body: { sectionId: ESCOLTA, expectedVersion: v() } })).status, 409);
  } finally { f.close(); }
});

test('list completeness: adults need only a contact; minors need a guardian and a contact', async () => {
  const f = await setup();
  try {
    // Seeded participants already carry a mirrored notification e-mail (migration 0011), so they have
    // an own contact. The adult is therefore complete; each minor only lacks a guardian.
    const byId = async user => Object.fromEntries((await f.request(user, '/api/participants')).data.participants.map(p => [p.id, p.completeness]));
    const group = await byId(101);
    assert.deepEqual(group[ADULT], { complete: true, missing: [] });
    assert.deepEqual(group[MINOR].missing, ['guardian']);
    // Give the minor a guardian with a contact → complete.
    addGuardianWithContact(f, MINOR);
    assert.deepEqual((await byId(102))[MINOR], { complete: true, missing: [] });
  } finally { f.close(); }
});

test('Dashboard follow-up: scoped count of incomplete active records', async () => {
  const f = await setup();
  try {
    const { authorize } = await import('../gestio/src/policy.js');
    f.sql.prepare("INSERT INTO contact_point(id,participant_id,kind,value,purpose,is_primary,created_at) VALUES(?,?,'EMAIL','clan@example.test','GENERAL',1,1)").run(crypto.randomUUID(), ADULT);
    const scoped = await authorize(f.db, f.context[102], { permission: 'participants.profile.manage', mode: 'list' });
    const group = await authorize(f.db, f.context[101], { permission: 'participants.profile.manage', mode: 'list' });
    const tropaCount = await incompleteCount(f.db, scoped);
    const groupCount = await incompleteCount(f.db, group);
    assert.equal(tropaCount, 2, 'both Tropa minors are incomplete');
    assert.equal(groupCount, 4, 'the Clan adult with a contact is complete; the other four are not');
    addGuardianWithContact(f, MINOR);
    assert.equal(await incompleteCount(f.db, scoped), 1);
  } finally { f.close(); }
});

test('CRM retirement: the role cannot be assigned and its holder manages no participants', async () => {
  const f = await setup();
  try {
    const assign = await f.request(101, `/api/users/${id(107)}/roles`, { method: 'POST', body: { roleCode: 'CRM_MANAGER' } });
    assert.deepEqual([assign.status, assign.data.error], [409, 'role_retired']);
    // The seeded CRM user 106 keeps its historical role but manages and reads nothing.
    assert.equal((await f.request(106, '/api/participants')).status, 403);
    assert.equal((await f.request(106, '/api/participants', { method: 'POST', body: newParticipant() })).status, 403);
  } finally { f.close(); }
});

test('capabilities expose the participant management scopes without provoking denials', async () => {
  const f = await setup();
  try {
    const me = async user => (await f.request(user, '/api/me')).data.capabilities.participants;
    const group = await me(101);
    assert.deepEqual(group.read, { all: true, sections: [] });
    assert.deepEqual(group.manage, { all: true, sections: [] });
    assert.equal(group.accredit, true);
    assert.equal(group.review, true);
    const tropa = await me(102);
    assert.deepEqual(tropa.manage.sections.map(s => s.code), ['TROPA']);
    assert.deepEqual(tropa.readContacts.sections.map(s => s.code), ['TROPA']);
    assert.equal(tropa.accredit, false, 'section coordinators do not accredit');
    assert.equal(tropa.review, false);
    const secretary = await me(105);
    assert.deepEqual(secretary.manage, { all: true, sections: [] });
    assert.equal(secretary.accredit, true);
    assert.equal(secretary.review, true);
    for (const user of [104, 107]) {
      const caps = await me(user);
      assert.equal(caps.read, null);
      assert.equal(caps.manage, null);
    }
    assert.equal(auditDenies(f, 101), 0);
  } finally { f.close(); }
});

test('Dashboard follow-up endpoint is scoped and gated on manage', async () => {
  const f = await setup();
  try {
    assert.equal((await f.request(104, '/api/participants/follow-up')).status, 403, 'treasury has no manage');
    const tropa = await f.request(102, '/api/participants/follow-up');
    assert.deepEqual([tropa.status, tropa.data.incomplete], [200, 2], 'only the Tropa minors');
    const group = await f.request(101, '/api/participants/follow-up');
    assert.equal(group.data.incomplete, 4, 'the Clan adult has a contact and is complete');
  } finally { f.close(); }
});
