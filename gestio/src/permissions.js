// Explicit permission catalogue. Every permission the policy engine accepts is declared here
// with the kind of resource it governs, so an evaluation can never silently widen scope.
//
// GLOBAL  — group-wide resource without a section (users, audit, round configuration, GENERAL
//           activities). Evaluated without sectionId. Holders need an unscoped (group-wide) role
//           assignment unless `scopedHolders` is 'ALLOWED', which is a deliberate product decision.
// SCOPED  — resource owned by a section (participants, section activities, fee obligations,
//           payments). Every evaluation must say which form it is:
//             { sectionId }          one resource in one section;
//             { mode: 'list' }       returns the authorised sections (null = all) for a listing;
//             { mode: 'all-sections' } group-wide operation that requires unscoped authority.
//           Missing scope information fails closed with SCOPE_REQUIRED.
//
// A third CONTEXTUAL kind is intentionally not introduced: permissions such as finance.fee.read
// are SCOPED, and their group-wide operations (rounds, family groups) use mode 'all-sections'.

/** @typedef {'GLOBAL'|'SCOPED'} PermissionKind */
/** @typedef {{kind: PermissionKind, scopedHolders?: 'ALLOWED'|'DENIED', delegable?: boolean, financialDelegation?: boolean, reserved?: boolean, note?: string}} PermissionDefinition */

/** @type {Readonly<Record<string, Readonly<PermissionDefinition>>>} */
export const PERMISSIONS = Object.freeze({
  'participants.profile.read': { kind: 'SCOPED', delegable: true },
  'participants.profile.manage': { kind: 'SCOPED', delegable: true },
  'participants.contact.read': { kind: 'SCOPED', delegable: true,
    note: 'Consulting contact values is audited; values never reach logs or audit metadata.' },
  'participants.contact.manage': { kind: 'SCOPED', delegable: true },
  'participants.guardian.manage': { kind: 'SCOPED', delegable: true },
  'participants.representation.accredit': { kind: 'GLOBAL',
    note: 'Marking legal representation as documentarily accredited: Secretaria or general coordination.' },
  'participants.review.manage': { kind: 'GLOBAL', note: 'Secretaria administrative review queue and change requests.' },
  'health.record.read': { kind: 'SCOPED', note: 'Section derived from participantId; also needs a health grant.' },

  'activities.read': { kind: 'SCOPED', note: 'Any scope also reads GENERAL activities (3.5D); managing them needs activities.general.manage.' },
  'activities.manage': { kind: 'SCOPED' },
  'activities.general.manage': { kind: 'GLOBAL', scopedHolders: 'ALLOWED',
    note: 'Product decision 2026-09-29: section coordinators may create, edit, publish and close GENERAL activities.' },
  'activities.registration.review': { kind: 'SCOPED', delegable: true },
  'activities.registration.contact.read': { kind: 'SCOPED', delegable: true,
    note: 'Submitter name, phone and e-mail of a registration, on demand and audited (3.5F). Not participants.contact.read.' },
  'finance.payment.verify': { kind: 'SCOPED', delegable: true, financialDelegation: true },

  'finance.fee.read': { kind: 'SCOPED' },
  'finance.fee.status.read': { kind: 'SCOPED', note: 'Basic PAID/PARTIAL/PENDING/ISSUE only, by current section.' },
  'finance.fee.manage': { kind: 'SCOPED' },
  'finance.fee.payment.review': { kind: 'SCOPED', delegable: true, financialDelegation: true },
  'finance.fee.contact.read': { kind: 'SCOPED', delegable: true, financialDelegation: true,
    note: 'Submitter name, phone and e-mail of a fee payment, on demand and audited (3.5G.1A). Never in listings.' },
  'finance.fee.installment.authorize': { kind: 'SCOPED', note: 'Also requires a current TREASURY or GROUP_COORDINATOR role.' },
  'finance.fee.config.manage': { kind: 'GLOBAL' },

  'audit.event.read': { kind: 'GLOBAL' },
  'auth.user.suspend': { kind: 'GLOBAL' },
  'auth.user.manage': { kind: 'GLOBAL' },
  'auth.role.manage': { kind: 'GLOBAL' },
  'auth.permission.manage': { kind: 'GLOBAL' },
  'auth.permission.authorize': { kind: 'SCOPED', note: 'Authority named in a delegation; must cover its section.' },
  'auth.permission.provision': { kind: 'GLOBAL' },
  'auth.permission.ratify': { kind: 'GLOBAL' },
  'health.grant.manage': { kind: 'GLOBAL' },
  'security.incident.manage': { kind: 'GLOBAL' },

  'finance.fee.reconcile': { kind: 'GLOBAL', reserved: true, note: 'Legacy phase 1 fixture; no route uses it.' },
  'crm.contact.read': { kind: 'GLOBAL', reserved: true, note: 'No CRM module exists yet.' },
  'infra.status.read': { kind: 'GLOBAL', reserved: true, note: 'No infrastructure status route exists yet.' }
});

/** @param {string} code */
export function permissionDefinition(code) {
  return Object.hasOwn(PERMISSIONS, code) ? PERMISSIONS[code] : null;
}

// Financial delegation (TREASURY.md §25.3, 3.5G.1A): for these permissions a ratified, expiring,
// capability-limited delegation is itself the authority; no role ceiling is needed or consulted for
// the delegation, and no role (in particular SECTION_DELEGATE) grants them by being held.
export const FINANCIAL_DELEGATIONS = Object.freeze(Object.entries(PERMISSIONS)
  .filter(([, definition]) => definition.financialDelegation).map(([code]) => code));

// Evaluation modes accepted for SCOPED permissions.
export const MODES = Object.freeze(['list', 'all-sections']);
