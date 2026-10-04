import { fetchAllPages } from './api.js';
// Functional local/synthetic treasury controls. Values sent by a family are never bank verification.
export function setupFees({call,message,reportLoadError=()=>{}}) {
  const $=id=>document.getElementById(id);
  const euros=cents=>(cents/100).toFixed(2)+' €';
  const option=(value,label)=>{const node=document.createElement('option');node.value=value;node.textContent=label;return node;};
  const button=(label,action)=>{const node=document.createElement('button');node.type='button';node.textContent=label;
    node.addEventListener('click',()=>Promise.resolve(action()).catch(error=>message(error.message)));return node;};
  const item=(text,...children)=>{const node=document.createElement('li');node.textContent=text;node.append(...children);return node;};
  const input=(type,placeholder)=>{const node=document.createElement('input');node.type=type;node.placeholder=placeholder;return node;};
  const send=(path,method,body)=>call(path,{method,body:JSON.stringify(body)});
  const act=async(task)=>{await task();message('Operació registrada en l’auditoria local.');await load();};
  let rounds=[],selected='',obligations=[],reviewOnly=false,readContacts=false;
  const roundPath=()=>`/api/fees/rounds/${selected}`;
  function clearFinancialView(){
    rounds=[];selected='';obligations=[];
    $('feeRoundForm').reset();$('feeRound').replaceChildren();
    for(const id of ['feeRoundRevisions','feeMetrics','feeSearchResults','feeGroups','feeObligations','feePayments','feeIssues','feeObligationDetail','feePaymentDetail']) $(id).replaceChildren();
  }
  // `options.reviewOnly` comes from /api/me capabilities (delegated payment reviewer without
  // finance.fee.read); later internal reloads keep the last mode. The server authorises every call.
  async function load(options) {
    if (options) {reviewOnly=!!options.reviewOnly;readContacts=!!options.readContacts;}
    try {
      const result=await call(reviewOnly?'/api/fees/review-rounds':'/api/fees/rounds');
      rounds=result.rounds;$('feePanel').hidden=false;$('feeManagePanel').hidden=reviewOnly;
      if (!rounds.some(round=>round.id===selected)) selected=rounds[0]?.id||'';
      $('feeRound').replaceChildren(...rounds.map(round=>option(round.id,round.code)));
      $('feeRound').value=selected;
      const round=rounds.find(row=>row.id===selected);
      $('feeRoundCode').value=round?.code||'';$('feeRoundCode').readOnly=!!round;
      $('feeBase').value=round?.base_cents||10000;
      $('feeDeadline').value=round?.deadline_at?new Date(round.deadline_at).toISOString().slice(0,10):'';
      $('feeHolder').value=round?.account_holder||'';$('feeIban').value=round?.iban||'';
      $('feeConcept').value=round?.concept_template||'Cuota Anual {Nombre educando}';
      $('feeOpen').checked=!!round?.is_open;
      if (selected) {if(reviewOnly)await loadPayments();else await loadRound();}
      else for(const id of ['feeRoundRevisions','feeMetrics','feeSearchResults','feeGroups','feeObligations','feePayments','feeIssues','feeObligationDetail','feePaymentDetail']) $(id).replaceChildren();
      return true;
    } catch(error) {clearFinancialView();$('feePanel').hidden=true;reportLoadError(error);if(error.message && error.status!==0 && !(error.status>=500) && !error.message.startsWith('forbidden'))message(error.message);return false;}
  }
  async function loadRound() {
    const revisions=(await call(roundPath()+'/revisions')).revisions;
    $('feeRoundRevisions').replaceChildren(...revisions.map(row=>item(`Canvi ${new Date(row.changed_at).toLocaleString('ca-ES')}: `+
      `base ${euros(row.previous_base_cents)} → ${euros(row.new_base_cents)}; `+
      `data ${row.previous_deadline_at?new Date(row.previous_deadline_at).toLocaleDateString('ca-ES'):'sense'} → `+
      `${row.new_deadline_at?new Date(row.new_deadline_at).toLocaleDateString('ca-ES'):'sense'}.`)));
    const metrics=await call(roundPath()+'/metrics');
    const values=metrics.metrics;
    $('feeMetrics').textContent=`Previst: ${euros(values.expectedCents)} · confirmat: ${euros(values.confirmedAllocatedCents)} · impugnat: ${euros(values.disputedAllocatedCents)} · verificat sense assignar: ${euros(values.unallocatedVerifiedCents)} · pendent d'assignació: ${euros(values.pendingCents)} · recaptat: ${values.collectedPercent}%\n`+
      `Pendents: ${values.statusCounts.PENDING} · parcials: ${values.partialCount} · pagades: ${values.statusCounts.PAID} · incidències: ${values.issueCount}\n`+
      Object.entries(values.bySection).map(([section,row])=>`${section}: ${euros(row.confirmedAllocatedCents)} confirmat · ${euros(row.disputedAllocatedCents)} impugnat / ${euros(row.expectedCents)}`).join('\n');
    await Promise.all([loadObligations(),loadPayments(),loadGroups(),loadIssues()]);
  }
  async function loadObligations() {
    const params=new URLSearchParams();
    if($('feeSectionFilter').value)params.set('sectionId',$('feeSectionFilter').value);
    if($('feeStatusFilter').value)params.set('status',$('feeStatusFilter').value);
    if($('feeObligationSearch').value.trim())params.set('search',$('feeObligationSearch').value.trim());
    obligations=(await fetchAllPages(call,roundPath()+'/obligations?'+params,'obligations')).obligations;
    $('feeObligations').replaceChildren(...obligations.map(row=>item(
      `${row.display_name} · ${row.status} · deu ${euros(row.amount_due_cents)} · assignat ${euros(row.allocated_cents)} `,
      button('Detall',()=>showObligation(row.id)))));
  }
  async function showObligation(id) {
    const {obligation,allocations,installmentPlan,issues,amountRevisions}=await call(`/api/fees/obligations/${id}`);
    const box=$('feeObligationDetail');box.replaceChildren();
    const title=document.createElement('h4');title.textContent=`${obligation.display_name} · ${obligation.status}`;box.append(title);
    const summary=document.createElement('p');summary.textContent=`Quota base ${euros(obligation.base_cents)} · descompte ${euros(obligation.discount_cents)} · import degut ${euros(obligation.amount_due_cents)} · ordre germà ${obligation.sibling_ordinal}.`;box.append(summary);
    for(const row of allocations){const line=document.createElement('p');line.textContent=`Transferència ${row.payment_id} · ${euros(row.amount_cents)} · ${row.review_status}`;box.append(line);}
    for(const row of amountRevisions){const line=document.createElement('p');line.textContent=`Canvi de quota ${new Date(row.changed_at).toLocaleString('ca-ES')}: ${euros(row.previous_amount_cents)} → ${euros(row.new_amount_cents)}.`;box.append(line);}
    if(installmentPlan){const line=document.createElement('p');line.textContent='Fraccionament autoritzat: '+installmentPlan.parts.map(part=>`${euros(part.planned_cents)}${part.target_at?' · '+new Date(part.target_at).toLocaleDateString('ca-ES'):''}`).join(' + ');box.append(line);}
    const schedule=document.createElement('div'),fields=[];
    const addPart=(amountCents='',targetAt=null)=>{
      const row=document.createElement('div'),amount=input('number','Import en cèntims'),date=input('date','Data prevista');
      amount.min='1';amount.step='1';amount.value=amountCents;
      date.value=targetAt?new Date(targetAt).toISOString().slice(0,10):'';
      const amountLabel=document.createElement('label'),dateLabel=document.createElement('label');
      amountLabel.textContent=`Termini ${fields.length+1}: `;amountLabel.append(amount);
      dateLabel.textContent=' Data prevista: ';dateLabel.append(date);
      row.append(amountLabel,dateLabel);schedule.append(row);fields.push({amount,date,row});
    };
    if(installmentPlan)installmentPlan.parts.forEach(part=>addPart(part.planned_cents,part.target_at));
    else {addPart();addPart();}
    const reason=installmentPlan?input('text','Motiu de la correcció'):null;
    const controls=document.createElement('div');
    controls.append(button('Afig termini',()=>{if(fields.length<100)addPart();}),
      button('Lleva últim termini',()=>{if(fields.length>2){fields.pop().row.remove();}}));
    box.append(schedule,controls);
    if(reason){const label=document.createElement('label');label.textContent='Motiu de la correcció: ';label.append(reason);box.append(label);}
    box.append(button(installmentPlan?'Corregeix fraccionament':'Autoritza fraccionament',()=>act(()=>send(
      `/api/fees/obligations/${id}/installments`,'POST',{
        parts:fields.map(({amount,date})=>({amountCents:Number(amount.value),targetAt:date.value?Date.parse(date.value):null})),
        ...(installmentPlan?{replacesPlanId:installmentPlan.id,reason:reason.value.trim()}:{}),
      }))));
    const amount=input('number','Nou import degut en cèntims');
    box.append(amount,button('Canvia import degut',()=>act(()=>send(`/api/fees/obligations/${id}`,'PATCH',{amountDueCents:Number(amount.value)}))));
    box.append(button('Obri incidència',()=>act(()=>send('/api/fees/issues','POST',{obligationId:id,code:'DISCREPANCY'}))));
    for(const issue of issues){const line=document.createElement('p');line.textContent=`Incidència ${issue.code} · ${issue.status} `;
      if(issue.status==='OPEN')line.append(button('Resol',()=>act(()=>send(`/api/fees/issues/${issue.id}/resolve`,'POST',{}))));box.append(line);}
  }
  async function loadPayments() {
    try {const rows=(await fetchAllPages(call,roundPath()+'/payments','payments')).payments;
      $('feePayments').replaceChildren(...rows.map(row=>item(
        `Enviament ${new Date(row.created_at).toLocaleDateString('ca-ES')} · ${row.people_count} educand(s) · ${row.review_status} · declarat ${row.declared_amount_cents==null?'no consta':euros(row.declared_amount_cents)} · coincidències pendents ${row.pending_matches} `,
        button('Revisa',()=>showPayment(row.id)))));
    }catch(error){$('feePayments').textContent='No tens permís per revisar pagaments.';}
  }
  async function showPayment(id) {
    const {payment,people,allocations,allocationRevisions,eligibleObligations}=await call(`/api/fees/payments/${id}`);
    const box=$('feePaymentDetail');box.replaceChildren();
    const title=document.createElement('h4');title.textContent=`Transferència ${id} · ${payment.review_status}`;box.append(title);
    const info=document.createElement('p');info.textContent=`Verificat ${payment.verified_amount_cents==null?'no':euros(payment.verified_amount_cents)} · verificat sense assignar ${payment.verified_amount_cents==null?'no':euros(payment.unallocated_cents)}.`;box.append(info);
    // 3.5G.1A: the submitter's contact is never part of the payment; it is consulted on demand (audited).
    if(readContacts){const contact=document.createElement('p');
      contact.append(button('Mostra el contacte',async()=>{const {contact:value}=await call(`/api/fees/payments/${id}/contact`);
        contact.textContent=`Enviat per ${value.submittedByName} · correu ${value.email}${value.phone?` · telèfon ${value.phone}`:''}`;}));
      box.append(contact);}
    if(payment.evidence){const view=document.createElement('a');view.href=`/api/fees/evidence/${payment.evidence.id}?mode=view`;view.target='_blank';view.rel='noopener';
      view.textContent='Veure justificant';const download=document.createElement('a');download.href=`/api/fees/evidence/${payment.evidence.id}?mode=download`;
      download.textContent='Descarrega';const links=document.createElement('p');links.append(view,' · ',download);box.append(links);}
    for(const row of people){const line=document.createElement('p');line.textContent=`${row.submitted_name} · ${row.match_status} `;box.append(line);
      if(['AMBIGUOUS','NONE'].includes(row.match_status)){
        const found=await call(`/api/fees/people/${row.id}/candidates`),candidates=found.candidates;
        if(found.truncated)message('Hi ha més candidats plausibles dels que es mostren.');
        const pick=document.createElement('select');pick.append(option('','Selecciona educand'));
        pick.append(...candidates.map(person=>option(person.id,`${person.display_name} · ${person.birth_date_matches?'naixement coincideix':'naixement no coincideix'}${person.birth_date?` (${person.birth_date})`:''}`)));
        line.append(pick,button('Vincula',()=>act(()=>send(`/api/fees/people/${row.id}/review`,'POST',{decision:'MATCH',participantId:pick.value}))),
          button('Rebutja',()=>act(()=>send(`/api/fees/people/${row.id}/review`,'POST',{decision:'REJECT'}))));
      }
    }
    const revised=[];
    for(const row of allocations){const line=document.createElement('p');line.textContent=`Assignació ${row.obligation_id} · ${euros(row.amount_cents)} `;
      if(payment.verified_amount_cents!==null){const amount=input('number','Import corregit en cèntims');amount.value=row.amount_cents;
        revised.push({obligationId:row.obligation_id,amount});line.append(amount);}box.append(line);}
    if(revised.length)box.append(button('Corregeix assignacions',()=>act(()=>send(`/api/fees/payments/${id}/allocations`,'PATCH',
      {expectedVersion:payment.allocation_version,allocations:revised.filter(row=>Number(row.amount.value)>0).map(row=>({obligationId:row.obligationId,amountCents:Number(row.amount.value)}))}))));
    for(const row of allocationRevisions){const line=document.createElement('p');line.textContent=`Canvi d'assignació ${new Date(row.changed_at).toLocaleString('ca-ES')} · ${row.obligation_id}: ${row.previous_amount_cents==null?'sense':euros(row.previous_amount_cents)} → ${row.new_amount_cents==null?'sense':euros(row.new_amount_cents)}.`;box.append(line);}
    if(payment.verified_amount_cents==null){
      const verified=input('number','Import verificat al banc, en cèntims');box.append(verified);
      const assignment=[];
      for(const person of people.filter(row=>['CLEAR','RESOLVED'].includes(row.match_status))){
        const obligation=eligibleObligations.find(row=>row.participant_id===person.participant_id);
        const line=document.createElement('p');line.textContent=person.submitted_name+' · ';
        if(obligation){const amount=input('number','Assignació en cèntims');assignment.push({obligationId:obligation.id,amount});line.append(amount);}
        else if(reviewOnly)line.append('Demana a Tresoreria que cree l’obligació.');
        else line.append(button('Crea obligació',()=>act(()=>send('/api/fees/obligations','POST',{roundId:selected,participantId:person.participant_id}))));
        box.append(line);
      }
      box.append(button('Verifica import i assignacions',()=>act(()=>send(`/api/fees/payments/${id}/review`,'POST',
        {verifiedAmountCents:Number(verified.value),allocations:assignment.filter(row=>Number(row.amount.value)>0)
          .map(row=>({obligationId:row.obligationId,amountCents:Number(row.amount.value)}))}))));
    }
    box.append(button('Marca incidència',()=>act(()=>send('/api/fees/issues','POST',{paymentId:id,code:'BANK_NOT_FOUND'}))));
  }
  async function loadGroups() {
    try {const rows=(await fetchAllPages(call,roundPath()+'/groups','groups')).groups;
      $('feeGroups').replaceChildren(...rows.map(row=>item(`${row.reference} · ${row.sibling_ordinal}. ${row.display_name}`)));
    }catch{$('feeGroups').textContent='Agrupacions no disponibles amb este permís.';}
  }
  async function loadIssues() {
    try {const rows=(await fetchAllPages(call,roundPath()+'/issues','issues')).issues;
      // ALLOCATION_UNCLEAR with verified euros still unassigned cannot be resolved (the server refuses):
      // the action is to correct the payment's allocations; once nothing is left, it can be resolved.
      const pending=row=>row.code==='ALLOCATION_UNCLEAR' && row.unallocated_cents>0;
      $('feeIssues').replaceChildren(...rows.map(row=>item(`${row.code} · ${row.status} · ${row.payment_id||row.obligation_id} `,
        ...(row.status!=='OPEN'?[]:pending(row)?[`· ${euros(row.unallocated_cents)} verificats sense assignar: assigna'ls abans de resoldre. `,
          button('Revisa el pagament',()=>showPayment(row.payment_id))]
          :[button('Resol',()=>act(()=>send(`/api/fees/issues/${row.id}/resolve`,'POST',{})))]))));
    }catch{$('feeIssues').textContent='Incidències no disponibles amb este permís.';}
  }
  $('feeRound').addEventListener('change',()=>{selected=$('feeRound').value;load().catch(error=>message(error.message));});
  $('reloadFees').addEventListener('click',()=>load());
  $('feeFilterButton').addEventListener('click',()=>loadObligations().catch(error=>message(error.message)));
  $('newFeeRound').addEventListener('click',()=>{selected='';$('feeRoundForm').reset();$('feeRoundCode').readOnly=false;$('feeRoundCode').focus();});
  $('feeRoundForm').addEventListener('submit',event=>{event.preventDefault();const body={baseCents:Number($('feeBase').value),
    deadlineAt:$('feeDeadline').value?Date.parse($('feeDeadline').value):null,
    accountHolder:$('feeHolder').value,iban:$('feeIban').value,conceptTemplate:$('feeConcept').value,
    isOpen:$('feeOpen').checked};
    const existing=!!selected;if(!existing)body.code=$('feeRoundCode').value;
    act(()=>send(existing?`/api/fees/rounds/${selected}`:'/api/fees/rounds',existing?'PATCH':'POST',body))
      .catch(error=>message(error.message));});
  $('feeSearchButton').addEventListener('click',async()=>{try {const found=await call(roundPath()+'/participants?search='+
    encodeURIComponent($('feePersonSearch').value.trim()));const rows=found.participants;
    if(found.truncated)message('Hi ha més resultats dels que es mostren: afina la cerca.');
    $('feeSearchResults').replaceChildren(...rows.map(row=>{const check=input('checkbox','');check.value=row.id;
      return item(`${row.display_name} · ${row.section_code} `,check,button('Crea obligació',()=>act(()=>
        send('/api/fees/obligations','POST',{roundId:selected,participantId:row.id}))));}));
  }catch(error){message(error.message);}});
  $('feeCreateGroup').addEventListener('click',()=>{const participantIds=[...$('feeSearchResults').querySelectorAll('input:checked')].map(node=>node.value);
    act(()=>send('/api/fees/groups','POST',{roundId:selected,reference:$('feeGroupReference').value.trim(),participantIds}))
      .catch(error=>message(error.message));});
  return load;
}
