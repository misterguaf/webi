// Identity provisioning (audit remediation, batch 3): create people who may use Gestió, invite
// their Cloudflare Access identity by verified e-mail and revoke identities — without manual SQL
// and without public self-registration. Roles and grants keep their existing endpoints.
import * as identities from '../domains/auth/repository.js';
import { conditionalStatement, statement } from '../domains/audit/repository.js';
import { identityIssuer, synthetic } from '../environment-policy.js';
import { afterClause, pageRequest, pageResult } from '../pagination.js';
import { AppError, requireFresh, requirePermission, requireUuid } from './common.js';

const DAY = 24 * 60 * 60 * 1000;
const audit = (db, context, requestId, action, resourceType, resourceId, now) => statement(db, { requestId,
  actorUserId: context.userId, sessionId: context.sessionId, action, resourceType, resourceId, occurredAt: now });
const manage = (db, context, requestId, resourceId = null) =>
  requirePermission(db, context, requestId, 'auth.user.manage', { resourceType: 'app_user', resourceId });
function notSelf(context, userId) { if (context.userId === userId) throw new AppError(403, 'self_change_forbidden'); }

export async function createUser(db, context, session, requestId, input, now = Date.now()) {
  await manage(db, context, requestId); requireFresh(session, now);
  if (!input || typeof input !== 'object' || Object.keys(input).some(key => key !== 'displayName')) throw new AppError(400, 'invalid_user');
  const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : '';
  if (displayName.length < 2 || displayName.length > 120 || !synthetic.personName(displayName)) throw new AppError(400, 'invalid_user');
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare(`INSERT INTO app_user(id,display_name,status,created_at,updated_at) VALUES(?,?,'ACTIVE',?,?)`).bind(id, displayName, now, now),
    audit(db, context, requestId, 'USER_CREATED', 'app_user', id, now)
  ]);
  return { id, status: 'ACTIVE' };
}

export async function listUsers(db, context, requestId, params) {
  await manage(db, context, requestId);
  const page = pageRequest(params, ['string', 'string']);
  const after = afterClause(['display_name', 'id'], 'ASC');
  const rows = (await db.prepare(`SELECT id,display_name,status,created_at FROM app_user
    ${page.after ? 'WHERE ' + after.sql : ''} ORDER BY display_name,id LIMIT ?`)
    .bind(...(page.after ? after.values(page.after) : []), page.limit + 1).all()).results;
  const result = pageResult(rows, page.limit, row => [row.display_name, row.id]);
  return { users: result.items, nextCursor: result.nextCursor };
}

export async function userDetail(db, context, requestId, userId, now = Date.now()) {
  requireUuid(userId);
  await manage(db, context, requestId, userId);
  const user = await db.prepare('SELECT id,display_name,status,created_at,updated_at FROM app_user WHERE id=?').bind(userId).first();
  if (!user) throw new AppError(404, 'not_found');
  const roles = (await db.prepare(`SELECT ur.id,ur.role_code,s.code AS section_code,ur.valid_from,ur.expires_at
    FROM user_role ur LEFT JOIN section s ON s.id=ur.section_id WHERE ur.user_id=? AND ur.revoked_at IS NULL
    AND (ur.expires_at IS NULL OR ur.expires_at>?) ORDER BY ur.role_code`).bind(userId, now).all()).results;
  const grants = (await db.prepare(`SELECT id,permission_code,valid_from,expires_at FROM user_permission_grant
    WHERE user_id=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?) ORDER BY permission_code`).bind(userId, now).all()).results;
  const linked = (await db.prepare(`SELECT id,issuer,verified_email,last_seen_at FROM auth_identity
    WHERE user_id=? AND revoked_at IS NULL ORDER BY issuer,id`).bind(userId).all()).results;
  const invitations = (await db.prepare(`SELECT id,issuer,email,created_at,expires_at FROM auth_identity_invitation
    WHERE user_id=? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>? ORDER BY created_at DESC`)
    .bind(userId, now).all()).results;
  return { user, roles, grants, identities: linked, invitations };
}

export async function inviteIdentity(db, context, session, requestId, env, userId, input, now = Date.now()) {
  requireUuid(userId);
  await manage(db, context, requestId, userId); requireFresh(session, now); notSelf(context, userId);
  if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['email', 'expiresAt'].includes(key))) throw new AppError(400, 'invalid_invitation');
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email) || email.length > 254 || !synthetic.email(email)) throw new AppError(400, 'invalid_invitation');
  const expiresAt = input.expiresAt ?? now + 7 * DAY;
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + 30 * DAY) throw new AppError(400, 'invalid_invitation');
  const user = await db.prepare("SELECT status FROM app_user WHERE id=?").bind(userId).first();
  if (!user) throw new AppError(404, 'not_found');
  if (user.status !== 'ACTIVE') throw new AppError(409, 'user_not_active');
  const issuer = identityIssuer(env), id = crypto.randomUUID();
  try {
    await db.batch([
      db.prepare(`INSERT INTO auth_identity_invitation(id,user_id,issuer,email,created_by,created_at,expires_at)
        VALUES(?,?,?,?,?,?,?)`).bind(id, userId, issuer, email, context.userId, now, expiresAt),
      audit(db, context, requestId, 'IDENTITY_INVITED', 'auth_identity_invitation', id, now)
    ]);
  } catch (error) {
    if (/UNIQUE/.test(error?.message ?? '')) throw new AppError(409, 'invitation_exists');
    throw error;
  }
  return { id, expiresAt };
}

export async function revokeInvitation(db, context, session, requestId, userId, invitationId, now = Date.now()) {
  requireUuid(userId); requireUuid(invitationId);
  await manage(db, context, requestId, userId); requireFresh(session, now);
  const open = await db.prepare(`SELECT id FROM auth_identity_invitation WHERE id=? AND user_id=?
    AND consumed_at IS NULL AND revoked_at IS NULL`).bind(invitationId, userId).first();
  if (!open) throw new AppError(404, 'not_found');
  await db.batch([
    db.prepare(`UPDATE auth_identity_invitation SET revoked_at=?,revoked_by=? WHERE id=? AND user_id=?
      AND consumed_at IS NULL AND revoked_at IS NULL`).bind(now, context.userId, invitationId, userId),
    audit(db, context, requestId, 'IDENTITY_INVITATION_REVOKED', 'auth_identity_invitation', invitationId, now)
  ]);
}

// Revoking an identity also ends that person's sessions: the binding is what authenticates them.
export async function revokeIdentity(db, context, session, requestId, userId, identityId, now = Date.now()) {
  requireUuid(userId); requireUuid(identityId);
  await manage(db, context, requestId, userId); requireFresh(session, now); notSelf(context, userId);
  const found = await db.prepare('SELECT id FROM auth_identity WHERE id=? AND user_id=? AND revoked_at IS NULL').bind(identityId, userId).first();
  if (!found) throw new AppError(404, 'not_found');
  await db.batch([
    db.prepare('UPDATE auth_identity SET revoked_at=?,revoked_by=? WHERE id=? AND revoked_at IS NULL').bind(now, context.userId, identityId),
    db.prepare("UPDATE app_session SET revoked_at=?,revoke_reason='IDENTITY_REVOKED' WHERE user_id=? AND revoked_at IS NULL").bind(now, userId),
    audit(db, context, requestId, 'IDENTITY_REVOKED', 'auth_identity', identityId, now)
  ]);
}

/**
 * Called after a verified Access login whose (issuer, subject) is unknown: binds it to the
 * user invited with the same verified e-mail. Returns the user or null (no invitation).
 */
export async function claimInvitedIdentity(db, requestId, { issuer, subject, email }, now = Date.now()) {
  if (typeof email !== 'string' || !email) return null;
  if (await identities.identityBySubject(db, issuer, subject)) return null; // revoked or already bound: no silent re-link
  const invitation = await identities.openInvitation(db, { issuer, email: email.toLowerCase(), now });
  if (!invitation) return null;
  const identityId = crypto.randomUUID();
  await db.batch([
    ...identities.claimInvitationStatements(db, { invitationId: invitation.id, identityId, issuer, subject, email: email.toLowerCase(), now }),
    conditionalStatement(db, { requestId, actorUserId: invitation.user_id, action: 'IDENTITY_LINKED', resourceType: 'auth_identity',
      resourceId: identityId, occurredAt: now }, 'SELECT 1 FROM auth_identity WHERE id=?', [identityId])
  ]);
  return identities.findIdentityUser(db, issuer, subject);
}
