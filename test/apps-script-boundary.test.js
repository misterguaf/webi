import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const script = readFileSync(new URL("../scripts/google-apps-script.gs", import.meta.url), "utf8");

function contextFor(payload) {
  const calls = [];
  const context = {
    console,
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: (body) => ({ body, setMimeType() { return this; } }),
    },
    LockService: {
      getScriptLock: () => ({ waitLock() { calls.push("lock"); }, releaseLock() { calls.push("unlock"); } }),
    },
    SpreadsheetApp: { getActiveSpreadsheet() { calls.push("sheets"); throw new Error("Unexpected Sheets access"); } },
    DriveApp: { getFolderById() { calls.push("drive"); throw new Error("Unexpected Drive access"); } },
    MailApp: { sendEmail() { calls.push("mail"); throw new Error("Unexpected mail"); } },
  };
  runInNewContext(script, context, { filename: "google-apps-script.gs" });
  context.obriSobreSignat = () => payload;
  return { context, calls };
}

test("Apps Script rebutja activitats i tipus desconeguts sense escriure", () => {
  for (const tipus of ["inscripcio", "desconegut"]) {
    const { context, calls } = contextFor({ tipus });
    const result = context.doPost({ postData: { contents: "{}" } });
    assert.equal(JSON.parse(result.body).ok, false);
    assert.deepEqual(calls, []);
  }
});

test("Apps Script conserva la ruta de quota amb el seu LockService", () => {
  const { context, calls } = contextFor({ tipus: "quota" });
  context.quota = () => {
    calls.push("quota");
    return context.respon({ ok: true });
  };
  const result = context.doPost({ postData: { contents: "{}" } });
  assert.equal(JSON.parse(result.body).ok, true);
  assert.deepEqual(calls, ["lock", "quota", "unlock"]);
});

test("Apps Script conserva alta i reserva, inclosa l'alta antiga sense tipus", () => {
  for (const [tipus, expected] of [["alta", "alta"], ["reserva", "reserva"], [undefined, "alta"]]) {
    const { context, calls } = contextFor({ tipus });
    context.alta = () => { calls.push("alta"); return context.respon({ ok: true }); };
    context.reserva = () => { calls.push("reserva"); return context.respon({ ok: true }); };
    const result = context.doPost({ postData: { contents: "{}" } });
    assert.equal(JSON.parse(result.body).ok, true);
    assert.deepEqual(calls, [expected]);
  }
});
