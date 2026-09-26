import { IDLE_MS } from './auth.js';
import { sessionActive } from './domains/auth/repository.js';
import { effectiveSections } from './domains/organization/repository.js';
import { getSection, listScoped, findScoped } from './domains/participants/repository.js';
import { hasValidGrant } from './domains/health/repository.js';
const KNOWN = new Set(['participants.profile.read','health.record.read','finance.fee.reconcile','crm.contact.read','auth.user.suspend','infra.status.read',
  'audit.event.read','auth.role.manage','auth.permission.manage','health.grant.manage','auth.user.manage','security.incident.manage',
  'activities.read','activities.manage','activities.general.manage','activities.registration.review','finance.payment.verify',
  'auth.permission.authorize','auth.permission.provision','auth.permission.ratify']);

export async function authorize(db, context, { permission, sectionId = null, participantId = null, purpose = null }, now = Date.now()) {
  if (!context?.userId || !context?.sessionId || context.status !== 'ACTIVE' || !KNOWN.has(permission)) return { allow: false, reason: 'INVALID_CONTEXT' };
  const active = await sessionActive(db,context,now,IDLE_MS);
  if (!active) return { allow:false, reason:'INVALID_SESSION' };
  if (permission === 'health.record.read' && (!participantId || !purpose)) return { allow: false, reason: 'HEALTH_CONTEXT_REQUIRED' };
  if (permission === 'health.record.read') {
    const participant = await getSection(db,participantId);
    if (!participant) return { allow: false, reason: 'NO_PARTICIPANT' };
    sectionId = participant.current_section_id;
  }
  const scopes = await effectiveSections(db,context.userId,permission,now);
  if (!scopes.length) return { allow: false, reason: 'NO_EFFECTIVE_PERMISSION' };
  if (sectionId && !scopes.includes(null) && !scopes.includes(sectionId)) return { allow: false, reason: 'OUT_OF_SCOPE' };
  if (permission === 'health.record.read') {
    const grant = await hasValidGrant(db,{userId:context.userId,participantId,purpose,now});
    if (!grant) return { allow: false, reason: 'NO_HEALTH_GRANT' };
  }
  return { allow: true, reason: 'ALLOW', sections: scopes.includes(null) ? null : [...new Set(scopes)] };
}

export async function listParticipants(db, decision) {
  if (!decision.allow) return [];
  return listScoped(db,decision);
}

export async function findParticipant(db, decision, id) {
  if (!decision.allow) return null;
  return findScoped(db,decision,id);
}
