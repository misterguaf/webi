// Lógica de extracción/reinserción de texto compartida por extract-text.js y
// apply-text.js. Debe ser exactamente la misma en los dos scripts: si difiere,
// el recuento de "ocurrencia N" ya no coincide entre extracción y aplicación.

const PEND_OPEN = '<span class="pend">';
const LEGAL_PEND_OPEN = '<span class="legal-pend">';
const VA_OPEN = '<span class="va">';
const ES_OPEN = '<span class="es">';

// Dado el índice justo después de una etiqueta de apertura <span ...>, busca el
// </span> que le corresponde contando profundidad (cualquier <span> anidado
// dentro cuenta, incluidos los .pend que a veces van dentro de un .va/.es).
function readBalancedSpan(html, contentStart) {
  const tagRe = /<span\b[^>]*>|<\/span>/g;
  tagRe.lastIndex = contentStart;
  let depth = 1;
  let m;
  while ((m = tagRe.exec(html))) {
    if (m[0] === "</span>") {
      depth--;
      if (depth === 0) {
        return { content: html.slice(contentStart, m.index), closeEnd: tagRe.lastIndex };
      }
    } else {
      depth++;
    }
  }
  throw new Error("Span sin cerrar a partir de la posición " + contentStart);
}

// Todos los pares <span class="va">...</span><span class="es">...</span> del
// documento, en orden. Cada uno incluye si va envuelto por .pend/.legal-pend
// (marcador justo antes de la apertura del span "va") y si contiene un .pend
// anidado dentro de su propio texto (frase con una palabra suelta pendiente).
export function extractPairs(html) {
  const pairs = [];
  const openRe = /<span class="va">/g;
  let m;
  while ((m = openRe.exec(html))) {
    const vaTagStart = m.index;
    const { content: va, closeEnd: vaEnd } = readBalancedSpan(html, openRe.lastIndex);

    if (!html.startsWith(ES_OPEN, vaEnd)) {
      // No hay hermano .es inmediatamente después: no debería pasar en este
      // sitio, pero no abortamos la extracción por un caso raro.
      pairs.push({
        start: vaTagStart,
        end: vaEnd,
        va,
        es: null,
        wrapperPend: false,
        wrapperLegal: false,
        containsPend: /class="(legal-)?pend"/.test(va),
      });
      openRe.lastIndex = vaEnd;
      continue;
    }

    const esContentStart = vaEnd + ES_OPEN.length;
    const { content: es, closeEnd: esEnd } = readBalancedSpan(html, esContentStart);

    const wrapperLegal = html.slice(Math.max(0, vaTagStart - LEGAL_PEND_OPEN.length), vaTagStart) === LEGAL_PEND_OPEN;
    const wrapperPend =
      !wrapperLegal && html.slice(Math.max(0, vaTagStart - PEND_OPEN.length), vaTagStart) === PEND_OPEN;
    const containsPend = /class="(legal-)?pend"/.test(va) || /class="(legal-)?pend"/.test(es);

    pairs.push({ start: vaTagStart, end: esEnd, va, es, wrapperPend, wrapperLegal, containsPend });
    openRe.lastIndex = esEnd;
  }
  return pairs;
}

// Ocurrencias de un atributo con texto real (aria-label, alt), en orden.
export function extractAttr(html, attrName) {
  const re = new RegExp(attrName + '="([^"]*)"', "g");
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    if (m[1].trim()) out.push({ start: m.index, end: re.lastIndex, value: m[1] });
  }
  return out;
}

export function extractTitle(html) {
  const m = /<title>([\s\S]*?)<\/title>/.exec(html);
  return m ? m[1] : null;
}

export function extractMetaDescription(html) {
  const m = /<meta name="description" content="([^"]*)"/.exec(html);
  return m ? m[1] : null;
}

// Encabezados h1-h3 que NO usan el patrón .va/.es (nombres propios, marca).
export function extractUntranslatedHeadings(html) {
  const out = [];
  const re = /<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/g;
  let m;
  while ((m = re.exec(html))) {
    if (!/class="va"/.test(m[2])) {
      out.push({ start: m.index, end: re.lastIndex, level: m[1], content: m[2] });
    }
  }
  return out;
}

// Mensajes bilingües en JS: clave: { va: "...", es: "..." }. Cubre form.js,
// api/_lib/validate.js y api/_lib/handler.js sin necesitar un parser de JS.
// Usa el flag "d" para obtener también las posiciones exactas del contenido
// de cada cadena (entre comillas), así apply-text.js puede sustituir solo esos
// dos tramos y conservar el resto del objeto (formato, saltos de línea,
// indentación) tal cual estaba.
export function extractJsMessages(js) {
  const out = [];
  const re = /(\w+)\s*:\s*\{\s*va:\s*"((?:[^"\\]|\\.)*)"\s*,\s*es:\s*"((?:[^"\\]|\\.)*)"\s*,?\s*\}/gd;
  let m;
  while ((m = re.exec(js))) {
    const [keyIdx, vaIdx, esIdx] = m.indices.slice(1);
    out.push({
      start: m.index,
      end: re.lastIndex,
      key: m[1],
      va: m[2],
      es: m[3],
      vaStart: vaIdx[0],
      vaEnd: vaIdx[1],
      esStart: esIdx[0],
      esEnd: esIdx[1],
    });
  }
  return out;
}

export const REGION_MARKERS = {
  header: { start: '<header class="top">', end: "</header>" },
  footer: { start: "<footer>", end: "</footer>" },
};

export function classifyRegion(html, pos) {
  const headerStart = html.indexOf(REGION_MARKERS.header.start);
  const headerEnd = headerStart >= 0 ? html.indexOf(REGION_MARKERS.header.end, headerStart) + REGION_MARKERS.header.end.length : -1;
  const footerStart = html.indexOf(REGION_MARKERS.footer.start);
  const footerEnd = footerStart >= 0 ? html.indexOf(REGION_MARKERS.footer.end, footerStart) + REGION_MARKERS.footer.end.length : -1;
  const skipStart = html.indexOf('<a class="skip"');
  const skipEnd = skipStart >= 0 ? html.indexOf("</a>", skipStart) + 4 : -1;

  if (skipStart >= 0 && pos >= skipStart && pos < skipEnd) return "skip";
  if (headerStart >= 0 && pos >= headerStart && pos < headerEnd) return "header";
  if (footerStart >= 0 && pos >= footerStart && pos < footerEnd) return "footer";
  return "body";
}
