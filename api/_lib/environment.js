// @ts-check

/** Entorns que han de fallar tancats davant qualsevol egress real. */
const DEVELOPMENT_ENVIRONMENTS = new Set(["development", "dev", "local", "test", "staging"]);
const SAFE_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "sheets.invalid"]);

/** @param {Record<string, unknown>} env */
export function environmentName(env = {}) {
  return String(env.APP_ENV || "").trim().toLowerCase();
}

/** @param {Record<string, unknown>} env */
export function isDevelopment(env = {}) {
  return DEVELOPMENT_ENVIRONMENTS.has(environmentName(env));
}

/**
 * En producció, un origen absent o que no siga exactament un origen HTTPS
 * configura un rebuig tancat. En local es conserva el comportament anterior.
 * @param {string | null | undefined} received
 * @param {string | null | undefined} configured
 * @param {Record<string, unknown>} env
 */
export function isAllowedOrigin(received, configured, env = {}) {
  const expected = String(configured || "").trim();
  if (environmentName(env) === "production") {
    try {
      const parsed = new URL(expected);
      if (parsed.protocol !== "https:" || parsed.origin !== expected) return false;
    } catch (_) {
      return false;
    }
  }
  return !expected || received === expected;
}

/**
 * Impedix que un procés local o de proves envie dades a un servei real per
 * accident. En desenvolupament només es permeten hosts locals/reservats. Un
 * egress extern necessita les dues condicions explícites: opt-in i allowlist
 * exacta d'orígens. No s'admeten comodins.
 *
 * @param {string} rawUrl
 * @param {Record<string, unknown>} env
 */
export function assertAllowedEgress(rawUrl, env = {}) {
  if (!isDevelopment(env)) return;

  let target;
  try {
    target = new URL(rawUrl);
  } catch (_) {
    throw blocked("URL d'egress no vàlida");
  }

  if (SAFE_HOSTS.has(target.hostname)) return;

  const optedIn = String(env.ALLOW_REAL_EGRESS || "").toLowerCase() === "true";
  const allowlist = String(env.DEV_EGRESS_ALLOWLIST || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (!optedIn || !allowlist.includes(target.origin)) {
    throw blocked("Egress real bloquejat en desenvolupament");
  }
}

/** @param {string} message */
function blocked(message) {
  const error = new Error(message);
  // @ts-expect-error codi operatiu propi, consumit pels handlers.
  error.code = "EGRESS_BLOCKED";
  return error;
}

export { SAFE_HOSTS };
