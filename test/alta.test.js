/* Proves de l'endpoint d'alta. S'executen amb `npm test` (Node 18+).
 * No toquen Google Sheets de veritat: es substituïx `fetch` per un doble de prova.
 *
 * Les dades d'exemple són inventades i no corresponen a cap persona real.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { validate, isSpam } from "../api/_lib/validate.js";
import { _reset } from "../api/_lib/ratelimit.js";
import { handleAlta } from "../api/_lib/handler.js";
import { hmacHex } from "../api/_lib/sheets.js";
import { SHEETS_TEST_ENV, WAITLIST_REQUEST } from "./fixtures/synthetic.js";

const VALID = WAITLIST_REQUEST;
const ENV = SHEETS_TEST_ENV;

let peticions = [];
function mockFetch(resposta = { ok: true, status: 200, body: { ok: true } }) {
  globalThis.fetch = async (url, opts) => {
    peticions.push({ url, opts });
    return {
      ok: resposta.ok,
      status: resposta.status,
      json: async () => {
        if (resposta.throwJson) throw new Error("no és JSON");
        return resposta.body || {};
      },
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

test("rebutja qualsevol camp sanitari o l'antic camp notes", () => {
  for (const field of ["notes", "alergias", "salut", "health", "medicacion", "diagnóstico"]) {
    const v = validate({ ...VALID, [field]: "valor que no ha d'eixir" });
    assert.equal(v.ok, false, field);
    assert.ok(v.errors.sensitive, field);
  }
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

test("un enviament correcte escriu a Sheets i confirma", async () => {
  const r = await post(VALID);
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.body).ok, true);
  assert.equal(peticions.length, 1);
  assert.equal(peticions[0].url, "https://sheets.invalid/fake");
});

test("el webhook rep un sobre HMAC, mai el secret en clar", async () => {
  const r = await post(VALID);
  assert.ok(!r.body.includes(SHEETS_TEST_ENV.SHEETS_SHARED_SECRET));
  const enviat = JSON.parse(peticions[0].opts.body);
  assert.equal(enviat.secret, undefined);
  const payload = JSON.parse(enviat.payload);
  assert.equal(payload.tipus, "alta");
  assert.equal(Object.hasOwn(payload, "notes"), false);
  assert.equal(
    enviat.signature,
    await hmacHex(SHEETS_TEST_ENV.SHEETS_SHARED_SECRET, `${enviat.timestamp}.${enviat.nonce}.${enviat.payload}`)
  );
});

test("les dades invàlides no arriben mai a Sheets", async () => {
  const r = await post({ ...VALID, email: "trencat" });
  assert.equal(r.status, 400);
  assert.ok(JSON.parse(r.body).errors.email);
  assert.equal(peticions.length, 0);
});

test("les dades de salut no arriben mai a Sheets", async () => {
  const r = await post({ ...VALID, notes: "legacy" });
  assert.equal(r.status, 400);
  assert.ok(JSON.parse(r.body).errors.sensitive);
  assert.equal(peticions.length, 0);
});

test("es rebutja un tipus de contingut no admès", async () => {
  const r = await handleAlta({
    method: "POST",
    headers: { "content-type": "text/plain", accept: "application/json" },
    rawBody: JSON.stringify(VALID),
    env: ENV,
  });
  assert.equal(r.status, 415);
  assert.equal(peticions.length, 0);
});

test("al bot se li respon que tot va bé, però no s'escriu res", async () => {
  const r = await post({ ...VALID, malnom: "compra-viagra" });
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.body).ok, true);
  assert.equal(peticions.length, 0, "no s'ha d'escriure a Sheets");
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

test("si Sheets torna un error, s'avisa la família i no es perd res pel camí", async () => {
  mockFetch({ ok: true, status: 200, body: { ok: false, error: "boom" } });
  const r = await post(VALID);
  assert.equal(r.status, 502);
  const b = JSON.parse(r.body);
  assert.equal(b.ok, false);
  assert.ok(b.message.va.length > 0);
});

test("si Sheets respon HTML (script trencat), es tracta com a error", async () => {
  mockFetch({ ok: true, status: 200, throwJson: true });
  const r = await post(VALID);
  assert.equal(r.status, 502);
  assert.equal(JSON.parse(r.body).ok, false);
});

test("sense configuració de Sheets no es promet un èxit fals", async () => {
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

test("amb origen configurat també es rebutja un POST sense Origin", async () => {
  const r = await post(VALID, { env: { ...ENV, ALLOWED_ORIGIN: "https://parpallo.org" } });
  assert.equal(r.status, 403);
  assert.equal(peticions.length, 0);
});

test("production sense ALLOWED_ORIGIN no escriu a Sheets", async () => {
  const r = await post(VALID, { env: { ...ENV, APP_ENV: "production", ALLOWED_ORIGIN: "" } });
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
