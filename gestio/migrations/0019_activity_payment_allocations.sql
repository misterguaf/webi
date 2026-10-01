-- FASE 3.5F closure: activity payments in several instalments. Earlier migrations are unchanged.
--
-- Following the annual-fee principle (obligation != payment != allocation):
--   * obligation  = the registration's expected amount (activity_registration.expected_amount_cents);
--   * evidence    = the family's proof (payment_evidence, one per registration as before);
--   * allocation  = one verified amount applied to the registration (activity_payment_allocation),
--                   append-only: several instalments accumulate, nothing is ever overwritten.
-- The amount paid is always derived from the allocations (activity_payment_balance); the payment state
-- (PENDING / PARTIAL / PAID / ISSUE) is derived from it and from the open incidence on the evidence.
-- An incidence never removes verified amounts. 3.5G can later link allocations to bank movements by id.

CREATE TABLE activity_payment_allocation (
  id TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL REFERENCES activity_registration(id) ON DELETE RESTRICT,
  evidence_id TEXT REFERENCES payment_evidence(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 1000000),
  -- LEGACY_FULL_VERIFICATION: evidence verified before 3.5F instalments, which always meant the full amount.
  source TEXT NOT NULL DEFAULT 'VERIFICATION' CHECK(source IN ('VERIFICATION','LEGACY_FULL_VERIFICATION')),
  created_by TEXT REFERENCES app_user(id),
  created_at INTEGER NOT NULL,
  CHECK(source!='VERIFICATION' OR created_by IS NOT NULL)
);
CREATE INDEX activity_payment_allocation_registration_idx ON activity_payment_allocation(registration_id,created_at);

-- Never more than the obligation; only for registrations where a payment can still be recorded; the
-- evidence, when given, belongs to the same registration.
CREATE TRIGGER activity_payment_allocation_guard BEFORE INSERT ON activity_payment_allocation
WHEN NOT EXISTS(SELECT 1 FROM activity_registration r WHERE r.id=NEW.registration_id
    AND r.status IN ('AWAITING_PAYMENT_REVIEW','WITHDRAWN','CONFIRMED'))
  OR (NEW.evidence_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM payment_evidence e WHERE e.id=NEW.evidence_id AND e.registration_id=NEW.registration_id))
  OR NEW.amount_cents+(SELECT COALESCE(SUM(a.amount_cents),0) FROM activity_payment_allocation a WHERE a.registration_id=NEW.registration_id)
    >(SELECT expected_amount_cents FROM activity_registration WHERE id=NEW.registration_id)
BEGIN SELECT RAISE(ABORT,'invalid_payment_allocation'); END;
CREATE TRIGGER activity_payment_allocation_no_update BEFORE UPDATE ON activity_payment_allocation
BEGIN SELECT RAISE(ABORT,'payment_allocation_immutable'); END;
CREATE TRIGGER activity_payment_allocation_no_delete BEFORE DELETE ON activity_payment_allocation
BEGIN SELECT RAISE(ABORT,'payment_allocation_immutable'); END;

-- Existing verified evidence meant "paid in full": record it as one allocation per registration.
INSERT INTO activity_payment_allocation(id,registration_id,evidence_id,amount_cents,source,created_by,created_at)
SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-'||
  substr('89ab',1+(abs(random())%4),1)||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
  e.registration_id,e.id,r.expected_amount_cents,'LEGACY_FULL_VERIFICATION',e.reviewed_by,COALESCE(e.reviewed_at,e.created_at)
FROM payment_evidence e JOIN activity_registration r ON r.id=e.registration_id
WHERE e.review_status='VERIFIED' AND r.expected_amount_cents>0;

-- Paid amount per registration (derived; never stored).
CREATE VIEW activity_payment_balance AS
SELECT r.id AS registration_id,r.expected_amount_cents AS due_cents,
  COALESCE((SELECT SUM(a.amount_cents) FROM activity_payment_allocation a WHERE a.registration_id=r.id),0) AS paid_cents
FROM activity_registration r;

-- Evidence review states now describe the proof across instalments: VERIFIED = at least one amount
-- verified and no open incidence; ISSUE = open incidence. An incidence may be opened after a partial
-- verification (the verified amounts stay), never once the obligation is fully paid; a later
-- verification closes it. A further verification (VERIFIED→VERIFIED) is only possible while something
-- remains to be paid; the service updates the evidence before inserting the new allocation.
DROP TRIGGER payment_review_transition;
CREATE TRIGGER payment_review_transition BEFORE UPDATE OF review_status ON payment_evidence
WHEN NOT ((OLD.review_status='PENDING_REVIEW' AND NEW.review_status IN ('ISSUE','VERIFIED')) OR
  (OLD.review_status='ISSUE' AND NEW.review_status='VERIFIED') OR
  (OLD.review_status='VERIFIED' AND NEW.review_status='VERIFIED' AND
    (SELECT paid_cents<due_cents FROM activity_payment_balance WHERE registration_id=NEW.registration_id)) OR
  (OLD.review_status='VERIFIED' AND NEW.review_status='ISSUE' AND
    (SELECT paid_cents<due_cents FROM activity_payment_balance WHERE registration_id=NEW.registration_id)))
BEGIN SELECT RAISE(ABORT,'invalid_payment_transition'); END;
