// The original 2026/27 PRESSUPOST workbook is an immutable master. Only the input cells below
// are replaced; subtotal and total formula cells, styles, dimensions, and every other ZIP part stay.
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { setCell, sha256, validateCents } from './treasury-xlsx-template.js';

export const BUDGET_TEMPLATE_SHA256 = '1b190cc4442fbe3adae1f8cb9d465a8a0882abb8eb951e016a333b9ec97befce';
export const BUDGET_TEMPLATE_SHEETS = Object.freeze(['Hoja 1']);
export const BUDGET_INPUT_CELLS = Object.freeze([
  'D19','D20','D21','D22','D24','D25','D26','D27','D29','D30','D31','D32','D34','E35',
  'D39','D40','D41','D44','D45','D46','D47',
  'D50','D51','D52','D53','D54','D55','D56','D57','D58','D59','D60','D61',
  'J19','J24','J26','J28','J30','J31','J32','J33','J35',
  'J39','J40','J41','J42','J45','J46','J47','J48','J49','J50'
]);
const inputCells = new Set(BUDGET_INPUT_CELLS);
// The code is the category number printed in the traditional budget. A leaf with an unknown code
// cannot be silently assigned to a misleading category. Parent rows are calculated by Excel.
const INCOME = Object.freeze({
  '1.1':'D19','1.2':'D20','1.3':'D21','1.4':'D22',
  '2.1':'D24','2.2':'D25','2.3':'D26','2.4':'D27',
  '3.1':'D29','3.2':'D30','3.3':'D31','3.4':'D32','4.1':'D34'
});
const EXPENSE = Object.freeze({
  '1.1':'J19','2.1.1':'D39','2.1.2':'D40','2.1.3':'D41',
  '2.2.1':'D44','2.2.2':'D45','2.2.3':'D46','2.2.4':'D47',
  '2.3.1':'D50','2.3.2':'D51','2.3.3':'D52','2.3.4':'D53','2.3.5':'D54',
  '2.3.6':'D55','2.3.7':'D56','2.3.8':'D57','2.3.9':'D58','2.3.10':'D59',
  '2.3.11':'D60','2.3.12':'D61','2.4':'J24','3.1':'J26',
  '3.2.1':'J39','3.2.2':'J40','3.2.3':'J41','3.2.4':'J42','3.3':'J28',
  '4.1':'J30','4.2':'J31','4.3':'J32','4.4':'J33',
  '5.1':'J45','5.2':'J46','5.4':'J47','5.5':'J48','5.6':'J49','5.7':'J50',
  '6':'J35'
});

export function budgetTemplateModel(roundCode, lines) {
  if (!Array.isArray(lines)) throw new Error('invalid_budget_export_model');
  const cells = Object.fromEntries(BUDGET_INPUT_CELLS.map(cell => [cell, 0]));
  for (const line of lines) {
    if (line.hasChildren) continue;
    const cents = line.currentCents ?? line.plannedCents ?? 0;
    validateCents(cents);
    if (!cents) continue;
    const target = line.nature === 'INCOME' ? INCOME[line.code] :
      line.nature === 'EXPENSE' ? EXPENSE[line.code] :
      line.nature === 'RESERVE_USE' ? 'E35' :
      line.nature === 'RESERVE_CONTRIBUTION' ? 'J35' : null;
    if (!target) throw new Error(`budget_template_unmapped_line:${line.nature}:${line.code}`);
    cells[target] += cents;
    validateCents(cells[target]);
  }
  return { roundCode, cells };
}

export async function fillBudgetTemplate(templateBytes, model) {
  const bytes = templateBytes instanceof Uint8Array ? templateBytes : new Uint8Array(templateBytes);
  if (await sha256(bytes) !== BUDGET_TEMPLATE_SHA256) throw new Error('unexpected_budget_template');
  if (!model || !/^20\d\d\/20\d\d$/.test(model.roundCode) || !model.cells ||
      typeof model.cells !== 'object' || Array.isArray(model.cells)) throw new Error('invalid_budget_export_model');
  const files = unzipSync(bytes);
  const workbook = strFromU8(files['xl/workbook.xml']);
  const names = [...workbook.matchAll(/<sheet\b[^>]*\bname="([^"]+)"/g)].map(match => match[1]);
  if (JSON.stringify(names) !== JSON.stringify(BUDGET_TEMPLATE_SHEETS)) throw new Error('unexpected_budget_template');
  let xml = strFromU8(files['xl/worksheets/sheet1.xml']);
  const suffix=model.budgetStatus==='DRAFT'?' · ESBORRANY':model.budgetStatus==='PROPOSED'?' · PENDENT D’APROVACIÓ':'';
  xml = setCell(xml, 'A1', `PRESSUPOST ANUAL ${model.roundCode.slice(2,4)}/${model.roundCode.slice(7,9)}${suffix}`, 57);
  for (const [coord, cents] of Object.entries(model.cells)) {
    if (!inputCells.has(coord)) throw new Error('invalid_budget_export_cell');
    xml = setCell(xml, coord, validateCents(cents), 11, { allowFormula: coord === 'D19' || coord === 'J19' });
  }
  files['xl/worksheets/sheet1.xml'] = strToU8(xml);
  files['xl/workbook.xml'] = strToU8(workbook.replace('<calcPr/>', '<calcPr fullCalcOnLoad="1" forceFullCalc="1"/>'));
  return zipSync(files, { level: 6 });
}
