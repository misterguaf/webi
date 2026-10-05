// Noves altes (3.5H.2) — pure model: labels, filters, actions by state and capability, error copy.
// Advisory only: the server authorises every transition and rejects impossible ones.

export const STATUS = {
  PENDING: { label: 'Pendent', tone: 'attention' },
  IN_REVIEW: { label: 'En revisió', tone: 'warning' },
  WAITLISTED: { label: 'Llista d’espera', tone: 'waitlist' },
  ACCEPTED: { label: 'Acceptada', tone: 'ok' },
  REJECTED: { label: 'Rebutjada', tone: 'muted' },
  WITHDRAWN: { label: 'Retirada per la família', tone: 'muted' }
};
export const statusOf = code => STATUS[code] ?? { label: 'Estat desconegut', tone: 'muted' };
export const FILTERS = [
  { value: '', label: 'Obertes' }, { value: 'PENDING', label: 'Pendents' }, { value: 'IN_REVIEW', label: 'En revisió' },
  { value: 'WAITLISTED', label: 'Llista d’espera' }, { value: 'ACCEPTED', label: 'Acceptades' }, { value: 'REJECTED', label: 'Rebutjades' },
  { value: 'WITHDRAWN', label: 'Retirades' }];
export const SECTIONS = [{ value: 'MANADA', label: 'Manada' }, { value: 'TROPA', label: 'Tropa' }, { value: 'ESCOLTA', label: 'Esculta' }, { value: 'CLAN', label: 'Clan' }];
export const sectionLabel = code => SECTIONS.find(item => item.value === code)?.label ?? 'Sense secció';
export const REJECTIONS = [{ value: 'NO_PLACES', label: 'No hi ha places' }, { value: 'AGE_OR_SECTION', label: 'Edat o secció' },
  { value: 'DUPLICATE', label: 'Sol·licitud duplicada' }, { value: 'OTHER', label: 'Altres motius' }];
export const EVENTS = { RECEIVED: 'Rebuda pel formulari', REVIEW_STARTED: 'Revisió començada', WAITLISTED: 'A la llista d’espera',
  RETURNED_TO_REVIEW: 'Tornada a revisió', SECTION_CONFIRMED: 'Secció confirmada', MATCH_RESOLVED: 'Coincidència resolta',
  ACCEPTED: 'Acceptada', REJECTED: 'Rebutjada', WITHDRAWN: 'Retirada per la família' };

/** URL query → API query (unknown values dropped). */
export function parseFilters(query = {}) {
  return { estat: FILTERS.some(item => item.value === query.estat) ? query.estat ?? '' : '',
    seccio: SECTIONS.some(item => item.value === query.seccio) ? query.seccio : '',
    q: typeof query.q === 'string' ? query.q.trim().slice(0, 80) : '' };
}
export function apiQuery(filters) {
  const params = new URLSearchParams();
  if (filters.estat) params.set('status', filters.estat);
  if (filters.seccio) params.set('section', filters.seccio);
  if (filters.q) params.set('q', filters.q);
  return params.toString();
}

/** Actions offered for a request (the server re-checks everything). */
export function actionsFor(admission, { manage, decide }) {
  const open = ['IN_REVIEW', 'WAITLISTED'].includes(admission.status);
  const live = ['PENDING', 'IN_REVIEW', 'WAITLISTED'].includes(admission.status);
  return [
    manage && admission.status === 'PENDING' ? 'start-review' : null,
    manage && ['PENDING', 'IN_REVIEW'].includes(admission.status) ? 'waitlist' : null,
    manage && admission.status === 'WAITLISTED' ? 'return-to-review' : null,
    manage && live ? 'section' : null,
    decide && open ? 'accept' : null,
    decide && live ? 'reject' : null,
    manage && live ? 'withdraw' : null
  ].filter(Boolean);
}
export const ACTION_LABELS = { 'start-review': 'Comença la revisió', waitlist: 'Passa a llista d’espera', 'return-to-review': 'Torna a revisió',
  section: 'Confirma la secció', accept: 'Accepta l’alta', reject: 'Rebutja', withdraw: 'Marca com a retirada' };

export function ageOn(birthDate, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate ?? '')) return null;
  const b = new Date(`${birthDate}T00:00:00Z`), n = new Date(now);
  let age = n.getUTCFullYear() - b.getUTCFullYear();
  if (n.getUTCMonth() < b.getUTCMonth() || (n.getUTCMonth() === b.getUTCMonth() && n.getUTCDate() < b.getUTCDate())) age--;
  return age;
}

const ERRORS = {
  forbidden: 'No tens permís per fer aquesta acció.',
  not_found: 'Aquesta sol·licitud no existeix o no és de la teua secció.',
  invalid_transition: 'Aquest canvi ja no és possible en l’estat actual.',
  stale_admission: 'La sol·licitud ha canviat mentrestant. S’ha actualitzat.',
  section_not_confirmed: 'Confirma primer la secció: la que tria la família és només orientativa.',
  section_out_of_scope: 'Aquesta secció no és dins del teu abast.',
  admission_match_ambiguous: 'Hi ha més d’una persona semblant a Participants. Secretaria ha de revisar-ho abans d’acceptar.',
  admission_link_confirmation_required: 'Aquesta persona ja existeix a Participants: confirma que és ella per a vincular-la.',
  admission_match_requires_secretary: 'Aquesta persona ja és activa en una altra secció. Ho ha de revisar Secretaria.',
  invalid_rejection: 'Tria un motiu de la llista.',
  invalid_resolution: 'Revisa la resolució de la coincidència.',
  nothing_to_resolve: 'Ja no hi ha cap coincidència per resoldre.'
};
export function errorCopy(error) {
  const code = typeof error === 'string' ? error : error?.code;
  if (code && ERRORS[code]) return ERRORS[code];
  if (error?.status === 403) return ERRORS.forbidden;
  if (error?.status === 404) return ERRORS.not_found;
  return 'No s’ha pogut completar l’acció. Torna-ho a provar.';
}
