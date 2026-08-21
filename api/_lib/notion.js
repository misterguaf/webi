/* Grup Scout Parpalló — escriptura a Notion via l'API oficial.
 *
 * Sense SDK a propòsit: només `fetch`, que existix ja en Node 18+, en
 * Cloudflare Workers i en Netlify. Menys dependències = menys superfície i
 * cap cadena de subpaquets que auditar per a un formulari amb dades de menors.
 *
 * La clau (NOTION_TOKEN) arriba per variable d'entorn del servidor i MAI
 * s'inclou en cap resposta ni en cap log.
 */

const NOTION_VERSION = "2022-06-28";
const TIMEOUT_MS = 10000;

/* Noms de les propietats de la base de dades de Notion.
 * Han de coincidir EXACTAMENT amb els de la BD (majúscules i accents inclosos).
 * Si canvieu un nom a Notion, canvieu-lo ací; està documentat al README. */
export const PROPS = {
  nom: "Nom",                    // Title
  cognoms: "Cognoms",            // Text
  naixement: "Data de naixement",// Date
  seccio: "Secció",              // Select
  notes: "Notes",                // Text
  tutor: "Tutor/a",              // Text
  telefon: "Telèfon",            // Phone
  email: "Email",                // Email
  conegut: "Com ens ha conegut", // Text
  estat: "Estat",                // Select
};

function text(v) {
  return { rich_text: v ? [{ type: "text", text: { content: v } }] : [] };
}

export function buildProperties(d) {
  const p = {
    [PROPS.nom]: { title: [{ type: "text", text: { content: d.nom } }] },
    [PROPS.cognoms]: text(d.cognoms),
    [PROPS.naixement]: { date: { start: d.naixement } },
    [PROPS.notes]: text(d.notes),
    [PROPS.tutor]: text(d.tutor),
    [PROPS.telefon]: { phone_number: d.telefon },
    [PROPS.email]: { email: d.email },
    [PROPS.conegut]: text(d.conegut),
    // Estat inicial: la BD de Notion ha de tindre esta opció al Select.
    [PROPS.estat]: { select: { name: "Nova" } },
  };
  // Un Select buit ha de ser `null`, no una opció amb nom buit.
  p[PROPS.seccio] = { select: d.seccio ? { name: d.seccio } : null };
  return p;
}

export async function createPage(d, env) {
  const token = env.NOTION_TOKEN;
  const dbId = env.NOTION_DATABASE_ID;
  if (!token || !dbId) {
    // Error de configuració, no de l'usuari: es distingix al handler.
    const e = new Error("NOTION_TOKEN o NOTION_DATABASE_ID no configurats");
    e.code = "CONFIG";
    throw e;
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parent: { database_id: dbId },
        properties: buildProperties(d),
      }),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }

  if (!res.ok) {
    // El cos d'error de Notion pot repetir dades enviades; per això només
    // conservem codi i missatge curt, i el handler decidix què registrar.
    let detail = "";
    try {
      const j = await res.json();
      detail = `${j.code || ""} ${String(j.message || "").slice(0, 200)}`.trim();
    } catch (_) {
      detail = `HTTP ${res.status}`;
    }
    const e = new Error(`Notion ${res.status}: ${detail}`);
    e.code = "NOTION";
    e.status = res.status;
    throw e;
  }

  return true;
}
