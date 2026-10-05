// Adapter for the unchanged 2026/27 Parpalló result workbook. Business services pass an
// export model; only this module knows the traditional worksheet and cell layout.
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

export const TEMPLATE_SHA256 = 'ae553d3366c7027db849bbbc1215bc5717d0b766ad316a44664b65126b994838';
export const TEMPLATE_SHEETS = Object.freeze([
  'RESULTADO','Cuotas','C. Navidad','Lotería','C. Pascua','SanJordi','C. Verano','Otras'
]);
const DETAIL_SHEETS = new Map(TEMPLATE_SHEETS.slice(1).map((name,index) => [name,index+2]));
const DIRECT_CELLS = new Set(['D21','D28','D29','D30','D31','D33','D34','J27','J28','J30','J31','J32','J33',
  'J38','J39','J40','J43','J44','J45','J46','J49','J50','J51','J52','J53','J54','J55','J56','J57','J58','J59','J60','J61',
  'J38','J39','J40','J41','J44','J45','J46','J47','J48','J49','J50']);
const decoder = new TextDecoder();

function validateCents(cents) {
  if (!Number.isSafeInteger(cents) || Math.abs(cents) > 10000000000)
    throw new Error('invalid_treasury_export_amount');
  return cents / 100;
}
const escapeXml = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
function excelDate(date) {
  if (typeof date !== 'string' || !/^20\d\d-\d\d-\d\d$/.test(date) ||
      new Date(`${date}T00:00:00Z`).toISOString().slice(0,10) !== date)
    throw new Error('invalid_treasury_export_date');
  return (Date.parse(`${date}T00:00:00Z`) - Date.UTC(1899,11,30)) / 86400000;
}
function cellXml(coord, value, style) {
  const attrs = `r="${coord}" s="${style}"`;
  return typeof value === 'string'
    ? `<c ${attrs} t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`
    : `<c ${attrs}><v>${value}</v></c>`;
}
function columnNumber(coord) {
  return [...coord.match(/^[A-Z]+/)[0]].reduce((n,char) => n*26+char.charCodeAt(0)-64,0);
}
function setCell(xml, coord, value, style=11) {
  const rowNumber = Number(coord.match(/\d+$/)[0]);
  const rowPattern = new RegExp(`<row\\b[^>]*\\br="${rowNumber}"[^>]*>[\\s\\S]*?<\\/row>`);
  const rowMatch = rowPattern.exec(xml);
  const generated = cellXml(coord,value,style);
  if (!rowMatch) {
    const newRow = `<row r="${rowNumber}">${generated}</row>`;
    const sheetDataEnd = xml.indexOf('</sheetData>');
    if (sheetDataEnd < 0) throw new Error('invalid_treasury_template');
    const before = xml.slice(0,sheetDataEnd);
    const after = xml.slice(sheetDataEnd);
    const later = [...before.matchAll(/<row\b[^>]*\br="(\d+)"/g)]
      .find(match => Number(match[1]) > rowNumber);
    if (later) return xml.slice(0,later.index)+newRow+xml.slice(later.index);
    return before+newRow+after;
  }
  let row = rowMatch[0];
  const existing = new RegExp(`<c\\b([^>]*\\br="${coord}"[^>]*)(?:\\/>|>[\\s\\S]*?<\\/c>)`);
  const found = existing.exec(row);
  if (found) {
    if (/<f(?:\s|>)/.test(found[0])) throw new Error('treasury_template_formula_protected');
    const styleMatch = found[1].match(/\bs="(\d+)"/);
    row = row.replace(found[0],cellXml(coord,value,styleMatch?.[1]??style));
  } else {
    const targetColumn = columnNumber(coord);
    const next = [...row.matchAll(/<c\b[^>]*\br="([A-Z]+)\d+"/g)]
      .find(match => columnNumber(match[1]) > targetColumn);
    row = next ? row.slice(0,next.index)+generated+row.slice(next.index) : row.replace('</row>',`${generated}</row>`);
  }
  return xml.slice(0,rowMatch.index)+row+xml.slice(rowMatch.index+rowMatch[0].length);
}
function updateDimension(xml) {
  const lastRow = Math.max(...[...xml.matchAll(/<row\b[^>]*\br="(\d+)"/g)].map(match => Number(match[1])));
  return xml.replace(/<dimension ref="([A-Z]+\d+):([A-Z]+)\d+"\/>/,
    (_whole,first,lastColumn) => `<dimension ref="${first}:${lastColumn}${lastRow}"/>`);
}
async function sha256(bytes) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  return [...hash].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
function validateModel(model) {
  if (!model || typeof model !== 'object' || !model.detail || !model.direct || !model.roundCode ||
      typeof model.roundCode !== 'string' || !/^20\d\d\/20\d\d$/.test(model.roundCode))
    throw new Error('invalid_treasury_export_model');
  for (const [sheet,ledger] of Object.entries(model.detail)) {
    if (!DETAIL_SHEETS.has(sheet) || !ledger || !Array.isArray(ledger.income) || !Array.isArray(ledger.expense))
      throw new Error('invalid_treasury_export_model');
    if (sheet === 'Otras' && ledger.expense.length) throw new Error('treasury_template_category_unavailable');
    const firstRow = sheet === 'Otras' ? 2 : 3;
    if (ledger.income.length > 1000-firstRow || ledger.expense.length > 1000-firstRow)
      throw new Error('treasury_template_capacity_exceeded');
    for (const entry of [...ledger.income,...ledger.expense]) {
      excelDate(entry.date);validateCents(entry.cents);
      if (!entry.label || typeof entry.label !== 'string' || entry.label.length > 100)
        throw new Error('invalid_treasury_export_model');
    }
  }
  for (const [coord,cents] of Object.entries(model.direct)) {
    if (!DIRECT_CELLS.has(coord)) throw new Error('invalid_treasury_export_cell');
    validateCents(cents);
  }
}

export async function fillTreasuryTemplate(templateBytes,model) {
  const bytes = templateBytes instanceof Uint8Array ? templateBytes : new Uint8Array(templateBytes);
  if (await sha256(bytes) !== TEMPLATE_SHA256) throw new Error('unexpected_treasury_template');
  validateModel(model);
  const files = unzipSync(bytes);
  const workbook = decoder.decode(files['xl/workbook.xml']);
  const names = [...workbook.matchAll(/<sheet\b[^>]*\bname="([^"]+)"/g)].map(match => match[1]);
  if (JSON.stringify(names) !== JSON.stringify(TEMPLATE_SHEETS)) throw new Error('unexpected_treasury_template');
  for (const [sheet,index] of DETAIL_SHEETS) {
    const ledger = model.detail[sheet] ?? { income: [], expense: [] };
    let xml = strFromU8(files[`xl/worksheets/sheet${index}.xml`]);
    const firstRow = sheet === 'Otras' ? 2 : 3;
    for (const [kind,entries] of [['income',ledger.income],['expense',ledger.expense]]) {
      for (let i=0;i<entries.length;i++) {
        const entry=entries[i],row=firstRow+i;
        const prefix=kind==='income'?'A':sheet==='Otras'?'H':'G';
        const valuePrefix=kind==='income'?'D':sheet==='Otras'?'K':'J';
        const labelPrefix=kind==='income'?'C':sheet==='Otras'?'J':'I';
        xml=setCell(xml,`${prefix}${row}`,excelDate(entry.date),9);
        xml=setCell(xml,`${labelPrefix}${row}`,entry.label,9);
        xml=setCell(xml,`${valuePrefix}${row}`,validateCents(entry.cents),11);
      }
    }
    files[`xl/worksheets/sheet${index}.xml`]=strToU8(updateDimension(xml));
  }
  let result=strFromU8(files['xl/worksheets/sheet1.xml']);
  result=setCell(result,'A1',`RESULTAT RONDA SOLAR ${model.roundCode.slice(2,4)}/${model.roundCode.slice(7,9)}`,57);
  if (model.resultDate) result=setCell(result,'E10',excelDate(model.resultDate),11);
  for (const [coord,cents] of Object.entries(model.direct)) result=setCell(result,coord,validateCents(cents));
  files['xl/worksheets/sheet1.xml']=strToU8(result);
  files['xl/workbook.xml']=strToU8(workbook.replace('<calcPr/>','<calcPr fullCalcOnLoad="1" forceFullCalc="1"/>'));
  return zipSync(files,{level:6});
}
