import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import worker from '../gestio/worker.js';
import {newSession} from '../gestio/src/auth.js';
import {createObligation,listRounds,openFeeIssue,submitFee} from '../gestio/src/services/annual-fee-service.js';
import {feeMetrics} from '../gestio/src/services/annual-fee-metrics.js';
import {scopedFeeStatus} from '../gestio/src/services/annual-fee-status.js';
import {setupFeeStatus} from '../gestio/public/fee-status.js';
import {setupFees} from '../gestio/public/fees.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const migrations=join(root,'gestio/migrations');

function fixture(){
  const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
  for(const name of readdirSync(migrations).filter(name=>name.endsWith('.sql')).sort())
    sql.exec(readFileSync(join(migrations,name),'utf8'));
  sql.exec(readFileSync(join(root,'gestio/seed.sql'),'utf8'));
  const db={
    prepare(query){let params=[];const statement={bind(...values){params=values;return statement},
      async first(){return sql.prepare(query).get(...params)??null},
      async all(){return {results:sql.prepare(query).all(...params)}},
      async run(){return {meta:{changes:sql.prepare(query).run(...params).changes}}},
      execute(){return sql.prepare(query).run(...params)}};return statement},
    async batch(statements){sql.exec('BEGIN');try{const result=statements.map(statement=>statement.execute());sql.exec('COMMIT');return result}
      catch(error){sql.exec('ROLLBACK');throw error}}
  };
  const context={};const token={};
  return {sql,db,context,token,async login(number){
    token[number]=(await newSession(db,id(number))).token;
    const session=sql.prepare('SELECT id FROM app_session WHERE user_id=? ORDER BY created_at DESC LIMIT 1').get(id(number));
    context[number]={userId:id(number),sessionId:session.id,status:'ACTIVE'};
  },async request(number,path,{method='GET',body}={}){
    const response=await worker.fetch(new Request('http://127.0.0.1:8788'+path,{method,
      headers:{Cookie:`gestio_session=${token[number]}`,...(body?{Origin:'http://127.0.0.1:8788','Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{})}),{DB:db,APP_ENV:'development',DEV_IDENTITY_PROVIDER:'enabled'});
    return {status:response.status,data:await response.json()};
  },close(){sql.close()}};
}

test('scoped basic endpoint uses current section and returns only four safe fields',async()=>{
  const f=fixture();try{
    for(const number of [102,103,104])await f.login(number);
    for(const number of [501,502,503,504,505])await createObligation(f.db,f.context[104],crypto.randomUUID(),
      {roundId:id(901),participantId:id(number)});
    const tropa=await f.request(102,'/api/fees/status');
    assert.equal(tropa.status,200);
    assert.deepEqual(tropa.data.statuses.map(row=>row.participantId),[id(502),id(503)]);
    for(const row of tropa.data.statuses){
      assert.deepEqual(Object.keys(row).sort(),['displayName','participantId','sectionCode','status']);
      assert.equal(row.sectionCode,'TROPA');assert.equal(row.status,'PENDING');
    }
    assert.deepEqual(tropa.data.rounds.map(round=>Object.keys(round).sort()),[['code','id']]);
    assert.doesNotMatch(JSON.stringify(tropa.data),/amount|cents|payment|evidence|allocation|iban|bank|verified|reference/i);
    assert.deepEqual((await f.request(102,`/api/fees/status?sectionId=${id(3)}`)).data.statuses,
      tropa.data.statuses,'a client-side section parameter cannot widen server scope');
    assert.equal((await f.request(103,'/api/fees/status')).data.statuses[0].participantId,id(504));
    assert.equal((await f.request(102,`/api/fees/status?roundId=${id(999)}`)).status,404);
  }finally{f.close()}
});

test('multiple section roles intersect server scope; changing section removes historical access',async()=>{
  const f=fixture();try{
    for(const number of [102,103,104])await f.login(number);
    for(const number of [501,502,503,504,505])await createObligation(f.db,f.context[104],crypto.randomUUID(),
      {roundId:id(901),participantId:id(number)});
    f.sql.prepare(`INSERT INTO user_role(id,user_id,role_code,section_id,valid_from,justification)
      VALUES(?,?,?,?,?,?)`).run(id(990),id(102),'SECTION_COORDINATOR',id(3),1700000000000,'Segona secció de prova');
    let rows=(await scopedFeeStatus(f.db,f.context[102],crypto.randomUUID())).statuses;
    assert.deepEqual(rows.map(row=>row.participantId).sort(),[id(502),id(503),id(504)].sort());
    assert.ok(rows.every(row=>['TROPA','ESCOLTA'].includes(row.sectionCode)));
    f.sql.prepare('DELETE FROM user_role WHERE id=?').run(id(990));
    f.sql.prepare('UPDATE participant SET current_section_id=? WHERE id=?').run(id(3),id(502));
    rows=(await scopedFeeStatus(f.db,f.context[102],crypto.randomUUID())).statuses;
    assert.deepEqual(rows.map(row=>row.participantId),[id(503)]);
    assert.ok((await scopedFeeStatus(f.db,f.context[103],crypto.randomUUID())).statuses.some(row=>row.participantId===id(502)));
  }finally{f.close()}
});

test('basic read grants no financial actions; treasury and global coordination retain finance',async()=>{
  const f=fixture();try{
    for(const number of [101,102,104,105])await f.login(number);
    const obligation=(await createObligation(f.db,f.context[104],crypto.randomUUID(),
      {roundId:id(901),participantId:id(502)})).id;
    const issue=(await openFeeIssue(f.db,f.context[104],crypto.randomUUID(),
      {obligationId:obligation,code:'DISCREPANCY'})).id;
    const pdf=Buffer.from('%PDF-1.4\nsynthetic scoped fee status test\n%%EOF');
    const storage={put:async()=>{},delete:async()=>{}};
    const payment=(await submitFee(f.db,storage,{roundCode:'2026/2027',
      children:[{name:'Participante Tropa A (ficticio)',birthDate:'2013-05-18',sectionCode:'TROPA'}],
      submittedByName:'Família de prova',contactPhone:null,receiptEmail:'status-test@example.test',
      declaredAmountCents:10000,privacyAcknowledged:true,
      privacyNoticeVersion:'DEMO-3B-PRIVACY-NOTICE-V1',idempotencyKey:crypto.randomUUID().replaceAll('-',''),
      evidence:{filename:'prova.pdf',mime:'application/pdf',dataBase64:pdf.toString('base64')}},crypto.randomUUID())).reference;
    for(const path of ['/api/fees/rounds',`/api/fees/rounds/${id(901)}/obligations`,
      `/api/fees/rounds/${id(901)}/metrics`,`/api/fees/rounds/${id(901)}/payments`])
      assert.equal((await f.request(102,path)).status,403,path);
    for(const [path,method,body] of [
      ['/api/fees/obligations','POST',{roundId:id(901),participantId:id(503)}],
      [`/api/fees/obligations/${obligation}`,'PATCH',{amountDueCents:9000}],
      [`/api/fees/issues/${issue}/resolve`,'POST',{}],
      [`/api/fees/payments/${payment}/review`,'POST',{verifiedAmountCents:10000,allocations:[{obligationId:obligation,amountCents:10000}]}],
      ['/api/fees/rounds','POST',{code:'2027/2028'}]
    ])assert.equal((await f.request(102,path,{method,body})).status,403,path);
    assert.equal((await f.request(105,'/api/fees/status')).status,403);
    assert.equal((await f.request(101,'/api/fees/rounds')).status,200);
    assert.equal((await f.request(104,'/api/fees/rounds')).status,200);
    assert.equal((await listRounds(f.db,f.context[104],crypto.randomUUID())).length,1);
    assert.equal((await feeMetrics(f.db,f.context[101],crypto.randomUUID(),id(901))).collectedPercent,0);
  }finally{f.close()}
});

test('migration grants existing scoped coordinators only, and fresh seed remains compatible with historical 3B',()=>{
  const sql=new DatabaseSync(':memory:');try{
    sql.exec('PRAGMA foreign_keys=ON');
    for(const name of readdirSync(migrations).filter(name=>name.endsWith('.sql') && name<'0010_').sort())
      sql.exec(readFileSync(join(migrations,name),'utf8'));
    sql.exec(readFileSync(join(root,'gestio/seed.sql'),'utf8'));
    assert.equal(sql.prepare("SELECT count(*) n FROM user_permission_grant WHERE permission_code='finance.fee.status.read'").get().n,0);
    sql.exec(readFileSync(join(migrations,'0010_scoped_fee_status.sql'),'utf8'));
    const ids=sql.prepare("SELECT user_id FROM user_permission_grant WHERE permission_code='finance.fee.status.read' ORDER BY user_id").all().map(row=>row.user_id);
    assert.deepEqual(ids,[id(102),id(103)]);
    assert.equal(sql.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{sql.close()}
});

test('scoped Quotes renders only human status labels and read-only controls',async()=>{
  class NodeStub{
    constructor(){this.children=[];this.hidden=true;this.listeners={};this._text='';this.value=''}
    append(...children){this.children.push(...children)}
    replaceChildren(...children){this.children=children;this._text=''}
    addEventListener(event,listener){this.listeners[event]=listener}
    set textContent(value){this._text=String(value);this.children=[]}
    get textContent(){return this._text+this.children.map(child=>child.textContent).join(' ')}
  }
  const previous=globalThis.document;
  const nodes=new Map();
  globalThis.document={getElementById:key=>{if(!nodes.has(key))nodes.set(key,new NodeStub());return nodes.get(key)},
    createElement:()=>new NodeStub()};
  try{
    const load=setupFeeStatus({call:async()=>({rounds:[{id:id(901),code:'2026/2027'}],selectedRoundId:id(901),
      statuses:[{participantId:id(502),displayName:'Participant de prova',sectionCode:'TROPA',status:'PAID',amountDueCents:999999}]})});
    assert.equal(await load(),true);
    assert.equal(nodes.get('feeStatusPanel').hidden,false);
    assert.match(nodes.get('feeStatusList').textContent,/Participant de prova · Tropa.*Pagada/);
    assert.doesNotMatch(nodes.get('feeStatusList').textContent,/PAID|TROPA|999999|€|assignaci|justificant/);
    assert.deepEqual([...nodes.keys()].sort(),['feeStatusList','feeStatusPanel','feeStatusRound','reloadFeeStatus']);
  }finally{globalThis.document=previous}
});

test('loss of financial permission clears previously rendered financial details',async()=>{
  class NodeStub{
    constructor(){this.children=[];this.hidden=false;this._text='';this.value='sensitive';this.listeners={}}
    replaceChildren(...children){this.children=children;this._text=''}
    addEventListener(event,listener){this.listeners[event]=listener}
    reset(){this.value=''}
    set textContent(value){this._text=String(value);this.children=[]}
    get textContent(){return this._text}
  }
  const previous=globalThis.document;const nodes=new Map();
  globalThis.document={getElementById:key=>{if(!nodes.has(key))nodes.set(key,new NodeStub());return nodes.get(key)},
    createElement:()=>new NodeStub()};
  try{
    const load=setupFees({call:async()=>{throw Object.assign(new Error('forbidden'),{status:403})},message:()=>{}});
    document.getElementById('feeMetrics').textContent='Import verificat 100 €';
    document.getElementById('feePaymentDetail').textContent='Justificant bancari';
    document.getElementById('feeRound').replaceChildren(new NodeStub());
    assert.equal(await load(),false);
    assert.equal(nodes.get('feePanel').hidden,true);
    assert.equal(nodes.get('feeMetrics').textContent,'');
    assert.equal(nodes.get('feePaymentDetail').textContent,'');
    assert.equal(nodes.get('feeRound').children.length,0);
  }finally{globalThis.document=previous}
});
