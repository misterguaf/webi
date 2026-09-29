-- FASE 3.5 audit remediation M3: privilege governance for delegations. Earlier migrations unchanged.
--
-- A delegation names an organisational authoriser (authorized_by). Until now the provisioner merely
-- asserted that authority. From here on the named authoriser must confirm it in Gestió before a
-- different person ratifies it, and nobody may ratify a delegation they provisioned or receive.

CREATE TABLE delegated_permission_confirmation (
  delegation_id TEXT PRIMARY KEY REFERENCES delegated_permission(id) ON DELETE RESTRICT,
  confirmed_by TEXT NOT NULL REFERENCES app_user(id),
  confirmed_at INTEGER NOT NULL,
  legacy INTEGER NOT NULL DEFAULT 0 CHECK(legacy IN (0,1))
);

-- Existing ratified delegations predate the confirmation step; they are marked legacy, not re-proven.
INSERT INTO delegated_permission_confirmation(delegation_id,confirmed_by,confirmed_at,legacy)
SELECT id,authorized_by,COALESCE(ratified_at,granted_at),1 FROM delegated_permission
WHERE ratification_status='RATIFIED';

CREATE TRIGGER delegated_permission_confirmation_by_authoriser BEFORE INSERT ON delegated_permission_confirmation
WHEN NEW.legacy=0 AND NOT EXISTS(SELECT 1 FROM delegated_permission d WHERE d.id=NEW.delegation_id
  AND d.authorized_by=NEW.confirmed_by AND d.ratification_status='PENDING_RATIFICATION')
BEGIN SELECT RAISE(ABORT,'delegation_confirmation_requires_named_authoriser'); END;
CREATE TRIGGER delegated_permission_confirmation_immutable_update BEFORE UPDATE ON delegated_permission_confirmation
BEGIN SELECT RAISE(ABORT,'delegation_confirmation_immutable'); END;
CREATE TRIGGER delegated_permission_confirmation_immutable_delete BEFORE DELETE ON delegated_permission_confirmation
BEGIN SELECT RAISE(ABORT,'delegation_confirmation_immutable'); END;

-- No self-delegation: the recipient can be neither the provisioner nor the named authoriser.
CREATE TRIGGER delegated_permission_no_self_insert BEFORE INSERT ON delegated_permission
WHEN NEW.user_id=NEW.provisioned_by OR NEW.user_id=NEW.authorized_by
  OR (NEW.ratified_by IS NOT NULL AND (NEW.ratified_by=NEW.provisioned_by OR NEW.ratified_by=NEW.user_id))
BEGIN SELECT RAISE(ABORT,'delegation_separation_of_duties'); END;

-- Ratification: only after the authoriser's confirmation, and never by the provisioner or recipient.
CREATE TRIGGER delegated_permission_ratification_governance BEFORE UPDATE OF ratification_status ON delegated_permission
WHEN NEW.ratification_status='RATIFIED' AND OLD.ratification_status!='RATIFIED' AND (
  NEW.ratified_by IS NULL OR NEW.ratified_by=OLD.provisioned_by OR NEW.ratified_by=OLD.user_id OR
  NOT EXISTS(SELECT 1 FROM delegated_permission_confirmation c WHERE c.delegation_id=OLD.id))
BEGIN SELECT RAISE(ABORT,'delegation_separation_of_duties'); END;
