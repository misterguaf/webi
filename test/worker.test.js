import { test } from "node:test";
import assert from "node:assert/strict";

import worker from "../worker.js";

test("el Worker público atiende solo alta y reserva", async () => {
  for (const path of ["/api/alta", "/api/reserva"]) {
    const response = await worker.fetch(new Request(`https://parpallo.test${path}`, { method: "GET" }), {});
    assert.equal(response.status, 405, path);
  }
});

test("el endpoint público antiguo de inscripciones ya no existe", async () => {
  const response = await worker.fetch(new Request("https://parpallo.test/api/inscripcio", { method: "POST" }), {});
  assert.equal(response.status, 404);
});

test("el Worker no expone rutas no declaradas", async () => {
  const response = await worker.fetch(new Request("https://parpallo.test/api/desconeguda"), {});
  assert.equal(response.status, 404);
});

test("el Worker talla un body sobredimensionado antes del handler", async () => {
  const response = await worker.fetch(new Request("https://parpallo.test/api/alta", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "x".repeat(20 * 1024),
  }), {});
  assert.equal(response.status, 413);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("el Worker público rechaza tipos de contenido inesperados", async () => {
  const response = await worker.fetch(new Request("https://parpallo.test/api/alta", {
    method: "POST",
    headers: { "Content-Type": "text/plain", Accept: "application/json" },
    body: "no-json",
  }), {});
  assert.equal(response.status, 415);
});
