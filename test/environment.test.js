import { test } from "node:test";
import assert from "node:assert/strict";
import { assertAllowedEgress, environmentName, isAllowedOrigin, isDevelopment } from "../api/_lib/environment.js";

test("classifica els entorns de desenvolupament de forma explícita", () => {
  assert.equal(environmentName({ APP_ENV: " Development " }), "development");
  assert.equal(isDevelopment({ APP_ENV: "test" }), true);
  assert.equal(isDevelopment({ APP_ENV: "staging" }), true);
  assert.equal(isDevelopment({ APP_ENV: "production" }), false);
});

test("dev permet només egress local o reservat per defecte", () => {
  const env = { APP_ENV: "development" };
  assert.doesNotThrow(() => assertAllowedEgress("https://sheets.invalid/fake", env));
  assert.doesNotThrow(() => assertAllowedEgress("http://127.0.0.1:9999/hook", env));
  assert.throws(() => assertAllowedEgress("https://script.google.com/macros/s/prod/exec", env), /bloquejat/);
});

test("l'egress real en dev exigix opt-in i allowlist exacta", () => {
  const target = "https://script.google.com/macros/s/staging/exec";
  assert.throws(() => assertAllowedEgress(target, { APP_ENV: "development", ALLOW_REAL_EGRESS: "true" }), /bloquejat/);
  assert.doesNotThrow(() => assertAllowedEgress(target, {
    APP_ENV: "development",
    ALLOW_REAL_EGRESS: "true",
    DEV_EGRESS_ALLOWLIST: "https://script.google.com",
  }));
  assert.throws(() => assertAllowedEgress(target, {
    APP_ENV: "development",
    ALLOW_REAL_EGRESS: "true",
    DEV_EGRESS_ALLOWLIST: "https://evil.example",
  }), /bloquejat/);
});

test("production rebutja un Origin sense origen HTTPS configurat", () => {
  const production = { APP_ENV: "production" };
  assert.equal(isAllowedOrigin("https://parpallo.test", "", production), false);
  assert.equal(isAllowedOrigin("https://parpallo.test", "http://parpallo.test", production), false);
  assert.equal(isAllowedOrigin("https://parpallo.test", "https://parpallo.test/path", production), false);
  assert.equal(isAllowedOrigin("https://altri.test", "https://parpallo.test", production), false);
  assert.equal(isAllowedOrigin("https://parpallo.test", "https://parpallo.test", production), true);
  assert.equal(isAllowedOrigin(null, "https://parpallo.test", production), false);
  assert.equal(isAllowedOrigin(null, "", { APP_ENV: "development" }), true);
});
