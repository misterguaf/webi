/* Grup Scout Parpalló — validació de la sol·licitud de plaça (costat servidor).
 *
 * IMPORTANT: el `required` de l'HTML és només una comoditat per a l'usuari.
 * Qualsevol pot enviar un POST directe a l'endpoint saltant-se el navegador,
 * així que TOTA la validació de veritat viu ací.
 *
 * Este formulari recull dades de MENORS D'EDAT, però la llista d'espera no és
 * un canal sanitari. Els camps de salut i l'antic camp obert `notes` es
 * rebutgen explícitament perquè una interfície antiga no els reintroduïsca.
 */

const SECCIONS = [
  "Estol (8-11)",
  "Tropa (11-14)",
  "Escoltes (14-17)",
  "Clan (17-21)",
];

const LIMITS = {
  nom: 80,
  cognoms: 120,
  tutor: 120,
  telefon: 24,
  email: 150,
  conegut: 200,
};

// Missatges bilingües: el client tria segons l'idioma actiu de la pàgina.
const MSG = {
  nom: { va: "Falta el nom del xiquet o xiqueta.", es: "Falta el nombre del niño o niña." },
  cognoms: { va: "Falten els cognoms.", es: "Faltan los apellidos." },
  naixement: { va: "La data de naixement no és vàlida.", es: "La fecha de nacimiento no es válida." },
  seccio: { va: "Eixa secció no existix.", es: "Esa sección no existe." },
  sensitive: {
    va: "La llista d'espera no admet dades de salut ni observacions lliures.",
    es: "La lista de espera no admite datos de salud ni observaciones libres.",
  },
  tutor: { va: "Falta el nom de la mare, pare o tutor/a.", es: "Falta el nombre de la madre, padre o tutor/a." },
  telefon: { va: "El telèfon no és vàlid.", es: "El teléfono no es válido." },
  email: { va: "L'email no és vàlid.", es: "El email no es válido." },
  conegut: { va: "El text és massa llarg.", es: "El texto es demasiado largo." },
  dades: { va: "Cal acceptar la política de protecció de dades.", es: "Hay que aceptar la política de protección de datos." },
  contacte: { va: "Cal acceptar que us contactem.", es: "Hay que aceptar que os contactemos." },
};

function str(v) {
  return typeof v === "string" ? v.trim() : "";
}

// Elimina caràcters de control (inclosos els que trenquen logs o injecten
// salts de línia en capçaleres) però respecta els salts de línia del textarea.
function clean(v) {
  return str(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function truthy(v) {
  return v === true || v === "on" || v === "true" || v === "1" || v === "sí" || v === "si";
}

/* Un checkbox HTML no s'envia quan està desmarcat: la seua absència és un "no". */
function checkbox(v) {
  return v === undefined || v === null || v === "" ? false : truthy(v);
}

export function validate(input) {
  const errors = {};
  const d = {};

  if (containsForbiddenSensitiveField(input)) errors.sensitive = MSG.sensitive;

  d.nom = clean(input.nom);
  if (!d.nom || d.nom.length > LIMITS.nom) errors.nom = MSG.nom;

  d.cognoms = clean(input.cognoms);
  if (!d.cognoms || d.cognoms.length > LIMITS.cognoms) errors.cognoms = MSG.cognoms;

  // Data de naixement: ISO (YYYY-MM-DD), real, i dins d'un rang plausible.
  // Ni un futur ni una persona de 90 anys apuntant-se a la manada.
  d.naixement = str(input.naixement);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.naixement);
  if (!iso) {
    errors.naixement = MSG.naixement;
  } else {
    const dt = new Date(d.naixement + "T00:00:00Z");
    const ok =
      !isNaN(dt.getTime()) &&
      dt.getUTCFullYear() === +iso[1] &&
      dt.getUTCMonth() + 1 === +iso[2] &&
      dt.getUTCDate() === +iso[3];
    const anys = ok ? (Date.now() - dt.getTime()) / 31557600000 : -1;
    if (!ok || anys < 0 || anys > 40) errors.naixement = MSG.naixement;
  }

  // La secció és opcional (al formulari diu "t'ajudem per l'edat"), però si
  // ve, ha de ser una de les nostres. Llista tancada, res d'arbitrari a Notion.
  d.seccio = str(input.seccio);
  if (d.seccio && !SECCIONS.includes(d.seccio)) errors.seccio = MSG.seccio;

  d.tutor = clean(input.tutor);
  if (!d.tutor || d.tutor.length > LIMITS.tutor) errors.tutor = MSG.tutor;

  d.telefon = clean(input.telefon);
  // Permissiu a propòsit: prefixos, espais, guions i parèntesis són normals.
  // Només exigim que hi haja entre 6 i 15 dígits de veritat.
  const digits = d.telefon.replace(/\D/g, "");
  if (!/^[0-9+()\s.\-]{6,24}$/.test(d.telefon) || digits.length < 6 || digits.length > 15) {
    errors.telefon = MSG.telefon;
  }

  d.email = clean(input.email);
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(d.email) || d.email.length > LIMITS.email) {
    errors.email = MSG.email;
  }

  d.conegut = clean(input.conegut);
  if (d.conegut.length > LIMITS.conegut) errors.conegut = MSG.conegut;

  // Els dos consentiments són obligatoris: sense ells no hi ha base legal per
  // a tractar les dades, així que ni tan sols arriben a Notion.
  if (!checkbox(input.dades)) errors.dades = MSG.dades;
  if (!checkbox(input.contacte)) errors.contacte = MSG.contacte;

  return { ok: Object.keys(errors).length === 0, data: d, errors };
}

const FORBIDDEN_SENSITIVE_FIELDS = new Set([
  "notes",
  "alergia",
  "alergias",
  "allergies",
  "allergy",
  "salut",
  "salud",
  "health",
  "medical",
  "medicacio",
  "medicacion",
  "medication",
  "diagnostic",
  "diagnostico",
  "diagnosis",
  "malaltia",
  "enfermedad",
]);

function normalizedKey(value) {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function containsForbiddenSensitiveField(input) {
  return Object.keys(input || {}).some((key) => FORBIDDEN_SENSITIVE_FIELDS.has(normalizedKey(key)));
}

/* Anti-spam sense serveis externs ni captchas de pagament.
 *
 * 1) Honeypot: un camp ocult que cap persona veu ni omple. Els bots que
 *    omplin tots els inputs del formulari cauen ací.
 * 2) Temps mínim: el JS del client posa una marca de temps en carregar. Un
 *    formulari enviat en menys de 3 segons és automàtic, no humà.
 *    Només es comprova si la marca hi és (sense JS no existix i no es penalitza).
 *
 * Es retorna `spam:true` sense dir per què: al bot li contestem un 200 fals
 * (vegeu handler.js) per a no ensenyar-li quin filtre l'ha aturat.
 */
export function isSpam(input) {
  if (str(input.malnom) !== "") return true;

  const ts = parseInt(str(input._ts), 10);
  if (Number.isFinite(ts) && ts > 0) {
    const transcorregut = Date.now() - ts;
    if (transcorregut < 3000) return true;
    // Marca de més de 24 h: pestanya vella o valor manipulat.
    if (transcorregut > 86400000) return true;
  }
  return false;
}

export { SECCIONS, LIMITS, FORBIDDEN_SENSITIVE_FIELDS };
