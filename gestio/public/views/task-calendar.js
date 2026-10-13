import { h,button } from '../ui.js';
import { fetchAllPages } from '../pagination.js';
import { today,dateLabel,calendarDays,navigateDate,taskKind } from './task-calendar-model.js';
const option=(value,text)=>h('option',{text,attrs:{value}});
const errorText=error=>error.code==='stale_task'?'La tasca ha canviat. Tanca-la i torna-la a obrir.':
 error.code==='invalid_task_assignee'?'Revisa les persones responsables: han de tindre accés vigent a aquest àmbit.':
 error.message||'No s’ha pogut guardar la tasca.';
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
 async function refresh(){
  const mine=++epoch;root.replaceChildren(h('p',{text:'Carregant el calendari…',attrs:{role:'status'}}));
  const days=calendarDays(date,view);
  try {
   const query={view:filter,...(view!=='list'?{from:days[0],to:days.at(-1)}:{})};
   const [rows,activityRows,counts]=await Promise.all([pages(query),
    me.capabilities.activities.read?fetchAllPages(call,'/api/activities','activities'):Promise.resolve({activities:[]}),
    call('/api/tasks/summary')]);
   if(mine!==epoch||!me)return;
   tasks=rows;events=activityRows.activities;summary=counts;render();
  }catch(error){if(mine!==epoch||!me)return;root.replaceChildren(h('p',{text:errorText(error),attrs:{role:'alert'}}),button('Torna-ho a intentar',refresh));}
 }
 async function change(task,action){
  await call('/api/tasks/'+task.id+'/'+action,{method:'POST',body:JSON.stringify({expectedVersion:task.version})});await refresh();
 }
 function row(task){
  const overdue=task.status==='PENDING'&&task.dueDate&&task.dueDate<today();
  return h('li',{className:'task-row'+(task.status==='COMPLETED'?' task-done':'')},
   task.actions.complete?button(task.status==='COMPLETED'?'✓':'○',async()=>{try{await change(task,task.status==='COMPLETED'?'reopen':'complete');}
    catch(error){await showError(error);}}, {attrs:{'aria-label':(task.status==='COMPLETED'?'Reobri ':'Completa ')+task.title}}):h('span',{text:'•'}),
   button(task.title,()=>detail(task.id),{className:'task-title'}),
   h('span',{className:'task-meta',text:[taskKind(task),task.status==='COMPLETED'?'Completada':overdue?'Vençuda':null,
    task.dueDate?dateLabel(task.dueDate):'Sense data',task.dueTime,task.recurrence?'↻ Recurrent':null].filter(Boolean).join(' · ')}));
 }
 function activityDate(a){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Madrid'}).format(a.startsAt);}
 function eventLink(a){return h('a',{className:'calendar-activity',text:'Activitat · '+a.name,
  attrs:{href:'#/activitats/'+a.id},on:{click:event=>{event.preventDefault();routes.go({page:'activitats',path:[a.id]});}}});}
 function render(){
  const controls=h('div',{className:'calendar-toolbar'},h('h2',{text:'Calendari i tasques'}),
   button('←',()=>{date=navigateDate(date,view,-1);return refresh();},{attrs:{'aria-label':'Període anterior'}}),
   button('Hui',()=>{date=today();return refresh();}),
   button('→',()=>{date=navigateDate(date,view,1);return refresh();},{attrs:{'aria-label':'Període següent'}}),
   h('input',{attrs:{type:'date',value:date,'aria-label':'Selecciona una data'},on:{change:event=>{date=event.target.value||today();void refresh();}}}),
   h('select',{attrs:{'aria-label':'Vista del calendari'},on:{change:event=>{view=event.target.value;store();void refresh();}}},
    ...[['month','Mes'],['week','Setmana'],['day','Dia'],['list','Llista']].map(([value,label])=>{
     const node=option(value,label);node.selected=value===view;return node;})),
   button('+ Nova tasca',()=>form(null,date),{className:'btn btn-primary'}));
  const filters=h('select',{attrs:{'aria-label':'Filtra les tasques'},on:{change:event=>{filter=event.target.value;void refresh();}}},
   ...[['mine','Les meues'],['today','Hui'],['upcoming','Pròximes'],['shared','Compartides'],['completed','Completades'],
    ...(me.capabilities.tasks.sectionRead?[['section','Secció']]:[]),...(me.capabilities.tasks.groupRead?[['group','Grup']]:[])].map(([value,label])=>{
     const node=option(value,label);node.selected=value===filter;return node;}));
  const reminders=h('p',{className:'calendar-reminders',text:`Hui: ${summary.today??0} · Vençudes: ${summary.overdue??0} · Assignades pendents: ${summary.assigned??0}`});
  const days=calendarDays(date,view),grid=h('div',{className:'calendar-grid calendar-'+view});
  if(view!=='list')for(const value of days){
   const dayTasks=tasks.filter(t=>t.dueDate===value),dayEvents=events.filter(a=>activityDate(a)===value);
   grid.append(h('section',{className:'calendar-day'+(value===today()?' is-today':'')+(value===date?' is-selected':'')},
    button(dateLabel(value),()=>{date=value;render();},{className:'calendar-date',attrs:{'aria-current':value===today()?'date':null}}),
    ...dayTasks.slice(0,view==='month'?2:8).map(t=>button((t.status==='COMPLETED'?'✓ ':'')+t.title,()=>detail(t.id),
      {className:'calendar-task'+(t.visibility==='PERSONAL'?' personal':' shared'),attrs:{title:taskKind(t)}})),
    ...dayEvents.slice(0,2).map(eventLink),
    dayTasks.length>(view==='month'?2:8)?h('span',{text:`+${dayTasks.length-(view==='month'?2:8)} tasques`}):null,
    button('+',()=>form(null,value),{attrs:{'aria-label':'Nova tasca el '+dateLabel(value)},className:'calendar-add'})));
  }
  const visible=view==='list'?tasks:tasks.filter(t=>t.dueDate===date);
  const selected=h('section',{className:'calendar-selected'},h('h3',{text:view==='list'?'Tasques':dateLabel(date)}),
   visible.length?h('ul',{className:'task-list'},...visible.sort((a,b)=>(a.dueDate||'9999').localeCompare(b.dueDate||'9999')).map(row)):
     h('p',{text:'Cap tasca en aquesta vista.'}),...(view==='list'?[]:events.filter(a=>activityDate(a)===date).map(eventLink)));
  root.replaceChildren(controls,reminders,filters,grid,selected);
 }
 function dialog(title){
  const opener=document.activeElement,node=h('dialog',{className:'task-dialog'},h('h2',{text:title}));
  const close=()=>{node.close();node.remove();dialogs.delete(node);if(opener?.isConnected)opener.focus();};
  node.addEventListener('cancel',event=>{event.preventDefault();close();});
  node.append(button('Tanca',close,{className:'btn btn-secondary'}));document.body.append(node);dialogs.add(node);node.showModal();
  return {node,close};
 }
 async function showError(error){const {node}=dialog('No s’ha pogut completar');node.append(h('p',{text:errorText(error),attrs:{role:'alert'}}));}
 async function detail(id){
  const mine=epoch;
  try {const data=await call('/api/tasks/'+id);if(mine!==epoch||!me)return;
   const t=data.task,{node,close}=dialog(t.title);
   node.append(h('p',{text:t.description||'Sense descripció'}),h('p',{text:[taskKind(t),t.dueDate?dateLabel(t.dueDate):'Sense data',t.dueTime,
    t.status==='COMPLETED'?'Completada':'Pendent',t.recurrence?'Recurrent':null].filter(Boolean).join(' · ')}),
    h('p',{text:t.members.map(m=>m.name+(m.responsible?' · responsable':'')).join(', ')}));
   if(data.actions.edit)node.append(button('Edita',()=>{close();return form(t,t.dueDate);}));
   if(data.actions.complete)node.append(button(t.status==='COMPLETED'?'Reobri':'Completa',async()=>{try{await change(t,t.status==='COMPLETED'?'reopen':'complete');close();}
    catch(error){node.append(h('p',{text:errorText(error),attrs:{role:'alert'}}));}}));
   if(data.actions.edit)node.append(button('Arxiva',async()=>{if(!window.confirm('Vols arxivar aquesta tasca?'))return;
    try{await change(t,'archive');close();}catch(error){node.append(h('p',{text:errorText(error),attrs:{role:'alert'}}));}}));
  }catch(error){if(me)await showError(error);}
 }
 async function form(task,defaultDate){
  const {node,close}=dialog(task?'Edita la tasca':'Nova tasca'),notice=h('p',{attrs:{role:'status'}}),requestKey=crypto.randomUUID();
  const title=h('input',{attrs:{name:'title',value:task?.title||'',required:true,maxlength:160}});
  const visibility=h('select',{attrs:{name:'visibility'}},option('PERSONAL','Personal'),option('NAMED','Persones concretes'),
   ...(me.capabilities.tasks.sectionManage?[option('SECTION','Equip de secció')]:[]),...(me.capabilities.tasks.groupManage?[option('GROUP','Grup')]:[]));
  visibility.value=task?.visibility||'PERSONAL';
  const section=h('select',{attrs:{name:'sectionId','aria-label':'Secció'}},option('','Tria una secció'),...me.capabilities.sections.map(s=>option(s.id,s.code)));
  section.value=task?.sectionId||'';
  const members=h('div',{className:'task-members'});let usersToken=0;
  async function updatePeople(){
   const mine=++usersToken;section.hidden=visibility.value!=='SECTION';members.replaceChildren();
   if(visibility.value==='PERSONAL'||(visibility.value==='SECTION'&&!section.value))return;
   try{const params=new URLSearchParams({visibility:visibility.value,...(section.value&&visibility.value==='SECTION'?{sectionId:section.value}:{})});
    const data=await call('/api/tasks/users?'+params);if(mine!==usersToken||!node.isConnected)return;
    members.append(h('p',{text:'Comparteix amb / responsables (opcionales per a secció o grup):'}),...data.users.map(u=>{
     const shared=h('input',{attrs:{type:'checkbox',name:'member',value:u.id}}),responsible=h('input',{attrs:{type:'checkbox',name:'responsible',value:u.id}});
     shared.checked=task?.members.some(m=>m.userId===u.id)||false;responsible.checked=task?.members.some(m=>m.userId===u.id&&m.responsible)||false;
     return h('div',{className:'task-member'},h('label',{},shared,u.name),h('label',{},responsible,'Responsable'));
    }));
   }catch(error){notice.textContent=errorText(error);}
  }
  visibility.addEventListener('change',()=>void updatePeople());section.addEventListener('change',()=>void updatePeople());
  const recurrence=h('select',{attrs:{name:'recurrence'}},option('','No es repeteix'),option('DAILY','Cada dia'),option('WEEKLY','Cada setmana'),option('MONTHLY','Cada mes'));
  recurrence.value=task?.recurrence||'';
  let busy=false;
  const formNode=h('form',{on:{submit:async event=>{
   event.preventDefault();if(busy)return;busy=true;
   const data=new FormData(event.currentTarget),selected=new Set(data.getAll('member')),responsible=new Set(data.getAll('responsible'));
   for(const id of responsible)selected.add(id);
   const value={title:data.get('title'),description:data.get('description'),visibility:data.get('visibility'),
    sectionId:data.get('visibility')==='SECTION'?data.get('sectionId'):null,dueDate:data.get('dueDate')||null,dueTime:data.get('dueTime')||null,
    recurrence:data.get('recurrence')||null,members:data.get('visibility')==='PERSONAL'?[]:[...selected].map(userId=>({userId,responsible:responsible.has(userId)})),
    ...(task?{expectedVersion:task.version}:{requestKey})};
   try{await call(task?'/api/tasks/'+task.id:'/api/tasks',{method:task?'PATCH':'POST',body:JSON.stringify(value)});close();await refresh();}
   catch(error){notice.textContent=errorText(error);}finally{busy=false;}
  }}},h('label',{text:'Títol '},title),h('details',{},h('summary',{text:'Data, persones i repetició'}),
   h('label',{text:'Descripció '},h('textarea',{attrs:{name:'description',maxlength:2000},text:task?.description||''})),
   h('label',{text:'Data '},h('input',{attrs:{type:'date',name:'dueDate',value:task?.dueDate||defaultDate||''}})),
   h('label',{text:'Hora '},h('input',{attrs:{type:'time',name:'dueTime',value:task?.dueTime||''}})),
   h('label',{text:'Visibilitat '},visibility),section,members,h('label',{text:'Repetició '},recurrence)),
   button('Guarda',null,{type:'submit',className:'btn btn-primary'}),notice);
  node.prepend(formNode);await updatePeople();title.focus();
 }
 function unload(){epoch++;me=null;tasks=[];events=[];root.replaceChildren();for(const d of dialogs){d.close();d.remove();}dialogs.clear();}
 return {load,unload};
}
