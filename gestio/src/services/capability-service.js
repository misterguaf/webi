// Safe projection of what the current user may do, so the UI requests only modules it can use.
// It is advisory: every operation is still authorised server-side by authorize()/requirePermission().
// It writes no audit events and exposes only permission outcomes and section codes.
import { decideScope } from '../policy.js';
import { effectiveGrants } from '../domains/organization/repository.js';

export const CAPABILITIES_VERSION = 1;

/**
 * @typedef {{all: boolean, sections: Array<{id: string, code: string}>}} ScopeCapability
 * @typedef {ScopeCapability|null} MaybeScope
 */

/**
 * @param {any} db
 * @param {{userId: string}} context
 */
export async function capabilities(db, context, now = Date.now()) {
  const grants = await effectiveGrants(db, context.userId, now);
  const sections = (await db.prepare('SELECT id,code FROM section ORDER BY code').all()).results;
  const codeOf = new Map(sections.map(row => [row.id, row.code]));
  const roles = new Set((await db.prepare(`SELECT role_code FROM user_role WHERE user_id=? AND revoked_at IS NULL
    AND valid_from<=? AND (expires_at IS NULL OR expires_at>?)`).bind(context.userId, now, now).all()).results
    .map(row => row.role_code));

  /** @param {string} permission @returns {MaybeScope} */
  const scope = permission => {
    const decision = decideScope(permission, grants.get(permission) ?? [], { mode: 'list' });
    if (!decision.allow) return null;
    if (decision.sections === null) return { all: true, sections: [] };
    return { all: false, sections: decision.sections.filter(id => codeOf.has(id))
      .map(id => ({ id, code: /** @type {string} */ (codeOf.get(id)) })).sort((a, b) => a.code.localeCompare(b.code)) };
  };
  /** @param {string} permission */
  const global = permission => decideScope(permission, grants.get(permission) ?? []).allow;
  const installmentRole = roles.has('TREASURY') || roles.has('GROUP_COORDINATOR');

  return {
    version: CAPABILITIES_VERSION,
    // Section reference catalogue (id ↔ code, no personal data) so forms can send section ids.
    sections: sections.map(row => ({ id: row.id, code: row.code })),
    participants: {
      read: scope('participants.profile.read'),
      manage: scope('participants.profile.manage'),
      readContacts: scope('participants.contact.read'),
      manageContacts: scope('participants.contact.manage'),
      manageGuardians: scope('participants.guardian.manage'),
      accredit: global('participants.representation.accredit'),
      review: global('participants.review.manage')
    },
    activities: {
      read: scope('activities.read'),
      manage: scope('activities.manage'),
      manageGeneral: global('activities.general.manage'),
      reviewRegistrations: scope('activities.registration.review'),
      verifyPayments: scope('finance.payment.verify')
    },
    // 3.5F Inscripcions (REGISTRATIONS.md §4.3). reviewGlobal = group-wide registration review.
    registrations: {
      review: scope('activities.registration.review'),
      reviewGlobal: scope('activities.registration.review')?.all === true,
      readContacts: scope('activities.registration.contact.read'),
      verifyPayments: scope('finance.payment.verify')
    },
    fees: {
      status: scope('finance.fee.status.read'),
      read: scope('finance.fee.read'),
      manage: scope('finance.fee.manage'),
      reviewPayments: scope('finance.fee.payment.review'),
      readContacts: scope('finance.fee.contact.read'),
      authorizeInstallments: installmentRole ? scope('finance.fee.installment.authorize') : null,
      configure: global('finance.fee.config.manage')
    },
    administration: {
      audit: global('audit.event.read'),
      suspendUsers: global('auth.user.suspend'),
      manageUsers: global('auth.user.manage'),
      manageRoles: global('auth.role.manage'),
      managePermissions: global('auth.permission.manage'),
      provisionDelegations: global('auth.permission.provision'),
      ratifyDelegations: global('auth.permission.ratify'),
      manageHealthGrants: global('health.grant.manage'),
      manageIncidents: global('security.incident.manage')
    }
  };
}
