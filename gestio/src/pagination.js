// Keyset pagination for list endpoints (audit M6). A list never truncates silently: when more rows
// exist the response carries `nextCursor`, and callers fetch the next page with `?cursor=`.
// Cursors are opaque base64url JSON arrays of the last row's sort key; they are validated strictly.
import { AppError } from './services/common.js';

export const DEFAULT_PAGE_SIZE = 100;
export const MAX_PAGE_SIZE = 200;

const encode = values => btoa(JSON.stringify(values)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

/**
 * @param {URLSearchParams|null|undefined} params
 * @param {Array<'string'|'number'>} shape types of the sort key columns, in order
 * @returns {{limit: number, after: Array<string|number>|null}}
 */
export function pageRequest(params, shape, { defaultLimit = DEFAULT_PAGE_SIZE } = {}) {
  const rawLimit = params?.get('limit');
  const limit = rawLimit == null ? defaultLimit : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) throw new AppError(400, 'invalid_page');
  const cursor = params?.get('cursor');
  if (cursor == null) return { limit, after: null };
  if (typeof cursor !== 'string' || cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new AppError(400, 'invalid_page');
  let after;
  try { after = JSON.parse(atob(cursor.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - cursor.length % 4) % 4))); }
  catch { throw new AppError(400, 'invalid_page'); }
  if (!Array.isArray(after) || after.length !== shape.length ||
      after.some((value, index) => shape[index] === 'number' ? !Number.isSafeInteger(value) : typeof value !== 'string' || value.length > 200))
    throw new AppError(400, 'invalid_page');
  return { limit, after };
}

/**
 * SQL fragment "row is after the cursor" for a lexicographic key with a common direction.
 * @param {string[]} columns
 * @param {'ASC'|'DESC'} direction
 */
export function afterClause(columns, direction) {
  const op = direction === 'ASC' ? '>' : '<';
  const parts = columns.map((column, index) =>
    '(' + [...columns.slice(0, index).map(prev => `${prev}=?`), `${column}${op}?`].join(' AND ') + ')');
  const values = after => columns.flatMap((_, index) => [...after.slice(0, index), after[index]]);
  return { sql: `(${parts.join(' OR ')})`, values };
}

/**
 * Query limit+1 rows, return one page and the cursor for the next one.
 * @template T
 * @param {T[]} rows
 * @param {number} limit
 * @param {(row: T) => Array<string|number>} keyOf
 */
export function pageResult(rows, limit, keyOf) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? encode(keyOf(last)) : null };
}
