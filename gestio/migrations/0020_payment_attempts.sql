-- FASE 3.5F (Atlas review): a registration may have 0..N payment attempts, each with its own proof and
-- its own incidence. Earlier migrations are unchanged.
--
-- payment_evidence was UNIQUE per registration (0003/0018). That inline constraint cannot be dropped in
-- place, so payment_evidence is rebuilt under its own name, every row copied unchanged (same ids). Its
-- only child, activity_payment_allocation (0019), is rebuilt with it so no parent is dropped while an old
-- RESTRICT child still points at it; the balance view and every trigger are recreated.
--
-- Model after this migration:
--   * obligation  = activity_registration.expected_amount_cents;
--   * attempt     = payment_evidence row (the family's proof of one payment), 0..N per registration, each
--                   with its own review state: PENDING_REVIEW / VERIFIED / ISSUE (incidence of that attempt);
--   * allocation  = each verified amount, append-only, linked to the attempt that proves it when there is
--                   one (evidence_id may be NULL for a bank-checked payment once 3.5G allows it);
--   * paid amount = activity_payment_balance, derived from allocations only; never above the obligation.
-- Verifying one attempt never closes the incidence of another.

DROP VIEW activity_payment_balance;

CREATE TABLE payment_evidence_v20 (
  id TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL REFERENCES activity_registration(id) ON DELETE RESTRICT,
  object_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 4194304),
  detected_mime TEXT NOT NULL CHECK(detected_mime IN ('application/pdf','image/png','image/jpeg','image/webp')),
  review_status TEXT NOT NULL CHECK(review_status IN ('PENDING_REVIEW','VERIFIED','ISSUE')),
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  reviewed_by TEXT REFERENCES app_user(id),
  object_purged_at INTEGER,
  object_purge_reason TEXT CHECK(object_purge_reason IS NULL OR object_purge_reason IN ('RETENTION_POLICY')),
  CHECK((object_purged_at IS NULL)=(object_purge_reason IS NULL)),
  CHECK(object_purged_at IS NULL OR review_status='VERIFIED')
);
CREATE TABLE activity_payment_allocation_v20 (
  id TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL REFERENCES activity_registration(id) ON DELETE RESTRICT,
  evidence_id TEXT REFERENCES payment_evidence_v20(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL CHECK(amount_cents BETWEEN 1 AND 1000000),
  source TEXT NOT NULL DEFAULT 'VERIFICATION' CHECK(source IN ('VERIFICATION','LEGACY_FULL_VERIFICATION')),
  created_by TEXT REFERENCES app_user(id),
  created_at INTEGER NOT NULL,
  CHECK(source!='VERIFICATION' OR created_by IS NOT NULL)
);

INSERT INTO payment_evidence_v20(id,registration_id,object_key,sha256,size_bytes,detected_mime,review_status,created_at,reviewed_at,reviewed_by,
  object_purged_at,object_purge_reason)
SELECT id,registration_id,object_key,sha256,size_bytes,detected_mime,review_status,created_at,reviewed_at,reviewed_by,object_purged_at,object_purge_reason
FROM payment_evidence;
INSERT INTO activity_payment_allocation_v20(id,registration_id,evidence_id,amount_cents,source,created_by,created_at)
SELECT id,registration_id,evidence_id,amount_cents,source,created_by,created_at FROM activity_payment_allocation;

DROP TABLE activity_payment_allocation;
DROP TABLE payment_evidence;
ALTER TABLE payment_evidence_v20 RENAME TO payment_evidence;
ALTER TABLE activity_payment_allocation_v20 RENAME TO activity_payment_allocation;

CREATE INDEX payment_evidence_registration_idx ON payment_evidence(registration_id,created_at);
CREATE INDEX activity_payment_allocation_registration_idx ON activity_payment_allocation(registration_id,created_at);
CREATE INDEX activity_payment_allocation_evidence_idx ON activity_payment_allocation(evidence_id);

CREATE VIEW activity_payment_balance AS
SELECT r.id AS registration_id,r.expected_amount_cents AS due_cents,
  COALESCE((SELECT SUM(a.amount_cents) FROM activity_payment_allocation a WHERE a.registration_id=r.id),0) AS paid_cents
FROM activity_registration r;

-- Allocations: never above the obligation, only where a payment can still be recorded, and the attempt
-- (when given) belongs to the same registration. Append-only.
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

-- Review of one attempt. A pending attempt may be verified or flagged at any time (a surplus proof can be
-- flagged too); a flagged attempt is resolved by verifying its amount; a verified attempt may receive a
-- further amount or be flagged only while the obligation is not covered. The service updates the attempt
-- before inserting the allocation.
CREATE TRIGGER payment_review_transition BEFORE UPDATE OF review_status ON payment_evidence
WHEN NOT ((OLD.review_status='PENDING_REVIEW' AND NEW.review_status IN ('ISSUE','VERIFIED')) OR
  (OLD.review_status='ISSUE' AND NEW.review_status='VERIFIED') OR
  (OLD.review_status='VERIFIED' AND NEW.review_status IN ('VERIFIED','ISSUE') AND
    (SELECT paid_cents<due_cents FROM activity_payment_balance WHERE registration_id=NEW.registration_id)))
BEGIN SELECT RAISE(ABORT,'invalid_payment_transition'); END;
CREATE TRIGGER payment_evidence_purge_once BEFORE UPDATE OF object_purged_at,object_purge_reason ON payment_evidence
WHEN OLD.object_purged_at IS NOT NULL
BEGIN SELECT RAISE(ABORT,'payment_evidence_purged'); END;
