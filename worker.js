/* Adaptador Cloudflare Workers.
 * Desplegat amb una ruta de zona Cloudflare: /api/*
 *
 * A Cloudflare les variables d'entorn arriben a `env`, no a process.env; per
 * això el nucli les rep sempre com a paràmetre en compte de llegir-les tot sol.
 */
import { handleAlta } from "./api/_lib/handler.js";
import { handleReserva } from "./api/_lib/handler-reserva.js";
import { MAX_BODY } from "./api/_lib/handler.js";
import { BodyTooLargeError, readRequestBody } from "./api/_lib/http-body.js";

const RUTES = {
  "/api/alta": { handler: handleAlta, maxBytes: MAX_BODY },
  "/api/reserva": { handler: handleReserva, maxBytes: MAX_BODY },
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const route = RUTES[url.pathname];
    if (!route) {
      return new Response("Not found", { status: 404 });
    }

    const headers = {};
    for (const [k, v] of request.headers) headers[k.toLowerCase()] = v;

    let rawBody;
    try {
      rawBody = await readRequestBody(request, route.maxBytes);
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        return new Response(JSON.stringify({ ok: false }), {
          status: 413,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      throw error;
    }

    const r = await route.handler({
      method: request.method,
      headers,
      rawBody,
      env,
      ip: request.headers.get("cf-connecting-ip"),
    });

    return new Response(r.body, { status: r.status, headers: r.headers });
  },
};
