-- G.3: a submitted activity price may be corrected with a reason and a separate refundable excess.
-- Verified allocations remain append-only; the effective paid balance excludes those excess claims.
ALTER TABLE activity_price_correction_gate ADD COLUMN target_due_cents INTEGER CHECK(target_due_cents BETWEEN 1 AND 1000000);
ALTER TABLE activity_price_correction_gate ADD COLUMN opened_by TEXT REFERENCES app_user(id);

DROP VIEW activity_payment_balance;
CREATE VIEW activity_payment_balance AS
SELECT r.id AS registration_id,r.expected_amount_cents AS due_cents,
  COALESCE((SELECT sum(a.amount_cents) FROM activity_payment_allocation a WHERE a.registration_id=r.id),0)
    -COALESCE((SELECT sum(o.amount_cents) FROM finance_overpayment o WHERE o.registration_id=r.id),0) AS paid_cents
FROM activity_registration r;

DROP TRIGGER finance_overpayment_insert_guard;
CREATE TRIGGER finance_overpayment_insert_guard BEFORE INSERT ON finance_overpayment
WHEN NEW.status!='OPEN' OR NEW.round_id IS NULL OR
  (NEW.fee_payment_id IS NOT NULL AND (
    NOT EXISTS(SELECT 1 FROM annual_fee_payment p JOIN finance_round r ON r.annual_fee_round_id=p.round_id
      WHERE p.id=NEW.fee_payment_id AND r.id=NEW.round_id AND p.review_status='VERIFIED'
        AND p.receipt_email=NEW.recipient_email) OR
    (NEW.cause='PAYMENT_EXCESS' AND (NEW.fee_obligation_id IS NOT NULL OR
      NEW.amount_cents>COALESCE((SELECT unallocated_cents FROM annual_fee_payment_balance
        WHERE id=NEW.fee_payment_id),0))) OR
    (NEW.cause='PRICE_CORRECTION' AND (
      NEW.fee_obligation_id IS NULL OR
      NOT EXISTS(SELECT 1 FROM finance_fee_correction_gate g JOIN annual_fee_obligation ob ON ob.id=g.obligation_id
        JOIN annual_fee_payment p ON p.round_id=ob.round_id
        WHERE g.obligation_id=NEW.fee_obligation_id AND p.id=NEW.fee_payment_id AND g.opened_by=NEW.created_by)
      OR NEW.amount_cents>COALESCE((SELECT sum(a.amount_cents) FROM annual_fee_allocation a
        WHERE a.payment_id=NEW.fee_payment_id AND a.obligation_id=NEW.fee_obligation_id),0)
        -COALESCE((SELECT sum(o.amount_cents) FROM finance_overpayment o
          WHERE o.fee_payment_id=NEW.fee_payment_id AND o.fee_obligation_id=NEW.fee_obligation_id),0)
      OR NEW.amount_cents>COALESCE((SELECT sum(a.amount_cents) FROM annual_fee_allocation a
        JOIN annual_fee_payment p ON p.id=a.payment_id
        WHERE a.obligation_id=NEW.fee_obligation_id AND p.review_status='VERIFIED'),0)
        -(SELECT target_due_cents FROM finance_fee_correction_gate WHERE obligation_id=NEW.fee_obligation_id)
        -COALESCE((SELECT sum(o.amount_cents) FROM finance_overpayment o
          WHERE o.fee_obligation_id=NEW.fee_obligation_id),0)))
  )) OR
  (NEW.registration_id IS NOT NULL AND (
    NEW.fee_obligation_id IS NOT NULL OR
    NOT EXISTS(SELECT 1 FROM activity_registration r WHERE r.id=NEW.registration_id
      AND r.finance_round_id=NEW.round_id AND r.receipt_email=NEW.recipient_email) OR
    (NEW.cause='PAYMENT_EXCESS' AND NEW.amount_cents>
      COALESCE((SELECT sum(a.amount_cents) FROM activity_payment_allocation a
        WHERE a.registration_id=NEW.registration_id),0)
      -(SELECT expected_amount_cents FROM activity_registration WHERE id=NEW.registration_id)
      -COALESCE((SELECT sum(o.amount_cents) FROM finance_overpayment o
        WHERE o.registration_id=NEW.registration_id),0)) OR
    (NEW.cause='PRICE_CORRECTION' AND (
      NOT EXISTS(SELECT 1 FROM activity_price_correction_gate g WHERE g.registration_id=NEW.registration_id
        AND g.opened_by=NEW.created_by AND g.target_due_cents IS NOT NULL) OR
      NEW.amount_cents>COALESCE((SELECT sum(a.amount_cents) FROM activity_payment_allocation a
        WHERE a.registration_id=NEW.registration_id),0)
        -(SELECT target_due_cents FROM activity_price_correction_gate WHERE registration_id=NEW.registration_id)
        -COALESCE((SELECT sum(o.amount_cents) FROM finance_overpayment o
          WHERE o.registration_id=NEW.registration_id),0)))
  ))
BEGIN SELECT RAISE(ABORT,'invalid_family_overpayment'); END;

DROP TRIGGER activity_payment_allocation_guard;
CREATE TRIGGER activity_payment_allocation_guard BEFORE INSERT ON activity_payment_allocation
WHEN NOT EXISTS(SELECT 1 FROM activity_registration r WHERE r.id=NEW.registration_id
    AND r.status IN ('NEEDS_PARTICIPANT_REVIEW','AWAITING_PAYMENT_REVIEW','WITHDRAWN','CONFIRMED'))
  OR (NEW.evidence_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM payment_evidence e
    WHERE e.id=NEW.evidence_id AND e.registration_id=NEW.registration_id))
  OR NEW.amount_cents+COALESCE((SELECT paid_cents FROM activity_payment_balance
    WHERE registration_id=NEW.registration_id),0)
    >(SELECT expected_amount_cents FROM activity_registration WHERE id=NEW.registration_id)
BEGIN SELECT RAISE(ABORT,'invalid_payment_allocation'); END;

CREATE TRIGGER activity_price_paid_amount_guard BEFORE UPDATE OF expected_amount_cents ON activity_registration
WHEN NEW.expected_amount_cents IS NOT OLD.expected_amount_cents AND (
  NOT EXISTS(SELECT 1 FROM activity_price_correction_gate g WHERE g.registration_id=OLD.id
    AND g.target_due_cents=NEW.expected_amount_cents AND g.opened_by IS NOT NULL) OR
  NEW.expected_amount_cents<COALESCE((SELECT paid_cents FROM activity_payment_balance
    WHERE registration_id=OLD.id),0))
BEGIN SELECT RAISE(ABORT,'activity_price_exceeds_verified_payment'); END;

DROP TRIGGER finance_family_refund_insert_guard;
CREATE TRIGGER finance_family_refund_insert_guard BEFORE INSERT ON finance_family_refund
WHEN (NEW.overpayment_id IS NOT NULL AND (
    NEW.cause!='OVERPAYMENT_REFUND' OR NEW.decision_id IS NOT NULL OR
    NOT EXISTS(SELECT 1 FROM finance_overpayment o WHERE o.id=NEW.overpayment_id AND o.status='OPEN'
      AND o.round_id=NEW.round_id AND o.recipient_email=NEW.recipient_email AND o.amount_cents=NEW.amount_cents
      AND o.amount_cents=COALESCE((SELECT sum(a.amount_cents) FROM finance_allocation_current a
        WHERE a.kind='FAMILY_OVERPAYMENT' AND a.overpayment_id=o.id),0))))
  OR (NEW.activity_allocation_id IS NOT NULL AND (
    NOT EXISTS(SELECT 1 FROM activity_payment_allocation a JOIN activity_registration r ON r.id=a.registration_id
      WHERE a.id=NEW.activity_allocation_id AND r.finance_round_id=NEW.round_id
        AND r.receipt_email=NEW.recipient_email AND NEW.amount_cents<=a.amount_cents
        AND ((r.status='WITHDRAWN' AND NEW.cause='ACTIVITY_WITHDRAWAL_REFUND'
          AND EXISTS(SELECT 1 FROM finance_family_refund_decision d WHERE d.id=NEW.decision_id
            AND d.registration_id=r.id AND d.decision IN ('FULL','PARTIAL')))
          OR (r.status='REJECTED' AND NEW.cause='ACTIVITY_REJECTION_REFUND' AND NEW.decision_id IS NULL
            AND NEW.amount_cents=max(0,min(a.amount_cents,
              (SELECT paid_cents FROM activity_payment_balance WHERE registration_id=r.id)
              -COALESCE((SELECT sum(prior.amount_cents) FROM activity_payment_allocation prior
                WHERE prior.registration_id=r.id AND (prior.created_at<a.created_at OR
                  (prior.created_at=a.created_at AND prior.id<a.id))),0))))))))
BEGIN SELECT RAISE(ABORT,'invalid_family_refund'); END;

-- A rejected registration returns the effective activity payment. Existing excess claims remain
-- separate liabilities; their refund is settled by the normal overpayment workflow.
DROP TRIGGER finance_rejected_registration_refunds;
CREATE TRIGGER finance_rejected_registration_refunds AFTER UPDATE OF status ON activity_registration
WHEN NEW.status='REJECTED' AND OLD.status!='REJECTED' AND NEW.finance_round_id IS NOT NULL
BEGIN
  INSERT INTO finance_family_refund(id,round_id,activity_allocation_id,recipient_email,cause,amount_cents,created_by,created_at)
  SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||
    substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
    NEW.finance_round_id,source.id,NEW.receipt_email,'ACTIVITY_REJECTION_REFUND',source.refund_cents,
    NEW.reviewed_by,NEW.reviewed_at
  FROM (
    SELECT a.id,
      max(0,min(a.amount_cents,
        (SELECT paid_cents FROM activity_payment_balance WHERE registration_id=NEW.id)
        -COALESCE(sum(a.amount_cents) OVER (ORDER BY a.created_at,a.id
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0))) AS refund_cents
    FROM activity_payment_allocation a WHERE a.registration_id=NEW.id
  ) source WHERE source.refund_cents>0;
END;
