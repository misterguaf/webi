// Quotes (3.5I-Q) — pure model: human labels for the server's fee states and codes, URL filters and copy.
// The status always comes from the server projection; this model never recomputes it.
import { formatEur } from '../treasury/model.js';

export const STATUS = Object.freeze({
  PAID: { label: 'Pagada', tone: 'ok' },
  PARTIAL: { label: 'Parcial', tone: 'warning' },
  PENDING: { label: 'Pendent', tone: 'attention' },
  ISSUE: { label: 'Incidència', tone: 'danger' }
});
export const statusOf = code => STATUS[code] ?? { label: 'Estat desconegut', tone: 'muted' };
export const QUICK = Object.freeze([{ value: '', label: 'Totes' }, { value: 'PENDING', label: 'Pendents' }, { value: 'PARTIAL', label: 'Parcials' },
  { value: 'ISSUE', label: 'Incidències' }, { value: 'PAID', label: 'Pagades' }]);
export const SECTION_LABELS = Object.freeze({ MANADA: 'Manada', TROPA: 'Tropa', ESCOLTA: 'Esculta', CLAN: 'Clan' });
export const sectionLabel = code => SECTION_LABELS[code] ?? 'Sense secció';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** URL query (Catalan keys) → filters; unknown values are dropped. */
export function parseFilters(query = {}) {
  return { ronda: UUID.test(query.ronda ?? '') ? query.ronda : '', seccio: SECTION_LABELS[query.seccio] ? query.seccio : '',
    estat: STATUS[query.estat] ? query.estat : '', q: typeof query.q === 'string' ? query.q.trim().slice(0, 80) : '' };
}
export function apiQuery(filters, cursor = null) {
  const params = new URLSearchParams();
  if (filters.ronda) params.set('roundId', filters.ronda);
  if (filters.seccio) params.set('section', filters.seccio);
  if (filters.estat) params.set('status', filters.estat);
  if (filters.q) params.set('q', filters.q);
  if (cursor) params.set('cursor', cursor);
  return params.toString();
}

// Issue codes → one sentence a person understands (never the code).
const ISSUES = {
  BANK_NOT_FOUND: 'El pagament encara no apareix al banc.',
  OVERPAYMENT: 'S’ha pagat més del que corresponia.',
  EVIDENCE_PROBLEM: 'Hi ha un problema amb el justificant.',
  UNIDENTIFIED_TRANSFER: 'No s’ha pogut identificar la transferència.',
  ALLOCATION_UNCLEAR: 'No s’ha pogut determinar encara a quina quota correspon el pagament.',
  DISCREPANCY: 'L’import no quadra amb el que s’esperava.'
};
export const issueCopy = code => ISSUES[code] ?? 'Hi ha una incidència pendent de revisar.';
const REVIEW = { PENDING_REVIEW: 'pendent de revisar', VERIFIED: 'verificat', ISSUE: 'amb incidència' };
export const reviewLabel = code => REVIEW[code] ?? 'en revisió';
export const ordinalLabel = n => ({ 1: '1r fill', 2: '2n fill', 3: '3r fill', 4: '4t fill' })[n] ?? `${n}è fill`;
/** Share of the base quota charged after the sibling discount (100 %, 50 %…). */
export const chargedPercent = (baseCents, discountCents) => baseCents ? Math.round((baseCents - discountCents) * 100 / baseCents) : 100;
export const money = cents => formatEur(cents ?? 0);
/** Family overpayment: never income; explained only to financial readers. */
export function overpaymentCopy(claims = []) {
  const open = claims.filter(claim => claim.status === 'OPEN').reduce((sum, claim) => sum + claim.amountCents, 0);
  return open ? `Quota coberta. Hi ha ${money(open)} addicionals pendents de resoldre.` : null;
}
export function scopeLabel(sections) {
  if (!sections?.length) return '';
  return sections.length === 4 ? 'Tot el grup' : sections.map(sectionLabel).join(' · ');
}
export function emptyCopy(filters) {
  return filters.estat || filters.q || filters.seccio ? 'Cap educand coincideix amb els filtres.' : 'Encara no hi ha quotes en aquesta ronda.';
}
const ERRORS = { forbidden: 'No tens permís per a aquesta acció.', not_found: 'Aquesta quota no existeix o no és dins del teu abast.',
  unallocated_fee_balance: 'Primer cal assignar els diners verificats que queden sense assignar.', invalid_transition: 'Aquesta incidència ja no està oberta.',
  invalid_fee_issue: 'No s’ha pogut obrir la incidència.' };
export function errorCopy(error) {
  const code = typeof error === 'string' ? error : error?.code;
  if (code && ERRORS[code]) return ERRORS[code];
  if (error?.status === 403) return ERRORS.forbidden;
  if (error?.status === 404) return ERRORS.not_found;
  return 'No s’ha pogut completar l’acció. Torna-ho a provar.';
}
