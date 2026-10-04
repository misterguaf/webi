// Private expense receipts. R2 bytes and D1 metadata cannot commit atomically: put first, then
// compensate with an R2 delete if the D1 batch fails. Authorization remains resource-specific.
import { append } from '../audit/repository.js';
import { validateSyntheticEvidence, evidenceKey, storeEvidence, readEvidence } from '../../services/evidence-service.js';
import { AppError, requireUuid, validUuid } from '../../services/common.js';
import { allow, audit, commit, fail, notFound, uuid } from './shared.js';

const EXTENSIONS = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export async function prepareExpenseEvidence(input) {
  const validated = await validateSyntheticEvidence(input);
  return { ...validated, objectKey: evidenceKey(), id: uuid() };
}

export function evidenceStatements(db, context, requestId, expenseId, item, now) {
  return [
    db.prepare(`INSERT INTO finance_expense_evidence(id,expense_id,object_key,sha256,size_bytes,detected_mime,uploaded_by,created_at)
      VALUES(?,?,?,?,?,?,?,?)`).bind(item.id, expenseId, item.objectKey, item.sha256, item.bytes.length, item.mime, context.userId, now),
    audit(db, context, requestId, 'EXPENSE_EVIDENCE_UPLOADED', 'finance_expense_evidence', item.id, now)
  ];
}

export async function commitWithEvidence(db, storage, item, statements, staleCode) {
  await storeEvidence(storage, item.objectKey, item);
  try { await commit(db, statements, staleCode); }
  catch (error) {
    try { await storage.delete(item.objectKey); }
    catch { throw new AppError(503, 'evidence_cleanup_failed'); }
    throw error;
  }
}

export async function uploadExpenseEvidence(db, storage, context, requestId, expenseId, input, now = Date.now()) {
  await allow(db, context, requestId, 'finance.expense.manage', 'finance_expense', validUuid(expenseId) ? expenseId : null);
  const id = requireUuid(expenseId);
  const expense = await db.prepare('SELECT status FROM finance_expense WHERE id=?').bind(id).first();
  if (!expense) throw notFound();
  if (!['PROPOSED', 'RECOGNISED'].includes(expense.status)) throw new AppError(409, 'invalid_transition');
  const item = await prepareExpenseEvidence(input);
  await commitWithEvidence(db, storage, item, evidenceStatements(db, context, requestId, id, item, now));
  return { id: item.id, mime: item.mime, sizeBytes: item.bytes.length };
}

export async function expenseEvidenceRead(db, storage, context, requestId, evidenceId, mode = 'download') {
  if (!['view', 'download'].includes(mode)) fail('invalid_filter');
  await allow(db, context, requestId, 'finance.expense.read', 'finance_expense_evidence', validUuid(evidenceId) ? evidenceId : null);
  const row = await db.prepare(`SELECT d.id,d.object_key,d.detected_mime,d.created_at,d.object_purged_at
    FROM finance_expense_evidence d WHERE d.id=?`).bind(requireUuid(evidenceId)).first();
  if (!row) throw notFound();
  if (row.object_purged_at != null) throw new AppError(410, 'evidence_purged');
  const extension = EXTENSIONS[row.detected_mime];
  if (!extension) throw new AppError(500, 'invalid_evidence');
  const response = await readEvidence(storage, row.object_key, { mime: row.detected_mime, mode,
    filename: `justificant-despesa-${new Date(row.created_at).toISOString().slice(0, 10)}.${extension}` });
  await append(db, { requestId, actorUserId: context.userId, sessionId: context.sessionId,
    action: mode === 'view' ? 'EXPENSE_EVIDENCE_VIEWED' : 'EXPENSE_EVIDENCE_DOWNLOADED',
    resourceType: 'finance_expense_evidence', resourceId: row.id, result: 'SUCCESS' });
  return response;
}

export async function verifiedEvidenceExists(db, storage, expenseId) {
  const rows = (await db.prepare(`SELECT object_key FROM finance_expense_evidence
    WHERE expense_id=? AND object_purged_at IS NULL ORDER BY created_at DESC`).bind(expenseId).all()).results;
  if (!rows.length) return false;
  if (!storage?.head && !storage?.get) throw new AppError(503, 'evidence_storage_unavailable');
  for (const row of rows) if (await (storage.head ? storage.head(row.object_key) : storage.get(row.object_key))) return true;
  return false;
}
