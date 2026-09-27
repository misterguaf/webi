-- Incremental 3B hardening. Earlier migrations remain immutable.
ALTER TABLE annual_fee_payment ADD COLUMN allocation_version INTEGER NOT NULL DEFAULT 1 CHECK(allocation_version>0);

DROP TRIGGER annual_fee_allocation_guard;
CREATE TRIGGER annual_fee_allocation_guard BEFORE INSERT ON annual_fee_allocation
WHEN NOT EXISTS(SELECT 1 FROM annual_fee_payment p WHERE p.id=NEW.payment_id
    AND p.review_status='ISSUE' AND p.verified_amount_cents IS NOT NULL
    AND p.reviewed_by IS NOT NULL AND p.reviewed_at IS NOT NULL)
  OR NOT EXISTS(SELECT 1 FROM annual_fee_obligation o JOIN annual_fee_payment p ON p.round_id=o.round_id
    JOIN annual_fee_submission_person s ON s.payment_id=p.id AND s.participant_id=o.participant_id
    WHERE p.id=NEW.payment_id AND o.id=NEW.obligation_id AND s.match_status IN ('CLEAR','RESOLVED'))
  OR NEW.amount_cents+(SELECT COALESCE(SUM(a.amount_cents),0) FROM annual_fee_allocation a
    WHERE a.payment_id=NEW.payment_id)>(SELECT verified_amount_cents FROM annual_fee_payment WHERE id=NEW.payment_id)
BEGIN SELECT RAISE(ABORT,'invalid_fee_allocation'); END;
CREATE TRIGGER annual_fee_payment_allocated_review_guard
BEFORE UPDATE OF review_status,verified_amount_cents,reviewed_by,reviewed_at ON annual_fee_payment
WHEN EXISTS(SELECT 1 FROM annual_fee_allocation a WHERE a.payment_id=NEW.id) AND
  (NEW.review_status NOT IN ('ISSUE','VERIFIED') OR NEW.verified_amount_cents IS NULL OR
   NEW.reviewed_by IS NULL OR NEW.reviewed_at IS NULL)
BEGIN SELECT RAISE(ABORT,'allocated_payment_requires_review'); END;

-- A temporarily disputed review state cannot be presented as PAID by direct D1 writes.
DROP VIEW annual_fee_obligation_status;
CREATE VIEW annual_fee_obligation_status AS
SELECT o.id,o.round_id,o.participant_id,o.family_group_id,o.sibling_ordinal,o.base_cents,o.discount_cents,
  o.amount_due_cents,o.override_by,o.created_at,p.display_name,p.current_section_id,
  COALESCE((SELECT SUM(a.amount_cents) FROM annual_fee_allocation a JOIN annual_fee_payment pay ON pay.id=a.payment_id
    WHERE a.obligation_id=o.id AND pay.review_status='VERIFIED' AND pay.verified_amount_cents IS NOT NULL),0) AS allocated_cents,
  CASE
    WHEN EXISTS(SELECT 1 FROM annual_fee_issue i WHERE i.obligation_id=o.id AND i.status='OPEN') THEN 'ISSUE'
    WHEN EXISTS(SELECT 1 FROM annual_fee_allocation a JOIN annual_fee_issue i ON i.payment_id=a.payment_id
      WHERE a.obligation_id=o.id AND i.status='OPEN' AND
      (i.obligation_id IS NULL OR i.code IN ('BANK_NOT_FOUND','EVIDENCE_PROBLEM','UNIDENTIFIED_TRANSFER'))) THEN 'ISSUE'
    WHEN COALESCE((SELECT SUM(a.amount_cents) FROM annual_fee_allocation a JOIN annual_fee_payment pay ON pay.id=a.payment_id
      WHERE a.obligation_id=o.id AND pay.review_status='VERIFIED' AND pay.verified_amount_cents IS NOT NULL),0)>o.amount_due_cents THEN 'ISSUE'
    WHEN COALESCE((SELECT SUM(a.amount_cents) FROM annual_fee_allocation a JOIN annual_fee_payment pay ON pay.id=a.payment_id
      WHERE a.obligation_id=o.id AND pay.review_status='VERIFIED' AND pay.verified_amount_cents IS NOT NULL),0)=o.amount_due_cents THEN 'PAID'
    WHEN EXISTS(SELECT 1 FROM annual_fee_allocation a JOIN annual_fee_payment pay ON pay.id=a.payment_id
      WHERE a.obligation_id=o.id AND pay.review_status='VERIFIED') THEN 'PARTIAL'
    ELSE 'PENDING' END AS status
FROM annual_fee_obligation o JOIN participant p ON p.id=o.participant_id;

CREATE VIEW annual_fee_payment_balance AS
SELECT p.id,p.round_id,p.review_status,p.verified_amount_cents,
  COALESCE(SUM(a.amount_cents),0) AS allocated_cents,
  CASE WHEN p.verified_amount_cents IS NULL THEN NULL
    ELSE p.verified_amount_cents-COALESCE(SUM(a.amount_cents),0) END AS unallocated_cents
FROM annual_fee_payment p LEFT JOIN annual_fee_allocation a ON a.payment_id=p.id GROUP BY p.id;
CREATE TRIGGER annual_fee_unallocated_issue_resolution_guard BEFORE UPDATE OF status ON annual_fee_issue
WHEN OLD.code='ALLOCATION_UNCLEAR' AND OLD.obligation_id IS NULL AND NEW.status='RESOLVED' AND
  EXISTS(SELECT 1 FROM annual_fee_payment_balance b WHERE b.id=OLD.payment_id AND b.unallocated_cents>0)
BEGIN SELECT RAISE(ABORT,'unallocated_fee_balance'); END;
DROP TRIGGER annual_fee_confirm_delivery_guard;
CREATE TRIGGER annual_fee_confirm_delivery_guard BEFORE UPDATE OF status ON annual_fee_notification_outbox
WHEN NEW.kind='FEE_PAYMENT_CONFIRMED' AND NEW.status='SENT' AND
  (EXISTS(SELECT 1 FROM annual_fee_issue i WHERE i.payment_id=NEW.payment_id AND i.status='OPEN') OR
   EXISTS(SELECT 1 FROM annual_fee_allocation a JOIN annual_fee_issue i ON i.obligation_id=a.obligation_id
     WHERE a.payment_id=NEW.payment_id AND i.status='OPEN') OR
   EXISTS(SELECT 1 FROM annual_fee_payment_balance b WHERE b.id=NEW.payment_id AND b.unallocated_cents>0) OR
   NOT EXISTS(SELECT 1 FROM annual_fee_allocation a JOIN annual_fee_obligation_status o ON o.id=a.obligation_id
     WHERE a.payment_id=NEW.payment_id AND o.status='PAID'))
BEGIN SELECT RAISE(ABORT,'fee_confirmation_blocked'); END;

-- A correction gate exists only inside the service transaction, never in a completed correction.
CREATE TABLE annual_fee_family_correction_gate (
  group_id TEXT PRIMARY KEY REFERENCES annual_fee_family_group(id) ON DELETE RESTRICT,
  opened_at INTEGER NOT NULL
);
CREATE TRIGGER annual_fee_family_member_delete_guard BEFORE DELETE ON annual_fee_family_member
WHEN EXISTS(SELECT 1 FROM annual_fee_obligation o WHERE o.round_id=OLD.round_id
  AND o.participant_id=OLD.participant_id AND o.family_group_id=OLD.group_id) AND
  NOT EXISTS(SELECT 1 FROM annual_fee_family_correction_gate g WHERE g.group_id=OLD.group_id)
BEGIN SELECT RAISE(ABORT,'fee_family_member_in_use'); END;
CREATE TRIGGER annual_fee_family_member_update_guard BEFORE UPDATE ON annual_fee_family_member
WHEN (EXISTS(SELECT 1 FROM annual_fee_obligation o WHERE o.round_id=OLD.round_id AND o.participant_id=OLD.participant_id)
    AND NOT EXISTS(SELECT 1 FROM annual_fee_family_correction_gate g WHERE g.group_id=OLD.group_id))
  OR (EXISTS(SELECT 1 FROM annual_fee_obligation o WHERE o.round_id=NEW.round_id AND o.participant_id=NEW.participant_id)
    AND NOT EXISTS(SELECT 1 FROM annual_fee_family_correction_gate g WHERE g.group_id=NEW.group_id))
BEGIN SELECT RAISE(ABORT,'fee_family_member_in_use'); END;
CREATE TRIGGER annual_fee_family_member_insert_guard BEFORE INSERT ON annual_fee_family_member
WHEN EXISTS(SELECT 1 FROM annual_fee_obligation o WHERE o.round_id=NEW.round_id AND o.participant_id=NEW.participant_id)
  AND NOT EXISTS(SELECT 1 FROM annual_fee_family_correction_gate g WHERE g.group_id=NEW.group_id)
BEGIN SELECT RAISE(ABORT,'fee_family_member_in_use'); END;
DROP TRIGGER annual_fee_obligation_family_insert_guard;
DROP TRIGGER annual_fee_obligation_family_update_guard;
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
WHEN ((NEW.family_group_id IS NULL AND (NEW.sibling_ordinal!=1 OR NEW.discount_cents!=0 OR
      EXISTS(SELECT 1 FROM annual_fee_family_member m WHERE m.round_id=NEW.round_id AND m.participant_id=NEW.participant_id)))
  OR (NEW.family_group_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM annual_fee_family_member m
      WHERE m.round_id=NEW.round_id AND m.participant_id=NEW.participant_id
      AND m.group_id=NEW.family_group_id AND m.sibling_ordinal=NEW.sibling_ordinal))
  OR NEW.discount_cents!=CASE WHEN NEW.sibling_ordinal>=3 THEN CAST(NEW.base_cents/2 AS INTEGER) ELSE 0 END)
  AND NOT EXISTS(SELECT 1 FROM annual_fee_family_correction_gate g
    WHERE g.group_id=COALESCE(NEW.family_group_id,OLD.family_group_id))
BEGIN SELECT RAISE(ABORT,'invalid_fee_family_snapshot'); END;

-- Issue messages are unique per issue and relevant payment, independently of legacy payment-level notices.
CREATE TABLE annual_fee_issue_outbox (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES annual_fee_issue(id) ON DELETE RESTRICT,
  payment_id TEXT NOT NULL REFERENCES annual_fee_payment(id) ON DELETE RESTRICT,
  recipient_email TEXT NOT NULL CHECK(length(recipient_email)<=254),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SENT','FAILED')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 5),
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  last_error_code TEXT,
  UNIQUE(issue_id,payment_id)
);
CREATE INDEX annual_fee_issue_outbox_pending_idx ON annual_fee_issue_outbox(status,created_at);
CREATE TABLE annual_fee_issue_capture (
  outbox_id TEXT PRIMARY KEY REFERENCES annual_fee_issue_outbox(id) ON DELETE RESTRICT,
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  captured_at INTEGER NOT NULL
);

-- Existing valid 0007 data is retained. Reject a legacy snapshot whose allocations were never reviewed.
CREATE TABLE annual_fee_hardening_assert (invalid_count INTEGER NOT NULL CHECK(invalid_count=0));
INSERT INTO annual_fee_hardening_assert SELECT count(*) FROM annual_fee_allocation a
  JOIN annual_fee_payment p ON p.id=a.payment_id
  WHERE p.review_status!='VERIFIED' OR p.reviewed_by IS NULL OR p.reviewed_at IS NULL;
INSERT INTO annual_fee_hardening_assert SELECT count(*) FROM annual_fee_obligation o
  WHERE o.family_group_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM annual_fee_family_member m
    WHERE m.round_id=o.round_id AND m.participant_id=o.participant_id
    AND m.group_id=o.family_group_id AND m.sibling_ordinal=o.sibling_ordinal);
DROP TABLE annual_fee_hardening_assert;

-- Preserve a pre-0008 verified residual as an explicit open issue, then queue its own notice.
INSERT INTO annual_fee_issue(id,round_id,payment_id,code,created_by,created_at)
SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||
  '-8'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
  p.round_id,p.id,'ALLOCATION_UNCLEAR',p.reviewed_by,p.reviewed_at
FROM annual_fee_payment p JOIN annual_fee_payment_balance b ON b.id=p.id
WHERE p.review_status='VERIFIED' AND p.reviewed_by IS NOT NULL AND b.unallocated_cents>0
  AND NOT EXISTS(SELECT 1 FROM annual_fee_issue i WHERE i.payment_id=p.id
    AND i.obligation_id IS NULL AND i.code='ALLOCATION_UNCLEAR' AND i.status='OPEN');
INSERT INTO annual_fee_issue_outbox(id,issue_id,payment_id,recipient_email,created_at)
SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||
  '-8'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
  i.id,p.id,p.receipt_email,i.created_at
FROM annual_fee_issue i JOIN annual_fee_payment p ON p.id=i.payment_id
WHERE i.code='ALLOCATION_UNCLEAR' AND i.obligation_id IS NULL AND i.status='OPEN'
  AND NOT EXISTS(SELECT 1 FROM annual_fee_issue_outbox n WHERE n.issue_id=i.id AND n.payment_id=p.id);
