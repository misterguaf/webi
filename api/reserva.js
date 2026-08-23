/* Adaptador Vercel (Serverless Function, runtime Node).
 * Ruta pública resultant: POST /api/reserva
 *
 * Bessó de api/alta.js: només tradueix la petició de Vercel al format del
 * nucli. Tota la lògica viu a api/_lib/handler-reserva.js.
 */
import { handleReserva } from "./_lib/handler-reserva.js";

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
  const r = await handleReserva({
    method: req.method,
    headers: req.headers,
    rawBody,
    env: process.env,
  });
  for (const [k, v] of Object.entries(r.headers)) res.setHeader(k, v);
  res.status(r.status).send(r.body);
}
