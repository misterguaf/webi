// PortalIntake: the only interface the public family portal has into Gestió (audit A1).
//
// It is exported as a named Worker entrypoint and reached exclusively through a service binding
// (`[[services]] entrypoint = "PortalIntake"` in portal/wrangler.toml); it is not routed from
// Gestió's public fetch handler. The portal Worker has no D1 or R2 binding at all.
//
// Contract v1 — POST only, JSON only:
//   /v1/catalog        -> { ok, activitats, quota }        published activities + open round instructions
//   /v1/registrations  -> { ok }                           activity registration (+ optional evidence)
//   /v1/fees           -> { ok, reference }                annual-fee declaration with evidence
//   /v1/admissions     -> { ok }                           new-membership request from the existing public form (3.5H.2)
// Errors: { ok:false, code } with the service status. Matching outcome, candidates and internal
// identifiers never cross this boundary (same response for clear, ambiguous and unknown people).
import { publicActivities } from './services/activity-service.js';
import { submitRegistration } from './services/registration-service.js';
import { publicRound, submitFee } from './services/annual-fee-service.js';
import { submitAdmission } from './services/admissions-service.js';
import { AppError } from './services/common.js';
import { portalIntakeEnabled, synthetic } from './environment-policy.js';

export const INTAKE_VERSION = 'v1';
const MAX_BODY = 8 * 1024 * 1024;
const REGISTRATION_KEYS = new Set(['publicCode', 'participantName', 'birthDate', 'submittedByName', 'contactPhone',
  'sectionCode', 'transportCode', 'receiptEmail', 'idempotencyKey', 'evidence', 'participationAccepted', 'privacyAcknowledged']);
const FEE_KEYS = new Set(['roundCode', 'children', 'submittedByName', 'contactPhone', 'receiptEmail', 'declaredAmountCents',
  'privacyAcknowledged', 'idempotencyKey', 'evidence']);

const reply = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});

async function readBody(request) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) throw new AppError(415, 'invalid_request');
  if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY) throw new AppError(413, 'body_too_large');
  const text = await request.text();
  if (text.length > MAX_BODY) throw new AppError(413, 'body_too_large');
  let body;
  try { body = JSON.parse(text); } catch { throw new AppError(400, 'invalid_request'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError(400, 'invalid_request');
  return body;
}

const onlyKeys = (body, allowed, code) => {
  if (Object.keys(body).some(key => !allowed.has(key))) throw new AppError(400, code);
};

async function registration(env, body, requestId) {
  onlyKeys(body, REGISTRATION_KEYS, 'invalid_registration');
  if (body.participationAccepted !== true || body.privacyAcknowledged !== true) throw new AppError(400, 'invalid_registration');
  const fields = Object.fromEntries(Object.entries(body)
    .filter(([key]) => key !== 'participationAccepted' && key !== 'privacyAcknowledged'));
  // Legal text versions are decided by Gestió's policy, never by the caller.
  await submitRegistration(env.DB, env.EVIDENCE_STORAGE, { ...fields,
    participationTermsVersion: synthetic.terms.activityParticipation,
    privacyNoticeVersion: synthetic.terms.activityPrivacy }, requestId);
  return { ok: true };
}

async function fee(env, body, requestId) {
  onlyKeys(body, FEE_KEYS, 'invalid_fee_submission');
  const result = await submitFee(env.DB, env.EVIDENCE_STORAGE, { ...body,
    privacyNoticeVersion: synthetic.terms.feePrivacy }, requestId);
  return { ok: true, reference: result.reference };
}

export const PortalIntake = {
  /** @param {Request} request @param {any} env */
  async fetch(request, env) {
    const requestId = crypto.randomUUID();
    try {
      const url = new URL(request.url);
      if (!portalIntakeEnabled(env)) throw new AppError(503, 'LOCAL_SYNTHETIC_ONLY');
      const route = { [`/${INTAKE_VERSION}/catalog`]: 'catalog', [`/${INTAKE_VERSION}/registrations`]: 'registration',
        [`/${INTAKE_VERSION}/fees`]: 'fee', [`/${INTAKE_VERSION}/admissions`]: 'admission' }[url.pathname];
      if (!route) throw new AppError(404, 'not_found');
      if (request.method !== 'POST') throw new AppError(405, 'method_not_allowed');
      if (route === 'catalog') {
        return reply(200, { ok: true, activitats: await publicActivities(env.DB), quota: await publicRound(env.DB) });
      }
      const body = await readBody(request);
      if (route === 'admission') return reply(202, await submitAdmission(env.DB, body, requestId));
      return reply(202, route === 'registration' ? await registration(env, body, requestId) : await fee(env, body, requestId));
    } catch (error) {
      if (error instanceof AppError) return reply(error.status, { ok: false, code: error.code });
      console.error('gestio intake failure', { requestId, name: error?.name });
      return reply(500, { ok: false, code: 'internal_error' });
    }
  }
};
