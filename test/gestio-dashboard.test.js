import assert from 'node:assert/strict';
import {test} from 'node:test';
import {attentionPhrase,basicFeeSummary,canReviewActivity,financialSummary,greeting,paymentAttention,registrationAttention,sectionLabel,
  upcomingActivities} from '../gestio/public/dashboard-model.js';
import {setupDashboard} from '../gestio/public/dashboard.js';

class NodeStub {
  constructor(id='') {this.id=id;this.hidden=false;this.children=[];this.listeners={};this.attributes={};this.style={};
    const classes=new Set();this.classList={add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name)};}
  append(...items){this.children.push(...items)}
  replaceChildren(...items){this.children=items}
  addEventListener(name,fn){this.listeners[name]=fn}
  setAttribute(name,value){this.attributes[name]=String(value)}
  click(){return this.listeners.click?.()}
  get textContent(){return this._text||this.children.map(item=>item.textContent||'').join(' ')}
  set textContent(value){this._text=String(value);this.children=[]}
}
const forbidden=()=>Object.assign(new Error('forbidden'),{status:403});
const failure=()=>Object.assign(new Error('server error'),{status:500});
const ALL={all:true,sections:[]};
const TROPA={all:false,sections:[{id:'00000000-0000-4000-8000-000000000002',code:'TROPA'}]};
// Shape of GET /api/me capabilities (version 1); omitted entries mean "not allowed".
const caps=({activities={},fees={}}={})=>({version:1,participants:{read:null},
  activities:{read:null,manage:null,manageGeneral:false,reviewRegistrations:null,verifyPayments:null,...activities},
  fees:{status:null,read:null,manage:null,reviewPayments:null,authorizeInstallments:null,configure:false,...fees},
  administration:{}});
const as=capabilities=>({user:{displayName:'Coordinació Demo (fictícia)'},capabilities});
const now=Date.now();
const activity=(id,name,section='TROPA',status='PUBLISHED')=>({id,name,status,audience:'SECTIONS',sections:section,
  starts_at:now+86400000,ends_at:now+2*86400000,registration_deadline:now+43200000});

function harness(responses){
  const nodes=new Map();const navigation=[];const opened=[];const calls=[];
  const original=globalThis.document;
  globalThis.document={getElementById:id=>{if(!nodes.has(id))nodes.set(id,new NodeStub(id));return nodes.get(id)},
    createElement:tag=>new NodeStub(tag)};
  const app=setupDashboard({call:async path=>{
    calls.push(path);
    const result=responses[path];if(result instanceof Error)throw result;
    if(result===undefined)throw forbidden();return result;
  },navigateTo:id=>navigation.push(id),openActivity:id=>opened.push(['activity',id]),
  openRegistrations:(id,filtered,name)=>opened.push(['registrations',id,filtered,name]),
  openPayments:()=>opened.push(['payments']),openFeeIssues:()=>opened.push(['fees'])});
  return {app,node:id=>nodes.get(id),opened,navigation,calls,restore:()=>{globalThis.document=original}};
}

test('dashboard model uses real states, human copy and useful upcoming activities',()=>{
  assert.equal(greeting('Borja Demo',new Date(2026,8,28,9)),'Bon dia, Borja.');
  assert.match(attentionPhrase(0),/Tot al dia/);
  assert.deepEqual(financialSummary({collectedPercent:43.43,statusCounts:{PAID:12,PARTIAL:5},issueCount:2}),
    {percent:43.43,paid:12,partial:5,issues:2});
  assert.equal(financialSummary(null),null);
  assert.deepEqual(basicFeeSummary([{status:'PAID'},{status:'PENDING'},{status:'ISSUE'}]),
    {PAID:1,PARTIAL:0,PENDING:1,ISSUE:1});
  assert.equal(sectionLabel(activity('a','Eixida')),'Tropa');
  const far={...activity('far','Molt lluny'),starts_at:now+400*86400000,ends_at:now+401*86400000};
  const rows=[activity('closed','Passada','TROPA','CLOSED'),activity('draft','Preparació','ESCOLTA','DRAFT'),
    activity('published','Pròxima','TROPA'),far];
  assert.deepEqual(upcomingActivities(rows,now).map(row=>row.id),['published','draft']);
  assert.deepEqual(registrationAttention(rows[2],[{status:'NEEDS_PARTICIPANT_REVIEW'},{status:'CONFIRMED'}]),
    {kind:'registrations',count:1,activityId:'published',activityName:'Pròxima',text:'1 inscripció per revisar · Pròxima'});
  assert.equal(paymentAttention([{review_status:'VERIFIED'}]),null);
  assert.doesNotMatch(registrationAttention(rows[2],[{status:'NEEDS_PARTICIPANT_REVIEW'}]).text,/PENDING_REVIEW|TROPA|[0-9a-f]{8}-/);
});

test('dashboard gives scoped users only basic fee counts and links to the read-only view',async()=>{
  const me=as(caps({activities:{read:TROPA},fees:{status:TROPA}}));
  const h=harness({'/api/activities':{activities:[]},'/api/fees/status':{rounds:[{id:'round',code:'2026/2027'}],
      statuses:[{participantId:'00000000-0000-4000-8000-000000000502',displayName:'Participant Demo',sectionCode:'TROPA',status:'PAID'},
        {participantId:'00000000-0000-4000-8000-000000000503',displayName:'Participant Dos',sectionCode:'TROPA',status:'ISSUE'}]}});
  try{
    await h.app.load(me);
    assert.equal(h.node('dashboardFeesPanel').hidden,false);
    assert.match(h.node('dashboardFeesTitle').textContent,/Quotes de les teues seccions/);
    assert.match(h.node('dashboardFees').textContent,/1 pagades.*1 incidències/);
    assert.doesNotMatch(h.node('dashboardFees').textContent,/€|%|cobrat|00000000|PAID|ISSUE|TROPA/);
    assert.equal(h.node('dashboardAttentionTitle').textContent,'Tot al dia');
    await h.node('dashboardSeeFees').click();
    assert.deepEqual(h.navigation,['quotes']);
    assert.deepEqual(h.calls.sort(),['/api/activities','/api/fees/status'],'no probing of forbidden finance or payments');
  }finally{h.restore()}
});

test('scoped fee failure remains local and does not imply Tot al dia',async()=>{
  const me=as(caps({activities:{read:TROPA},fees:{status:TROPA}}));
  const h=harness({'/api/activities':{activities:[]},'/api/fees/status':failure()});
  try{
    await h.app.load(me);
    assert.match(h.node('dashboardFees').textContent,/No s’ha pogut carregar/);
    assert.notEqual(h.node('dashboardAttentionTitle').textContent,'Tot al dia');
  }finally{h.restore()}
});

test('dashboard uses scoped server rows, omits forbidden finance, and keeps creation hidden without manage capability',async()=>{
  const me=as(caps({activities:{read:TROPA,reviewRegistrations:TROPA}}));
  const h=harness({'/api/activities':{activities:[activity('tropa','Eixida Tropa')]},
    '/api/activities/tropa/registrations':{registrations:[{status:'NEEDS_PARTICIPANT_REVIEW'}]}});
  try{
    await h.app.load(me);
    assert.equal(h.node('dashboardFeesPanel').hidden,true);
    assert.equal(h.node('dashboardNewActivity').hidden,true);
    assert.match(h.node('dashboardActivities').textContent,/Eixida Tropa/);
    assert.doesNotMatch(h.node('dashboardActivities').textContent,/Escolta|quota|PENDING_REVIEW/);
    assert.match(h.node('dashboardPhrase').textContent,/una cosa/);
    await h.node('dashboardAttention').children[0].children[0].click();
    assert.deepEqual(h.opened,[['registrations','tropa',true,'Eixida Tropa']]);
    assert.ok(!h.calls.some(path=>path.startsWith('/api/fees')||path==='/api/payments'));
  }finally{h.restore()}
});

test('dashboard shows creation from capabilities, independent fee metric and local errors',async()=>{
  const me=as(caps({activities:{read:ALL,manageGeneral:true,reviewRegistrations:ALL,verifyPayments:ALL},fees:{read:ALL}}));
  const general={...activity('general','Jornada Demo'),audience:'GENERAL',sections:''};
  const metrics={collectedPercent:82,statusCounts:{PAID:32,PARTIAL:5},issueCount:3};
  const h=harness({'/api/activities':{activities:[general]},'/api/activities/general/registrations':{registrations:[]},
    '/api/activities/general':{activity:general},'/api/payments':failure(),
    '/api/fees/rounds':{rounds:[{id:'round',code:'demo'}]},
    '/api/fees/rounds/round/metrics':{metrics},'/api/fees/rounds/round/issues':{issues:[]}});
  try{
    await h.app.load(me);
    assert.equal(h.node('dashboardNewActivity').hidden,false);
    assert.equal(h.node('dashboardFeesPanel').hidden,false);
    assert.match(h.node('dashboardFees').textContent,/82%.*cobrat/);
    assert.match(h.node('dashboardAttention').textContent,/No s’han pogut comprovar/);
    assert.doesNotMatch(h.node('dashboardAttention').textContent,/Tot al dia|server error/);
    await h.node('dashboardNewActivity').click();
    assert.deepEqual(h.navigation,['activitats']);
    assert.ok(!h.calls.includes('/api/activities/general'),'no detail read is used as a capability heuristic');
  }finally{h.restore()}
});

test('dashboard reaches Tot al dia for a genuinely empty successful review state',async()=>{
  const me=as(caps({activities:{read:TROPA,reviewRegistrations:TROPA,verifyPayments:TROPA}}));
  const h=harness({'/api/activities':{activities:[]},'/api/payments':{payments:[]}});
  try{
    await h.app.load(me);
    assert.equal(h.node('dashboardAttentionTitle').textContent,'Tot al dia');
    assert.match(h.node('dashboardAttention').textContent,/No tens cap acció pendent/);
    assert.match(h.node('dashboardActivities').textContent,/No hi ha cap activitat pròxima/);
  }finally{h.restore()}
});

test('activity failure stays local while authoritative finance still renders',async()=>{
  const me=as(caps({activities:{read:ALL},fees:{read:ALL}}));
  const h=harness({'/api/activities':failure(),
    '/api/fees/rounds':{rounds:[{id:'round'}]},
    '/api/fees/rounds/round/metrics':{metrics:{collectedPercent:25,statusCounts:{PAID:1,PARTIAL:0},issueCount:0}},
    '/api/fees/rounds/round/issues':{issues:[]}});
  try{
    await h.app.load(me);
    assert.match(h.node('dashboardActivities').textContent,/No s’han pogut carregar/);
    assert.equal(h.node('dashboardFeesPanel').hidden,false);
    assert.match(h.node('dashboardFees').textContent,/25%/);
    assert.notEqual(h.node('dashboardAttentionTitle').textContent,'Tot al dia');
  }finally{h.restore()}
});

test('a user without operational capabilities triggers no module requests (no AUTHZ_DENY noise)',async()=>{
  const h=harness({});
  try{
    await h.app.load(as(caps()));
    assert.deepEqual(h.calls,[]);
    assert.equal(h.node('dashboardActivitiesPanel').hidden,true);
    assert.equal(h.node('dashboardNewActivity').hidden,true);
    assert.equal(h.node('dashboardFeesPanel').hidden,true);
  }finally{h.restore()}
});

test('section manage capability alone shows creation; review scope mirrors server rules',()=>{
  assert.equal(canReviewActivity(activity('t','T'),TROPA),true);
  assert.equal(canReviewActivity(activity('e','E','ESCOLTA'),TROPA),false);
  assert.equal(canReviewActivity({...activity('g','G'),audience:'GENERAL',sections:''},TROPA),true);
  assert.equal(canReviewActivity(activity('e','E','ESCOLTA'),ALL),true);
  assert.equal(canReviewActivity(activity('t','T'),null),false);
});

test('registrations are requested only where the reviewer scope overlaps',async()=>{
  const me=as(caps({activities:{read:ALL,reviewRegistrations:TROPA}}));
  const h=harness({'/api/activities':{activities:[activity('tropa','Eixida Tropa'),activity('escolta','Acampada Escolta','ESCOLTA')]},
    '/api/activities/tropa/registrations':{registrations:[]}});
  try{
    await h.app.load(me);
    assert.match(h.node('dashboardActivities').textContent,/Acampada Escolta/);
    assert.deepEqual(h.calls.sort(),['/api/activities','/api/activities/tropa/registrations']);
  }finally{h.restore()}
});
