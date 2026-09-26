/* Endpoint de la quota anual. Comparteix les garanties del formulari
 * d'activitats, però demana menys dades i permet agrupar germans. */

import { validateQuota } from "./quota.js";
import { configuracioQuota } from "./cuotes.js";
import { isSpam } from "./validate.js";
import { check as rateCheck } from "./ratelimit.js";
import { appendQuota } from "./sheets.js";
import { json, html, volJson, parseBody, clientIp } from "./handler.js";
import { isJsonContentType } from "./http-body.js";
import { isAllowedOrigin } from "./environment.js";

const MAX_BODY_QUOTA = 8 * 1024 * 1024;

const MISSATGES = {
  ok: {
    va: "Hem rebut el comprovant de la quota. Tresoreria el revisarà i t'escriurà quan quede confirmat.",
    es: "Hemos recibido el comprobante de la cuota. Tesorería lo revisará y te escribirá cuando quede confirmado.",
  },
  invalid: { va: "Revisa les dades marcades i torna a provar.", es: "Revisa los datos marcados e inténtalo de nuevo." },
  tancada: {
    va: "La quota anual encara no està oberta o falta confirmar-ne les dades.",
    es: "La cuota anual todavía no está abierta o falta confirmar sus datos.",
  },
  rate: {
    va: "Has enviat massa formularis seguits. Prova d'ací a una estona.",
    es: "Has enviado demasiados formularios seguidos. Inténtalo dentro de un rato.",
  },
  server: {
    va: "No hem pogut registrar la quota. Les dades segueixen ací: torna a provar o escriu-nos.",
    es: "No hemos podido registrar la cuota. Los datos siguen aquí: inténtalo de nuevo o escríbenos.",
  },
  method: { va: "Mètode no permès.", es: "Método no permitido." },
};

export async function handleQuota(req, config = configuracioQuota()) {
  const headers = req.headers || {};
  const wantsJson = volJson(headers);
  const respond = (status, obj, extra) =>
    wantsJson ? json(status, obj, extra) : html(status, obj.message || MISSATGES.server);

  if (req.method !== "POST") {
    return respond(405, { ok: false, message: MISSATGES.method }, { Allow: "POST" });
  }

  if (!isJsonContentType(headers["content-type"])) {
    return respond(415, { ok: false, message: MISSATGES.invalid });
  }

  const raw = req.rawBody || "";
  if (raw.length > MAX_BODY_QUOTA) return respond(413, { ok: false, message: MISSATGES.invalid });

  let input;
  try {
    input = parseBody(raw, headers["content-type"]);
  } catch (_) {
    return respond(400, { ok: false, message: MISSATGES.invalid });
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return respond(400, { ok: false, message: MISSATGES.invalid });
  }

  const permes = req.env && (req.env.PORTAL_ALLOWED_ORIGIN || req.env.ALLOWED_ORIGIN);
  if (!isAllowedOrigin(headers.origin, permes, req.env || {})) {
    console.warn("[quota] origen no permès");
    return respond(403, { ok: false, message: MISSATGES.invalid });
  }

  if (isSpam(input)) {
    console.warn("[quota] descartada pel filtre anti-spam");
    return respond(200, { ok: true, message: MISSATGES.ok });
  }

  const rl = rateCheck(req.ip || clientIp(headers), "quota");
  if (!rl.ok) {
    return respond(429, { ok: false, message: MISSATGES.rate }, { "Retry-After": String(rl.retryAfter) });
  }

  const v = validateQuota(input, config);
  if (!v.ok) {
    const tancada = Boolean(v.errors.quota);
    console.warn("[quota] validació fallida:", Object.keys(v.errors).join(","));
    return respond(tancada ? 409 : 400, {
      ok: false,
      message: tancada ? MISSATGES.tancada : MISSATGES.invalid,
      errors: v.errors,
    });
  }

  try {
    const resultat = await appendQuota(v.data, req.env || {});
    console.info("[quota] quota registrada correctament");
    return respond(200, {
      ok: true,
      message: MISSATGES.ok,
      referencia: resultat.referencia,
      totalText: v.data.totalText,
      curs: v.data.curs,
    });
  } catch (e) {
    console.error("[quota] error en registrar:", e.code || "ERR", e.message);
    return respond(502, { ok: false, message: MISSATGES.server });
  }
}

export { MISSATGES as QUOTA_HANDLER_MSG };
