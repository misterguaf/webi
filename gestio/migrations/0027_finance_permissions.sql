-- FASE 3.5G.1 (TREASURY.md §25): permissions of the financial foundation. Earlier migrations unchanged.
--
-- Roles are ceilings only: every permission still needs an individual grant (ADR-007), and the
-- delegable ones reach other users only through explicit financial delegations (3.5G.1A). Section
-- coordination, section delegates, Secretaria and technical administration receive none.
INSERT OR IGNORE INTO permission(code) VALUES
  ('finance.treasury.read'),('finance.round.manage'),('finance.position.manage'),
  ('finance.movement.read'),('finance.movement.import'),('finance.movement.classify'),
  ('finance.bank_description.reveal'),('finance.expense.read'),('finance.expense.manage'),
  ('finance.budget.read'),('finance.budget.propose'),('finance.budget.approve');

-- Tresoreria: broad economic access; it prepares and proposes the budget but does not approve it.
-- Coordinació general: broad economic authority and budget approval.
INSERT OR IGNORE INTO role_permission(role_code,permission_code) VALUES
  ('TREASURY','finance.treasury.read'),('TREASURY','finance.round.manage'),('TREASURY','finance.position.manage'),
  ('TREASURY','finance.movement.read'),('TREASURY','finance.movement.import'),('TREASURY','finance.movement.classify'),
  ('TREASURY','finance.bank_description.reveal'),('TREASURY','finance.expense.read'),('TREASURY','finance.expense.manage'),
  ('TREASURY','finance.budget.read'),('TREASURY','finance.budget.propose'),
  ('GROUP_COORDINATOR','finance.treasury.read'),('GROUP_COORDINATOR','finance.round.manage'),
  ('GROUP_COORDINATOR','finance.position.manage'),('GROUP_COORDINATOR','finance.movement.read'),
  ('GROUP_COORDINATOR','finance.movement.import'),('GROUP_COORDINATOR','finance.movement.classify'),
  ('GROUP_COORDINATOR','finance.bank_description.reveal'),('GROUP_COORDINATOR','finance.expense.read'),
  ('GROUP_COORDINATOR','finance.expense.manage'),('GROUP_COORDINATOR','finance.budget.read'),
  ('GROUP_COORDINATOR','finance.budget.propose'),('GROUP_COORDINATOR','finance.budget.approve');

-- Current holders of those roles receive the grants of their ordinary work. Revealing an original bank
-- description stays an explicit individual grant (purpose-limited; LEGAL DECISION REQUIRED), and import
-- for general coordination as well (TREASURY.md §25.2).
INSERT INTO user_permission_grant(id,user_id,permission_code,valid_from,granted_by,justification)
SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||
  substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
  holders.user_id,holders.permission_code,CAST(strftime('%s','now') AS INTEGER)*1000,NULL,
  'Transició 3.5G.1: fundació financera'
FROM (SELECT DISTINCT ur.user_id,rp.permission_code FROM user_role ur
  JOIN role_permission rp ON rp.role_code=ur.role_code
  WHERE ur.role_code IN ('TREASURY','GROUP_COORDINATOR') AND ur.section_id IS NULL AND ur.revoked_at IS NULL
    AND (ur.expires_at IS NULL OR ur.expires_at>CAST(strftime('%s','now') AS INTEGER)*1000)
    AND rp.permission_code IN ('finance.treasury.read','finance.round.manage','finance.position.manage','finance.movement.read',
      'finance.movement.import','finance.movement.classify','finance.expense.read','finance.expense.manage','finance.budget.read',
      'finance.budget.propose','finance.budget.approve')
    AND NOT (ur.role_code='GROUP_COORDINATOR' AND rp.permission_code='finance.movement.import')) holders
WHERE NOT EXISTS(SELECT 1 FROM user_permission_grant existing WHERE existing.user_id=holders.user_id
  AND existing.permission_code=holders.permission_code AND existing.revoked_at IS NULL);
