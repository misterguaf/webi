/* Adaptador Cloudflare Workers.
 * Desplegat amb wrangler.toml: POST /api/alta
 *
 * A Cloudflare les variables d'entorn arriben a `env`, no a process.env; per
 * això el nucli les rep sempre com a paràmetre en compte de llegir-les tot sol.
 */
import { handleAlta } from "./api/_lib/handler.js";
import { handleReserva } from "./api/_lib/handler-reserva.js";

const RUTES = {
  "/api/alta": handleAlta,
  "/api/reserva": handleReserva,
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const nucli = RUTES[url.pathname];
    if (!nucli) {
      return new Response("Not found", { status: 404 });
    }

    const headers = {};
    for (const [k, v] of request.headers) headers[k.toLowerCase()] = v;

    const rawBody = await request.text();
    const r = await nucli({
      method: request.method,
      headers,
      rawBody,
      env,
      ip: request.headers.get("cf-connecting-ip"),
    });

    return new Response(r.body, { status: r.status, headers: r.headers });
  },
};
