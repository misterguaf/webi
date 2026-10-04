-- G.3: replace the finalised two-part fee plan with an N-part, versioned plan.
-- Existing plans keep their identifiers and exact two-part schedules.
DROP VIEW annual_fee_installment_part;
DROP TRIGGER annual_fee_obligation_installment_total_update;

CREATE TABLE annual_fee_installment_plan_v32 (
  id TEXT PRIMARY KEY,
  obligation_id TEXT NOT NULL REFERENCES annual_fee_obligation(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK(status IN ('DRAFT','ACTIVE','SUPERSEDED')),
  replaces_plan_id TEXT REFERENCES annual_fee_installment_plan_v32(id) ON DELETE RESTRICT,
  correction_reason TEXT CHECK(correction_reason IS NULL OR length(trim(correction_reason)) BETWEEN 3 AND 240),
  authorized_by TEXT NOT NULL REFERENCES app_user(id),
  authorized_at INTEGER NOT NULL,
  CHECK((replaces_plan_id IS NULL AND correction_reason IS NULL) OR
    (replaces_plan_id IS NOT NULL AND correction_reason IS NOT NULL))
);
INSERT INTO annual_fee_installment_plan_v32(id,obligation_id,status,authorized_by,authorized_at)
SELECT id,obligation_id,'ACTIVE',authorized_by,authorized_at FROM annual_fee_installment_plan;

CREATE TABLE annual_fee_installment_part_v32 (
  plan_id TEXT NOT NULL REFERENCES annual_fee_installment_plan_v32(id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 1 AND 100),
  planned_cents INTEGER NOT NULL CHECK(planned_cents BETWEEN 1 AND 10000000),
  target_at INTEGER CHECK(target_at IS NULL OR target_at>=0),
  PRIMARY KEY(plan_id,ordinal)
);
INSERT INTO annual_fee_installment_part_v32(plan_id,ordinal,planned_cents,target_at)
SELECT id,1,first_cents,first_target_at FROM annual_fee_installment_plan;
INSERT INTO annual_fee_installment_part_v32(plan_id,ordinal,planned_cents,target_at)
SELECT id,2,second_cents,second_target_at FROM annual_fee_installment_plan;

DROP TABLE annual_fee_installment_plan;
ALTER TABLE annual_fee_installment_plan_v32 RENAME TO annual_fee_installment_plan;
ALTER TABLE annual_fee_installment_part_v32 RENAME TO annual_fee_installment_part;
CREATE UNIQUE INDEX annual_fee_one_active_installment_plan ON annual_fee_installment_plan(obligation_id) WHERE status='ACTIVE';
CREATE UNIQUE INDEX annual_fee_plan_replaced_once ON annual_fee_installment_plan(replaces_plan_id) WHERE replaces_plan_id IS NOT NULL;

CREATE TRIGGER annual_fee_installment_plan_insert_guard BEFORE INSERT ON annual_fee_installment_plan
WHEN NEW.status!='DRAFT' OR (NEW.replaces_plan_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM annual_fee_installment_plan p WHERE p.id=NEW.replaces_plan_id
    AND p.obligation_id=NEW.obligation_id AND p.status='ACTIVE'))
BEGIN SELECT RAISE(ABORT,'invalid_installment_plan'); END;
CREATE TRIGGER annual_fee_installment_part_insert_guard BEFORE INSERT ON annual_fee_installment_part
WHEN (SELECT status FROM annual_fee_installment_plan WHERE id=NEW.plan_id)!='DRAFT'
BEGIN SELECT RAISE(ABORT,'installment_plan_immutable'); END;
CREATE TRIGGER annual_fee_installment_part_no_update BEFORE UPDATE ON annual_fee_installment_part
BEGIN SELECT RAISE(ABORT,'installment_plan_immutable'); END;
CREATE TRIGGER annual_fee_installment_part_no_delete BEFORE DELETE ON annual_fee_installment_part
BEGIN SELECT RAISE(ABORT,'installment_plan_immutable'); END;
CREATE TRIGGER annual_fee_installment_plan_activation BEFORE UPDATE OF status ON annual_fee_installment_plan
WHEN NEW.status='ACTIVE' AND (
  (SELECT count(*) FROM annual_fee_installment_part WHERE plan_id=NEW.id)<2 OR
  (SELECT count(*) FROM annual_fee_installment_part WHERE plan_id=NEW.id)!=(SELECT max(ordinal) FROM annual_fee_installment_part WHERE plan_id=NEW.id) OR
  (SELECT sum(planned_cents) FROM annual_fee_installment_part WHERE plan_id=NEW.id)!=(SELECT amount_due_cents FROM annual_fee_obligation WHERE id=NEW.obligation_id) OR
  (NEW.replaces_plan_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM annual_fee_installment_plan p
    WHERE p.id=NEW.replaces_plan_id AND p.obligation_id=NEW.obligation_id AND p.status='SUPERSEDED')))
BEGIN SELECT RAISE(ABORT,'invalid_installment_total'); END;
CREATE TRIGGER annual_fee_installment_plan_transition BEFORE UPDATE ON annual_fee_installment_plan
WHEN NOT ((OLD.status='DRAFT' AND NEW.status='ACTIVE') OR (OLD.status='ACTIVE' AND NEW.status='SUPERSEDED'))
  OR (OLD.status='ACTIVE' AND NEW.status='SUPERSEDED' AND NOT EXISTS(
    SELECT 1 FROM annual_fee_installment_plan p WHERE p.replaces_plan_id=OLD.id AND p.status='DRAFT'
      AND p.obligation_id=OLD.obligation_id AND p.correction_reason IS NOT NULL))
  OR NEW.obligation_id IS NOT OLD.obligation_id OR NEW.replaces_plan_id IS NOT OLD.replaces_plan_id
  OR NEW.correction_reason IS NOT OLD.correction_reason OR NEW.authorized_by IS NOT OLD.authorized_by
  OR NEW.authorized_at IS NOT OLD.authorized_at
BEGIN SELECT RAISE(ABORT,'installment_plan_immutable'); END;
CREATE TRIGGER annual_fee_installment_plan_no_delete BEFORE DELETE ON annual_fee_installment_plan
BEGIN SELECT RAISE(ABORT,'installment_plan_immutable'); END;
CREATE TRIGGER annual_fee_obligation_installment_total_update BEFORE UPDATE OF amount_due_cents ON annual_fee_obligation
WHEN EXISTS(SELECT 1 FROM annual_fee_installment_plan p WHERE p.obligation_id=NEW.id AND p.status='ACTIVE'
  AND (SELECT sum(planned_cents) FROM annual_fee_installment_part WHERE plan_id=p.id)!=NEW.amount_due_cents)
BEGIN SELECT RAISE(ABORT,'invalid_installment_total'); END;
