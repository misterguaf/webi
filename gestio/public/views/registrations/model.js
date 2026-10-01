// Inscripcions (3.5F, REGISTRATIONS.md v0.2) — pure model shared by the activity tab and the global
// queue: labels, filters, capability checks and derived values. No DOM, no fetch. Every rule mirrored
// here is enforced server-side; capabilities only avoid pointless requests and actions.

export const SECTION_LABELS = Object.freeze({ MANADA: 'Manada', TROPA: 'Tropa', ESCOLTA: 'Escolta', CLAN: 'Clan' });
export const sectionCodeOf = (id, sections) => sections.find(section => section.id === id)?.code ?? null;
export const sectionLabelOf = (id, sections) => SECTION_LABELS[sectionCodeOf(id, sections)] ?? null;

// ---------------------------------------------------------------- states (§9)
export const REGISTRATION_STATE_LABELS = Object.freeze({
  NEEDS_PARTICIPANT_REVIEW: 'Pendent de vincular', AWAITING_PAYMENT_REVIEW: 'Pendent de pagament',
  CONFIRMED: 'Confirmada', REJECTED: 'Rebutjada', WITHDRAWN: 'Retirada' });
export const PAYMENT_STATE_LABELS = Object.freeze({
  NOT_REQUIRED: 'Sense pagament', PENDING_REVIEW: 'Pendent de revisió', ISSUE: 'Incidència', VERIFIED: 'Verificat' });
export const registrationStateLabel = state => REGISTRATION_STATE_LABELS[state] ?? 'Estat desconegut';
export const paymentStateLabel = state => PAYMENT_STATE_LABELS[state] ?? 'Estat desconegut';
export const ESCALATION_LABELS = Object.freeze({ POSSIBLE_OTHER_SECTION: 'Possible secció diferent', REVIEWER_REQUEST: 'Enviada per la secció' });
export const WITHDRAWAL_SOURCES = Object.freeze([
  { value: 'FAMILY_COMMUNICATION', label: 'Ho ha comunicat la família' }, { value: 'OTHER', label: 'Altres' }]);
export const withdrawalSourceLabel = value => WITHDRAWAL_SOURCES.find(source => source.value === value)?.label ?? null;
export const TRANSPORT_LABELS = Object.freeze({ GROUP: 'Transport del grup', FAMILY: 'Transport per compte de la família' });

// ---------------------------------------------------------------- activity tab filters (§10.1)
export const TAB_FILTERS = Object.freeze([
  { value: 'totes', label: 'Totes', match: () => true },
  { value: 'per-revisar', label: 'Per revisar', match: row => row.status === 'NEEDS_PARTICIPANT_REVIEW' },
  { value: 'pendents-pagament', label: 'Pendents de pagament', match: row => row.status === 'AWAITING_PAYMENT_REVIEW', paidOnly: true },
  { value: 'confirmades', label: 'Confirmades', match: row => row.status === 'CONFIRMED' },
  { value: 'rebutjades', label: 'Rebutjades', match: row => row.status === 'REJECTED' },
  { value: 'retirades', label: 'Retirades', match: row => row.status === 'WITHDRAWN', onlyWhenPresent: true }]);
export function visibleFilters(rows, { paid }) {
  return TAB_FILTERS.filter(filter => (!filter.paidOnly || paid) && (!filter.onlyWhenPresent || rows.some(filter.match)));
}

// ---------------------------------------------------------------- capabilities (advisory)
const coversSection = (scope, sectionId) => !!scope && (scope.all || scope.sections.some(section => section.id === sectionId));
export const isGlobalReviewer = caps => !!caps?.registrations?.review?.all;
export const canRevealContact = (caps, row) => coversSection(caps?.registrations?.readContacts, row.registration_section_id);
/** A row the user can act on: escalated rows only for global reviewers. */
export const isActionable = (caps, row) => coversSection(caps?.registrations?.review, row.registration_section_id) &&
  (row.review_level !== 'GLOBAL' || isGlobalReviewer(caps));
const PENDING = new Set(['NEEDS_PARTICIPANT_REVIEW']);
const WITHDRAWABLE = new Set(['NEEDS_PARTICIPANT_REVIEW', 'AWAITING_PAYMENT_REVIEW', 'CONFIRMED']);
/** Sections the registration may be corrected to (§12.3): within the audience, and the user's authority. */
export function correctionTargets(activity, caps, row, sections) {
  if (!PENDING.has(row.status) || !isActionable(caps, row)) return [];
  const audience = activity.audience === 'GENERAL' ? sections.map(section => section.id) : (activity.sectionIds ?? []);
  const scope = caps?.registrations?.review;
  return sections.filter(section => audience.includes(section.id) && section.id !== row.registration_section_id &&
    (scope?.all || coversSection(scope, section.id)));
}
/** Row menu entries (§10.3), as keys; the view maps them to actions. */
export function rowActions(activity, caps, row, sections) {
  const actions = [];
  if (!isActionable(caps, row)) return actions;
  if (correctionTargets(activity, caps, row, sections).length) actions.push('correct-section');
  if (PENDING.has(row.status) && row.review_level !== 'GLOBAL') actions.push('escalate');
  if (WITHDRAWABLE.has(row.status)) actions.push('withdraw');
  return actions;
}
/** Withdrawal notice default (confirmed decision): yes for the family's communication, no for "other". */
export const defaultNotify = source => source === 'FAMILY_COMMUNICATION';

// ---------------------------------------------------------------- display helpers
export const displayName = row => row.participant?.name ?? row.submitted_name;
export function secondaryLine(row, activity, sections, shortDate) {
  return [`Sol·licitada el ${shortDate(row.created_at)}`,
    activity.audience === 'GENERAL' ? sectionLabelOf(row.registration_section_id, sections) : null,
    row.declared_section_id ? `Declarada a ${sectionLabelOf(row.declared_section_id, sections) ?? 'una altra secció'}` : null,
    TRANSPORT_LABELS[row.transport_code] ?? null,
    row.status === 'WITHDRAWN' && row.withdrawn_at ? `Retirada el ${shortDate(row.withdrawn_at)}` : null].filter(Boolean).join(' · ');
}
export function accessibleRowName(row) {
  return [displayName(row), registrationStateLabel(row.status), row.payment_status ? `justificant ${paymentStateLabel(row.payment_status).toLocaleLowerCase('ca-ES')}` : null,
    row.review_level === 'GLOBAL' ? 'en revisió global' : null].filter(Boolean).join(', ');
}

// ---------------------------------------------------------------- confirmed list (§17)
export function groupConfirmed(rows, sections) {
  const order = ['MANADA', 'TROPA', 'ESCOLTA', 'CLAN'];
  const groups = new Map();
  for (const row of rows) {
    const code = sectionCodeOf(row.registration_section_id, sections) ?? 'ALTRES';
    if (!groups.has(code)) groups.set(code, []);
    groups.get(code).push(row);
  }
  return [...groups.entries()].sort(([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
    .map(([code, list]) => ({ code, label: SECTION_LABELS[code] ?? 'Sense secció',
      rows: [...list].sort((a, b) => a.name.localeCompare(b.name, 'ca')) }));
}
export const transportTotals = rows => ({ group: rows.filter(row => row.transport_code === 'GROUP').length,
  family: rows.filter(row => row.transport_code === 'FAMILY').length });

// ---------------------------------------------------------------- global queue (§6)
export const QUEUE_VIEWS = Object.freeze([
  { value: 'pendents', label: 'Pendents de revisar' }, { value: 'incidencies', label: 'Incidències' }, { value: 'totes', label: 'Totes' }]);
export const parseQueueView = query => QUEUE_VIEWS.some(view => view.value === query?.vista) ? query.vista : 'pendents';
export function queueCountLine(activity, view, globalReviewer) {
  const c = activity.counts;
  if (view === 'totes') return [[c.actionable + (globalReviewer ? 0 : c.escalated), 'pendents'], [c.confirmed, 'confirmades'],
    [c.rejected, 'rebutjades'], [c.withdrawn, 'retirades']].filter(([n]) => n > 0).map(([n, text]) => `${n} ${text}`).join(' · ') || 'Sense inscripcions';
  const parts = [];
  if (c.actionable) parts.push(`${c.actionable} ${c.actionable === 1 ? 'pendent de vincular' : 'pendents de vincular'}`);
  if (c.escalated && !globalReviewer) parts.push(`${c.escalated} en revisió global`);
  return parts.join(' · ');
}
export const scopeNote = activity => activity.scope === 'PARTIAL'
  ? `vista parcial${activity.sections?.length ? ` (${activity.sections.map(code => SECTION_LABELS[code] ?? code).join(', ')})` : ''}` : null;
export const splitPrevious = activities => ({ current: activities.filter(a => !a.previous), previous: activities.filter(a => a.previous) });
/** Filter for the activity tab opened from the queue. */
export const tabFilterFor = view => view === 'pendents' ? 'per-revisar' : 'totes';
export const evidenceKind = mime => mime === 'application/pdf' ? 'pdf' : mime?.startsWith('image/') ? 'image' : null;
