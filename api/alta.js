/* Adaptador Vercel (Serverless Function, runtime Node).
 * Ruta pública resultant: POST /api/alta
 *
 * Només tradueix la petició de Vercel al format del nucli. Tota la lògica
 * (validació, anti-spam, límit de peticions, Notion) viu a api/_lib/handler.js.
 * Les carpetes que comencen per "_" no es publiquen com a ruta, per això _lib.
 */
import { handleAlta } from "./_lib/handler.js";

// Cal el cos cru: el nucli decidix si és JSON o urlencoded.
export const config = { api: { bodyParser: false } };

function llegirCos(req) {
  return new Promise((resolve, reject) => {
    let dades = "";
    req.on("data", (c) => {
      dades += c;
      if (dades.length > 64 * 1024) req.destroy(); // tall dur abans d'acumular memòria
    });
    req.on("end", () => resolve(dades));
    req.on("error", reject);
  });
}

export default async function (req, res) {
  const rawBody = await llegirCos(req).catch(() => "");
  const r = await handleAlta({
    method: req.method,
    headers: req.headers,
    rawBody,
    env: process.env,
  });
  for (const [k, v] of Object.entries(r.headers)) res.setHeader(k, v);
  res.status(r.status).send(r.body);
}
