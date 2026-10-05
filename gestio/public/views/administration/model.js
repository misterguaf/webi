// Administració (3.5H.1) — pure model: tabs by capability, labels, origins, package expansion and the
// new-account request. Advisory only: the server authorises every act and rejects what the actor cannot grant.

const a = caps => caps?.administration ?? {};
export const TABS = [
  { id: 'compte', label: 'El meu compte', available: () => true },
  { id: 'usuaris', label: 'Usuaris', available: caps => !!a(caps).manageUsers },
  { id: 'rols', label: 'Rols i permisos', available: caps => !!(a(caps).manageUsers || a(caps).manageRoles || a(caps).managePermissions || a(caps).ratifyDelegations) },
  { id: 'delegacions', label: 'Delegacions', available: caps => !!a(caps).provisionDelegations },
  { id: 'ratificacions', label: 'Ratificacions', available: caps => !!a(caps).ratifyDelegations },
  { id: 'sessions', label: 'Sessions', available: () => true }
];
export const availableTabs = caps => TABS.filter(tab => tab.available(caps));

export const ORIGIN = { ROLE: 'Per rol', DIRECT: 'Directe', DELEGATION: 'Delegat' };
export const RATIFICATION = {
  NOT_REQUIRED: { label: 'Sense ratificació', tone: 'muted' },
  PENDING_RATIFICATION: { label: 'Activa · pendent de ratificar', tone: 'warning' },
  RATIFIED: { label: 'Ratificada', tone: 'ok' },
  REVOKED: { label: 'Revocada', tone: 'muted' }
};
export const DELEGATION_STATE = {
  ACTIVE: { label: 'Activa', tone: 'ok' },
  ACTIVE_PENDING_RATIFICATION: { label: 'Activa · pendent de ratificar', tone: 'warning' },
  PENDING_AUTHORISATION: { label: 'Pendent d’autorització', tone: 'attention' },
  EXPIRING: { label: 'Caduca aviat', tone: 'warning' },
  EXPIRED: { label: 'Caducada', tone: 'muted' },
  REVOKED: { label: 'Revocada', tone: 'muted' }
};
export const DELEGATION_FILTERS = [
  { value: 'actives', label: 'Actives', states: ['ACTIVE', 'ACTIVE_PENDING_RATIFICATION', 'EXPIRING'] },
  { value: 'pendents', label: 'Pendents de ratificar', states: ['ACTIVE_PENDING_RATIFICATION', 'PENDING_AUTHORISATION'] },
  { value: 'caduquen', label: 'Caduquen aviat', states: ['EXPIRING'] },
  { value: 'caducades', label: 'Caducades', states: ['EXPIRED'] },
  { value: 'revocades', label: 'Revocades', states: ['REVOKED'] }
];
export const filterDelegations = (rows, filter) => {
  const states = DELEGATION_FILTERS.find(item => item.value === filter)?.states;
  return states ? rows.filter(row => states.includes(row.state)) : rows;
};

const DAY = 86400000;
export const DELEGATION_DEFAULT_DAYS = 90, DELEGATION_MAX_DAYS = 365;
export const isoDay = ms => new Date(ms).toISOString().slice(0, 10);
/** "2026-12-31" → end of that day (ms), or null when invalid. */
export const dayEnd = iso => /^\d{4}-\d{2}-\d{2}$/.test(iso ?? '') ? Date.parse(`${iso}T23:59:59Z`) : null;
export function validDelegationExpiry(iso, now = Date.now()) {
  const value = dayEnd(iso);
  if (value === null) return { error: 'Indica la data de caducitat.' };
  if (value <= now) return { error: 'La caducitat ha de ser futura.' };
  if (value > now + DELEGATION_MAX_DAYS * DAY) return { error: 'Una delegació dura com a màxim 365 dies.' };
  return { value };
}

/**
 * Apply an access package to the draft (roles keyed by role + section). A package is only a preset:
 * it selects roles, permissions and scope that the form then sends as ordinary roles and grants.
 */
export function applyPackage(draft, pkg, { sectionId = null, catalog }) {
  const roles = [...draft.roles];
  for (const preset of pkg.roles) {
    const role = catalog.roles.find(item => item.code === preset.roleCode);
    if (!role) continue;
    const scoped = role.scope === 'SECTION';
    if (scoped && !sectionId) return { draft, error: 'Aquest paquet necessita una secció.' };
    const key = `${role.code}|${scoped ? sectionId : ''}`;
    const permissions = preset.permissions ?? role.defaults;
    const existing = roles.find(item => item.key === key);
    if (existing) existing.permissions = [...new Set([...existing.permissions, ...permissions])];
    else roles.push({ key, roleCode: role.code, sectionId: scoped ? sectionId : null, permissions: [...permissions],
      expiresAt: role.expiryRequired ? isoDay(Date.now() + DELEGATION_DEFAULT_DAYS * DAY) : '' });
  }
  return { draft: { ...draft, roles } };
}

/** The new-account request. Returns { errors, body }. */
export function provisionRequest(draft, { now = Date.now() } = {}) {
  const errors = {};
  const displayName = String(draft.displayName ?? '').trim();
  if (displayName.length < 2) errors.displayName = 'Escriu el nom de la persona.';
  if (draft.email && !/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(draft.email.trim())) errors.email = 'El correu no és vàlid.';
  const roles = [];
  for (const role of draft.roles) {
    let expiresAt = null;
    if (role.expiresAt) {
      expiresAt = dayEnd(role.expiresAt);
      if (expiresAt === null || expiresAt <= now) { errors.roles = 'Revisa les caducitats dels rols.'; continue; }
    } else if (role.roleCode === 'SECTION_DELEGATE') { errors.roles = 'La delegació de secció necessita caducitat.'; continue; }
    roles.push({ roleCode: role.roleCode, ...(role.sectionId ? { sectionId: role.sectionId } : {}), ...(expiresAt ? { expiresAt } : {}),
      permissions: role.permissions });
  }
  const grants = draft.grants.map(grant => ({ permissionCode: grant.permissionCode, ...(grant.sectionId ? { sectionId: grant.sectionId } : {}) }));
  return { errors, body: Object.keys(errors).length ? null : { displayName, roles, grants } };
}

const ERRORS = {
  forbidden: 'No tens permís per fer aquesta acció.',
  self_change_forbidden: 'Ningú pot canviar el seu propi accés.',
  separation_of_duties: 'Qui tramita o rep un canvi no el pot ratificar ni autoritzar.',
  grant_exceeds_authority: 'No pots concedir un permís que tu mateix no tens (o en un abast més ampli que el teu).',
  elevated_role_requires_group_coordinator: 'Només Coordinació general assigna Coordinació general, Tresoreria o Administració tècnica.',
  role_derived_permission: 'Aquest permís ve d’un rol: canvia el rol per a retirar-lo.',
  invalid_scope: 'L’abast no és vàlid per a aquest rol o permís.',
  invalid_permission: 'El permís no és vàlid o no està dins de cap rol de la persona.',
  invalid_role: 'Revisa els rols seleccionats.',
  invalid_user: 'Revisa el nom. En l’entorn de prova ha d’incloure «(fictici)» o «(fictícia)».',
  role_already_assigned: 'La persona ja té aquest rol.',
  permission_already_granted: 'La persona ja té aquest permís.',
  duplicate_access: 'Hi ha un rol o permís repetit.',
  last_group_coordinator: 'No es pot retirar l’última Coordinació general.',
  invalid_ratification: 'Indica la referència de l’acta (DEMO-…).',
  invalid_transition: 'Aquest canvi ja no està pendent.',
  invalid_delegation: 'Revisa la delegació: permís delegable, abast i caducitat (màxim 365 dies).',
  unauthorized_delegation: 'La persona que autoritza no té aquesta autoritat (les delegacions no es poden redelegar).',
  recipient_role_scope_required: 'La persona no té cap rol que cobrisca aquest permís en aquest abast.',
  named_authoriser_required: 'Només la persona que autoritza pot confirmar-ho.',
  unauthorized_authorizer: 'La persona indicada no té autoritat per a autoritzar-ho.',
  fresh_session_required: 'Per seguretat, torna a entrar abans de fer canvis d’accés.',
  invalid_expiry: 'La caducitat no és vàlida.',
  use_own_sessions: 'Les teues sessions es gestionen des de «Les meues sessions».'
};
export function errorCopy(error) {
  const code = typeof error === 'string' ? error : error?.code;
  if (code && ERRORS[code]) return ERRORS[code];
  if (error?.status === 403) return ERRORS.forbidden;
  if (error?.status === 404) return 'No existeix o no hi tens accés.';
  return 'No s’ha pogut completar l’acció. Torna-ho a provar.';
}
