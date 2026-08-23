/* Grup Scout Parpalló — validació de la reserva de la botiga (costat servidor).
 *
 * Mateix principi que validate.js: el que arriba del navegador no es creu mai.
 * Ací, a més, hi ha una regla que no es pot relaxar: els PREUS no venen del
 * client. El client diu "vull 2 d'este identificador" i el servidor busca el
 * preu al catàleg (productes.js) i calcula el total ell mateix.
 *
 * Estes dades no són de menors ni de salut: són un nom, un contacte i una
 * llista de peces de roba. Tot i això s'apliquen els mateixos topalls de
 * longitud, perquè cap camp lliure ha d'entrar sense límit.
 */

import { producte, preuText } from "./productes.js";

const LIMITS = {
  nom: 80,
  cognoms: 120,
  telefon: 24,
  email: 150,
  notes: 500,
};

const MAX_UNITATS_ARTICLE = 20; // per línia
const MAX_LINIES = 30;

const MSG = {
  nom: { va: "Falta el teu nom.", es: "Falta tu nombre." },
  cognoms: { va: "Falten els cognoms.", es: "Faltan los apellidos." },
  telefon: { va: "El telèfon no és vàlid.", es: "El teléfono no es válido." },
  email: { va: "L'email no és vàlid.", es: "El email no es válido." },
  notes: { va: "El text és massa llarg.", es: "El texto es demasiado largo." },
  articles: {
    va: "Tria almenys un article abans d'enviar la reserva.",
    es: "Elige al menos un artículo antes de enviar la reserva.",
  },
  articlesInvalids: {
    va: "Hi ha algun article que no és de la botiga. Torna a provar.",
    es: "Hay algún artículo que no es de la tienda. Inténtalo de nuevo.",
  },
  quantitat: {
    va: `Com a màxim ${MAX_UNITATS_ARTICLE} unitats per article. Si en necessites més, escriu-nos.`,
    es: `Como máximo ${MAX_UNITATS_ARTICLE} unidades por artículo. Si necesitas más, escríbenos.`,
  },
  dades: {
    va: "Cal acceptar la política de protecció de dades.",
    es: "Hay que aceptar la política de protección de datos.",
  },
};

function str(v) {
  return typeof v === "string" ? v.trim() : "";
}

// Elimina els caràcters de control (els que embruten els registres o injecten
// salts de línia en capçaleres) i conserva els salts de línia del camp de
// notes. S'escriu comparant codis en compte de amb una classe de regex per a
// no haver de posar caràcters de control literals dins del codi font.
function clean(v) {
  const s = str(v);
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 10 || c === 13) { out += s[i]; continue; }
    if (c < 32 || c === 127) continue;
    out += s[i];
  }
  return out;
}

function truthy(v) {
  return v === true || v === "on" || v === "true" || v === "1" || v === "sí" || v === "si";
}

function checkbox(v) {
  return v === undefined || v === null || v === "" ? false : truthy(v);
}

/* Accepta les dues formes en què pot arribar la comanda:
 *   - amb JS:   articles: [{ id: "sudadera", qt: 2 }, ...]
 *   - sense JS: camps solts del formulari natiu, qt-sudadera=2
 * Així la pàgina segueix funcionant amb JavaScript desactivat, igual que el
 * formulari d'alta. */
function llegirArticles(input) {
  const cru = [];

  if (Array.isArray(input.articles)) {
    for (const a of input.articles) {
      if (a && typeof a === "object") cru.push({ id: str(a.id), qt: a.qt });
    }
  } else {
    for (const clau of Object.keys(input)) {
      if (clau.startsWith("qt-")) cru.push({ id: clau.slice(3), qt: input[clau] });
    }
  }
  return cru;
}

export function validate(input) {
  const errors = {};
  const d = {};

  d.nom = clean(input.nom);
  if (!d.nom || d.nom.length > LIMITS.nom) errors.nom = MSG.nom;

  d.cognoms = clean(input.cognoms);
  if (!d.cognoms || d.cognoms.length > LIMITS.cognoms) errors.cognoms = MSG.cognoms;

  d.email = clean(input.email);
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(d.email) || d.email.length > LIMITS.email) {
    errors.email = MSG.email;
  }

  // El telèfon és opcional ací (a diferència de l'alta): amb l'email n'hi ha
  // prou per a contestar. Però si l'omplin, ha de ser plausible.
  d.telefon = clean(input.telefon);
  if (d.telefon) {
    const digits = d.telefon.replace(/\D/g, "");
    if (!/^[0-9+()\s.\-]{6,24}$/.test(d.telefon) || digits.length < 6 || digits.length > 15) {
      errors.telefon = MSG.telefon;
    }
  }

  d.notes = clean(input.notes);
  if (d.notes.length > LIMITS.notes) errors.notes = MSG.notes;

  // --- Articles: ací es recalcula tot, sense fer cas de cap preu del client ---
  const cru = llegirArticles(input);
  const articles = [];
  let total = 0;
  let desconegut = false;
  let excedida = false;

  if (cru.length > MAX_LINIES) {
    errors.articles = MSG.articlesInvalids;
  } else {
    for (const a of cru) {
      const qt = parseInt(str(a.qt) || String(a.qt ?? ""), 10);
      if (!Number.isFinite(qt) || qt <= 0) continue; // 0 unitats = no el vol

      const p = producte(a.id);
      if (!p) {
        desconegut = true;
        continue;
      }
      if (qt > MAX_UNITATS_ARTICLE) {
        excedida = true;
        continue;
      }
      articles.push({ id: p.id, nom: p.va.nom, qt, preu: p.preu, subtotal: p.preu * qt });
      total += p.preu * qt;
    }

    if (desconegut) errors.articles = MSG.articlesInvalids;
    else if (excedida) errors.articles = MSG.quantitat;
    else if (articles.length === 0) errors.articles = MSG.articles;
  }

  d.articles = articles;
  d.total = total;
  d.totalText = preuText(total);

  if (!checkbox(input.dades)) errors.dades = MSG.dades;

  return { ok: Object.keys(errors).length === 0, data: d, errors };
}

export { MSG, LIMITS, MAX_UNITATS_ARTICLE };
