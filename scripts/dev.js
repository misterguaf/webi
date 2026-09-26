/* Servidor local de proves. NOMÉS per a desenvolupament: no és el que
 * servirà el lloc en producció (això ho farà el hosting que es trie).
 *
 * Serveix els fitxers estàtics de `site/` i atén POST /api/alta amb el mateix
 * nucli que s'executarà desplegat, així el que proves ací és el de veritat.
 *
 *   node scripts/dev.js              -> simula Sheets, no envia res enlloc
 *   node scripts/dev.js --fals       -> àlies explícit del mode segur
 *   node scripts/dev.js --real-egress -> integració real, amb doble opt-in
 *
 * El mode --fals permet provar tot el circuit (validació, errors, missatges,
 * lector de pantalla) sense crear cap fila real ni tocar dades de menors.
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleAlta } from "../api/_lib/handler.js";
import { handleReserva } from "../api/_lib/handler-reserva.js";
import { assertAllowedEgress } from "../api/_lib/environment.js";
import { MAX_BODY } from "../api/_lib/handler.js";

const RUTES = {
  "/api/alta": handleAlta,
  "/api/reserva": handleReserva,
};

const ARREL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = path.join(ARREL, "site");
const PORT = process.env.PORT || 4000;
const REAL_EGRESS = process.argv.includes("--real-egress");
const FALS = !REAL_EGRESS;
const OBRI_NAVEGADOR = process.argv.includes("--open");

if (REAL_EGRESS && process.argv.includes("--fals")) {
  throw new Error("No combines --fals i --real-egress.");
}

/* Càrrega mínima de .env, sense dependències. */
function carregaEnv() {
  const f = path.join(ARREL, ".env");
  if (!fs.existsSync(f)) return;
  for (const línia of fs.readFileSync(f, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(línia);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
if (REAL_EGRESS) carregaEnv();
// El servidor local sempre és desenvolupament, encara que un `.env` antic
// continga una altra etiqueta. Esta variable activa la guarda d'egress.
process.env.APP_ENV = "development";

if (REAL_EGRESS) {
  if (!process.env.SHEETS_WEBHOOK_URL || !process.env.SHEETS_SHARED_SECRET) {
    throw new Error("La integració real necessita SHEETS_WEBHOOK_URL i SHEETS_SHARED_SECRET.");
  }
  assertAllowedEgress(process.env.SHEETS_WEBHOOK_URL, process.env);
}

if (FALS) {
  const real = globalThis.fetch;
  const FALSA = "https://sheets.invalid/fake";
  const correlatius = new Map(); // activitat -> últim número donat
  const repetides = new Map(); // clau d'idempotència -> referència ja donada
  globalThis.fetch = async (url, opts) => {
    if (String(url) === FALSA) {
      let cos = {};
      try {
        cos = JSON.parse((opts && opts.body) || "{}");
      } catch (_) {}

      /* Les inscripcions esperen una resposta amb contingut: la referència
       * (el número d'inscripció) la genera l'Apps Script i el navegador la
       * pinta en pantalla. Si ací tornàrem un { ok: true } pelat, la
       * pantalla de confirmació eixiria buida i no es podria provar el
       * circuit sencer. Este simulacre fa el mateix que fa el script de
       * veritat: correlatiu per activitat i la mateixa referència si es
       * repetix la clau d'idempotència. No hi ha cap IBAN: el pagament ja
       * s'ha fet abans d'omplir el formulari. */
      if (cos.tipus === "inscripcio") {
        if (cos.comprovant && cos.comprovant.base64) {
          const kb = Math.round((cos.comprovant.base64.length * 3) / 4 / 1024);
          console.log(`  [fals] comprovant rebut (${cos.comprovant.tipus}, ~${kb} KB) — no es guarda enlloc en mode fals`);
        }
        if (repetides.has(cos.idempotencyKey)) {
          const ref = repetides.get(cos.idempotencyKey);
          console.log(`  [fals] enviament repetit: es torna la referència ${ref} i no s'escriu res`);
          return { ok: true, status: 200, json: async () => ({ ok: true, referencia: ref, duplicada: true }) };
        }
        const n = (correlatius.get(cos.activitatId) || 0) + 1;
        correlatius.set(cos.activitatId, n);
        const ref = `${cos.activitatId}-${cos.seccio}-${String(n).padStart(4, "0")}`;
        repetides.set(cos.idempotencyKey, ref);
        console.log(
          `  [fals] inscripció ${ref}` +
            (cos.proves ? " (pestanya de PROVES, sense correu)" : " (s'hauria enviat el correu de confirmació)")
        );
        return { ok: true, status: 200, json: async () => ({ ok: true, referencia: ref }) };
      }

      console.log("  [fals] s'hauria escrit una fila a Google Sheets (no s'ha enviat res)");
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    return real(url, opts);
  };
  process.env.SHEETS_WEBHOOK_URL = process.env.SHEETS_WEBHOOK_URL || FALSA;
  process.env.SHEETS_SHARED_SECRET = process.env.SHEETS_SHARED_SECRET || "fals";
}

const TIPUS = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");

    const nucli = RUTES[url.pathname];
    if (nucli) {
      const declarat = Number(req.headers["content-length"]);
      if (Number.isFinite(declarat) && declarat > MAX_BODY) {
        req.resume();
        res.writeHead(413, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end('{"ok":false}');
        return;
      }
      let bytes = 0;
      let massaGran = false;
      const fragments = [];
      req.on("data", (fragment) => {
        if (massaGran) return;
        bytes += fragment.length;
        if (bytes > MAX_BODY) {
          massaGran = true;
          fragments.length = 0;
          res.writeHead(413, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }).end('{"ok":false}');
          return;
        }
        fragments.push(fragment);
      });
      req.on("end", async () => {
        if (massaGran) return;
        const cos = Buffer.concat(fragments).toString("utf8");
        const r = await nucli({
          method: req.method,
          headers: req.headers,
          rawBody: cos,
          env: process.env,
        });
        res.writeHead(r.status, r.headers).end(r.body);
      });
      return;
    }

    // Fitxers estàtics, amb el mateix normalitzat que evita eixir de l'arrel.
    let rel = decodeURIComponent(url.pathname);
    if (rel === "/") rel = "/index.html";
    const fitxer = path.join(SITE, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
    if (!fitxer.startsWith(SITE + path.sep) || !fs.existsSync(fitxer) || fs.statSync(fitxer).isDirectory()) {
      // Es serveix 404.html, com farà el hosting en producció, per a poder
      // provar-la en local. Si algun dia no hi fóra, es cau al text pelat.
      const pagina404 = path.join(SITE, "404.html");
      if (fs.existsSync(pagina404)) {
        res
          .writeHead(404, { "Content-Type": "text/html; charset=utf-8" })
          .end(fs.readFileSync(pagina404));
      } else {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("404");
      }
      return;
    }
    res
      .writeHead(200, { "Content-Type": TIPUS[path.extname(fitxer)] || "application/octet-stream" })
      .end(fs.readFileSync(fitxer));
  })
  .listen(PORT, "127.0.0.1", () => {
    const url = `http://localhost:${PORT}/`;
    console.log(`Web general en desenvolupament: ${url}`);
    console.log(FALS ? "Mode SEGUR: dades sintètiques i Google Sheets simulat; no hi ha egress." : "ATENCIÓ — INTEGRACIÓ REAL autoritzada per opt-in i allowlist.");
    if (OBRI_NAVEGADOR) {
      if (process.platform === "darwin") {
        const browser = spawn("open", [url], { stdio: "ignore", detached: true });
        browser.unref();
      } else {
        console.log(`Obri esta adreça al navegador: ${url}`);
      }
    }
  });
