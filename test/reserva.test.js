/* Proves de la botiga del grup: validació, càlcul del total i endpoint.
 * S'executen amb `npm test`. No toquen Google Sheets: es substituïx `fetch`.
 *
 * Les dades d'exemple són inventades i no corresponen a cap persona real.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { validate } from "../api/_lib/reserva.js";
import { PRODUCTES, preuText } from "../api/_lib/productes.js";
import { _reset } from "../api/_lib/ratelimit.js";
import { handleReserva } from "../api/_lib/handler-reserva.js";
import { hmacHex } from "../api/_lib/sheets.js";

const ARREL = join(dirname(fileURLToPath(import.meta.url)), "..");

const VALID = {
  nom: "Marta",
  cognoms: "Exemple Prova",
  email: "prova@exemple.org",
  telefon: "600 12 34 56",
  "qt-sudadera": "1",
  dades: "on",
};

const ENV = {
  SHEETS_WEBHOOK_URL: "https://script.google.com/macros/s/AKfals/exec",
  SHEETS_SHARED_SECRET: "secret-fals",
};

let enviats = [];
beforeEach(() => {
  _reset();
  enviats = [];
  globalThis.fetch = async (url, opts) => {
    enviats.push(JSON.parse(opts.body));
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
});

function post(dades, extra) {
  return handleReserva({
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    rawBody: JSON.stringify(dades),
    env: ENV,
    ip: "10.0.0.1",
    ...extra,
  });
}

/* ---------- validació ---------- */

test("una reserva completa és vàlida", () => {
  const r = validate(VALID);
  assert.equal(r.ok, true);
  assert.equal(r.data.total, 2000);
  assert.equal(r.data.totalText, "20 €");
});

test("sense cap article no hi ha reserva", () => {
  const { "qt-sudadera": _, ...sense } = VALID;
  const r = validate(sense);
  assert.equal(r.ok, false);
  assert.ok(r.errors.articles);
});

test("les quantitats a zero no compten com a article", () => {
  const r = validate({ ...VALID, "qt-sudadera": "0" });
  assert.equal(r.ok, false);
  assert.ok(r.errors.articles);
});

test("suma diverses línies amb les seues quantitats", () => {
  const r = validate({ ...VALID, "qt-sudadera": "2", "qt-panoleta": "3" });
  assert.equal(r.ok, true);
  // 2 × 20 € + 3 × 1 € = 43 €
  assert.equal(r.data.total, 4300);
  assert.equal(r.data.totalText, "43 €");
  assert.equal(r.data.articles.length, 2);
});

test("un article que no és del catàleg es rebutja", () => {
  const r = validate({ ...VALID, "qt-cotxe-de-carreres": "1" });
  assert.equal(r.ok, false);
  assert.ok(r.errors.articles);
});

test("no s'accepten quantitats desmesurades", () => {
  const r = validate({ ...VALID, "qt-sudadera": "999" });
  assert.equal(r.ok, false);
  assert.ok(r.errors.articles);
});

test("les quantitats negatives o absurdes s'ignoren", () => {
  const r = validate({ ...VALID, "qt-sudadera": "1", "qt-polar": "-4", "qt-camiseta": "abc" });
  assert.equal(r.ok, true);
  assert.equal(r.data.articles.length, 1);
  assert.equal(r.data.total, 2000);
});

test("EL PREU MAI VE DEL CLIENT: manipular-lo no canvia el total", () => {
  const r = validate({ ...VALID, preu: "1", total: "0", "preu-sudadera": "0" });
  assert.equal(r.ok, true);
  assert.equal(r.data.total, 2000); // el del catàleg, no el que ha enviat
});

test("també accepta la forma amb llista d'articles (camí amb JS)", () => {
  const r = validate({
    ...VALID,
    "qt-sudadera": undefined,
    articles: [{ id: "camiseta", qt: 2 }],
  });
  assert.equal(r.ok, true);
  assert.equal(r.data.total, 1600);
});

test("email i telèfon mal formats es rebutgen", () => {
  assert.equal(validate({ ...VALID, email: "aixo-no-es-un-email" }).ok, false);
  assert.equal(validate({ ...VALID, telefon: "12" }).ok, false);
});

test("el telèfon és opcional", () => {
  const { telefon: _, ...sense } = VALID;
  assert.equal(validate(sense).ok, true);
});

test("sense acceptar la política de dades no hi ha reserva", () => {
  const { dades: _, ...sense } = VALID;
  const r = validate(sense);
  assert.equal(r.ok, false);
  assert.ok(r.errors.dades);
});

/* ---------- endpoint ---------- */

test("una reserva correcta s'escriu i es confirma amb el total del servidor", async () => {
  const r = await post({ ...VALID, "qt-sudadera": "2" });
  assert.equal(r.status, 200);
  const body = JSON.parse(r.body);
  assert.equal(body.ok, true);
  assert.equal(body.total, "40 €");
  assert.equal(enviats.length, 1);
  const payload = JSON.parse(enviats[0].payload);
  assert.equal(payload.tipus, "reserva");
  assert.equal(payload.total, "40 €");
  assert.equal(payload.unitats, 2);
  assert.match(payload.articles, /2 × Sudadera/);
});

test("la reserva viatja en un sobre HMAC sense secret en clar", async () => {
  const r = await post(VALID);
  assert.equal(enviats[0].secret, undefined);
  assert.equal(JSON.parse(enviats[0].payload).tipus, "reserva");
  assert.equal(
    enviats[0].signature,
    await hmacHex("secret-fals", `${enviats[0].timestamp}.${enviats[0].nonce}.${enviats[0].payload}`)
  );
  assert.ok(!r.body.includes("secret-fals"));
});

test("una reserva invàlida no arriba mai a Sheets", async () => {
  const r = await post({ ...VALID, email: "roin" });
  assert.equal(r.status, 400);
  assert.equal(enviats.length, 0);
});

test("production sense ALLOWED_ORIGIN no escriu la reserva", async () => {
  const r = await post(VALID, { env: { ...ENV, APP_ENV: "production", ALLOWED_ORIGIN: "" } });
  assert.equal(r.status, 403);
  assert.equal(enviats.length, 0);
});

test("al bot se li respon que tot va bé, però no s'escriu res", async () => {
  const r = await post({ ...VALID, malnom: "sóc un bot" });
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.body).ok, true);
  assert.equal(enviats.length, 0);
});

test("només s'accepta POST", async () => {
  const r = await handleReserva({ method: "GET", headers: { accept: "application/json" }, env: ENV });
  assert.equal(r.status, 405);
});

test("si Sheets falla, s'avisa i no es promet un èxit fals", async () => {
  globalThis.fetch = async () => {
    throw new Error("boom");
  };
  const r = await post(VALID);
  assert.equal(r.status, 502);
  assert.equal(JSON.parse(r.body).ok, false);
});

test("un formulari sense JS rep HTML, no JSON", async () => {
  const r = await handleReserva({
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    rawBody: "nom=Marta&cognoms=Exemple+Prova&email=prova%40exemple.org&qt-sudadera=1&dades=on",
    env: ENV,
    ip: "10.0.0.9",
  });
  assert.equal(r.status, 200);
  assert.match(r.headers["Content-Type"], /text\/html/);
  assert.equal(enviats.length, 1);
});

/* ---------- coherència entre el catàleg i la pàgina ---------- */

test("merchandising.html i el catàleg diuen els mateixos preus", () => {
  const html = readFileSync(join(ARREL, "site", "merchandising.html"), "utf8");

  for (const p of PRODUCTES) {
    // Cada producte ha de tindre el seu camp de quantitat...
    assert.ok(
      html.includes(`name="qt-${p.id}"`),
      `falta el camp qt-${p.id} a merchandising.html`
    );
    // ...i la seua targeta ha de declarar el preu del catàleg.
    const card = html.split(`name="qt-${p.id}"`)[0];
    const preus = [...card.matchAll(/data-preu="(\d+)"/g)];
    const ultim = preus[preus.length - 1];
    assert.ok(ultim, `falta data-preu per a ${p.id}`);
    assert.equal(
      Number(ultim[1]),
      p.preu,
      `el preu de ${p.id} no quadra: HTML ${ultim[1]} vs catàleg ${p.preu}`
    );
    // I el preu visible ha de ser el mateix, ben formatat.
    assert.ok(
      card.includes(`>${preuText(p.preu)}<`),
      `el preu visible de ${p.id} hauria de ser ${preuText(p.preu)}`
    );
  }
});

test("la pàgina no ofereix cap article que no estiga al catàleg", () => {
  const html = readFileSync(join(ARREL, "site", "merchandising.html"), "utf8");
  const ids = new Set(PRODUCTES.map((p) => p.id));
  for (const m of html.matchAll(/name="qt-([\w-]+)"/g)) {
    assert.ok(ids.has(m[1]), `merchandising.html ofereix "${m[1]}", que no és al catàleg`);
  }
});

test("si no s'ha triat cap article, el missatge ho diu clarament", async () => {
  const { "qt-sudadera": _, ...sense } = VALID;
  const r = await post(sense);
  assert.equal(r.status, 400);
  const body = JSON.parse(r.body);
  // No pot ser el missatge genèric: no hi ha cap camp que es puga marcar.
  assert.match(body.message.va, /almenys un article/);
  assert.equal(enviats.length, 0);
});
