// Audit M3: privilege governance — named authoriser confirms, separation of duties on ratification,
// no self-delegation, conservative policy for elevated roles.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, id } from './helpers/gestio-sqlite.js';

const TROPA = id(2);
const later = days => Date.now() + days * 86400000;
function secondCoordinator(f, user = 130) {
  f.sql.exec(`INSERT INTO app_user(id,display_name,status,created_at,updated_at) VALUES('${id(user)}','Segona coordinació (fictícia)','ACTIVE',1,1);
    INSERT INTO user_role(id,user_id,role_code,valid_from,justification) VALUES('${id(user + 1000)}','${id(user)}','GROUP_COORDINATOR',1,'Fixture');
    INSERT INTO user_permission_grant(id,user_id,permission_code,valid_from,justification) VALUES
      ('${id(user + 2000)}','${id(user)}','auth.permission.ratify',1,'Fixture'),
      ('${id(user + 2001)}','${id(user)}','auth.permission.provision',1,'Fixture')`);
}
const delegation = extra => ({ userId: id(105), permissionCode: 'activities.registration.review', sectionId: TROPA,
  authorizationReference: 'DEMO-GOV-TROPA-001', expiresAt: later(10), ...extra });

test('a provisioner cannot attribute authority: the named authoriser confirms, then a different person ratifies', async () => {
  const f = fixture();
  try {
    f.sql.exec(`DELETE FROM delegated_permission WHERE id='${id(741)}'`); // free the seeded Tropa review slot
    for (const user of [101, 102, 103, 107]) await f.login(user);
    const created = await f.request(107, '/api/delegations', { method: 'POST', body: delegation({ authorizedBy: id(102) }) });
    assert.equal(created.status, 201);
    assert.equal(created.data.authorizationStatus, 'PENDING_CONFIRMATION');
    const path = `/api/delegations/${created.data.id}`;
    assert.equal((await f.request(101, `${path}/ratify`, { method: 'POST', body: { ratificationReference: 'DEMO-GOV-RAT-001' } })).status, 409);
    assert.equal((await f.request(103, `${path}/confirm`, { method: 'POST', body: {} })).status, 403, 'other section coordinator');
    assert.equal((await f.request(101, `${path}/confirm`, { method: 'POST', body: {} })).status, 403, 'not the named authoriser');
    assert.equal((await f.request(102, `${path}/confirm`, { method: 'POST', body: {} })).status, 200);
    assert.equal((await f.request(102, `${path}/confirm`, { method: 'POST', body: {} })).status, 409);
    assert.equal((await f.request(107, `${path}/ratify`, { method: 'POST', body: { ratificationReference: 'DEMO-GOV-RAT-001' } })).status, 403);
    assert.equal((await f.request(101, `${path}/ratify`, { method: 'POST', body: { ratificationReference: 'DEMO-GOV-RAT-001' } })).status, 200);
    assert.equal(f.sql.prepare("SELECT count(*) AS n FROM audit_event WHERE action='DELEGATION_AUTHORIZATION_CONFIRMED' AND actor_user_id=?").get(id(102)).n, 1);
    const listed = (await f.request(101, '/api/delegations')).data.delegations.find(row => row.id === created.data.id);
    assert.ok(listed.authorization_confirmed_at > 0);
  } finally { f.close(); }
});

test('nobody ratifies what they provisioned; self-authorised provisioning still needs a second person', async () => {
  const f = fixture();
  try {
    f.sql.exec(`DELETE FROM delegated_permission WHERE id='${id(741)}'`);
    secondCoordinator(f);
    for (const user of [101, 130]) await f.login(user);
    const created = await f.request(101, '/api/delegations', { method: 'POST', body: delegation({ authorizedBy: id(101) }) });
    assert.equal(created.data.authorizationStatus, 'CONFIRMED');
    const ratify = user => f.request(user, `/api/delegations/${created.data.id}/ratify`, { method: 'POST', body: { ratificationReference: 'DEMO-GOV-RAT-002' } });
    assert.equal((await ratify(101)).status, 403, 'provisioner cannot ratify');
    assert.equal((await ratify(130)).status, 200);
  } finally { f.close(); }
});

test('self-delegation and forged confirmations are refused by the service and by the database', async () => {
  const f = fixture();
  try {
    await f.login(101);
    f.sql.exec(`INSERT INTO user_role(id,user_id,role_code,section_id,valid_from,expires_at,justification)
      VALUES('${id(9901)}','${id(101)}','SECTION_DELEGATE','${TROPA}',1,4102444800000,'Fixture')`);
    assert.equal((await f.request(101, '/api/delegations', { method: 'POST', body: delegation({ userId: id(101), authorizedBy: id(102) }) })).status, 403);
    assert.throws(() => f.sql.exec(`INSERT INTO delegated_permission(id,user_id,permission_code,section_id,authorized_by,provisioned_by,
      authorization_reference,granted_at,expires_at) VALUES('${id(9902)}','${id(105)}','finance.payment.verify','${TROPA}','${id(105)}','${id(107)}','DEMO-SELF-0001',1,4102444800000)`),
      /delegation_separation_of_duties/);
    f.sql.exec(`INSERT INTO delegated_permission(id,user_id,permission_code,section_id,authorized_by,provisioned_by,
      authorization_reference,granted_at,expires_at) VALUES('${id(9903)}','${id(105)}','finance.payment.verify','${TROPA}','${id(102)}','${id(107)}','DEMO-FORGE-001',1,4102444800000)`);
    assert.throws(() => f.sql.exec(`INSERT INTO delegated_permission_confirmation(delegation_id,confirmed_by,confirmed_at)
      VALUES('${id(9903)}','${id(107)}',1)`), /named_authoriser/);
    assert.throws(() => f.sql.exec(`UPDATE delegated_permission SET ratification_status='RATIFIED',ratified_at=2,ratified_by='${id(101)}',
      ratification_reference='DEMO-FORGE-RAT' WHERE id='${id(9903)}'`), /delegation_separation_of_duties/, 'no ratification without confirmation');
    f.sql.exec(`INSERT INTO delegated_permission_confirmation(delegation_id,confirmed_by,confirmed_at) VALUES('${id(9903)}','${id(102)}',2)`);
    assert.throws(() => f.sql.exec(`UPDATE delegated_permission SET ratification_status='RATIFIED',ratified_at=3,ratified_by='${id(105)}',
      ratification_reference='DEMO-FORGE-RAT' WHERE id='${id(9903)}'`), /delegation_separation_of_duties/, 'recipient cannot ratify');
    assert.throws(() => f.sql.exec(`DELETE FROM delegated_permission_confirmation WHERE delegation_id='${id(9903)}'`), /immutable/);
  } finally { f.close(); }
});

test('elevated roles: only a group coordinator assigns them, audited; the last coordinator cannot be removed or disabled', async () => {
  const f = fixture();
  try {
    // Misconfiguration on purpose: TREASURY also manages roles and users, but is not a coordinator.
    f.sql.exec(`INSERT INTO role_permission VALUES('TREASURY','auth.role.manage'),('TREASURY','auth.user.manage');
      INSERT INTO user_permission_grant(id,user_id,permission_code,valid_from,justification) VALUES
      ('${id(9910)}','${id(104)}','auth.role.manage',1,'Fixture'),('${id(9911)}','${id(104)}','auth.user.manage',1,'Fixture')`);
    for (const user of [101, 104]) await f.login(user);
    assert.equal((await f.request(104, `/api/users/${id(105)}/roles`, { method: 'POST', body: { roleCode: 'TECH_ADMIN' } })).status, 403);
    assert.equal((await f.request(104, `/api/users/${id(105)}/roles`, { method: 'POST', body: { roleCode: 'SECTION_COORDINATOR', sectionId: TROPA } })).status, 201,
      'non-elevated roles follow the ordinary permission');
    assert.equal((await f.request(104, `/api/users/${id(105)}/roles`, { method: 'POST', body: { roleCode: 'CRM_MANAGER' } })).status, 409,
      '3.5E: CRM_MANAGER is retired and can no longer be assigned');
    assert.equal((await f.request(104, `/api/users/${id(105)}/roles`, { method: 'POST', body: { roleCode: 'SECRETARY' } })).status, 409,
      'regression: assigning an already active role is a conflict, not a 500');
    const treasury = await f.request(101, `/api/users/${id(106)}/roles`, { method: 'POST', body: { roleCode: 'TREASURY' } });
    assert.equal(treasury.status, 201);
    assert.equal(f.sql.prepare("SELECT reason_code FROM audit_event WHERE action='ROLE_ASSIGNED' AND resource_id=?").get(treasury.data.id).reason_code, 'ELEVATED_ROLE');
    assert.equal((await f.request(104, `/api/users/${id(101)}/roles/${id(301)}`, { method: 'DELETE' })).status, 409);
    assert.equal((await f.request(104, `/api/users/${id(101)}/disable`, { method: 'POST', body: {} })).status, 409);
    secondCoordinator(f);
    assert.equal((await f.request(104, `/api/users/${id(101)}/roles/${id(301)}`, { method: 'DELETE' })).status, 200,
      'allowed while another active coordinator exists');
  } finally { f.close(); }
});
