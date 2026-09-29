// Paginated list endpoints return `nextCursor` while more rows exist (audit M6). Screens that need
// a complete list follow the cursor; a list is never shown truncated without saying so.
export const MAX_PAGES = 50;

export async function fetchAllPages(call, path, key, { maxPages = MAX_PAGES } = {}) {
  const items = [];
  let cursor = null, pages = 0, last = {};
  do {
    const separator = path.includes('?') ? '&' : '?';
    last = await call(cursor ? `${path}${separator}cursor=${encodeURIComponent(cursor)}` : path);
    items.push(...(last[key] ?? []));
    cursor = last.nextCursor ?? null;
    pages++;
    if (cursor && pages >= maxPages) {
      const error = new Error('La llista és massa llarga per a mostrar-la sencera. Filtra-la per a continuar.');
      error.status = 0;
      throw error;
    }
  } while (cursor);
  return { ...last, [key]: items, nextCursor: null };
}
