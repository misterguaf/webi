import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const plans = JSON.parse(readFileSync(join(root, "infra/cloudflare-resources.example.json"), "utf8"));
const errors = [];

if (plans.remoteProvisioningAuthorized !== false) {
  errors.push("El pla local ha de mantindre remoteProvisioningAuthorized=false.");
}
for (const [environment, config] of Object.entries(plans.environments || {})) {
  for (const kind of ["d1", "r2PersonalData"]) {
    if (!config[kind] || config[kind].jurisdiction !== "eu") {
      errors.push(`${environment}.${kind} ha de declarar jurisdiction=eu.`);
    }
  }
  if (config.r2PersonalData && config.r2PersonalData.public !== false) {
    errors.push(`${environment}.r2PersonalData ha de ser privat.`);
  }
}

for (const relative of ["wrangler.toml", "portal/wrangler.toml"]) {
  const source = readFileSync(join(root, relative), "utf8");
  if (/jurisdiction\s*=\s*["']weur["']/i.test(source)) {
    errors.push(`${relative}: weur no és una jurisdicció vàlida.`);
  }
  if (/\[\[(?:d1_databases|r2_buckets)\]\]/.test(source)) {
    errors.push(`${relative}: binding D1/R2 nuevo requiere autorización, creación con jurisdicción eu y comprobación de metadata; el binding TOML no fija jurisdicción.`);
  }
}

// Audit A1: the public portal must never hold a D1/R2 binding (in any environment) and must reach
// Gestió only through the PortalIntake service entrypoint.
const portal = readFileSync(join(root, 'portal/wrangler.toml'), 'utf8');
if (/d1_databases|r2_buckets|kv_namespaces|durable_objects/.test(portal)) {
  errors.push('portal/wrangler.toml: el portal no pot tindre bindings de dades (D1/R2/KV/DO); usa GESTIO_INTAKE.');
}
const intakeBindings = portal.match(/\[\[(?:env\.[a-z]+\.)?services\]\][^[]*/g) || [];
if (intakeBindings.length < 2 || intakeBindings.some(block => !/binding\s*=\s*"GESTIO_INTAKE"/.test(block) ||
    !/entrypoint\s*=\s*"PortalIntake"/.test(block))) {
  errors.push('portal/wrangler.toml: cal un service binding GESTIO_INTAKE amb entrypoint PortalIntake a producció i a local.');
}

const gestio = readFileSync(join(root, 'gestio/wrangler.toml'), 'utf8');
const gestioD1 = gestio.split('[[d1_databases]]')[1]?.split('[[r2_buckets]]')[0] || '';
if (!/database_id\s*=\s*"00000000-0000-0000-0000-000000000001"/.test(gestio) ||
    !/database_name\s*=\s*"parpallo-gestio-local"/.test(gestio) ||
    /jurisdiction\s*=/.test(gestioD1) ||
    !/^APP_ENV\s*=\s*"development"\s*$/m.test(gestio) ||
    !/^DEV_IDENTITY_PROVIDER\s*=\s*"enabled"\s*$/m.test(gestio)) {
  errors.push('gestio: binding exclusivamente local; jurisdicción EU se fija al crear D1 remoto, no en el binding.');
}
for (const relative of ['gestio/wrangler.toml','family/wrangler.toml']) {
  const source=readFileSync(join(root,relative),'utf8');
  if (!/^APP_ENV\s*=\s*"development"\s*$/m.test(source) ||
      !/database_id\s*=\s*"00000000-0000-0000-0000-000000000001"/.test(source) ||
      !/\[\[r2_buckets\]\][\s\S]*?bucket_name\s*=\s*"parpallo-evidence-local"[\s\S]*?jurisdiction\s*=\s*"eu"/.test(source))
    errors.push(`${relative}: evidencia R2 simulada solo en local, jurisdicción EU obligatoria para futuro binding.`);
}

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else {
  console.log("Configuració Cloudflare conceptual: EU, privada i sense provisioning remot.");
}
