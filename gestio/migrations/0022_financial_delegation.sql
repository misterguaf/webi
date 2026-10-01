-- FASE 3.5G.1A: security corrections before treasury. Earlier migrations are unchanged; no table is rebuilt.
--
-- 1. A section delegation never carries financial authority (TREASURY.md §25.3). SECTION_DELEGATE loses
--    finance.payment.verify and finance.fee.payment.review from its permission ceiling. Individual grants
--    of those permissions that no current role can support any more are revoked (kept as history), so they
--    can never reactivate silently if a role is assigned later. Financial capabilities reach non-treasury
--    users only through explicit, ratified, expiring delegations, which the policy now evaluates without a
--    role ceiling (src/domains/organization/repository.js).
-- 2. Submitter contact of fee payments becomes an explicit, audited capability: finance.fee.contact.read.
--    Treasury and general coordination keep the access they had (it used to arrive inside every listing).

DELETE FROM role_permission WHERE role_code='SECTION_DELEGATE'
  AND permission_code IN ('finance.payment.verify','finance.fee.payment.review');

UPDATE user_permission_grant SET revoked_at=CAST(strftime('%s','now') AS INTEGER)*1000
WHERE revoked_at IS NULL AND permission_code IN ('finance.payment.verify','finance.fee.payment.review')
  AND NOT EXISTS(SELECT 1 FROM user_role ur JOIN role_permission rp ON rp.role_code=ur.role_code
    AND rp.permission_code=user_permission_grant.permission_code
    WHERE ur.user_id=user_permission_grant.user_id AND ur.revoked_at IS NULL
      AND (ur.expires_at IS NULL OR ur.expires_at>CAST(strftime('%s','now') AS INTEGER)*1000));

INSERT OR IGNORE INTO permission(code) VALUES ('finance.fee.contact.read');
INSERT OR IGNORE INTO role_permission(role_code,permission_code) VALUES
  ('TREASURY','finance.fee.contact.read'),('GROUP_COORDINATOR','finance.fee.contact.read');

-- Current holders of fee payment review through those roles keep seeing the submitter's contact,
-- now on demand and audited.
INSERT INTO user_permission_grant(id,user_id,permission_code,valid_from,granted_by,justification)
SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||
  substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
  holders.user_id,'finance.fee.contact.read',CAST(strftime('%s','now') AS INTEGER)*1000,NULL,
  'Transició 3.5G.1A: contacte de pagaments de quota sota demanda'
FROM (SELECT DISTINCT up.user_id FROM user_permission_grant up
  JOIN user_role ur ON ur.user_id=up.user_id AND ur.role_code IN ('TREASURY','GROUP_COORDINATOR')
  WHERE up.permission_code='finance.fee.payment.review' AND up.revoked_at IS NULL
    AND (up.expires_at IS NULL OR up.expires_at>CAST(strftime('%s','now') AS INTEGER)*1000)
    AND ur.revoked_at IS NULL AND (ur.expires_at IS NULL OR ur.expires_at>CAST(strftime('%s','now') AS INTEGER)*1000)) holders
WHERE NOT EXISTS(SELECT 1 FROM user_permission_grant existing WHERE existing.user_id=holders.user_id
  AND existing.permission_code='finance.fee.contact.read' AND existing.revoked_at IS NULL);
