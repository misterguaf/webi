import {norm} from './budget-import-parser.js';
// Deliberate concept mapping to the historical RESULTADO workbook. Its 4.x/5.x numbering differs.
const camps=new Map([['campament de nadal','C. Navidad'],['campament de pasqua','C. Pascua'],['campament destiu','C. Verano'],['santjordi','SanJordi']]);
export function legacyTarget(line,lines){
 if(!line.selectable)return null;
 if(line.nature.startsWith('RESERVE_'))return {reserve:true};
 const path=[];for(let node=line,guard=0;node&&guard<10;guard++){
  path.unshift(norm(node.name));node=lines.find(l=>l.nature===line.nature&&l.code===node.parentCode);
 }
 for(const name of path)if(camps.has(name))return {sheet:camps.get(name)};
 const name=norm(line.name);
 if(name==='quotes'||name==='quota asde')return {sheet:'Cuotas'};
 if(name==='loteria')return {sheet:'Lotería'};
 if(line.nature==='INCOME'){
  if(name==='subvencions')return {cell:'D21'};
  if(name==='activitats'||name==='roba')return {sheet:'Otras'};
  const section={estol:'D28',scout:'D29',esculta:'D30',clan:'D31'};if(section[name])return {cell:section[name]};
 }else{
  if(path.includes('despeses activitats seccio'))return {cell:'J27'};
  const target={'suministres':'J28','subministraments':'J28','infraestructura':'J30','reforma del local':'J31',
   'material activitats':'J32','terreny benicoscoll':'J33','comunitat':'J44','cursos':'J45','roba':'J46',
   'material local':'J47','wifi':'J48','convivencia scouters':'J49'};
  if(target[name])return {cell:target[name]};
  if(name==='altres'&&path[0]==='altres')return {cell:'J50'};
 }
 return null;
}
export function addExportMappings(preview){
 for(const line of preview.lines){
  line.legacyTarget=legacyTarget(line,preview.lines);
  if(line.selectable&&!line.legacyTarget)preview.warnings.push({code:'UNMAPPED_EXPORT',message:
   'La partida «'+line.name+'» no té una correspondència inequívoca al llibre de resultats tradicional. Es pot importar; l’exportació de resultats s’aturarà si té import real.'});
 }
 return preview;
}
