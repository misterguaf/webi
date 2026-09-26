/* Validació de la quota anual. Només recull les dades imprescindibles per a
 * identificar el pagament; no demana DNI, naixement, salut ni autoritzacions.
 */

import { calculaQuota, configuracioCompleta, configuracioQuota, preuText } from "./cuotes.js";

const CODIS_SECCIO = ["EST", "TRO", "ESC", "CLA"];
const MAX_FILLS = 8;
const MAX_FITXER = 4 * 1024 * 1024;
const TIPUS = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

const MSG = {
  tancada: {
    va: "La quota anual encara no està oberta o falta confirmar-ne les dades.",
    es: "La cuota anual todavía no está abierta o falta confirmar sus datos.",
  },
  fills: { va: "Afig almenys un xiquet o xiqueta.", es: "Añade al menos un niño o niña." },
  nom: { va: "Falta el nom.", es: "Falta el nombre." },
  cognoms: { va: "Falten els cognoms.", es: "Faltan los apellidos." },
  seccio: { va: "Tria una secció.", es: "Elige una sección." },
  tutor: { va: "Falta el nom del tutor o tutora.", es: "Falta el nombre del tutor o tutora." },
  telefon: { va: "El telèfon no és vàlid.", es: "El teléfono no es válido." },
  email: { va: "L'email no és vàlid.", es: "El email no es válido." },
  comprovant: { va: "Adjunta el comprovant de la transferència.", es: "Adjunta el comprobante de la transferencia." },
  comprovantTipus: { va: "El comprovant ha de ser JPG, PNG, WEBP o PDF.", es: "El comprobante debe ser JPG, PNG, WEBP o PDF." },
  comprovantMida: { va: "El comprovant supera el límit de 4 MB.", es: "El comprobante supera el límite de 4 MB." },
  privacitat: { va: "Cal acceptar la política de privacitat.", es: "Hay que aceptar la política de privacidad." },
  idempotencyKey: { va: "Enviament no vàlid. Recarrega i torna-ho a provar.", es: "Envío no válido. Recarga e inténtalo de nuevo." },
};

function str(valor) {
  return typeof valor === "string" ? valor.trim().replace(/[\u0000-\u001F\u007F]/g, "") : "";
}

function cert(valor) {
  return valor === true || valor === "true" || valor === "1" || valor === "on";
}

/* La quota conserva la comprovació de signatura que compartia amb l'antic
 * validador d'activitats. El validador antic ja no és una ruta funcional. */
export function comprovantTeSignatura(base64, tipus) {
  let binari;
  try {
    binari = atob(base64.slice(0, 64));
  } catch (_) {
    return false;
  }
  const byte = (i) => (i < binari.length ? binari.charCodeAt(i) : -1);
  const ascii = (inici, text) =>
    text.split("").every((c, i) => byte(inici + i) === c.charCodeAt(0));

  if (tipus === "image/jpeg") return byte(0) === 0xff && byte(1) === 0xd8 && byte(2) === 0xff;
  if (tipus === "image/png") {
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => byte(i) === v);
  }
  if (tipus === "image/webp") return ascii(0, "RIFF") && ascii(8, "WEBP");
  if (tipus === "application/pdf") return ascii(0, "%PDF-");
  return false;
}

export function validateQuota(input, config = configuracioQuota()) {
  const errors = {};
  const data = {};
  if (!configuracioCompleta(config)) errors.quota = MSG.tancada;

  const fillsEntrada = Array.isArray(input.fills) ? input.fills.slice(0, MAX_FILLS) : [];
  if (!fillsEntrada.length || (Array.isArray(input.fills) && input.fills.length > MAX_FILLS)) {
    errors.fills = MSG.fills;
  }
  data.fills = fillsEntrada.map((fill, index) => {
    const nom = str(fill && fill.nom).slice(0, 80);
    const cognoms = str(fill && fill.cognoms).slice(0, 120);
    const seccio = str(fill && fill.seccio).toUpperCase();
    if (!nom) errors[`fills.${index}.nom`] = MSG.nom;
    if (!cognoms) errors[`fills.${index}.cognoms`] = MSG.cognoms;
    if (!CODIS_SECCIO.includes(seccio)) errors[`fills.${index}.seccio`] = MSG.seccio;
    return { nom, cognoms, seccio };
  });

  data.tutor = str(input.tutor).slice(0, 120);
  if (!data.tutor) errors.tutor = MSG.tutor;

  data.telefon = str(input.telefon).slice(0, 24);
  const digits = data.telefon.replace(/\D/g, "");
  if (!/^[0-9+()\s.\-]{6,24}$/.test(data.telefon) || digits.length < 6 || digits.length > 15) {
    errors.telefon = MSG.telefon;
  }

  data.email = str(input.email).slice(0, 150);
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(data.email)) errors.email = MSG.email;

  const comp = input.comprovant && typeof input.comprovant === "object" ? input.comprovant : null;
  const base64 = comp ? str(comp.base64) : "";
  data.comprovant = {
    nom: comp ? str(comp.nom).slice(0, 160) : "",
    tipus: comp ? str(comp.tipus) : "",
    base64,
  };
  if (!base64) errors.comprovant = MSG.comprovant;
  else if (!TIPUS.includes(data.comprovant.tipus)) errors.comprovant = MSG.comprovantTipus;
  else if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) errors.comprovant = MSG.comprovant;
  else if (Math.floor((base64.length * 3) / 4) > MAX_FITXER) errors.comprovant = MSG.comprovantMida;
  else if (!comprovantTeSignatura(base64, data.comprovant.tipus)) errors.comprovant = MSG.comprovantTipus;

  data.privacitat = cert(input.privacitat);
  if (!data.privacitat) errors.privacitat = MSG.privacitat;

  data.idempotencyKey = str(input.idempotencyKey);
  if (!/^[A-Za-z0-9-]{8,64}$/.test(data.idempotencyKey)) errors.idempotencyKey = MSG.idempotencyKey;
  data.idioma = input.idioma === "es" ? "es" : "va";

  const calcul = calculaQuota(data.fills.length, config);
  if (!calcul) errors.quota = MSG.tancada;
  data.curs = String(config.curs || "");
  data.imports = calcul ? calcul.imports : [];
  data.importsText = data.imports.map(preuText);
  data.totalCentims = calcul ? calcul.totalCentims : 0;
  data.totalText = calcul ? preuText(calcul.totalCentims) : "";

  return { ok: Object.keys(errors).length === 0, errors, data };
}

export { MSG as QUOTA_MSG, MAX_FILLS };
