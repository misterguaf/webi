import { setupFees } from './fees.js';
import { setupFeeStatus } from './fee-status.js';
import { setupDashboard } from './dashboard.js';
import { navigateTo, onNavigate, setShellSession } from './shell.js';
const $ = id => document.getElementById(id);
const message = value => { $('message').textContent = value; };
async function call(path, options = {}) {
  let response;
  try { response = await fetch(path, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } }); }
  catch (cause) {
    console.error('Gestió request failed', path, cause);
    const error = new Error('No s’ha pogut connectar amb Gestió. Torna-ho a provar.'); error.status = 0; throw error;
  }
  let data;
  try { data = await response.json(); }
  catch (cause) {
    console.error('Gestió response could not be read', path, response.status, cause);
    const error = new Error('No s’han pogut carregar les dades. Torna-ho a provar.'); error.status = response.status || 0; throw error;
  }
  if (!response.ok) {
    if (![401, 403, 404].includes(response.status)) console.error('Gestió request rejected', { path, status: response.status, code: data.error, requestId: data.requestId });
    if (response.status === 401) {
      if (document.body.classList.contains('shell-authenticated')) {
        hide();
        message('La sessió ha caducat. Torna a entrar.');
      }
      const error = new Error('La sessió ha caducat. Torna a entrar.'); error.status = 401; throw error;
    }
    const error = new Error(response.status >= 500 ? 'No s’ha pogut completar l’operació. Torna-ho a provar.' : `${data.error || 'error'} · ${data.requestId || ''}`);
    error.status = response.status; throw error;
  }
  return data;
}
const post = path => call(path, { method: 'POST' });
const reportLoadError = error => { if (error?.status !== 401 && error?.status !== 403 && error?.status !== 404) $('shellLoadError').hidden = false; };
const loadFees = setupFees({call,message,reportLoadError});
const loadFeeStatus=setupFeeStatus({call,reportLoadError});
let editingActivity=null;
let currentMe=null;
const dashboard=setupDashboard({call,navigateTo,
  openActivity:async id=>{navigateTo('activitats');await editActivity(id);$('activityForm').scrollIntoView({block:'start',behavior:'instant'});},
  openRegistrations:(id,pendingOnly,activityName)=>loadRegistrations(id,pendingOnly,activityName),
  openPayments:async()=>{navigateTo('inscripcions');await loadPayments();$('paymentPanel').scrollIntoView({block:'start',behavior:'instant'});},
  openFeeIssues:()=>{navigateTo('quotes');$('feeIssues').scrollIntoView({block:'start',behavior:'instant'});}
});
onNavigate(id=>{if(id==='inici'&&currentMe)void dashboard.load(currentMe)});
function hide() { currentMe=null;dashboard.hide();for (const id of ['account','sessions','participants','activityPanel','registrationPanel','paymentPanel','feePanel','feeStatusPanel','notificationPanel']) $(id).hidden = true; $('feeStatusList').replaceChildren();$('feeStatusRound').replaceChildren();$('feeRound').replaceChildren();$('feeRoundForm').reset();for(const id of ['feeRoundRevisions','feeMetrics','feeSearchResults','feeGroups','feeObligations','feePayments','feeIssues','feeObligationDetail','feePaymentDetail']) $(id).replaceChildren();$('activityForm').hidden=true;$('activityForm').reset();editingActivity=null;$('logout').hidden=true;$('login').hidden=false;setShellSession(null); }
async function refresh() {
  $('shellLoadError').hidden = true;
  let me;
  try { me = await call('/api/me'); } catch(error) { hide(); reportLoadError(error); return; }
  $('login').hidden = true; $('logout').hidden = false; currentMe=me;setShellSession(me);
  $('account').hidden = false; $('sessions').hidden = false;
  $('profile').textContent = `${me.user.displayName} · ${me.user.status}`;
  $('roles').replaceChildren(...me.roles.map(role => { const li = document.createElement('li'); li.textContent = `${role.role_code}${role.section_code ? ` · ${role.section_code}` : ''}`; return li; }));
  let sessions = { sessions: [] };
  try { sessions = await call('/api/me/sessions'); } catch(error) { reportLoadError(error); if(error.status===401) return; }
  $('sessionList').replaceChildren(...sessions.sessions.map(session => {
    const li = document.createElement('li');
    li.textContent = `${session.current ? 'Actual · ' : ''}${new Date(session.created_at).toLocaleString('ca-ES')} · expira ${new Date(session.absolute_expires_at).toLocaleString('ca-ES')} `;
    const button = document.createElement('button'); button.textContent = 'Revoca';
    button.addEventListener('click', async () => { try { await call(`/api/me/sessions/${session.id}`, { method: 'DELETE' }); await refresh(); } catch(e) { message(e.message); } });
    li.append(button); return li;
  }));
  // Modules are requested only when /api/me says they are usable, so ordinary navigation does
  // not produce AUTHZ_DENY noise. Capabilities are advisory; the server authorises every call.
  const caps = me.capabilities;
  $('participants').hidden = true;
  if (caps.participants.read) {
    try {
      const data = await call('/api/participants'); $('participants').hidden = false;
      $('participantList').replaceChildren(...data.participants.map(person => { const li=document.createElement('li'); li.textContent=`${person.display_name} · ${person.current_section_id}`; return li; }));
    } catch(error) { $('participants').hidden = true; reportLoadError(error); if(error.status===401) return; }
  }
  $('activityPanel').hidden = true;
  if (caps.activities.read || caps.activities.manage || caps.activities.manageGeneral) await loadActivities();
  if (!document.body.classList.contains('shell-authenticated')) return;
  $('paymentPanel').hidden = true;
  if (caps.activities.verifyPayments) await loadPayments();
  if (!document.body.classList.contains('shell-authenticated')) return;
  const fullFees = !!caps.fees.read?.all;
  $('feePanel').hidden = true; $('feeStatusPanel').hidden = true;
  if (fullFees || caps.fees.reviewPayments) await loadFees({ reviewOnly: !fullFees });
  if (!fullFees && caps.fees.status) await loadFeeStatus(true);
  if (!document.body.classList.contains('shell-authenticated')) return;
  $('notificationPanel').hidden = !caps.administration.audit;
}
async function loadDevIdentities() {
  try { const data = await call('/api/dev/identities'); $('demoIndicator').hidden=false; $('localDataNotice').hidden=false; $('login').querySelector('p').textContent='Selector disponible únicament en desenvolupament local.'; $('loginButton').disabled=false; $('identity').replaceChildren(...data.identities.map(identity => { const option=document.createElement('option'); option.value=identity.subject; option.textContent=identity.display_name; return option; })); }
  catch(error) { $('login').querySelector('p').textContent=error.status===404?'El selector local no està disponible. L’accés de producció requereix Cloudflare Access.':'No s’ha pogut carregar el selector local. Torna-ho a provar.'; $('loginButton').disabled=true; reportLoadError(error); }
}
$('retryShellData').addEventListener('click', async () => { await refresh(); await loadDevIdentities(); });
$('loginButton').addEventListener('click', async () => { try { await call('/api/dev/login', { method:'POST', body: JSON.stringify({ subject: $('identity').value }) }); message('Sessió iniciada.'); await refresh(); } catch(e) { message(e.message); } });
$('logout').addEventListener('click', async () => { try { await post('/api/logout'); hide(); message('Sessió tancada.'); } catch(e) { message(e.message); } });
$('revokeAll').addEventListener('click', async () => { try { await post('/api/me/sessions/revoke-all'); hide(); message('Totes les sessions revocades.'); } catch(e) { message(e.message); } });
const statusLabel={DRAFT:'Esborrany',PUBLISHED:'Publicada',CLOSED:'Tancada',GENERAL:'Tot el grup',
  NEEDS_PARTICIPANT_REVIEW:'Pendent de vincular',AWAITING_PAYMENT_REVIEW:'Pendent de pagament',
  CONFIRMED:'Confirmada',REJECTED:'Rebutjada',CLEAR:'Coincidència clara',AMBIGUOUS:'Coincidència ambigua',
  NONE:'Sense coincidència',RESOLVED:'Vinculada',PENDING_REVIEW:'Pendent de revisió',VERIFIED:'Verificat',ISSUE:'Incidència'};
const label=value=>statusLabel[value]??value;
const dateInput=value=>{const d=new Date(value),two=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${two(d.getMonth()+1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;};
const dateValue=id=>new Date($(id).value).getTime();
async function loadActivities(){
  try{
    const data=await call('/api/activities');$('activityPanel').hidden=false;
    $('activityList').replaceChildren(...data.activities.map(activity=>{
      const li=document.createElement('li');li.textContent=`${activity.name} · ${label(activity.status)} · ${activity.audience==='GENERAL'?label('GENERAL'):activity.sections} · ${(activity.price_cents/100).toFixed(2)} € `;
      const edit=document.createElement('button');edit.textContent=activity.status==='CLOSED'?'Consulta':'Edita';edit.addEventListener('click',()=>editActivity(activity.id));
      const registrations=document.createElement('button');registrations.textContent='Inscripcions';registrations.addEventListener('click',()=>loadRegistrations(activity.id,false,activity.name));
      li.append(edit,registrations);return li;
    }));
  }catch(error){$('activityPanel').hidden=true;reportLoadError(error);}
}
function setActivityReadOnly(closed){
  for(const id of ['activityName','activityAudience','activitySections','activityLocation','activityStart','activityEnd',
    'activityDeadline','activityPrice','activityDescription','activityMaterials','activityNotice','activityTransport','activityTransportPrice']) $(id).disabled=closed;
  $('activitySave').hidden=closed;
  $('activityClosedNotice').hidden=!closed;
}
async function editActivity(id){
  try{
    const {activity}=await call(`/api/activities/${id}`);editingActivity=id;$('activityForm').hidden=false;
    const closed=activity.status==='CLOSED';
    setActivityReadOnly(closed);
    $('activityFormTitle').textContent=`${closed?'Consulta':'Edita'}: ${activity.name}`;
    $('activityName').value=activity.name;$('activityAudience').value=activity.audience;
    for(const option of $('activitySections').options)option.selected=activity.sectionIds.includes(option.value);
    $('activityLocation').value=activity.location;$('activityStart').value=dateInput(activity.starts_at);
    $('activityEnd').value=dateInput(activity.ends_at);$('activityDeadline').value=dateInput(activity.registration_deadline);
    $('activityPrice').value=activity.price_cents;$('activityDescription').value=activity.short_description;
    $('activityMaterials').value=activity.materials;$('activityNotice').value=activity.special_notice;
    $('activityTransport').checked=activity.transportOptions.length>0;
    $('activityTransportPrice').value=activity.transportOptions.find(option=>option.code==='GROUP')?.price_adjustment_cents??0;
    $('publishActivity').hidden=activity.status!=='DRAFT';$('closeActivity').hidden=activity.status!=='PUBLISHED';
  }catch(error){message(error.message);}
}
$('newActivity').addEventListener('click',()=>{
  editingActivity=null;$('activityForm').reset();$('activityForm').hidden=false;
  setActivityReadOnly(false);
  $('activityFormTitle').textContent='Activitat nova';$('publishActivity').hidden=true;$('closeActivity').hidden=true;
  $('activityForm').scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  $('activityName').focus({preventScroll:true});
});
$('reloadActivities').addEventListener('click',loadActivities);
$('activityForm').addEventListener('submit',async event=>{
  event.preventDefault();
  if($('activitySave').hidden)return;
  const body={name:$('activityName').value,audience:$('activityAudience').value,
    sectionIds:$('activityAudience').value==='GENERAL'?[]:[...$('activitySections').selectedOptions].map(option=>option.value),
    location:$('activityLocation').value,startsAt:dateValue('activityStart'),endsAt:dateValue('activityEnd'),
    registrationDeadline:dateValue('activityDeadline'),priceCents:Number($('activityPrice').value),
    shortDescription:$('activityDescription').value,materials:$('activityMaterials').value,specialNotice:$('activityNotice').value,
    transportOptions:$('activityTransport').checked?[{code:'GROUP',adjustmentCents:Number($('activityTransportPrice').value)},
      {code:'FAMILY',adjustmentCents:0}]:[]};
  try{
    const result=await call(editingActivity?`/api/activities/${editingActivity}`:'/api/activities',
      {method:editingActivity?'PATCH':'POST',body:JSON.stringify(body)});
    editingActivity=result.id;message('Activitat guardada.');await loadActivities();await editActivity(result.id);
  }catch(error){message(error.message);}
});
for(const [button,action] of [['publishActivity','publish'],['closeActivity','close']]){
  $(button).addEventListener('click',async()=>{if(!editingActivity)return;try{
    await post(`/api/activities/${editingActivity}/${action}`);message('Estat actualitzat.');await loadActivities();await editActivity(editingActivity);
  }catch(error){message(error.message);}});
}
async function loadRegistrations(activityId,pendingOnly=false,activityName=''){
  try{
    const data=await call(`/api/activities/${activityId}/registrations`);$('registrationPanel').hidden=false;navigateTo('inscripcions');
    $('registrationPanel').querySelector('p').textContent=activityName
      ? `${pendingOnly?'Pendents de revisar':'Inscripcions'} · ${activityName}`
      :'Inscripcions de l’activitat seleccionada.';
    const visible=pendingOnly?data.registrations.filter(row=>row.status==='NEEDS_PARTICIPANT_REVIEW'):data.registrations;
    $('registrationList').replaceChildren(...visible.map(registration=>{
      const li=document.createElement('li');li.textContent=`${registration.submitted_name} · ${label(registration.status)} · ${label(registration.match_status)} · ${(registration.expected_amount_cents/100).toFixed(2)} €${registration.submitted_birth_date?` · Naixement declarat: ${registration.submitted_birth_date}`:''} `;
      if(registration.status==='NEEDS_PARTICIPANT_REVIEW'){
        const candidates=document.createElement('select');const empty=document.createElement('option');empty.value='';empty.textContent='Tria educand';candidates.append(empty);
        call(`/api/registrations/${registration.id}/candidates`).then(data=>{
          candidates.append(...data.candidates.map(person=>{const option=document.createElement('option');option.value=person.id;option.textContent=`${person.display_name} · ${person.section_code} · Naixement: ${person.birth_date||'no consta'}`;return option;}));
        }).catch(()=>{});
        const match=document.createElement('button');match.textContent='Vincula';match.addEventListener('click',async()=>{
          if(!candidates.value)return;try{await call(`/api/registrations/${registration.id}/review`,
            {method:'POST',body:JSON.stringify({decision:'MATCH',participantId:candidates.value})});await loadRegistrations(activityId,pendingOnly,activityName);}
          catch(error){message(error.message);}
        });
        const reject=document.createElement('button');reject.textContent='Rebutja';reject.addEventListener('click',async()=>{
          try{await call(`/api/registrations/${registration.id}/review`,{method:'POST',body:JSON.stringify({decision:'REJECT'})});await loadRegistrations(activityId,pendingOnly,activityName);}
          catch(error){message(error.message);}
        });li.append(candidates,match,reject);
      }
      return li;
    }));
  }catch(error){message(error.message);}
}
async function loadPayments(){
  try{
    const data=await call('/api/payments');$('paymentPanel').hidden=false;
    $('paymentList').replaceChildren(...data.payments.map(payment=>{
      const li=document.createElement('li');li.textContent=`${payment.activity_name} · ${payment.submitted_name} · ${label(payment.review_status)} · ${(payment.expected_amount_cents/100).toFixed(2)} € `;
      const download=document.createElement('a');download.href=`/api/payments/${payment.id}/evidence`;download.textContent='Baixa justificant';download.download='justificant.bin';
      li.append(download);
      for(const [decision,label] of [['VERIFIED','Verifica'],['ISSUE','Incidència']]){
        if(decision==='VERIFIED'&&!['PENDING_REVIEW','ISSUE'].includes(payment.review_status))continue;
        if(decision==='ISSUE'&&payment.review_status!=='PENDING_REVIEW')continue;
        const button=document.createElement('button');button.textContent=label;button.addEventListener('click',async()=>{
          try{await call(`/api/payments/${payment.id}/review`,{method:'POST',body:JSON.stringify({decision})});await loadPayments();}
          catch(error){message(error.message);}
        });li.append(button);
      }
      return li;
    }));
  }catch(error){$('paymentPanel').hidden=true;reportLoadError(error);}
}
$('reloadPayments').addEventListener('click',loadPayments);
$('drainNotifications').addEventListener('click',async()=>{try{
  const result=await call('/api/dev/notifications/drain',{method:'POST',body:JSON.stringify({})});
  message(`Correus ficticis capturats: ${result.sent}; errors: ${result.failed}.`);
}catch(error){message(error.message);}});
await loadDevIdentities(); await refresh();
