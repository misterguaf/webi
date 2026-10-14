import {h,button,icon} from '../../ui.js';
import {formatEur,errorCopy} from './model.js';
// Phase J: file choice → review (totals, tree per nature, errors and warnings to acknowledge) → confirm. The
// workbook is only created after the explicit confirmation, exactly as before.
export function renderBudgetImport(section,ctx,round,refresh){
 const status=h('div',{className:'form-notice',attrs:{role:'status',hidden:true}},h('p'));
 const say=(text,tone='info')=>{status.querySelector('p').textContent=text;status.hidden=!text;
  status.className=tone==='danger'?'inline-error':tone==='ok'?'form-notice budget-import-ok':'form-notice';status.setAttribute('role',tone==='danger'?'alert':'status');};
 const previewRoot=h('div',{className:'budget-import-preview'}),file=h('input',{className:'file-input',attrs:{id:'budgetImportFile',type:'file',accept:'.xlsx','aria-label':'Pressupost anual XLSX'}});
 const wrapper=h('details',{className:'budget-import'},h('summary',{className:'disclosure'},icon('upload'),h('span',{text:'Importa el pressupost anual Excel'})),
  h('p',{className:'field-hint',text:'Ronda triada: '+round.code+'. Primer revisa les partides i els imports; es crearan només després de confirmar.'}),
  h('div',{className:'form-field budget-import-file'},h('label',{className:'field-label',text:'Llibre XLSX (fins a 2 MB)',attrs:{for:'budgetImportFile'}}),file),status,previewRoot);
 let busy=false;
 const preview=button('Revisa el llibre',async()=>{
  if(busy)return;const selected=file.files[0];if(!selected){say('Tria un fitxer XLSX.','danger');return;}
  if(selected.size>2*1024*1024||!selected.name.toLowerCase().endsWith('.xlsx')){say('Tria un XLSX de fins a 2 MB.','danger');return;}
  busy=true;say('Llegint i validant el pressupost…');previewRoot.replaceChildren();
  try{
   const bytes=new Uint8Array(await selected.arrayBuffer());let binary='';
   for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
   const result=await ctx.call('/api/finance/rounds/'+round.id+'/budget-imports',{method:'POST',
    body:JSON.stringify({filename:selected.name,dataBase64:btoa(binary)})});
   say(result.status==='CONFIRMED'?'Aquest llibre ja s’ha importat.':'Revisa el resultat abans de confirmar.');
   if(result.status==='CONFIRMED'){await refresh();return;}
   const data=result.preview;
   const fact=(label,cents)=>h('div',{className:'fact'},h('span',{className:'fact-label',text:label}),h('span',{className:'fact-value',text:formatEur(cents)}));
   previewRoot.append(h('div',{className:'block-head'},h('h3',{className:'block-title',text:selected.name}),
     h('span',{className:'badge tone-neutral',text:'Pressupost '+data.roundCode+' · '+data.lines.length+' partides'})),
    h('div',{className:'summary-strip budget-import-totals'},fact('Ingressos',data.totals.incomeCents),fact('Despeses',data.totals.expenseCents),
     fact('Aplicació de reserves',data.totals.reserveUseCents),fact('Aportació a reserves',data.totals.reserveContributionCents)));
   for(const [nature,name] of [['INCOME','Ingressos'],['EXPENSE','Despeses'],['RESERVE_USE','Aplicació de reserves'],['RESERVE_CONTRIBUTION','Aportació a reserves']]){
    const nodes=data.lines.filter(l=>l.nature===nature).sort((a,b)=>a.code.localeCompare(b.code,'ca',{numeric:true})),list=h('ul',{className:'budget-import-tree'});
    if(!nodes.length)continue;
    for(const line of nodes)list.append(h('li',{className:'budget-import-depth-'+line.code.split('.').length+(line.selectable?'':' is-subtotal')},
     h('span',{className:'budget-code',text:line.code}),h('span',{className:'budget-name',text:line.name}),
     h('span',{className:'budget-kind',text:line.selectable?'Assignable':'Subtotal'}),
     h('span',{className:'amount'+(line.amountCents===null?' is-unverified':''),text:line.amountCents===null?'Import sense verificar':formatEur(line.amountCents)})));
    previewRoot.append(h('h4',{className:'form-section-title',text:name}),list);
   }
   if(data.errors.length)previewRoot.append(h('h4',{className:'form-section-title',text:'Cal revisar'}),...data.errors.map(e=>h('div',{className:'inline-error'},h('p',{text:e.message}))));
   const checks=new Map();
   if(data.warnings.length){
    previewRoot.append(h('h4',{className:'form-section-title',text:'Avisos'}),...data.warnings.map(w=>h('div',{className:'detail-message'},h('p',{text:w.message}))));
    for(const code of new Set(data.warnings.map(w=>w.code))){
     const checkbox=h('input',{attrs:{type:'checkbox'}});checks.set(code,checkbox);
     previewRoot.append(h('label',{className:'checkbox-row budget-import-ack'},checkbox,h('span',{text:code==='PASQUA_NUMBERING'?
      'He revisat la numeració corregida de Pasqua.':'He revisat les partides sense correspondència al resultat tradicional.'})));
    }
   }
   if(!data.errors.length)previewRoot.append(h('div',{className:'form-actions'},button('Confirma la importació a '+round.code,async()=>{
    if(busy)return;
    if([...checks.values()].some(c=>!c.checked)){say('Confirma que has revisat els avisos.','danger');return;}
    busy=true;
    try{await ctx.call('/api/finance/rounds/'+round.id+'/budget-imports/'+result.id+'/confirm',{method:'POST',
      body:JSON.stringify({acknowledgedWarnings:[...checks.keys()]})});say('Pressupost importat.','ok');await refresh();}
    catch(error){say(errorCopy(error),'danger');}finally{busy=false;}
   },{className:'btn btn-primary'})));
  }catch(error){say(errorCopy(error),'danger');}finally{busy=false;}
 },{className:'btn btn-secondary'});
 wrapper.insertBefore(h('div',{className:'form-actions'},preview),status);section.append(wrapper);
}
