import {Unzip,UnzipInflate,strFromU8} from 'fflate';
import {AppError} from '../../services/common.js';
export const XLSX_LIMIT=2*1024*1024;
const invalid=(code='invalid_budget_xlsx')=>{throw new AppError(400,code);};
const norm=value=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[´’']/g,'').replace(/\s+/g,' ').trim();
const xmlText=value=>String(value).replace(/&(?:amp|lt|gt|quot|apos);/g,m=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[m]))
 .replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{const code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);
  if(code>0x10ffff||code<0||code>=0xd800&&code<=0xdfff)invalid();return String.fromCodePoint(code);});
export function safeXlsx(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length<22||bytes.length>XLSX_LIMIT)invalid('budget_xlsx_size');
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(v.getUint32(i,true)===0x06054b50){end=i;break;}
 if(end<0||v.getUint16(end+4,true)||v.getUint16(end+6,true))invalid();
 const count=v.getUint16(end+10,true),start=v.getUint32(end+16,true);
 if(count<3||count>200||start>=end)invalid('budget_xlsx_limits');
 let pos=start,total=0;const names=new Set();
 for(let i=0;i<count;i++){
  if(pos+46>end||v.getUint32(pos,true)!==0x02014b50)invalid();
  const flags=v.getUint16(pos+8,true),compression=v.getUint16(pos+10,true),size=v.getUint32(pos+24,true),
   length=v.getUint16(pos+28,true),extra=v.getUint16(pos+30,true),comment=v.getUint16(pos+32,true);
  if(pos+46+length+extra+comment>end||flags&1||![0,8].includes(compression)||size>2*1024*1024)invalid('budget_xlsx_limits');
  const name=strFromU8(bytes.subarray(pos+46,pos+46+length));
  if(!name||name.length>180||name.includes('..')||name.startsWith('/')||name.includes('\\')||names.has(name))invalid();
  if(/vba|externalLinks|embeddings|\.bin$/i.test(name))invalid('budget_xlsx_external');
  names.add(name);total+=size;if(total>12*1024*1024)invalid('budget_xlsx_limits');
  pos+=46+length+extra+comment;
 }
 const files={};let actual=0,entries=0;
 const unzip=new Unzip(file=>{
  if(++entries>200||!names.has(file.name))invalid();
  const chunks=[];let size=0;
  file.ondata=(error,data,final)=>{
   if(error)invalid();size+=data.length;actual+=data.length;
   if(size>2*1024*1024||actual>12*1024*1024)invalid('budget_xlsx_limits');
   chunks.push(data);
   if(final){const out=new Uint8Array(size);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.length;}files[file.name]=out;}
  };
  file.start();
 });
 unzip.register(UnzipInflate);
 try{for(let i=0;i<bytes.length;i+=2048)unzip.push(bytes.subarray(i,i+2048),i+2048>=bytes.length);}
 catch(error){if(error instanceof AppError)throw error;invalid();}
 for(const [name,data] of Object.entries(files))if(/\.xml$|\.rels$/.test(name)){
  const xml=strFromU8(data);
  if(/<!DOCTYPE|<!ENTITY|TargetMode\s*=\s*["']External|macroEnabled|vbaProject/i.test(xml))invalid('budget_xlsx_external');
  if((xml.match(/</g)||[]).length>30000)invalid('budget_xlsx_limits');
 }
 if(!files['xl/workbook.xml']||!files['[Content_Types].xml'])invalid();
 return files;
}
export function workbookCells(files,path){
 const shared=strFromU8(files['xl/sharedStrings.xml']||new Uint8Array());
 const strings=[...shared.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(m=>[...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(t=>xmlText(t[1])).join(''));
 if(strings.length>5000||strings.some(s=>s.length>2000))invalid('budget_xlsx_limits');
 const cells=new Map(),xml=strFromU8(files[path]);
 for(const m of xml.matchAll(/<c\b([^>]*?[^/])>([\s\S]*?)<\/c>/g)){
  const coord=m[1].match(/\br="([A-Z]{1,3}[1-9]\d{0,3})"/)?.[1];if(!coord||cells.has(coord)||m[2].length>4000)invalid();
  const type=m[1].match(/\bt="([^"]+)"/)?.[1],value=m[2].match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
  const formula=m[2].match(/<f\b[^>]*>([\s\S]*?)<\/f>/)?.[1];
  const inline=[...m[2].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(t=>xmlText(t[1])).join('');
  let text=type==='s'?strings[Number(value)]:type==='inlineStr'?inline:type==='str'?xmlText(value||''):null;
  if(type==='s'&&text==null)invalid();
  cells.set(coord,{text,number:text===null&&value!=null&&(!type||type==='n')?Number(value):null,formula:formula==null?null:xmlText(formula)});
 }
 if(cells.size>5000)invalid('budget_xlsx_limits');return cells;
}
// Deliberately small formula grammar: local numeric arithmetic, references and SUM ranges.
// It never evaluates JavaScript, arbitrary Excel functions, names or external references.
export function amountAt(cells,coord,seen=new Set()){
 if(seen.has(coord)||seen.size>20)invalid('budget_formula_unsupported');
 const cell=cells.get(coord);if(!cell)invalid('budget_amount_missing');
 if(cell.formula===null){if(cell.number===null||!Number.isFinite(cell.number))invalid('budget_amount_missing');return cell.number;}
 const next=new Set(seen);next.add(coord);let expr=cell.formula.toUpperCase().replace(/\$/g,'').trim();
 if(expr.length>256)invalid('budget_formula_unsupported');
 expr=expr.replace(/SUM\(([A-Z]+\d+):([A-Z]+\d+)\)/g,(_,a,b)=>{
  const c1=a.match(/[A-Z]+/)[0],c2=b.match(/[A-Z]+/)[0],r1=Number(a.match(/\d+/)[0]),r2=Number(b.match(/\d+/)[0]);
  if(c1!==c2||r2<r1||r2-r1>200)invalid('budget_formula_unsupported');
  let sum=0;for(let r=r1;r<=r2;r++){const key=c1+r;if(cells.has(key))sum+=amountAt(cells,key,next);}return '('+sum+')';
 });
 expr=expr.replace(/SUM\(([^()]*)\)/g,'($1)');
 expr=expr.replace(/[A-Z]+\d+/g,key=>'('+amountAt(cells,key,next)+')');
 if(/[^\d.\s+*/()\-]/.test(expr))invalid('budget_formula_unsupported');
 const tokens=expr.match(/\d+(?:\.\d+)?|[()+*/-]/g)||[];if(tokens.length>128)invalid('budget_formula_unsupported');
 let at=0;
 const atom=()=>{const t=tokens[at++];if(t==='('){const n=expression();if(tokens[at++]!==')')invalid('budget_formula_unsupported');return n;}
  if(t==='-')return -atom();if(t==='+')return atom();if(!t||!/^\d/.test(t))invalid('budget_formula_unsupported');return Number(t);};
 const product=()=>{let n=atom();while(tokens[at]==='*'||tokens[at]==='/'){const op=tokens[at++],rhs=atom();n=op==='*'?n*rhs:n/rhs;}return n;};
 const expression=()=>{let n=product();while(tokens[at]==='+'||tokens[at]==='-'){const op=tokens[at++],rhs=product();n=op==='+'?n+rhs:n-rhs;}return n;};
 const result=expression();if(at!==tokens.length||!Number.isFinite(result))invalid('budget_formula_unsupported');return result;
}
const label=value=>{const m=String(value||'').trim().match(/^(\d+(?:\.\d+)*)(?:\.\s+|\s+)(.+)$/);return m?{code:m[1],name:m[2].trim()}:null;};
const cents=value=>{const n=Math.round(value*100);if(value<0||!Number.isSafeInteger(n)||n>100000000||Math.abs(value*100-n)>0.00001)invalid('invalid_budget_amount');return n;};
export function parseBudgetXlsx(bytes){
 const files=safeXlsx(bytes),sheets=Object.keys(files).filter(p=>/^xl\/worksheets\/sheet\d+\.xml$/.test(p));
 const candidates=sheets.map(path=>({path,cells:workbookCells(files,path)})).filter(({cells})=>[...cells.values()].some(c=>norm(c.text)==='ingressos')&&[...cells.values()].some(c=>norm(c.text)==='despeses'));
 if(candidates.length!==1)invalid('budget_template_unrecognized');
 const {path,cells}=candidates[0],warnings=[],errors=[],lines=[],index=new Map();
 const headers=[...cells.entries()].filter(([,c])=>norm(c.text)==='ingressos'||norm(c.text)==='despeses');
 const incomeHeader=headers.find(([,c])=>norm(c.text)==='ingressos')[0],expenseHeader=headers.find(([,c])=>norm(c.text)==='despeses')[0];
 if(!incomeHeader.startsWith('A')||!expenseHeader.startsWith('G'))invalid('budget_template_unrecognized');
 const headerRow=Number(incomeHeader.slice(1));
 const totalRow=[...cells.entries()].filter(([key,c])=>key.startsWith('A')&&Number(key.slice(1))>headerRow&&norm(c.text)==='total')
  .map(([key])=>Number(key.slice(1))).sort((a,b)=>a-b)[0];
 if(!totalRow||norm(cells.get('G'+totalRow)?.text)!=='total')invalid('budget_template_unrecognized');
 const title=[...cells.values()].find(c=>/^pressupost anual/i.test(c.text||''))?.text||'';
 const year=title.match(/(20)?(\d{2})\s*[\/_-]\s*(20)?(\d{2})/);
 if(!year||Number(year[4])!==(Number(year[2])+1)%100)invalid('budget_round_missing');
 const roundCode='20'+year[2]+'/20'+year[4];
 function add(item,nature,row,column,amountColumn,totalColumn,lower=false,parent=null){
  let code=item.code;
  if(lower&&parent&&code.startsWith('2.1.')&&parent.code==='2.2'){
   code='2.2.'+code.slice(4);if(!warnings.some(w=>w.code==='PASQUA_NUMBERING'))warnings.push({code:'PASQUA_NUMBERING',message:'La numeració 2.1.x del bloc de Pasqua s’ha normalitzat a 2.2.x.'});
  }
  const key=nature+':'+code,sourceCell=(cells.has(amountColumn+row)?amountColumn:totalColumn)+row;
  if(index.has(key)){
   const existing=index.get(key);
   if(lower&&code===parent?.code)return existing;
   errors.push({code:'DUPLICATE_CATEGORY',message:'Partida duplicada: '+item.name});return existing;
  }
  let amount=null;try{amount=cents(amountAt(cells,sourceCell));}catch(error){errors.push({code:error.code||'INVALID_AMOUNT',message:'No es pot verificar l’import de '+item.name+' ('+sourceCell+').'});}
  const line={code,name:item.name,nature,sourceCell,labelCell:column+row,parentCode:parent?.code||null,amountCents:amount,plannedCents:amount};
  lines.push(line);index.set(key,line);return line;
 }
 for(const [column,amountColumn,totalColumn,nature] of [['A','D','E','INCOME'],['G','J','K','EXPENSE']]){
  for(let r=headerRow+1;r<totalRow;r++){
   const item=label(cells.get(column+r)?.text);if(!item)continue;
   const n=norm(item.name);
   if((column==='A'&&item.code==='5'&&!n.includes('reserves propies'))||
     (column==='G'&&item.code==='6'&&n!=='estalvi'))
    errors.push({code:'RESERVE_CLASSIFICATION',message:'Cal aclarir la naturalesa de la partida '+item.name+' abans d’importar-la.'});
   const actualNature=n.includes('reserves propies')?'RESERVE_USE':n==='estalvi'?'RESERVE_CONTRIBUTION':nature;
   add(item,actualNature,r,column,amountColumn,totalColumn);
  }
 }
 for(const [column,amountColumn,totalColumn] of [['A','D','E'],['G','J','K']]){
  let parent=null;
  const rows=[...cells.keys()].filter(key=>key.startsWith(column)&&Number(key.slice(column.length))>totalRow)
    .map(key=>Number(key.slice(column.length))).sort((a,b)=>a-b);
  for(const r of rows){
   const item=label(cells.get(column+r)?.text);if(!item)continue;
   if(item.code.split('.').length<=2&&index.has('EXPENSE:'+item.code))parent=index.get('EXPENSE:'+item.code);
   else if(parent)add(item,'EXPENSE',r,column,amountColumn,totalColumn,true,parent);
   else errors.push({code:'ORPHAN_CATEGORY',message:'Subpartida sense capçalera: '+item.name});
  }
 }
 for(const line of lines)if(!line.parentCode&&line.code.includes('.'))line.parentCode=line.code.slice(0,line.code.lastIndexOf('.'));
 for(const line of lines){
  if(line.parentCode&&!index.has(line.nature+':'+line.parentCode))errors.push({code:'MISSING_PARENT',message:'Falta la partida superior de '+line.name});
  const children=lines.filter(child=>child.nature===line.nature&&child.parentCode===line.code);
  line.selectable=children.length===0;
  if(children.length){
   if(line.amountCents!==null&&children.every(c=>c.amountCents!==null)&&line.amountCents!==children.reduce((sum,c)=>sum+c.amountCents,0))
    errors.push({code:'SUBTOTAL_MISMATCH',message:'El subtotal de '+line.name+' no coincideix amb les subpartides.'});
   line.plannedCents=null;
  }
 }
 if(!lines.some(l=>l.nature==='INCOME')||!lines.some(l=>l.nature==='EXPENSE'))invalid('budget_template_unrecognized');
 if(lines.length>200)invalid('budget_xlsx_limits');
 const totals={incomeCents:0,expenseCents:0,reserveUseCents:0,reserveContributionCents:0};
 const keys={INCOME:'incomeCents',EXPENSE:'expenseCents',RESERVE_USE:'reserveUseCents',RESERVE_CONTRIBUTION:'reserveContributionCents'};
 for(const l of lines)if(l.selectable&&l.plannedCents!==null)totals[keys[l.nature]]+=l.plannedCents;
 for(const [coord,expected] of [['E'+totalRow,totals.incomeCents+totals.reserveUseCents],['K'+totalRow,totals.expenseCents+totals.reserveContributionCents]]){
  try{if(cents(amountAt(cells,coord))!==expected)errors.push({code:'TOTAL_MISMATCH',message:'El total anual no coincideix amb les partides ('+coord+').'});}
  catch{errors.push({code:'TOTAL_UNVERIFIED',message:'No es pot verificar el total anual ('+coord+').'});}
 }
 return {template:'PARPALLO_ANNUAL_V1',roundCode,sheetPath:path,lines,warnings,errors,totals};
}
export {norm};
