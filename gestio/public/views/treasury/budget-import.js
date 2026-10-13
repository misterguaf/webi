import {h,button} from '../../ui.js';
import {formatEur,errorCopy} from './model.js';
export function renderBudgetImport(section,ctx,round,refresh){
 const notice=h('p',{attrs:{role:'status'}}),previewRoot=h('div'),file=h('input',{attrs:{type:'file',accept:'.xlsx','aria-label':'Pressupost anual XLSX'}});
 const wrapper=h('details',{},h('summary',{text:'Importa el pressupost anual Excel'}),
  h('p',{text:'Ronda triada: '+round.code+'. Primer revisa les partides i els imports; es crearan només després de confirmar.'}),file,notice,previewRoot);
 let busy=false;
 const preview=button('Revisa el llibre',async()=>{
  if(busy)return;const selected=file.files[0];if(!selected){notice.textContent='Tria un fitxer XLSX.';return;}
  if(selected.size>2*1024*1024||!selected.name.toLowerCase().endsWith('.xlsx')){notice.textContent='Tria un XLSX de fins a 2 MB.';return;}
  busy=true;notice.textContent='Llegint i validant el pressupost…';previewRoot.replaceChildren();
  try{
   const bytes=new Uint8Array(await selected.arrayBuffer());let binary='';
   for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
   const result=await ctx.call('/api/finance/rounds/'+round.id+'/budget-imports',{method:'POST',
    body:JSON.stringify({filename:selected.name,dataBase64:btoa(binary)})});
   notice.textContent=result.status==='CONFIRMED'?'Aquest llibre ja s’ha importat.':'Revisa el resultat abans de confirmar.';
   if(result.status==='CONFIRMED'){await refresh();return;}
   const data=result.preview;
   previewRoot.append(h('h3',{text:selected.name}),h('p',{text:'Pressupost '+data.roundCode+' · '+data.lines.length+' partides'}),
    h('p',{text:'Ingressos: '+formatEur(data.totals.incomeCents)+' · Despeses: '+formatEur(data.totals.expenseCents)}),
    h('p',{text:'Aplicació de reserves: '+formatEur(data.totals.reserveUseCents)+' · Aportació a reserves: '+formatEur(data.totals.reserveContributionCents)}));
   for(const [nature,name] of [['INCOME','Ingressos'],['EXPENSE','Despeses'],['RESERVE_USE','Aplicació de reserves'],['RESERVE_CONTRIBUTION','Aportació a reserves']]){
    const nodes=data.lines.filter(l=>l.nature===nature).sort((a,b)=>a.code.localeCompare(b.code,'ca',{numeric:true})),list=h('ul',{className:'budget-import-tree'});
    for(const line of nodes)list.append(h('li',{className:'budget-import-depth-'+line.code.split('.').length},
     h('strong',{text:line.name}),h('span',{text:' · '+line.code+' · '+(line.selectable?'Assignable':'Subtotal')+' · '+
      (line.amountCents===null?'Import sense verificar':formatEur(line.amountCents))})));
    previewRoot.append(h('h4',{text:name}),list);
   }
   if(data.errors.length)previewRoot.append(h('h4',{text:'Cal revisar'}),...data.errors.map(e=>h('p',{className:'inline-error',text:e.message})));
   const checks=new Map();
   if(data.warnings.length){
    previewRoot.append(h('h4',{text:'Avisos'}),...data.warnings.map(w=>h('p',{text:w.message})));
    for(const code of new Set(data.warnings.map(w=>w.code))){
     const checkbox=h('input',{attrs:{type:'checkbox'}});checks.set(code,checkbox);
     previewRoot.append(h('label',{className:'checkbox-row'},checkbox,h('span',{text:code==='PASQUA_NUMBERING'?
      'He revisat la numeració corregida de Pasqua.':'He revisat les partides sense correspondència al resultat tradicional.'})));
    }
   }
   if(!data.errors.length)previewRoot.append(button('Confirma la importació a '+round.code,async()=>{
    if(busy)return;
    if([...checks.values()].some(c=>!c.checked)){notice.textContent='Confirma que has revisat els avisos.';return;}
    busy=true;
    try{await ctx.call('/api/finance/rounds/'+round.id+'/budget-imports/'+result.id+'/confirm',{method:'POST',
      body:JSON.stringify({acknowledgedWarnings:[...checks.keys()]})});notice.textContent='Pressupost importat.';await refresh();}
    catch(error){notice.textContent=errorCopy(error);}finally{busy=false;}
   },{className:'btn btn-primary'}));
  }catch(error){notice.textContent=errorCopy(error);}finally{busy=false;}
 });
 wrapper.insertBefore(preview,notice);section.append(wrapper);
}
