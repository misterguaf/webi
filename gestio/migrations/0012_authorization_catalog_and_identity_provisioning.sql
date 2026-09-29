-- FASE 3.5 audit remediation: authorisation catalogue and identity provisioning.
-- Earlier migrations are unchanged. Until now roles, permissions, their default matrix and
-- sections only existed through the synthetic seed, so a clean non-seeded install had no policy.
-- These rows are reference data (no personal data). INSERT OR IGNORE keeps migrated databases
-- and the synthetic seed (which now also uses INSERT OR IGNORE) compatible.

INSERT OR IGNORE INTO section(id,code,display_name) VALUES
  ('00000000-0000-4000-8000-000000000001','MANADA','Manada'),
  ('00000000-0000-4000-8000-000000000002','TROPA','Tropa'),
  ('00000000-0000-4000-8000-000000000003','ESCOLTA','Escolta'),
  ('00000000-0000-4000-8000-000000000004','CLAN','Clan');
INSERT OR IGNORE INTO role(code) VALUES
  ('CRM_MANAGER'),('GROUP_COORDINATOR'),('SECRETARY'),('SECTION_COORDINATOR'),('SECTION_DELEGATE'),('TECH_ADMIN'),('TREASURY');
INSERT OR IGNORE INTO permission(code) VALUES
  ('activities.general.manage'),
  ('activities.manage'),
  ('activities.read'),
  ('activities.registration.review'),
  ('audit.event.read'),
  ('auth.permission.authorize'),
  ('auth.permission.manage'),
  ('auth.permission.provision'),
  ('auth.permission.ratify'),
  ('auth.role.manage'),
  ('auth.user.manage'),
  ('auth.user.suspend'),
  ('crm.contact.read'),
  ('finance.fee.config.manage'),
  ('finance.fee.installment.authorize'),
  ('finance.fee.manage'),
  ('finance.fee.payment.review'),
  ('finance.fee.read'),
  ('finance.fee.reconcile'),
  ('finance.fee.status.read'),
  ('finance.payment.verify'),
  ('health.grant.manage'),
  ('health.record.read'),
  ('infra.status.read'),
  ('participants.profile.read'),
  ('security.incident.manage');
INSERT OR IGNORE INTO role_permission(role_code,permission_code) VALUES
  ('CRM_MANAGER','crm.contact.read'),
  ('GROUP_COORDINATOR','activities.general.manage'),
  ('GROUP_COORDINATOR','activities.manage'),
  ('GROUP_COORDINATOR','activities.read'),
  ('GROUP_COORDINATOR','activities.registration.review'),
  ('GROUP_COORDINATOR','audit.event.read'),
  ('GROUP_COORDINATOR','auth.permission.authorize'),
  ('GROUP_COORDINATOR','auth.permission.manage'),
  ('GROUP_COORDINATOR','auth.permission.provision'),
  ('GROUP_COORDINATOR','auth.permission.ratify'),
  ('GROUP_COORDINATOR','auth.role.manage'),
  ('GROUP_COORDINATOR','auth.user.manage'),
  ('GROUP_COORDINATOR','auth.user.suspend'),
  ('GROUP_COORDINATOR','finance.fee.config.manage'),
  ('GROUP_COORDINATOR','finance.fee.installment.authorize'),
  ('GROUP_COORDINATOR','finance.fee.manage'),
  ('GROUP_COORDINATOR','finance.fee.payment.review'),
  ('GROUP_COORDINATOR','finance.fee.read'),
  ('GROUP_COORDINATOR','finance.payment.verify'),
  ('GROUP_COORDINATOR','health.grant.manage'),
  ('GROUP_COORDINATOR','health.record.read'),
  ('GROUP_COORDINATOR','participants.profile.read'),
  ('GROUP_COORDINATOR','security.incident.manage'),
  ('SECRETARY','participants.profile.read'),
  ('SECTION_COORDINATOR','activities.general.manage'),
  ('SECTION_COORDINATOR','activities.manage'),
  ('SECTION_COORDINATOR','activities.read'),
  ('SECTION_COORDINATOR','activities.registration.review'),
  ('SECTION_COORDINATOR','auth.permission.authorize'),
  ('SECTION_COORDINATOR','finance.fee.status.read'),
  ('SECTION_COORDINATOR','health.record.read'),
  ('SECTION_COORDINATOR','participants.profile.read'),
  ('SECTION_DELEGATE','activities.read'),
  ('SECTION_DELEGATE','activities.registration.review'),
  ('SECTION_DELEGATE','finance.fee.payment.review'),
  ('SECTION_DELEGATE','finance.payment.verify'),
  ('SECTION_DELEGATE','participants.profile.read'),
  ('TECH_ADMIN','auth.permission.provision'),
  ('TECH_ADMIN','infra.status.read'),
  ('TREASURY','finance.fee.config.manage'),
  ('TREASURY','finance.fee.installment.authorize'),
  ('TREASURY','finance.fee.manage'),
  ('TREASURY','finance.fee.payment.review'),
  ('TREASURY','finance.fee.read'),
  ('TREASURY','finance.fee.reconcile'),
  ('TREASURY','finance.payment.verify');

-- Identity provisioning without manual SQL: an authorised administrator invites an existing
-- app_user by e-mail for the configured identity issuer (Cloudflare Access in production). The
-- first successful Access login with that verified e-mail binds the stable subject and consumes
-- the invitation. There is no public self-registration.
CREATE TABLE auth_identity_invitation (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
  issuer TEXT NOT NULL CHECK(length(issuer) BETWEEN 8 AND 200),
  email TEXT NOT NULL CHECK(length(email) BETWEEN 6 AND 254 AND email=lower(email) AND email LIKE '%_@_%._%'),
  created_by TEXT NOT NULL REFERENCES app_user(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  consumed_identity_id TEXT REFERENCES auth_identity(id),
  revoked_at INTEGER,
  revoked_by TEXT REFERENCES app_user(id),
  CHECK(created_by!=user_id),
  CHECK(expires_at>created_at),
  CHECK(consumed_at IS NULL OR revoked_at IS NULL),
  CHECK((consumed_at IS NULL)=(consumed_identity_id IS NULL))
);
CREATE UNIQUE INDEX auth_identity_invitation_open_unique ON auth_identity_invitation(issuer,email)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;
CREATE INDEX auth_identity_invitation_user_idx ON auth_identity_invitation(user_id,created_at);
CREATE TRIGGER auth_identity_invitation_recipient_active BEFORE INSERT ON auth_identity_invitation
WHEN NOT EXISTS(SELECT 1 FROM app_user WHERE id=NEW.user_id AND status='ACTIVE')
BEGIN SELECT RAISE(ABORT,'invitation_recipient_inactive'); END;

-- Identities are revoked, not deleted, so the audit trail keeps the binding history.
ALTER TABLE auth_identity ADD COLUMN revoked_at INTEGER;
ALTER TABLE auth_identity ADD COLUMN revoked_by TEXT REFERENCES app_user(id);
