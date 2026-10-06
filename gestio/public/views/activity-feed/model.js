// Activitat (3.5H.3) — pure model: categories, kinds, URL filters and day grouping. The server already redacts
// every item for the viewer; this model never reconstructs or searches raw audit data.

export const CATEGORIES = Object.freeze([
  { value: '', label: 'Tots' }, { value: 'participants', label: 'Participants' }, { value: 'activities', label: 'Activitats' },
  { value: 'treasury', label: 'Tresoreria' }, { value: 'health', label: 'Salut' }, { value: 'administration', label: 'Administració' }]);
export const KINDS = Object.freeze([
  { value: '', label: 'Tots els tipus' }, { value: 'create', label: 'Creacions' }, { value: 'change', label: 'Canvis' },
  { value: 'decide', label: 'Decisions' }, { value: 'read', label: 'Consultes sensibles' }, { value: 'access', label: 'Accessos i permisos' }]);
export const categoryLabel = value => CATEGORIES.find(item => item.value === value && value)?.label ?? '';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
// A real calendar date (2026-99-99 or 2026-02-30 are dropped, never sent to the server).
const DATE = { test: value => {
  if (!DATE_SHAPE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
} };

/** URL query (Catalan keys) → filters; unknown values are dropped. */
export function parseFilters(query = {}) {
  return {
    categoria: CATEGORIES.some(item => item.value === query.categoria) ? query.categoria ?? '' : '',
    tipus: KINDS.some(item => item.value === query.tipus) ? query.tipus ?? '' : '',
    persona: UUID.test(query.persona ?? '') ? query.persona : '',
    des: DATE.test(query.des ?? '') ? query.des : '',
    fins: DATE.test(query.fins ?? '') ? query.fins : '',
    q: typeof query.q === 'string' ? query.q.trim().slice(0, 80) : ''
  };
}
export function apiQuery(filters, cursor = null) {
  const params = new URLSearchParams();
  for (const [key, name] of [['categoria', 'category'], ['tipus', 'kind'], ['persona', 'actor'], ['des', 'from'], ['fins', 'to'], ['q', 'q']])
    if (filters[key]) params.set(name, filters[key]);
  if (cursor) params.set('cursor', cursor);
  return params.toString();
}
export const hasFilters = filters => Object.values(filters).some(Boolean);

/** Link object from the server ({page, path}) → hash. Only server-provided links are ever rendered. */
export const hrefOf = link => link ? `#/${[link.page, ...(link.path ?? [])].join('/')}` : null;

const dayKey = ms => new Date(ms).toLocaleDateString('sv-SE');
export function dayLabel(ms, now = Date.now()) {
  const key = dayKey(ms);
  if (key === dayKey(now)) return 'Avui';
  if (key === dayKey(now - 86400000)) return 'Ahir';
  return new Intl.DateTimeFormat('ca-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(ms));
}
/** Consecutive items grouped by local day, preserving order. */
export function groupByDay(items, now = Date.now()) {
  const groups = [];
  for (const item of items) {
    const label = dayLabel(item.at, now);
    if (groups.at(-1)?.label !== label) groups.push({ label, items: [] });
    groups.at(-1).items.push(item);
  }
  return groups;
}
export function emptyCopy(filters) {
  if (filters.categoria === 'health') return 'Encara no hi ha activitat de Salut. El mòdul de Salut arribarà en una fase posterior.';
  return hasFilters(filters) ? 'Cap activitat coincideix amb els filtres.' : 'Encara no hi ha activitat registrada.';
}
