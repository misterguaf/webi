import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pairs = [
  ["data/activitats.schema.json", "data/activitats.json"],
  ["data/cuotes.schema.json", "data/cuotes.json"],
  ["infra/cloudflare-resources.schema.json", "infra/cloudflare-resources.example.json"],
];

const ajv = new Ajv2020({ allErrors: true, strict: false });
ajv.addFormat("date", {
  type: "string",
  validate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) &&
      date.getUTCFullYear() === Number(match[1]) &&
      date.getUTCMonth() + 1 === Number(match[2]) &&
      date.getUTCDate() === Number(match[3]);
  },
});

let failed = false;
for (const [schemaPath, dataPath] of pairs) {
  const schema = JSON.parse(readFileSync(join(root, schemaPath), "utf8"));
  const data = JSON.parse(readFileSync(join(root, dataPath), "utf8"));
  const validate = ajv.compile(schema);
  if (!validate(data)) {
    failed = true;
    console.error(`${dataPath}:`, ajv.errorsText(validate.errors, { separator: "\n" }));
  } else {
    console.log(`${dataPath}: OK`);
  }
}

if (failed) process.exitCode = 1;
