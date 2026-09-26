import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { handleQuota } from "../api/_lib/handler-quota.js";
import { _reset } from "../api/_lib/ratelimit.js";
import { hmacHex } from "../api/_lib/sheets.js";

const CONFIG = {
  curs: "2098-2099",
  oberta: true,
  dataLimit: "2099-06-30",
  importBaseCentims: 5000,
  descomptes: [{ desDe: 2, percentatge: 20 }],
  instruccions: { va: "Prova", es: "Prueba" },
};
const ENV = { SHEETS_WEBHOOK_URL: "https://sheets.invalid", SHEETS_SHARED_SECRET: "secret-compartit-de-prova", PORTAL_ALLOWED_ORIGIN: "https://portal.test" };
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64");
const VALID = {
  fills: [
    { nom: "Aina", cognoms: "Exemple", seccio: "TRO" },
    { nom: "Pau", cognoms: "Exemple", seccio: "EST" },
  ],
  tutor: "Marta Exemple",
  telefon: "600123456",
  email: "prova@example.org",
  comprovant: { nom: "rebut.jpg", tipus: "image/jpeg", base64: JPEG },
  privacitat: true,
  idempotencyKey: "quota-handler-1234",
  totalCentims: 1,
};
let envelope;

beforeEach(() => { _reset(); envelope = null; });

test("el endpoint de cuota firma el total calculado por el servidor", async () => {
  globalThis.fetch = async (_url, options) => {
    envelope = JSON.parse(options.body);
    return Response.json({ ok: true, referencia: "QUOTA-9899-0001" });
  };
  const response = await handleQuota({ method: "POST", headers: { accept: "application/json", "content-type": "application/json", origin: "https://portal.test" }, rawBody: JSON.stringify(VALID), env: ENV, ip: "198.51.100.41" }, CONFIG);
  assert.equal(response.status, 200);
  const sent = JSON.parse(envelope.payload);
  assert.equal(sent.totalCentims, 9000);
  assert.deepEqual(sent.imports, [5000, 4000]);
  assert.equal(envelope.signature, await hmacHex(ENV.SHEETS_SHARED_SECRET, `${envelope.timestamp}.${envelope.nonce}.${envelope.payload}`));
});

test("un error de Sheets no promete que la cuota se haya registrado", async () => {
  globalThis.fetch = async () => Response.json({ ok: false, error: "fallada" });
  const response = await handleQuota({ method: "POST", headers: { accept: "application/json", "content-type": "application/json", origin: "https://portal.test" }, rawBody: JSON.stringify({ ...VALID, idempotencyKey: "quota-handler-5678" }), env: ENV, ip: "198.51.100.42" }, CONFIG);
  assert.equal(response.status, 502);
  assert.equal(JSON.parse(response.body).ok, false);
});

test("la cuota en production sin origen configurado falla antes de Sheets", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ ok: true }); };
  const response = await handleQuota({
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", origin: "https://portal.test" },
    rawBody: JSON.stringify(VALID),
    env: { ...ENV, APP_ENV: "production", PORTAL_ALLOWED_ORIGIN: "", ALLOWED_ORIGIN: "" },
    ip: "198.51.100.43",
  }, CONFIG);
  assert.equal(response.status, 403);
  assert.equal(calls, 0);
});
