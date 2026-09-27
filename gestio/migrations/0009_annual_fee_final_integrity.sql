-- The family link is structural: an open correction gate cannot commit a missing or mismatched member.
-- Virtual generated columns allow an incremental deferred FK without rebuilding referenced tables.
CREATE TABLE annual_fee_final_integrity_assert (invalid_count INTEGER NOT NULL CHECK(invalid_count=0));
INSERT INTO annual_fee_final_integrity_assert SELECT count(*) FROM annual_fee_family_correction_gate;
INSERT INTO annual_fee_final_integrity_assert SELECT count(*) FROM annual_fee_obligation o
  WHERE o.family_group_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM annual_fee_family_member m
    WHERE m.group_id=o.family_group_id AND m.round_id=o.round_id
      AND m.participant_id=o.participant_id AND m.sibling_ordinal=o.sibling_ordinal);
INSERT INTO annual_fee_final_integrity_assert SELECT count(*) FROM annual_fee_family_member m
  JOIN annual_fee_obligation o ON o.round_id=m.round_id AND o.participant_id=m.participant_id
  WHERE o.family_group_id IS NOT m.group_id OR o.sibling_ordinal!=m.sibling_ordinal;
DROP TABLE annual_fee_final_integrity_assert;

ALTER TABLE annual_fee_family_member ADD COLUMN binding_key TEXT
  GENERATED ALWAYS AS (length(group_id)||':'||group_id||length(round_id)||':'||round_id||
    length(participant_id)||':'||participant_id||':'||sibling_ordinal) VIRTUAL;
CREATE UNIQUE INDEX annual_fee_family_member_binding_unique ON annual_fee_family_member(binding_key);
ALTER TABLE annual_fee_obligation ADD COLUMN family_binding_key TEXT
  GENERATED ALWAYS AS (CASE WHEN family_group_id IS NULL THEN NULL
    ELSE length(family_group_id)||':'||family_group_id||length(round_id)||':'||round_id||
      length(participant_id)||':'||participant_id||':'||sibling_ordinal END) VIRTUAL
  REFERENCES annual_fee_family_member(binding_key) DEFERRABLE INITIALLY DEFERRED;

-- The reverse direction matters when an obligation exists before the family is assembled.
-- The service removes old members, updates obligations, then inserts the final members in one batch.
CREATE TRIGGER annual_fee_family_member_binding_insert BEFORE INSERT ON annual_fee_family_member
WHEN EXISTS(SELECT 1 FROM annual_fee_obligation o WHERE o.round_id=NEW.round_id
  AND o.participant_id=NEW.participant_id AND
  (o.family_group_id IS NOT NEW.group_id OR o.sibling_ordinal!=NEW.sibling_ordinal))
BEGIN SELECT RAISE(ABORT,'invalid_fee_family_binding'); END;
CREATE TRIGGER annual_fee_family_member_binding_update BEFORE UPDATE ON annual_fee_family_member
WHEN EXISTS(SELECT 1 FROM annual_fee_obligation o WHERE o.round_id=NEW.round_id
  AND o.participant_id=NEW.participant_id AND
  (o.family_group_id IS NOT NEW.group_id OR o.sibling_ordinal!=NEW.sibling_ordinal))
BEGIN SELECT RAISE(ABORT,'invalid_fee_family_binding'); END;
CREATE TRIGGER annual_fee_obligation_member_update
BEFORE UPDATE OF family_group_id,round_id,participant_id,sibling_ordinal ON annual_fee_obligation
WHEN EXISTS(SELECT 1 FROM annual_fee_family_member m WHERE m.round_id=NEW.round_id
  AND m.participant_id=NEW.participant_id AND
  (NEW.family_group_id IS NOT m.group_id OR NEW.sibling_ordinal!=m.sibling_ordinal))
BEGIN SELECT RAISE(ABORT,'invalid_fee_family_binding'); END;
