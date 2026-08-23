/**
 * Grup Scout Parpalló — Apps Script que rep les sol·licituds de plaça
 * i les afig com a fila a la fulla activa.
 *
 * COM S'INSTAL·LA (una sola vegada):
 *
 *   1. Obri la Google Sheet on vols que apareguen les sol·licituds.
 *   2. Menú Extensions → Apps Script. S'obri un editor.
 *   3. Esborra el contingut d'exemple i enganxa TOT este fitxer.
 *   4. Menú Configuració del projecte (l'engranatge) → Propietats de l'script
 *      → Afig una propietat:
 *         Nom:  SHARED_SECRET
 *         Valor: (una cadena llarga i aleatòria; el mateix valor que posaràs
 *                 al servidor com a SHEETS_SHARED_SECRET)
 *   5. Menú Desplega → Nou desplegament → Tipus: Aplicació web.
 *         "Executar com": Jo (el teu compte)
 *         "Qui té accés": Qualsevol
 *      Desplega, autoritza els permisos que demane, i copia la "URL de
 *      l'aplicació web". Eixa URL és el valor de SHEETS_WEBHOOK_URL al servidor.
 *
 *   Si més endavant modifiques este script, ves a Desplega → Gestiona
 *   desplegaments → editar el desplegament existent (llapis) → Versió: Nova
 *   → Desplega. Així es manté la MATEIXA URL. Si crees un desplegament nou
 *   la URL canvia i cal actualitzar-la al servidor.
 *
 * PRIVACITAT: no s'imprimeix mai el contingut de cap camp als registres
 * d'execució; Google guarda estos registres al teu compte.
 */

/* Hi ha dos tipus d'enviament i cada un va a la seua pestanya:
 *   - "alta"    → sol·licituds de plaça (fersescout.html)
 *   - "reserva" → reserves de la botiga (merchandising.html)
 * Si el camp `tipus` no arriba, es tracta com a alta, perquè és el que
 * enviaven les versions anteriors del servidor. */
var NOM_FULLA = "Sol·licituds";
var NOM_FULLA_RESERVES = "Reserves botiga";

var CAPCALERES = [
  "Rebut",
  "Nom",
  "Cognoms",
  "Data de naixement",
  "Secció",
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

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return respon({ ok: false, error: "sense cos" });
    }

    var dades;
    try {
      dades = JSON.parse(e.postData.contents);
    } catch (err) {
      return respon({ ok: false, error: "JSON invàlid" });
    }

    var esperat = PropertiesService.getScriptProperties().getProperty("SHARED_SECRET");
    if (!esperat) {
      return respon({ ok: false, error: "SHARED_SECRET no configurat" });
    }
    if (dades.secret !== esperat) {
      // No diem si el secret és curt, llarg o buit: només que no.
      return respon({ ok: false, error: "no autoritzat" });
    }

    var esReserva = dades.tipus === "reserva";
    var nomFulla = esReserva ? NOM_FULLA_RESERVES : NOM_FULLA;
    var capcaleres = esReserva ? CAPCALERES_RESERVES : CAPCALERES;

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var full = ss.getSheetByName(nomFulla) || ss.insertSheet(nomFulla);
    if (full.getLastRow() === 0) {
      full.appendRow(capcaleres);
      full.setFrozenRows(1);
    }

    if (esReserva) {
      full.appendRow([
        dades.rebut || new Date().toISOString(),
        dades.nom || "",
        dades.cognoms || "",
        dades.telefon || "",
        dades.email || "",
        dades.articles || "",
        dades.unitats || "",
        dades.total || "",
        dades.notes || "",
        dades.estat || "Nova",
      ]);
    } else {
      full.appendRow([
        dades.rebut || new Date().toISOString(),
        dades.nom || "",
        dades.cognoms || "",
        dades.naixement || "",
        dades.seccio || "",
        dades.notes || "",
        dades.tutor || "",
        dades.telefon || "",
        dades.email || "",
        dades.conegut || "",
        dades.estat || "Nova",
      ]);
    }

    return respon({ ok: true });
  } catch (err) {
    return respon({ ok: false, error: String(err && err.message || err).slice(0, 200) });
  }
}

function doGet() {
  // Perquè si algú entra amb el navegador a la URL, no es filtre res.
  return respon({ ok: false, error: "només POST" });
}

function respon(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
