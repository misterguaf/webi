import { test } from "node:test";
import assert from "node:assert/strict";

import { comprovantTeSignatura } from "../api/_lib/quota.js";

function base64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

test("accepta signatures binàries dels quatre formats de comprovant", () => {
  assert.equal(comprovantTeSignatura(base64([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg"), true);
  assert.equal(comprovantTeSignatura(base64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png"), true);
  assert.equal(comprovantTeSignatura(base64(Buffer.from("RIFF0000WEBPVP8 ")), "image/webp"), true);
  assert.equal(comprovantTeSignatura(base64(Buffer.from("%PDF-1.7")), "application/pdf"), true);
});

test("rechaza un archivo cuyo MIME declarado no coincide con su firma", () => {
  const html = base64(Buffer.from("<html><body>no es un PDF</body></html>"));
  for (const type of ["image/jpeg", "image/png", "image/webp", "application/pdf"]) {
    assert.equal(comprovantTeSignatura(html, type), false, type);
  }
});
