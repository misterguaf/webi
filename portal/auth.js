/* Sessió compartida del portal. La cookie només acredita que s'ha introduït
 * la clau del curs; no identifica cap família i no conté dades personals. */

const COOKIE = "__Host-parpallo_portal";
const DEV_COOKIE = "parpallo_portal_dev";
const DURADA_SEGONS = 24 * 60 * 60;
const encoder = new TextEncoder();

function b64url(bytes) {
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromB64url(text) {
  const normal = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(normal + "=".repeat((4 - (normal.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(text)));
}

async function digest(text) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

function igualConstant(a, b) {
  if (a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i++) diferencia |= a[i] ^ b[i];
  return diferencia === 0;
}

export async function contrasenyaCorrecta(candidata, env) {
  if (!env || !env.PORTAL_ACCESS_PASSWORD || typeof candidata !== "string") return false;
  const [a, b] = await Promise.all([digest(candidata), digest(env.PORTAL_ACCESS_PASSWORD)]);
  return igualConstant(a, b);
}

function nomCookie(env) {
  return env && env.PORTAL_DEV_ALLOW_HTTP === "1" ? DEV_COOKIE : COOKIE;
}

export function cookieDe(request, env) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [nom, ...rest] = part.trim().split("=");
    if (nom === nomCookie(env)) return rest.join("=");
  }
  return "";
}

export async function creaSessio(env, ara = Date.now()) {
  if (!env || !env.PORTAL_SESSION_SECRET) throw new Error("PORTAL_SESSION_SECRET no configurat");
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  const payload = {
    exp: Math.floor(ara / 1000) + DURADA_SEGONS,
    ver: String(env.PORTAL_SESSION_VERSION || "1"),
    csrf: b64url(bytes),
  };
  const cos = b64url(encoder.encode(JSON.stringify(payload)));
  const firma = b64url(await hmac(env.PORTAL_SESSION_SECRET, cos));
  return { token: cos + "." + firma, payload };
}

export async function verificaSessio(token, env, ara = Date.now()) {
  if (!token || !env || !env.PORTAL_SESSION_SECRET) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  let firma;
  let payload;
  try {
    firma = fromB64url(parts[1]);
    const esperada = await hmac(env.PORTAL_SESSION_SECRET, parts[0]);
    if (!igualConstant(firma, esperada)) return null;
    payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[0])));
  } catch (_) {
    return null;
  }
  if (!payload || payload.exp <= Math.floor(ara / 1000)) return null;
  if (String(payload.ver) !== String(env.PORTAL_SESSION_VERSION || "1")) return null;
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(String(payload.csrf || ""))) return null;
  return payload;
}

export function capcaleraCookie(token, env) {
  const secure = !(env && env.PORTAL_DEV_ALLOW_HTTP === "1");
  return `${nomCookie(env)}=${token}; Max-Age=${DURADA_SEGONS}; Path=/; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
}

export function esborraCookie(env) {
  const secure = !(env && env.PORTAL_DEV_ALLOW_HTTP === "1");
  return `${nomCookie(env)}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
}

export { COOKIE, DURADA_SEGONS };
