// Participants (3.5E) — pure model: no DOM, no fetch. Filters, grouping, labels and the derived
// display of completeness, status, section history and basic fee state. Tested in Node.
import { SECTION_LABELS, SECTION_ORDER, normalize } from '../activities/model.js';

export { SECTION_LABELS, SECTION_ORDER, normalize };

// ---------------------------------------------------------------- status and completeness
export const STATUS_LABELS = Object.freeze({ ACTIVE: 'Actiu', INACTIVE: 'De baixa' });
export const statusLabel = status => STATUS_LABELS[status] ?? status;

const MISSING_LABELS = Object.freeze({ birthDate: 'la data de naixement', guardian: 'un tutor', contact: 'un contacte' });
export const missingLabel = item => MISSING_LABELS[item] ?? item;
const MISSING_ACTIONS = Object.freeze({ birthDate: 'Afegeix la data de naixement', guardian: 'Afegeix un tutor', contact: 'Afegeix un contacte' });
export const missingAction = item => MISSING_ACTIONS[item] ?? item;
export function completenessSignal(completeness) {
  if (!completeness || completeness.complete) return null;
  return { text: 'Informació pendent', tone: 'attention' };
}
/** "Falta la data de naixement" / "Falten un tutor i un contacte". */
export function missingSummary(missing) {
  if (!missing?.length) return null;
  const items = missing.map(missingLabel);
  const joined = items.length === 1 ? items[0] : `${items.slice(0, -1).join(', ')} i ${items.at(-1)}`;
  return `${missing.length === 1 ? 'Falta' : 'Falten'} ${joined}`;
}

// ---------------------------------------------------------------- section history
const HISTORY_REASONS = Object.freeze({ ENROLMENT: 'alta', TRANSFER: 'canvi de secció', DEACTIVATION: 'baixa',
  REACTIVATION: 'reactivació', BACKFILL: 'registre inicial' });
export const historyReason = reason => HISTORY_REASONS[reason] ?? reason;

// ---------------------------------------------------------------- fee status (basic)
export const FEE_LABELS = Object.freeze({ PAID: 'Pagada', PARTIAL: 'Parcial', PENDING: 'Pendent', ISSUE: 'Incidència' });
export const feeLabel = status => FEE_LABELS[status] ?? status;

// ---------------------------------------------------------------- sections and scope
export function sectionCode(id, sections) {
  return sections.find(section => section.id === id)?.code ?? null;
}
export function sectionName(id, sections) {
  const code = sectionCode(id, sections);
  return code ? (SECTION_LABELS[code] ?? code) : 'Secció';
}
export function initials(name) {
  return String(name || '').replace(/\s*\([^)]*\)/g, '').trim().split(/\s+/).slice(0, 2)
    .map(part => part[0] || '').join('').toLocaleUpperCase('ca-ES') || '·';
}
/** Sections the user may create in / manage, from capabilities. */
export function manageableSections(caps) {
  const manage = caps?.participants?.manage;
  if (!manage) return [];
  if (manage.all) return SECTION_ORDER.slice();
  return SECTION_ORDER.filter(code => manage.sections.some(section => section.code === code));
}
export const canCreate = caps => manageableSections(caps).length > 0;
export function canManageSection(caps, sectionCodeValue) {
  const manage = caps?.participants?.manage;
  if (!manage) return false;
  return manage.all || manage.sections.some(section => section.code === sectionCodeValue);
}
export function scopeSubtitle(caps) {
  const read = caps?.participants?.read;
  if (!read || read.all) return null;
  const names = (read.sections ?? []).map(section => SECTION_LABELS[section.code]).filter(Boolean);
  return names.length ? names.join(' · ') : null;
}

// ---------------------------------------------------------------- filters (URL: seccio, estat, completitud; NOT the name)
export const ESTAT_FILTERS = Object.freeze([{ value: '', label: 'Actius' }, { value: 'de-baixa', label: 'De baixa' }]);
export const COMPLETITUD_FILTERS = Object.freeze([{ value: '', label: 'Totes' }, { value: 'pendents', label: 'Informació pendent' }]);
export const DEFAULT_FILTERS = Object.freeze({ seccio: '', estat: '', completitud: '' });

export function parseFilters(query = {}) {
  const seccio = SECTION_LABELS[query.seccio] ? query.seccio : '';
  const estat = query.estat === 'de-baixa' ? 'de-baixa' : '';
  const completitud = query.completitud === 'pendents' ? 'pendents' : '';
  return { seccio, estat, completitud };
}
export function filtersToQuery(filters) {
  return Object.fromEntries(Object.entries(filters).filter(([key, value]) => value && key in DEFAULT_FILTERS));
}
export const filtersDiffer = filters => Object.keys(DEFAULT_FILTERS).some(key => filters[key]);
export const activeFilterCount = filters => ['seccio', 'completitud'].filter(key => filters[key]).length;

/** The estat filter is served by the backend (ACTIVE vs INACTIVE); seccio/completitud/search are local. */
export function filterParticipants(rows, filters, sections, search = '') {
  const needle = normalize(search);
  return rows.filter(row => {
    if (filters.seccio && sectionCode(row.current_section_id, sections) !== filters.seccio) return false;
    if (filters.completitud === 'pendents' && row.completeness?.complete !== false) return false;
    if (needle && !normalize(row.display_name).includes(needle)) return false;
    return true;
  });
}
export function sectionOptions(rows, sections) {
  const present = new Set(rows.map(row => sectionCode(row.current_section_id, sections)).filter(Boolean));
  return [{ value: '', label: 'Totes' },
    ...SECTION_ORDER.filter(code => present.has(code)).map(code => ({ value: code, label: SECTION_LABELS[code] }))];
}

// ---------------------------------------------------------------- grouping
export function groupBySection(rows, sections) {
  const order = new Map(SECTION_ORDER.map((code, index) => [code, index]));
  const groups = new Map();
  for (const row of rows) {
    const code = sectionCode(row.current_section_id, sections) ?? 'Secció';
    if (!groups.has(code)) groups.set(code, []);
    groups.get(code).push(row);
  }
  return [...groups.entries()].sort((a, b) => (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99))
    .map(([code, list]) => ({ code, label: SECTION_LABELS[code] ?? code,
      rows: list.sort((a, b) => a.display_name.localeCompare(b.display_name, 'ca')) }));
}

// ---------------------------------------------------------------- editor (create / edit)
export const PROVENANCE_OPTIONS = Object.freeze([
  { value: '', label: 'Sense indicar' },
  { value: 'CRM_ANTERIOR', label: 'CRM anterior' },
  { value: 'DOCUMENTACIO_FISICA', label: 'Documentació física' },
  { value: 'COMUNICACIO_FAMILIA', label: 'Comunicació de la família' },
  { value: 'ALTRES', label: 'Altres' }]);
export const PROVENANCE_LABELS = Object.freeze(Object.fromEntries(PROVENANCE_OPTIONS.map(o => [o.value, o.label])));

const validBirthDate = (value, now) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && date.getTime() <= now;
};
/**
 * Validate the participant editor inline (mirrors the backend contract) and build the request body.
 * @param {{name, birthDate, sectionCode, provenance, provenanceNote}} values
 * @param {{mode:'create'|'edit', sectionIds:Record<string,string>, now?:number}} ctx
 */
export function validateEditor(values, { mode, sectionIds, now = Date.now() }) {
  const errors = {};
  const name = (values.name ?? '').trim();
  if (!name) errors.name = 'Escriu el nom del participant';
  else if (name.length > 120) errors.name = 'Com a màxim 120 caràcters';
  let birthDate = null;
  const raw = (values.birthDate ?? '').trim();
  if (raw) {
    if (!validBirthDate(raw, now)) errors.birthDate = 'Data no vàlida';
    else birthDate = raw;
  }
  if (mode === 'create' && !values.sectionCode) errors.audience = 'Tria la secció';
  const provenance = values.provenance || null;
  const note = (values.provenanceNote ?? '').trim();
  if (note.length > 200) errors.provenanceNote = 'Com a màxim 200 caràcters';
  const body = mode === 'create'
    ? { name, sectionId: sectionIds[values.sectionCode], birthDate, provenance, provenanceNote: note || null }
    : { name, birthDate, provenance, provenanceNote: note || null };
  if (mode === 'create' && !body.sectionId) errors.audience = 'Tria la secció';
  return { errors, body, valid: Object.keys(errors).length === 0 };
}

/** In-scope possible duplicates: same normalised name (and, if given, same birth date takes priority). */
export function findDuplicates(rows, name, birthDate) {
  const needle = normalize(name);
  if (needle.length < 2) return [];
  return rows.filter(row => normalize(row.display_name) === needle)
    .sort((a, b) => (birthDate && b.birth_date === birthDate ? 1 : 0) - (birthDate && a.birth_date === birthDate ? 1 : 0));
}

export function accessibleRowName(row, sections) {
  const parts = [row.display_name, sectionName(row.current_section_id, sections), statusLabel(row.status)];
  if (row.completeness?.complete === false) parts.push('informació pendent');
  return parts.join(', ');
}
