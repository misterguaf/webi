/* Adaptador Netlify Functions.
 * Ruta pública: POST /.netlify/functions/alta
 * Amb la redirecció de netlify.toml queda també com a POST /api/alta.
 *
 * Només tradueix la petició; la lògica viu a api/_lib/handler.js.
 */
import { handleAlta } from "../../api/_lib/handler.js";

export const handler = async (event) => {
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf8")
    : event.body || "";

  const r = await handleAlta({
    method: event.httpMethod,
    headers: event.headers || {},
    rawBody,
    env: process.env,
  });

  return { statusCode: r.status, headers: r.headers, body: r.body };
};
