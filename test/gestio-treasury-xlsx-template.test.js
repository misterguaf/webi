import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { fillTreasuryTemplate, TEMPLATE_SHA256, TEMPLATE_SHEETS } from '../gestio/src/domains/finance/treasury-xlsx-template.js';
import { resultTemplateModel } from '../gestio/src/domains/finance/treasury-export-model.js';

const source = readFileSync(new URL('../gestio/templates/Tesorería General 26_27.xlsx', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const textPart = (parts,path) => strFromU8(parts[path]);

test('G.4 template adapter fills a new Parpalló workbook and preserves its structural parts', async () => {
  const before = hash(source);
  assert.equal(before, TEMPLATE_SHA256);
  const model = { roundCode: '2026/2027', resultDate: '2027-08-31',
    detail: {
      Cuotas: { income: [{ date: '2026-10-12', label: 'Quota anual', cents: 10000 }], expense: [] },
      'C. Navidad': { income: [{ date: '2026-12-20', label: 'Campament', cents: 8000 }],
        expense: [{ date: '2026-12-21', label: 'Transport', cents: 2500 }] }
    }, direct: { D21: 5000, D28: 1200, J27: 3500, D34: 500 }
  };
  const output = await fillTreasuryTemplate(source, model);
  assert.equal(hash(source), before, 'the master remains byte-for-byte unchanged');
  const original = unzipSync(source), generated = unzipSync(output);
  assert.deepEqual(Object.keys(generated).sort(), Object.keys(original).sort());
  const names = [...textPart(generated,'xl/workbook.xml').matchAll(/<sheet\b[^>]*\bname="([^"]+)"/g)]
    .map(match=>match[1]);
  assert.deepEqual(names,TEMPLATE_SHEETS);
  assert.match(textPart(generated,'xl/workbook.xml'),/fullCalcOnLoad="1"/);
  for (const unchanged of ['xl/styles.xml','xl/charts/chart1.xml','xl/drawings/drawing1.xml'])
    assert.deepEqual(generated[unchanged],original[unchanged],`${unchanged} must be retained`);
  const result=textPart(generated,'xl/worksheets/sheet1.xml');
  assert.match(result,/<c r="D19"[^>]*><f>SUM\(Cuotas!D:D\)<\/f>/);
  assert.match(result,/<c r="D21"[^>]*><v>50<\/v><\/c>/);
  assert.match(result,/<c r="D28"[^>]*><v>12<\/v><\/c>/);
  assert.match(result,/<c r="J27"[^>]*><v>35<\/v><\/c>/);
  const fees=textPart(generated,'xl/worksheets/sheet2.xml');
  assert.match(fees,/<c r="D3" s="11"><v>100<\/v><\/c>/);
  assert.match(fees,/<c r="C3" s="9" t="inlineStr"><is><t>Quota anual<\/t><\/is><\/c>/);
  const camp=textPart(generated,'xl/worksheets/sheet3.xml');
  assert.match(camp,/<c r="D3"[^>]*><v>80<\/v><\/c>/);
  assert.match(camp,/<c r="J3"[^>]*><v>25<\/v><\/c>/);
  await assert.rejects(fillTreasuryTemplate(source,{...model,direct:{D19:5000}}),/invalid_treasury_export_cell/);
});

test('result model routes one economic fact to one traditional category and reconciles totals', async () => {
  const model=resultTemplateModel('2026/2027',[
    {nature:'INCOME',code:'1.1',date:'2026-10-12',label:'Quota anual',cents:10000},
    {nature:'INCOME',code:'2.1',date:'2026-12-20',label:'Campament',cents:8000},
    {nature:'INCOME',code:'1.4',date:'2026-11-05',label:'Activitat',cents:300},
    {nature:'EXPENSE',code:'2.1.1',date:'2026-12-21',label:'Alberg',cents:2500},
    {nature:'EXPENSE',code:'3.2.1',date:'2026-12-22',label:'Activitat Estol',cents:1000}
  ],{incomeCents:18300,expenseCents:3500},'2027-09-30');
  assert.equal(model.detail.Cuotas.income[0].cents,10000);
  assert.equal(model.detail['C. Navidad'].expense[0].cents,2500);
  assert.equal(model.direct.J27,1000);
  assert.equal(model.direct.D33,300);
  const output=unzipSync(await fillTreasuryTemplate(source,model));
  assert.match(textPart(output,'xl/worksheets/sheet1.xml'),/<c r="J27"[^>]*><v>10<\/v><\/c>/);
  assert.match(textPart(output,'xl/worksheets/sheet1.xml'),/Altres ingressos i activitats/);
  await assert.rejects(fillTreasuryTemplate(source,{...model,direct:{D19:1}}),/invalid_treasury_export_cell/);
  assert.throws(()=>resultTemplateModel('2026/2027',[
    {nature:'INCOME',code:'9.9',date:'2026-10-12',label:'Sense mapping',cents:100}
  ],{incomeCents:100,expenseCents:0},'2027-09-30'),/treasury_export_mapping_missing/);
  assert.throws(()=>resultTemplateModel('2026/2027',[],{incomeCents:100,expenseCents:0},'2027-09-30'),
    /treasury_export_economics_mismatch/);
});
