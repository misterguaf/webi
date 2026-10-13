import {AppError,requireUuid} from '../../services/common.js';
import {allow,audit,uuid} from './shared.js';
import {parseBudgetXlsx,XLSX_LIMIT} from './budget-import-parser.js';
import {addExportMappings} from './budget-semantic-mapping.js';
const conflict=()=>{throw new AppError(409,'budget_import_conflict');};
async function state(db,roundId){
 const round=await db.prepare('SELECT id,code,status,version FROM finance_round WHERE id=?').bind(requireUuid(roundId)).first();
 if(!round)throw new AppError(404,'not_found');
 const budget=await db.prepare('SELECT id,status,version FROM finance_budget WHERE round_id=?').bind(roundId).first();
 const facts=await db.prepare(`SELECT
 (SELECT count(*) FROM finance_budget_line WHERE round_id=?) AS lines,
 (SELECT count(*) FROM finance_expense WHERE round_id=?) AS expenses,
 (SELECT count(*) FROM finance_income WHERE round_id=?) AS income,
 (SELECT count(*) FROM finance_allocation a LEFT JOIN finance_expense e ON e.id=a.expense_id
  LEFT JOIN annual_fee_payment p ON p.id=a.fee_payment_id
  LEFT JOIN activity_payment_allocation pa ON pa.id=a.activity_allocation_id
  LEFT JOIN activity_registration ar ON ar.id=pa.registration_id
  WHERE a.round_id=? OR e.round_id=? OR ar.finance_round_id=? OR p.round_id=
    (SELECT annual_fee_round_id FROM finance_round WHERE id=?)) AS allocations`)
  .bind(roundId,roundId,roundId,roundId,roundId,roundId,roundId).first();
 return {round,budget,facts};
}
const blocked=s=>s.round.status==='CLOSED'||(s.budget&&s.budget.status!=='DRAFT')||Object.values(s.facts).some(n=>n>0);
function fileBytes(input){
 if(!input||Object.keys(input).some(k=>!['filename','dataBase64'].includes(k))||typeof input.filename!=='string'||
  !/^[^/\\\u0000-\u001f]{1,120}\.xlsx$/i.test(input.filename)||typeof input.dataBase64!=='string'||
  input.dataBase64.length>Math.ceil(XLSX_LIMIT/3)*4||input.dataBase64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.dataBase64))
  throw new AppError(400,'invalid_budget_xlsx');
 try{return Uint8Array.from(atob(input.dataBase64),c=>c.charCodeAt(0));}catch{throw new AppError(400,'invalid_budget_xlsx');}
}
export async function previewBudgetImport(db,storage,ctx,requestId,roundId,input,now=Date.now()){
 await allow(db,ctx,requestId,'finance.budget.propose','finance_budget',roundId);
 const current=await state(db,roundId),bytes=fileBytes(input),preview=addExportMappings(parseBudgetXlsx(bytes));
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
 const prior=await db.prepare("SELECT id,status,preview_json FROM finance_budget_import WHERE round_id=? AND file_hash=? AND created_by=? AND (status='CONFIRMED' OR expires_at>?) ORDER BY created_at DESC LIMIT 1")
  .bind(roundId,hash,ctx.userId,now).first();
 if(prior)return {id:prior.id,status:prior.status,preview:JSON.parse(prior.preview_json),replayed:true};
 if(preview.roundCode!==current.round.code)preview.errors.push({code:'WRONG_ROUND',message:'El llibre correspon a '+preview.roundCode+' i la ronda triada és '+current.round.code+'.'});
 if(blocked(current))preview.errors.push({code:'EXISTING_BUDGET',message:'Aquesta ronda ja conté pressupost, partides o dades financeres. La importació inicial no les substitueix.'});
 const id=uuid(),key='budget-import/'+id+'.xlsx';
 if(!storage?.put)throw new AppError(503,'storage_unavailable');
 await storage.put(key,bytes,{httpMetadata:{contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}});
 try{await db.batch([db.prepare(`INSERT INTO finance_budget_import(id,round_id,created_by,created_at,expires_at,filename,file_hash,
  object_key,template,preview_json,round_version,budget_id,budget_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  .bind(id,roundId,ctx.userId,now,now+86400000,input.filename,hash,key,preview.template,JSON.stringify(preview),
    current.round.version,current.budget?.id??null,current.budget?.version??null),
  audit(db,ctx,requestId,'BUDGET_IMPORT_PREVIEWED','finance_budget_import',id,now)]);
 }catch(error){await storage.delete(key);throw error;}
 return {id,status:'PREVIEW',preview};
}
export async function confirmBudgetImport(db,ctx,requestId,roundId,id,input,now=Date.now()){
 await allow(db,ctx,requestId,'finance.budget.propose','finance_budget',roundId);
 requireUuid(id);
 if(!input||Object.keys(input).some(k=>!['acknowledgedWarnings'].includes(k))||!Array.isArray(input.acknowledgedWarnings)||
  input.acknowledgedWarnings.some(k=>typeof k!=='string'))throw new AppError(400,'invalid_budget_import_confirmation');
 const row=await db.prepare('SELECT * FROM finance_budget_import WHERE id=? AND round_id=? AND created_by=?').bind(id,roundId,ctx.userId).first();
 if(!row)throw new AppError(404,'not_found');
 if(row.status==='CONFIRMED')return {id,confirmed:true,replayed:true};
 const preview=JSON.parse(row.preview_json),current=await state(db,roundId);
 if(row.expires_at<=now||preview.errors.length||blocked(current)||current.round.version!==row.round_version||
  (current.budget?.id??null)!==row.budget_id||(current.budget?.version??null)!==row.budget_version)conflict();
 if(preview.warnings.some(w=>!input.acknowledgedWarnings.includes(w.code)))throw new AppError(400,'budget_warnings_unacknowledged');
 const budgetId=current.budget?.id??uuid(),ids=new Map(preview.lines.map(l=>[l.nature+':'+l.code,uuid()]));
 const rows=[db.prepare(`UPDATE finance_budget_import SET version=CASE WHEN version=? AND status='PREVIEW'
  AND NOT EXISTS(SELECT 1 FROM finance_budget_line WHERE round_id=?)
  AND NOT EXISTS(SELECT 1 FROM finance_expense WHERE round_id=?)
  AND NOT EXISTS(SELECT 1 FROM finance_income WHERE round_id=?)
  AND NOT EXISTS(SELECT 1 FROM finance_allocation a LEFT JOIN annual_fee_payment p ON p.id=a.fee_payment_id
    LEFT JOIN activity_payment_allocation pa ON pa.id=a.activity_allocation_id
    LEFT JOIN activity_registration ar ON ar.id=pa.registration_id
    WHERE a.round_id=? OR ar.finance_round_id=? OR p.round_id=(SELECT annual_fee_round_id FROM finance_round WHERE id=?))
  AND EXISTS(SELECT 1 FROM finance_round WHERE id=? AND version=? AND status!='CLOSED')
  THEN version+1 ELSE NULL END WHERE id=?`).bind(row.version,roundId,roundId,roundId,roundId,roundId,roundId,roundId,row.round_version,id)];
 if(current.budget)rows.push(db.prepare("UPDATE finance_budget SET version=CASE WHEN version=? AND status='DRAFT' THEN version+1 ELSE NULL END WHERE id=?")
  .bind(row.budget_version,budgetId));
 else rows.push(db.prepare('INSERT INTO finance_budget(id,round_id,created_by,created_at) VALUES(?,?,?,?)').bind(budgetId,roundId,ctx.userId,now));
 const ordered=[...preview.lines].sort((a,b)=>a.nature.localeCompare(b.nature)||a.code.localeCompare(b.code,'ca',{numeric:true}));
 for(const [order,line] of ordered.entries()){
  const lineId=ids.get(line.nature+':'+line.code),parent=line.parentCode?ids.get(line.nature+':'+line.parentCode):null;
  rows.push(db.prepare(`INSERT INTO finance_budget_line(id,round_id,code,name,parent_id,sort_order,nature,planned_cents,
    economic_group,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(lineId,roundId,line.code,line.name,
    parent,order,line.nature,line.plannedCents,line.nature==='INCOME'&&line.legacyTarget?.sheet==='Cuotas'?'ANNUAL_FEES':null,ctx.userId,now,now),
   db.prepare('INSERT INTO finance_budget_import_line(import_id,line_id,source_cell,label_cell,legacy_target) VALUES(?,?,?,?,?)')
    .bind(id,lineId,line.sourceCell,line.labelCell,line.legacyTarget?JSON.stringify(line.legacyTarget):null));
 }
 rows.push(db.prepare("UPDATE finance_budget_import SET status='CONFIRMED',confirmed_at=?,confirmed_by=?,version=version+1 WHERE id=?")
  .bind(now,ctx.userId,id),audit(db,ctx,requestId,'BUDGET_IMPORTED','finance_budget_import',id,now));
 try{await db.batch(rows);}catch(error){
  if(/constraint|budget_import_|invalid_budget_line/i.test(String(error.message)))conflict();throw error;
 }
 return {id,budgetId,confirmed:true,lineCount:preview.lines.length};
}
