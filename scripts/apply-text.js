// Vuelve a insertar en el sitio los textos reescritos en TEXTOS-WEB.md,
// usando scripts/text-manifest.json para localizar cada fragmento con
// precisión (mismo archivo, misma ocurrencia N) sin tocar el HTML/JS que lo
// rodea.
//
// Uso: node scripts/apply-text.js [--dry-run]

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractPairs, extractAttr, extractTitle, extractMetaDescription, extractUntranslatedHeadings, extractJsMessages } from "./text-extract-lib.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DRY_RUN = process.argv.includes("--dry-run");

// --- 1. Parsea TEXTOS-WEB.md -----------------------------------------------

function parseDoc(md) {
  const entries = new Map(); // id -> { va, es }
  const idRe = /<!-- id:([A-Z]+-\d+) -->/g;
  let m;
  const marks = [];
  while ((m = idRe.exec(md))) marks.push({ id: m[1], at: m.index });

  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].at;
    const end = i + 1 < marks.length ? marks[i + 1].at : md.length;
    const chunk = md.slice(start, end);

    const vaM = /\n>>> VA\n([\s\S]*?)\n>>> (?:ES|END)\n/.exec(chunk);
    const esM = /\n>>> ES\n([\s\S]*?)\n>>> END\n/.exec(chunk);
    if (!vaM) {
      console.warn(`Aviso: no encuentro el bloque VA de ${marks[i].id}, se ignora.`);
      continue;
    }
    entries.set(marks[i].id, { va: vaM[1].replace(/\n$/, ""), es: esM ? esM[1].replace(/\n$/, "") : null });
  }
  return entries;
}

const md = readFileSync(join(ROOT, "docs", "TEXTOS-WEB.md"), "utf8");
const manifest = JSON.parse(readFileSync(join(ROOT, "scripts", "text-manifest.json"), "utf8"));
const edited = parseDoc(md);

for (const id of edited.keys()) {
  if (!manifest[id]) console.warn(`Aviso: ${id} está en TEXTOS-WEB.md pero no en el manifiesto (¿ID inventado o de otra extracción?).`);
}
for (const id of Object.keys(manifest)) {
  if (!edited.has(id)) console.warn(`Aviso: ${id} está en el manifiesto pero no en TEXTOS-WEB.md (¿se borró el marcador por error?).`);
}

// --- 2. Agrupa las sustituciones por archivo -------------------------------

// fileEdits: file -> array of { locate function, newVa, newEs, kind, occurrenceIndex, region }
const htmlEditsByFile = new Map();
const jsEditsByFile = new Map();

function addHtmlEdit(file, editSpec) {
  if (!htmlEditsByFile.has(file)) htmlEditsByFile.set(file, []);
  htmlEditsByFile.get(file).push(editSpec);
}

for (const [id, loc] of Object.entries(manifest)) {
  const ed = edited.get(id);
  if (!ed) continue; // ya avisado arriba

  if (loc.type === "html") {
    addHtmlEdit(loc.file, { id, kind: loc.kind, occurrenceIndex: loc.occurrenceIndex, originalVa: loc.va, originalEs: loc.es, newVa: ed.va, newEs: ed.es });
  } else if (loc.type === "html-shared") {
    for (const l of loc.locations) {
      addHtmlEdit(l.file, { id, kind: loc.kind, occurrenceIndex: l.occurrenceIndex, originalVa: loc.va, originalEs: loc.es, newVa: ed.va, newEs: ed.es });
    }
  } else if (loc.type === "js" || loc.type === "js-literal") {
    if (!jsEditsByFile.has(loc.file)) jsEditsByFile.set(loc.file, []);
    jsEditsByFile.get(loc.file).push({ id, type: loc.type, key: loc.key, pattern: loc.pattern, originalVa: loc.va, originalEs: loc.es, newVa: ed.va, newEs: ed.es });
  }
}

// --- 3. Aplica en HTML: vuelve a extraer con la misma lógica y sustituye
//        por posición (start,end) trabajando de atrás hacia delante para no
//        desplazar los índices de las sustituciones pendientes. -------------

function applyHtmlFile(file, edits) {
  const fullPath = join(ROOT, file);
  let html = readFileSync(fullPath, "utf8");

  const byKind = { pair: [], "aria-label": [], alt: [], heading: [], title: [], "meta-description": [] };
  for (const e of edits) byKind[e.kind].push(e);
  for (const k of Object.keys(byKind)) byKind[k].sort((a, b) => a.occurrenceIndex - b.occurrenceIndex);

  const replacements = []; // { start, end, text }

  if (byKind.pair.length) {
    const pairs = extractPairs(html);
    for (const e of byKind.pair) {
      const p = pairs[e.occurrenceIndex - 1];
      if (!p) { console.warn(`${file}: no encuentro la ocurrencia #${e.occurrenceIndex} de un par VA/ES para ${e.id}`); continue; }
      if (p.va !== e.originalVa || (p.es ?? null) !== (e.originalEs ?? null)) {
        console.warn(`${file}: el texto original de ${e.id} ya no coincide con lo extraído (¿el HTML cambió desde la extracción?). Se sustituye igualmente.`);
      }
      const esOpen = '<span class="es">';
      const vaOpen = '<span class="va">';
      const vaClose = "</span>";
      if (p.es === null) {
        replacements.push({ start: p.start, end: p.end, text: vaOpen + e.newVa + vaClose });
      } else {
        const text = vaOpen + e.newVa + vaClose + esOpen + (e.newEs ?? e.originalEs) + vaClose;
        replacements.push({ start: p.start, end: p.end, text });
      }
    }
  }
  for (const attrName of ["aria-label", "alt"]) {
    const key = attrName;
    if (!byKind[key].length) continue;
    const occs = extractAttr(html, attrName);
    for (const e of byKind[key]) {
      const a = occs[e.occurrenceIndex - 1];
      if (!a) { console.warn(`${file}: no encuentro la ocurrencia #${e.occurrenceIndex} de ${attrName} para ${e.id}`); continue; }
      replacements.push({ start: a.start, end: a.end, text: `${attrName}="${e.newVa.replace(/"/g, "&quot;")}"` });
    }
  }
  if (byKind.heading.length) {
    const headings = extractUntranslatedHeadings(html);
    for (const e of byKind.heading) {
      const h = headings[e.occurrenceIndex - 1];
      if (!h) { console.warn(`${file}: no encuentro el encabezado #${e.occurrenceIndex} para ${e.id}`); continue; }
      replacements.push({ start: h.start, end: h.end, text: html.slice(h.start, h.end).replace(h.content, e.newVa) });
    }
  }
  if (byKind.title.length) {
    const t = extractTitle(html);
    if (t !== null) {
      const idx = html.indexOf(`<title>${t}</title>`);
      replacements.push({ start: idx, end: idx + `<title>${t}</title>`.length, text: `<title>${byKind.title[0].newVa}</title>` });
    }
  }
  if (byKind["meta-description"].length) {
    const d = extractMetaDescription(html);
    if (d !== null) {
      const needle = `<meta name="description" content="${d}"`;
      const idx = html.indexOf(needle);
      const newVal = byKind["meta-description"][0].newVa.replace(/"/g, "&quot;");
      replacements.push({ start: idx, end: idx + needle.length, text: `<meta name="description" content="${newVal}"` });
    }
  }

  replacements.sort((a, b) => b.start - a.start);
  for (const r of replacements) {
    html = html.slice(0, r.start) + r.text + html.slice(r.end);
  }

  if (!DRY_RUN) writeFileSync(fullPath, html);
  return replacements.length;
}

// --- 4. Aplica en JS: sustituye por clave (key) o por patrón nombrado ------

function applyJsFile(file, edits) {
  const fullPath = join(ROOT, file);
  let js = readFileSync(fullPath, "utf8");
  let count = 0;

  for (const e of edits) {
    if (e.type === "js") {
      const msgs = extractJsMessages(js);
      const msg = msgs.find((m) => m.key === e.key);
      if (!msg) { console.warn(`${file}: no encuentro la clave "${e.key}" para ${e.id}`); continue; }
      // Sustituye solo el contenido de las dos cadenas (entre comillas), de
      // atrás hacia delante, para no reformatear nada más del objeto.
      const newEs = e.newEs ?? e.originalEs;
      js = js.slice(0, msg.esStart) + newEs + js.slice(msg.esEnd);
      js = js.slice(0, msg.vaStart) + e.newVa + js.slice(msg.vaEnd);
      count++;
    } else if (e.type === "js-literal" && e.pattern === "tornar-volver") {
      const re = /(<p><a href="\/fersescout\.html">)([^<]*)(<\/a><\/p>)/;
      if (!re.test(js)) { console.warn(`${file}: no encuentro el enlace de vuelta para ${e.id}`); continue; }
      js = js.replace(re, (_, a, _old, c) => a + e.newVa + c);
      count++;
    }
  }

  if (!DRY_RUN) writeFileSync(fullPath, js);
  return count;
}

// --- 5. Ejecuta -------------------------------------------------------------

let totalHtml = 0;
for (const [file, edits] of htmlEditsByFile) totalHtml += applyHtmlFile(file, edits);

let totalJs = 0;
for (const [file, edits] of jsEditsByFile) totalJs += applyJsFile(file, edits);

console.log(`${DRY_RUN ? "[dry-run] " : ""}${totalHtml} fragmentos HTML + ${totalJs} fragmentos JS aplicados.`);
