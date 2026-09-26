import { handleQuota } from "../api/_lib/handler-quota.js";
import { configuracioPublica } from "../api/_lib/cuotes.js";
import { check as rateCheck } from "../api/_lib/ratelimit.js";
import { isSpam } from "../api/_lib/validate.js";
import { publicActivities } from "../gestio/src/services/activity-service.js";
import { submitRegistration } from "../gestio/src/services/registration-service.js";
import { AppError } from "../gestio/src/services/common.js";
import {
  capcaleraCookie,
  contrasenyaCorrecta,
  cookieDe,
  creaSessio,
  esborraCookie,
  verificaSessio,
} from "./auth.js";
import { BodyTooLargeError, isJsonContentType, readRequestBody } from "../api/_lib/http-body.js";
import { isAllowedOrigin } from "../api/_lib/environment.js";

const MAX_SESSION_BODY = 2 * 1024;
const MAX_PRIVATE_FORM_BODY = 8 * 1024 * 1024;
const ACTIVITY_FORM_FIELDS = new Set([
  "participantNom", "participantCognoms", "naixement", "seccio", "activitatId", "tutor", "telefon", "email",
  "participacio", "privacitat", "idioma", "idempotencyKey", "malnom", "_ts", "comprovant", "transportCode",
]);
const ACTIVITY_SECTION_CODES = { EST: "MANADA", TRO: "TROPA", ESC: "ESCOLTA", CLA: "CLAN" };
const ACTIVITY_RECEIVED = {
  va: "Hem rebut la sol·licitud. La revisarem i, si cal, et contactarem. Esta resposta no confirma una plaça.",
  es: "Hemos recibido la solicitud. La revisaremos y, si hace falta, te contactaremos. Esta respuesta no confirma una plaza.",
};
const ACTIVITY_REVIEW = {
  va: "Revisa les dades marcades i torna a provar.",
  es: "Revisa los datos marcados e inténtalo de nuevo.",
};

const SEGURETAT = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'",
};

function ambSeguretat(response, extra) {
  const headers = new Headers(response.headers);
  for (const [nom, valor] of Object.entries(SEGURETAT)) headers.set(nom, valor);
  for (const [nom, valor] of Object.entries(extra || {})) headers.set(nom, valor);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function respostaJson(status, body, extra) {
  return ambSeguretat(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    }),
    extra
  );
}

function ipDe(request) {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || null;
}

function capcaleresPlanes(request) {
  const headers = {};
  for (const [k, v] of request.headers) headers[k.toLowerCase()] = v;
  return headers;
}

function origenCorrecte(request, env) {
  const esperat = env.PORTAL_ALLOWED_ORIGIN;
  const url=new URL(request.url);
  if (env.APP_ENV==="development" && ["localhost","127.0.0.1"].includes(url.hostname)) {
    return request.headers.get("origin")===url.origin;
  }
  return isAllowedOrigin(request.headers.get("origin"), esperat, env);
}

async function asset(env, request, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  return ambSeguretat(await env.ASSETS.fetch(new Request(url, request)));
}

async function sessioActual(request, env) {
  return verificaSessio(cookieDe(request, env), env);
}

async function gestionaSessio(request, env) {
  if (request.method === "GET") {
    const sessio = await sessioActual(request, env);
    return respostaJson(sessio ? 200 : 401, sessio ? { ok: true, csrf: sessio.csrf } : { ok: false });
  }

  if (request.method === "DELETE") {
    const sessio = await sessioActual(request, env);
    if (!sessio || !origenCorrecte(request, env) || request.headers.get("x-csrf-token") !== sessio.csrf) {
      return respostaJson(403, { ok: false });
    }
    return respostaJson(200, { ok: true }, { "Set-Cookie": esborraCookie(env) });
  }

  if (request.method !== "POST") return respostaJson(405, { ok: false }, { Allow: "GET, POST, DELETE" });
  if (!origenCorrecte(request, env)) return respostaJson(403, { ok: false });

  const ip = ipDe(request);
  const cloudflareLimit = env.PORTAL_LOGIN_LIMITER
    ? await env.PORTAL_LOGIN_LIMITER.limit({ key: ip || "sense-ip" })
    : { success: true };
  const limit = rateCheck(ip, "portal");
  if (!cloudflareLimit.success || !limit.ok) {
    return respostaJson(429, {
      ok: false,
      message: {
        va: "Massa intents seguits. Espera un minut i torna-ho a provar.",
        es: "Demasiados intentos seguidos. Espera un minuto e inténtalo de nuevo.",
      },
    }, { "Retry-After": String(limit.retryAfter) });
  }

  if (!isJsonContentType(request.headers.get("content-type"))) {
    return respostaJson(415, { ok: false });
  }

  let body;
  try {
    body = JSON.parse(await readRequestBody(request, MAX_SESSION_BODY));
  } catch (error) {
    if (error instanceof BodyTooLargeError) return respostaJson(413, { ok: false });
    return respostaJson(400, { ok: false });
  }

  if (!(await contrasenyaCorrecta(body && body.password, env))) {
    return respostaJson(401, {
      ok: false,
      message: { va: "La contrasenya no és correcta.", es: "La contraseña no es correcta." },
    });
  }

  try {
    const creada = await creaSessio(env);
    return respostaJson(200, { ok: true, csrf: creada.payload.csrf }, { "Set-Cookie": capcaleraCookie(creada.token, env) });
  } catch (_) {
    console.error("[portal] configuració de sessió incompleta");
    return respostaJson(503, {
      ok: false,
      message: { va: "El portal encara no està configurat.", es: "El portal todavía no está configurado." },
    });
  }
}

async function passaFormulari(request, env, handler, sessio) {
  if (!origenCorrecte(request, env)) return respostaJson(403, { ok: false });
  if (request.headers.get("x-csrf-token") !== sessio.csrf) return respostaJson(403, { ok: false });
  if (!isJsonContentType(request.headers.get("content-type"))) return respostaJson(415, { ok: false });
  let rawBody;
  try {
    rawBody = await readRequestBody(request, MAX_PRIVATE_FORM_BODY);
  } catch (error) {
    if (error instanceof BodyTooLargeError) return respostaJson(413, { ok: false });
    throw error;
  }
  const r = await handler({
    method: request.method,
    headers: capcaleresPlanes(request),
    rawBody,
    env: Object.assign({}, env, { ALLOWED_ORIGIN: env.PORTAL_ALLOWED_ORIGIN }),
    ip: ipDe(request),
  });
  return ambSeguretat(new Response(r.body, { status: r.status, headers: r.headers }));
}

function portalLocalSintetic(request,env) {
  return env.APP_ENV === "development" && ["localhost","127.0.0.1"].includes(new URL(request.url).hostname) &&
    !!env.DB && !!env.EVIDENCE_STORAGE;
}

async function passaInscripcioFase3A(request,env,sessio) {
  if (request.method!=="POST") return respostaJson(405,{ok:false,message:ACTIVITY_REVIEW},{Allow:"POST"});
  if (!origenCorrecte(request,env)) return respostaJson(403,{ok:false,message:ACTIVITY_REVIEW});
  if (request.headers.get("x-csrf-token") !== sessio.csrf) return respostaJson(403,{ok:false,message:ACTIVITY_REVIEW});
  if (!isJsonContentType(request.headers.get("content-type"))) return respostaJson(415,{ok:false,message:ACTIVITY_REVIEW});
  if (!portalLocalSintetic(request,env)) return respostaJson(503,{ok:false,code:"LOCAL_SYNTHETIC_ONLY"});

  let body;
  try {
    body=JSON.parse(await readRequestBody(request,MAX_PRIVATE_FORM_BODY));
  } catch(error) {
    if (error instanceof BodyTooLargeError) return respostaJson(413,{ok:false,message:ACTIVITY_REVIEW});
    return respostaJson(400,{ok:false,message:ACTIVITY_REVIEW});
  }
  if (!body || typeof body!=="object" || Array.isArray(body)) return respostaJson(400,{ok:false,message:ACTIVITY_REVIEW});
  // Keep the existing honeypot/minimum-fill-time behavior and its non-enumerating response.
  if (isSpam(body)) return respostaJson(202,{ok:true,message:ACTIVITY_RECEIVED});

  const limit=rateCheck(ipDe(request),"inscripcio");
  if (!limit.ok) return respostaJson(429,{ok:false,message:ACTIVITY_REVIEW},{"Retry-After":String(limit.retryAfter)});
  if (Object.keys(body).some(key=>!ACTIVITY_FORM_FIELDS.has(key)) ||
      body.participacio!==true || body.privacitat!==true) {
    return respostaJson(400,{ok:false,message:ACTIVITY_REVIEW});
  }

  const evidence=body.comprovant && typeof body.comprovant==="object" ? {
    filename:body.comprovant.nom,mime:body.comprovant.tipus,dataBase64:body.comprovant.base64,
  } : undefined;
  const sectionCode=ACTIVITY_SECTION_CODES[body.seccio];
  const input={
    publicCode:body.activitatId,
    participantName:[body.participantNom,body.participantCognoms].filter(value=>typeof value==="string").join(" ").trim(),
    birthDate:body.naixement,
    submittedByName:body.tutor,
    contactPhone:body.telefon,
    sectionCode,
    transportCode:body.transportCode||null,
    participationTermsVersion:"DEMO-3A-PARTICIPATION-V1",
    privacyNoticeVersion:"DEMO-3A-PRIVACY-NOTICE-V1",
    receiptEmail:body.email,
    idempotencyKey:body.idempotencyKey,
    ...(evidence?{evidence}:{}),
  };
  try {
    await submitRegistration(env.DB,env.EVIDENCE_STORAGE,input,crypto.randomUUID());
    return respostaJson(202,{ok:true,message:ACTIVITY_RECEIVED});
  } catch(error) {
    if (!(error instanceof AppError)) console.error("[portal] activity submission failed",{name:error?.name});
    const message=error.code==="evidence_required"
      ? {va:"Esta activitat requerix el justificant de pagament.",es:"Esta actividad requiere el justificante de pago."}
      : error.code==="invalid_evidence" || error.code==="evidence_too_large" || error.code==="synthetic_evidence_required"
        ? {va:"No hem pogut acceptar el fitxer de prova. Revisa el tipus, la mida i que siga un fixture sintètic.",
          es:"No hemos podido aceptar el archivo de prueba. Revisa el tipo, el tamaño y que sea un fixture sintético."}
        : ACTIVITY_REVIEW;
    return respostaJson(error instanceof AppError?error.status:500,{ok:false,code:error instanceof AppError?error.code:"internal_error",message});
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/portal/session") return gestionaSessio(request, env);

    const sessio = await sessioActual(request, env);
    if (!sessio) {
      if (url.pathname === "/portal.css" || url.pathname === "/access.js" || url.pathname === "/cierva-parpallo.png") {
        return asset(env, request, url.pathname);
      }
      if (url.pathname.startsWith("/api/")) return respostaJson(401, { ok: false, code: "SESSION_REQUIRED" });
      return asset(env, request, "/access.html");
    }

    if (url.pathname === "/api/portal/config" && request.method === "GET") {
      if (!portalLocalSintetic(request,env)) return respostaJson(503,{ok:false,code:"LOCAL_SYNTHETIC_ONLY"});
      try {
        return respostaJson(200,{ok:true,activitats:await publicActivities(env.DB),quota:configuracioPublica()});
      } catch(error) {
        if (!(error instanceof AppError)) console.error("[portal] activity catalogue unavailable",{name:error?.name});
        return respostaJson(error instanceof AppError?error.status:503,{ok:false,code:error.code||"CATALOG_UNAVAILABLE"});
      }
    }
    if (url.pathname === "/api/inscripcio") return passaInscripcioFase3A(request,env,sessio);
    if (url.pathname === "/api/cuota") return passaFormulari(request, env, handleQuota, sessio);
    if (url.pathname.startsWith("/api/")) return respostaJson(404, { ok: false });

    if (url.pathname === "/" || url.pathname === "/access.html") return asset(env, request, "/index.html");
    return asset(env, request, url.pathname);
  },
};
