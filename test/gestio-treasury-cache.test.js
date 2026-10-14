import test from 'node:test';
import assert from 'node:assert/strict';
import {createTreasuryView} from '../gestio/public/views/treasury.js';

// Small DOM for exercising the real controller and duplicate-confirmation flow without a browser dependency.
class Node {
 constructor(tag='div'){this.tag=tag;this.children=[];this.attributes=new Map();this.dataset={};this.events={};this.className='';this.style={};this.ownText='';}
 get textContent(){return this.ownText+this.children.map(n=>n.textContent??String(n)).join('');}
 set textContent(value){this.ownText=value;this.children=[];}
 get isConnected(){return !!this.parent||this===document.body;}
 append(...nodes){for(const node of nodes.flat()){if(node?.parent)node.parent.children=node.parent.children.filter(n=>n!==node);if(typeof node==='object')node.parent=this;this.children.push(node);}}
 replaceChildren(...nodes){for(const node of this.children)if(typeof node==='object')node.parent=null;this.children=[];this.ownText='';this.append(...nodes);}
 setAttribute(key,value){this.attributes.set(key,String(value));if(key==='id')this.id=value;}
 getAttribute(key){return this.attributes.get(key)??null;}
 removeAttribute(key){this.attributes.delete(key);}
 addEventListener(key,fn){this.events[key]=fn;}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);this.parent=null;}
 focus(){document.activeElement=this;}
 get classList(){return {add:()=>{},remove:()=>{},contains:()=>false};}
 querySelectorAll(selector){const all=[];for(const n of this.children)if(n instanceof Node){all.push(n,...n.querySelectorAll('*'));}if(selector==='*')return all;return all.filter(n=>selector.startsWith('.')?n.className.split(' ').includes(selector.slice(1).split('[')[0]):n.tag===selector);}
 querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
}
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');

test('split movements refetch the list and counters after confirmed review, keep selection, and never reuse another detail',async()=>{
 const previous=globalThis.document,previousMedia=globalThis.matchMedia;
 const body=new Node('body'),root=new Node();body.dataset.page='tresoreria';body.append(root);
 globalThis.document={body,activeElement:null,title:'',createElement:tag=>new Node(tag),createElementNS:(_,tag)=>new Node(tag),
  getElementById:key=>key==='treasuryView'?root:body.querySelectorAll('*').find(n=>n.id===key)??null,
  addEventListener:()=>{},removeEventListener:()=>{},querySelector:s=>body.querySelector(s)};
 globalThis.matchMedia=()=>({matches:true});
 let changed=false,reads=0;const badges=[];
 const movement=n=>({id:id(n),label:n===1?'Primer moviment':'Segon moviment',amountCents:1000,operationDate:'2026-10-14',
  positionName:'Banc fictici',positionKind:'BANK',state:'ACTIVE',status:n===1&&!changed?'POSSIBLE_DUPLICATE':'CLASSIFIED',
  reviewFlag:n===1&&!changed,reviewVersion:0,allocatedCents:1000,unallocatedCents:0,origin:'MANUAL'});
 const call=async(path,init)=>{
  if(path==='/api/finance/summary')return {movements:{pendingCount:0,duplicateCount:changed?0:1},positionOptions:[]};
  if(path.startsWith('/api/finance/movements?')){reads++;return {movements:[movement(1),movement(2)]};}
  if(path.endsWith('/clear-review')){assert.equal(init.method,'POST');changed=true;return {};}
  const n=path.endsWith(id(1))?1:2;return {movement:movement(n),allocations:[],history:[],duplicateCandidates:[]};
 };
 const me={capabilities:{treasury:{read:true,readMovements:true,classifyMovements:true}}};
 const view=createTreasuryView({call,routes:{go:()=>{}},reportLoadError:error=>{throw error;},setPageHeader:()=>{},setNavBadge:(_,n)=>badges.push(n)});
 const route=n=>({path:['moviments',...(n?[id(n)]:[])],query:{}});
 try{
  await view.enter(me,route());assert.equal(reads,1);
  await view.enter(me,route(1));assert.equal(reads,1,'opening detail reuses the list');
  const action=root.querySelectorAll('button').find(n=>n.textContent==='És un moviment vàlid');assert.ok(action,root.textContent);
  action.focus();const pending=action.events.click({currentTarget:action});
  const confirm=body.querySelectorAll('button').find(n=>n.textContent==='Manté’l');assert.ok(confirm);confirm.events.click({currentTarget:confirm});
  await pending;
  assert.equal(changed,true);assert.equal(reads,2,'confirmed server change refetches the adjacent list');
  assert.equal(badges.at(-1),0,'duplicate count comes from refreshed summary');
  assert.equal(root.querySelectorAll('.tx-row').find(n=>n.dataset.id===id(1)).getAttribute('aria-current'),'true');
  assert.doesNotMatch(root.querySelector('.treasury-list-pane').textContent,/Possible duplicat/);
  await view.enter(me,route(2));assert.equal(reads,3,'invalidated cache is not reused on navigation');
  assert.match(root.querySelector('.treasury-detail-pane').textContent,/Segon moviment/);
  assert.doesNotMatch(root.querySelector('.treasury-detail-pane').textContent,/Primer moviment/);
  view.unload();assert.equal(root.textContent,'');
 }finally{globalThis.document=previous;globalThis.matchMedia=previousMedia;}
});
