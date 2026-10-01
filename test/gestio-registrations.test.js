// FASE 3.5F — Inscripcions v1.0 backend: authorisation order (no existence oracles), historical
// registration section, escalation and section correction, submitter contact on demand, withdrawal,
// notices, the payment projection, evidence preview/download with audit, queue and confirmed list.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, id } from './helpers/gestio-sqlite.js';
import { purgeVerifiedEvidence, submitRegistration } from '../gestio/src/services/registration-service.js';

const MANADA = id(1), TROPA = id(2), ESCOLTA = id(3);
const FREE_TROPA = id(801), PAID_ESCOLTA = id(802), GENERAL = id(803);
const CONFIRMED_TROPA = id(821), AWAITING_ESCOLTA = id(822), EVIDENCE = id(831);
const PDF = new TextEncoder().encode('%PDF-1.4\n%synthetic evidence fixture\n%%EOF');

function storage() {
  const objects = new Map([['fixture-only/no-binary', PDF]]);
  return { objects,
    async put(key, value) { objects.set(key, value); },
    async get(key) { return objects.has(key) ? { body: objects.get(key) } : null; },
    async delete(key) { objects.delete(key); } };
}
async function setup() {
  const f = fixture();
  for (const user of [101, 102, 103, 104, 105, 106, 107]) await f.login(user);
  const store = storage();
  const call = (user, path, options = {}) => f.request(user, path, { ...options, env: { EVIDENCE_STORAGE: store } });
  return { f, store, call };
}
const row = (f, rid) => f.sql.prepare('SELECT * FROM activity_registration WHERE id=?').get(rid);
const auditRows = (f, action, resourceId) => f.sql.prepare('SELECT * FROM audit_event WHERE action=? AND resource_id=?').all(action, resourceId);
const notices = (f, rid) => f.sql.prepare('SELECT kind FROM notification_outbox WHERE registration_id=? ORDER BY kind').all(rid).map(r => r.kind);
let seq = 0;
const intake = (f, over) => submitRegistration(f.db, storage(), {
  publicCode: 'DEMO-GENERAL', participantName: 'Persona Nova (ficticia)', birthDate: '2012-01-01', submittedByName: 'Tutor fictici',
  contactPhone: '600000001', sectionCode: 'TROPA', receiptEmail: 'familia.nova@example.test',
  idempotencyKey: `registration-test-${String(++seq).padStart(8, '0')}`, participationTermsVersion: 'DEMO-3A-PARTICIPATION-V1',
  privacyNoticeVersion: 'DEMO-3A-PRIVACY-NOTICE-V1', ...over }, crypto.randomUUID());
const latest = (f, name) => f.sql.prepare('SELECT * FROM activity_registration WHERE submitted_name=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(name);
// Give user 105 (Tropa delegate) a ratified Tropa delegation of finance.payment.verify.
function delegateVerify(f) {
  f.sql.exec(`INSERT INTO delegated_permission(id,user_id,permission_code,section_id,authorized_by,provisioned_by,authorization_reference,granted_at,expires_at,
    ratification_status,ratified_at,ratified_by,ratification_reference) VALUES('${id(9741)}','${id(105)}','finance.payment.verify','${TROPA}',
    '${id(102)}','${id(107)}','DEMO-AUTH-TROPA-PAY',1700000000000,4102444800000,'RATIFIED',1700000000001,'${id(101)}','DEMO-RATIFIED-TROPA-PAY')`);
}

test('authorisation order: no capability → 403; missing and out of scope → the same 404, before any state check', async () => {
  const { f, call } = await setup();
  try {
    const missing = id(99999);
    const v = row(f, AWAITING_ESCOLTA).version;
    const writes = [['review', { decision: 'REJECT' }], ['escalate', { expectedVersion: v }], ['section', { sectionId: TROPA, expectedVersion: v }],
      ['withdraw', { source: 'OTHER', expectedVersion: v }]];
    // Tropa coordinator vs an Escolta registration that is not even pending (a 409 would confirm it).
    for (const target of [AWAITING_ESCOLTA, missing]) {
      assert.deepEqual((await call(102, `/api/registrations/${target}/candidates`)).data.error, 'not_found');
      for (const [action, body] of writes) {
        const response = await call(102, `/api/registrations/${target}/${action}`, { method: 'POST', body });
        assert.equal(response.status, 404, `${action} on ${target}`);
        assert.equal(response.data.error, 'not_found');
      }
      assert.equal((await call(102, `/api/registrations/${target}/contact`)).status, 404);
    }
    // No registration capability at all: 403 whatever the id.
    for (const target of [AWAITING_ESCOLTA, missing]) {
      assert.equal((await call(104, `/api/registrations/${target}/candidates`)).status, 403);
      assert.equal((await call(104, `/api/registrations/${target}/withdraw`, { method: 'POST', body: { source: 'OTHER', expectedVersion: 1 } })).status, 403);
      assert.equal((await call(105, `/api/registrations/${target}/contact`)).status, 403, 'no contact grant');
    }
    // Payments: 403 without verify; a Tropa verifier gets 404 for an Escolta payment, like a missing one.
    delegateVerify(f);
    assert.equal((await call(102, `/api/payments/${EVIDENCE}`)).status, 403);
    for (const path of [`/api/payments/${EVIDENCE}`, `/api/payments/${id(99998)}`, `/api/payments/${EVIDENCE}/evidence?mode=view`]) {
      const response = await call(105, path);
      assert.equal(response.status, 404, path);
    }
    assert.equal((await call(105, `/api/payments/${EVIDENCE}/review`, { method: 'POST', body: { decision: 'VERIFIED' } })).status, 404);
    // Linking to a participant outside the reviewer's scope is indistinguishable from a missing participant.
    await intake(f, { participantName: 'Persona Sense Fitxa (ficticia)', publicCode: 'DEMO-FREE-TROPA' });
    const pending = latest(f, 'Persona Sense Fitxa (ficticia)');
    for (const participantId of [id(504), id(99997)])
      assert.equal((await call(102, `/api/registrations/${pending.id}/review`, { method: 'POST', body: { decision: 'MATCH', participantId, expectedVersion: pending.version } })).status, 404);
    assert.equal(row(f, AWAITING_ESCOLTA).status, 'AWAITING_PAYMENT_REVIEW');
    assert.ok(f.sql.prepare("SELECT count(*) AS n FROM audit_event WHERE action='AUTHZ_DENY' AND reason_code IN ('OUT_OF_SCOPE','NOT_FOUND')").get().n > 0);
  } finally { f.close(); }
});

test('historical section: a later section change of the participant moves neither the registration nor its payment', async () => {
  const { f, call } = await setup();
  try {
    delegateVerify(f);
    // A paid Tropa registration linked to 502, with evidence pending.
    f.sql.exec(`INSERT INTO activity(id,public_code,name,status,audience,location,starts_at,ends_at,registration_deadline,price_cents,currency,
      short_description,materials,special_notice,created_by,created_at,updated_at) VALUES('${id(9810)}','DEMO-PAID-TROPA-H','Sortida pagada fictícia',
      'PUBLISHED','SECTIONS','Lloc fictici',2209075200000,2209161600000,2208988800000,900,'EUR','Prova','','','${id(101)}',1,1);
      INSERT INTO activity_section(activity_id,section_id) VALUES('${id(9810)}','${TROPA}');`);
    await submitRegistration(f.db, storage(), { publicCode: 'DEMO-PAID-TROPA-H', participantName: 'Participante Tropa A (ficticio)',
      birthDate: '2013-05-18', submittedByName: 'Tutor fictici', sectionCode: 'TROPA', receiptEmail: 'historic@example.test',
      idempotencyKey: 'historic-section-test-0001', participationTermsVersion: 'DEMO-3A-PARTICIPATION-V1', privacyNoticeVersion: 'DEMO-3A-PRIVACY-NOTICE-V1',
      evidence: { filename: 'justificant.pdf', mime: 'application/pdf', dataBase64: Buffer.from(PDF).toString('base64') } }, crypto.randomUUID());
    const reg = f.sql.prepare("SELECT * FROM activity_registration WHERE activity_id=?").get(id(9810));
    assert.equal(reg.status, 'AWAITING_PAYMENT_REVIEW');
    assert.equal(reg.registration_section_id, TROPA);
    // The participant moves to Escolta.
    assert.equal((await call(101, `/api/participants/${id(502)}/section`, { method: 'POST', body: { sectionId: ESCOLTA, expectedVersion: 1 } })).status, 200);
    assert.equal(row(f, reg.id).registration_section_id, TROPA);
    const tropaList = (await call(102, `/api/activities/${id(9810)}/registrations`)).data.registrations;
    assert.deepEqual(tropaList.map(r => r.id), [reg.id]);
    assert.equal((await call(103, `/api/activities/${id(9810)}/registrations`)).status, 404, 'Escolta never sees the Tropa registration');
    const payments = (await call(105, `/api/payments?activityId=${id(9810)}`)).data.payments;
    assert.deepEqual(payments.map(p => p.registrationId), [reg.id], 'the payment stays with Tropa verifiers');
    const summary = (await call(102, '/api/activities')).data.activities.find(a => a.id === id(9810)).registrations;
    assert.equal(summary.total, 1);
  } finally { f.close(); }
});

test('escalation: a match in another section goes to global review without disclosure; correction and link by a global reviewer', async () => {
  const { f, call } = await setup();
  try {
    const result = await intake(f, { participantName: 'Participante Escolta A (ficticio)', birthDate: '2009-04-26', sectionCode: 'TROPA' });
    assert.deepEqual(result, { ok: true }, 'the portal answer is unchanged');
    const reg = latest(f, 'Participante Escolta A (ficticio)');
    assert.deepEqual([reg.status, reg.review_level, reg.escalation_reason, reg.registration_section_id, reg.participant_id],
      ['NEEDS_PARTICIPANT_REVIEW', 'GLOBAL', 'POSSIBLE_OTHER_SECTION', TROPA, null]);
    assert.equal(auditRows(f, 'REGISTRATION_ESCALATED', reg.id).length, 1);
    // The Tropa reviewer sees the row, flagged, with no reason, no candidates and no actions.
    const tropaRow = (await call(102, `/api/activities/${GENERAL}/registrations`)).data.registrations.find(r => r.id === reg.id);
    assert.equal(tropaRow.review_level, 'GLOBAL');
    assert.ok(!('escalation_reason' in tropaRow));
    assert.ok(!JSON.stringify(tropaRow).includes(id(504)) && !JSON.stringify(tropaRow).includes('ESCOLTA'));
    assert.equal((await call(102, `/api/registrations/${reg.id}/candidates`)).status, 403);
    assert.equal((await call(102, `/api/registrations/${reg.id}/review`, { method: 'POST', body: { decision: 'REJECT' } })).data.error, 'global_review_required');
    assert.equal((await call(102, `/api/registrations/${reg.id}/withdraw`, { method: 'POST', body: { source: 'OTHER', expectedVersion: reg.version } })).status, 403);
    const tropaSummary = (await call(102, '/api/registrations/queue/summary')).data.registrations;
    assert.deepEqual([tropaSummary.pending, tropaSummary.escalated, tropaSummary.actionable], [0, 1, 0]);
    // The global reviewer sees the reason and the candidate in Escolta, flagged as a different section.
    const globalRow = (await call(101, `/api/activities/${GENERAL}/registrations`)).data.registrations.find(r => r.id === reg.id);
    assert.equal(globalRow.escalation_reason, 'POSSIBLE_OTHER_SECTION');
    const candidates = (await call(101, `/api/registrations/${reg.id}/candidates`)).data;
    const escolta = candidates.candidates.find(c => c.id === id(504));
    assert.equal(escolta.section_matches, false);
    assert.equal((await call(101, `/api/registrations/${reg.id}/review`, { method: 'POST', body: { decision: 'MATCH', participantId: id(504), expectedVersion: reg.version } })).data.error, 'section_mismatch');
    // Correct the section (GENERAL admits Escolta), then link.
    const corrected = await call(101, `/api/registrations/${reg.id}/section`, { method: 'POST', body: { sectionId: ESCOLTA, expectedVersion: reg.version } });
    assert.equal(corrected.status, 200);
    const after = row(f, reg.id);
    assert.deepEqual([after.submitted_section_id, after.registration_section_id, after.review_level, after.version], [TROPA, ESCOLTA, 'SECTION', reg.version + 1]);
    const history = f.sql.prepare('SELECT * FROM activity_registration_section_change WHERE registration_id=?').all(reg.id);
    assert.deepEqual(history.map(h => [h.from_section_id, h.to_section_id, h.changed_by, h.reason]), [[TROPA, ESCOLTA, id(101), 'CORRECTION']]);
    const correctionAudit = auditRows(f, 'REGISTRATION_SECTION_CORRECTED', reg.id);
    assert.equal(correctionAudit.length, 1);
    assert.equal(correctionAudit[0].metadata_json, null, 'identifiers only, no personal data');
    // Now it belongs to Escolta: Tropa no longer sees it, Escolta does and can link it.
    assert.ok(!(await call(102, `/api/activities/${GENERAL}/registrations`)).data.registrations.some(r => r.id === reg.id));
    assert.equal((await call(103, `/api/registrations/${reg.id}/review`, { method: 'POST',
      body: { decision: 'MATCH', participantId: id(504), expectedVersion: after.version } })).data.status, 'CONFIRMED');
  } finally { f.close(); }
});

test('manual escalation and section correction rules: pending only, audience, both sections, version', async () => {
  const { f, call } = await setup();
  try {
    await intake(f, { participantName: 'Persona Equivocada (ficticia)', publicCode: 'DEMO-FREE-TROPA' });
    const reg = latest(f, 'Persona Equivocada (ficticia)');
    assert.equal(reg.review_level, 'SECTION');
    // SECTIONS activity (Tropa only): Escolta is outside the audience — never forced.
    assert.equal((await call(101, `/api/registrations/${reg.id}/section`, { method: 'POST', body: { sectionId: ESCOLTA, expectedVersion: reg.version } })).data.error,
      'section_not_in_audience');
    // A Tropa coordinator cannot move a GENERAL registration to Escolta (no authority over the target).
    await intake(f, { participantName: 'Persona General (ficticia)' });
    const general = latest(f, 'Persona General (ficticia)');
    assert.equal((await call(102, `/api/registrations/${general.id}/section`, { method: 'POST', body: { sectionId: ESCOLTA, expectedVersion: general.version } })).status, 403);
    assert.equal((await call(102, `/api/registrations/${general.id}/section`, { method: 'POST', body: { sectionId: ESCOLTA } })).status, 403);
    // Version is mandatory and checked.
    assert.equal((await call(101, `/api/registrations/${general.id}/section`, { method: 'POST', body: { sectionId: ESCOLTA } })).data.error, 'invalid_version');
    assert.equal((await call(101, `/api/registrations/${general.id}/section`, { method: 'POST', body: { sectionId: ESCOLTA, expectedVersion: 7 } })).data.error, 'stale_registration');
    // Manual escalation by the section reviewer, once.
    const escalated = await call(102, `/api/registrations/${reg.id}/escalate`, { method: 'POST', body: { expectedVersion: reg.version } });
    assert.equal(escalated.status, 200);
    assert.deepEqual([row(f, reg.id).review_level, row(f, reg.id).escalation_reason, row(f, reg.id).escalated_by], ['GLOBAL', 'REVIEWER_REQUEST', id(102)]);
    assert.equal((await call(101, `/api/registrations/${reg.id}/escalate`, { method: 'POST', body: { expectedVersion: reg.version + 1 } })).data.error, 'invalid_transition');
    // Not pending: no correction.
    assert.equal((await call(101, `/api/registrations/${CONFIRMED_TROPA}/section`, { method: 'POST', body: { sectionId: MANADA, expectedVersion: 1 } })).data.error, 'invalid_transition');
    // Secretaria with the 0018 matrix and individual grants is a global reviewer, without activities.manage.
    for (const [n, code] of [[9901, 'activities.read'], [9902, 'activities.registration.review']])
      f.sql.exec(`INSERT INTO user_permission_grant(id,user_id,permission_code,valid_from,granted_by,justification) VALUES('${id(n)}','${id(105)}','${code}',1,NULL,'Fixture sintético')`);
    assert.equal((await call(105, `/api/registrations/${reg.id}/candidates`)).status, 200, 'Secretaria acts on escalated cases');
    const { authorize } = await import('../gestio/src/policy.js');
    assert.equal((await authorize(f.db, f.context[105], { permission: 'activities.manage', mode: 'list' })).allow, false);
    assert.equal((await authorize(f.db, f.context[105], { permission: 'activities.general.manage' })).allow, false);
  } finally { f.close(); }
});

test('submitter contact: never in lists; explicit, scoped request audited without values', async () => {
  const { f, call } = await setup();
  try {
    for (const user of [101, 102]) {
      const list = (await call(user, `/api/activities/${FREE_TROPA}/registrations`)).data;
      const text = JSON.stringify(list);
      for (const secret of ['demo821@example.test', 'receipt_email', 'contact_phone', 'submitted_by_name', 'submitted_birth_date']) assert.ok(!text.includes(secret), secret);
    }
    const response = await call(102, `/api/registrations/${CONFIRMED_TROPA}/contact`);
    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(response.data.contact).sort(), ['email', 'phone', 'submittedByName']);
    assert.equal(response.data.contact.email, 'demo821@example.test');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const audit = f.sql.prepare("SELECT * FROM audit_event WHERE action='SENSITIVE_DATA_READ' AND resource_id=?").all(CONFIRMED_TROPA);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].reason_code, 'REGISTRATION_CONTACT_CONSULTED');
    assert.ok(!JSON.stringify(f.sql.prepare('SELECT * FROM audit_event').all()).includes('demo821@example.test'));
  } finally { f.close(); }
});

test('rejection notifies neutrally; withdrawal keeps link, evidence and payment; a new request creates a new registration', async () => {
  const { f, call } = await setup();
  try {
    await intake(f, { participantName: 'Persona Rebutjada (ficticia)', publicCode: 'DEMO-FREE-TROPA', receiptEmail: 'rebuig@example.test' });
    const rejected = latest(f, 'Persona Rebutjada (ficticia)');
    assert.equal((await call(102, `/api/registrations/${rejected.id}/review`, { method: 'POST', body: { decision: 'REJECT', expectedVersion: rejected.version } })).data.status, 'REJECTED');
    assert.deepEqual(notices(f, rejected.id), ['RECEIVED', 'REJECTED']);
    assert.equal((await call(102, `/api/registrations/${rejected.id}/withdraw`, { method: 'POST', body: { source: 'OTHER', expectedVersion: rejected.version + 1 } })).data.error, 'invalid_transition');
    // Confirmed (Tropa, free) → withdrawn by the family: default confirmation notice.
    const confirmed = row(f, CONFIRMED_TROPA);
    const withdrawn = await call(102, `/api/registrations/${CONFIRMED_TROPA}/withdraw`, { method: 'POST', body: { source: 'FAMILY_COMMUNICATION', expectedVersion: confirmed.version } });
    assert.equal(withdrawn.status, 200);
    const after = row(f, CONFIRMED_TROPA);
    assert.deepEqual([after.status, after.participant_id, after.withdrawal_source, after.withdrawn_by], ['WITHDRAWN', id(503), 'FAMILY_COMMUNICATION', id(102)]);
    assert.ok(notices(f, CONFIRMED_TROPA).includes('WITHDRAWN'));
    assert.equal(auditRows(f, 'REGISTRATION_WITHDRAWN', CONFIRMED_TROPA)[0].reason_code, 'FAMILY_COMMUNICATION');
    // A new request for the same person creates a new registration; the withdrawn one stays.
    await intake(f, { publicCode: 'DEMO-FREE-TROPA', participantName: 'Participante Tropa B (ficticio)', birthDate: '2012-11-03', receiptEmail: 'nova@example.test' });
    const rows = f.sql.prepare('SELECT status FROM activity_registration WHERE activity_id=? AND participant_id=? ORDER BY created_at').all(FREE_TROPA, id(503));
    assert.deepEqual(rows.map(r => r.status), ['WITHDRAWN', 'CONFIRMED']);
    // Paid, awaiting payment (Escolta) → withdrawn for another reason: no notice by default; payment kept and still reviewable.
    const paid = row(f, AWAITING_ESCOLTA);
    assert.equal((await call(103, `/api/registrations/${AWAITING_ESCOLTA}/withdraw`, { method: 'POST', body: { source: 'OTHER', expectedVersion: paid.version } })).status, 200);
    assert.ok(!notices(f, AWAITING_ESCOLTA).includes('WITHDRAWN'));
    const payment = (await call(104, `/api/payments/${EVIDENCE}`)).data.payment;
    assert.deepEqual([payment.registrationState, payment.paymentState], ['WITHDRAWN', 'PENDING_REVIEW']);
    assert.equal((await call(104, `/api/payments/${EVIDENCE}/review`, { method: 'POST', body: { decision: 'VERIFIED' } })).data.status, 'VERIFIED');
    assert.equal(row(f, AWAITING_ESCOLTA).status, 'WITHDRAWN', 'verifying never revives a withdrawn registration (no refund implied)');
    assert.ok(!notices(f, AWAITING_ESCOLTA).includes('CONFIRMED'));
    // Explicit choice overrides the default.
    await intake(f, { participantName: 'Persona Retirada (ficticia)', publicCode: 'DEMO-FREE-TROPA', receiptEmail: 'retirada@example.test' });
    const pending = latest(f, 'Persona Retirada (ficticia)');
    assert.equal((await call(102, `/api/registrations/${pending.id}/withdraw`, { method: 'POST', body: { source: 'OTHER', notifyFamily: true, expectedVersion: pending.version } })).status, 200);
    assert.deepEqual([row(f, pending.id).submitted_birth_date, notices(f, pending.id).includes('WITHDRAWN')], [null, true]);
  } finally { f.close(); }
});

test('payment projection: purpose-limited fields, server-side activity filter, incidence stays actionable, no activities.read', async () => {
  const { f, call } = await setup();
  try {
    assert.equal((await call(104, '/api/activities')).status, 403, 'Tresoreria does not read Activitats');
    const list = (await call(104, `/api/payments?activityId=${PAID_ESCOLTA}`)).data.payments;
    assert.equal(list.length, 1);
    assert.deepEqual(Object.keys(list[0]).sort(), ['activity', 'amountCents', 'evidence', 'id', 'paymentState', 'registrationId', 'registrationState', 'reviewedAt', 'submittedName', 'transport'].sort(),
      'no participant without profile access; transport because the activity has options; no section (not GENERAL); no contact');
    assert.deepEqual(Object.keys(list[0].activity).sort(), ['id', 'name', 'startsAt']);
    assert.deepEqual((await call(104, `/api/payments?activityId=${FREE_TROPA}`)).data.payments, []);
    const withProfile = (await call(101, `/api/payments?activityId=${PAID_ESCOLTA}`)).data.payments[0];
    assert.deepEqual(withProfile.participant, { id: id(504), name: 'Participante Escolta A (ficticio)' });
    assert.equal((await call(104, '/api/payments?vista=x')).status, 400);
    // Incidence: listed under incidències, evidence still viewable, later verified.
    assert.equal((await call(104, `/api/payments/${EVIDENCE}/review`, { method: 'POST', body: { decision: 'ISSUE' } })).data.status, 'ISSUE');
    assert.deepEqual((await call(104, '/api/payments?vista=pendents')).data.payments.map(p => p.id), []);
    assert.deepEqual((await call(104, '/api/payments?vista=incidencies')).data.payments.map(p => p.id), [EVIDENCE]);
    assert.equal((await call(104, `/api/payments/${EVIDENCE}/evidence?mode=view`)).status, 200);
    assert.equal((await call(104, `/api/payments/${EVIDENCE}/review`, { method: 'POST', body: { decision: 'VERIFIED' } })).data.status, 'VERIFIED');
    assert.equal(row(f, AWAITING_ESCOLTA).status, 'CONFIRMED');
    assert.deepEqual(notices(f, AWAITING_ESCOLTA), ['CONFIRMED', 'PAYMENT_ISSUE', 'PENDING_PAYMENT']);
    assert.ok(f.sql.prepare("SELECT 1 FROM notification_outbox o WHERE o.kind='PAYMENT_ISSUE'").get());
    const summary = (await call(104, '/api/registrations/queue/summary')).data;
    assert.deepEqual([summary.registrations, summary.payments], [null, { pending: 0, issues: 0 }]);
    // Section coordinators do not verify.
    assert.equal((await call(103, `/api/payments`)).status, 403);
  } finally { f.close(); }
});

test('evidence: authenticated preview and download with the detected type, separately audited, never the content; purge keeps history', async () => {
  const { f, call, store } = await setup();
  try {
    const view = await call(104, `/api/payments/${EVIDENCE}/evidence?mode=view`);
    assert.equal(view.status, 200);
    assert.equal(view.headers.get('content-type'), 'application/pdf');
    assert.equal(view.headers.get('content-disposition'), 'inline');
    assert.equal(view.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.match(view.headers.get('content-security-policy'), /frame-ancestors 'self'/);
    assert.equal(view.headers.get('cache-control'), 'no-store');
    assert.equal(view.headers.get('x-content-type-options'), 'nosniff');
    const download = await call(104, `/api/payments/${EVIDENCE}/evidence`);
    assert.equal(download.headers.get('content-disposition'), 'attachment; filename="justificant-2023-11-14.pdf"');
    assert.equal(download.headers.get('x-frame-options'), 'DENY');
    assert.equal((await call(104, `/api/payments/${EVIDENCE}/evidence?mode=raw`)).status, 400);
    assert.equal(auditRows(f, 'PAYMENT_EVIDENCE_VIEWED', EVIDENCE).length, 1);
    assert.equal(auditRows(f, 'PAYMENT_EVIDENCE_DOWNLOADED', EVIDENCE).length, 1);
    assert.ok(!JSON.stringify(f.sql.prepare('SELECT * FROM audit_event').all()).includes('synthetic evidence fixture'));
    // Retention-ready: only verified evidence; the row and its history stay; the file is gone.
    await assert.rejects(purgeVerifiedEvidence(f.db, store, crypto.randomUUID(), EVIDENCE), /invalid_transition/);
    await call(104, `/api/payments/${EVIDENCE}/review`, { method: 'POST', body: { decision: 'VERIFIED' } });
    await purgeVerifiedEvidence(f.db, store, crypto.randomUUID(), EVIDENCE);
    assert.equal(store.objects.has('fixture-only/no-binary'), false);
    assert.equal((await call(104, `/api/payments/${EVIDENCE}/evidence?mode=view`)).status, 410);
    const payment = (await call(104, `/api/payments/${EVIDENCE}`)).data.payment;
    assert.deepEqual([payment.paymentState, payment.evidence.available], ['VERIFIED', false]);
    assert.equal(auditRows(f, 'PAYMENT_EVIDENCE_PURGED', EVIDENCE).length, 1);
  } finally { f.close(); }
});

test('global queue and summary: per-activity counts within scope, partial GENERAL, views', async () => {
  const { f, call } = await setup();
  try {
    await intake(f, { participantName: 'Persona Cua Tropa (ficticia)' });
    await intake(f, { participantName: 'Persona Cua Escolta (ficticia)', sectionCode: 'ESCOLTA' });
    const tropa = (await call(102, '/api/registrations/queue')).data;
    const general = tropa.activities.find(a => a.id === GENERAL);
    assert.deepEqual([general.scope, general.sections, general.counts.actionable], ['PARTIAL', ['TROPA'], 1], 'Escolta pending never counted for Tropa');
    const group = (await call(101, '/api/registrations/queue')).data.activities.find(a => a.id === GENERAL);
    assert.deepEqual([group.scope, group.counts.actionable], ['ALL', 2]);
    assert.deepEqual((await call(101, '/api/registrations/queue?vista=incidencies')).data.activities, []);
    const all = (await call(101, '/api/registrations/queue?vista=totes')).data.activities;
    assert.ok(all.some(a => a.id === FREE_TROPA && a.counts.confirmed === 1));
    assert.equal((await call(101, '/api/registrations/queue?vista=x')).status, 400);
    assert.equal((await call(106, '/api/registrations/queue')).status, 403);
    const summary = (await call(101, '/api/registrations/queue/summary')).data;
    assert.deepEqual(summary.registrations, { pending: 2, escalated: 0, actionable: 2 });
    assert.equal(summary.badge, 2 + summary.payments.pending + summary.payments.issues);
  } finally { f.close(); }
});

test('linked participant only with profile access; confirmed list without contact data', async () => {
  const { f, call } = await setup();
  try {
    const listed = (await call(102, `/api/activities/${FREE_TROPA}/registrations`)).data.registrations.find(r => r.id === CONFIRMED_TROPA);
    assert.deepEqual(listed.participant, { id: id(503), name: 'Participante Tropa B (ficticio)' });
    f.sql.prepare("DELETE FROM user_permission_grant WHERE user_id=? AND permission_code='participants.profile.read'").run(id(102));
    const hidden = (await call(102, `/api/activities/${FREE_TROPA}/registrations`)).data.registrations.find(r => r.id === CONFIRMED_TROPA);
    assert.ok(!('participant' in hidden) && !JSON.stringify(hidden).includes(id(503)));
    const confirmed = (await call(102, `/api/activities/${FREE_TROPA}/registrations/confirmed`)).data.confirmed;
    assert.deepEqual(confirmed.map(c => [c.id, c.name, c.registration_section_id]), [[CONFIRMED_TROPA, 'Participante Tropa B (ficticio)', TROPA]]);
    assert.ok(!('participant' in confirmed[0]), 'submitted name used without profile access');
    assert.ok(!JSON.stringify(confirmed).includes('@'));
    assert.equal((await call(103, `/api/activities/${FREE_TROPA}/registrations/confirmed`)).status, 404);
    assert.equal((await call(104, `/api/activities/${FREE_TROPA}/registrations/confirmed`)).status, 403);
    assert.equal((await call(102, `/api/activities/${FREE_TROPA}/registrations?estat=retirades`)).data.registrations.length, 0);
    assert.equal((await call(102, `/api/activities/${FREE_TROPA}/registrations?estat=x`)).status, 400);
  } finally { f.close(); }
});

test('capabilities: registrations block for the queue, without probing or widening', async () => {
  const { f, call } = await setup();
  try {
    const me = async user => (await call(user, '/api/me')).data.capabilities.registrations;
    const treasury = await me(104);
    assert.deepEqual([treasury.review, treasury.reviewGlobal, treasury.readContacts, treasury.verifyPayments], [null, false, null, { all: true, sections: [] }]);
    const tropa = await me(102);
    assert.deepEqual([tropa.review.all, tropa.review.sections.map(s => s.code), tropa.readContacts.sections.map(s => s.code), tropa.verifyPayments],
      [false, ['TROPA'], ['TROPA'], null]);
    assert.equal((await me(101)).reviewGlobal, true);
    const none = await me(106);
    assert.deepEqual([none.review, none.verifyPayments], [null, null], 'no Inscripcions navigation for the retired role');
    assert.equal(f.sql.prepare("SELECT count(*) AS n FROM audit_event WHERE action='AUTHZ_DENY'").get().n, 0, '/api/me never provokes denials');
  } finally { f.close(); }
});

test('review needs expectedVersion: missing → 400, stale → 409, current → applied; authorisation still first', async () => {
  const { f, call } = await setup();
  try {
    await intake(f, { participantName: 'Persona Versió (ficticia)', publicCode: 'DEMO-FREE-TROPA' });
    const reg = latest(f, 'Persona Versió (ficticia)');
    const review = (user, body) => call(user, `/api/registrations/${reg.id}/review`, { method: 'POST', body });
    // Out of scope or without capability: the same answers as before, whatever the body (no oracle).
    for (const body of [{ decision: 'REJECT' }, { decision: 'REJECT', expectedVersion: 99 }]) {
      assert.equal((await review(103, body)).status, 404);
      assert.equal((await review(104, body)).status, 403);
    }
    assert.equal((await call(102, `/api/registrations/${id(99996)}/review`, { method: 'POST', body: { decision: 'REJECT' } })).status, 404);
    // In scope: the version is mandatory and must be current.
    const missing = await review(102, { decision: 'REJECT' });
    assert.deepEqual([missing.status, missing.data.error], [400, 'invalid_version']);
    const stale = await review(102, { decision: 'REJECT', expectedVersion: reg.version + 1 });
    assert.deepEqual([stale.status, stale.data.error], [409, 'stale_registration']);
    assert.equal(row(f, reg.id).status, 'NEEDS_PARTICIPANT_REVIEW', 'nothing written');
    const ok = await review(102, { decision: 'REJECT', expectedVersion: reg.version });
    assert.deepEqual([ok.status, ok.data.status], [200, 'REJECTED']);
    assert.equal(row(f, reg.id).version, reg.version + 1);
    // A second reviewer with the old version: conflict, not a second write.
    assert.equal((await review(102, { decision: 'REJECT', expectedVersion: reg.version })).status, 409);
  } finally { f.close(); }
});

test('in global review: section reviewers cannot reveal the contact; global reviewers can, audited', async () => {
  const { f, call } = await setup();
  try {
    await intake(f, { participantName: 'Participante Escolta A (ficticio)', birthDate: '2009-04-26', sectionCode: 'TROPA', receiptEmail: 'escalat@example.test' });
    const reg = latest(f, 'Participante Escolta A (ficticio)');
    assert.equal(reg.review_level, 'GLOBAL');
    const blocked = await call(102, `/api/registrations/${reg.id}/contact`);
    assert.deepEqual([blocked.status, blocked.data.error], [403, 'global_review_required'], 'Tropa holds contact.read but the case is in global review');
    assert.ok(!JSON.stringify(blocked.data).includes('escalat@example.test'));
    assert.equal(f.sql.prepare("SELECT count(*) AS n FROM audit_event WHERE action='SENSITIVE_DATA_READ' AND resource_id=?").get(reg.id).n, 0);
    assert.ok(f.sql.prepare("SELECT 1 FROM audit_event WHERE action='AUTHZ_DENY' AND resource_id=? AND reason_code='GLOBAL_REVIEW_REQUIRED'").get(reg.id));
    const allowed = await call(101, `/api/registrations/${reg.id}/contact`);
    assert.equal(allowed.data.contact.email, 'escalat@example.test');
    assert.equal(f.sql.prepare("SELECT count(*) AS n FROM audit_event WHERE action='SENSITIVE_DATA_READ' AND resource_id=?").get(reg.id).n, 1);
    // Secretaria as global reviewer (0018 matrix + grants) may reveal it too.
    for (const [n, code] of [[9911, 'activities.registration.review'], [9912, 'activities.registration.contact.read']])
      f.sql.exec(`INSERT INTO user_permission_grant(id,user_id,permission_code,valid_from,granted_by,justification) VALUES('${id(n)}','${id(105)}','${code}',1,NULL,'Fixture sintético')`);
    assert.equal((await call(105, `/api/registrations/${reg.id}/contact`)).status, 200);
    // Once resolved, the case is no longer in global review: the section regains its usual access.
    await call(101, `/api/registrations/${reg.id}/review`, { method: 'POST', body: { decision: 'REJECT', expectedVersion: reg.version } });
    assert.equal((await call(102, `/api/registrations/${reg.id}/contact`)).status, 200);
  } finally { f.close(); }
});
