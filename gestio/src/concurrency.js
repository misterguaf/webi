// Optimistic concurrency inside D1 batches (audit L4 — documented, behaviour unchanged).
//
// D1 has no interactive transactions: a service reads a row, validates in JS, then sends one atomic
// `db.batch([...])`. To detect that another request changed the row in between, the first statement
// of the batch performs a compare-and-set that writes NULL into a NOT NULL column when the expected
// value no longer matches:
//
//   UPDATE t SET version = CASE WHEN version = :expected THEN version + 1 ELSE NULL END WHERE id = :id
//
// The NOT NULL constraint then aborts the WHOLE batch (nothing is written, audit included), and the
// service re-reads the row in its catch block to translate the failure into a 409 "stale_*" error.
// The same technique guards some state columns (e.g. annual_fee_issue.status, obligation updated_at).
// Never use it on a nullable column: the guard would silently succeed.

/** SQL fragment for a version compare-and-set; bind the expected version where the `?` is. */
export function versionCas(column) {
  if (!/^[a-z_]+$/.test(column)) throw new Error('INVALID_COLUMN');
  return `${column}=CASE WHEN ${column}=? THEN ${column}+1 ELSE NULL END`;
}
