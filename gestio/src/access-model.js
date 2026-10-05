// 3.5H.1 access administration model (docs/decisions/ADMIN_DECISIONS.md). Pure data shared by the
// administration service and its catalogue endpoint. Nothing here is a source of authority: access
// packages are presets that select existing roles, permissions and scopes; after saving, authority comes
// only from user_role + user_permission_grant + delegated_permission (G.1A model).
import { PERMISSIONS } from './permissions.js';

export const ROLES = Object.freeze({
  GROUP_COORDINATOR: { label: 'Coordinació general', scope: 'GROUP', elevated: true },
  SECTION_COORDINATOR: { label: 'Coordinació de secció', scope: 'SECTION', elevated: false },
  SECTION_DELEGATE: { label: 'Delegació de secció', scope: 'SECTION', elevated: false, expiryRequired: true },
  TREASURY: { label: 'Tresoreria', scope: 'GROUP', elevated: true },
  SECRETARY: { label: 'Secretaria', scope: 'GROUP', elevated: false },
  TECH_ADMIN: { label: 'Administració tècnica', scope: 'GROUP', elevated: true }
});

// Permissions a role assignment never grants by default: they need an explicit, individual decision
// (reveal of bank descriptions, self-approval, health, ratification authority, and the whole
// user-administration ceiling of TECH_ADMIN — TECH_ADMIN alone is never a superuser).
export const EXPLICIT_ONLY = Object.freeze(new Set(['finance.bank_description.reveal', 'finance.reimbursement.self_approve',
  'health.record.read', 'health.grant.manage', 'auth.permission.ratify']));
const ROLE_EXPLICIT_ONLY = Object.freeze({
  GROUP_COORDINATOR: new Set(['finance.movement.import']),
  TECH_ADMIN: new Set(['auth.user.manage', 'auth.role.manage', 'auth.permission.manage', 'auth.session.revoke', 'auth.user.suspend'])
});
/** Permissions granted by default when a role is assigned (inside its ceiling). */
export function roleDefaults(roleCode, ceiling) {
  return ceiling.filter(code => PERMISSIONS[code] && !PERMISSIONS[code].reserved && !EXPLICIT_ONLY.has(code)
    && !(ROLE_EXPLICIT_ONLY[roleCode]?.has(code)));
}

export const MODULES = Object.freeze([
  { id: 'participants', label: 'Participants', match: code => code.startsWith('participants.') },
  { id: 'activities', label: 'Activitats i inscripcions', match: code => code.startsWith('activities.') || code === 'finance.payment.verify' },
  { id: 'fees', label: 'Quotes', match: code => code.startsWith('finance.fee.') || code.startsWith('finance.family.') },
  { id: 'treasury', label: 'Tresoreria', match: code => code.startsWith('finance.') },
  { id: 'administration', label: 'Administració', match: code => code.startsWith('auth.') || code === 'audit.event.read' || code === 'security.incident.manage' },
  { id: 'health', label: 'Salut', match: code => code.startsWith('health.') }
]);
export const moduleOf = code => MODULES.find(module => module.match(code))?.id ?? 'other';

const LABELS = {
  'participants.profile.read': 'Consultar fitxes de participants', 'participants.profile.manage': 'Gestionar fitxes de participants',
  'participants.contact.read': 'Consultar contactes de famílies', 'participants.contact.manage': 'Gestionar contactes de famílies',
  'participants.guardian.manage': 'Gestionar tutors', 'participants.representation.accredit': 'Acreditar representació legal',
  'participants.review.manage': 'Revisió administrativa de participants',
  'activities.read': 'Consultar activitats', 'activities.manage': 'Gestionar activitats de secció',
  'activities.general.manage': 'Gestionar activitats de tot el grup', 'activities.registration.review': 'Revisar inscripcions',
  'activities.registration.contact.read': 'Consultar contacte de qui inscriu', 'finance.payment.verify': 'Verificar pagaments d’activitats',
  'finance.fee.read': 'Consultar quotes', 'finance.fee.status.read': 'Consultar l’estat bàsic de quotes', 'finance.fee.manage': 'Gestionar quotes',
  'finance.fee.payment.review': 'Revisar pagaments de quotes', 'finance.fee.contact.read': 'Consultar contacte de pagaments de quotes',
  'finance.fee.installment.authorize': 'Autoritzar terminis de quotes', 'finance.fee.config.manage': 'Configurar rondes de quotes',
  'finance.family.read': 'Consultar unitats familiars', 'finance.family.manage': 'Gestionar unitats familiars',
  'finance.treasury.read': 'Consultar tresoreria', 'finance.round.manage': 'Gestionar rondes econòmiques', 'finance.round.close': 'Tancar rondes econòmiques',
  'finance.activity.installment.authorize': 'Autoritzar terminis d’activitats', 'finance.position.manage': 'Gestionar comptes i saldos inicials',
  'finance.movement.read': 'Consultar moviments', 'finance.movement.import': 'Importar extractes', 'finance.movement.classify': 'Classificar moviments',
  'finance.bank_description.reveal': 'Veure la descripció bancària original', 'finance.expense.read': 'Consultar despeses',
  'finance.expense.manage': 'Gestionar despeses', 'finance.reimbursement.self_approve': 'Aprovar reemborsaments propis',
  'finance.income.read': 'Consultar ingressos', 'finance.income.manage': 'Gestionar ingressos', 'finance.budget.read': 'Consultar el pressupost',
  'finance.budget.propose': 'Preparar el pressupost', 'finance.budget.approve': 'Aprovar el pressupost',
  'audit.event.read': 'Consultar l’auditoria', 'auth.user.suspend': 'Suspendre comptes per seguretat', 'auth.user.manage': 'Crear i gestionar comptes',
  'auth.role.manage': 'Assignar rols', 'auth.permission.manage': 'Concedir permisos individuals', 'auth.permission.authorize': 'Autoritzar delegacions',
  'auth.permission.provision': 'Tramitar delegacions', 'auth.permission.ratify': 'Ratificar canvis d’autoritat',
  'auth.session.revoke': 'Tancar sessions d’altres persones', 'health.record.read': 'Consultar dades de salut', 'health.grant.manage': 'Concedir accés a salut',
  'security.incident.manage': 'Gestionar incidents de seguretat'
};
export const permissionLabel = code => LABELS[code] ?? code;

// Access packages: UI presets only. `roles[].permissions` null means the role defaults.
export const PACKAGES = Object.freeze([
  { id: 'treasury-full', label: 'Tresoreria — completa', description: 'Tota l’operativa econòmica ordinària.',
    roles: [{ roleCode: 'TREASURY', permissions: null }] },
  { id: 'treasury-read', label: 'Tresoreria — consulta', description: 'Consulta de tresoreria, moviments, ingressos, despeses i pressupost.',
    roles: [{ roleCode: 'TREASURY', permissions: ['finance.treasury.read', 'finance.movement.read', 'finance.income.read', 'finance.expense.read', 'finance.budget.read'] }] },
  { id: 'section-management', label: 'Secció — gestió', description: 'Coordinació d’una secció: participants, activitats i inscripcions.',
    roles: [{ roleCode: 'SECTION_COORDINATOR', permissions: null, sectionRequired: true }] },
  { id: 'section-read', label: 'Secció — consulta', description: 'Consulta de participants i activitats d’una secció, amb caducitat.',
    roles: [{ roleCode: 'SECTION_DELEGATE', permissions: ['participants.profile.read', 'activities.read'], sectionRequired: true }] },
  { id: 'fees', label: 'Quotes', description: 'Gestió de quotes i revisió dels seus pagaments.',
    roles: [{ roleCode: 'TREASURY', permissions: ['finance.fee.read', 'finance.fee.manage', 'finance.fee.payment.review', 'finance.family.read'] }] },
  { id: 'activities', label: 'Activitats', description: 'Activitats i inscripcions d’una secció.',
    roles: [{ roleCode: 'SECTION_COORDINATOR', permissions: ['activities.read', 'activities.manage', 'activities.registration.review'], sectionRequired: true }] },
  { id: 'admissions', label: 'Noves altes', description: 'Preparat per a 3.5H.2: encara sense permisos propis.', roles: [], disabled: true },
  { id: 'secretary', label: 'Secretaria', description: 'Participants, revisió administrativa i alta de comptes.',
    roles: [{ roleCode: 'SECRETARY', permissions: null }] },
  { id: 'user-administration', label: 'Administració d’usuaris', description: 'Crear comptes, assignar rols i permisos i tancar sessions. Sense accés a dades funcionals.',
    roles: [{ roleCode: 'TECH_ADMIN', permissions: ['auth.user.manage', 'auth.role.manage', 'auth.permission.manage', 'auth.session.revoke', 'auth.permission.provision'] }] }
]);
