import { test } from "node:test";
import assert from "node:assert/strict";
import { BodyTooLargeError, isAcceptedFormContentType, readRequestBody } from "../api/_lib/http-body.js";

test("accepta només JSON o formulari URL encoded", () => {
  assert.equal(isAcceptedFormContentType("application/json; charset=utf-8"), true);
  assert.equal(isAcceptedFormContentType("application/x-www-form-urlencoded"), true);
  assert.equal(isAcceptedFormContentType("text/plain"), false);
  assert.equal(isAcceptedFormContentType(null), false);
});

test("rebutja Content-Length superior abans de llegir", async () => {
  const request = new Request("https://example.test/api", {
    method: "POST",
    headers: { "Content-Length": "100" },
    body: "curt",
  });
  await assert.rejects(readRequestBody(request, 10), BodyTooLargeError);
});

test("rebutja un stream que supera el límit encara que no declare longitud", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("123456"));
      controller.enqueue(new TextEncoder().encode("789012"));
      controller.close();
    },
  });
  const request = new Request("https://example.test/api", { method: "POST", body: stream, duplex: "half" });
  await assert.rejects(readRequestBody(request, 10), BodyTooLargeError);
});
