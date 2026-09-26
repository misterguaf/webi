// Extrae todo el texto visible del sitio a un documento Markdown editable
// (TEXTOS-WEB.md) más un manifiesto interno (text-manifest.json) que
// apply-text.js usa para volver a insertar los textos reescritos sin tocar
// el HTML/JS que los rodea.
//
// Uso: node scripts/extract-text.js

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  extractPairs,
  extractAttr,
  extractTitle,
  extractMetaDescription,
  extractUntranslatedHeadings,
  extractJsMessages,
  classifyRegion,
} from "./text-extract-lib.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const PAGES = [
  { file: "site/index.html", prefix: "IDX", title: "Inici — index.html" },
  { file: "site/cova.html", prefix: "COV", title: "La Cova del Parpalló — cova.html" },
  { file: "site/estol.html", prefix: "EST", title: "Estol — estol.html" },
  { file: "site/tropa.html", prefix: "TRO", title: "Tropa — tropa.html" },
  { file: "site/esculta.html", prefix: "ESC", title: "Escoltes — esculta.html" },
  { file: "site/clan.html", prefix: "CLA", title: "Clan — clan.html" },
  { file: "site/fersescout.html", prefix: "FER", title: "Fer-se scout — fersescout.html" },
  { file: "site/merchandising.html", prefix: "BOT", title: "Botiga del grup — merchandising.html" },
];

const LEGAL_PAGES = [
  { file: "site/avis-legal.html", prefix: "LEG", title: "Avís legal — avis-legal.html" },
  { file: "site/privacitat.html", prefix: "PRI", title: "Privacitat — privacitat.html" },
  { file: "site/cookies.html", prefix: "COO", title: "Cookies — cookies.html" },
];

const JS_FILES = [
  { file: "site/assets/js/form.js", label: "form.js" },
  { file: "api/_lib/validate.js", label: "api/_lib/validate.js" },
  { file: "api/_lib/handler.js", label: "api/_lib/handler.js" },
  { file: "site/assets/js/merch.js", label: "merch.js" },
  { file: "api/_lib/reserva.js", label: "api/_lib/reserva.js" },
  { file: "api/_lib/handler-reserva.js", label: "api/_lib/handler-reserva.js" },
];

const REGION_LABEL = {
  header: "Cabecera",
  footer: "Pie de página",
  skip: "Enlace de salto",
  body: "Contenido",
};

function snippet(text, max = 70) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
}

// --- 1. Recoge todos los candidatos de cada página HTML -------------------

function collectPageItems(html) {
  const items = [];

  for (const p of extractPairs(html)) {
    items.push({
      kind: "pair",
      start: p.start,
      region: classifyRegion(html, p.start),
      va: p.va,
      es: p.es,
      wrapperPend: p.wrapperPend,
      wrapperLegal: p.wrapperLegal,
      containsPend: p.containsPend,
    });
  }
  for (const a of extractAttr(html, "aria-label")) {
    items.push({ kind: "aria-label", start: a.start, region: classifyRegion(html, a.start), va: a.value, es: null });
  }
  for (const a of extractAttr(html, "alt")) {
    items.push({ kind: "alt", start: a.start, region: classifyRegion(html, a.start), va: a.value, es: null });
  }
  for (const h of extractUntranslatedHeadings(html)) {
    items.push({ kind: "heading", start: h.start, region: classifyRegion(html, h.start), va: h.content, es: null });
  }
  const title = extractTitle(html);
  if (title) items.push({ kind: "title", start: -2, region: "body", va: title, es: null });
  const desc = extractMetaDescription(html);
  if (desc) items.push({ kind: "meta-description", start: -1, region: "body", va: desc, es: null });

  items.sort((a, b) => a.start - b.start);
  // Índice de ocurrencia por (kind) dentro del propio archivo, en orden de
  // aparición — es la misma clave que usará apply-text.js para relocalizar.
  const counters = {};
  for (const it of items) {
    counters[it.kind] = (counters[it.kind] || 0) + 1;
    it.occurrenceIndex = counters[it.kind];
  }
  return items;
}

const pageData = [...PAGES, ...LEGAL_PAGES].map((meta) => {
  const html = readFileSync(join(ROOT, meta.file), "utf8");
  return { meta, html, items: collectPageItems(html) };
});

// --- 2. Separa los pendientes legales (envueltos en .legal-pend) ----------

for (const pd of pageData) {
  pd.jurItems = pd.items.filter((it) => it.kind === "pair" && it.wrapperLegal);
  pd.items = pd.items.filter((it) => !(it.kind === "pair" && it.wrapperLegal));
}

// --- 3. Detecta bloques compartidos (cabecera/pie/skip, idénticos en 2+) --

const shareKey = (it) => `${it.kind}|${it.va}|${it.es ?? ""}`;
const shareGroups = new Map(); // key -> { kind, va, es, locations: [{file, region, occurrenceIndex}] }

for (const pd of pageData) {
  for (const it of pd.items) {
    if (it.region !== "header" && it.region !== "footer" && it.region !== "skip") continue;
    const key = shareKey(it);
    if (!shareGroups.has(key)) shareGroups.set(key, { kind: it.kind, va: it.va, es: it.es, locations: [] });
    shareGroups.get(key).locations.push({ file: pd.meta.file, region: it.region, occurrenceIndex: it.occurrenceIndex });
    it._shareKey = key;
  }
}

const sharedEntries = []; // solo los grupos que aparecen en >=2 archivos distintos
for (const [key, group] of shareGroups) {
  const files = new Set(group.locations.map((l) => l.file));
  if (files.size >= 2) sharedEntries.push({ key, ...group });
}
const sharedKeys = new Set(sharedEntries.map((e) => e.key));

for (const pd of pageData) {
  pd.pageItems = pd.items.filter((it) => !(it._shareKey && sharedKeys.has(it._shareKey)));
}

// --- 4. Asigna IDs ----------------------------------------------------------

const manifest = {};
const doc = [];

function pushDoc(id, titleLine, badges, va, es, note) {
  doc.push({ id, titleLine, badges, va, es, note });
}

// 4a. Compartido
sharedEntries.forEach((entry, i) => {
  const id = `SHR-${String(i + 1).padStart(3, "0")}`;
  manifest[id] = { type: "html-shared", kind: entry.kind, va: entry.va, es: entry.es, locations: entry.locations };
  const byFile = {};
  for (const loc of entry.locations) byFile[loc.file] = (byFile[loc.file] || 0) + 1;
  const filesList = Object.entries(byFile)
    .map(([f, n]) => `${f}${n > 1 ? ` (×${n})` : ""}`)
    .join(", ");
  pushDoc(
    id,
    `${REGION_LABEL[entry.locations[0].region] || "Compartido"} — ${snippet(entry.va)}`,
    [],
    entry.va,
    entry.es,
    `Aparece igual en: ${filesList}.`
  );
});

// 4b. Por página (incluye title/meta/aria-label/alt/heading que no se compartieron)
for (const pd of [...PAGES, ...LEGAL_PAGES].map((meta) => pageData.find((pd) => pd.meta.file === meta.file))) {
  let n = 0;
  for (const it of pd.pageItems) {
    n++;
    const id = `${pd.meta.prefix}-${String(n).padStart(3, "0")}`;
    manifest[id] = {
      type: "html",
      kind: it.kind,
      file: pd.meta.file,
      region: it.region,
      occurrenceIndex: it.occurrenceIndex,
      va: it.va,
      es: it.es,
    };
    const badges = [];
    let note;
    if (it.wrapperPend) badges.push("⚠️ PENDIENTE DE REDACTAR");
    if (it.containsPend) {
      note = "Contiene un fragmento <span class=\"pend\">…</span> dentro de la frase: no borres esa etiqueta, solo puedes reescribir el texto que hay dentro y fuera de ella.";
    } else if (it.kind === "pair" && /<[a-z][a-z0-9]*[^>]*>/i.test(it.va)) {
      note = "Contiene una etiqueta HTML dentro del texto (por ejemplo un enlace o un <strong>): consérvala tal cual, solo reescribe las palabras de dentro y de fuera.";
    }
    if (it.kind === "heading") note = "Encabezado sin variante en castellano en el código actual (probablemente un nombre propio). Confirma si hay que tocarlo.";
    if (it.kind === "aria-label") note = "Atributo aria-label (para lectores de pantalla) — en el código actual solo existe en valenciano.";
    if (it.kind === "alt") note = "Texto alternativo de una imagen — en el código actual solo existe en valenciano.";
    if (it.kind === "title") note = "Título de pestaña del navegador (<title>) — solo valenciano en el código actual.";
    if (it.kind === "meta-description") note = "Descripción para buscadores (meta description) — solo valenciano en el código actual.";

    const kindLabel =
      it.kind === "pair"
        ? REGION_LABEL[it.region] || "Contenido"
        : it.kind === "title"
        ? "Título de pestaña"
        : it.kind === "meta-description"
        ? "Meta description"
        : it.kind === "aria-label"
        ? "aria-label"
        : it.kind === "alt"
        ? "Texto alternativo de imagen"
        : "Encabezado";

    pushDoc(id, `${kindLabel} — ${snippet(it.va)}`, badges, it.va, it.es, note);
  }
}

// 4c. Legal — pendiente de datos jurídicos
const jurAll = [];
for (const pd of LEGAL_PAGES.map((meta) => pageData.find((pd) => pd.meta.file === meta.file))) {
  for (const it of pd.jurItems) jurAll.push({ file: pd.meta.file, it });
}
const jurDoc = [];
jurAll.forEach(({ file, it }, i) => {
  const id = `JUR-${String(i + 1).padStart(3, "0")}`;
  manifest[id] = { type: "html", kind: "pair", file, region: it.region, occurrenceIndex: it.occurrenceIndex, va: it.va, es: it.es };
  jurDoc.push({ id, titleLine: `${file} — ${snippet(it.va)}`, badges: [], va: it.va, es: it.es });
});

// 4d. Sistema (mensajes de form.js / validate.js / handler.js)
const sysDoc = [];
let sysN = 0;
for (const jf of JS_FILES) {
  const js = readFileSync(join(ROOT, jf.file), "utf8");
  for (const msg of extractJsMessages(js)) {
    sysN++;
    const id = `SYS-${String(sysN).padStart(3, "0")}`;
    manifest[id] = { type: "js", file: jf.file, key: msg.key, va: msg.va, es: msg.es };
    sysDoc.push({ id, titleLine: `${jf.label} · ${msg.key} — ${snippet(msg.va)}`, va: msg.va, es: msg.es });
  }
  if (jf.file === "api/_lib/handler.js") {
    const m = /<p><a href="\/fersescout\.html">([^<]*)<\/a><\/p>/.exec(js);
    if (m) {
      sysN++;
      const id = `SYS-${String(sysN).padStart(3, "0")}`;
      manifest[id] = { type: "js-literal", file: jf.file, pattern: "tornar-volver", va: m[1], es: null };
      sysDoc.push({
        id,
        titleLine: `${jf.label} · enlace de vuelta (página sin JS) — ${snippet(m[1])}`,
        va: m[1],
        es: null,
        note: 'Este texto mezcla los dos idiomas en una sola cadena ("Tornar / Volver"); no lo separes en dos líneas.',
      });
    }
  }
}

// --- 5. Escribe TEXTOS-WEB.md ----------------------------------------------

function block(item) {
  const lines = [];
  const badgeStr = item.badges && item.badges.length ? " — " + item.badges.join(" ") : "";
  lines.push(`#### [${item.id}] ${item.titleLine}${badgeStr}`);
  lines.push(`<!-- id:${item.id} -->`);
  if (item.note) lines.push(`_Nota: ${item.note}_`);
  lines.push(">>> VA");
  lines.push(item.va ?? "");
  if (item.es !== null && item.es !== undefined) {
    lines.push(">>> ES");
    lines.push(item.es);
  }
  lines.push(">>> END");
  return lines.join("\n");
}

const out = [];
out.push("# Textos de la web — Grup Scout Parpalló");
out.push("");
out.push("Documento generado automáticamente por `scripts/extract-text.js`. Sirve para reescribir");
out.push("todo el contenido del sitio fuera del código y volver a insertarlo después con");
out.push("`scripts/apply-text.js`, sin tocar HTML a mano.");
out.push("");
out.push("**Reglas para editar este documento (imprescindibles para poder reinsertarlo):**");
out.push("");
out.push("1. No borres ni cambies las líneas `<!-- id:… -->` ni las líneas que empiezan por `>>>`.");
out.push("2. Reescribe solo el texto que hay *entre* `>>> VA` / `>>> ES` y la siguiente marca `>>>`.");
out.push('3. Si dentro de un texto ves una etiqueta HTML —como `<span class="pend">…</span>`, `<a href="...">…</a>`');
out.push("   o `<strong>…</strong>`—, no la borres ni la muevas: puedes reescribir las palabras de dentro y de");
out.push("   fuera, pero la etiqueta debe quedar igual. Los bloques que la llevan tienen una nota que lo recuerda.");
out.push("4. No uses comillas dobles rectas (\") dentro del texto de la sección **Sistema**; usa comillas");
out.push('   tipográficas ("como estas") si hace falta, porque esas cadenas viven dentro de código JavaScript.');
out.push("5. Los bloques marcados **⚠️ PENDIENTE DE REDACTAR** son placeholders explícitos del sitio;");
out.push("   son la prioridad para escribir contenido real.");
out.push("6. Los bloques de la sección **Legal — pendiente de datos jurídicos** no son de redacción libre:");
out.push("   son datos legales concretos (NIF, domicilio, plazos...). Ver `docs/PRE-LANZAMIENTO.md`, apartado A.");
out.push("");
out.push("**Fuera de este documento a propósito:** `fuentes.html` (herramienta interna de pruebas), los");
out.push("datos estructurados JSON-LD de `index.html`, comentarios de código, y el campo trampa anti-bots");
out.push("del formulario (`fersescout.html`, campo `malnom`, invisible para personas reales).");
out.push("");
out.push("---");
out.push("");
out.push(`## Compartido (aparece igual en varias páginas — ${sharedEntries.length} bloques)`);
out.push("");
out.push("Cabecera, pie de página y enlace de salto son casi idénticos en todas las páginas. Edítalos");
out.push("aquí una sola vez: `apply-text.js` los replica en todos los archivos donde aparecen.");
out.push("");
for (const item of doc.filter((d) => d.id.startsWith("SHR-"))) {
  out.push(block(item));
  out.push("");
}

for (const meta of [...PAGES, ...LEGAL_PAGES]) {
  const pageBlocks = doc.filter((d) => d.id.startsWith(meta.prefix + "-"));
  out.push("---");
  out.push("");
  out.push(`## ${meta.title}`);
  out.push("");
  if (pageBlocks.length === 0) {
    out.push("_(todo el texto de esta página es compartido — ver sección «Compartido» arriba)_");
    out.push("");
  }
  for (const item of pageBlocks) {
    out.push(block(item));
    out.push("");
  }
}

out.push("---");
out.push("");
out.push("## Legal — pendiente de datos jurídicos");
out.push("");
out.push("Estos fragmentos no son redacción de estilo: son datos legales concretos que solo puede decidir");
out.push("alguien con acceso a la documentación del grupo (NIF, domicilio social, plazos de conservación,");
out.push("base legal RGPD...). Ver `docs/PRE-LANZAMIENTO.md`, apartado A, antes de rellenarlos.");
out.push("");
for (const item of jurDoc) {
  out.push(block(item));
  out.push("");
}

out.push("---");
out.push("");
out.push("## Sistema (mensajes del formulario \"Fer-se scout\")");
out.push("");
out.push("Textos que ve la familia al enviar el formulario: estado de envío, errores de validación y");
out.push("mensajes del servidor. Viven en JavaScript, no en HTML, pero los reescribe `apply-text.js` igual.");
out.push("");
for (const item of sysDoc) {
  out.push(block(item));
  out.push("");
}

writeFileSync(join(ROOT, "docs", "TEXTOS-WEB.md"), out.join("\n"));
writeFileSync(join(ROOT, "scripts", "text-manifest.json"), JSON.stringify(manifest, null, 2));

const totalItems = Object.keys(manifest).length;
console.log(`TEXTOS-WEB.md generado con ${totalItems} fragmentos (${sharedEntries.length} compartidos, ${jurDoc.length} legales, ${sysDoc.length} de sistema).`);
