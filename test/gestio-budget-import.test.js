import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {fixture} from './helpers/gestio-sqlite.js';
import {parseBudgetXlsx} from '../gestio/src/domains/finance/budget-import-parser.js';
import {addExportMappings} from '../gestio/src/domains/finance/budget-semantic-mapping.js';
import {setCell} from '../gestio/src/domains/finance/treasury-xlsx-template.js';
import {budgetWorkbookModel,resultWorkbookModel} from '../gestio/src/domains/finance/treasury-export-model.js';
import {fillImportedBudget} from '../gestio/src/domains/finance/budget-import-export.js';
const master=new Uint8Array(readFileSync(new URL('../gestio/templates/PRESSUPOST ANUAL 26_27 (Boceto).xlsx',import.meta.url)));
const file=bytes=>({filename:'Pressupost sintètic.xlsx',dataBase64:Buffer.from(bytes).toString('base64')});
function modified(changes,extra={}){
 const parts=unzipSync(master);let sheet=strFromU8(parts['xl/worksheets/sheet1.xml']);
 for(const [cell,value]of Object.entries(changes))sheet=setCell(sheet,cell,value,11,{allowFormula:true});
 parts['xl/worksheets/sheet1.xml']=strToU8(sheet);
 for(const [path,value]of Object.entries(extra))parts[path]=strToU8(value);
 return zipSync(parts);
}
async function setup(){
 const f=fixture();for(const n of [101,102,104,107])await f.login(n);
 const r=await f.request(104,'/api/finance/rounds',{method:'POST',body:{code:'2026/2027',periodStart:'2026-10-01',periodEnd:'2027-09-30'}});
 assert.equal(r.status,201,JSON.stringify(r.data));
 return {f,round:r.data.id,path:'/api/finance/rounds/'+r.data.id+'/budget-imports'};
}
test('annual template: 65 categories, lower left expenses, Pasqua normalization, uncached formulas and reserve separation',()=>{
 const p=addExportMappings(parseBudgetXlsx(master));
 assert.equal(p.errors.length,0);assert.equal(p.lines.length,65);
 assert.deepEqual(p.totals,{incomeCents:6295000,expenseCents:6545000,reserveUseCents:250000,reserveContributionCents:0});
 assert.equal(p.lines.find(l=>l.code==='2.2.3'&&l.nature==='EXPENSE').name,'Menjar');
 assert.equal(p.lines.find(l=>l.code==='2.3.5'&&l.nature==='EXPENSE').plannedCents,1100000);
 assert.equal(p.lines.find(l=>l.code==='2.3'&&l.nature==='EXPENSE').selectable,false);
 assert.deepEqual(p.lines.find(l=>l.code==='4.3'&&l.nature==='EXPENSE').legacyTarget,{cell:'J33'},'Benicoscoll is not Material activitats');
 assert.deepEqual(p.lines.find(l=>l.code==='5.4'&&l.nature==='EXPENSE').legacyTarget,{cell:'J48'},'Wifi is not Material Local');
 assert.equal(p.lines.find(l=>l.code==='5.6'&&l.nature==='EXPENSE').legacyTarget,null,'XXSS cannot be guessed into an unrelated cell');
 assert.ok(p.warnings.some(w=>w.code==='PASQUA_NUMBERING'));
 const next=parseBudgetXlsx(modified({A1:'PRESSUPOST ANUAL 27/28',A54:'2.3.5 Menjar de campament nou',D54:12000}));
 assert.equal(next.roundCode,'2027/2028');assert.equal(next.errors.length,0);
 assert.equal(next.lines.find(l=>l.code==='2.3.5'&&l.nature==='EXPENSE').name,'Menjar de campament nou');
 assert.equal(next.totals.expenseCents,6645000);
});
test('XLSX limits reject invalid archives, external relationships, macros, unsupported formulas and missing amounts',()=>{
 assert.throws(()=>parseBudgetXlsx(new Uint8Array(30)),/invalid_budget_xlsx/);
 assert.throws(()=>parseBudgetXlsx(new Uint8Array(3*1024*1024)),/budget_xlsx_size/);
 assert.throws(()=>parseBudgetXlsx(modified({}, {'xl/_rels/workbook.xml.rels':'<Relationships><Relationship TargetMode="External" Target="https://example.test"/></Relationships>'})),/budget_xlsx_external/);
 assert.throws(()=>parseBudgetXlsx(modified({}, {'xl/vbaProject.bin':'bad'})),/budget_xlsx_external/);
 const unsupported=unzipSync(master);
 unsupported['xl/worksheets/sheet1.xml']=strToU8(strFromU8(unsupported['xl/worksheets/sheet1.xml']).replace(/<f[^>]*>100\*100<\/f>/,'<f>WEBSERVICE("https://example.test")</f>'));
 assert.ok(parseBudgetXlsx(zipSync(unsupported)).errors.length>0,'unsupported formulas cannot trust cached values');
 const bomb=unzipSync(master);bomb['xl/padding.xml']=new Uint8Array(3*1024*1024).fill(65);
 assert.throws(()=>parseBudgetXlsx(zipSync(bomb)),/budget_xlsx_limits/);
 const missing=parseBudgetXlsx(modified({D54:'No és un import'}));
 assert.ok(missing.errors.some(e=>e.code==='budget_amount_missing'));
});
test('import: preview creates no lines; confirmation is atomic, replay-safe and selectable by nature; export uses original source',async()=>{
 const {f,round,path}=await setup();try{
  const preview=await f.request(104,path,{method:'POST',body:file(master)});assert.equal(preview.status,201,JSON.stringify(preview.data));
  assert.equal(f.sql.prepare('SELECT count(*) n FROM finance_budget_line').get().n,0);
  assert.equal((await f.request(104,path,{method:'POST',body:file(master)})).data.id,preview.data.id);
  const confirm=path+'/'+preview.data.id+'/confirm';
  assert.equal((await f.request(104,confirm,{method:'POST',body:{acknowledgedWarnings:[]}})).status,400);
  const body={acknowledgedWarnings:[...new Set(preview.data.preview.warnings.map(w=>w.code))]};
  assert.equal((await f.request(104,confirm,{method:'POST',body})).status,200);
  assert.equal((await f.request(104,confirm,{method:'POST',body})).data.replayed,true);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM finance_budget_line').get().n,65);
  const picker=await f.request(104,'/api/finance/rounds/'+round+'/assignable-lines?nature=EXPENSE');
  const kitchen=picker.data.lines.find(l=>l.code==='2.3.5'),parent=picker.data.lines.find(l=>l.code==='2.3');
  assert.equal(kitchen.assignable,true);assert.equal(parent.assignable,false);
  const expense=await f.request(104,'/api/finance/expenses',{method:'POST',body:{roundId:round,expenseDate:'2026-11-02',concept:'Menjar fictici',
   totalCents:1000,paymentMethod:'BANK',lines:[{budgetLineId:kitchen.id,amountCents:1000}]}});
  assert.equal(expense.status,201,JSON.stringify(expense.data));
  const incomeLine=f.sql.prepare("SELECT id FROM finance_budget_line WHERE round_id=? AND nature='INCOME' AND code='1.2'").get(round).id;
  assert.equal((await f.request(104,'/api/finance/incomes',{method:'POST',body:{roundId:round,incomeDate:'2026-11-02',concept:'Loteria fictícia',totalCents:1000,budgetLineId:incomeLine}})).status,201);
  const model=await budgetWorkbookModel(f.db,f.context[104],crypto.randomUUID(),round);
  assert.ok(model.imported);const output=fillImportedBudget(master,model),parts=unzipSync(output);
  assert.match(strFromU8(parts['xl/worksheets/sheet1.xml']),/<c r="D54"[^>]*><v>11000<\/v><\/c>/);
  assert.ok(await f.storage.head(model.imported.objectKey));
  assert.deepEqual(f.sql.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{f.close();}
});
test('import: wrong round, TECH_ADMIN/section denial, stale budget and existing categories never overwrite history',async()=>{
 const {f,round,path}=await setup();try{
  for(const n of [102,107])assert.equal((await f.request(n,path,{method:'POST',body:file(master)})).status,403);
  const wrong=await f.request(104,path,{method:'POST',body:file(modified({A1:'PRESSUPOST ANUAL 27/28'}))});
  assert.ok(wrong.data.preview.errors.some(e=>e.code==='WRONG_ROUND'));
  assert.equal((await f.request(104,path+'/'+wrong.data.id+'/confirm',{method:'POST',body:{acknowledgedWarnings:['PASQUA_NUMBERING','UNMAPPED_EXPORT']}})).status,409);
  const preview=await f.request(104,path,{method:'POST',body:file(master)});
  await f.request(104,'/api/finance/budget-lines',{method:'POST',body:{roundId:round,code:'99',name:'Partida existent',nature:'EXPENSE',plannedCents:500}});
  assert.equal((await f.request(104,path+'/'+preview.data.id+'/confirm',{method:'POST',body:{acknowledgedWarnings:['PASQUA_NUMBERING','UNMAPPED_EXPORT']}})).status,409);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM finance_budget_line').get().n,1);
 }finally{f.close();}
});
test('import: a failure midway rolls back every category and confirmation',async()=>{
 const {f,path}=await setup();try{
  const preview=await f.request(104,path,{method:'POST',body:file(master)});
  f.sql.exec("CREATE TRIGGER test_import_failure BEFORE INSERT ON finance_budget_line WHEN NEW.code='2.3.5' BEGIN SELECT RAISE(ABORT,'forced constraint'); END");
  assert.equal((await f.request(104,path+'/'+preview.data.id+'/confirm',{method:'POST',body:{acknowledgedWarnings:['PASQUA_NUMBERING','UNMAPPED_EXPORT']}})).status,409);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM finance_budget_line').get().n,0);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM finance_budget').get().n,0);
  assert.equal(f.sql.prepare('SELECT status FROM finance_budget_import').get().status,'PREVIEW');
 }finally{f.close();}
});
test('semantic result mappings preserve changed annual codes and refuse unknown nonzero concepts',async()=>{
 const {f,round,path}=await setup();try{
  const preview=await f.request(104,path,{method:'POST',body:file(master)});
  await f.request(104,path+'/'+preview.data.id+'/confirm',{method:'POST',body:{acknowledgedWarnings:['PASQUA_NUMBERING','UNMAPPED_EXPORT']}});
  const line=f.sql.prepare("SELECT id FROM finance_budget_line WHERE nature='EXPENSE' AND code='4.3'").get().id;
  const exp=await f.request(104,'/api/finance/expenses',{method:'POST',body:{roundId:round,expenseDate:'2026-11-02',concept:'Terreny fictici',totalCents:1000,paymentMethod:'BANK',lines:[{budgetLineId:line,amountCents:1000}],recognise:true,
   evidence:{filename:'synthetic.pdf',mime:'application/pdf',dataBase64:Buffer.from('%PDF-1.4\n%synthetic local fixture\n%%EOF').toString('base64')}}});
  assert.equal(exp.status,201,JSON.stringify(exp.data));
  const model=await resultWorkbookModel(f.db,f.context[104],crypto.randomUUID(),round);
  assert.equal(model.direct.J33,1000);assert.equal(model.direct.J32,undefined);
  const unknown=f.sql.prepare("SELECT id FROM finance_budget_line WHERE nature='EXPENSE' AND code='5.6'").get().id;
  assert.equal((await f.request(104,'/api/finance/expenses',{method:'POST',body:{roundId:round,expenseDate:'2026-11-02',
   concept:'XXSS fictici',totalCents:1000,paymentMethod:'BANK',lines:[{budgetLineId:unknown,amountCents:1000}],recognise:true,
   evidence:{filename:'synthetic.pdf',mime:'application/pdf',dataBase64:Buffer.from('%PDF-1.4\n%synthetic local fixture\n%%EOF').toString('base64')}}})).status,201);
  await assert.rejects(resultWorkbookModel(f.db,f.context[104],crypto.randomUUID(),round),error=>error.code==='treasury_export_mapping_missing');
 }finally{f.close();}
});
test('import: different concurrent candidates, approved budgets and revoked authority remain protected',async()=>{
 const {f,round,path}=await setup();try{
  const first=await f.request(104,path,{method:'POST',body:file(master)});
  const second=await f.request(104,path,{method:'POST',body:file(modified({D54:12000}))});
  const body={acknowledgedWarnings:['PASQUA_NUMBERING','UNMAPPED_EXPORT']};
  const results=await Promise.all([f.request(104,path+'/'+first.data.id+'/confirm',{method:'POST',body}),
   f.request(104,path+'/'+second.data.id+'/confirm',{method:'POST',body})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM finance_budget_line').get().n,65);
  const budget=f.sql.prepare('SELECT id,version FROM finance_budget WHERE round_id=?').get(round);
  await f.request(104,'/api/finance/budgets/'+budget.id+'/propose',{method:'POST',body:{expectedVersion:budget.version}});
  assert.equal((await f.request(101,'/api/finance/budgets/'+budget.id+'/approve',{method:'POST',body:{expectedVersion:budget.version+1}})).status,200);
  const revised=await f.request(104,path,{method:'POST',body:file(modified({D54:13000}))});
  assert.ok(revised.data.preview.errors.some(e=>e.code==='EXISTING_BUDGET'));
  assert.equal((await f.request(104,path+'/'+revised.data.id+'/confirm',{method:'POST',body})).status,409);
  f.sql.prepare("UPDATE user_permission_grant SET revoked_at=? WHERE user_id=? AND permission_code='finance.budget.propose'").run(Date.now(),'00000000-0000-4000-8000-000000000104');
  assert.equal((await f.request(104,path,{method:'POST',body:file(master)})).status,403);
 }finally{f.close();}
});
