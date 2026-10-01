// Audit M4: matching review exposes match signals, not the birth dates of every candidate.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { submitRegistration } from '../gestio/src/services/registration-service.js';
import { submitFee } from '../gestio/src/services/annual-fee-service.js';
import { fixture, id } from './helpers/gestio-sqlite.js';

const TROPA = id(2);
const REVIEWER = 120; // SECTION_DELEGATE Tropa with a ratified review delegation and no profile access
const storage = { put: async () => {}, delete: async () => {} };
const pdf = Buffer.from('%PDF-1.4\n%synthetic matching fixture\n%%EOF');

function setup() {
  const f = fixture();
  const rows = [];
  for (let n = 0; n < 30; n++)
    rows.push(`('${id(3000 + n)}','Educand Aleatori ${String.fromCharCode(65 + (n % 26))}${n} (ficticio)','${TROPA}','ACTIVE','2012-0${1 + (n % 9)}-1${n % 9}')`);
  f.sql.exec(`INSERT INTO participant(id,display_name,current_section_id,status,birth_date) VALUES ${rows.join(',')},
    ('${id(3100)}','Marta Doble (ficticio)','${TROPA}','ACTIVE','2013-05-18'),
    ('${id(3101)}','Marta Doble (ficticio)','${TROPA}','ACTIVE','2013-05-18');
    INSERT INTO app_user(id,display_name,status,created_at,updated_at) VALUES('${id(REVIEWER)}','Revisora sense perfil (fictícia)','ACTIVE',1,1);
    INSERT INTO user_role(id,user_id,role_code,section_id,valid_from,expires_at,justification)
      VALUES('${id(3200)}','${id(REVIEWER)}','SECTION_DELEGATE','${TROPA}',1,4102444800000,'Fixture');
    INSERT INTO delegated_permission(id,user_id,permission_code,section_id,authorized_by,provisioned_by,authorization_reference,
      granted_at,expires_at,ratification_status,ratified_at,ratified_by,ratification_reference) VALUES
      ('${id(3201)}','${id(REVIEWER)}','activities.registration.review','${TROPA}','${id(102)}','${id(107)}','DEMO-MATCH-0001',1,4102444800000,'RATIFIED',2,'${id(101)}','DEMO-MATCH-RAT1'),
      ('${id(3202)}','${id(REVIEWER)}','finance.fee.payment.review','${TROPA}','${id(102)}','${id(107)}','DEMO-MATCH-0002',1,4102444800000,'RATIFIED',2,'${id(101)}','DEMO-MATCH-RAT2')`);
  return f;
}
async function register(f, name, birthDate) {
  await submitRegistration(f.db, storage, { publicCode: 'DEMO-FREE-TROPA', participantName: name, birthDate,
    submittedByName: 'Persona fictícia', sectionCode: 'TROPA', receiptEmail: 'matching@example.test',
    idempotencyKey: crypto.randomUUID().replaceAll('-', ''), participationTermsVersion: 'DEMO-3A-PARTICIPATION-V1',
    privacyNoticeVersion: 'DEMO-3A-PRIVACY-NOTICE-V1' }, crypto.randomUUID());
  return f.sql.prepare("SELECT id FROM activity_registration WHERE submitted_name=? ORDER BY created_at DESC").get(name).id;
}

test('reviewer without profile access sees match signals only, and only plausible candidates by default', async () => {
  const f = setup();
  try {
    await f.login(REVIEWER);
    const registration = await register(f, 'Marta Doble (ficticio)', '2013-05-18');
    const response = await f.request(REVIEWER, `/api/registrations/${registration}/candidates`);
    assert.equal(response.status, 200);
    const { candidates, truncated } = response.data;
    assert.equal(truncated, false);
    // Same name, or same birth date (seed participant 502 was born the same day); the 30 others are not listed.
    assert.deepEqual(candidates.map(row => row.id).sort(), [id(502), id(3100), id(3101)].sort(),
      'unrelated section members are not enumerated by default');
    assert.deepEqual(candidates.slice(0, 2).map(row => row.id).sort(), [id(3100), id(3101)].sort(), 'strongest matches first');
    for (const row of candidates) {
      assert.ok(!('birth_date' in row), 'no full birth date without participants.profile.read');
      assert.equal(row.birth_date_matches, true);
      assert.equal(row.name_matches, row.id !== id(502));
    }
    assert.doesNotMatch(JSON.stringify(response.data.candidates), /\d{4}-\d{2}-\d{2}/);
    assert.equal(response.data.declared.birthDate, '2013-05-18', 'only the declared date of the pending request (3.5F, moved out of the list)');
    const status = f.sql.prepare('SELECT status FROM activity_registration WHERE id=?').get(registration).status;
    assert.equal(status, 'NEEDS_PARTICIPANT_REVIEW', 'listing candidates never merges automatically');
  } finally { f.close(); }
});

test('explicit search reaches other people without dates; results are capped and flagged', async () => {
  const f = setup();
  try {
    await f.login(REVIEWER);
    const registration = await register(f, 'Nom Totalment Diferent (ficticio)', '2001-01-01');
    const plain = (await f.request(REVIEWER, `/api/registrations/${registration}/candidates`)).data;
    assert.ok(plain.candidates.every(row => row.name_matches || row.birth_date_matches));
    const search = (await f.request(REVIEWER, `/api/registrations/${registration}/candidates?search=aleatori`)).data;
    assert.equal(search.candidates.length, 20);
    assert.equal(search.truncated, true, 'never a silent truncation');
    assert.ok(search.candidates.every(row => !('birth_date' in row) && row.birth_date_matches === false));
    assert.equal((await f.request(REVIEWER, `/api/registrations/${registration}/candidates?search=a`)).status, 400);
  } finally { f.close(); }
});

test('a reviewer who also holds participant profile access in the section may see the date', async () => {
  const f = setup();
  try {
    await f.login(105); // SECRETARY (profiles, group-wide) + Tropa delegate
    const registration = await register(f, 'Marta Doble (ficticio)', '2013-05-18');
    const { candidates } = (await f.request(105, `/api/registrations/${registration}/candidates`)).data;
    assert.ok(candidates.length && candidates.every(row => row.birth_date === '2013-05-18' && row.birth_date_matches));
  } finally { f.close(); }
});

test('annual-fee matching applies the same minimisation within the declared section', async () => {
  const f = setup();
  try {
    await f.login(REVIEWER);
    const reference = (await submitFee(f.db, storage, { roundCode: '2026/2027',
      children: [{ name: 'Marta Doble (ficticio)', birthDate: '2013-05-18', sectionCode: 'TROPA' }],
      submittedByName: 'Família fictícia', contactPhone: null, receiptEmail: 'matching-fee@example.test',
      declaredAmountCents: 10000, privacyAcknowledged: true, privacyNoticeVersion: 'DEMO-3B-PRIVACY-NOTICE-V1',
      idempotencyKey: crypto.randomUUID().replaceAll('-', ''),
      evidence: { filename: 'j.pdf', mime: 'application/pdf', dataBase64: pdf.toString('base64') } }, crypto.randomUUID())).reference;
    const person = f.sql.prepare('SELECT id,match_status FROM annual_fee_submission_person WHERE payment_id=?').get(reference);
    assert.equal(person.match_status, 'AMBIGUOUS');
    const response = await f.request(REVIEWER, `/api/fees/people/${person.id}/candidates`);
    assert.equal(response.status, 200);
    assert.deepEqual(response.data.candidates.map(row => row.id).sort(), [id(502), id(3100), id(3101)].sort());
    assert.ok(response.data.candidates.every(row => !('birth_date' in row) && row.birth_date_matches));
  } finally { f.close(); }
});
