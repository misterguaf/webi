/* Grup Scout Parpalló — escriptura legacy a Google Sheets via Apps Script.
 * Només alta pública, reserva i quota anual. Les activitats noves usen D1.
 *
 * Sense SDK de Google i sense credencials OAuth: només `fetch` cap a un
 * endpoint d'Apps Script desplegat com a Web App. Qui gestiona la fulla
 * enganxa un petit script (scripts/google-apps-script.gs) al seu propi
 * document i el desplega; nosaltres només guardem la URL i un secret compartit.
 *
 * Motiu de no usar l'API oficial de Sheets: exigeix guardar una clau JSON
 * de compte de servei i firmar JWTs, cosa desproporcionada per a un
 * formulari amb dades de menors. Amb Apps Script tota l'autorització
 * queda dins del compte de Google propietari de la fulla; nosaltres no
 * toquem cap credencial de Google.
 *
 * La URL (SHEETS_WEBHOOK_URL) i la clau HMAC (SHEETS_SHARED_SECRET) arriben
 * per variable d'entorn del servidor. La clau mai viatja en clar: només firma
 * un sobre amb caducitat curta i nonce, que l'Apps Script comprova.
 */

import { assertAllowedEgress } from "./environment.js";

const TIMEOUT_MS = 10000;
/* La quota espera el LockService i guarda el comprovant a Drive. */
const TIMEOUT_QUOTA_MS = 45000;

export async function appendRow(d, env) {
  return enviar(
    {
      tipus: "alta",
      rebut: new Date().toISOString(),
      nom: d.nom,
      cognoms: d.cognoms,
      naixement: d.naixement,
      seccio: d.seccio || "",
      tutor: d.tutor,
      telefon: d.telefon,
      email: d.email,
      conegut: d.conegut || "",
      estat: "Nova",
    },
    env
  );
}

/* Reserva de la botiga. Va a una pestanya distinta de la mateixa Sheet;
 * l'Apps Script tria la pestanya segons `tipus`.
 *
 * Els articles s'envien ja resumits en text ("2 × Sudadera; 1 × Pañoleta")
 * perquè la fila siga llegible per una persona sense haver de creuar taules,
 * i el total ja calculat pel servidor. */
export async function appendReserva(d, env) {
  return enviar(
    {
      tipus: "reserva",
      rebut: new Date().toISOString(),
      nom: d.nom,
      cognoms: d.cognoms,
      telefon: d.telefon || "",
      email: d.email,
      articles: d.articles.map((a) => `${a.qt} × ${a.nom}`).join("; "),
      unitats: d.articles.reduce((n, a) => n + a.qt, 0),
      total: d.totalText,
      notes: d.notes || "",
      estat: "Nova",
    },
    env
  );
}

/* Quota anual. Un sol enviament pot incloure diversos germans i un únic
 * comprovant. L'Apps Script crea una fila per menor i torna una referència
 * comuna per a poder tractar el pagament com una sola operació. */
export async function appendQuota(d, env) {
  const body = await enviar(
    Object.assign({ tipus: "quota", rebut: new Date().toISOString() }, d),
    env,
    TIMEOUT_QUOTA_MS
  );
  return {
    referencia: body.referencia || "",
    duplicada: body.duplicada === true,
  };
}

async function enviar(dades, env, timeoutMs) {
  const url = env.SHEETS_WEBHOOK_URL;
  const secret = env.SHEETS_SHARED_SECRET;
  if (!url || !secret) {
    const e = new Error("SHEETS_WEBHOOK_URL o SHEETS_SHARED_SECRET no configurat");
    e.code = "CONFIG";
    throw e;
  }

  // En desenvolupament esta comprovació ocorre abans de firmar o fer fetch.
  // Un `.env` antic no pot convertir una prova ordinària en una escriptura real.
  assertAllowedEgress(url, env);

  const payload = JSON.stringify(dades);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crearNonce();
  const signable = `${timestamp}.${nonce}.${payload}`;
  const signature = await hmacHex(secret, signable);
  const cos = { timestamp, nonce, payload, signature };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cos),
      signal: ctrl.signal,
      // Apps Script respon amb un 302 cap a script.googleusercontent.com
      // que fetch segueix per defecte; l'explicitem per si algun runtime
      // (Cloudflare Workers) canvia el valor per defecte en el futur.
      redirect: "follow",
    });
  } finally {
    clearTimeout(t);
  }

  if (!res.ok) {
    const e = new Error(`Sheets HTTP ${res.status}`);
    e.code = "SHEETS";
    e.status = res.status;
    throw e;
  }

  let body;
  try {
    body = await res.json();
  } catch (_) {
    // Si l'Apps Script llança abans de respondre, Google torna HTML.
    // Ho tractem com a error de configuració, no com un èxit ambigu.
    const e = new Error("Sheets: resposta no és JSON (revisa el desplegament)");
    e.code = "SHEETS";
    throw e;
  }

  if (!body.ok) {
    // body.error pot repetir dades del cos; retallem per no vessar-les als logs.
    const e = new Error(`Sheets: ${String(body.error || "error desconegut").slice(0, 200)}`);
    e.code = "SHEETS";
    throw e;
  }

  return body;
}

function crearNonce() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(secret, message) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export { hmacHex };
