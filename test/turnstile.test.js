import { test } from "node:test";
import assert from "node:assert/strict";
import { SITEVERIFY_URL, TEST_PASS_TOKEN, verifyTurnstile } from "../api/_lib/turnstile.js";

const INPUT = {
  token: TEST_PASS_TOKEN,
  remoteIp: "192.0.2.10",
  expectedHostname: "staging.example.test",
  expectedAction: "waitlist",
};

test("el mode Turnstile de prueba solo funciona fuera de producción", async () => {
  assert.equal((await verifyTurnstile(INPUT, { APP_ENV: "development", TURNSTILE_MODE: "test" })).ok, true);
  assert.equal((await verifyTurnstile({ ...INPUT, token: "fail" }, { APP_ENV: "staging", TURNSTILE_MODE: "test" })).ok, false);
  const production = await verifyTurnstile(INPUT, { APP_ENV: "production", TURNSTILE_MODE: "test" });
  assert.deepEqual(production, { ok: false, code: "TEST_MODE_FORBIDDEN" });
});

test("el adaptador falla cerrado si no está configurado", async () => {
  assert.deepEqual(await verifyTurnstile(INPUT, { APP_ENV: "production" }), {
    ok: false,
    code: "TURNSTILE_NOT_CONFIGURED",
  });
});

test("Siteverify valida success, hostname y action", async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      assert.equal(url, SITEVERIFY_URL);
      return Response.json({ success: true, hostname: INPUT.expectedHostname, action: INPUT.expectedAction });
    };
    const result = await verifyTurnstile({ ...INPUT, token: "remote-synthetic-token" }, {
      APP_ENV: "production",
      TURNSTILE_MODE: "enabled",
      TURNSTILE_SECRET: "synthetic-secret",
    });
    assert.deepEqual(result, { ok: true, code: "OK" });

    globalThis.fetch = async () => Response.json({ success: true, hostname: "evil.example", action: INPUT.expectedAction });
    assert.equal((await verifyTurnstile({ ...INPUT, token: "remote-synthetic-token" }, {
      APP_ENV: "production",
      TURNSTILE_MODE: "enabled",
      TURNSTILE_SECRET: "synthetic-secret",
    })).code, "HOSTNAME_MISMATCH");
  } finally {
    globalThis.fetch = realFetch;
  }
});
