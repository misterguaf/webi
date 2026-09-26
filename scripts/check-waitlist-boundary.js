import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const form = readFileSync(join(root, "site/fersescout.html"), "utf8");
const sheets = readFileSync(join(root, "api/_lib/sheets.js"), "utf8");
const appsScript = readFileSync(join(root, "scripts/google-apps-script.gs"), "utf8");
const errors = [];

if (/<textarea\b/i.test(form)) errors.push("La llista d'espera no pot contindre textareas oberts.");
if (/name=["'](?:notes|salut|salud|health|alergias?|al·lèrgies)["']/i.test(form)) {
  errors.push("La llista d'espera conté un camp sanitari prohibit.");
}

const altaFunction = /export async function appendRow[\s\S]*?\n}\n/.exec(sheets)?.[0] || "";
if (/\bnotes\s*:/.test(altaFunction)) errors.push("appendRow encara envia notes en el payload d'alta.");

const appsAlta = /function alta\(d\)[\s\S]*?\n}\n/.exec(appsScript)?.[0] || "";
if (/d\.notes/.test(appsAlta)) errors.push("Apps Script encara copia d.notes en una alta.");
if (!/LEGACY_FIELD_PENDING_MIGRATION/.test(appsScript)) {
  errors.push("Falta documentar la columna legacy de Notes.");
}

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else {
  console.log("Boundary de llista d'espera: sense salut ni camp obert.");
}
