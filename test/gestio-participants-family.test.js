// FASE 3.5E Batch 4 — guardians, contacts, legal representation and the administrative review queue.
// The security core: scope by current section, no cross-section access through a shared guardian,
// audited contact consultation without values in the log, and the change-request workflow.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, id } from './helpers/gestio-sqlite.js';

const TROPA = id(2), ESCOLTA = id(3);
const TROPA_P = id(502), ESCOLTA_P = id(504);   // seed participants in Tropa and Escolta

async function setup() {
  const f = fixture();
  for (const user of [101, 102, 103, 104, 105]) await f.login(user);
  return f;
}
const guardianBody = (over = {}) => ({ name: 'Tutora Fictícia', relationship: 'PARENT', ...over });
const contactBody = (over = {}) => ({ ownerType: 'guardian', kind: 'PHONE', value: '600123456', ...over });
const audit = (f, action, resourceId) => f.sql.prepare('SELECT * FROM audit_event WHERE action=? AND resource_id=?').get(action, resourceId);

test('familia read model: contact scope required; out-of-scope and no-permission are distinguished correctly', async () => {
  const f = await setup();
  try {
    assert.equal((await f.request(104, `/api/participants/${TROPA_P}/familia`)).status, 403, 'treasury has no contact scope');
    assert.equal((await f.request(103, `/api/participants/${TROPA_P}/familia`)).status, 404, 'Escolta coordinator: concealed');
    const ok = await f.request(102, `/api/participants/${TROPA_P}/familia`);
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.data.guardians, []);
    assert.ok(Array.isArray(ok.data.participantContacts));
  } finally { f.close(); }
});

test('guardians and contacts: values only via an audited consultation that never logs the value', async () => {
  const f = await setup();
  try {
    const created = await f.request(102, `/api/participants/${TROPA_P}/guardians`, { method: 'POST', body: guardianBody({ legalRepresentative: false }) });
    assert.equal(created.status, 201);
    const gid = created.data.guardianId;
    const add = await f.request(102, `/api/participants/${TROPA_P}/contacts`, { method: 'POST', body: contactBody({ guardianId: gid }) });
    assert.equal(add.status, 201);
    const cid = add.data.id;
    // The read model lists that a phone exists, not its value.
    const familia = (await f.request(102, `/api/participants/${TROPA_P}/familia`)).data;
    assert.equal(familia.guardians.length, 1);
    assert.deepEqual(familia.guardians[0].contacts.map(c => c.kind), ['PHONE']);
    assert.equal('value' in familia.guardians[0].contacts[0], false);
    // Consultation returns the value and is audited without it.
    const consult = await f.request(102, `/api/contacts/${cid}`);
    assert.equal(consult.status, 200);
    assert.equal(consult.data.contact.value, '600123456');
    const event = audit(f, 'SENSITIVE_DATA_READ', cid);
    assert.ok(event && event.reason_code === 'CONTACT_CONSULTED');
    assert.equal(event.metadata_json, null, 'the value is never in the audit metadata');
    // Escolta coordinator cannot consult a Tropa-only guardian's contact.
    assert.equal((await f.request(103, `/api/contacts/${cid}`)).status, 404);
    assert.equal((await f.request(104, `/api/contacts/${cid}`)).status, 403);
  } finally { f.close(); }
});

test('shared guardian: a coordinator without scope over every linked participant cannot edit directly', async () => {
  const f = await setup();
  try {
    // Guardian linked to a Tropa participant by its coordinator, then to an Escolta participant by the group.
    const gid = (await f.request(102, `/api/participants/${TROPA_P}/guardians`, { method: 'POST', body: guardianBody() })).data.guardianId;
    assert.equal((await f.request(101, `/api/participants/${ESCOLTA_P}/guardians`, { method: 'POST', body: guardianBody({ guardianId: gid }) })).status, 201);
    // The Tropa coordinator no longer covers every linked participant → adding a contact becomes a request.
    const requested = await f.request(102, `/api/participants/${TROPA_P}/contacts`, { method: 'POST', body: contactBody({ guardianId: gid, kind: 'EMAIL', value: 'tutora@example.test' }) });
    assert.equal(requested.status, 201);
    assert.equal(requested.data.requested, true);
    assert.equal(f.sql.prepare("SELECT count(*) AS n FROM contact_point WHERE guardian_id=? AND ended_at IS NULL").get(gid).n, 0, 'nothing changed directly');
    const review = f.sql.prepare("SELECT * FROM participant_review WHERE kind='GUARDIAN_DATA_REQUEST'").get();
    assert.ok(review && review.status === 'OPEN' && review.guardian_id === gid);
    // The group coordinator, who covers both sections, edits directly.
    assert.equal((await f.request(101, `/api/participants/${TROPA_P}/contacts`, { method: 'POST', body: contactBody({ guardianId: gid, kind: 'EMAIL', value: 'directa@example.test' }) })).data.id != null, true);
    assert.equal(f.sql.prepare("SELECT count(*) AS n FROM contact_point WHERE guardian_id=? AND ended_at IS NULL").get(gid).n, 1);
  } finally { f.close(); }
});

test('legal representation: communicated opens a review and history; only Secretaria/coordination accredit', async () => {
  const f = await setup();
  try {
    const gid = (await f.request(102, `/api/participants/${TROPA_P}/guardians`, { method: 'POST', body: guardianBody({ legalRepresentative: true }) })).data.guardianId;
    const familia = (await f.request(102, `/api/participants/${TROPA_P}/familia`)).data.guardians[0];
    assert.equal(familia.legalRepresentative, true);
    assert.equal(familia.representationBasis, 'COMUNICAT');
    assert.equal(familia.representationPending, true, 'a review is open');
    assert.equal(f.sql.prepare("SELECT count(*) AS n FROM participant_review WHERE kind='REPRESENTATION_CHANGE' AND status='OPEN'").get().n, 1);
    assert.equal(f.sql.prepare("SELECT count(*) AS n FROM participant_representation_event WHERE action='SET_REPRESENTATIVE'").get().n, 1);
    // A section coordinator cannot accredit.
    assert.equal((await f.request(102, `/api/participants/${TROPA_P}/guardians/${gid}/accredit`, { method: 'POST', body: {} })).status, 403);
    // Secretaria accredits → basis ACREDITAT and a history event; it is not a review acknowledgement.
    const accredit = await f.request(105, `/api/participants/${TROPA_P}/guardians/${gid}/accredit`, { method: 'POST', body: {} });
    assert.equal(accredit.status, 200);
    assert.equal(f.sql.prepare('SELECT representation_basis FROM participant_guardian WHERE guardian_id=?').get(gid).representation_basis, 'ACREDITAT');
    assert.equal(f.sql.prepare("SELECT count(*) AS n FROM participant_representation_event WHERE action='ACCREDIT'").get().n, 1);
    // History is append-only.
    const evId = f.sql.prepare("SELECT id FROM participant_representation_event LIMIT 1").get().id;
    assert.throws(() => f.sql.exec(`UPDATE participant_representation_event SET action='X' WHERE id='${evId}'`), /immutable/);
  } finally { f.close(); }
});

test('review queue: Secretaria only; acknowledge, escalate (no data change) and apply a change request', async () => {
  const f = await setup();
  try {
    const gid = (await f.request(102, `/api/participants/${TROPA_P}/guardians`, { method: 'POST', body: guardianBody({ legalRepresentative: true }) })).data.guardianId;
    await f.request(101, `/api/participants/${ESCOLTA_P}/guardians`, { method: 'POST', body: guardianBody({ guardianId: gid }) });
    await f.request(102, `/api/participants/${TROPA_P}/contacts`, { method: 'POST', body: contactBody({ guardianId: gid, kind: 'EMAIL', value: 'demanada@example.test' }) });
    // A section coordinator cannot see or work the queue.
    assert.equal((await f.request(102, '/api/participant-reviews')).status, 403);
    const list = await f.request(105, '/api/participant-reviews');
    assert.equal(list.status, 200);
    const request = list.data.reviews.find(r => r.kind === 'GUARDIAN_DATA_REQUEST');
    assert.ok(request && request.payload.op === 'ADD_CONTACT');
    const summary = (await f.request(105, '/api/participant-reviews/summary')).data;
    assert.deepEqual([summary.open, summary.escalated], [list.data.reviews.filter(r => ['OPEN', 'INCIDENCE'].includes(r.status)).length, 0]);
    // Escalate a representation review: status changes, data does not.
    const repReview = list.data.reviews.find(r => r.kind === 'REPRESENTATION_CHANGE');
    assert.equal((await f.request(105, `/api/participant-reviews/${repReview.id}/escalate`, { method: 'POST', body: {} })).data.status, 'ESCALATED');
    // Apply the change request → the contact is added to the shared guardian and the review resolves.
    const applied = await f.request(105, `/api/participant-reviews/${request.id}/apply`, { method: 'POST', body: {} });
    assert.deepEqual([applied.status, applied.data.status], [200, 'RESOLVED']);
    assert.equal(f.sql.prepare("SELECT count(*) AS n FROM contact_point WHERE guardian_id=? AND kind='EMAIL' AND ended_at IS NULL").get(gid).n, 1);
    // Re-applying a resolved request is refused.
    assert.equal((await f.request(105, `/api/participant-reviews/${request.id}/apply`, { method: 'POST', body: {} })).status, 409);
  } finally { f.close(); }
});

test('IDOR through a shared guardian never reaches another section', async () => {
  const f = await setup();
  try {
    const gid = (await f.request(102, `/api/participants/${TROPA_P}/guardians`, { method: 'POST', body: guardianBody() })).data.guardianId;
    // Escolta coordinator cannot add to, end, or represent a guardian of a Tropa participant.
    assert.equal((await f.request(103, `/api/participants/${TROPA_P}/guardians/${gid}/representation`, { method: 'POST', body: { legalRepresentative: true } })).status, 404);
    assert.equal((await f.request(103, `/api/participants/${TROPA_P}/contacts`, { method: 'POST', body: contactBody({ guardianId: gid }) })).status, 404);
    assert.equal((await f.request(103, `/api/participants/${TROPA_P}/guardians/${gid}`, { method: 'DELETE' })).status, 404);
    // Linking that Tropa-only guardian from an Escolta participant is refused (not visible to 103).
    assert.equal((await f.request(103, `/api/participants/${ESCOLTA_P}/guardians`, { method: 'POST', body: guardianBody({ guardianId: gid }) })).status, 404);
  } finally { f.close(); }
});

test('out-of-scope duplicate on create opens a Secretaria review without disclosing the other section', async () => {
  const f = await setup();
  try {
    // 102 (Tropa) creates a participant whose name+birth date match an Escolta participant.
    const escolta = f.sql.prepare('SELECT display_name,birth_date FROM participant WHERE id=?').get(ESCOLTA_P);
    const created = await f.request(102, '/api/participants', { method: 'POST', body: { name: escolta.display_name, sectionId: TROPA, birthDate: escolta.birth_date } });
    assert.equal(created.status, 201);
    assert.equal(created.data.duplicateReview, true, 'the coordinator only learns a review was opened');
    const review = f.sql.prepare("SELECT kind,duplicate_of FROM participant_review WHERE kind='POSSIBLE_DUPLICATE_PARTICIPANT'").get();
    assert.deepEqual([review.kind, review.duplicate_of], ['POSSIBLE_DUPLICATE_PARTICIPANT', ESCOLTA_P]);
    // A group-wide creator sees duplicates in the UI, so no review is opened for them.
    const group = await f.request(101, '/api/participants', { method: 'POST', body: { name: escolta.display_name, sectionId: TROPA, birthDate: escolta.birth_date } });
    assert.equal(group.data.duplicateReview, false);
  } finally { f.close(); }
});
