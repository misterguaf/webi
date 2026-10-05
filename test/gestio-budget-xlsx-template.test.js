import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { fillBudgetTemplate, budgetTemplateModel, BUDGET_TEMPLATE_SHA256 } from '../gestio/src/domains/finance/budget-xlsx-template.js';

const master = readFileSync(new URL('../gestio/templates/PRESSUPOST ANUAL 26_27 (Boceto).xlsx', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('budget adapter fills only input cells and preserves the original workbook formulas and structure', async () => {
  assert.equal(hash(master), BUDGET_TEMPLATE_SHA256);
  const original = unzipSync(master);
  const output = unzipSync(await fillBudgetTemplate(master, { roundCode:'2026/2027',
    cells:{ D19:10000, D24:5200, J19:3000, J24:1200, E35:2500, J35:500 } }));
  assert.equal(hash(master), BUDGET_TEMPLATE_SHA256);
  assert.deepEqual(Object.keys(output).sort(),Object.keys(original).sort());
  for (const name of Object.keys(original).filter(name => name !== 'xl/workbook.xml' && name !== 'xl/worksheets/sheet1.xml'))
    assert.deepEqual(output[name],original[name],name);
  const sheet = strFromU8(output['xl/worksheets/sheet1.xml']);
  assert.match(sheet, /<c r="D19"[^>]*><v>100<\/v><\/c>/);
  assert.match(sheet, /<c r="J19"[^>]*><v>30<\/v><\/c>/);
  assert.match(sheet, /<c r="D24"[^>]*><v>52<\/v><\/c>/);
  assert.match(sheet, /<c r="E18"[^>]*><f>SUM\(D19:D22\)<\/f>/);
  assert.match(sheet, /<c r="E36"[^>]*><f>SUM\(E18\+E23\+E28\+E33\+E35\)<\/f>/);
  assert.match(sheet, /<c r="K36"[^>]*><f>SUM\(K18\+K20\+K25\+K29\+K34\+K35\)<\/f>/);
  await assert.rejects(fillBudgetTemplate(master,{roundCode:'2026/2027',cells:{E36:100}}),/invalid_budget_export_cell/);
});

test('budget model maps current leaf amounts and clears every sample value in the draft master', () => {
  const model = budgetTemplateModel('2026/2027', [
    {nature:'INCOME',code:'1',currentCents:10000,hasChildren:true},
    {nature:'INCOME',code:'1.1',currentCents:10000,hasChildren:false},
    {nature:'EXPENSE',code:'2.1.1',currentCents:2500,hasChildren:false},
    {nature:'RESERVE_CONTRIBUTION',code:'r',currentCents:500,hasChildren:false},
    {nature:'EXPENSE',code:'5.7',currentCents:250,hasChildren:false}
  ]);
  assert.equal(model.cells.D19,10000);
  assert.equal(model.cells.D39,2500);
  assert.equal(model.cells.J35,500);
  assert.equal(model.cells.J50,250);
  assert.equal(model.cells.D20,0);
  assert.throws(() => budgetTemplateModel('2026/2027',[
    {nature:'EXPENSE',code:'unknown',currentCents:100,hasChildren:false}
  ]),/budget_template_unmapped_line/);
});
