-- FASE 3.5I (C43): a quota can be paid by a bank transfer without a family proof. Treasury confirms the bank
-- movement and Gestió records the canonical Quotes payment for it (origin BANK, linked to the movement), verified
-- and allocated in the same atomic batch as the bank reconciliation. Additive: existing payments are FAMILY.
ALTER TABLE annual_fee_payment ADD COLUMN origin TEXT NOT NULL DEFAULT 'FAMILY' CHECK(origin IN ('FAMILY','BANK'));
ALTER TABLE annual_fee_payment ADD COLUMN source_movement_id TEXT REFERENCES finance_movement(id) ON DELETE RESTRICT
  CHECK((origin='BANK')=(source_movement_id IS NOT NULL));
CREATE INDEX annual_fee_payment_source_movement_idx ON annual_fee_payment(source_movement_id) WHERE source_movement_id IS NOT NULL;
-- The origin of a payment never changes.
CREATE TRIGGER annual_fee_payment_origin_immutable BEFORE UPDATE OF origin,source_movement_id ON annual_fee_payment
WHEN NEW.origin IS NOT OLD.origin OR NEW.source_movement_id IS NOT OLD.source_movement_id
BEGIN SELECT RAISE(ABORT,'fee_payment_origin_immutable'); END;
