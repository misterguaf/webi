/* Grup Scout Parpalló — rate limiting bàsic de l'endpoint d'alta.
 *
 * Objectiu modest i honest: que ningú puga inundar la llista d'espera del grup
 * amb milers d'enviaments automàtics. NO és una defensa contra un atac
 * distribuït seriós; per a això cal el WAF del hosting.
 *
 * Implementació en memòria del procés (finestra lliscant). Limitació coneguda:
 * en serverless cada instància té la seua memòria i les instàncies es reciclen,
 * així que el límit és aproximat. És suficient per a este cas d'ús. Si algun
 * dia calguera un límit exacte i compartit, la peça a canviar és només este
 * fitxer (Cloudflare KV / Durable Object, Upstash Redis, etc.).
 */

const PER_ENDPOINT = {
  alta: { max: 5, windowMs: 60 * 60 * 1000 },
  reserva: { max: 10, windowMs: 60 * 60 * 1000 },
  inscripcio: { max: 3, windowMs: 60 * 60 * 1000 },
  quota: { max: 3, windowMs: 60 * 60 * 1000 },
  portal: { max: 5, windowMs: 60 * 1000 },
};
const GLOBAL = { max: 60, windowMs: 60 * 60 * 1000 };  // vàlvula de seguretat global

const hits = new Map();
let global = [];

function podar(llista, ara, windowMs) {
  const tall = ara - windowMs;
  let i = 0;
  while (i < llista.length && llista[i] <= tall) i++;
  return i ? llista.slice(i) : llista;
}

/* Neteja periòdica perquè el Map no cresca sense fi si el procés viu molt. */
function escombra(ara) {
  if (hits.size < 500) return;
  for (const [k, v] of hits) {
    if (!v.length || v[v.length - 1] <= ara - 60 * 60 * 1000) hits.delete(k);
  }
}

/* Retorna { ok, retryAfter } — retryAfter en segons. */
export function check(ip, endpoint = "alta") {
  const ara = Date.now();
  const limit = PER_ENDPOINT[endpoint] || PER_ENDPOINT.alta;

  global = podar(global, ara, GLOBAL.windowMs);
  if (global.length >= GLOBAL.max) {
    return { ok: false, retryAfter: Math.ceil((global[0] + GLOBAL.windowMs - ara) / 1000) };
  }

  // Sense IP fiable (proxy rar, execució local) no bloquegem per IP: només
  // queda el límit global. Preferim no tancar la porta a una família real.
  const clau = ip ? `${endpoint}:${ip}` : null;
  if (clau) {
    const prev = podar(hits.get(clau) || [], ara, limit.windowMs);
    if (prev.length >= limit.max) {
      hits.set(clau, prev);
      return { ok: false, retryAfter: Math.ceil((prev[0] + limit.windowMs - ara) / 1000) };
    }
    prev.push(ara);
    hits.set(clau, prev);
  }

  global.push(ara);
  escombra(ara);
  return { ok: true, retryAfter: 0 };
}

/* Només per a proves. */
export function _reset() {
  hits.clear();
  global = [];
}
