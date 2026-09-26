/* Configuració i càlcul de la quota anual.
 *
 * La configuració real viu a data/cuotes.json. El formulari no s'obri fins
 * que tresoreria haja confirmat curs, import, termini i instruccions. Cap
 * import que envie el navegador es considera font de veritat.
 */

import configuracio from "../../data/cuotes.json" with { type: "json" };

export function configuracioQuota() {
  return configuracio;
}

export function configuracioCompleta(config = configuracioQuota(), ara = new Date()) {
  if (!config || config.oberta !== true) return false;
  if (!/^\d{4}-\d{4}$/.test(String(config.curs || ""))) return false;
  if (!Number.isInteger(config.importBaseCentims) || config.importBaseCentims < 0) return false;
  if (!config.dataLimit || !/^\d{4}-\d{2}-\d{2}$/.test(config.dataLimit)) return false;
  const limit = new Date(config.dataLimit + "T23:59:59");
  if (Number.isNaN(limit.getTime()) || limit.getTime() < ara.getTime()) return false;
  return Boolean(config.instruccions && config.instruccions.va && config.instruccions.es);
}

function reglaPerPosicio(posicio, config) {
  const regles = Array.isArray(config.descomptes) ? config.descomptes : [];
  return regles
    .filter((r) => Number.isInteger(r.desDe) && r.desDe <= posicio && Number(r.percentatge) >= 0)
    .sort((a, b) => b.desDe - a.desDe)[0] || null;
}

export function calculaQuota(nombreFills, config = configuracioQuota()) {
  const quantitat = Math.max(0, Math.min(8, Number(nombreFills) || 0));
  const base = Number(config.importBaseCentims);
  if (!Number.isInteger(base) || base < 0 || quantitat < 1) return null;

  const imports = [];
  for (let i = 1; i <= quantitat; i++) {
    const regla = reglaPerPosicio(i, config);
    const percentatge = regla ? Math.min(100, Math.max(0, Number(regla.percentatge) || 0)) : 0;
    imports.push(Math.round(base * (1 - percentatge / 100)));
  }
  return { imports, totalCentims: imports.reduce((suma, valor) => suma + valor, 0) };
}

export function preuText(centims) {
  return centims % 100 === 0
    ? centims / 100 + " €"
    : (centims / 100).toFixed(2).replace(".", ",") + " €";
}

export function configuracioPublica(config = configuracioQuota()) {
  const oberta = configuracioCompleta(config);
  return {
    curs: String(config.curs || ""),
    oberta,
    dataLimit: oberta ? config.dataLimit : null,
    importBaseText: oberta ? preuText(config.importBaseCentims) : "",
    totalsText: oberta
      ? Array.from({ length: 8 }, (_, index) => preuText(calculaQuota(index + 1, config).totalCentims))
      : [],
    instruccions: oberta ? config.instruccions : null,
  };
}
