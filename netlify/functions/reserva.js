/* Adaptador Netlify Functions.
 * Ruta pública: POST /.netlify/functions/reserva
 * Amb la redirecció de netlify.toml queda també com a POST /api/reserva.
 *
 * Només tradueix la petició; la lògica viu a api/_lib/handler-reserva.js.
 */
import { handleReserva } from "../../api/_lib/handler-reserva.js";

export const handler = async (event) => {
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf8")
    : event.body || "";

  const r = await handleReserva({
    method: event.httpMethod,
    headers: event.headers || {},
    rawBody,
    env: process.env,
  });

  return { statusCode: r.status, headers: r.headers, body: r.body };
};
