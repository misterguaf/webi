/* Servidor local de proves. NOMÉS per a desenvolupament: no és el que
 * servirà el lloc en producció (això ho farà el hosting que es trie).
 *
 * Serveix els fitxers estàtics de l'arrel i atén POST /api/alta amb el mateix
 * nucli que s'executarà desplegat, així el que proves ací és el de veritat.
 *
 *   node scripts/dev.js              -> escriu a Notion de veritat (llig .env)
 *   node scripts/dev.js --fals       -> simula Notion, no envia res enlloc
 *
 * El mode --fals permet provar tot el circuit (validació, errors, missatges,
 * lector de pantalla) sense crear cap fitxa real ni tocar dades de menors.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleAlta } from "../api/_lib/handler.js";

const ARREL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.PORT || 4000;
const FALS = process.argv.includes("--fals");

/* Càrrega mínima de .env, sense dependències. */
function carregaEnv() {
  const f = path.join(ARREL, ".env");
  if (!fs.existsSync(f)) return;
  for (const línia of fs.readFileSync(f, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(línia);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
carregaEnv();

if (FALS) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes("api.notion.com")) {
      console.log("  [fals] s'hauria escrit una fitxa a Notion (no s'ha enviat res)");
      return { ok: true, status: 200, json: async () => ({ id: "fitxa-falsa" }) };
    }
    return real(url, opts);
  };
  process.env.NOTION_TOKEN = process.env.NOTION_TOKEN || "fals";
  process.env.NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID || "0".repeat(32);
}

const TIPUS = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");

    if (url.pathname === "/api/alta") {
      let cos = "";
      req.on("data", (c) => (cos += c));
      req.on("end", async () => {
        const r = await handleAlta({
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
    const fitxer = path.join(ARREL, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
    if (!fitxer.startsWith(ARREL) || !fs.existsSync(fitxer) || fs.statSync(fitxer).isDirectory()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("404");
      return;
    }
    res
      .writeHead(200, { "Content-Type": TIPUS[path.extname(fitxer)] || "application/octet-stream" })
      .end(fs.readFileSync(fitxer));
  })
  .listen(PORT, () => {
    console.log(`Parpalló en desenvolupament: http://localhost:${PORT}/fersescout.html`);
    console.log(FALS ? "Mode FALS: Notion simulat, no s'envia cap dada." : "Notion REAL: les fitxes s'escriuran de veritat.");
  });
