-- G.4: preserve the official close while attributing later reconciled family receipts
-- to their original economic round. Reclassification reverses the old set first.
ALTER TABLE finance_post_close_adjustment ADD COLUMN source_allocation_id TEXT REFERENCES finance_allocation(id) ON DELETE RESTRICT;
ALTER TABLE finance_post_close_adjustment ADD COLUMN source_direction TEXT CHECK(source_direction IN ('ADD','REVERSE'));
CREATE UNIQUE INDEX finance_post_close_allocation_event ON finance_post_close_adjustment(source_allocation_id,source_direction);
CREATE TRIGGER finance_post_close_source_immutable BEFORE UPDATE OF source_allocation_id,source_direction ON finance_post_close_adjustment
WHEN NEW.source_allocation_id IS NOT OLD.source_allocation_id OR NEW.source_direction IS NOT OLD.source_direction
BEGIN SELECT RAISE(ABORT,'post_close_adjustment_immutable'); END;

CREATE TRIGGER finance_late_family_receipt AFTER INSERT ON finance_allocation
WHEN NEW.kind IN ('FEE_PAYMENT','ACTIVITY_PAYMENT')
BEGIN
  INSERT INTO finance_post_close_adjustment
    (id,closed_round_id,kind,amount_cents,carry_state,created_by,created_at,source_allocation_id,source_direction)
  SELECT lower(hex(randomblob(16))),r.id,'LATE_INCOME',NEW.amount_cents,'PENDING_CARRY',NEW.created_by,NEW.created_at,NEW.id,'ADD'
  FROM finance_round r
  LEFT JOIN annual_fee_payment fp ON fp.id=NEW.fee_payment_id
  LEFT JOIN activity_payment_allocation pa ON pa.id=NEW.activity_allocation_id
  LEFT JOIN activity_registration ar ON ar.id=pa.registration_id
  WHERE r.status='CLOSED' AND
    ((NEW.kind='FEE_PAYMENT' AND r.annual_fee_round_id=fp.round_id) OR
     (NEW.kind='ACTIVITY_PAYMENT' AND r.id=ar.finance_round_id));
END;

CREATE TRIGGER finance_late_family_reclassification AFTER UPDATE OF allocation_version ON finance_movement
WHEN NEW.allocation_version=OLD.allocation_version+1 AND OLD.allocation_version>0
BEGIN
  INSERT INTO finance_post_close_adjustment
    (id,closed_round_id,kind,amount_cents,carry_state,created_by,created_at,source_allocation_id,source_direction)
  SELECT lower(hex(randomblob(16))),r.id,'CORRECTION',-a.amount_cents,'PENDING_CARRY',a.created_by,
    CAST(strftime('%s','now') AS INTEGER)*1000,a.id,'REVERSE'
  FROM finance_allocation a
  LEFT JOIN annual_fee_payment fp ON fp.id=a.fee_payment_id
  LEFT JOIN activity_payment_allocation pa ON pa.id=a.activity_allocation_id
  LEFT JOIN activity_registration ar ON ar.id=pa.registration_id
  JOIN finance_round r ON r.status='CLOSED' AND
    ((a.kind='FEE_PAYMENT' AND r.annual_fee_round_id=fp.round_id) OR
     (a.kind='ACTIVITY_PAYMENT' AND r.id=ar.finance_round_id))
  WHERE a.movement_id=OLD.id AND a.set_version=OLD.allocation_version
    AND a.kind IN ('FEE_PAYMENT','ACTIVITY_PAYMENT');
END;
