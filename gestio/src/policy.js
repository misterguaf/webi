import { IDLE_MS } from './auth.js';
import { sessionActive } from './domains/auth/repository.js';
import { effectiveSections } from './domains/organization/repository.js';
import { getSection, listScoped, findScoped } from './domains/participants/repository.js';
import { hasValidGrant } from './domains/health/repository.js';
import { MODES, permissionDefinition } from './permissions.js';

/**
 * @typedef {{userId?: string, sessionId?: string, status?: string}} AuthContext
 * @typedef {{permission: string, sectionId?: string|null, participantId?: string|null, purpose?: string|null,
 *   mode?: 'list'|'all-sections'|null}} AuthRequest
 * @typedef {{allow: boolean, reason: string, sections?: string[]|null}} AuthDecision
 */

const deny = reason => ({ allow: false, reason });

// Pure scope decision, shared with the capabilities projection so the UI and the policy
// cannot drift. `scopes` are the effective role/delegation sections (null = group-wide).
/**
 * @param {string} permission
 * @param {Array<string|null>} scopes
 * @param {{sectionId?: string|null, mode?: string|null}} request
 * @returns {AuthDecision}
 */
export function decideScope(permission, scopes, { sectionId = null, mode = null } = {}) {
  const definition = permissionDefinition(permission);
  if (!definition) return deny('INVALID_CONTEXT');
  if (mode !== null && !MODES.includes(mode)) return deny('INVALID_EVALUATION');
  const global = scopes.includes(null);
  if (definition.kind === 'GLOBAL') {
    if (sectionId || mode) return deny('INVALID_EVALUATION');
    if (!scopes.length) return deny('NO_EFFECTIVE_PERMISSION');
    if (!global && definition.scopedHolders !== 'ALLOWED') return deny('GROUP_SCOPE_REQUIRED');
    return { allow: true, reason: 'ALLOW', sections: null };
  }
  if (sectionId && mode) return deny('INVALID_EVALUATION');
  if (!sectionId && !mode) return deny('SCOPE_REQUIRED');
  if (!scopes.length) return deny('NO_EFFECTIVE_PERMISSION');
  if (mode === 'all-sections') return global ? { allow: true, reason: 'ALLOW', sections: null } : deny('GROUP_SCOPE_REQUIRED');
  if (sectionId && !global && !scopes.includes(sectionId)) return deny('OUT_OF_SCOPE');
  return { allow: true, reason: 'ALLOW', sections: global ? null : [...new Set(/** @type {string[]} */ (scopes))] };
}

/**
 * @param {any} db
 * @param {AuthContext} context
 * @param {AuthRequest} request
 * @returns {Promise<AuthDecision>}
 */
export async function authorize(db, context, { permission, sectionId = null, participantId = null, purpose = null, mode = null }, now = Date.now()) {
  if (!context?.userId || !context?.sessionId || context.status !== 'ACTIVE' || !permissionDefinition(permission)) return deny('INVALID_CONTEXT');
  const active = await sessionActive(db,context,now,IDLE_MS);
  if (!active) return deny('INVALID_SESSION');
  if (permission === 'health.record.read') {
    if (!participantId || !purpose || sectionId || mode) return deny('HEALTH_CONTEXT_REQUIRED');
    const participant = await getSection(db,participantId);
    if (!participant) return deny('NO_PARTICIPANT');
    sectionId = participant.current_section_id;
  }
  const scopes = await effectiveSections(db,context.userId,permission,now);
  const decision = decideScope(permission, scopes, { sectionId, mode });
  if (!decision.allow) return decision;
  if (permission === 'health.record.read') {
    const grant = await hasValidGrant(db,{userId:context.userId,participantId,purpose,now});
    if (!grant) return deny('NO_HEALTH_GRANT');
  }
  return decision;
}

export async function listParticipants(db, decision) {
  if (!decision.allow) return [];
  return listScoped(db,decision);
}

export async function findParticipant(db, decision, id) {
  if (!decision.allow) return null;
  return findScoped(db,decision,id);
}
