// Activitats (3.5D) — pure model: no DOM, no fetch. Everything the list, detail and editor derive from
// the server's rows lives here so it can be tested in Node (test/gestio-activities-ui.test.js).
// The UI shows only what the server returned: counts come from the server read model, capabilities
// are advisory, and every rule mirrored here is still enforced server-side.

export const DAY = 86400000;
export const SECTION_LABELS = Object.freeze({ MANADA: 'Manada', TROPA: 'Tropa', ESCOLTA: 'Escolta', CLAN: 'Clan' });
export const SECTION_ORDER = Object.freeze(['MANADA', 'TROPA', 'ESCOLTA', 'CLAN']);
export const GENERAL_FILTER = 'tot-el-grup';
export const MAX_CENTS = 1000000;

// ---------------------------------------------------------------- text and formatting

export const normalize = value => String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('ca-ES').trim();
const listJoin = items => items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} i ${items.at(-1)}`;

export function formatMoney(cents) {
  return new Intl.NumberFormat('ca-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 }).format((cents || 0) / 100);
}
export const priceLabel = cents => cents > 0 ? formatMoney(cents) : 'Gratuïta';
export function signedMoney(cents) {
  return `${cents < 0 ? '−' : '+'}${formatMoney(Math.abs(cents))}`;
}
/** Euros typed by a person ("15", "15,5", "15.50", "-3") → cents, or null when not a valid amount. */
export function parseEuros(value, { allowNegative = false } = {}) {
  const text = String(value ?? '').trim().replace(/\s|€/g, '').replace(',', '.');
  if (!/^-?\d{1,5}(\.\d{1,2})?$/.test(text)) return null;
  const cents = Math.round(Number(text) * 100);
  if (!allowNegative && cents < 0) return null;
  return Object.is(cents, -0) ? 0 : cents;
}
export const centsToInput = cents => (cents / 100).toFixed(2).replace('.', ',').replace(/,00$/, '');

const fmt = (options, value) => new Intl.DateTimeFormat('ca-ES', options).format(new Date(value));
export const dayNumber = value => fmt({ day: 'numeric' }, value);
export const shortMonth = value => fmt({ month: 'short' }, value).replace('.', '').toLocaleUpperCase('ca-ES');
export const shortDate = value => fmt({ day: 'numeric', month: 'short' }, value);
export const longDate = value => fmt({ weekday: 'long', day: 'numeric', month: 'long' }, value);
export const time = value => fmt({ hour: '2-digit', minute: '2-digit' }, value);
export const dateTime = value => `${longDate(value)}, ${time(value)}`;
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
/** "25 d’oct." or "25–26 d’oct." or "30 d’oct. – 2 de nov." (end is exclusive-ish: same day collapses). */
export function dateRange(start, end) {
  if (sameDay(start, end)) return shortDate(start);
  const a = new Date(start), b = new Date(end);
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) return `${a.getDate()}–${shortDate(end)}`;
  return `${shortDate(start)} – ${shortDate(end)}`;
}
export function longRange(start, end) {
  if (sameDay(start, end)) return `${longDate(start)} · ${time(start)}–${time(end)}`;
  return `${longDate(start)} – ${longDate(end)}`;
}

// ---------------------------------------------------------------- scope

export function sectionCodes(activity) {
  if (Array.isArray(activity?.sectionCodes)) return activity.sectionCodes;
  return String(activity?.sections || '').split(',').map(code => code.trim()).filter(code => SECTION_LABELS[code])
    .sort((a, b) => SECTION_ORDER.indexOf(a) - SECTION_ORDER.indexOf(b));
}
export function scopeLabel(activity) {
  if (activity.audience === 'GENERAL') return 'Tot el grup';
  const codes = sectionCodes(activity);
  return codes.length ? codes.map(code => SECTION_LABELS[code]).join(' · ') : 'Secció';
}

// ---------------------------------------------------------------- capabilities (advisory)

const scopeCodes = scope => scope?.all ? null : (scope?.sections ?? []).map(section => section.code);
export function canCreate(caps) {
  const activities = caps?.activities;
  return !!(activities?.manageGeneral || activities?.manage?.all || activities?.manage?.sections?.length);
}
export function manageableSections(caps) {
  const manage = caps?.activities?.manage;
  if (!manage) return [];
  if (manage.all) return SECTION_ORDER.slice();
  return SECTION_ORDER.filter(code => manage.sections.some(section => section.code === code));
}
/** Same rule as the server: GENERAL needs manageGeneral; SECTIONS needs manage over every section. */
export function canManage(activity, caps) {
  const activities = caps?.activities;
  if (!activity || !activities) return false;
  if (activity.audience === 'GENERAL') return !!activities.manageGeneral;
  const codes = scopeCodes(activities.manage);
  if (codes === null) return !!activities.manage;
  const targets = sectionCodes(activity);
  return targets.length > 0 && targets.every(code => codes.includes(code));
}
/** Registration review scope overlapping the activity (the server decides; this avoids pointless calls). */
export function canReview(activity, caps) {
  const scope = caps?.activities?.reviewRegistrations;
  if (!scope) return false;
  if (scope.all || activity.audience === 'GENERAL') return true;
  const codes = scopeCodes(scope) ?? [];
  return sectionCodes(activity).some(code => codes.includes(code));
}
export function canVerifyPayments(activity, caps) {
  const scope = caps?.activities?.verifyPayments;
  if (!scope || !(activity.price_cents > 0)) return false;
  if (scope.all || activity.audience === 'GENERAL') return true;
  const codes = scopeCodes(scope) ?? [];
  return sectionCodes(activity).some(code => codes.includes(code));
}
/** Read-only explanation line for the detail header (§3.5), or null when the user can manage. */
export function readOnlyReason(activity, caps) {
  if (canManage(activity, caps)) return null;
  if (activity.audience === 'SECTIONS' && canCreate(caps)) {
    const own = manageableSections(caps);
    if (sectionCodes(activity).some(code => own.includes(code))) return 'Només lectura · inclou seccions que no gestiones';
  }
  return 'Només lectura';
}
/** Scope subtitle for the list header when the user's view is limited (§5.1). */
export function scopeSubtitle(caps) {
  const activities = caps?.activities;
  if (!activities || activities.read?.all) return null;
  const readable = (activities.read?.sections ?? []).map(section => SECTION_LABELS[section.code]).filter(Boolean);
  const readOnly = !canCreate(caps);
  if (!readable.length) return readOnly ? 'Només lectura' : null;
  const label = `${listJoin(readable)} i activitats de tot el grup`;
  return readOnly ? `${label} · només lectura` : label;
}

// ---------------------------------------------------------------- timing (§8.2), derived, never stored

/**
 * @returns {'draft'|'closed'|'open'|'deadline-soon'|'registration-closed'|'in-progress'|'ended'}
 */
export function phase(activity, now = Date.now()) {
  if (activity.status === 'DRAFT') return 'draft';
  if (activity.status === 'CLOSED') return 'closed';
  if (activity.ends_at < now) return 'ended';
  if (activity.starts_at <= now) return 'in-progress';
  if (activity.registration_deadline < now) return 'registration-closed';
  return activity.registration_deadline - now < 2 * DAY ? 'deadline-soon' : 'open';
}
export function deadlineSignal(deadline, now = Date.now()) {
  if (deadline < now) return 'Termini tancat';
  const left = deadline - now;
  if (left < DAY) return 'Últim dia';
  return `Termini en ${Math.ceil(left / DAY)} dies`;
}
/** Timing line for the detail header, or null. */
export function timingLine(activity, now = Date.now()) {
  switch (phase(activity, now)) {
    case 'open': case 'deadline-soon': return `Inscripcions obertes fins al ${dateTime(activity.registration_deadline)}`;
    case 'registration-closed': return 'Inscripcions tancades';
    case 'in-progress': return 'En curs';
    case 'ended': return 'Finalitzada · pendent de tancar';
    case 'draft': return activity.registration_deadline < now ? 'El termini ja ha passat' : null;
    default: return null;
  }
}

// ---------------------------------------------------------------- registration summary

const inscriptions = n => `${n} ${n === 1 ? 'inscripció' : 'inscripcions'}`;
/** "12 inscripcions" or, for a partial scope, "12 inscripcions de Tropa". null when unknown (never 0). */
export function registrationsText(summary) {
  if (!summary) return null;
  if (summary.scope === 'PARTIAL') {
    const names = (summary.sections || []).map(code => SECTION_LABELS[code]).filter(Boolean);
    return `${inscriptions(summary.total)}${names.length ? ` de ${listJoin(names)}` : ''}`;
  }
  return inscriptions(summary.total);
}
export const partialLabel = summary => summary?.scope === 'PARTIAL'
  ? listJoin((summary.sections || []).map(code => SECTION_LABELS[code]).filter(Boolean)) : null;

// ---------------------------------------------------------------- list signals (§7.2)

/**
 * At most two signals by priority: attention, registrations, deadline/timing, price.
 * @returns {Array<{text: string, tone: 'attention'|'warning'|'muted'|'neutral'}>}
 */
export function signals(activity, now = Date.now()) {
  const result = [];
  const current = phase(activity, now);
  const summary = activity.registrations;
  if (current === 'draft') return result;
  if (current === 'closed') {
    const text = registrationsText(summary);
    return text ? [{ text, tone: 'muted' }] : [];
  }
  if (summary?.needsReview > 0) result.push({ text: `${summary.needsReview} per revisar`, tone: 'attention' });
  else if (current === 'ended') result.push({ text: 'Pendent de tancar', tone: 'attention' });
  // A deadline under 48h is time-critical (§8.2 warning): it outranks the plain count so it is never hidden.
  if (current === 'deadline-soon') result.push({ text: deadlineSignal(activity.registration_deadline, now), tone: 'warning' });
  const registrations = registrationsText(summary);
  if (registrations) result.push({ text: registrations, tone: 'neutral' });
  if (current === 'in-progress') result.push({ text: 'En curs', tone: 'neutral' });
  else if (current !== 'ended' && current !== 'deadline-soon') result.push({ text: deadlineSignal(activity.registration_deadline, now), tone: 'neutral' });
  result.push({ text: priceLabel(activity.price_cents), tone: 'neutral' });
  return result.slice(0, 2);
}
export function accessibleRowName(activity, now = Date.now()) {
  const status = STATUS_LABELS[activity.status];
  const first = signals(activity, now)[0]?.text;
  return [activity.name, status, `${scopeLabel(activity)}, ${longRange(activity.starts_at, activity.ends_at)}`, first].filter(Boolean).join(', ');
}
export const STATUS_LABELS = Object.freeze({ DRAFT: 'Esborrany', PUBLISHED: 'Publicada', CLOSED: 'Tancada' });

// ---------------------------------------------------------------- filters (§6), URL-backed

export const STATUS_FILTERS = Object.freeze([
  { value: '', label: 'Totes' }, { value: 'publicades', label: 'Publicades' },
  { value: 'esborranys', label: 'Esborranys' }, { value: 'tancades', label: 'Tancades' }]);
export const WHEN_FILTERS = Object.freeze([
  { value: '', label: 'Qualsevol data' }, { value: 'proximes', label: 'Pròximes' },
  { value: 'aquest-mes', label: 'Aquest mes' }, { value: 'passades', label: 'Passades' }]);
export const DEFAULT_FILTERS = Object.freeze({ estat: '', seccio: '', quan: '', q: '' });

/** Unknown or invalid values fall back to the defaults silently. */
export function parseFilters(query = {}) {
  const pick = (list, value) => list.some(option => option.value === value) ? value : '';
  const seccio = query.seccio === GENERAL_FILTER || SECTION_LABELS[query.seccio] ? query.seccio : '';
  const q = typeof query.q === 'string' ? query.q.slice(0, 80) : '';
  return { estat: pick(STATUS_FILTERS, query.estat), seccio, quan: pick(WHEN_FILTERS, query.quan), q };
}
export function filtersToQuery(filters) {
  return Object.fromEntries(Object.entries(filters).filter(([key, value]) => value && key in DEFAULT_FILTERS));
}
export const activeFilterCount = filters => ['seccio', 'quan'].filter(key => filters[key]).length;
export const filtersDiffer = filters => Object.keys(DEFAULT_FILTERS).some(key => filters[key]);

const endedOrClosed = (activity, now) => activity.status === 'CLOSED' || (activity.status === 'PUBLISHED' && activity.ends_at < now);
export function matchesStatus(activity, estat, now = Date.now()) {
  if (estat === 'publicades') return activity.status === 'PUBLISHED';
  if (estat === 'esborranys') return activity.status === 'DRAFT';
  if (estat === 'tancades') return endedOrClosed(activity, now);
  return true;
}
function matchesWhen(activity, quan, now) {
  if (quan === 'proximes') return activity.ends_at >= now;
  if (quan === 'passades') return activity.ends_at < now;
  if (quan === 'aquest-mes') {
    const date = new Date(now), start = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime();
    return activity.starts_at < end && activity.ends_at >= start;
  }
  return true;
}
function matchesSection(activity, seccio) {
  if (!seccio) return true;
  if (seccio === GENERAL_FILTER) return activity.audience === 'GENERAL';
  return sectionCodes(activity).includes(seccio);
}
function matchesSearch(activity, q) {
  const needle = normalize(q);
  if (!needle) return true;
  return [activity.name, activity.location, activity.public_code].some(value => normalize(value).includes(needle));
}
export function filterActivities(rows, filters, now = Date.now(), { ignoreStatus = false } = {}) {
  return rows.filter(activity => (ignoreStatus || matchesStatus(activity, filters.estat, now)) && matchesWhen(activity, filters.quan, now) &&
    matchesSection(activity, filters.seccio) && matchesSearch(activity, filters.q));
}
/** Section options: `Totes`, `Tot el grup` and only the sections present in the loaded list. */
export function sectionOptions(rows) {
  const present = new Set(rows.flatMap(sectionCodes));
  return [{ value: '', label: 'Totes' },
    ...(rows.some(row => row.audience === 'GENERAL') ? [{ value: GENERAL_FILTER, label: 'Tot el grup' }] : []),
    ...SECTION_ORDER.filter(code => present.has(code)).map(code => ({ value: code, label: SECTION_LABELS[code] }))];
}
export function statusCounts(rows, filters, now = Date.now()) {
  const base = filterActivities(rows, filters, now, { ignoreStatus: true });
  return Object.fromEntries(STATUS_FILTERS.map(option => [option.value, base.filter(row => matchesStatus(row, option.value, now)).length]));
}

// ---------------------------------------------------------------- grouping (§5.4)

export function groupOf(activity, now = Date.now()) {
  if (activity.status === 'DRAFT') return 'drafts';
  return endedOrClosed(activity, now) ? 'past' : 'active';
}
const byActive = now => (a, b) => (Number(a.registration_deadline < now) - Number(b.registration_deadline < now)) || a.starts_at - b.starts_at;
const byStart = (a, b) => a.starts_at - b.starts_at;
const byRecent = (a, b) => b.starts_at - a.starts_at;
export const GROUPS = Object.freeze([
  { id: 'active', label: 'En marxa i pròximes' }, { id: 'drafts', label: 'Esborranys' }, { id: 'past', label: 'Passades i tancades' }]);
export function groupActivities(rows, now = Date.now()) {
  const sorters = { active: byActive(now), drafts: byStart, past: byRecent };
  return GROUPS.map(group => ({ ...group, rows: rows.filter(row => groupOf(row, now) === group.id).sort(sorters[group.id]) }))
    .filter(group => group.rows.length);
}
/** Flat lists (single status segment) keep the group order and each group's ordering rule. */
export const flatActivities = (rows, now = Date.now()) => groupActivities(rows, now).flatMap(group => group.rows);

// ---------------------------------------------------------------- editor (§9)

export const TRANSPORT_FAMILY_CENTS = 0; // Product decision: transport arranged by the family costs the group 0 €.
const two = n => String(n).padStart(2, '0');
export function toLocalInput(value) {
  if (value == null) return '';
  const d = new Date(value);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;
}
const fromLocalInput = value => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(value || ''))) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
};
export function editorValues(activity) {
  const group = activity?.transportOptions?.find(option => option.code === 'GROUP');
  return {
    name: activity?.name ?? '', audience: activity?.audience ?? '', sections: activity ? sectionCodes(activity) : [],
    startsAt: toLocalInput(activity?.starts_at), endsAt: toLocalInput(activity?.ends_at),
    deadline: toLocalInput(activity?.registration_deadline), location: activity?.location ?? '',
    paid: activity ? activity.price_cents > 0 : false, price: activity?.price_cents > 0 ? centsToInput(activity.price_cents) : '',
    transport: !!group, transportSupplement: group ? centsToInput(group.price_adjustment_cents) : '0',
    shortDescription: activity?.short_description ?? '', materials: activity?.materials ?? '', specialNotice: activity?.special_notice ?? ''
  };
}
/**
 * Validate the editor inline, mirroring the backend contract, and build the request body.
 * @param {ReturnType<typeof editorValues>} values
 * @param {{sectionIds: Record<string, string>, now?: number}} context section code → id
 */
export function validateEditor(values, { sectionIds, now = Date.now() }) {
  /** @type {Record<string, string>} */
  const errors = {};
  const notes = {};
  const name = values.name.trim(), location = values.location.trim();
  if (!name) errors.name = 'Escriu el nom de l’activitat';
  else if (name.length > 120) errors.name = 'Com a màxim 120 caràcters';
  if (!['GENERAL', 'SECTIONS'].includes(values.audience)) errors.audience = 'Tria per a qui és l’activitat';
  if (values.audience === 'SECTIONS' && !values.sections.length) errors.audience = 'Tria almenys una secció';
  const startsAt = fromLocalInput(values.startsAt), endsAt = fromLocalInput(values.endsAt), deadline = fromLocalInput(values.deadline);
  if (startsAt === null) errors.startsAt = 'Indica quan comença';
  if (endsAt === null) errors.endsAt = 'Indica quan acaba';
  else if (startsAt !== null && endsAt <= startsAt) errors.endsAt = 'El final ha de ser posterior a l’inici';
  if (deadline === null) errors.deadline = 'Indica el termini d’inscripció';
  else if (startsAt !== null && deadline > startsAt) errors.deadline = 'El termini ha de ser abans de l’inici';
  else if (deadline < now) notes.deadline = 'Es podrà guardar, però no publicar amb un termini passat';
  if (!location) errors.location = 'Indica el lloc';
  else if (location.length > 160) errors.location = 'Com a màxim 160 caràcters';
  let priceCents = 0;
  if (values.paid) {
    const parsed = parseEuros(values.price);
    if (parsed === null || parsed <= 0) errors.price = 'Indica un preu vàlid, per exemple 15,00';
    else if (parsed > MAX_CENTS) errors.price = 'El preu màxim és 10.000,00 €';
    else priceCents = parsed;
  }
  let transportOptions = [];
  if (values.transport) {
    const supplement = parseEuros(values.transportSupplement, { allowNegative: true });
    if (supplement === null) errors.transportSupplement = 'Indica un import vàlid (pot ser negatiu per a un descompte)';
    else if (priceCents + supplement < 0 || priceCents + supplement > MAX_CENTS)
      errors.transportSupplement = 'El preu amb transport del grup ha d’estar entre 0 i 10.000,00 €';
    else transportOptions = [{ code: 'GROUP', adjustmentCents: supplement }, { code: 'FAMILY', adjustmentCents: TRANSPORT_FAMILY_CENTS }];
  }
  for (const [key, max] of [['shortDescription', 600], ['materials', 400], ['specialNotice', 400]])
    if (values[key].length > max) errors[key] = `Com a màxim ${max} caràcters`;
  const body = { name, audience: values.audience, sectionIds: values.audience === 'SECTIONS' ? values.sections.map(code => sectionIds[code]).filter(Boolean) : [],
    location, startsAt, endsAt, registrationDeadline: deadline, priceCents,
    shortDescription: values.shortDescription.trim(), materials: values.materials.trim(), specialNotice: values.specialNotice.trim(), transportOptions };
  if (values.audience === 'SECTIONS' && body.sectionIds.length !== values.sections.length) errors.audience = 'Hi ha seccions que no es poden triar';
  return { errors, notes, body, valid: Object.keys(errors).length === 0 };
}
export const LOCKED_FIELDS = Object.freeze(['audience', 'startsAt', 'endsAt', 'deadline', 'paid', 'price', 'transport', 'transportSupplement']);
export const LOCKED_MESSAGE = 'Ja hi ha inscripcions: les dates, el preu, l’abast i el transport no es poden canviar.';

// ---------------------------------------------------------------- errors (§14.4)

export const STALE_MESSAGE = 'Esta activitat ha canviat mentre l’editaves. Actualitza-la abans de guardar.';
export const NOT_FOUND_MESSAGE = 'No tens accés a aquesta activitat o ja no existeix.';
const ERROR_COPY = {
  invalid_activity: 'Revisa els camps marcats.',
  forbidden: 'No pots gestionar activitats d’aquesta secció.',
  activity_terms_locked: 'Ja hi ha inscripcions: les dates, el preu, l’abast i el transport no es poden canviar.',
  activity_closed: 'Aquesta activitat està tancada.',
  expired_deadline: 'No es pot publicar: el termini d’inscripció ja ha passat. Edita el termini i torna-ho a provar.',
  stale_activity: STALE_MESSAGE,
  activity_has_registrations: 'Aquest esborrany ja té inscripcions i no es pot descartar.',
  invalid_transition: 'L’estat de l’activitat ha canviat. S’ha actualitzat la informació.',
  not_found: NOT_FOUND_MESSAGE
};
export const errorCopy = code => ERROR_COPY[code] ?? 'No s’ha pogut completar l’acció. Torna-ho a provar.';
