// The only ordinary writer/reader of audit_event. Retention deletion is exposed separately
// to the lifecycle service, never through HTTP or a generic admin repository.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ACTIONS = new Set([
  'AUTH_LOGIN_SUCCESS','AUTH_LOGIN_FAILED','AUTH_SESSION_CREATED','AUTH_LOGOUT',
  'AUTH_SESSION_REVOKED','AUTH_ALL_SESSIONS_REVOKED','USER_CREATED','USER_DISABLED',
  'USER_ENABLED','USER_SECURITY_SUSPENDED','ROLE_ASSIGNED','ROLE_REMOVED',
  'PERMISSION_GRANTED','PERMISSION_REVOKED','AUTHZ_ALLOW','AUTHZ_DENY',
  'SENSITIVE_DATA_READ','HEALTH_ACCESS_GRANTED','HEALTH_ACCESS_REVOKED',
  'DATA_CREATED','DATA_UPDATED','DATA_DELETED','BREAK_GLASS_GRANTED',
  'BREAK_GLASS_USED','BREAK_GLASS_REVOKED','EXPORT_REQUESTED','EXPORT_DENIED',
  'AUDIT_LOG_READ','INCIDENT_OPENED','INCIDENT_HOLD_ADDED','INCIDENT_HOLD_RELEASED',
  'RETENTION_APPLIED','ACTIVITY_CREATED','ACTIVITY_UPDATED','ACTIVITY_PUBLISHED','ACTIVITY_CLOSED','ACTIVITY_DISCARDED',
  'REGISTRATION_RECEIVED','REGISTRATION_MATCHED','REGISTRATION_MATCH_REVIEW_REQUIRED','REGISTRATION_MATCH_RESOLVED',
  'REGISTRATION_CONFIRMED','REGISTRATION_REJECTED','PAYMENT_EVIDENCE_RECEIVED','PAYMENT_VERIFIED','PAYMENT_ISSUE',
  'REGISTRATION_SECTION_CORRECTED','REGISTRATION_ESCALATED','REGISTRATION_WITHDRAWN',
  'PAYMENT_EVIDENCE_VIEWED','PAYMENT_EVIDENCE_DOWNLOADED','PAYMENT_EVIDENCE_PURGED',
  'DELEGATED_PERMISSION_GRANTED','DELEGATED_PERMISSION_RATIFIED','DELEGATED_PERMISSION_REVOKED',
  'NOTIFICATION_QUEUED','NOTIFICATION_SENT','NOTIFICATION_FAILED',
  'FEE_ROUND_CREATED','FEE_ROUND_UPDATED','FEE_BASE_CHANGED','FEE_DEADLINE_CHANGED',
  'FEE_FAMILY_GROUP_CREATED','FEE_FAMILY_CORRECTED','FEE_DISCOUNT_APPLIED','FEE_DISCOUNT_RECALCULATED',
  'FEE_OBLIGATION_CREATED','FEE_AMOUNT_OVERRIDDEN','FEE_SUBMISSION_RECEIVED','FEE_MATCH_REVIEWED',
  'FEE_EVIDENCE_RECEIVED','FEE_PAYMENT_VERIFIED','FEE_ALLOCATION_CREATED','FEE_ALLOCATION_REVISED','FEE_ISSUE_OPENED',
  'FEE_ISSUE_RESOLVED','FEE_INSTALLMENT_AUTHORIZED','FEE_EVIDENCE_VIEWED','FEE_EVIDENCE_DOWNLOADED',
  'IDENTITY_INVITED','IDENTITY_INVITATION_REVOKED','IDENTITY_LINKED','IDENTITY_REVOKED',
  'DELEGATION_AUTHORIZATION_CONFIRMED',
  'TREASURY_ROUND_CREATED','TREASURY_ROUND_UPDATED','TREASURY_ROUND_OPENED','TREASURY_ROUND_CLOSING_STARTED','TREASURY_ROUND_CLOSING_CANCELLED',
  'FINANCIAL_POSITION_CREATED','FINANCIAL_POSITION_UPDATED','OPENING_BALANCE_RECORDED','RESERVES_RECORDED',
  'BANK_IMPORT_CREATED','MOVEMENT_IMPORTED','MOVEMENT_CREATED_MANUAL','MOVEMENT_VOIDED_DUPLICATE','MOVEMENT_NEAR_MATCH_CLEARED',
  'MOVEMENT_CLASSIFIED','MOVEMENT_RECLASSIFIED','BANK_DESCRIPTION_REVEALED',
  'COUNTERPARTY_CREATED','COUNTERPARTY_REVISED','COUNTERPARTY_USER_LINKED','COUNTERPARTY_USER_UNLINKED',
  'EXPENSE_PROPOSED','EXPENSE_RECOGNISED','EXPENSE_REVISED','EXPENSE_REJECTED','EXPENSE_VOIDED',
  'BUDGET_CREATED','BUDGET_PROPOSED','BUDGET_RETURNED_TO_DRAFT','BUDGET_APPROVED','BUDGET_LINE_CREATED','BUDGET_LINE_REVISED',
  'BUDGET_LINE_DEACTIVATED','BUDGET_REVISION_PROPOSED','BUDGET_REVISION_APPROVED','BUDGET_REVISION_REJECTED'
]);
const RESOURCE_TYPES = new Set(['app_user','app_session','participant','user_role','user_permission_grant','health_access_grant','audit_event','security_incident',
  'activity','activity_registration','payment_evidence','delegated_permission','notification_outbox',
  'annual_fee_round','annual_fee_family_group','annual_fee_obligation','annual_fee_payment',
  'annual_fee_submission_person','annual_fee_allocation','annual_fee_issue','annual_fee_installment_plan',
  'annual_fee_evidence','annual_fee_notification_outbox','annual_fee_issue_outbox',
  'auth_identity','auth_identity_invitation',
  'guardian','participant_guardian','contact_point','participant_review','activity_payment_allocation',
  'finance_round','finance_position','finance_opening_balance','finance_reserve_opening','finance_import_batch','finance_movement',
  'finance_counterparty','finance_expense','finance_budget','finance_budget_line','finance_budget_revision']);
const RESULTS = new Set(['SUCCESS','ALLOW','DENY','ERROR']);
const SOURCES = new Set(['local-fixture','retention-job']);
const safeId = value => value === null || (typeof value === 'string' && UUID.test(value));

function safeMetadata(value) {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AUDIT_METADATA_REJECTED');
  const keys=Object.keys(value);
  if (keys.some(key => !['count','source'].includes(key))) throw new Error('AUDIT_METADATA_REJECTED');
  if ('count' in value && (!Number.isInteger(value.count) || value.count < 0 || value.count > 1000)) throw new Error('AUDIT_METADATA_REJECTED');
  if ('source' in value && !SOURCES.has(value.source)) throw new Error('AUDIT_METADATA_REJECTED');
  return JSON.stringify(value);
}

function validated(detail) {
  const { requestId, actorUserId=null, sessionId=null, action, resourceType=null, resourceId=null,
    result='SUCCESS', reasonCode=null, metadata=null, securityRelevant=true, occurredAt=Date.now() }=detail;
  if (!UUID.test(requestId || '') || !safeId(actorUserId) || !safeId(sessionId) || !safeId(resourceId) ||
      !ACTIONS.has(action) || (resourceType !== null && !RESOURCE_TYPES.has(resourceType)) ||
      !RESULTS.has(result) || (reasonCode !== null && !/^[A-Z0-9_]{1,64}$/.test(reasonCode)) ||
      !Number.isSafeInteger(occurredAt) || typeof securityRelevant !== 'boolean') throw new Error('AUDIT_EVENT_REJECTED');
  return [crypto.randomUUID(),occurredAt,Date.now(),requestId,actorUserId,sessionId,action,resourceType,resourceId,result,reasonCode,
    safeMetadata(metadata),securityRelevant?1:0];
}
const COLUMNS='(id,occurred_at,created_at,request_id,actor_user_id,session_id,action,resource_type,resource_id,result,reason_code,metadata_json,security_relevant)';
export function statement(db, detail) {
  return db.prepare(`INSERT INTO audit_event ${COLUMNS} VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(...validated(detail));
}
export async function append(db, detail) { return statement(db,detail).run(); }
// Same validation as statement(), but the row is written only if `existsSql` matches, so a batch can
// audit an effect that a compare-and-set statement earlier in the same batch may not have produced.
export function conditionalStatement(db, detail, existsSql, existsParams=[]) {
  return db.prepare(`INSERT INTO audit_event ${COLUMNS} SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(${existsSql})`)
    .bind(...validated(detail),...existsParams);
}

/** @type {Record<string, [string, (value: string) => boolean]>} */
const FILTERS = {
  actorId: ['actor_user_id', value => UUID.test(value)],
  action: ['action', value => ACTIONS.has(value)],
  resourceType: ['resource_type', value => RESOURCE_TYPES.has(value)],
  resourceId: ['resource_id', value => UUID.test(value)],
  result: ['result', value => RESULTS.has(value)],
  requestId: ['request_id', value => UUID.test(value)]
};
const encode = value => btoa(JSON.stringify(value)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
function decode(value) {
  if (typeof value !== 'string' || value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('INVALID_AUDIT_CURSOR');
  let parsed;
  try { parsed=JSON.parse(atob(value.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-value.length%4)%4))); }
  catch { throw new Error('INVALID_AUDIT_CURSOR'); }
  if (!Array.isArray(parsed) || parsed.length!==2 || !Number.isSafeInteger(parsed[0]) || !UUID.test(parsed[1])) throw new Error('INVALID_AUDIT_CURSOR');
  return parsed;
}
export async function queryAuthorized(db, input={}) {
  const limit=input.limit == null ? 20 : Number(input.limit);
  if (!Number.isInteger(limit) || limit<1 || limit>50) throw new Error('INVALID_AUDIT_FILTER');
  const clauses=[], values=[];
  for (const [name,[column,valid]] of Object.entries(FILTERS)) {
    if (input[name] == null) continue;
    if (typeof input[name] !== 'string' || !valid(input[name])) throw new Error('INVALID_AUDIT_FILTER');
    clauses.push(`${column}=?`); values.push(input[name]);
  }
  for (const [name,operator] of [['from','>='],['to','<=']]) {
    if (input[name] == null) continue;
    const value=Number(input[name]);
    if (!Number.isSafeInteger(value) || value<0) throw new Error('INVALID_AUDIT_FILTER');
    clauses.push(`occurred_at${operator}?`); values.push(value);
  }
  if (input.cursor != null) {
    const [time,id]=decode(input.cursor);
    clauses.push('(occurred_at<? OR (occurred_at=? AND id<?))'); values.push(time,time,id);
  }
  const where=clauses.length?` WHERE ${clauses.join(' AND ')}`:'';
  const rows=(await db.prepare(`SELECT id,occurred_at,request_id,actor_user_id,session_id,action,resource_type,resource_id,result,reason_code,metadata_json,security_relevant
    FROM audit_event${where} ORDER BY occurred_at DESC,id DESC LIMIT ?`).bind(...values,limit+1).all()).results;
  const page=rows.slice(0,limit);
  const last=page.at(-1);
  return { events:page, nextCursor:rows.length>limit && last?encode([last.occurred_at,last.id]):null };
}

export function retentionDeleteStatement(db, cutoff) {
  if (!Number.isSafeInteger(cutoff) || cutoff<0) throw new Error('INVALID_RETENTION_CUTOFF');
  return db.prepare(`DELETE FROM audit_event WHERE occurred_at<? AND NOT EXISTS
    (SELECT 1 FROM incident_audit_hold h WHERE h.audit_event_id=audit_event.id AND h.released_at IS NULL)`)
    .bind(cutoff);
}
