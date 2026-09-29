/* Public family portal. It has NO database or object-storage binding: every read or write of
 * Gestió data goes through the narrow PortalIntake service binding (env.GESTIO_INTAKE), which
 * exposes only the catalogue, activity registration and annual-fee declaration (audit A1). */
import { check as rateCheck } from "../api/_lib/ratelimit.js";
import { isSpam } from "../api/_lib/validate.js";
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
const FEE_FORM_FIELDS = new Set(["fills","tutor","telefon","email","privacitat","idioma",
  "idempotencyKey","malnom","_ts","comprovant","roundCode","declaredAmountCents"]);
const ACTIVITY_SECTION_CODES = { EST: "MANADA", TRO: "TROPA", ESC: "ESCOLTA", CLA: "CLAN" };
const ACTIVITY_RECEIVED = {
  va: "Hem rebut la sol·licitud. La revisarem i, si cal, et contactarem. Esta resposta no confirma una plaça.",
  es: "Hemos recibido la solicitud. La revisaremos y, si hace falta, te contactaremos. Esta respuesta no confirma una plaza.",
};
const ACTIVITY_REVIEW = {
  va: "Revisa les dades marcades i torna a provar.",
  es: "Revisa los datos marcados e inténtalo de nuevo.",
};
const FEE_RECEIVED = {
  va: "Hem rebut el justificant. Tresoreria revisarà la transferència i, si cal, es posarà en contacte amb vosaltres.",
  es: "Hemos recibido el justificante. Tesorería revisará la transferencia y, si hace falta, se pondrá en contacto con vosotros.",
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

const INTAKE_ORIGIN = "https://gestio-intake.internal/v1";

// Gestió decides whether intake is open (environment policy); the portal only fails closed when the
// binding is missing. The response body is Gestió's { ok, code, ... } contract.
async function intake(env, operation, body) {
  if (!env.GESTIO_INTAKE?.fetch) return { status: 503, data: { ok: false, code: "INTAKE_UNAVAILABLE" } };
  let response;
  try {
    response = await env.GESTIO_INTAKE.fetch(new Request(`${INTAKE_ORIGIN}/${operation}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}),
    }));
  } catch (error) {
    console.error("[portal] intake unavailable", { name: error?.name });
    return { status: 503, data: { ok: false, code: "INTAKE_UNAVAILABLE" } };
  }
  let data = null;
  try { data = await response.json(); } catch { data = { ok: false, code: "internal_error" }; }
  return { status: response.status, data };
}

async function passaInscripcioFase3A(request,env,sessio) {
  if (request.method!=="POST") return respostaJson(405,{ok:false,message:ACTIVITY_REVIEW},{Allow:"POST"});
  if (!origenCorrecte(request,env)) return respostaJson(403,{ok:false,message:ACTIVITY_REVIEW});
  if (request.headers.get("x-csrf-token") !== sessio.csrf) return respostaJson(403,{ok:false,message:ACTIVITY_REVIEW});
  if (!isJsonContentType(request.headers.get("content-type"))) return respostaJson(415,{ok:false,message:ACTIVITY_REVIEW});

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
    receiptEmail:body.email,
    idempotencyKey:body.idempotencyKey,
    participationAccepted:body.participacio===true,
    privacyAcknowledged:body.privacitat===true,
    ...(evidence?{evidence}:{}),
  };
  const result=await intake(env,"registrations",input);
  if (result.data?.ok) return respostaJson(202,{ok:true,message:ACTIVITY_RECEIVED});
  const code=result.data?.code||"internal_error";
  const message=code==="evidence_required"
    ? {va:"Esta activitat requerix el justificant de pagament.",es:"Esta actividad requiere el justificante de pago."}
    : code==="invalid_evidence" || code==="evidence_too_large" || code==="synthetic_evidence_required"
      ? {va:"No hem pogut acceptar el fitxer de prova. Revisa el tipus, la mida i que siga un fixture sintètic.",
        es:"No hemos podido aceptar el archivo de prueba. Revisa el tipo, el tamaño y que sea un fixture sintético."}
      : ACTIVITY_REVIEW;
  return respostaJson(result.status,{ok:false,code,message});
}

async function passaQuotaFase3B(request,env,sessio) {
  if (request.method!=="POST") return respostaJson(405,{ok:false,message:ACTIVITY_REVIEW},{Allow:"POST"});
  if (!origenCorrecte(request,env) || request.headers.get("x-csrf-token")!==sessio.csrf)
    return respostaJson(403,{ok:false,message:ACTIVITY_REVIEW});
  if (!isJsonContentType(request.headers.get("content-type"))) return respostaJson(415,{ok:false,message:ACTIVITY_REVIEW});
  let body;
  try {body=JSON.parse(await readRequestBody(request,MAX_PRIVATE_FORM_BODY));}
  catch(error) {return respostaJson(error instanceof BodyTooLargeError?413:400,{ok:false,message:ACTIVITY_REVIEW});}
  if (!body || typeof body!=="object" || Array.isArray(body)) return respostaJson(400,{ok:false,message:ACTIVITY_REVIEW});
  if (isSpam(body)) return respostaJson(202,{ok:true,message:FEE_RECEIVED});
  const limit=rateCheck(ipDe(request),"quota");
  if (!limit.ok) return respostaJson(429,{ok:false,message:ACTIVITY_REVIEW},{"Retry-After":String(limit.retryAfter)});
  if (Object.keys(body).some(key=>!FEE_FORM_FIELDS.has(key)) || body.privacitat!==true ||
      !Array.isArray(body.fills) || body.fills.some(person=>!person || typeof person!=="object" || Array.isArray(person) ||
        Object.keys(person).some(key=>!["nom","cognoms","naixement","seccio"].includes(key))))
    return respostaJson(400,{ok:false,message:ACTIVITY_REVIEW});
  const input={roundCode:body.roundCode,
    children:body.fills.map(person=>({name:[person.nom,person.cognoms].filter(value=>typeof value==="string").join(" ").trim(),
      birthDate:person.naixement,sectionCode:ACTIVITY_SECTION_CODES[person.seccio]})),
    submittedByName:body.tutor,contactPhone:body.telefon,receiptEmail:body.email,
    declaredAmountCents:body.declaredAmountCents??null,privacyAcknowledged:body.privacitat,
    idempotencyKey:body.idempotencyKey,
    evidence:body.comprovant && typeof body.comprovant==="object"
      ?{filename:body.comprovant.nom,mime:body.comprovant.tipus,dataBase64:body.comprovant.base64}:undefined};
  const result=await intake(env,"fees",input);
  if (result.data?.ok) return respostaJson(202,{ok:true,referencia:result.data.reference,message:FEE_RECEIVED});
  return respostaJson(result.status,{ok:false,code:result.data?.code||"internal_error",message:ACTIVITY_REVIEW});
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
      const result=await intake(env,"catalog");
      if (!result.data?.ok) return respostaJson(result.status>=500?503:result.status,{ok:false,code:result.data?.code||"CATALOG_UNAVAILABLE"});
      return respostaJson(200,{ok:true,activitats:result.data.activitats,quota:result.data.quota});
    }
    if (url.pathname === "/api/inscripcio") return passaInscripcioFase3A(request,env,sessio);
    if (url.pathname === "/api/cuota") return passaQuotaFase3B(request,env,sessio);
    if (url.pathname.startsWith("/api/")) return respostaJson(404, { ok: false });

    if (url.pathname === "/" || url.pathname === "/access.html") return asset(env, request, "/index.html");
    return asset(env, request, url.pathname);
  },
};
