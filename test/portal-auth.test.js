import { test } from "node:test";
import assert from "node:assert/strict";
import { contrasenyaCorrecta, creaSessio, verificaSessio, DURADA_SEGONS } from "../portal/auth.js";

const ENV = { PORTAL_ACCESS_PASSWORD: "prova-secreta", PORTAL_SESSION_SECRET: "secret-de-sessio-prou-llarg-per-a-proves", PORTAL_SESSION_VERSION: "curs-1" };

test("la contraseña compartida se compara sin exponerla", async () => {
  assert.equal(await contrasenyaCorrecta("prova-secreta", ENV), true);
  assert.equal(await contrasenyaCorrecta("incorrecta", ENV), false);
});

test("la sesión firmada dura 24 horas y queda ligada a la versión del curso", async () => {
  const now = Date.UTC(2026, 8, 19);
  const session = await creaSessio(ENV, now);
  assert.ok(await verificaSessio(session.token, ENV, now + (DURADA_SEGONS - 1) * 1000));
  assert.equal(await verificaSessio(session.token, ENV, now + DURADA_SEGONS * 1000), null);
  assert.equal(await verificaSessio(session.token, { ...ENV, PORTAL_SESSION_VERSION: "curs-2" }, now), null);
});

test("una sesión alterada no es válida", async () => {
  const session = await creaSessio(ENV);
  const dot = session.token.indexOf(".");
  const position = dot + 3;
  const changed = session.token.slice(0, position) + (session.token[position] === "a" ? "b" : "a") + session.token.slice(position + 1);
  assert.equal(await verificaSessio(changed, ENV), null);
});
