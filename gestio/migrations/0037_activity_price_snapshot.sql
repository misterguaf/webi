-- G.3: the price at submission is a domain snapshot. A round family ordinal is
-- used only when the participant is actually matched and explicitly grouped.
ALTER TABLE activity_registration ADD COLUMN price_base_cents INTEGER NOT NULL DEFAULT 0 CHECK(price_base_cents BETWEEN 0 AND 1000000);
ALTER TABLE activity_registration ADD COLUMN price_discount_cents INTEGER NOT NULL DEFAULT 0 CHECK(price_discount_cents BETWEEN 0 AND 1000000);
ALTER TABLE activity_registration ADD COLUMN price_sibling_ordinal INTEGER NOT NULL DEFAULT 1 CHECK(price_sibling_ordinal BETWEEN 1 AND 20);
ALTER TABLE activity_registration ADD COLUMN price_family_group_id TEXT REFERENCES annual_fee_family_group(id) ON DELETE RESTRICT;
UPDATE activity_registration SET price_base_cents=expected_amount_cents;

CREATE TABLE activity_price_correction_gate (
  registration_id TEXT PRIMARY KEY REFERENCES activity_registration(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 240),
  opened_at INTEGER NOT NULL
);
CREATE TABLE activity_price_revision (
  id TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL REFERENCES activity_registration(id) ON DELETE RESTRICT,
  previous_amount_cents INTEGER NOT NULL,
  new_amount_cents INTEGER NOT NULL,
  previous_discount_cents INTEGER NOT NULL,
  new_discount_cents INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 240),
  changed_by TEXT NOT NULL REFERENCES app_user(id),
  changed_at INTEGER NOT NULL,
  CHECK(previous_amount_cents!=new_amount_cents OR previous_discount_cents!=new_discount_cents)
);
CREATE INDEX activity_price_revision_registration_idx ON activity_price_revision(registration_id,changed_at);
CREATE TRIGGER activity_price_revision_no_update BEFORE UPDATE ON activity_price_revision
BEGIN SELECT RAISE(ABORT,'activity_price_revision_immutable'); END;
CREATE TRIGGER activity_price_revision_no_delete BEFORE DELETE ON activity_price_revision
BEGIN SELECT RAISE(ABORT,'activity_price_revision_immutable'); END;

CREATE TRIGGER activity_registration_price_insert_guard BEFORE INSERT ON activity_registration
WHEN NEW.finance_round_id IS NOT NULL AND NEW.expected_amount_cents>0 AND (
  NEW.price_base_cents!=NEW.expected_amount_cents+NEW.price_discount_cents OR
  NEW.price_discount_cents!=CASE WHEN NEW.price_sibling_ordinal>=3 THEN CAST(NEW.price_base_cents/2 AS INTEGER) ELSE 0 END OR
  (NEW.price_family_group_id IS NULL AND NEW.price_sibling_ordinal!=1) OR
  (NEW.price_family_group_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM annual_fee_family_member m JOIN finance_round r ON r.annual_fee_round_id=m.round_id
    WHERE r.id=NEW.finance_round_id AND m.participant_id=NEW.participant_id
      AND m.group_id=NEW.price_family_group_id AND m.sibling_ordinal=NEW.price_sibling_ordinal)))
BEGIN SELECT RAISE(ABORT,'invalid_activity_price_snapshot'); END;
CREATE TRIGGER activity_registration_price_update_guard BEFORE UPDATE OF expected_amount_cents,price_base_cents,
  price_discount_cents,price_sibling_ordinal,price_family_group_id ON activity_registration
WHEN (NEW.expected_amount_cents IS NOT OLD.expected_amount_cents OR NEW.price_base_cents IS NOT OLD.price_base_cents
  OR NEW.price_discount_cents IS NOT OLD.price_discount_cents OR NEW.price_sibling_ordinal IS NOT OLD.price_sibling_ordinal
  OR NEW.price_family_group_id IS NOT OLD.price_family_group_id)
  AND NOT EXISTS(SELECT 1 FROM activity_price_correction_gate WHERE registration_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'activity_price_correction_required'); END;
