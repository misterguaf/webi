/**
 * Grup Scout Parpalló — Apps Script que rep els enviaments dels formularis
 * de la web i els afig com a fila a la fulla que li toca.
 *
 * Hi ha tres tipus d'enviament i cada un va a la seua pestanya:
 *   - "alta"        → sol·licituds de plaça (fersescout.html)
 *   - "reserva"     → reserves de la botiga (merchandising.html)
 *   - "quota"       → quota anual (portal privat, una fila per menor)
 * "inscripcio" es rebutja explícitament: les activitats noves passen per
 * portal/worker.js i D1, mai per este script.
 * Si el camp `tipus` no arriba, es tracta com a alta, perquè és el que
 * enviaven les versions anteriors del servidor.
 *
 * COM S'INSTAL·LA I COM ES DESPLEGA: vegeu el README del repositori, secció
 * "La Google Sheet i el seu Apps Script". En resum: Extensions → Apps Script,
 * enganxar tot este fitxer, afegir les propietats de configuració i desplegar-lo
 * com a aplicació web.
 *
 * PRIVACITAT: no s'imprimeix mai el contingut de cap camp als registres
 * d'execució; Google guarda estos registres al teu compte.
 */

/* Les dades operatives NO viuen en el codi: configura les propietats de script
 * WEBHOOK_HMAC_SECRET (32+ caràcters aleatoris) i
 * DRIVE_FOLDER_CUOTES_ID (carpeta privada de quotes). */

/* Nom que veurà la família com a remitent del correu. L'adreça NO es pot
 * triar ací: MailApp envia sempre des del compte de Google propietari
 * d'este script (o des d'un dels seus àlies verificats). */
var REMITENT_NOM = "Grup Scout Parpalló";

/* Adreça de contacte per a dubtes, que va al peu del correu. */
var CORREU_CONTACTE = "gsparpallo@scoutsvalencians.org";

/* ========================================================================== */

var NOM_FULLA = "Sol·licituds";
var NOM_FULLA_RESERVES = "Reserves botiga";
var NOM_FULLA_QUOTES = "Cuotas";
var NOM_FULLA_RESUM_QUOTES = "Estado cuotas";

var CAPCALERES = [
  "Rebut",
  "Nom",
  "Cognoms",
  "Data de naixement",
  "Secció",
  // LEGACY_FIELD_PENDING_MIGRATION: es conserva la columna per compatibilitat
  // amb fulles existents, però el backend ja no accepta ni envia este camp.
  "Notes",
  "Tutor/a",
  "Telèfon",
  "Email",
  "Com ens ha conegut",
  "Estat",
];

var CAPCALERES_RESERVES = [
  "Rebut",
  "Nom",
  "Cognoms",
  "Telèfon",
  "Email",
  "Articles",
  "Unitats",
  "Total",
  "Notes",
  "Estat",
];

var CAPCALERES_QUOTES = [
  "Timestamp",
  "Referència pagament",
  "Curs",
  "Nom del menor",
  "Secció",
  "Import menor",
  "Total pagament",
  "Estat",
  "Data confirmació",
  "Tutor/a",
  "Telèfon",
  "Email",
  "Clau idempotència",
  "Comprovant",
  "Correu recepció",
  "Correu confirmació",
  "Notes tresoreria",
];

var CAPCALERES_RESUM_QUOTES = ["Curs", "Menor", "Secció", "Estat", "Data confirmació"];

// Índexs (base 0) de les columnes de quota que el codi consulta per nom.
var COL_QUOTA_REFERENCIA = 1;
var COL_QUOTA_ESTAT = 7;
var COL_QUOTA_CONFIRMADA = 8;
var COL_QUOTA_EMAIL = 11;
var COL_QUOTA_CLAU = 12;
var COL_QUOTA_CORREU_RECEPCIO = 14;
var COL_QUOTA_CORREU_CONFIRMAT = 15;

var SECCIONS_VALIDES = ["EST", "TRO", "ESC", "CLA"];

/* La quota conserva la comprovació dels justificants de fins a 4 MB. */
var COMPROVANT_TIPUS = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
var COMPROVANT_MAX_BYTES = 4 * 1024 * 1024;
var COMPROVANT_EXTENSIO = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return respon({ ok: false, error: "sense cos" });
    }

    var sobre;
    try {
      sobre = JSON.parse(e.postData.contents);
    } catch (err) {
      return respon({ ok: false, error: "JSON invàlid" });
    }

    var dades = obriSobreSignat(sobre);
    if (!dades) {
      return respon({ ok: false, error: "no autoritzat" });
    }

    if (dades.tipus === "inscripcio") {
      return respon({ ok: false, error: "activitats desactivades en Apps Script" });
    }

    if (dades.tipus === "quota") {
      /* El correlatiu i la idempotència de quota continuen protegits per pany. */
      var pany = LockService.getScriptLock();
      try {
        pany.waitLock(25000);
      } catch (err) {
        return respon({ ok: false, error: "servidor ocupat" });
      }
      try {
        return quota(dades);
      } finally {
        pany.releaseLock();
      }
    }

    if (dades.tipus === "reserva") return reserva(dades);
    if (!dades.tipus || dades.tipus === "alta") return alta(dades);
    return respon({ ok: false, error: "tipus no admés" });
  } catch (err) {
    return respon({ ok: false, error: String((err && err.message) || err).slice(0, 200) });
  }
}

/* El Worker firma el text exacte del payload. El timestamp limita la finestra
 * de replay i el nonce queda marcat temporalment en CacheService. */
function obriSobreSignat(sobre) {
  if (!sobre || typeof sobre.payload !== "string" || typeof sobre.nonce !== "string") return null;
  var secret = PropertiesService.getScriptProperties().getProperty("WEBHOOK_HMAC_SECRET");
  var timestamp = Number(sobre.timestamp);
  var ara = Math.floor(Date.now() / 1000);
  if (!secret || !Number.isFinite(timestamp) || Math.abs(ara - timestamp) > 300) return null;
  if (!/^[A-Za-z0-9-]{16,100}$/.test(sobre.nonce) || !/^[a-f0-9]{64}$/.test(String(sobre.signature))) return null;

  var esperada = hmacHex(String(sobre.timestamp) + "." + sobre.nonce + "." + sobre.payload, secret);
  if (!igualConstant(String(sobre.signature), esperada)) return null;

  var pany = LockService.getScriptLock();
  try {
    if (!pany.tryLock(1000)) return null;
    var cache = CacheService.getScriptCache();
    var clau = "nonce:" + sobre.nonce;
    if (cache.get(clau)) return null;
    cache.put(clau, "1", 360);
  } finally {
    if (pany.hasLock()) pany.releaseLock();
  }

  try {
    var dades = JSON.parse(sobre.payload);
    return dades && typeof dades === "object" && !Array.isArray(dades) ? dades : null;
  } catch (_) {
    return null;
  }
}

function hmacHex(text, secret) {
  var bytes = Utilities.computeHmacSha256Signature(text, secret);
  return bytes.map(function (b) {
    return ((b + 256) % 256).toString(16).padStart(2, "0");
  }).join("");
}

function igualConstant(a, b) {
  if (a.length !== b.length) return false;
  var diferencia = 0;
  for (var i = 0; i < a.length; i++) diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferencia === 0;
}

function carpetaQuotesId() {
  return PropertiesService.getScriptProperties().getProperty("DRIVE_FOLDER_CUOTES_ID") || "";
}

function fullResumQuotes() {
  var id = PropertiesService.getScriptProperties().getProperty("STATUS_SPREADSHEET_ID") || "";
  if (!id) throw new Error("STATUS_SPREADSHEET_ID no configurat");
  var ss = SpreadsheetApp.openById(id);
  var full = ss.getSheetByName(NOM_FULLA_RESUM_QUOTES) || ss.insertSheet(NOM_FULLA_RESUM_QUOTES);
  if (full.getLastRow() === 0) {
    full.appendRow(CAPCALERES_RESUM_QUOTES);
    full.setFrozenRows(1);
    full.getRange(1, 1, 1, CAPCALERES_RESUM_QUOTES.length).setFontWeight("bold").setBackground("#5E7948").setFontColor("#FFFFFF");
  }
  return full;
}

function safeCell(valor) {
  if (valor instanceof Date) return valor;
  var text = String(valor === undefined || valor === null ? "" : valor);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function safeRow(files) {
  return files.map(safeCell);
}

function doGet() {
  // Perquè si algú entra amb el navegador a la URL, no es filtre res.
  return respon({ ok: false, error: "només POST" });
}

/* Torna la pestanya demanada, creant-la amb les seues capçaleres la primera
 * vegada. La fila de capçalera queda congelada i en negreta sobre el verd del
 * grup, per a que es distingisca en obrir la fulla. */
function fulla(nom, capcaleres) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var full = ss.getSheetByName(nom) || ss.insertSheet(nom);
  if (full.getLastRow() === 0) {
    full.appendRow(capcaleres);
    full.setFrozenRows(1);
    full
      .getRange(1, 1, 1, capcaleres.length)
      .setFontWeight("bold")
      .setBackground("#5E7948")
      .setFontColor("#FFFFFF");
  }
  return full;
}

function alta(d) {
  fulla(NOM_FULLA, CAPCALERES).appendRow(safeRow([
    d.rebut || new Date().toISOString(),
    d.nom || "",
    d.cognoms || "",
    d.naixement || "",
    d.seccio || "",
    "", // LEGACY_FIELD_PENDING_MIGRATION: mai copiar salut/notes de l'alta.
    d.tutor || "",
    d.telefon || "",
    d.email || "",
    d.conegut || "",
    d.estat || "Nova",
  ]));
  return respon({ ok: true });
}

function reserva(d) {
  fulla(NOM_FULLA_RESERVES, CAPCALERES_RESERVES).appendRow(safeRow([
    d.rebut || new Date().toISOString(),
    d.nom || "",
    d.cognoms || "",
    d.telefon || "",
    d.email || "",
    d.articles || "",
    d.unitats || "",
    d.total || "",
    d.notes || "",
    d.estat || "Nova",
  ]));
  return respon({ ok: true });
}

/* --------------------------------------------------------------------------
 * Quota anual
 * ------------------------------------------------------------------------ */

function quota(d) {
  if (!d.idempotencyKey || !d.email || !d.tutor || !d.curs || !Array.isArray(d.fills)) {
    return respon({ ok: false, error: "dades incompletes" });
  }
  if (d.fills.length < 1 || d.fills.length > 8 || !Array.isArray(d.imports) || d.imports.length !== d.fills.length) {
    return respon({ ok: false, error: "nombre de menors no vàlid" });
  }
  for (var f = 0; f < d.fills.length; f++) {
    if (!d.fills[f].nom || !d.fills[f].cognoms || SECCIONS_VALIDES.indexOf(d.fills[f].seccio) < 0) {
      return respon({ ok: false, error: "dades del menor no vàlides" });
    }
    if (!Number.isFinite(Number(d.imports[f])) || Number(d.imports[f]) < 0) {
      return respon({ ok: false, error: "import no vàlid" });
    }
  }
  if (!carpetaQuotesId()) return respon({ ok: false, error: "carpeta de quotes sense configurar" });
  if (!d.comprovant || !d.comprovant.base64 || COMPROVANT_TIPUS.indexOf(d.comprovant.tipus) < 0) {
    return respon({ ok: false, error: "comprovant no vàlid" });
  }
  if (Math.floor((String(d.comprovant.base64).length * 3) / 4) > COMPROVANT_MAX_BYTES) {
    return respon({ ok: false, error: "comprovant massa gran" });
  }

  var full = fulla(NOM_FULLA_QUOTES, CAPCALERES_QUOTES);
  var files = full.getLastRow() > 1
    ? full.getRange(2, 1, full.getLastRow() - 1, CAPCALERES_QUOTES.length).getValues()
    : [];
  for (var i = 0; i < files.length; i++) {
    if (String(files[i][COL_QUOTA_CLAU]) === String(d.idempotencyKey)) {
      return respon({ ok: true, referencia: String(files[i][COL_QUOTA_REFERENCIA]), duplicada: true });
    }
  }

  var referenciesExistents = {};
  files.forEach(function (fila) { referenciesExistents[String(fila[COL_QUOTA_REFERENCIA])] = true; });
  var referencia = generaReferenciaQuota(d.curs, Object.keys(referenciesExistents).length);
  var urlComprovant;
  try {
    urlComprovant = guardaComprovantEn(carpetaQuotes(), d.comprovant, referencia);
  } catch (err) {
    console.error("No s'ha pogut guardar el comprovant de quota: " + ((err && err.message) || err));
    return respon({ ok: false, error: "no s'ha pogut guardar el comprovant" });
  }

  var ara = new Date();
  var primeraFila = full.getLastRow() + 1;
  for (var j = 0; j < d.fills.length; j++) {
    var fill = d.fills[j];
    full.appendRow(safeRow([
      ara,
      referencia,
      d.curs,
      fill.nom + " " + fill.cognoms,
      fill.seccio,
      d.importsText && d.importsText[j] ? d.importsText[j] : "",
      d.totalText || "",
      "PENDIENTE",
      "",
      d.tutor,
      d.telefon || "",
      d.email,
      d.idempotencyKey,
      urlComprovant,
      "",
      "",
      "",
    ]));
  }

  try {
    enviaCorreuQuotaRebuda(d, referencia);
    full.getRange(primeraFila, COL_QUOTA_CORREU_RECEPCIO + 1).setValue(new Date());
  } catch (err) {
    console.error("No s'ha pogut enviar el correu de recepció de quota: " + ((err && err.message) || err));
  }
  try {
    sincronitzaEstatCuotes();
  } catch (err) {
    console.error("No s'ha pogut sincronitzar el resum de quotes: " + ((err && err.message) || err));
  }
  return respon({ ok: true, referencia: referencia });
}

function generaReferenciaQuota(curs, filesExistents) {
  var props = PropertiesService.getScriptProperties();
  var clau = "corr:quota:" + curs;
  var actual = parseInt(props.getProperty(clau), 10);
  if (!(actual > 0)) actual = filesExistents;
  var seguent = actual + 1;
  props.setProperty(clau, String(seguent));
  return "QUOTA-" + String(curs).replace(/\D/g, "").slice(-4) + "-" + ("000" + seguent).slice(-4);
}

/* Decodifica el comprovant (fotografia o PDF del rebut de la transferència)
 * i el guarda a la carpeta privada de Drive. Torna la URL del fitxer, que és
 * el que s'escriu a la Sheet: la Sheet no guarda mai el fitxer en si, només
 * l'enllaç.
 *
 * El nom del fitxer porta la referència de quota perquè tresoreria el trobe.
 */
function guardaComprovantEn(carpeta, comprovant, referencia) {
  var bytes = Utilities.base64Decode(comprovant.base64);
  var extensio = COMPROVANT_EXTENSIO[comprovant.tipus] || "bin";
  var blob = Utilities.newBlob(bytes, comprovant.tipus, "comprovant-" + referencia + "." + extensio);
  var fitxer = carpeta.createFile(blob);
  return fitxer.getUrl();
}

function carpetaQuotes() {
  var id = carpetaQuotesId();
  if (id) {
    try {
      return DriveApp.getFolderById(id);
    } catch (err) {
      console.error("No s'ha pogut obrir DRIVE_FOLDER_CUOTES_ID: " + ((err && err.message) || err));
    }
  }
  throw new Error("DRIVE_FOLDER_CUOTES_ID no configurat o inaccessible");
}

function enviaCorreuQuotaRebuda(d, referencia) {
  var es = d.idioma === "es";
  var noms = d.fills.map(function (fill) { return fill.nom + " " + fill.cognoms; }).join(", ");
  var cos = es
    ? ["Hola,", "", "Hemos recibido el comprobante de la cuota anual de " + noms + ".", "", "Referencia: " + referencia, "Total: " + (d.totalText || ""), "Estado: PENDIENTE DE REVISIÓN.", "", "Tesorería comprobará el ingreso y te avisará cuando quede confirmado.", "", "Para cualquier duda, escríbenos a " + CORREU_CONTACTE + ".", "", "Un saludo,", REMITENT_NOM].join("\n")
    : ["Hola,", "", "Hem rebut el comprovant de la quota anual de " + noms + ".", "", "Referència: " + referencia, "Total: " + (d.totalText || ""), "Estat: PENDENT DE REVISIÓ.", "", "Tresoreria comprovarà l'ingrés i t'avisarà quan quede confirmat.", "", "Per a qualsevol dubte, escriu-nos a " + CORREU_CONTACTE + ".", "", "Una abraçada,", REMITENT_NOM].join("\n");
  MailApp.sendEmail({
    to: d.email,
    subject: (es ? "Cuota recibida · " : "Quota rebuda · ") + referencia,
    body: cos,
    name: REMITENT_NOM,
    replyTo: CORREU_CONTACTE,
  });
}

function enviaCorreuQuotaPagada(email, referencia) {
  MailApp.sendEmail({
    to: email,
    subject: "Quota confirmada / Cuota confirmada · " + referencia,
    body: ["Hola,", "", "La quota anual associada a la referència " + referencia + " ha quedat confirmada.", "La cuota anual asociada a la referencia " + referencia + " ha quedado confirmada.", "", "Gràcies / Gracias,", REMITENT_NOM].join("\n"),
    name: REMITENT_NOM,
    replyTo: CORREU_CONTACTE,
  });
}

/* Disparador instal·lable: quan tresoreria canvia un estat, aplica el mateix
 * estat a tots els germans de la referència, actualitza el resum i envia el
 * correu de PAGADA una única vegada. */
function onEditCuotes(e) {
  if (!e || !e.range || e.range.getSheet().getName() !== NOM_FULLA_QUOTES) return;
  if (e.range.getColumn() !== COL_QUOTA_ESTAT + 1 || e.range.getRow() < 2) return;
  var estat = String(e.value || "").toUpperCase();
  if (["PENDIENTE", "PAGADA", "INCIDENCIA", "EXENTA", "ANULADA"].indexOf(estat) < 0) {
    e.range.setValue(e.oldValue || "PENDIENTE");
    return;
  }
  var full = e.range.getSheet();
  var referencia = String(full.getRange(e.range.getRow(), COL_QUOTA_REFERENCIA + 1).getValue());
  var files = full.getRange(2, 1, full.getLastRow() - 1, CAPCALERES_QUOTES.length).getValues();
  var ara = new Date();
  var email = "";
  var jaEnviat = false;
  for (var i = 0; i < files.length; i++) {
    if (String(files[i][COL_QUOTA_REFERENCIA]) !== referencia) continue;
    var fila = i + 2;
    full.getRange(fila, COL_QUOTA_ESTAT + 1).setValue(estat);
    full.getRange(fila, COL_QUOTA_CONFIRMADA + 1).setValue(estat === "PAGADA" ? ara : "");
    email = email || String(files[i][COL_QUOTA_EMAIL] || "");
    jaEnviat = jaEnviat || Boolean(files[i][COL_QUOTA_CORREU_CONFIRMAT]);
  }
  if (estat === "PAGADA" && email && !jaEnviat) {
    try {
      enviaCorreuQuotaPagada(email, referencia);
      for (var j = 0; j < files.length; j++) {
        if (String(files[j][COL_QUOTA_REFERENCIA]) === referencia) full.getRange(j + 2, COL_QUOTA_CORREU_CONFIRMAT + 1).setValue(ara);
      }
    } catch (err) {
      console.error("No s'ha pogut enviar el correu de quota confirmada: " + ((err && err.message) || err));
    }
  }
  sincronitzaEstatCuotes();
}

function sincronitzaEstatCuotes() {
  var origen = fulla(NOM_FULLA_QUOTES, CAPCALERES_QUOTES);
  var files = origen.getLastRow() > 1
    ? origen.getRange(2, 1, origen.getLastRow() - 1, CAPCALERES_QUOTES.length).getValues()
    : [];
  var resum = files.map(function (fila) {
    return safeRow([fila[2], fila[3], fila[4], fila[COL_QUOTA_ESTAT], fila[COL_QUOTA_CONFIRMADA]]);
  });
  var desti = fullResumQuotes();
  if (desti.getLastRow() > 1) desti.getRange(2, 1, desti.getLastRow() - 1, CAPCALERES_RESUM_QUOTES.length).clearContent();
  if (resum.length) desti.getRange(2, 1, resum.length, CAPCALERES_RESUM_QUOTES.length).setValues(resum);
}

function installaAutomatitzacionsCuotes() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (["onEditCuotes", "sincronitzaEstatCuotes"].indexOf(trigger.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger("onEditCuotes").forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onEdit().create();
  ScriptApp.newTrigger("sincronitzaEstatCuotes").timeBased().everyHours(1).create();
}

/* ==========================================================================
 * PROVA MANUAL — EXECUTA-LA DES DE L'EDITOR
 *
 * Tria "provaConfiguracio" al desplegable de dalt i polsa "Executar".
 *
 * Fa dues faenes:
 *
 *   1. DISPARA LA FINESTRA D'AUTORITZACIÓ. És el motiu més probable que les
 *      quotes no s'escriguen. Este script necessita permís de Drive
 *      (per als comprovants de quota) i de Gmail (per al correu), permisos que ABANS
 *      no li feien falta. Google NO els demana sol en desplegar una
 *      aplicació web: cal executar una funció des de l'editor una vegada i
 *      acceptar la finestra. Fins que no ho faces, tota crida a Drive falla.
 *
 *   2. Comprova que es pot escriure a la carpeta de comprovants de quota,
 *      i deixa el resultat al registre (Ctrl+Retorn o menú "Registre
 *      d'execució"). Crea un fitxer de prova diminut i el borra tot seguit.
 *
 * És segura: no toca cap fila ni envia cap correu.
 * ========================================================================== */
function provaConfiguracio() {
  var linies = [];

  linies.push("Compte que executa el script: " + Session.getEffectiveUser().getEmail());

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    linies.push("Sheet: «" + ss.getName() + "» — OK");
  } catch (err) {
    linies.push("Sheet: ERROR — " + ((err && err.message) || err));
  }

  var idCarpetaQuotes = carpetaQuotesId();
  if (!idCarpetaQuotes) {
    linies.push("DRIVE_FOLDER_CUOTES_ID: sense configurar.");
  } else {
    try {
      var carpetaQuotesProva = DriveApp.getFolderById(idCarpetaQuotes);
      var fitxerQuotesProva = carpetaQuotesProva.createFile(
        Utilities.newBlob("prova", "text/plain", "prova-permisos-quotes.txt")
      );
      fitxerQuotesProva.setTrashed(true);
      linies.push("Carpeta de quotes: «" + carpetaQuotesProva.getName() + "» — lectura i escriptura OK.");
    } catch (err) {
      linies.push("Carpeta de quotes: ERROR — " + ((err && err.message) || err));
    }
  }

  try {
    var resum = fullResumQuotes();
    linies.push("Sheet resum de responsables: «" + resum.getParent().getName() + "» — OK.");
  } catch (err) {
    linies.push("STATUS_SPREADSHEET_ID: ERROR — " + ((err && err.message) || err));
  }

  var secret = PropertiesService.getScriptProperties().getProperty("WEBHOOK_HMAC_SECRET");
  linies.push(
    secret
      ? "WEBHOOK_HMAC_SECRET: configurat (" + secret.length + " caràcters)."
      : "WEBHOOK_HMAC_SECRET: NO configurat — cap enviament de la web serà acceptat."
  );

  var resultat = linies.join("\n");
  console.log(resultat);
  return resultat;
}

function respon(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
