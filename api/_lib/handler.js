/* Grup Scout Parpalló — nucli de l'endpoint d'alta ("Fer-se scout").
 *
 * Este fitxer no sap on està desplegat. Rep una petició ja normalitzada i
 * torna { status, headers, body }. Els adaptadors de cada plataforma
 * (api/alta.js per a Vercel, netlify/functions/alta.js, worker.js per a
 * Cloudflare) només tradueixen el format de la petició i la resposta.
 * Així es pot canviar de hosting sense tocar cap regla de negoci ni de seguretat.
 *
 * PRIVACITAT — regla d'or d'este fitxer: ací passen dades de menors. La llista
 * d'espera rebutja dades de salut. MAI s'escriu el contingut a la consola.
 * Els logs diuen què ha passat (validació fallida, error de Sheets), mai amb quines dades.
 */

import { validate, isSpam } from "./validate.js";
import { check as rateCheck } from "./ratelimit.js";
import { appendRow } from "./sheets.js";
import { isAcceptedFormContentType } from "./http-body.js";
import { isAllowedOrigin } from "./environment.js";

const MAX_BODY = 16 * 1024; // 16 KB: molt per damunt d'un formulari legítim

const MISSATGES = {
  ok: {
    va: "Rebut! Ens posarem en contacte amb tu per a parlar-ho amb calma.",
    es: "¡Recibido! Nos pondremos en contacto contigo para hablarlo con calma.",
  },
  invalid: {
    va: "Revisa les dades marcades i torna a provar.",
    es: "Revisa los datos marcados e inténtalo de nuevo.",
  },
  rate: {
    va: "Has enviat massa sol·licituds seguides. Prova d'ací a una estona o escriu-nos per correu.",
    es: "Has enviado demasiadas solicitudes seguidas. Inténtalo dentro de un rato o escríbenos por correo.",
  },
  server: {
    va: "No hem pogut registrar la sol·licitud. Les teues dades segueixen ací: torna a provar o escriu-nos a gsparpallo@scoutsvalencians.org.",
    es: "No hemos podido registrar la solicitud. Tus datos siguen aquí: inténtalo de nuevo o escríbenos a gsparpallo@scoutsvalencians.org.",
  },
  method: { va: "Mètode no permès.", es: "Método no permitido." },
};

function json(status, obj, extra) {
  return {
    status,
    headers: Object.assign(
      {
        "Content-Type": "application/json; charset=utf-8",
        // Una resposta amb dades personals no s'ha de cachejar enlloc.
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
      extra || {}
    ),
    body: JSON.stringify(obj),
  };
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

/* Resposta per a navegadors sense JS: una pàgina mínima, sense dependre de
 * styles.css ni de cap recurs, amb enllaç de tornada. El camí normal (amb JS)
 * no passa mai per ací. */
function html(status, missatge) {
  const cos =
    '<!doctype html><html lang="ca-ES-valencia"><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex">' +
    "<title>Grup Scout Parpalló</title>" +
    '<body style="font-family:system-ui,sans-serif;max-width:34rem;margin:12vh auto;padding:0 1.2rem;line-height:1.6">' +
    "<p>" + esc(missatge.va) + "</p>" +
    "<p>" + esc(missatge.es) + "</p>" +
    '<p><a href="/fersescout.html">Tornar / Volver</a></p>';
  return {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
    body: cos,
  };
}

function volJson(headers) {
  const a = String(headers["accept"] || headers["Accept"] || "");
  const x = String(headers["x-requested-with"] || headers["X-Requested-With"] || "");
  return a.includes("application/json") || x === "fetch";
}

function parseBody(raw, contentType) {
  const ct = String(contentType || "").toLowerCase();
  if (ct.includes("application/json")) {
    return JSON.parse(raw);
  }
  // application/x-www-form-urlencoded (enviament natiu sense JS)
  const out = {};
  const params = new URLSearchParams(raw);
  for (const [k, v] of params) out[k] = v;
  return out;
}

/* La IP arriba en capçaleres diferents segons la plataforma. Es pren la
 * primera de X-Forwarded-For, que és la del client real quan el proxy és de
 * confiança (ho és: és el propi hosting davant de la funció). */
export function clientIp(headers) {
  const h = (n) => headers[n] || headers[n.toLowerCase()] || headers[n.toUpperCase()] || "";
  const cand =
    h("cf-connecting-ip") ||
    h("x-real-ip") ||
    String(h("x-forwarded-for")).split(",")[0] ||
    "";
  return String(cand).trim() || null;
}

/* req = { method, headers (objecte pla en minúscules), rawBody (string), env, ip } */
export async function handleAlta(req) {
  const headers = req.headers || {};
  const wantsJson = volJson(headers);
  const respond = (status, obj, extra) =>
    wantsJson ? json(status, obj, extra) : html(status, obj.message || MISSATGES.server);

  if (req.method !== "POST") {
    return respond(405, { ok: false, message: MISSATGES.method }, { Allow: "POST" });
  }

  if (!isAcceptedFormContentType(headers["content-type"])) {
    return respond(415, { ok: false, message: MISSATGES.invalid });
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

  // Origen: si està configurat, es rebutja el POST que no vinga del nostre lloc.
  // Ajuda contra formularis clonats en altres dominis que apunten ací.
  const permes = req.env && req.env.ALLOWED_ORIGIN;
  const origin = headers["origin"];
  if (!isAllowedOrigin(origin, permes, req.env || {})) {
    console.warn("[alta] origen no permès");
    return respond(403, { ok: false, message: MISSATGES.invalid });
  }

  // Anti-spam: al bot li diem que tot ha anat bé i no escrivim res enlloc.
  // Si li donàrem un error, provaria una altra combinació fins encertar.
  if (isSpam(input)) {
    console.warn("[alta] descartada per filtre anti-spam");
    return respond(200, { ok: true, message: MISSATGES.ok });
  }

  const ip = req.ip || clientIp(headers);
  const rl = rateCheck(ip, "alta");
  if (!rl.ok) {
    console.warn("[alta] límit de peticions superat");
    return respond(429, { ok: false, message: MISSATGES.rate }, { "Retry-After": String(rl.retryAfter) });
  }

  const v = validate(input);
  if (!v.ok) {
    // Es registren només els NOMS dels camps invàlids, mai els valors.
    console.warn("[alta] validació fallida:", Object.keys(v.errors).join(","));
    return respond(400, { ok: false, message: MISSATGES.invalid, errors: v.errors });
  }

  try {
    await appendRow(v.data, req.env || {});
  } catch (e) {
    // e.message pot incloure text de Sheets, però mai els valors del formulari
    // (sheets.js retalla el missatge i no hi afig el cos enviat).
    console.error("[alta] error en registrar:", e.code || "ERR", e.message);
    return respond(502, { ok: false, message: MISSATGES.server });
  }

  console.info("[alta] sol·licitud registrada correctament");
  return respond(200, { ok: true, message: MISSATGES.ok });
}

/* Els ajudants d'HTTP s'exporten perquè handler-reserva.js els reutilitze:
 * així les dues respostes (alta i reserva) tenen exactament les mateixes
 * capçaleres de seguretat i el mateix comportament sense JS. */
export { MISSATGES, json, html, volJson, parseBody, MAX_BODY };
