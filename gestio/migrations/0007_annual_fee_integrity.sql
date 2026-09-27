-- FASE 3B follow-up: preserve payment and installment invariants without rewriting 0006.
ALTER TABLE annual_fee_family_group ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(version>0);

CREATE TABLE annual_fee_family_revision (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES annual_fee_family_group(id) ON DELETE RESTRICT,
  previous_version INTEGER NOT NULL CHECK(previous_version>0),
  new_version INTEGER NOT NULL CHECK(new_version=previous_version+1),
  changed_by TEXT NOT NULL REFERENCES app_user(id),
  changed_at INTEGER NOT NULL
);
CREATE TABLE annual_fee_family_revision_member (
  revision_id TEXT NOT NULL REFERENCES annual_fee_family_revision(id) ON DELETE RESTRICT,
  participant_id TEXT NOT NULL REFERENCES participant(id) ON DELETE RESTRICT,
  previous_group_id TEXT REFERENCES annual_fee_family_group(id) ON DELETE RESTRICT,
  new_group_id TEXT REFERENCES annual_fee_family_group(id) ON DELETE RESTRICT,
  previous_ordinal INTEGER CHECK(previous_ordinal IS NULL OR previous_ordinal BETWEEN 1 AND 20),
  new_ordinal INTEGER CHECK(new_ordinal IS NULL OR new_ordinal BETWEEN 1 AND 20),
  previous_discount_cents INTEGER CHECK(previous_discount_cents IS NULL OR previous_discount_cents>=0),
  new_discount_cents INTEGER CHECK(new_discount_cents IS NULL OR new_discount_cents>=0),
  previous_amount_due_cents INTEGER CHECK(previous_amount_due_cents IS NULL OR previous_amount_due_cents>0),
  new_amount_due_cents INTEGER CHECK(new_amount_due_cents IS NULL OR new_amount_due_cents>0),
  PRIMARY KEY(revision_id,participant_id)
);
CREATE INDEX annual_fee_family_revision_group_idx ON annual_fee_family_revision(group_id,changed_at);

CREATE TRIGGER annual_fee_payment_no_unverify_allocated BEFORE UPDATE OF verified_amount_cents ON annual_fee_payment
WHEN NEW.verified_amount_cents IS NULL AND EXISTS(
  SELECT 1 FROM annual_fee_allocation WHERE payment_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'allocated_fee_payment_requires_verified_amount'); END;
CREATE TRIGGER annual_fee_confirm_delivery_guard BEFORE UPDATE OF status ON annual_fee_notification_outbox
WHEN NEW.kind='FEE_PAYMENT_CONFIRMED' AND NEW.status='SENT' AND
  (EXISTS(SELECT 1 FROM annual_fee_issue i WHERE i.payment_id=NEW.payment_id AND i.status='OPEN') OR
   EXISTS(SELECT 1 FROM annual_fee_allocation a JOIN annual_fee_issue i ON i.obligation_id=a.obligation_id
     WHERE a.payment_id=NEW.payment_id AND i.status='OPEN') OR
   NOT EXISTS(SELECT 1 FROM annual_fee_allocation a JOIN annual_fee_obligation_status o ON o.id=a.obligation_id
     WHERE a.payment_id=NEW.payment_id AND o.status='PAID'))
BEGIN SELECT RAISE(ABORT,'fee_confirmation_blocked'); END;

CREATE TRIGGER annual_fee_obligation_allocation_amount_guard BEFORE UPDATE OF amount_due_cents ON annual_fee_obligation
WHEN NEW.amount_due_cents<(SELECT COALESCE(SUM(amount_cents),0) FROM annual_fee_allocation WHERE obligation_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'fee_allocation_exceeds_amount_due'); END;
CREATE TRIGGER annual_fee_obligation_family_insert_guard BEFORE INSERT ON annual_fee_obligation
WHEN (NEW.family_group_id IS NULL AND (NEW.sibling_ordinal!=1 OR NEW.discount_cents!=0 OR
      EXISTS(SELECT 1 FROM annual_fee_family_member m WHERE m.round_id=NEW.round_id AND m.participant_id=NEW.participant_id)))
  OR (NEW.family_group_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM annual_fee_family_member m
      WHERE m.round_id=NEW.round_id AND m.participant_id=NEW.participant_id
      AND m.group_id=NEW.family_group_id AND m.sibling_ordinal=NEW.sibling_ordinal))
  OR NEW.discount_cents!=CASE WHEN NEW.sibling_ordinal>=3 THEN CAST(NEW.base_cents/2 AS INTEGER) ELSE 0 END
BEGIN SELECT RAISE(ABORT,'invalid_fee_family_snapshot'); END;
CREATE TRIGGER annual_fee_obligation_family_update_guard
BEFORE UPDATE OF family_group_id,sibling_ordinal,discount_cents,base_cents ON annual_fee_obligation
WHEN (NEW.family_group_id IS NULL AND (NEW.sibling_ordinal!=1 OR NEW.discount_cents!=0 OR
      EXISTS(SELECT 1 FROM annual_fee_family_member m WHERE m.round_id=NEW.round_id AND m.participant_id=NEW.participant_id)))
  OR (NEW.family_group_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM annual_fee_family_member m
      WHERE m.round_id=NEW.round_id AND m.participant_id=NEW.participant_id
      AND m.group_id=NEW.family_group_id AND m.sibling_ordinal=NEW.sibling_ordinal))
  OR NEW.discount_cents!=CASE WHEN NEW.sibling_ordinal>=3 THEN CAST(NEW.base_cents/2 AS INTEGER) ELSE 0 END
BEGIN SELECT RAISE(ABORT,'invalid_fee_family_snapshot'); END;

-- A finalized plan stores both parts in one row; a view preserves the original read shape.
CREATE TABLE annual_fee_installment_plan_new (
  id TEXT PRIMARY KEY,
  obligation_id TEXT NOT NULL UNIQUE REFERENCES annual_fee_obligation(id) ON DELETE RESTRICT,
  authorized_by TEXT NOT NULL REFERENCES app_user(id),
  authorized_at INTEGER NOT NULL,
  first_cents INTEGER NOT NULL CHECK(first_cents>0),
  second_cents INTEGER NOT NULL CHECK(second_cents>0),
  first_target_at INTEGER,
  second_target_at INTEGER
);
CREATE TRIGGER annual_fee_installment_total_insert BEFORE INSERT ON annual_fee_installment_plan_new
WHEN NEW.first_cents+NEW.second_cents!=(SELECT amount_due_cents FROM annual_fee_obligation WHERE id=NEW.obligation_id)
BEGIN SELECT RAISE(ABORT,'invalid_installment_total'); END;
INSERT INTO annual_fee_installment_plan_new
  (id,obligation_id,authorized_by,authorized_at,first_cents,second_cents,first_target_at,second_target_at)
SELECT p.id,p.obligation_id,p.authorized_by,p.authorized_at,a.planned_cents,b.planned_cents,a.target_at,b.target_at
FROM annual_fee_installment_plan p
LEFT JOIN annual_fee_installment_part a ON a.plan_id=p.id AND a.ordinal=1
LEFT JOIN annual_fee_installment_part b ON b.plan_id=p.id AND b.ordinal=2;
DROP TABLE annual_fee_installment_part;
DROP TABLE annual_fee_installment_plan;
ALTER TABLE annual_fee_installment_plan_new RENAME TO annual_fee_installment_plan;
DROP TRIGGER annual_fee_installment_total_insert;
CREATE TRIGGER annual_fee_installment_total_insert BEFORE INSERT ON annual_fee_installment_plan
WHEN NEW.first_cents+NEW.second_cents!=(SELECT amount_due_cents FROM annual_fee_obligation WHERE id=NEW.obligation_id)
BEGIN SELECT RAISE(ABORT,'invalid_installment_total'); END;
CREATE TRIGGER annual_fee_installment_total_update BEFORE UPDATE ON annual_fee_installment_plan
WHEN NEW.first_cents+NEW.second_cents!=(SELECT amount_due_cents FROM annual_fee_obligation WHERE id=NEW.obligation_id)
BEGIN SELECT RAISE(ABORT,'invalid_installment_total'); END;
CREATE TRIGGER annual_fee_installment_immutable_update BEFORE UPDATE ON annual_fee_installment_plan
BEGIN SELECT RAISE(ABORT,'installment_plan_immutable'); END;
CREATE TRIGGER annual_fee_installment_immutable_delete BEFORE DELETE ON annual_fee_installment_plan
BEGIN SELECT RAISE(ABORT,'installment_plan_immutable'); END;
CREATE TRIGGER annual_fee_obligation_installment_total_update BEFORE UPDATE OF amount_due_cents ON annual_fee_obligation
WHEN EXISTS(SELECT 1 FROM annual_fee_installment_plan p WHERE p.obligation_id=NEW.id
  AND p.first_cents+p.second_cents!=NEW.amount_due_cents)
BEGIN SELECT RAISE(ABORT,'invalid_installment_total'); END;
CREATE VIEW annual_fee_installment_part AS
SELECT id AS plan_id,1 AS ordinal,first_cents AS planned_cents,first_target_at AS target_at
FROM annual_fee_installment_plan
UNION ALL
SELECT id AS plan_id,2 AS ordinal,second_cents AS planned_cents,second_target_at AS target_at
FROM annual_fee_installment_plan;

DROP VIEW annual_fee_obligation_status;
CREATE VIEW annual_fee_obligation_status AS
SELECT o.id,o.round_id,o.participant_id,o.family_group_id,o.sibling_ordinal,o.base_cents,o.discount_cents,
  o.amount_due_cents,o.override_by,o.created_at,p.display_name,p.current_section_id,
  COALESCE((SELECT SUM(a.amount_cents) FROM annual_fee_allocation a JOIN annual_fee_payment pay ON pay.id=a.payment_id
    WHERE a.obligation_id=o.id AND pay.verified_amount_cents IS NOT NULL),0) AS allocated_cents,
  CASE
    WHEN EXISTS(SELECT 1 FROM annual_fee_issue i WHERE i.obligation_id=o.id AND i.status='OPEN') THEN 'ISSUE'
    WHEN EXISTS(SELECT 1 FROM annual_fee_allocation a JOIN annual_fee_issue i ON i.payment_id=a.payment_id
      WHERE a.obligation_id=o.id AND i.status='OPEN' AND
      (i.obligation_id IS NULL OR i.code IN ('BANK_NOT_FOUND','EVIDENCE_PROBLEM','UNIDENTIFIED_TRANSFER'))) THEN 'ISSUE'
    WHEN COALESCE((SELECT SUM(a.amount_cents) FROM annual_fee_allocation a JOIN annual_fee_payment pay ON pay.id=a.payment_id
      WHERE a.obligation_id=o.id AND pay.verified_amount_cents IS NOT NULL),0)>o.amount_due_cents THEN 'ISSUE'
    WHEN COALESCE((SELECT SUM(a.amount_cents) FROM annual_fee_allocation a JOIN annual_fee_payment pay ON pay.id=a.payment_id
      WHERE a.obligation_id=o.id AND pay.verified_amount_cents IS NOT NULL),0)=o.amount_due_cents THEN 'PAID'
    WHEN EXISTS(SELECT 1 FROM annual_fee_allocation a WHERE a.obligation_id=o.id) THEN 'PARTIAL'
    ELSE 'PENDING' END AS status
FROM annual_fee_obligation o JOIN participant p ON p.id=o.participant_id;
