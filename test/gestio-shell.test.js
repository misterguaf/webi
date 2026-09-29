import assert from 'node:assert/strict';
import { test } from 'node:test';

class NodeStub {
  constructor(id='') {
    this.id=id;this.hidden=true;this.dataset={};this.attributes=new Map();this.listeners=new Map();this.children=[];
    const classes=new Set();
    this.classList={add(name){classes.add(name)},remove(name){classes.delete(name)},
      toggle(name,force){if(force===undefined? !classes.has(name):force)classes.add(name);else classes.delete(name)},
      contains(name){return classes.has(name)}};
  }
  addEventListener(name,listener) {this.listeners.set(name,listener);}
  setAttribute(name,value) {this.attributes.set(name,String(value));}
  removeAttribute(name) {this.attributes.delete(name);}
  append(...children) {this.children.push(...children);}
  replaceChildren(...children) {this.children=children;}
  querySelector() {return new NodeStub();}
  focus() {}
  scrollIntoView() {}
  reset() {this.resetCount=(this.resetCount||0)+1;}
}

test('shell guards unavailable controls, closed activities and invalid payment reviews', async () => {
  const nodes=new Map();
  const node=id=>{if(!nodes.has(id))nodes.set(id,new NodeStub(id));return nodes.get(id);};
  const observers=new Map();
  const routeButtons=[];
  let meSucceeds=false;
  let fixture='none';
  let paymentStatus='ISSUE';
  const themes=['system','light','dark'].map(choice=>{const button=new NodeStub();button.dataset.themeChoice=choice;return button;});
  const emptyStates=new Map(['activitats','inscripcions','quotes','participants'].map(page=>[page,new NodeStub(page)]));
  const original={document:globalThis.document,window:globalThis.window,localStorage:globalThis.localStorage,
    MutationObserver:globalThis.MutationObserver,fetch:globalThis.fetch};
  try {
    globalThis.document={
      body:new NodeStub('body'),documentElement:new NodeStub('html'),
      getElementById:node,
      createElement:()=>{const element=new NodeStub();routeButtons.push(element);return element;},
      querySelector:selector=>emptyStates.get(selector.match(/data-shell-empty-for="([^"]+)"/)?.[1]),
      querySelectorAll:selector=>selector==='[data-theme-choice]'?themes:selector==='[data-route]'?routeButtons:[],
      addEventListener(){}
    };
    globalThis.window={matchMedia:()=>({matches:false,addEventListener(){}}),scrollTo(){}};
    globalThis.localStorage={getItem:()=>null,setItem(){}};
    globalThis.fetch=async path=>{
      const identities=path==='/api/dev/identities';
      const me=path==='/api/me'&&meSucceeds;
      const activities=fixture==='ui'&&path==='/api/activities';
      const activity=fixture==='ui'&&path==='/api/activities/closed-activity';
      const payments=fixture==='ui'&&path==='/api/payments';
      return {ok:identities||me||activities||activity||payments,status:identities||me||activities||activity||payments?200:401,
        json:async()=>identities?{identities:[]}:me?{user:{displayName:'Synthetic Coordinator',status:'ACTIVE'},roles:[{role_code:'GROUP_COORDINATOR'}],
          capabilities:{version:1,participants:{read:{all:true,sections:[]}},activities:{read:{all:true,sections:[]},manageGeneral:true},
            fees:{read:{all:true,sections:[]}},administration:{audit:true}}}:
          activities?{activities:[{id:'closed-activity',name:'Activitat sintètica',status:'CLOSED',audience:'GENERAL',sections:'',price_cents:0}]}:
            activity?{activity:{name:'Activitat sintètica',status:'CLOSED',audience:'GENERAL',sectionIds:[],location:'Lloc fictici',
              starts_at:Date.parse('2026-10-20T09:00:00Z'),ends_at:Date.parse('2026-10-20T17:00:00Z'),
              registration_deadline:Date.parse('2026-10-19T18:00:00Z'),price_cents:0,short_description:'',materials:'',special_notice:'',transportOptions:[]}}:
              payments?{payments:[{id:'synthetic-payment',activity_name:'Activitat sintètica',submitted_name:'Persona fictícia',
                review_status:paymentStatus,expected_amount_cents:1000}]}:{error:'unauthenticated',requestId:'synthetic-request'}};
    };
    globalThis.MutationObserver=class {
      constructor(callback){this.callback=callback;}
      observe(target){observers.set(target.id,this.callback);}
    };
    const shell=await import('../gestio/public/shell.js');
    assert.equal(node('openFeeIssues').hidden,true);
    assert.match(node('feeIssuesDescription').textContent,/no estan disponibles/);
    node('feePanel').hidden=false;
    observers.get('feePanel')();
    assert.equal(node('openFeeIssues').hidden,false);
    assert.match(node('feeIssuesDescription').textContent,/es consulten i es resolen en Quotes/);
    node('feePanel').hidden=true;
    observers.get('feePanel')();
    assert.equal(node('openFeeIssues').hidden,true);
    await import('../gestio/public/app.js');
    assert.equal(node('message').textContent||'', '', 'initial unsigned visit has no expiry message');
    shell.setShellSession({user:{displayName:'Synthetic Coordinator'},roles:[]});
    node('login').hidden=true;
    node('activityForm').hidden=false;
    await node('logout').listeners.get('click')();
    assert.equal(globalThis.document.body.classList.contains('shell-authenticated'),false);
    assert.equal(node('login').hidden,false);
    assert.equal(node('activityForm').hidden,true);
    assert.equal(node('message').textContent,'La sessió ha caducat. Torna a entrar.');
    meSucceeds=true;
    await node('retryShellData').listeners.get('click')();
    assert.equal(globalThis.document.body.classList.contains('shell-authenticated'),false,'expired session during refresh must leave the shell signed out');
    assert.equal(node('notificationPanel').hidden,true,'refresh must not reveal administration after a 401');
    fixture='ui';
    node('activitySections').options=[];
    await node('reloadActivities').listeners.get('click')();
    const activityRow=node('activityList').children[0];
    assert.equal(activityRow.children[0].textContent,'Consulta');
    await activityRow.children[0].listeners.get('click')();
    assert.equal(node('activityName').disabled,true);
    assert.equal(node('activitySave').hidden,true);
    assert.equal(node('activityClosedNotice').hidden,false);
    assert.match(node('activityFormTitle').textContent,/^Consulta:/);
    node('newActivity').listeners.get('click')();
    assert.equal(node('activityName').disabled,false);
    assert.equal(node('activitySave').hidden,false);
    assert.equal(node('activityClosedNotice').hidden,true);
    const visiblePaymentActions=()=>node('paymentList').children[0].children.filter(child=>child.listeners.has('click')).map(child=>child.textContent);
    await node('reloadPayments').listeners.get('click')();
    assert.deepEqual(visiblePaymentActions(),['Verifica'],'ISSUE cannot be marked as ISSUE again');
    paymentStatus='PENDING_REVIEW';
    await node('reloadPayments').listeners.get('click')();
    assert.deepEqual(visiblePaymentActions(),['Verifica','Incidència']);
    paymentStatus='VERIFIED';
    await node('reloadPayments').listeners.get('click')();
    assert.deepEqual(visiblePaymentActions(),[],'VERIFIED has no valid review transition');
  } finally {
    for(const [key,value] of Object.entries(original)){
      if(value===undefined)delete globalThis[key];else globalThis[key]=value;
    }
  }
});
