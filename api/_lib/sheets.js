/* Grup Scout Parpalló — escriptura a Google Sheets via Apps Script.
 *
 * Sense SDK de Google i sense credencials OAuth: només `fetch` cap a un
 * endpoint d'Apps Script desplegat com a Web App. Qui gestiona la fulla
 * enganxa un petit script (scripts/google-apps-script.gs) al seu propi
 * document i el desplega; nosaltres només guardem la URL i un secret compartit.
 *
 * Motiu de no usar l'API oficial de Sheets: exigeix guardar una clau JSON
 * de compte de servei i firmar JWTs, cosa desproporcionada per a un
 * formulari amb dades de menors. Amb Apps Script tota l'autorització
 * queda dins del compte de Google propietari de la fulla; nosaltres no
 * toquem cap credencial de Google.
 *
 * La URL (SHEETS_WEBHOOK_URL) i el secret (SHEETS_SHARED_SECRET) arriben
 * per variable d'entorn del servidor i MAI s'inclouen en cap resposta ni
 * en cap log.
 */

const TIMEOUT_MS = 10000;

export async function appendRow(d, env) {
  return enviar(
    {
      tipus: "alta",
      rebut: new Date().toISOString(),
      nom: d.nom,
      cognoms: d.cognoms,
      naixement: d.naixement,
      seccio: d.seccio || "",
      notes: d.notes || "",
      tutor: d.tutor,
      telefon: d.telefon,
      email: d.email,
      conegut: d.conegut || "",
      estat: "Nova",
    },
    env
  );
}

/* Reserva de la botiga. Va a una pestanya distinta de la mateixa Sheet;
 * l'Apps Script tria la pestanya segons `tipus`.
 *
 * Els articles s'envien ja resumits en text ("2 × Sudadera; 1 × Pañoleta")
 * perquè la fila siga llegible per una persona sense haver de creuar taules,
 * i el total ja calculat pel servidor. */
export async function appendReserva(d, env) {
  return enviar(
    {
      tipus: "reserva",
      rebut: new Date().toISOString(),
      nom: d.nom,
      cognoms: d.cognoms,
      telefon: d.telefon || "",
      email: d.email,
      articles: d.articles.map((a) => `${a.qt} × ${a.nom}`).join("; "),
      unitats: d.articles.reduce((n, a) => n + a.qt, 0),
      total: d.totalText,
      notes: d.notes || "",
      estat: "Nova",
    },
    env
  );
}

async function enviar(dades, env) {
  const url = env.SHEETS_WEBHOOK_URL;
  const secret = env.SHEETS_SHARED_SECRET;
  if (!url) {
    const e = new Error("SHEETS_WEBHOOK_URL no configurat");
    e.code = "CONFIG";
    throw e;
  }

  const cos = Object.assign({ secret: secret || "" }, dades);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cos),
      signal: ctrl.signal,
      // Apps Script respon amb un 302 cap a script.googleusercontent.com
      // que fetch segueix per defecte; l'explicitem per si algun runtime
      // (Cloudflare Workers) canvia el valor per defecte en el futur.
      redirect: "follow",
    });
  } finally {
    clearTimeout(t);
  }

  if (!res.ok) {
    const e = new Error(`Sheets HTTP ${res.status}`);
    e.code = "SHEETS";
    e.status = res.status;
    throw e;
  }

  let body;
  try {
    body = await res.json();
  } catch (_) {
    // Si l'Apps Script llança abans de respondre, Google torna HTML.
    // Ho tractem com a error de configuració, no com un èxit ambigu.
    const e = new Error("Sheets: resposta no és JSON (revisa el desplegament)");
    e.code = "SHEETS";
    throw e;
  }

  if (!body.ok) {
    // body.error pot repetir dades del cos; retallem per no vessar-les als logs.
    const e = new Error(`Sheets: ${String(body.error || "error desconegut").slice(0, 200)}`);
    e.code = "SHEETS";
    throw e;
  }

  return true;
}
