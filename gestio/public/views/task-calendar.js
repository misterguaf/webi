// Calendari i tasques (Inici). Phase J: segmented view switch, filter chips, day cells with typed task chips,
// tasks that complete in place (the state changes only after the server answers; an error stays next to the row),
// grouped task form in a native dialog and a confirmation dialog for archiving. Same endpoints, capabilities and
// rules as 3.5I. Activities are placed with their real dates (starts_at / ends_at).
import { h, button, icon, confirmDialog, toast, trackOverlay, announce } from '../ui.js';
import { fetchAllPages } from '../api.js';
import { today,dateLabel,calendarDays,navigateDate,taskKind,overdue,activityOn } from './task-calendar-model.js';
import {SECTION_LABELS} from '../labels.js';
const option=(value,text)=>h('option',{text,attrs:{value}});
const errorText=error=>error.code==='stale_task'?'La tasca ha canviat. Tanca-la i torna-la a obrir.':
 error.code==='invalid_task_assignee'?'Revisa les persones responsables: han de tindre accés vigent a aquest àmbit.':
 error.message||'No s’ha pogut guardar la tasca.';
const VIEWS=[['month','Mes','grid'],['week','Setmana','columns'],['day','Dia','day'],['list','Llista','list']];
const RECURRENCE={DAILY:'Cada dia',WEEKLY:'Cada setmana',MONTHLY:'Cada mes'};
const longDay=value=>{const text=new Date(value+'T12:00:00Z').toLocaleDateString('ca-ES',{weekday:'long',day:'numeric',month:'long'});return text[0].toLocaleUpperCase('ca-ES')+text.slice(1);};
const iconButton=(label,name,onClick,attrs={})=>h('button',{className:'btn btn-secondary btn-small btn-icon',attrs:{type:'button','aria-label':label,title:label,...attrs},on:{click:onClick}},icon(name));
export function setupTaskCalendar({call,routes}){
 const root=document.getElementById('taskCalendar');let me=null,epoch=0,date=today(),view='week',filter='mine',tasks=[],events=[],summary={};
 const dialogs=new Set();
 const store=()=>{try{localStorage.setItem('gestio-calendar-'+me.user.id,view);}catch{}};
 async function pages(query){let result=[],cursor=null;for(let page=0;page<50;page++){
  const params=new URLSearchParams({...query,limit:'100',...(cursor?{cursor}:{})});
  const data=await call('/api/tasks?'+params);result.push(...data.tasks);cursor=data.nextCursor;if(!cursor)return result;
 }throw new Error('Hi ha massa tasques per mostrar-les juntes. Tria un període més curt.');}
 async function load(nextMe){
  if(!me||me.user.id!==nextMe.user.id){date=today();filter='mine';try{view=localStorage.getItem('gestio-calendar-'+nextMe.user.id)||'week';}catch{}}
  me=nextMe;if(!['month','week','day','list'].includes(view))view='week';
  await refresh();
 }
 // First load shows a skeleton; later refreshes keep the calendar on screen and dim it (UX_RULES §21).
 async function refresh(){
  const mine=++epoch;
  if(root.querySelector('.calendar-head'))root.classList.add('is-updating');
  else root.replaceChildren(h('div',{className:'calendar-loading',attrs:{role:'status','aria-label':'Carregant el calendari…'}},
   h('span',{className:'skeleton-line short'}),h('span',{className:'skeleton-block calendar-skeleton'})));
  const days=calendarDays(date,view);
  try {
   const query={view:filter,...(view!=='list'?{from:days[0],to:days.at(-1)}:{})};
   const [rows,activityRows,counts]=await Promise.all([pages(query),
    me.capabilities.activities.read?fetchAllPages(call,'/api/activities','activities'):Promise.resolve({activities:[]}),
    call('/api/tasks/summary')]);
   if(mine!==epoch||!me)return;
   tasks=rows;events=activityRows.activities;summary=counts;render();
  }catch(error){if(mine!==epoch||!me)return;root.classList.remove('is-updating');
   root.replaceChildren(h('div',{className:'inline-error',attrs:{role:'alert'}},h('p',{text:errorText(error)}),
    h('button',{className:'btn btn-secondary btn-small',attrs:{type:'button'},on:{click:refresh}},icon('refresh'),h('span',{text:'Torna-ho a intentar'}))));}
 }
 async function change(task,action){
  await call('/api/tasks/'+task.id+'/'+action,{method:'POST',body:JSON.stringify({expectedVersion:task.version})});await refresh();
 }
 const state=t=>t.status==='COMPLETED'?'done':overdue(t)?'late':t.visibility==='PERSONAL'?'personal':'shared';
 const STATE={done:['check','Completada'],late:['alert','Vençuda'],personal:['user','Personal'],shared:['share','Compartida']};
 function statusBadge(t){
  return t.status==='COMPLETED'?h('span',{className:'badge tone-ok',text:'Completada'}):overdue(t)?h('span',{className:'badge tone-danger',text:'Vençuda'}):null;
 }
 function row(task){
  const done=task.status==='COMPLETED',error=h('div',{className:'task-error',attrs:{hidden:true}});
  const meta=[h('span',{className:'meta-kind'},icon(task.visibility==='PERSONAL'?'user':'share'),taskKind(task)),
   h('span',{text:task.dueDate?dateLabel(task.dueDate):'Sense data'}),task.dueTime?h('span',{className:'meta-kind'},icon('clock'),task.dueTime):null,
   task.recurrence?h('span',{className:'meta-kind'},icon('repeat'),RECURRENCE[task.recurrence]??'Recurrent'):null];
  // The check answers at once (pressed + busy) but the task only counts as done when the server confirms.
  const check=task.actions.complete?h('button',{className:'task-check',attrs:{type:'button','aria-pressed':String(done),'aria-label':(done?'Reobri ':'Completa ')+task.title},
   on:{click:async()=>{error.hidden=true;check.setAttribute('aria-pressed',String(!done));
    try{await change(task,done?'reopen':'complete');announce(done?'Tasca reoberta':'Tasca completada');}
    catch(failure){check.setAttribute('aria-pressed',String(done));error.hidden=false;
     error.replaceChildren(h('div',{className:'inline-error',attrs:{role:'alert'}},h('p',{text:`${errorText(failure)} No s’ha guardat cap canvi.`})));}}}},icon('check'))
   :h('span',{className:'task-check task-check-static',attrs:{'aria-hidden':'true'}});
  return h('li',{className:'task-row'+(done?' task-done':'')},check,
   h('div',{className:'task-main'},button(task.title,()=>detail(task.id),{className:'task-title'}),h('span',{className:'task-meta'},meta.filter(Boolean)),error),
   h('span',{className:'task-status'},statusBadge(task)));
 }
 const audience=a=>a.audience==='GENERAL'?'GENERAL':String(a.sections||'').split(',')[0]||'GENERAL';
 function eventLink(a,className='calendar-activity'){return h('a',{className,dataset:{section:audience(a)},
  attrs:{href:'#/activitats/'+a.id,'aria-label':'Activitat: '+a.name},on:{click:event=>{event.preventDefault();routes.go({page:'activitats',path:[a.id]});}}},
  className==='calendar-activity'?null:icon('calendar'),h('span',{text:a.name}));}
 function periodLabel(days){
  if(view==='day'||view==='list')return longDay(date);
  const fmt=(value,options)=>new Date(value+'T12:00:00Z').toLocaleDateString('ca-ES',options);
  if(view==='month'){const text=fmt(date,{month:'long',year:'numeric'});return text[0].toLocaleUpperCase('ca-ES')+text.slice(1);}
  return `${fmt(days[0],{day:'numeric'})} – ${fmt(days.at(-1),{day:'numeric',month:'short',year:'numeric'})}`;
 }
 function render(){
  root.classList.remove('is-updating');
  const days=calendarDays(date,view),focusKey=root.contains(document.activeElement)?document.activeElement.dataset.focus:null;
  const viewSwitch=h('div',{className:'segmented calendar-views',attrs:{role:'radiogroup','aria-label':'Vista del calendari'}},
   ...VIEWS.map(([value,label,glyph])=>h('button',{className:'segment',attrs:{type:'button',role:'radio','aria-checked':String(value===view),'aria-selected':String(value===view),
    tabindex:value===view?'0':'-1','data-focus':'view-'+value},on:{click:()=>{if(view===value)return;view=value;store();return refresh();},
    keydown:event=>{const index=VIEWS.findIndex(([v])=>v===view),next={ArrowRight:index+1,ArrowLeft:index-1}[event.key];
     if(next===undefined)return;event.preventDefault();view=VIEWS[(next+VIEWS.length)%VIEWS.length][0];store();void refresh().then(()=>root.querySelector(`[data-focus="view-${view}"]`)?.focus());}}},
    icon(glyph),h('span',{text:label}))));
  const filters=h('div',{className:'filter-chips calendar-filters',attrs:{role:'group','aria-label':'Filtra les tasques'}},
   ...[['mine','Les meues'],['today','Hui'],['upcoming','Pròximes'],['shared','Compartides'],['completed','Completades'],
    ...(me.capabilities.tasks.sectionRead?[['section','Secció']]:[]),...(me.capabilities.tasks.groupRead?[['group','Grup']]:[])].map(([value,label])=>
    h('button',{className:'filter-chip',text:label,attrs:{type:'button','aria-pressed':String(value===filter),'data-focus':'filter-'+value},on:{click:()=>{filter=value;return refresh();}}})));
  const late=summary.overdue??0;
  const reminders=h('p',{className:'calendar-reminders'},
   h('span',{className:'reminder'},h('b',{text:String(summary.today??0)}),' hui'),
   h('span',{className:'reminder'+(late?' is-late':'')},late?icon('alert'):null,h('b',{text:String(late)}),late===1?' vençuda':' vençudes'),
   h('span',{className:'reminder'},h('b',{text:String(summary.assigned??0)}),' assignades pendents'));
  const controls=h('div',{className:'calendar-head'},
   h('div',{className:'calendar-title-row'},h('h2',{text:'Calendari i tasques'}),reminders),
   h('div',{className:'calendar-toolbar'},
    h('div',{className:'calendar-nav'},
     iconButton('Període anterior','chevron-left',()=>{date=navigateDate(date,view,-1);return refresh();},{'data-focus':'prev'}),
     h('button',{className:'btn btn-secondary btn-small',text:'Hui',attrs:{type:'button','data-focus':'today'},on:{click:()=>{date=today();return refresh();}}}),
     iconButton('Període següent','chevron-right',()=>{date=navigateDate(date,view,1);return refresh();},{'data-focus':'next'}),
     h('h3',{className:'calendar-period',text:periodLabel(days),attrs:{'aria-live':'polite'}}),
     h('label',{className:'date-jump',attrs:{title:'Ves a una data'}},icon('calendar'),
      h('input',{attrs:{type:'date',value:date,'aria-label':'Selecciona una data','data-focus':'date'},on:{change:event=>{date=event.target.value||today();void refresh();}}}))),
    viewSwitch,
    h('button',{className:'btn btn-primary calendar-new',attrs:{type:'button','data-focus':'new'},on:{click:()=>form(null,date)}},icon('plus'),h('span',{text:'Nova tasca'}))),
   filters);
  const limit=view==='month'?2:8;
  const grid=h('div',{className:'calendar-grid calendar-view-'+view});
  if(view!=='list')for(const value of days){
   const dayTasks=tasks.filter(t=>t.dueDate===value),dayEvents=events.filter(a=>activityOn(a,value));
   const day=new Date(value+'T12:00:00Z'),weekday=day.toLocaleDateString('ca-ES',{weekday:'short'}).replace('.','');
   grid.append(h('section',{className:'calendar-day'+(value===today()?' is-today':'')+(value===date?' is-selected':'')+(view==='month'&&value.slice(0,7)!==date.slice(0,7)?' is-outside':'')},
    h('button',{className:'calendar-date',attrs:{type:'button','aria-label':'Selecciona el '+dateLabel(value)+(dayTasks.length?`, ${dayTasks.length} ${dayTasks.length===1?'tasca':'tasques'}`:''),
     'aria-pressed':String(value===date),'aria-current':value===today()?'date':null,'data-focus':'day-'+value},on:{click:()=>{date=value;render();}}},
     view==='month'?null:h('span',{className:'calendar-weekday',text:weekday[0].toLocaleUpperCase('ca-ES')+weekday.slice(1)}),h('span',{className:'calendar-number',text:String(day.getUTCDate())})),
    h('div',{className:'calendar-items'},
     ...dayEvents.slice(0,2).map(a=>eventLink(a)),
     ...dayTasks.slice(0,limit).map(t=>{const [glyph,word]=STATE[state(t)];
      return h('button',{className:'calendar-task task-'+state(t)+(t.visibility==='PERSONAL'?' personal':' shared'),attrs:{type:'button',title:taskKind(t),'aria-label':word+' · '+t.title},
       on:{click:()=>detail(t.id)}},icon(glyph),view==='month'?null:h('span',{text:t.title}));}),
     dayTasks.length>limit?h('button',{className:'calendar-more',text:`+${dayTasks.length-limit}`,attrs:{type:'button','aria-label':`${dayTasks.length-limit} tasques més`},
      on:{click:()=>{date=value;view='day';store();return refresh();}}}):null),
    view==='month'?null:h('button',{className:'calendar-add',attrs:{type:'button','aria-label':'Nova tasca el '+dateLabel(value),title:'Nova tasca'},on:{click:()=>form(null,value)}},icon('plus'))));
  }
  const visible=view==='list'?tasks:tasks.filter(t=>t.dueDate===date);
  const dayEvents=view==='list'?[]:events.filter(a=>activityOn(a,date));
  const selected=h('section',{className:'calendar-selected'},
   h('div',{className:'calendar-selected-head'},h('h3',{text:view==='list'?'Totes les tasques':longDay(date)}),
    h('button',{className:'btn btn-quiet btn-small',attrs:{type:'button'},on:{click:()=>form(null,view==='list'?today():date)}},icon('plus'),h('span',{text:'Afegeix'}))),
   ...dayEvents.map(a=>eventLink(a,'calendar-event-row')),
   visible.length?h('ul',{className:'task-list'},...visible.sort((a,b)=>(a.dueDate||'9999').localeCompare(b.dueDate||'9999')).map(row)):
     dayEvents.length?null:h('div',{className:'empty-state calendar-empty'},h('p',{className:'empty-title',text:filter==='completed'?'Cap tasca completada en aquesta vista.':'Cap tasca en aquesta vista.'})));
  const weekdays=view==='month'?h('div',{className:'calendar-weekdays',attrs:{'aria-hidden':'true'}},
    ...['Dl','Dt','Dc','Dj','Dv','Ds','Dg'].map(text=>h('span',{text}))):null;
  const legend=view==='month'?h('p',{className:'calendar-legend'},...Object.values(STATE).map(([glyph,word])=>h('span',{},icon(glyph),word)),
   h('span',{},h('span',{className:'legend-activity'}),'Activitat')):null;
  root.replaceChildren(...[controls,legend,weekdays,view==='list'?null:grid,selected].filter(Boolean));
  if(focusKey)root.querySelector(`[data-focus="${focusKey}"]`)?.focus({preventScroll:true});
 }
 function dialog(title){
  const opener=document.activeElement,node=h('dialog',{className:'task-dialog',attrs:{'aria-label':title}},
   h('header',{className:'task-dialog-head'},h('h2',{text:title}),
    h('button',{className:'btn btn-quiet btn-icon btn-small',attrs:{type:'button','aria-label':'Tanca (Esc)',title:'Tanca'},on:{click:()=>close()}},icon('close'))));
  const untrack=trackOverlay(()=>close());
  const close=()=>{untrack();if(node.open)node.close();node.remove();dialogs.delete(node);if(opener?.isConnected)opener.focus();};
  node.addEventListener('cancel',event=>{event.preventDefault();close();});
  document.body.append(node);dialogs.add(node);node.showModal();
  return {node,close};
 }
 async function showError(error){toast(errorText(error),{tone:'danger'});}
 async function detail(id){
  const mine=epoch;
  try {const data=await call('/api/tasks/'+id);if(mine!==epoch||!me)return;
   const t=data.task,{node,close}=dialog(t.title);
   const notice=h('div',{className:'task-dialog-notice'});
   const fact=(label,value)=>value?h('div',{className:'info-row'},h('dt',{text:label}),h('dd',{text:value})):null;
   node.append(h('p',{className:'task-dialog-badges'},h('span',{className:'meta-kind'},icon(t.visibility==='PERSONAL'?'user':'share'),taskKind(t)),statusBadge(t)),
    h('p',{className:'task-description',text:t.description||'Sense descripció'}),
    h('dl',{className:'info-list'},fact('Data',t.dueDate?longDay(t.dueDate):'Sense data'),fact('Hora',t.dueTime),fact('Repetició',t.recurrence?RECURRENCE[t.recurrence]??'Recurrent':null),
     fact('Persones',t.members.map(m=>m.name+(m.responsible?' · responsable':'')).join(', '))),notice);
   const actions=h('div',{className:'dialog-actions task-dialog-actions'});
   // The native modal dialog makes the rest of the page inert, so it closes before the confirmation opens
   // (and comes back if the archive is cancelled).
   if(data.actions.edit)actions.append(h('button',{className:'btn btn-quiet task-archive',attrs:{type:'button'},on:{click:async()=>{
    close();
    if(!await confirmDialog({title:'Arxivar la tasca?',body:'Deixarà d’aparéixer al calendari. No s’esborra.',confirm:'Arxiva',tone:'danger'})){void detail(t.id);return;}
    try{await change(t,'archive');toast('Tasca arxivada',{tone:'ok'});}catch(error){toast(errorText(error),{tone:'danger'});}}}},icon('trash'),h('span',{text:'Arxiva'})));
   if(data.actions.edit)actions.append(h('button',{className:'btn btn-secondary',attrs:{type:'button'},on:{click:()=>{close();return form(t,t.dueDate);}}},icon('pencil'),h('span',{text:'Edita'})));
   if(data.actions.complete)actions.append(h('button',{className:'btn btn-primary',attrs:{type:'button'},on:{click:async()=>{try{await change(t,t.status==='COMPLETED'?'reopen':'complete');close();
    toast(t.status==='COMPLETED'?'Tasca reoberta':'Tasca completada',{tone:'ok'});}
    catch(error){notice.replaceChildren(h('div',{className:'inline-error',attrs:{role:'alert'}},h('p',{text:errorText(error)})));}}}},
    icon(t.status==='COMPLETED'?'refresh':'check'),h('span',{text:t.status==='COMPLETED'?'Reobri':'Completa'})));
   if(actions.children.length)node.append(actions);
  }catch(error){if(me)await showError(error);}
 }
 async function form(task,defaultDate){
  const {node,close}=dialog(task?'Edita la tasca':'Nova tasca'),notice=h('div',{className:'task-dialog-notice',attrs:{role:'status'}}),requestKey=crypto.randomUUID();
  const title=h('input',{attrs:{name:'title',id:'taskTitle',value:task?.title||'',required:true,maxlength:160,autocomplete:'off','aria-describedby':'taskTitleError'}});
  const titleError=h('p',{className:'field-error',attrs:{id:'taskTitleError',hidden:true}});
  const visibility=h('select',{attrs:{name:'visibility',id:'taskVisibility'}},option('PERSONAL','Personal'),option('NAMED','Persones concretes'),
   ...(me.capabilities.tasks.sectionManage?[option('SECTION','Equip de secció')]:[]),...(me.capabilities.tasks.groupManage?[option('GROUP','Grup')]:[]));
  visibility.value=task?.visibility||'PERSONAL';
  const scope=me.capabilities.tasks.sectionManage;
  const allowedSections=scope?.all?me.capabilities.sections:scope?.sections??[];
  const section=h('select',{attrs:{name:'sectionId','aria-label':'Secció'}},option('','Tria una secció'),
    ...allowedSections.map(s=>option(s.id,SECTION_LABELS[s.code]||s.code)));
  section.value=task?.sectionId||'';
  const members=h('div',{className:'task-members'});let usersToken=0;
  async function updatePeople(){
   const mine=++usersToken;section.hidden=visibility.value!=='SECTION';members.replaceChildren();
   if(visibility.value==='PERSONAL'||(visibility.value==='SECTION'&&!section.value))return;
   try{const params=new URLSearchParams({visibility:visibility.value,...(section.value&&visibility.value==='SECTION'?{sectionId:section.value}:{})});
    const data=await call('/api/tasks/users?'+params);if(mine!==usersToken||!node.isConnected)return;
    members.append(h('p',{className:'field-hint',text:'Comparteix amb / responsables (opcionals per a secció o grup):'}),...data.users.map(u=>{
     const shared=h('input',{attrs:{type:'checkbox',name:'member',value:u.id}}),responsible=h('input',{attrs:{type:'checkbox',name:'responsible',value:u.id,'aria-label':'Responsable: '+u.name}});
     shared.checked=task?.members.some(m=>m.userId===u.id)||false;responsible.checked=task?.members.some(m=>m.userId===u.id&&m.responsible)||false;
     return h('div',{className:'task-member'},h('label',{},shared,u.name),h('label',{className:'task-responsible'},responsible,'Responsable'));
    }));
   }catch(error){notice.replaceChildren(h('div',{className:'inline-error'},h('p',{text:errorText(error)})));}
  }
  visibility.addEventListener('change',()=>void updatePeople());section.addEventListener('change',()=>void updatePeople());
  const recurrence=h('select',{attrs:{name:'recurrence',id:'taskRecurrence'}},option('','No es repeteix'),option('DAILY','Cada dia'),option('WEEKLY','Cada setmana'),option('MONTHLY','Cada mes'));
  recurrence.value=task?.recurrence||'';
  const field=(label,control,id,{optional=false}={})=>h('div',{className:'form-field'},h('label',{className:'field-label',attrs:{for:id}},label,optional?h('span',{className:'field-required',text:' · opcional'}):null),control);
  const description=h('textarea',{attrs:{name:'description',id:'taskDescription',maxlength:2000,rows:3},text:task?.description||''});
  const submit=h('button',{className:'btn btn-primary',attrs:{type:'submit'}},icon(task?'check':'plus'),h('span',{text:task?'Guarda els canvis':'Crea la tasca'}));
  title.addEventListener('input',()=>{if(title.value.trim()){titleError.hidden=true;title.closest('.form-field').classList.remove('field-invalid');}});
  let busy=false;
  const formNode=h('form',{attrs:{novalidate:true},on:{submit:async event=>{
   event.preventDefault();if(busy)return;
   if(!title.value.trim()){titleError.hidden=false;titleError.textContent='Escriu un títol per a la tasca.';title.closest('.form-field').classList.add('field-invalid');title.focus();return;}
   busy=true;submit.setAttribute('aria-busy','true');
   const data=new FormData(event.currentTarget),selected=new Set(data.getAll('member')),responsible=new Set(data.getAll('responsible'));
   for(const id of responsible)selected.add(id);
   const value={title:data.get('title'),description:data.get('description'),visibility:data.get('visibility'),
    sectionId:data.get('visibility')==='SECTION'?data.get('sectionId'):null,dueDate:data.get('dueDate')||null,dueTime:data.get('dueTime')||null,
    recurrence:data.get('recurrence')||null,members:data.get('visibility')==='PERSONAL'?[]:[...selected].map(userId=>({userId,responsible:responsible.has(userId)})),
    ...(task?{expectedVersion:task.version}:{requestKey})};
   try{await call(task?'/api/tasks/'+task.id:'/api/tasks',{method:task?'PATCH':'POST',body:JSON.stringify(value)});close();toast(task?'Tasca guardada':'Tasca creada',{tone:'ok'});await refresh();}
   catch(error){notice.replaceChildren(h('div',{className:'inline-error',attrs:{role:'alert'}},h('p',{text:`${errorText(error)} El que has escrit es conserva.`})));}
   finally{busy=false;submit.removeAttribute('aria-busy');}
  }}},
   h('div',{className:'form-section'},h('div',{className:'form-field'},h('label',{className:'field-label',attrs:{for:'taskTitle'}},'Títol'),title,titleError)),
   h('fieldset',{className:'form-section'},h('legend',{className:'form-section-title'},icon('calendar'),'Quan'),
    h('div',{className:'field-row'},field('Data',h('input',{attrs:{type:'date',name:'dueDate',id:'taskDate',value:task?.dueDate||defaultDate||''}}),'taskDate',{optional:true}),
     field('Hora',h('input',{attrs:{type:'time',name:'dueTime',id:'taskTime',value:task?.dueTime||''}}),'taskTime',{optional:true})),
    field('Repetició',recurrence,'taskRecurrence')),
   h('fieldset',{className:'form-section'},h('legend',{className:'form-section-title'},icon('share'),'Qui la veu'),field('Visibilitat',visibility,'taskVisibility'),section,members),
   h('fieldset',{className:'form-section'},h('legend',{className:'form-section-title'},icon('file'),'Detalls'),field('Descripció',description,'taskDescription',{optional:true})),
   notice,
   h('div',{className:'dialog-actions'},h('button',{className:'btn btn-secondary',text:'Cancel·la',attrs:{type:'button'},on:{click:()=>close()}}),submit));
  node.append(formNode);await updatePeople();title.focus();
 }
 function unload(){epoch++;me=null;tasks=[];events=[];root.replaceChildren();for(const d of dialogs){d.close();d.remove();}dialogs.clear();}
 return {load,unload};
}
