// FASE 3.5G.1 — shared helpers of the financial foundation (TREASURY.md). Every operation authorises
// server-side with a GLOBAL finance permission before touching data, audits with identifiers and codes
// only, and lets the database enforce the money invariants; trigger aborts become 409 with their code.
import { statement } from '../audit/repository.js';
import { AppError, requirePermission, validUuid } from '../../services/common.js';
import { synthetic } from '../../environment-policy.js';

export const uuid = () => crypto.randomUUID();
export const fail = code => { throw new AppError(400, code); };
export const keysOnly = (input, allowed) => input && typeof input === 'object' && !Array.isArray(input) &&
  Object.keys(input).every(key => allowed.includes(key));
export const isDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
export const cents = (value, { min = 1, max = 100000000 } = {}) => Number.isSafeInteger(value) && value >= min && value <= max;
export const signedCents = value => Number.isSafeInteger(value) && value !== 0 && Math.abs(value) <= 100000000;
export const version = value => Number.isSafeInteger(value) && value >= 0;
export const optionalId = value => value === undefined || value === null || validUuid(value);
// While DATA_MODE is SYNTHETIC_ONLY, names of people and organisations must be visibly fictitious.
export const syntheticName = value => typeof value === 'string' && value.trim().length >= 2 && value.length <= 120 &&
  synthetic.personName(value);

/** Authorise a GLOBAL finance permission; denials are audited as AUTHZ_DENY (403). */
export function allow(db, context, requestId, permission, resourceType, resourceId = null) {
  return requirePermission(db, context, requestId, permission, { resourceType, resourceId });
}
export function audit(db, context, requestId, action, resourceType, resourceId, now, extra = {}) {
  return statement(db, { requestId, actorUserId: context?.userId ?? null, sessionId: context?.sessionId ?? null,
    action, resourceType, resourceId, occurredAt: now, ...extra });
}
export function notFound() { return new AppError(404, 'not_found'); }

// Trigger and constraint messages that are domain conflicts (409), with the public code they map to.
const CONFLICTS = [
  ['finance_round_overlap', 'finance_round_overlap'], ['UNIQUE constraint failed: finance_round.code', 'duplicate_round'],
  ['finance_round_one_open', 'open_round_exists'], ['finance_round_one_closing', 'closing_round_exists'],
  ['UNIQUE constraint failed: finance_round.status', 'round_state_conflict'],
  ['UNIQUE constraint failed: finance_round.annual_fee_round_id', 'fee_round_already_linked'],
  ['invalid_finance_round_transition', 'invalid_transition'], ['finance_round_locked', 'finance_round_locked'],
  ['finance_round_closed', 'finance_round_closed'],
  ['invalid_opening_balance', 'stale_opening_balance'], ['UNIQUE constraint failed: finance_opening_balance', 'stale_opening_balance'],
  ['invalid_reserve_opening', 'stale_reserves'], ['UNIQUE constraint failed: finance_reserve_opening', 'stale_reserves'],
  ['UNIQUE constraint failed: finance_import_batch.file_sha256', 'duplicate_import'],
  ['UNIQUE constraint failed: finance_movement.fingerprint', 'import_conflict'],
  ['invalid_duplicate_void', 'invalid_duplicate_void'], ['movement_immutable', 'movement_immutable'],
  ['stale_allocation_set', 'stale_movement'], ['allocation_exceeds_movement', 'allocation_exceeds_movement'],
  ['allocation_kind_not_enabled', 'allocation_kind_not_enabled'], ['invalid_allocation_direction', 'invalid_allocation_direction'],
  ['invalid_income_allocation', 'invalid_income_allocation'], ['invalid_income', 'invalid_income'], ['income_immutable', 'income_immutable'], ['invalid_expense_allocation', 'invalid_expense_allocation'],
  ['invalid_internal_transfer', 'invalid_internal_transfer'],
  ['UNIQUE constraint failed: finance_counterparty.user_id', 'counterparty_user_linked'], ['counterparty_in_use', 'counterparty_in_use'],
  ['invalid_expense_line', 'invalid_expense_line'], ['invalid_expense', 'invalid_expense'],
  ['expense_evidence_required', 'expense_evidence_required'],
  ['NOT NULL constraint failed: finance_expense_evidence.expense_id', 'evidence_already_replaced'],
  ['expense_evidence_immutable', 'evidence_already_replaced'],
  ['expense_correction_reason_required', 'expense_correction_reason_required'],
  ['invalid_self_approval_exception', 'invalid_self_approval_exception'],
  ['reimbursement_expense_locked', 'reimbursement_expense_locked'],
  ['reimbursement_settlement_locked', 'reimbursement_settlement_locked'],
  ['allocation_correction_immutable', 'allocation_correction_immutable'],
  ['invalid_reimbursement_settlement', 'invalid_reimbursement_settlement'],
  ['invalid_reimbursement', 'invalid_reimbursement'],
  ['self_approval', 'self_approval'],
  ['UNIQUE constraint failed: finance_budget.round_id', 'budget_exists'], ['invalid_budget_transition', 'invalid_transition'],
  ['invalid_budget_line', 'invalid_budget_line'], ['budget_line_in_use', 'budget_line_in_use'],
  ['finance_budget_line.code', 'duplicate_budget_code'],
  ['invalid_budget_revision', 'invalid_budget_revision']
];
/** Translate a failed batch: a stale compare-and-set (NOT NULL on a version column) or a domain trigger. */
export function conflict(error, staleCode) {
  const message = String(error?.message ?? '');
  if (/NOT NULL constraint failed: finance_[a-z_]+\.(version|allocation_version|review_version)/.test(message))
    return new AppError(409, staleCode);
  const hit = CONFLICTS.find(([needle]) => message.includes(needle));
  return hit ? new AppError(409, hit[1]) : error;
}
/** Run an atomic batch and translate domain failures. */
export async function commit(db, statements, staleCode = 'stale_resource') {
  try { return await db.batch(statements); } catch (error) { throw conflict(error, staleCode); }
}
