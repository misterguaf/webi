// Incidències i millores (3.5H.3) — pure model: labels, filters, actions by state. Advisory only: the server
// authorises every call (own reports for everyone, management only with admin.incidents.manage).

export const TYPES = Object.freeze([
  { value: 'ERROR', label: 'Error', hint: 'Alguna cosa no funciona com hauria.' },
  { value: 'IMPROVEMENT', label: 'Millora', hint: 'Una idea per a fer-ho més fàcil.' },
  { value: 'ACCESS', label: 'Accés', hint: 'No veus o no pots fer una cosa que necessites.' },
  { value: 'DATA', label: 'Dades', hint: 'Una dada sembla incorrecta o duplicada.' },
  { value: 'OTHER', label: 'Altres', hint: 'Qualsevol altra cosa de la plataforma.' }]);
export const typeLabel = value => TYPES.find(item => item.value === value)?.label ?? 'Altres';
export const STATUS = Object.freeze({
  OPEN: { label: 'Oberta', tone: 'attention' },
  IN_PROGRESS: { label: 'En curs', tone: 'warning' },
  RESOLVED: { label: 'Resolta', tone: 'ok' }
});
export const statusOf = code => STATUS[code] ?? { label: 'Estat desconegut', tone: 'muted' };
export const MODULES = Object.freeze([
  { value: 'inici', label: 'Inici' }, { value: 'activitat', label: 'Activitat' }, { value: 'activitats', label: 'Activitats' },
  { value: 'inscripcions', label: 'Inscripcions' }, { value: 'quotes', label: 'Quotes' }, { value: 'tresoreria', label: 'Tresoreria' },
  { value: 'participants', label: 'Participants' }, { value: 'incidencies', label: 'Incidències' }, { value: 'administracio', label: 'Administració' },
  { value: 'altres', label: 'Altres / no ho sé' }]);
export const moduleLabel = value => MODULES.find(item => item.value === value)?.label ?? 'Sense indicar';
/** The page the person came from fills the module, so nobody needs to know module names or ids. */
export const moduleFromPage = page => MODULES.some(item => item.value === page) && page !== 'incidencies' ? page : 'altres';

// Deployment that created the report (server-derived; nobody chooses it).
export const ENVIRONMENTS = Object.freeze([{ value: 'PRODUCTION', label: 'PRODUCCIÓ', tone: 'attention' },
  { value: 'STAGING', label: 'PROVES', tone: 'warning' }, { value: 'LOCAL', label: 'LOCAL', tone: 'muted' }]);
export const environmentOf = value => ENVIRONMENTS.find(item => item.value === value) ?? { value, label: 'LOCAL', tone: 'muted' };

export const VIEWS = Object.freeze([{ value: 'meues', label: 'Les meues' }, { value: 'totes', label: 'Totes' }]);
const pick = (list, value) => list.some(item => item.value === value) ? value : '';
export function parseFilters(query = {}, manage = false) {
  const vista = manage && query.vista === 'totes' ? 'totes' : 'meues';
  return { vista, estat: pick(Object.keys(STATUS).map(value => ({ value })), query.estat), tipus: pick(TYPES, query.tipus),
    modul: vista === 'totes' ? pick(MODULES, query.modul) : '', entorn: vista === 'totes' ? pick(ENVIRONMENTS, query.entorn) : '' };
}
export function apiQuery(filters) {
  const params = new URLSearchParams({ vista: filters.vista });
  if (filters.estat) params.set('status', filters.estat);
  if (filters.tipus) params.set('type', filters.tipus);
  if (filters.modul) params.set('module', filters.modul);
  if (filters.entorn) params.set('environment', filters.entorn);
  return params.toString();
}

/** Management actions offered by state (managers only). */
export function actionsFor(incident, manage) {
  if (!manage) return [];
  return [incident.status === 'OPEN' ? 'start' : null, ['OPEN', 'IN_PROGRESS'].includes(incident.status) ? 'resolve' : null,
    incident.status === 'RESOLVED' ? 'reopen' : null].filter(Boolean);
}
export const ACTION_LABELS = Object.freeze({ start: 'Comença a treballar-hi', resolve: 'Marca com a resolta', reopen: 'Reobri' });
export const RESOLUTION_SUGGESTIONS = Object.freeze(['Corregit en la nova versió.', 'No s’implementarà de moment.', 'Ja funciona com s’espera.']);

const ERRORS = {
  invalid_incident: 'Revisa el tipus i el títol (mínim 3 caràcters).',
  invalid_resolution: 'La resposta ha de ser curta (màxim 280 caràcters).',
  invalid_transition: 'Aquest canvi ja no és possible en l’estat actual.',
  stale_incident: 'La incidència ha canviat mentrestant. S’ha actualitzat.',
  forbidden: 'No tens permís per fer aquesta acció.',
  not_found: 'Aquesta incidència no existeix o no és teua.'
};
export function errorCopy(error) {
  const code = typeof error === 'string' ? error : error?.code;
  if (code && ERRORS[code]) return ERRORS[code];
  if (error?.status === 403) return ERRORS.forbidden;
  if (error?.status === 404) return ERRORS.not_found;
  return 'No s’ha pogut completar l’acció. Torna-ho a provar.';
}
