// @ts-check

import { assertAllowedEgress, isDevelopment } from "./environment.js";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TEST_PASS_TOKEN = "synthetic-turnstile-pass";

/**
 * Adaptador preparatorio de Turnstile. No está conectado todavía a los
 * formularios: esa activación necesita widget, CSP, secrets y tests E2E.
 *
 * @param {{ token: string, remoteIp?: string | null, expectedHostname: string, expectedAction: string }} input
 * @param {Record<string, unknown>} env
 */
export async function verifyTurnstile(input, env = {}) {
  const mode = String(env.TURNSTILE_MODE || "disabled").toLowerCase();
  if (mode === "test") {
    if (!isDevelopment(env)) return { ok: false, code: "TEST_MODE_FORBIDDEN" };
    return input.token === TEST_PASS_TOKEN
      ? { ok: true, code: "OK" }
      : { ok: false, code: "TOKEN_INVALID" };
  }
  if (mode !== "enabled") return { ok: false, code: "TURNSTILE_NOT_CONFIGURED" };

  const secret = String(env.TURNSTILE_SECRET || "");
  if (!secret || !input.token || !input.expectedHostname || !input.expectedAction) {
    return { ok: false, code: "TURNSTILE_NOT_CONFIGURED" };
  }

  assertAllowedEgress(SITEVERIFY_URL, env);
  const form = new FormData();
  form.set("secret", secret);
  form.set("response", input.token);
  if (input.remoteIp) form.set("remoteip", input.remoteIp);

  const response = await fetch(SITEVERIFY_URL, { method: "POST", body: form });
  if (!response.ok) return { ok: false, code: "SITEVERIFY_UNAVAILABLE" };

  /** @type {{ success?: boolean, hostname?: string, action?: string }} */
  const result = await response.json();
  if (!result.success) return { ok: false, code: "TOKEN_INVALID" };
  if (result.hostname !== input.expectedHostname) return { ok: false, code: "HOSTNAME_MISMATCH" };
  if (result.action !== input.expectedAction) return { ok: false, code: "ACTION_MISMATCH" };
  return { ok: true, code: "OK" };
}

export { SITEVERIFY_URL, TEST_PASS_TOKEN };
