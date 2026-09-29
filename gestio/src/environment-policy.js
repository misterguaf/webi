// Single, auditable place for environment and synthetic-data fences (audit M7).
//
// Opening production is a deliberate change to THIS module, reviewed against the production
// go-live checklist (Access/MFA, remote EU D1/R2, legal texts and retention, real mail, backups).
// Services must not hard-code DEMO markers, test domains or environment checks elsewhere.

/** @typedef {'local-synthetic'|'test'|'production'} RuntimeEnvironment */

// Data accepted by Gestió services, independent of the runtime: while SYNTHETIC_ONLY, every intake,
// notification and privileged reference must carry a synthetic marker, even if a production
// runtime were misconfigured. There is intentionally no other value yet.
export const DATA_MODE = 'SYNTHETIC_ONLY';

export const ENVIRONMENTS = Object.freeze({
  'local-synthetic': Object.freeze({ appEnv: 'development', devIdentityProvider: true, portalIntake: true, localHostOnly: true }),
  test: Object.freeze({ appEnv: 'test', devIdentityProvider: true, portalIntake: true, localHostOnly: true }),
  // Production runtime exists for Access login only; family intake stays closed until go-live.
  production: Object.freeze({ appEnv: 'production', devIdentityProvider: false, portalIntake: false, localHostOnly: false })
});

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

/** @param {{APP_ENV?: string}} env @returns {RuntimeEnvironment} */
export function runtimeEnvironment(env) {
  switch (env?.APP_ENV) {
    case 'development': return 'local-synthetic';
    case 'test': return 'test';
    case 'production': return 'production';
    default: throw new Error('APP_ENV invalid');
  }
}

/** Throws on any configuration that could expose the dev identity provider or run without D1. */
export function assertRuntime(env) {
  const name = runtimeEnvironment(env);
  if (!ENVIRONMENTS[name].devIdentityProvider && env.DEV_IDENTITY_PROVIDER === 'enabled')
    throw new Error('DEV_IDENTITY_PROVIDER cannot be enabled in production');
  if (!env.DB) throw new Error('D1 binding missing');
  if (name === 'production' && (!env.ACCESS_ISSUER || !env.ACCESS_AUDIENCE)) throw new Error('Access issuer/audience missing');
  return name;
}

/** @param {URL} url */
export const isLocalHost = url => LOCAL_HOSTS.has(url.hostname);

/** Non-production runtimes only answer on loopback hosts. */
export function hostAllowed(env, url) {
  return !ENVIRONMENTS[runtimeEnvironment(env)].localHostOnly || isLocalHost(url);
}

export function devIdentityEnabled(env, url) {
  return ENVIRONMENTS[runtimeEnvironment(env)].devIdentityProvider && env.DEV_IDENTITY_PROVIDER === 'enabled' && isLocalHost(url);
}

// The portal reaches Gestió only through the PortalIntake service binding; intake is closed in production.
export function portalIntakeEnabled(env) {
  try { return ENVIRONMENTS[runtimeEnvironment(env)].portalIntake && !!env.DB && !!env.EVIDENCE_STORAGE; }
  catch { return false; }
}

// ---- Synthetic data fences (DATA_MODE = SYNTHETIC_ONLY) ----

const SYNTHETIC_EMAIL_DOMAIN = '@example.test';
const SYNTHETIC_EVIDENCE_MARKER = 'synthetic';

export const synthetic = Object.freeze({
  /** Notification and receipt addresses must belong to the reserved test domain. */
  email: value => typeof value === 'string' && value.toLowerCase().endsWith(SYNTHETIC_EMAIL_DOMAIN),
  /** Uploaded evidence must declare itself synthetic in its first KiB. */
  evidence: bytes => new TextDecoder('latin1').decode(bytes.slice(0, Math.min(bytes.length, 1024)))
    .toLowerCase().includes(SYNTHETIC_EVIDENCE_MARKER),
  evidenceKeyPrefix: 'synthetic/',
  /** Organisational references (delegations, family groups) are demo references. */
  reference: (value, { min = 6, max = 80 } = {}) =>
    typeof value === 'string' && new RegExp(`^DEMO-[A-Z0-9-]{${min},${max}}$`).test(value),
  /** Legal text versions accepted at intake; real versions arrive with the approved legal texts. */
  terms: Object.freeze({
    activityParticipation: 'DEMO-3A-PARTICIPATION-V1',
    activityPrivacy: 'DEMO-3A-PRIVACY-NOTICE-V1',
    feePrivacy: 'DEMO-3B-PRIVACY-NOTICE-V1'
  }),
  /** Normalised name tokens that only mark fixtures as synthetic; they never count as a name match. */
  nameMarkers: Object.freeze(['ficticio', 'ficticia', 'fictici', 'demo']),
  /** Justification stored with administrative grants while no real governance record exists. */
  adminJustification: 'SYNTHETIC_PHASE_2A'
});
