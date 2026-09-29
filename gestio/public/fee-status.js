import { fetchAllPages } from './api.js';
// Read-only section view. The server supplies both the scope and the status.
export function setupFeeStatus({call,reportLoadError=()=>{}}){
  const $=id=>document.getElementById(id);
  const labels={PAID:'Pagada',PARTIAL:'Parcial',PENDING:'Pendent',ISSUE:'Incidència'};
  const sections={MANADA:'Manada',TROPA:'Tropa',ESCOLTA:'Escolta',CLAN:'Clan'};
  let selected='';
  const option=(value,label)=>{const node=document.createElement('option');node.value=value;node.textContent=label;return node;};
  async function load(resetSelection=false){
    try{
      if(resetSelection)selected='';
      const query=selected?`?roundId=${encodeURIComponent(selected)}`:'';
      const result=await fetchAllPages(call,'/api/fees/status'+query,'statuses');
      selected=result.selectedRoundId??'';
      $('feeStatusRound').replaceChildren(...result.rounds.map(round=>option(round.id,round.code)));
      $('feeStatusRound').value=selected;
      const list=$('feeStatusList');list.replaceChildren();
      if(!result.rounds.length)list.textContent='Encara no hi ha cap ronda de quotes.';
      else if(!result.statuses.length)list.textContent='No hi ha estats de quota per mostrar en les teues seccions.';
      else for(const row of result.statuses){
        const item=document.createElement('li');
        const name=document.createElement('span');name.textContent=`${row.displayName} · ${sections[row.sectionCode]??'Secció'}`;
        const status=document.createElement('strong');status.textContent=labels[row.status]??'Estat no disponible';
        status.className='fee-basic-status fee-basic-status-'+row.status.toLowerCase();
        item.append(name,status);list.append(item);
      }
      $('feeStatusPanel').hidden=false;
      return true;
    }catch(error){
      $('feeStatusPanel').hidden=true;
      if(error.status!==403 && error.status!==404)reportLoadError(error);
      return false;
    }
  }
  $('feeStatusRound').addEventListener('change',()=>{selected=$('feeStatusRound').value;void load()});
  $('reloadFeeStatus').addEventListener('click',()=>{void load()});
  return load;
}
