/* Grup Scout Parpalló — nucli de l'endpoint de reserva de la botiga.
 *
 * Mateixa forma que handler.js (rep una petició normalitzada, torna
 * { status, headers, body }) i reutilitza els seus ajudants d'HTTP perquè les
 * dues respostes es comporten igual, incloent-hi el camí sense JavaScript.
 *
 * PRIVACITAT: ací no hi ha dades de menors ni de salut, però tampoc s'escriu
 * mai el contingut dels camps als registres. Els logs diuen què ha passat,
 * mai amb quines dades.
 */

import { validate } from "./reserva.js";
import { isSpam } from "./validate.js";
import { check as rateCheck } from "./ratelimit.js";
import { appendReserva } from "./sheets.js";
import { json, html, volJson, parseBody, MAX_BODY } from "./handler.js";
import { clientIp } from "./handler.js";

const MISSATGES = {
  ok: {
    va: "Reserva rebuda! Et confirmarem la disponibilitat i quedem un dissabte per a arreplegar-ho.",
    es: "¡Reserva recibida! Te confirmaremos la disponibilidad y quedamos un sábado para recogerlo.",
  },
  invalid: {
    va: "Revisa les dades marcades i torna a provar.",
    es: "Revisa los datos marcados e inténtalo de nuevo.",
  },
  rate: {
    va: "Has enviat massa reserves seguides. Prova d'ací a una estona o escriu-nos per correu.",
    es: "Has enviado demasiadas reservas seguidas. Inténtalo dentro de un rato o escríbenos por correo.",
  },
  server: {
    va: "No hem pogut registrar la reserva. Torna a provar o escriu-nos a gsparpallo@scoutsvalencians.org.",
    es: "No hemos podido registrar la reserva. Inténtalo de nuevo o escríbenos a gsparpallo@scoutsvalencians.org.",
  },
  method: { va: "Mètode no permès.", es: "Método no permitido." },
};

/* req = { method, headers (objecte pla en minúscules), rawBody (string), env, ip } */
export async function handleReserva(req) {
  const headers = req.headers || {};
  const wantsJson = volJson(headers);
  const respond = (status, obj, extra) =>
    wantsJson ? json(status, obj, extra) : html(status, obj.message || MISSATGES.server);

  if (req.method !== "POST") {
    return respond(405, { ok: false, message: MISSATGES.method }, { Allow: "POST" });
  }

  const raw = req.rawBody || "";
  if (raw.length > MAX_BODY) {
    return respond(413, { ok: false, message: MISSATGES.invalid });
  }

  let input;
  try {
    input = parseBody(raw, headers["content-type"]);
  } catch (_) {
    return respond(400, { ok: false, message: MISSATGES.invalid });
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return respond(400, { ok: false, message: MISSATGES.invalid });
  }

  const permes = req.env && req.env.ALLOWED_ORIGIN;
  const origin = headers["origin"];
  if (permes && origin && origin !== permes) {
    console.warn("[reserva] origen no permès");
    return respond(403, { ok: false, message: MISSATGES.invalid });
  }

  // Mateix filtre anti-spam que l'alta: camp trampa i temps mínim.
  if (isSpam(input)) {
    console.warn("[reserva] descartada per filtre anti-spam");
    return respond(200, { ok: true, message: MISSATGES.ok });
  }

  const ip = req.ip || clientIp(headers);
  const rl = rateCheck(ip);
  if (!rl.ok) {
    console.warn("[reserva] límit de peticions superat");
    return respond(429, { ok: false, message: MISSATGES.rate }, { "Retry-After": String(rl.retryAfter) });
  }

  const v = validate(input);
  if (!v.ok) {
    console.warn("[reserva] validació fallida:", Object.keys(v.errors).join(","));
    // "articles" no és un camp del formulari: no es pot marcar en roig enlloc,
    // així que eixe missatge puja a dalt i substituïx el genèric. Si no,
    // qui no ha triat res llegiria "revisa les dades marcades" sense cap dada
    // marcada, que no diu on està el problema.
    const message = v.errors.articles || MISSATGES.invalid;
    return respond(400, { ok: false, message, errors: v.errors });
  }

  try {
    await appendReserva(v.data, req.env || {});
  } catch (e) {
    console.error("[reserva] error en registrar:", e.code || "ERR", e.message);
    return respond(502, { ok: false, message: MISSATGES.server });
  }

  console.info("[reserva] reserva registrada correctament");
  // El total el torna el servidor, no el client: així la confirmació que veu
  // la família és la xifra de veritat, calculada amb els preus del catàleg.
  return respond(200, { ok: true, message: MISSATGES.ok, total: v.data.totalText });
}

export { MISSATGES };
