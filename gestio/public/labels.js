// Human labels shared by legacy views. Technical codes never reach the UI unlabelled when a label exists.
const statusLabel = { DRAFT: 'Esborrany', PUBLISHED: 'Publicada', CLOSED: 'Tancada', GENERAL: 'Tot el grup',
  NEEDS_PARTICIPANT_REVIEW: 'Pendent de vincular', AWAITING_PAYMENT_REVIEW: 'Pendent de pagament',
  CONFIRMED: 'Confirmada', REJECTED: 'Rebutjada', WITHDRAWN: 'Retirada', CLEAR: 'Coincidència clara', AMBIGUOUS: 'Coincidència ambigua',
  NONE: 'Sense coincidència', RESOLVED: 'Vinculada', PENDING_REVIEW: 'Pendent de revisió', VERIFIED: 'Verificat', ISSUE: 'Incidència' };
export const label = value => statusLabel[value] ?? value;
// 3.5I: one place for role, section and account-state names shown in the shell and the account screen.
export const ROLE_LABELS = Object.freeze({ GROUP_COORDINATOR: 'Coordinació general', SECTION_COORDINATOR: 'Coordinació de secció',
  SECTION_DELEGATE: 'Delegació de secció', TREASURY: 'Tresoreria', SECRETARY: 'Secretaria', CRM_MANAGER: 'CRM', TECH_ADMIN: 'Administració tècnica' });
export const SECTION_LABELS = Object.freeze({ MANADA: 'Manada', TROPA: 'Tropa', ESCOLTA: 'Esculta', CLAN: 'Clan' });
export const ACCOUNT_STATUS_LABELS = Object.freeze({ ACTIVE: 'Activa', DISABLED: 'Desactivada', SECURITY_BLOCKED: 'Bloquejada per seguretat' });
