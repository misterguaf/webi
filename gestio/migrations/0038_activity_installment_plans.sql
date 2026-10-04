-- G.3: one exceptional, pre-authorised activity plan per participant and activity.
-- A single registration binding is retained; changes are immutable plan revisions.
INSERT OR IGNORE INTO permission(code) VALUES ('finance.activity.installment.authorize');
INSERT OR IGNORE INTO role_permission(role_code,permission_code) VALUES
  ('TREASURY','finance.activity.installment.authorize'),
  ('GROUP_COORDINATOR','finance.activity.installment.authorize');
INSERT INTO user_permission_grant(id,user_id,permission_code,valid_from,granted_by,justification)
SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||
  substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
  ur.user_id,'finance.activity.installment.authorize',CAST(strftime('%s','now') AS INTEGER)*1000,NULL,
  'Transició G.3: autorització de terminis de activitat'
FROM user_role ur WHERE ur.role_code IN ('TREASURY','GROUP_COORDINATOR')
  AND ur.section_id IS NULL AND ur.revoked_at IS NULL
  AND (ur.expires_at IS NULL OR ur.expires_at>CAST(strftime('%s','now') AS INTEGER)*1000)
  AND NOT EXISTS(SELECT 1 FROM user_permission_grant g WHERE g.user_id=ur.user_id
    AND g.permission_code='finance.activity.installment.authorize' AND g.revoked_at IS NULL);

CREATE TABLE activity_installment_plan (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activity(id) ON DELETE RESTRICT,
  participant_id TEXT NOT NULL REFERENCES participant(id) ON DELETE RESTRICT,
  transport_code TEXT CHECK(transport_code IS NULL OR transport_code IN ('GROUP','FAMILY')),
  registration_id TEXT UNIQUE REFERENCES activity_registration(id) ON DELETE RESTRICT,
  total_cents INTEGER NOT NULL CHECK(total_cents BETWEEN 1 AND 1000000),
  status TEXT NOT NULL CHECK(status IN ('DRAFT','ACTIVE')),
  current_revision INTEGER NOT NULL DEFAULT 1 CHECK(current_revision BETWEEN 1 AND 100),
  authorized_by TEXT NOT NULL REFERENCES app_user(id),
  authorized_at INTEGER NOT NULL,
  UNIQUE(activity_id,participant_id)
);
CREATE TABLE activity_installment_revision (
  plan_id TEXT NOT NULL REFERENCES activity_installment_plan(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 100),
  total_cents INTEGER NOT NULL CHECK(total_cents BETWEEN 1 AND 1000000),
  reason TEXT CHECK(reason IS NULL OR length(trim(reason)) BETWEEN 3 AND 240),
  authorized_by TEXT NOT NULL REFERENCES app_user(id),
  authorized_at INTEGER NOT NULL,
  PRIMARY KEY(plan_id,revision),
  CHECK((revision=1 AND reason IS NULL) OR (revision>1 AND reason IS NOT NULL))
);
CREATE TABLE activity_installment_part (
  plan_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 1 AND 100),
  planned_cents INTEGER NOT NULL CHECK(planned_cents BETWEEN 1 AND 1000000),
  target_at INTEGER CHECK(target_at IS NULL OR target_at>=0),
  PRIMARY KEY(plan_id,revision,ordinal),
  FOREIGN KEY(plan_id,revision) REFERENCES activity_installment_revision(plan_id,revision) ON DELETE RESTRICT
);
CREATE TRIGGER activity_installment_plan_insert_guard BEFORE INSERT ON activity_installment_plan
WHEN NEW.status!='DRAFT' OR NEW.current_revision!=1 OR NEW.registration_id IS NOT NULL OR
  NOT EXISTS(SELECT 1 FROM activity a JOIN participant p ON p.id=NEW.participant_id
    WHERE a.id=NEW.activity_id AND a.status='PUBLISHED' AND a.price_cents>0 AND p.status='ACTIVE')
BEGIN SELECT RAISE(ABORT,'invalid_activity_installment_plan'); END;
CREATE TRIGGER activity_installment_revision_insert_guard BEFORE INSERT ON activity_installment_revision
WHEN NOT EXISTS(SELECT 1 FROM activity_installment_plan p WHERE p.id=NEW.plan_id AND
  ((p.status='DRAFT' AND NEW.revision=1 AND NEW.total_cents=p.total_cents) OR
   (p.status='ACTIVE' AND NEW.revision=p.current_revision+1)))
BEGIN SELECT RAISE(ABORT,'invalid_activity_installment_revision'); END;
CREATE TRIGGER activity_installment_part_insert_guard BEFORE INSERT ON activity_installment_part
WHEN NOT EXISTS(SELECT 1 FROM activity_installment_plan p WHERE p.id=NEW.plan_id AND
  ((p.status='DRAFT' AND NEW.revision=1) OR
   (p.status='ACTIVE' AND NEW.revision=p.current_revision+1)))
BEGIN SELECT RAISE(ABORT,'activity_installment_immutable'); END;
CREATE TRIGGER activity_installment_revision_no_update BEFORE UPDATE ON activity_installment_revision
BEGIN SELECT RAISE(ABORT,'activity_installment_immutable'); END;
CREATE TRIGGER activity_installment_revision_no_delete BEFORE DELETE ON activity_installment_revision
BEGIN SELECT RAISE(ABORT,'activity_installment_immutable'); END;
CREATE TRIGGER activity_installment_part_no_update BEFORE UPDATE ON activity_installment_part
BEGIN SELECT RAISE(ABORT,'activity_installment_immutable'); END;
CREATE TRIGGER activity_installment_part_no_delete BEFORE DELETE ON activity_installment_part
BEGIN SELECT RAISE(ABORT,'activity_installment_immutable'); END;
CREATE TRIGGER activity_installment_plan_no_delete BEFORE DELETE ON activity_installment_plan
BEGIN SELECT RAISE(ABORT,'activity_installment_immutable'); END;
CREATE TRIGGER activity_installment_plan_transition BEFORE UPDATE ON activity_installment_plan
WHEN NEW.activity_id IS NOT OLD.activity_id OR NEW.participant_id IS NOT OLD.participant_id OR
  NEW.transport_code IS NOT OLD.transport_code OR
  NEW.authorized_by IS NOT OLD.authorized_by OR NEW.authorized_at IS NOT OLD.authorized_at OR
  NOT ((OLD.status='DRAFT' AND NEW.status='ACTIVE' AND NEW.registration_id IS NULL
      AND NEW.current_revision=1 AND NEW.total_cents=OLD.total_cents) OR
    (OLD.status='ACTIVE' AND NEW.status='ACTIVE' AND NEW.current_revision=OLD.current_revision
      AND NEW.total_cents=OLD.total_cents AND OLD.registration_id IS NULL AND NEW.registration_id IS NOT NULL
      AND EXISTS(SELECT 1 FROM activity_registration r WHERE r.id=NEW.registration_id
        AND r.activity_id=OLD.activity_id AND r.participant_id=OLD.participant_id
        AND r.expected_amount_cents=OLD.total_cents)) OR
    (OLD.status='ACTIVE' AND NEW.status='ACTIVE' AND NEW.registration_id IS OLD.registration_id
      AND NEW.current_revision=OLD.current_revision+1
      AND NEW.total_cents=(SELECT total_cents FROM activity_installment_revision
        WHERE plan_id=OLD.id AND revision=NEW.current_revision)
      AND (OLD.registration_id IS NULL OR NEW.total_cents=(SELECT expected_amount_cents
        FROM activity_registration WHERE id=OLD.registration_id))))
BEGIN SELECT RAISE(ABORT,'activity_installment_immutable'); END;
CREATE TRIGGER activity_installment_plan_activation BEFORE UPDATE OF status,current_revision ON activity_installment_plan
WHEN NEW.status='ACTIVE' AND (
  (SELECT count(*) FROM activity_installment_part WHERE plan_id=NEW.id AND revision=NEW.current_revision)<2 OR
  (SELECT count(*) FROM activity_installment_part WHERE plan_id=NEW.id AND revision=NEW.current_revision)!=
    (SELECT max(ordinal) FROM activity_installment_part WHERE plan_id=NEW.id AND revision=NEW.current_revision) OR
  (SELECT sum(planned_cents) FROM activity_installment_part WHERE plan_id=NEW.id AND revision=NEW.current_revision)!=NEW.total_cents OR
  (SELECT total_cents FROM activity_installment_revision WHERE plan_id=NEW.id AND revision=NEW.current_revision)!=NEW.total_cents)
BEGIN SELECT RAISE(ABORT,'invalid_activity_installment_total'); END;
