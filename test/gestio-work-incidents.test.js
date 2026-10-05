// FASE 3.5H.3 — Incidències i millores: anyone reports and follows their own; managing needs the explicit
// admin.incidents.manage capability (TECH_ADMIN alone does not have it); OPEN → IN_PROGRESS → RESOLVED with a
// short resolution visible to the reporter; no priority; the ambiguous admission match opens exactly one
// SYSTEM incident that references the request without copying it, and is resolved with the blocker.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, id } from './helpers/gestio-sqlite.js';
import { PortalIntake } from '../gestio/src/intake.js';

const TROPA = id(2), ESCULTA = id(3);
async function setup() {
  const f = fixture();
  for (const user of [101, 102, 103, 104, 105, 106, 107]) await f.login(user);
  const call = (user, path, method = 'GET', body) => f.request(user, path, { method, body });
  const report = (user, over = {}) => call(user, '/api/work-incidents', 'POST', { type: 'ERROR', title: 'No carrega la llista', description: 'Passa en obrir Quotes.', module: 'quotes', ...over });
  const move = async (user, incident, step, body = {}) => {
    const { version } = f.sql.prepare('SELECT version FROM work_incident WHERE id=?').get(incident);
    return call(user, `/api/work-incidents/${incident}/${step}`, 'POST', { expectedVersion: version, ...body });
  };
  return { f, call, report, move };
}

test('any Gestió user reports; the reporter sees only their own; others’ reports are not browsable', async () => {
  const s = await setup();
  try {
    for (const user of [102, 104, 106, 107]) assert.equal((await s.report(user, { title: `Report de ${user}` })).status, 201, `user ${user} can report`);
    const created = await s.report(104, { type: 'IMPROVEMENT', title: 'Millora de filtres', description: undefined, module: undefined });
    assert.equal(created.status, 201);
    const row = s.f.sql.prepare('SELECT * FROM work_incident WHERE id=?').get(created.data.id);
    assert.deepEqual([row.origin, row.status, row.reporter_user_id, row.module, row.description], ['MANUAL', 'OPEN', id(104), null, null]);
    const mine = (await s.call(104, '/api/work-incidents')).data.incidents;
    assert.deepEqual(mine.map(item => item.title).sort(), ['Millora de filtres', 'Report de 104']);
    assert.ok(mine.every(item => item.reporter === null && item.description === undefined), 'lists carry no description');
    assert.equal((await s.call(104, '/api/work-incidents?vista=totes')).status, 403, 'no browsing of other reports');
    const other = s.f.sql.prepare('SELECT id FROM work_incident WHERE reporter_user_id=?').get(id(102)).id;
    assert.equal((await s.call(104, `/api/work-incidents/${other}`)).status, 404, 'indistinguishable from missing');
    assert.equal((await s.call(104, `/api/work-incidents/${created.data.id}`)).data.incident.title, 'Millora de filtres');
    assert.equal((await s.call(104, '/api/work-incidents/summary')).data.open, null, 'no badge for non-managers');
    // Validation: no priority field (also not in the table), closed types, bounded text.
    assert.equal((await s.report(104, { priority: 'URGENT' })).status, 400);
    assert.equal((await s.report(104, { type: 'P0' })).status, 400);
    assert.equal((await s.report(104, { title: 'x' })).status, 400);
    const columns = s.f.sql.prepare('PRAGMA table_info(work_incident)').all().map(column => column.name).join(',');
    assert.doesNotMatch(columns, /priority|severity|urgen|attach|comment/i);
    assert.equal((await s.call(104, `/api/work-incidents/${created.data.id}/start`, 'POST', { expectedVersion: 1 })).status, 403, 'a reporter cannot manage');
  } finally { s.f.close(); }
});

test('management: Secretaria and Coordinació general manage; TECH_ADMIN alone does not; an explicit grant works; OPEN → IN_PROGRESS → RESOLVED', async () => {
  const s = await setup();
  try {
    const { id: incident } = (await s.report(104)).data;
    await s.report(102, { type: 'ACCESS', title: 'No veig Tropa', module: 'participants' });
    for (const user of [101, 105]) assert.equal((await s.call(user, '/api/work-incidents?vista=totes')).data.incidents.length, 2, `manager ${user}`);
    assert.equal((await s.call(105, '/api/work-incidents/summary')).data.open, 2);
    assert.equal((await s.call(105, '/api/work-incidents?vista=totes&type=ACCESS')).data.incidents.length, 1);
    assert.equal((await s.call(105, '/api/work-incidents?vista=totes&module=quotes')).data.incidents.length, 1);
    const detail = (await s.call(105, `/api/work-incidents/${incident}`)).data;
    assert.deepEqual([detail.incident.reporter, detail.incident.description, detail.actions.manage], ['Tesorería (ficticia)', 'Passa en obrir Quotes.', true]);
    // TECH_ADMIN holds no management by its role.
    assert.equal((await s.call(107, '/api/work-incidents?vista=totes')).status, 403);
    assert.equal((await s.move(107, incident, 'start')).status, 403);
    assert.equal((await s.call(107, '/api/me')).data.capabilities.incidents.manage, false);
    // Workflow.
    assert.equal((await s.move(105, incident, 'start')).data.status, 'IN_PROGRESS');
    assert.equal((await s.move(105, incident, 'start')).data.error, 'invalid_transition');
    assert.equal((await s.move(105, incident, 'resolve', { resolution: 'x'.repeat(281) })).status, 400);
    assert.equal((await s.move(105, incident, 'resolve', { resolution: 'Corregit en la nova versió.' })).data.status, 'RESOLVED');
    // The reporter sees the state and the short answer.
    const seen = (await s.call(104, `/api/work-incidents/${incident}`)).data.incident;
    assert.deepEqual([seen.status, seen.resolution], ['RESOLVED', 'Corregit en la nova versió.']);
    assert.equal((await s.call(104, '/api/work-incidents')).data.incidents.find(item => item.id === incident).resolution, 'Corregit en la nova versió.');
    // Reopen stays simple: back to OPEN, answer cleared.
    assert.equal((await s.move(101, incident, 'reopen')).data.status, 'OPEN');
    assert.equal(s.f.sql.prepare('SELECT resolution FROM work_incident WHERE id=?').get(incident).resolution, null);
    assert.equal((await s.call(105, `/api/work-incidents/${incident}/resolve`, 'POST', { expectedVersion: 1 })).data.error, 'stale_incident');
    assert.throws(() => s.f.sql.exec(`DELETE FROM work_incident WHERE id='${incident}'`), /work_incident_immutable/);
    // Explicit, individual grant (origin authority: Secretaria holds the capability) makes TECH_ADMIN a manager.
    assert.equal((await s.call(105, `/api/users/${id(107)}/permissions`, 'POST', { permissionCode: 'admin.incidents.manage' })).status, 201);
    assert.equal((await s.call(107, '/api/work-incidents?vista=totes')).data.incidents.length, 2);
    assert.equal((await s.move(107, incident, 'start')).data.status, 'IN_PROGRESS');
    // No self-escalation: nobody grants it to themselves, and a section coordinator cannot grant what it lacks.
    assert.equal((await s.call(105, `/api/users/${id(105)}/permissions`, 'POST', { permissionCode: 'admin.incidents.manage' })).data.error, 'self_change_forbidden');
    assert.equal((await s.call(102, `/api/users/${id(103)}/permissions`, 'POST', { permissionCode: 'admin.incidents.manage' })).status, 403);
  } finally { s.f.close(); }
});

test('ambiguous admission match opens one SYSTEM incident (reused, reference only) and resolving the match resolves it', async () => {
  const s = await setup();
  try {
    s.f.sql.exec(`INSERT INTO participant(id,display_name,current_section_id,status,birth_date) VALUES
      ('${id(9802)}','Nil Repetit (fictici)','${TROPA}','ACTIVE','2013-07-07'),('${id(9803)}','Nil Repetit (fictici)','${ESCULTA}','ACTIVE','2011-07-07')`);
    const intake = await PortalIntake.fetch(new Request('https://gestio-intake.internal/v1/admissions', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ givenName: 'Nil', familyNames: 'Repetit (fictici)', birthDate: '2013-09-09', sectionLabel: 'Tropa (11-14)', guardianName: 'Mare Nil (fictícia)',
        contactPhone: '600 111 222', contactEmail: 'nil.familia@example.test', dataConsent: true, contactConsent: true }) }),
      { DB: s.f.db, EVIDENCE_STORAGE: s.f.storage, APP_ENV: 'development' });
    assert.equal(intake.status, 202);
    const request = s.f.sql.prepare('SELECT id FROM admission_request ORDER BY received_at DESC LIMIT 1').get().id;
    const act = async (user, op, body = {}) => s.call(user, `/api/admissions/${request}/${op}`, 'POST',
      { expectedVersion: s.f.sql.prepare('SELECT version FROM admission_request WHERE id=?').get(request).version, ...body });
    await act(102, 'start-review'); await act(102, 'section', { section: 'TROPA' });
    // Opening the request (re-evaluating the match) never writes an incident.
    await s.call(102, `/api/admissions/${request}`); await s.call(105, `/api/admissions/${request}`);
    assert.equal(s.f.sql.prepare('SELECT count(*) AS n FROM work_incident').get().n, 0);
    for (let i = 0; i < 3; i++) assert.equal((await act(102, 'accept')).data.error, 'admission_match_ambiguous');
    const rows = s.f.sql.prepare('SELECT * FROM work_incident').all();
    assert.equal(rows.length, 1, 'one incident for the blocker, however often it is hit');
    const [incident] = rows;
    assert.deepEqual([incident.origin, incident.type, incident.status, incident.reporter_user_id, incident.resource_type, incident.resource_id, incident.module],
      ['SYSTEM', 'DATA', 'OPEN', null, 'admission_request', request, 'participants']);
    const stored = JSON.stringify(incident);
    for (const personal of ['Nil', 'Repetit', '2013-09-09', '600 111 222', 'nil.familia', 'Mare']) assert.ok(!stored.includes(personal), `not copied: ${personal}`);
    assert.equal(s.f.sql.prepare("SELECT count(*) AS n FROM audit_event WHERE action='WORK_INCIDENT_SYSTEM_OPENED'").get().n, 1);
    // Managers see it and can follow the reference when they may open the request; others cannot browse it.
    const detail = (await s.call(105, `/api/work-incidents/${incident.id}`)).data.incident;
    assert.deepEqual(detail.resource, { type: 'admission_request', label: 'Sol·licitud d’alta', link: { page: 'participants', path: ['altes', request] } });
    assert.equal((await s.call(102, `/api/work-incidents/${incident.id}`)).status, 404);
    // Resolving the blocker resolves the incident coherently.
    assert.equal((await act(105, 'resolve-match', { decision: 'DIFFERENT_PERSON' })).status, 200);
    const resolved = s.f.sql.prepare('SELECT status,resolution,resolved_by FROM work_incident WHERE id=?').get(incident.id);
    assert.deepEqual({ ...resolved }, { status: 'RESOLVED', resolution: 'Coincidència resolta a Noves altes.', resolved_by: id(105) });
    assert.equal((await act(102, 'accept')).data.created, true);
    assert.equal(s.f.sql.prepare('SELECT count(*) AS n FROM work_incident').get().n, 1);
  } finally { s.f.close(); }
});
