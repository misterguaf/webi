import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ignored = new Set([".git", "node_modules", "coverage"]);
const textExtensions = new Set([".js", ".json", ".md", ".toml", ".yml", ".yaml", ".html", ".css", ".xml", ".txt", ".example", ""]);
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/,
];
const findings = [];

function visit(directory) {
  for (const entry of readdirSync(directory)) {
    if (ignored.has(entry) || entry === ".env" || entry === "check-secrets.js") continue;
    const full = join(directory, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      visit(full);
      continue;
    }
    if (stat.size > 1024 * 1024 || !textExtensions.has(extname(entry))) continue;
    const lines = readFileSync(full, "utf8").split("\n");
    for (let index = 0; index < lines.length; index++) {
      if (patterns.some((pattern) => pattern.test(lines[index]))) {
        findings.push(`${relative(root, full)}:${index + 1}`);
      }
    }
  }
}

visit(root);
if (findings.length) {
  console.error("Possibles secrets (contingut ocult):\n" + findings.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Escaneig local d'alta confiança: sense coincidències. Gitleaks s'executa en CI.");
}
