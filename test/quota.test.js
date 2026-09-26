import { test } from "node:test";
import assert from "node:assert/strict";
import { calculaQuota, configuracioCompleta, configuracioPublica } from "../api/_lib/cuotes.js";
import { validateQuota } from "../api/_lib/quota.js";

const OPEN = {
  curs: "2098-2099",
  oberta: true,
  dataLimit: "2099-06-30",
  importBaseCentims: 5000,
  descomptes: [{ desDe: 2, percentatge: 20 }],
  instruccions: { va: "Transferència de prova", es: "Transferencia de prueba" },
};
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64");
const VALID = {
  fills: [{ nom: "Aina", cognoms: "Exemple", seccio: "TRO" }],
  tutor: "Marta Exemple",
  telefon: "600123456",
  email: "prova@example.org",
  comprovant: { nom: "rebut.jpg", tipus: "image/jpeg", base64: JPEG },
  privacitat: true,
  idempotencyKey: "quota-demo-1234",
};

test("la cuota permanece cerrada con configuración económica incompleta", () => {
  assert.equal(configuracioCompleta({ ...OPEN, importBaseCentims: null }), false);
  assert.equal(validateQuota(VALID, { ...OPEN, oberta: false }).ok, false);
});

test("el cálculo de hermanos se hace en servidor", () => {
  assert.deepEqual(calculaQuota(3, OPEN), { imports: [5000, 4000, 4000], totalCentims: 13000 });
  const result = validateQuota({ ...VALID, fills: [VALID.fills[0], { nom: "Pau", cognoms: "Exemple", seccio: "EST" }], totalCentims: 1 }, OPEN);
  assert.equal(result.ok, true);
  assert.equal(result.data.totalCentims, 9000);
  assert.equal(result.data.totalText, "90 €");
});

test("la configuración pública no expone reglas pero ofrece totales calculados", () => {
  const config = configuracioPublica(OPEN);
  assert.equal(config.descomptes, undefined);
  assert.deepEqual(config.totalsText.slice(0, 3), ["50 €", "90 €", "130 €"]);
});

test("la cuota rechaza secciones y comprobantes inválidos", () => {
  const result = validateQuota({ ...VALID, fills: [{ ...VALID.fills[0], seccio: "OTRA" }], comprovant: { ...VALID.comprovant, base64: Buffer.from("html").toString("base64") } }, OPEN);
  assert.equal(result.ok, false);
  assert.ok(result.errors["fills.0.seccio"]);
  assert.ok(result.errors.comprovant);
});
