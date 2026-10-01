import {fetchAllPages} from './api.js';
import {attentionPhrase,basicFeeSummary,dateLabel,deadlineLabel,feeIssueAttention,financialSummary,greeting,
  queueAttention,registrationCountLabel,sectionLabel,summaryAttention,upcomingActivities} from './dashboard-model.js';

const $=id=>document.getElementById(id);
const make=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=text;return node;};
const button=(text,action,className='')=>{const node=make('button',className,text);node.type='button';node.addEventListener('click',action);return node;};
const dateRange=activity=>{
  const start=dateLabel(activity.starts_at),end=dateLabel(activity.ends_at);
  return start===end?start:`${start} – ${end}`;
};
const isUnavailable=error=>error?.status===403 || error?.status===404;

export function setupDashboard({call,navigateTo,openActivity,openRegistrations,openPayments,openRegistrationQueue=()=>openPayments('pendents'),openFeeIssues,createActivity,openIncompleteParticipants,openParticipantReviews}) {
  let generation=0;
  let identity=null;
  let attention={registrations:[],payments:[],fees:null,participants:[]};
  let errors=new Set();
  const reload=()=>{if(identity)void load(identity)};
  function sectionError(container,message){
    container.replaceChildren(make('p','dashboard-inline-error',message),button('Torna-ho a intentar',reload,'dashboard-retry'));
  }
  function renderAttention(){
    const items=[...attention.registrations,...attention.payments,attention.fees,...attention.participants].filter(Boolean);
    const count=errors.size?null:items.reduce((sum,item)=>sum+item.count,0);
    $('dashboardPhrase').textContent=attentionPhrase(count);
    $('dashboardAttention').replaceChildren();
    if(items.length){
      $('dashboardAttentionTitle').textContent='Requereix la teua atenció';
      const list=make('div','dashboard-attention-list');
      for(const item of items){
        const action=item.kind==='registrations'?()=>openRegistrations(item.activityId,true,item.activityName):
          item.kind==='payments'?()=>openPayments('pendents'):
          item.kind==='payment-issues'?()=>openPayments('incidencies'):
          item.kind==='registrations-global'?()=>openRegistrationQueue():
          item.kind==='incomplete'?()=>openIncompleteParticipants():
          item.kind==='reviews'||item.kind==='escalated'?()=>openParticipantReviews():()=>openFeeIssues();
        list.append(button(item.text+'  →',action,'dashboard-attention-item'));
      }
      $('dashboardAttention').append(list);
    }else if(count===0){
      $('dashboardAttentionTitle').textContent='Tot al dia';
      $('dashboardAttention').append(make('p','dashboard-all-clear','No tens cap acció pendent ara mateix.'));
      $('dashboardAttentionPanel').classList.add('dashboard-clear');
    }else{
      $('dashboardAttentionTitle').textContent='Requereix la teua atenció';
      $('dashboardAttention').append(make('p','dashboard-inline-error','No s’han pogut comprovar totes les accions pendents.'),
        button('Torna-ho a intentar',reload,'dashboard-retry'));
    }
    if(items.length || count!==0)$('dashboardAttentionPanel').classList.remove('dashboard-clear');
    $('dashboardAttentionPanel').setAttribute('aria-busy','false');
  }
  function renderActivities(activities){
    const target=$('dashboardActivities');target.replaceChildren();
    const upcoming=upcomingActivities(activities);
    if(!upcoming.length){target.append(make('p','dashboard-empty','No hi ha cap activitat pròxima.'));return;}
    const grid=make('div','dashboard-activity-grid');
    for(const activity of upcoming){
      const card=make('article','dashboard-activity-card');
      const top=make('div','dashboard-card-top');
      top.append(make('span','dashboard-status '+(activity.status==='DRAFT'?'dashboard-status-draft':''),
        activity.status==='DRAFT'?'Esborrany':'Publicada'));
      card.append(top,make('h3','',activity.name),make('p','dashboard-activity-context',`${sectionLabel(activity)} · ${dateRange(activity)}`));
      const details=make('div','dashboard-activity-details');
      const total=registrationCountLabel(activity.registrations);
      if(total)details.append(make('span','',total));
      details.append(make('span','',activity.status==='DRAFT'?'Encara no publicada':deadlineLabel(activity.registration_deadline)));
      card.append(details,button(activity.status==='DRAFT'?'Continuar editant':'Obri activitat',
        ()=>openActivity(activity.id),'dashboard-card-action'));
      grid.append(card);
    }
    target.append(grid);
  }
  function renderFees(metrics){
    const summary=financialSummary(metrics),panel=$('dashboardFeesPanel');
    if(!summary){sectionError($('dashboardFees'),'No s’ha pogut carregar el resum de quotes.');panel.hidden=false;return;}
    const content=$('dashboardFees');content.replaceChildren();
    const primary=make('div','dashboard-finance-primary');
    primary.append(make('strong','',`${new Intl.NumberFormat('ca-ES',{maximumFractionDigits:2}).format(summary.percent)}%`),
      make('span','','cobrat'));
    const progress=make('div','dashboard-progress');progress.setAttribute('role','progressbar');
    progress.setAttribute('aria-label','Percentatge cobrat');progress.setAttribute('aria-valuemin','0');
    progress.setAttribute('aria-valuemax','100');progress.setAttribute('aria-valuenow',String(summary.percent));
    const fill=make('span','');fill.style.width=`${summary.percent}%`;progress.append(fill);
    const counts=make('div','dashboard-finance-counts');
    counts.append(make('span','',`${summary.paid} pagades`),make('span','',`${summary.partial} parcials`),
      make('span','',`${summary.issues} incidències`));
    content.append(primary,progress,counts);panel.hidden=false;
  }
  function renderBasicFees(statuses){
    const summary=basicFeeSummary(statuses),panel=$('dashboardFeesPanel');
    if(!summary)return;
    $('dashboardFeesTitle').textContent='Quotes de les teues seccions';
    $('dashboardSeeFees').textContent='Veure participants →';
    const content=$('dashboardFees');content.replaceChildren();
    if(!statuses.length)content.append(make('p','dashboard-empty','No hi ha quotes per mostrar en les teues seccions.'));
    else{
      const counts=make('div','dashboard-basic-fee-counts');
      for(const [status,label] of [['PAID','pagades'],['PENDING','pendents'],['PARTIAL','parcials'],['ISSUE','incidències']])
        counts.append(make('span','',`${summary[status]} ${label}`));
      content.append(counts);
    }
    panel.hidden=false;
  }
  async function loadBasicFees(token){
    try{
      const result=await fetchAllPages(call,'/api/fees/status','statuses');
      if(token!==generation)return;
      if(!result.rounds.length)return;
      renderBasicFees(result.statuses);
    }catch(error){
      if(token!==generation || isUnavailable(error))return;
      errors.add('fees');$('dashboardFeesPanel').hidden=false;
      sectionError($('dashboardFees'),'No s’ha pogut carregar l’estat de les quotes.');
    }
  }
  async function loadActivities(token){
    try{
      // 3.5D: counts and pending reviews come in the list read model, scoped by the server.
      const rows=(await fetchAllPages(call,'/api/activities','activities')).activities;
      if(token!==generation)return;
      attention.registrations=rows.map(summaryAttention).filter(Boolean);
      renderActivities(rows);
    }catch(error){
      if(token!==generation)return;
      if(!isUnavailable(error)){errors.add('activities');sectionError($('dashboardActivities'),'No s’han pogut carregar les pròximes activitats.');}
      else $('dashboardActivitiesPanel').hidden=true;
    }
  }
  async function loadParticipantFollowUp(token,caps){
    if(!caps.participants.manage)return;
    try{const data=await call('/api/participants/follow-up');
      if(token!==generation)return;
      if(data.incomplete>0)attention.participants.push({kind:'incomplete',count:data.incomplete,
        text:`${data.incomplete} ${data.incomplete===1?'fitxa pendent':'fitxes pendents'} de completar`});
    }catch(error){if(token===generation && !isUnavailable(error))errors.add('participants');}
  }
  async function loadParticipantReviews(token,caps){
    if(!caps.participants.review)return;
    try{const data=await call('/api/participant-reviews/summary');
      if(token!==generation)return;
      if(data.open>0)attention.participants.push({kind:'reviews',count:data.open,
        text:`${data.open} ${data.open===1?'revisió administrativa pendent':'revisions administratives pendents'}`});
      if(data.escalated>0)attention.participants.push({kind:'escalated',count:data.escalated,
        text:`${data.escalated} ${data.escalated===1?'cas escalat':'casos escalats'}`});
    }catch(error){if(token===generation && !isUnavailable(error))errors.add('reviews');}
  }
  async function loadQueueSummary(token,caps){
    try{const summary=await call('/api/registrations/queue/summary');
      if(token===generation)attention.payments=queueAttention(summary,{globalReviewer:!!caps.activities.reviewRegistrations?.all});
    }catch(error){if(token===generation && !isUnavailable(error))errors.add('payments');}
  }
  async function loadFees(token,caps){
    if(!caps.fees.read?.all){
      if(caps.fees.status)await loadBasicFees(token);
      return;
    }
    try{
      const rounds=(await call('/api/fees/rounds')).rounds;
      if(token!==generation)return;
      if(!rounds.length){$('dashboardFeesPanel').hidden=true;return;}
      const id=rounds[0].id;
      const [metricResult,issueResult]=await Promise.allSettled([
        call(`/api/fees/rounds/${id}/metrics`),fetchAllPages(call,`/api/fees/rounds/${id}/issues`,'issues')]);
      if(token!==generation)return;
      if(metricResult.status==='fulfilled')renderFees(metricResult.value.metrics);
      else if(!isUnavailable(metricResult.reason)){
        errors.add('fees');$('dashboardFeesPanel').hidden=false;
        sectionError($('dashboardFees'),'No s’ha pogut carregar el resum de quotes.');
      }
      if(issueResult.status==='fulfilled')attention.fees=feeIssueAttention(issueResult.value.issues);
      else if(!isUnavailable(issueResult.reason))errors.add('fees-issues');
    }catch(error){
      if(token!==generation)return;
      if(!isUnavailable(error)){
        errors.add('fees');$('dashboardFeesPanel').hidden=false;
        sectionError($('dashboardFees'),'No s’ha pogut carregar el resum de quotes.');
      }
    }
  }
  async function load(me){
    identity=me;const token=++generation;
    attention={registrations:[],payments:[],fees:null,participants:[]};errors=new Set();
    const caps=me.capabilities;
    const activityAccess=!!(caps.activities.read || caps.activities.manage || caps.activities.manageGeneral);
    $('dashboard').hidden=false;
    $('dashboardNewActivity').hidden=!(caps.activities.manage || caps.activities.manageGeneral);
    $('dashboardActivitiesPanel').hidden=!activityAccess;$('dashboardFeesPanel').hidden=true;
    $('dashboardFees').replaceChildren();$('dashboardFeesTitle').textContent='Quotes anuals';
    $('dashboardSeeFees').textContent='Veure quotes →';
    $('dashboardGreeting').textContent=greeting(me.user.displayName);
    const date=new Intl.DateTimeFormat('ca-ES',{weekday:'long',day:'numeric',month:'long'}).format(new Date());
    $('dashboardDate').textContent=date[0].toLocaleUpperCase('ca-ES')+date.slice(1);
    $('dashboardPhrase').textContent=attentionPhrase(null);
    $('dashboardAttentionTitle').textContent='Requereix la teua atenció';
    $('dashboardAttentionPanel').setAttribute('aria-busy','true');
    $('dashboardAttention').replaceChildren(make('div','dashboard-skeleton dashboard-skeleton-attention'));
    $('dashboardActivities').replaceChildren(make('div','dashboard-skeleton dashboard-skeleton-activity'));
    await Promise.allSettled([activityAccess?loadActivities(token):null,
      caps.activities.verifyPayments||caps.activities.reviewRegistrations?.all?loadQueueSummary(token,caps):null,loadFees(token,caps),
      loadParticipantFollowUp(token,caps),loadParticipantReviews(token,caps)]);
    if(token===generation)renderAttention();
  }
  function hide(){generation++;identity=null;$('dashboard').hidden=true;$('dashboardNewActivity').hidden=true;$('dashboardFees').replaceChildren();}
  $('dashboardSeeActivities').addEventListener('click',()=>navigateTo('activitats'));
  $('dashboardSeeFees').addEventListener('click',()=>navigateTo('quotes'));
  $('dashboardNewActivity').addEventListener('click',()=>createActivity());
  return {load,hide};
}
