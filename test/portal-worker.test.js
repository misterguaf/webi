import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import portal from "../portal/worker.js";
import { _reset } from "../api/_lib/ratelimit.js";

const ORIGIN = "https://inscripciones.example.test";
const ENV = {
  PORTAL_ACCESS_PASSWORD: "families-prova",
  PORTAL_SESSION_SECRET: "secret-de-sessio-prou-llarg-per-a-proves",
  PORTAL_SESSION_VERSION: "2026-2027",
  PORTAL_ALLOWED_ORIGIN: ORIGIN,
  ASSETS: { fetch: async (request) => new Response("asset:" + new URL(request.url).pathname, { headers: { "Content-Type": "text/plain" } }) },
};

beforeEach(() => _reset());

async function login(password = "families-prova", ip = "198.51.100.7") {
  return portal.fetch(new Request(ORIGIN + "/api/portal/session", { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json", "CF-Connecting-IP": ip }, body: JSON.stringify({ password }) }), ENV);
}

test("los recursos privados no se sirven sin sesión", async () => {
  const html = await portal.fetch(new Request(ORIGIN + "/portal.js"), ENV);
  assert.equal(await html.text(), "asset:/access.html");
  const api = await portal.fetch(new Request(ORIGIN + "/api/portal/config"), ENV);
  assert.equal(api.status, 401);
  assert.match(api.headers.get("x-robots-tag"), /noindex/);
});

test("login, comprobación y cierre de sesión", async () => {
  assert.equal((await login("incorrecta")).status, 401);
  const response = await login();
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie").split(";")[0];
  assert.match(response.headers.get("set-cookie"), /HttpOnly/);
  const session = await portal.fetch(new Request(ORIGIN + "/api/portal/session", { headers: { Cookie: cookie } }), ENV);
  assert.equal(session.status, 200);
  const csrf = (await session.json()).csrf;
  assert.ok(csrf);
  const logout = await portal.fetch(new Request(ORIGIN + "/api/portal/session", { method: "DELETE", headers: { Cookie: cookie, Origin: ORIGIN, "X-CSRF-Token": csrf } }), ENV);
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
});

test("se limitan cinco intentos de acceso por minuto", async () => {
  for (let i = 0; i < 5; i++) assert.equal((await login("mal", "203.0.113.8")).status, 401);
  assert.equal((await login("mal", "203.0.113.8")).status, 429);
});

test("los POST privados exigen origen y CSRF correctos", async () => {
  const response = await login();
  const cookie = response.headers.get("set-cookie").split(";")[0];
  const csrf = (await response.json()).csrf;
  const noOrigin = await portal.fetch(new Request(ORIGIN + "/api/cuota", { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: "{}" }), ENV);
  assert.equal(noOrigin.status, 403);
  const badCsrf = await portal.fetch(new Request(ORIGIN + "/api/cuota", { method: "POST", headers: { Cookie: cookie, Origin: ORIGIN, "Content-Type": "application/json", "X-CSRF-Token": "bad" }, body: "{}" }), ENV);
  assert.equal(badCsrf.status, 403);
});

test("production sin PORTAL_ALLOWED_ORIGIN rechaza el login", async () => {
  const response = await portal.fetch(new Request(ORIGIN + "/api/portal/session", {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({ password: "families-prova" }),
  }), { ...ENV, APP_ENV: "production", PORTAL_ALLOWED_ORIGIN: "" });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("el login rechaza content type y body excesivo", async () => {
  const wrongType = await portal.fetch(new Request(ORIGIN + "/api/portal/session", {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "text/plain" },
    body: "families-prova",
  }), ENV);
  assert.equal(wrongType.status, 415);

  const oversized = await portal.fetch(new Request(ORIGIN + "/api/portal/session", {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({ password: "x".repeat(3000) }),
  }), ENV);
  assert.equal(oversized.status, 413);
});
