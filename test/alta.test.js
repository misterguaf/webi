/* Proves de l'endpoint d'alta. S'executen amb `npm test` (Node 18+).
 * No toquen Notion de veritat: es substituïx `fetch` per un doble de prova.
 *
 * Les dades d'exemple són inventades i no corresponen a cap persona real.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { validate, isSpam } from "../api/_lib/validate.js";
import { _reset } from "../api/_lib/ratelimit.js";
import { handleAlta } from "../api/_lib/handler.js";

const VALID = {
  nom: "Aina",
  cognoms: "Exemple Prova",
  naixement: "2015-04-12",
  seccio: "Manada (8-11)",
  notes: "Al·lèrgia als fruits secs",
  tutor: "Marta Exemple",
  telefon: "600 12 34 56",
  email: "prova@exemple.org",
  conegut: "Una amiga",
  dades: "on",
  contacte: "on",
};

const ENV = { NOTION_TOKEN: "ntn_fals", NOTION_DATABASE_ID: "0".repeat(32) };

let peticions = [];
function mockFetch(resposta = { ok: true, status: 200 }) {
  globalThis.fetch = async (url, opts) => {
    peticions.push({ url, opts });
    return {
      ok: resposta.ok,
      status: resposta.status,
      json: async () => resposta.body || {},
    };
  };
}

function post(body, extra = {}) {
  return handleAlta({
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "x-forwarded-for": extra.ip || "203.0.113.7",
      ...(extra.headers || {}),
    },
    rawBody: JSON.stringify(body),
    env: extra.env || ENV,
  });
}

beforeEach(() => {
  _reset();
  peticions = [];
  mockFetch();
});

/* ---------- validació ---------- */

test("una sol·licitud completa és vàlida", () => {
  assert.equal(validate(VALID).ok, true);
});

test("rebutja els camps obligatoris buits", () => {
  const v = validate({});
  assert.equal(v.ok, false);
  for (const camp of ["nom", "cognoms", "naixement", "tutor", "telefon", "email", "dades", "contacte"]) {
    assert.ok(v.errors[camp], "hauria de fallar " + camp);
  }
});

test("rebutja dates impossibles o de fora de rang", () => {
  for (const d of ["2015-02-30", "no-és-una-data", "2099-01-01", "1900-01-01", ""]) {
    assert.equal(validate({ ...VALID, naixement: d }).ok, false, d);
  }
});

test("rebutja una secció que no és de la llista", () => {
  assert.equal(validate({ ...VALID, seccio: "<script>" }).ok, false);
});

test("la secció buida és acceptable", () => {
  assert.equal(validate({ ...VALID, seccio: "" }).ok, true);
});

test("rebutja emails i telèfons mal formats", () => {
  assert.equal(validate({ ...VALID, email: "aixo@no" }).ok, false);
  assert.equal(validate({ ...VALID, telefon: "12" }).ok, false);
});

test("rebutja text desmesurat al camp de notes", () => {
  assert.equal(validate({ ...VALID, notes: "x".repeat(1001) }).ok, false);
});

test("sense consentiment no hi ha sol·licitud", () => {
  assert.equal(validate({ ...VALID, dades: undefined }).ok, false);
  assert.equal(validate({ ...VALID, contacte: undefined }).ok, false);
});

/* ---------- anti-spam ---------- */

test("el camp trampa delata el bot", () => {
  assert.equal(isSpam({ malnom: "http://spam" }), true);
  assert.equal(isSpam({ malnom: "" }), false);
});

test("un enviament instantani es considera automàtic", () => {
  assert.equal(isSpam({ _ts: String(Date.now()) }), true);
  assert.equal(isSpam({ _ts: String(Date.now() - 20000) }), false);
});

/* ---------- handler ---------- */

test("un enviament correcte escriu a Notion i confirma", async () => {
  const r = await post(VALID);
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.body).ok, true);
  assert.equal(peticions.length, 1);
  assert.match(peticions[0].url, /api\.notion\.com/);
});

test("el token de Notion viatja només a Notion, mai a la resposta", async () => {
  const r = await post(VALID);
  assert.ok(!r.body.includes("ntn_fals"));
  assert.match(peticions[0].opts.headers.Authorization, /^Bearer ntn_fals$/);
});

test("les dades invàlides no arriben mai a Notion", async () => {
  const r = await post({ ...VALID, email: "trencat" });
  assert.equal(r.status, 400);
  assert.ok(JSON.parse(r.body).errors.email);
  assert.equal(peticions.length, 0);
});

test("al bot se li respon que tot va bé, però no s'escriu res", async () => {
  const r = await post({ ...VALID, malnom: "compra-viagra" });
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.body).ok, true);
  assert.equal(peticions.length, 0, "no s'ha d'escriure a Notion");
});

test("només s'accepta POST", async () => {
  const r = await handleAlta({ method: "GET", headers: { accept: "application/json" }, rawBody: "", env: ENV });
  assert.equal(r.status, 405);
});

test("es rebutja un cos desmesurat sense processar-lo", async () => {
  const r = await handleAlta({
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    rawBody: "x".repeat(20000),
    env: ENV,
  });
  assert.equal(r.status, 413);
});

test("el límit de peticions atura l'abús des d'una mateixa IP", async () => {
  for (let i = 0; i < 5; i++) {
    assert.equal((await post(VALID, { ip: "198.51.100.1" })).status, 200);
  }
  const r = await post(VALID, { ip: "198.51.100.1" });
  assert.equal(r.status, 429);
  assert.ok(r.headers["Retry-After"]);
});

test("si Notion falla, s'avisa la família i no es perd res pel camí", async () => {
  mockFetch({ ok: false, status: 500, body: { code: "internal_error", message: "boom" } });
  const r = await post(VALID);
  assert.equal(r.status, 502);
  const b = JSON.parse(r.body);
  assert.equal(b.ok, false);
  assert.ok(b.message.va.length > 0);
});

test("sense configuració de Notion no es promet un èxit fals", async () => {
  const r = await post(VALID, { env: {} });
  assert.equal(r.status, 502);
  assert.equal(JSON.parse(r.body).ok, false);
});

test("es rebutja un origen que no és el nostre", async () => {
  const r = await post(VALID, {
    env: { ...ENV, ALLOWED_ORIGIN: "https://parpallo.org" },
    headers: { origin: "https://lloc-clonat.example" },
  });
  assert.equal(r.status, 403);
  assert.equal(peticions.length, 0);
});

test("un formulari sense JS rep HTML, no JSON", async () => {
  const r = await handleAlta({
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html" },
    rawBody: new URLSearchParams(VALID).toString(),
    env: ENV,
  });
  assert.equal(r.status, 200);
  assert.match(r.headers["Content-Type"], /text\/html/);
  assert.match(r.body, /<!doctype html>/i);
});
