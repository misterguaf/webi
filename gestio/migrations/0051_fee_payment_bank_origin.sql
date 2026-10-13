-- FASE 3.5I (C43): a quota can be paid by a bank transfer without a family proof. Treasury confirms the bank
-- movement and Gestió records the canonical Quotes payment for it (origin BANK, linked to the movement), verified
-- and allocated in the same atomic batch as the bank reconciliation. Additive: existing payments are FAMILY.
ALTER TABLE annual_fee_payment ADD COLUMN origin TEXT NOT NULL DEFAULT 'FAMILY' CHECK(origin IN ('FAMILY','BANK'));
-- No declared foreign key: annual_fee_payment is exported (backup) long before finance_movement, and D1 refuses rows of
-- a table whose referenced table does not exist yet. The trigger below enforces the same link; movements are never deleted.
ALTER TABLE annual_fee_payment ADD COLUMN source_movement_id TEXT CHECK((origin='BANK')=(source_movement_id IS NOT NULL));
CREATE INDEX annual_fee_payment_source_movement_idx ON annual_fee_payment(source_movement_id) WHERE source_movement_id IS NOT NULL;
CREATE TRIGGER annual_fee_payment_source_movement_guard BEFORE INSERT ON annual_fee_payment
WHEN NEW.source_movement_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM finance_movement m JOIN finance_position p ON p.id=m.position_id
  WHERE m.id=NEW.source_movement_id AND m.state='ACTIVE' AND p.kind='BANK' AND m.amount_cents>0)
BEGIN SELECT RAISE(ABORT,'invalid_fee_bank_payment'); END;
-- The origin of a payment never changes.
CREATE TRIGGER annual_fee_payment_origin_immutable BEFORE UPDATE OF origin,source_movement_id ON annual_fee_payment
WHEN NEW.origin IS NOT OLD.origin OR NEW.source_movement_id IS NOT OLD.source_movement_id
BEGIN SELECT RAISE(ABORT,'fee_payment_origin_immutable'); END;
