const encoder = new TextEncoder();
import { createSessionStatement, findSession, touchSession } from './domains/auth/repository.js';
export const IDLE_MS = 30 * 60 * 1000;
export const ABSOLUTE_MS = 8 * 60 * 60 * 1000;
export const DEV_ISSUER = 'urn:parpallo:local-synthetic';

export function assertEnvironment(env) {
  if (env.APP_ENV === 'production' && env.DEV_IDENTITY_PROVIDER === 'enabled') {
    throw new Error('DEV_IDENTITY_PROVIDER cannot be enabled in production');
  }
  if (!['development', 'production'].includes(env.APP_ENV)) throw new Error('APP_ENV invalid');
  if (!env.DB) throw new Error('D1 binding missing');
  if (env.APP_ENV === 'production' && (!env.ACCESS_ISSUER || !env.ACCESS_AUDIENCE)) {
    throw new Error('Access issuer/audience missing');
  }
}

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const unb64url = (value) => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0));
export async function sha256(value) { return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))); }

export async function verifyAccessJwt(token, { issuer, audience, jwks, now = Date.now() }) {
  if (typeof token !== 'string' || token.length > 8192) throw new Error('invalid token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('invalid token');
  let header, claims;
  try {
    header = JSON.parse(new TextDecoder().decode(unb64url(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(unb64url(parts[1])));
  } catch { throw new Error('invalid token'); }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid ||
      claims.iss !== issuer || !Array.isArray(claims.aud) || !claims.aud.includes(audience) ||
      claims.type !== 'app' || typeof claims.sub !== 'string' || !claims.sub ||
      !Number.isInteger(claims.exp) || claims.exp * 1000 <= now ||
      !Number.isInteger(claims.nbf) || claims.nbf * 1000 > now ||
      !Number.isInteger(claims.iat) || claims.iat * 1000 > now + 60_000) throw new Error('invalid token');
  const key = jwks?.keys?.find(item => item.kid === header.kid && item.kty === 'RSA' && item.use === 'sig' && item.alg === 'RS256');
  if (!key) throw new Error('invalid token');
  try {
    const imported = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', imported, unb64url(parts[2]), encoder.encode(`${parts[0]}.${parts[1]}`))) throw new Error('invalid token');
  } catch { throw new Error('invalid token'); }
  return { issuer: claims.iss, subject: claims.sub, email: typeof claims.email === 'string' ? claims.email : null };
}

export async function verifyAccessRequest(request, env, now = Date.now()) {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || !env.ACCESS_ISSUER || !env.ACCESS_AUDIENCE) throw new Error('invalid identity');
  const issuer = new URL(env.ACCESS_ISSUER);
  if (issuer.protocol !== 'https:' || !issuer.hostname.endsWith('.cloudflareaccess.com') || issuer.pathname !== '/' || issuer.search || issuer.hash) throw new Error('invalid issuer');
  const certUrl = new URL('/cdn-cgi/access/certs', issuer);
  const response = await fetch(certUrl, { redirect: 'error' });
  if (!response.ok) throw new Error('JWKS unavailable');
  const jwks = await response.json();
  return verifyAccessJwt(token, { issuer: issuer.origin, audience: env.ACCESS_AUDIENCE, jwks, now });
}

export function cookieName(url) { return ['localhost', '127.0.0.1'].includes(url.hostname) ? 'gestio_session' : '__Host-gestio_session'; }
export function cookieHeader(url, token, maxAge = Math.floor(ABSOLUTE_MS / 1000)) {
  const secure = cookieName(url).startsWith('__Host-') ? '; Secure' : '';
  return `${cookieName(url)}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}
export function cookieToken(request) {
  const name = cookieName(new URL(request.url));
  const value = request.headers.get('Cookie')?.split(';').map(p => p.trim()).find(p => p.startsWith(`${name}=`))?.slice(name.length + 1);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
export async function newSession(db, userId, now = Date.now()) {
  const session=await prepareNewSession(db,userId,now);
  await session.statement.run();
  return { id:session.id, token:session.token };
}
export async function prepareNewSession(db, userId, now = Date.now()) {
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const id = crypto.randomUUID();
  const statement=createSessionStatement(db,{id,userId,tokenHash:await sha256(token),now,absoluteMs:ABSOLUTE_MS});
  return { id, token, statement };
}
export async function getSession(db, token, now = Date.now()) {
  if (!token) return null;
  const row = await findSession(db,await sha256(token),now,IDLE_MS);
  if (!row) return null;
  const updated = await touchSession(db,row.session_id,now,IDLE_MS);
  return updated.meta.changes === 1 ? row : null;
}
