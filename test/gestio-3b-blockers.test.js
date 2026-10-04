import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  authorizeInstallments, correctFamilyGroup, createFamilyGroup, createObligation,
  familyGroupRevisions, listFamilyGroups, listFamilyRounds, listRounds,
  feePaymentDetail, listFeePayments, openFeeIssue, resolveFeeIssue,
  reviewFeePayment, reviseFeeAllocations,
  submitFee, updateRound
} from '../gestio/src/services/annual-fee-service.js';
import { feeMetrics } from '../gestio/src/services/annual-fee-metrics.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const pdf=Buffer.from('%PDF-1.4\nsynthetic annual-fee blocker fixture\n%%EOF');
const evidence={filename:'justificant..pdf',mime:'application/pdf',dataBase64:pdf.toString('base64')};
const children=[
  {name:'Participante Manada A (ficticio)',birthDate:'2017-06-12',sectionCode:'MANADA'},
  {name:'Participante Tropa A (ficticio)',birthDate:'2013-05-18',sectionCode:'TROPA'},
  {name:'Participante Tropa B (ficticio)',birthDate:'2012-11-03',sectionCode:'TROPA'}
];

function fixture() {
  const sql=new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  for (const name of readdirSync(join(root,'gestio/migrations')).filter(name=>name.endsWith('.sql')).sort())
    sql.exec(readFileSync(join(root,'gestio/migrations',name),'utf8'));
  sql.exec(readFileSync(join(root,'gestio/seed.sql'),'utf8'));
  const contexts={};
  for (const number of [101,102,104,105,107]) {
    const session=crypto.randomUUID(),now=Date.now();
    sql.prepare(`INSERT INTO app_session(id,user_id,token_hash,created_at,last_seen_at,absolute_expires_at)
      VALUES(?,?,?,?,?,?)`).run(session,id(number),String(number).padStart(64,'a'),now,now,now+86_400_000);
    contexts[number]={userId:id(number),sessionId:session,status:'ACTIVE'};
  }
  let beforeBatch=null;
  const db={
    prepare(query) {
      let params=[];
      const statement={
        bind(...values) {params=values;return statement;},
        async first() {return sql.prepare(query).get(...params)??null;},
        async all() {return {results:sql.prepare(query).all(...params)};},
        async run() {return sql.prepare(query).run(...params);},
        execute() {return sql.prepare(query).run(...params);}
      };
      return statement;
    },
    async batch(statements) {
      if (beforeBatch) {const action=beforeBatch;beforeBatch=null;action();}
      sql.exec('BEGIN');
      try {const result=statements.map(statement=>statement.execute());sql.exec('COMMIT');return result;}
      catch(error) {sql.exec('ROLLBACK');throw error;}
    }
  };
  const objects=new Map();
  const storage={put:async(key,value)=>objects.set(key,value),delete:async key=>objects.delete(key),
    get:async key=>objects.get(key)??null};
  return {sql,db,contexts,storage,race(action){beforeBatch=action;},close(){sql.close();}};
}
const count=(sql,table)=>sql.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
const status=(sql,obligationId)=>sql.prepare('SELECT status FROM annual_fee_obligation_status WHERE id=?').get(obligationId).status;
const submission=(key=crypto.randomUUID().replaceAll('-',''))=>({roundCode:'2026/2027',children,
  submittedByName:'Família fictícia',contactPhone:null,receiptEmail:'fee-blocker@example.test',
  declaredAmountCents:25000,privacyAcknowledged:true,privacyNoticeVersion:'DEMO-3B-PRIVACY-NOTICE-V1',
  idempotencyKey:key,evidence});
async function obligations(f) {
  const group=await createFamilyGroup(f.db,f.contexts[104],crypto.randomUUID(),
    {roundId:id(901),reference:'DEMO-BLOCKERS-001',participantIds:[id(501),id(502),id(503),id(504)]});
  const result=new Map();
  for (const number of [501,502,503,504,505]) result.set(number,(await createObligation(f.db,f.contexts[104],
    crypto.randomUUID(),{roundId:id(901),participantId:id(number)})).id);
  return {groupId:group.id,ids:result};
}
async function payment(f,amounts) {
  const created=await submitFee(f.db,f.storage,submission(),crypto.randomUUID());
  await reviewFeePayment(f.db,f.contexts[104],crypto.randomUUID(),created.reference,
    {verifiedAmountCents:amounts.reduce((sum,row)=>sum+row.amountCents,0),allocations:amounts});
  return created.reference;
}

test('3B blocker: a payment issue suspends all funded PAID obligations until resolution',async()=>{
  const f=fixture();
  try {
    const {ids}=await obligations(f);
    const paymentId=await payment(f,[501,502,503].map(number=>
      ({obligationId:ids.get(number),amountCents:number===503?5000:10000})));
    for (const number of [501,502,503]) assert.equal(status(f.sql,ids.get(number)),'PAID');
    const issue=await openFeeIssue(f.db,f.contexts[104],crypto.randomUUID(),{paymentId,code:'BANK_NOT_FOUND'});
    for (const number of [501,502,503]) assert.equal(status(f.sql,ids.get(number)),'ISSUE');
    assert.throws(()=>f.sql.prepare(`UPDATE annual_fee_notification_outbox SET status='SENT'
      WHERE payment_id=? AND kind='FEE_PAYMENT_CONFIRMED'`).run(paymentId));
    await resolveFeeIssue(f.db,f.contexts[104],crypto.randomUUID(),issue.id);
    for (const number of [501,502,503]) assert.equal(status(f.sql,ids.get(number)),'PAID');
    f.sql.prepare(`UPDATE annual_fee_notification_outbox SET status='SENT'
      WHERE payment_id=? AND kind='FEE_PAYMENT_CONFIRMED'`).run(paymentId);
    assert.equal(count(f.sql,'annual_fee_issue'),1);
    assert.equal(f.sql.prepare('SELECT status FROM annual_fee_issue WHERE id=?').get(issue.id).status,'RESOLVED');
  } finally {f.close();}
});

test('3B blocker: prior issue notice cannot roll back a later overpayment review',async()=>{
  const f=fixture();
  try {
    const {ids}=await obligations(f);
    const created=await submitFee(f.db,f.storage,submission(),crypto.randomUUID());
    const prior=await openFeeIssue(f.db,f.contexts[104],crypto.randomUUID(),
      {paymentId:created.reference,code:'BANK_NOT_FOUND'});
    await reviewFeePayment(f.db,f.contexts[104],crypto.randomUUID(),created.reference,
      {verifiedAmountCents:26000,allocations:[{obligationId:ids.get(501),amountCents:11000},
        {obligationId:ids.get(502),amountCents:10000},{obligationId:ids.get(503),amountCents:5000}]});
    assert.equal(f.sql.prepare('SELECT review_status FROM annual_fee_payment WHERE id=?').get(created.reference).review_status,'VERIFIED');
    assert.equal(f.sql.prepare(`SELECT count(*) AS n FROM annual_fee_issue_outbox
      WHERE payment_id=?`).get(created.reference).n,2);
    await resolveFeeIssue(f.db,f.contexts[104],crypto.randomUUID(),prior.id);
    assert.equal(status(f.sql,ids.get(501)),'ISSUE');
    assert.equal(status(f.sql,ids.get(502)),'PAID');
  } finally {f.close();}
});

test('3B blocker: family order and membership correction is authorized, historical and allocation-safe',async()=>{
  const f=fixture();
  try {
    const {groupId,ids}=await obligations(f);
    await payment(f,[{obligationId:ids.get(501),amountCents:10000},
      {obligationId:ids.get(502),amountCents:5000},{obligationId:ids.get(503),amountCents:5000}]);
    const reordered=[id(502),id(503),id(501),id(504)];
    await assert.rejects(correctFamilyGroup(f.db,f.contexts[104],crypto.randomUUID(),groupId,
      {participantIds:reordered}),error=>error.code==='family_allocation_conflict');
    assert.equal(count(f.sql,'annual_fee_family_revision'),0);
    const next=[id(501),id(503),id(502),id(504),id(505)];
    await assert.rejects(correctFamilyGroup(f.db,f.contexts[107],crypto.randomUUID(),groupId,
      {participantIds:next}),error=>error.status===403);
    const corrected=await correctFamilyGroup(f.db,f.contexts[104],crypto.randomUUID(),groupId,
      {participantIds:next});
    const revision=(await familyGroupRevisions(f.db,f.contexts[104],crypto.randomUUID(),groupId))[0];
    assert.equal(revision.id,corrected.revisionId);
    assert.equal(revision.members.length,5);
    assert.equal(revision.members.find(row=>row.participant_id===id(502)).previous_amount_due_cents,10000);
    assert.equal(revision.members.find(row=>row.participant_id===id(502)).new_amount_due_cents,5000);
    assert.equal(revision.members.find(row=>row.participant_id===id(505)).previous_group_id,null);
    assert.equal(status(f.sql,ids.get(502)),'ISSUE');
    assert.equal(status(f.sql,ids.get(503)),'ISSUE');
    assert.equal(f.sql.prepare('SELECT amount_due_cents FROM annual_fee_obligation WHERE id=?').get(ids.get(505)).amount_due_cents,5000);
    const issues=f.sql.prepare(`SELECT id,obligation_id FROM annual_fee_issue WHERE code='DISCREPANCY'`).all();
    assert.equal(issues.length,2);
    assert.equal(f.sql.prepare(`SELECT count(*) AS n FROM annual_fee_issue_outbox n
      JOIN annual_fee_issue i ON i.id=n.issue_id WHERE i.code='DISCREPANCY'`).get().n,2);
    for (const issue of issues) await resolveFeeIssue(f.db,f.contexts[104],crypto.randomUUID(),issue.id);
    assert.equal(status(f.sql,ids.get(502)),'PAID');
    assert.equal(status(f.sql,ids.get(503)),'PARTIAL');
    await correctFamilyGroup(f.db,f.contexts[104],crypto.randomUUID(),groupId,
      {participantIds:[id(501),id(503),id(502),id(505)]});
    const removed=f.sql.prepare('SELECT family_group_id,amount_due_cents FROM annual_fee_obligation WHERE id=?')
      .get(ids.get(504));
    assert.equal(removed.family_group_id,null);
    assert.equal(removed.amount_due_cents,10000);
    assert.equal(count(f.sql,'annual_fee_family_revision'),2);
    assert.equal(f.sql.prepare('PRAGMA foreign_key_check').all().length,0);
  } finally {f.close();}
});

test('3B blocker: first explicit family group after obligations is atomic and keeps prior payments visible',async()=>{
  const f=fixture();
  try {
    const ids=new Map();
    for (const number of [501,502,503]) ids.set(number,(await createObligation(f.db,f.contexts[104],
      crypto.randomUUID(),{roundId:id(901),participantId:id(number)})).id);
    const paymentId=await payment(f,[{obligationId:ids.get(503),amountCents:10000}]);
    const input={roundId:id(901),reference:'DEMO-LATE-SIBLINGS-001',participantIds:[id(501),id(502),id(503)]};
    await assert.rejects(createFamilyGroup(f.db,f.contexts[104],crypto.randomUUID(),input),
      error=>error.code==='family_allocation_conflict');
    assert.equal(count(f.sql,'annual_fee_family_group'),0);
    await reviseFeeAllocations(f.db,f.contexts[104],crypto.randomUUID(),paymentId,
      {expectedVersion:1,allocations:[{obligationId:ids.get(501),amountCents:5000},
        {obligationId:ids.get(503),amountCents:5000}]});
    const created=await createFamilyGroup(f.db,f.contexts[104],crypto.randomUUID(),input);
    const revisions=await familyGroupRevisions(f.db,f.contexts[104],crypto.randomUUID(),created.id);
    assert.equal(revisions.length,1);
    assert.equal(revisions[0].members.find(row=>row.participant_id===id(503)).previous_group_id,null);
    assert.equal(revisions[0].members.find(row=>row.participant_id===id(503)).new_amount_due_cents,5000);
    assert.equal(status(f.sql,ids.get(503)),'ISSUE');
    const issue=f.sql.prepare(`SELECT id FROM annual_fee_issue WHERE obligation_id=? AND code='DISCREPANCY'`)
      .get(ids.get(503));
    await resolveFeeIssue(f.db,f.contexts[104],crypto.randomUUID(),issue.id);
    assert.equal(status(f.sql,ids.get(503)),'PAID');
    assert.equal(f.sql.prepare('PRAGMA foreign_key_check').all().length,0);
  } finally {f.close();}
});

test('3B blocker: lost round version race leaves no fictional revision or audit',async()=>{
  const f=fixture();
  try {
    f.race(()=>f.sql.prepare('UPDATE annual_fee_round SET version=version+1 WHERE id=?').run(id(901)));
    await assert.rejects(updateRound(f.db,f.contexts[104],crypto.randomUUID(),id(901),
      {baseCents:12000}),error=>error.status===409 && error.code==='stale_fee_round');
    assert.equal(count(f.sql,'annual_fee_round_revision'),0);
    assert.equal(f.sql.prepare("SELECT count(*) AS n FROM audit_event WHERE action='FEE_ROUND_UPDATED'").get().n,0);
    assert.equal(f.sql.prepare('SELECT base_cents FROM annual_fee_round WHERE id=?').get(id(901)).base_cents,10000);
  } finally {f.close();}
});

test('3B blocker: D1 rejects unverified allocations and malformed installment totals',async()=>{
  const f=fixture();
  try {
    const {ids}=await obligations(f);
    const paymentId=await payment(f,[{obligationId:ids.get(501),amountCents:10000}]);
    assert.throws(()=>f.sql.prepare('UPDATE annual_fee_payment SET verified_amount_cents=NULL WHERE id=?').run(paymentId));
    const plan=await authorizeInstallments(f.db,f.contexts[104],crypto.randomUUID(),ids.get(504),
      {parts:[{amountCents:2000},{amountCents:2000},{amountCents:1000}]});
    assert.equal(f.sql.prepare('SELECT count(*) AS n FROM annual_fee_installment_part WHERE plan_id=?').get(plan.id).n,3);
    assert.throws(()=>f.sql.prepare('UPDATE annual_fee_installment_part SET planned_cents=1000 WHERE plan_id=? AND ordinal=1').run(plan.id));
    assert.throws(()=>f.sql.prepare("UPDATE annual_fee_installment_plan SET status='DRAFT' WHERE id=?").run(plan.id));
    assert.throws(()=>f.sql.prepare('DELETE FROM annual_fee_installment_plan WHERE id=?').run(plan.id));
    assert.throws(()=>f.sql.prepare('UPDATE annual_fee_obligation SET amount_due_cents=6000 WHERE id=?').run(ids.get(504)));
    const malformed=crypto.randomUUID();
    f.sql.prepare(`INSERT INTO annual_fee_installment_plan
      (id,obligation_id,status,authorized_by,authorized_at) VALUES(?,?,'DRAFT',?,?)`)
      .run(malformed,ids.get(505),id(104),Date.now());
    f.sql.prepare('INSERT INTO annual_fee_installment_part(plan_id,ordinal,planned_cents) VALUES(?,?,?)')
      .run(malformed,1,1000);
    f.sql.prepare('INSERT INTO annual_fee_installment_part(plan_id,ordinal,planned_cents) VALUES(?,?,?)')
      .run(malformed,2,1000);
    assert.throws(()=>f.sql.prepare("UPDATE annual_fee_installment_plan SET status='ACTIVE' WHERE id=?").run(malformed));
    const corrected=await authorizeInstallments(f.db,f.contexts[104],crypto.randomUUID(),ids.get(504),
      {replacesPlanId:plan.id,reason:'Correcció autoritzada',parts:[{amountCents:1000},{amountCents:2000},{amountCents:2000}]});
    assert.equal(f.sql.prepare('SELECT status FROM annual_fee_installment_plan WHERE id=?').get(plan.id).status,'SUPERSEDED');
    assert.equal(f.sql.prepare('SELECT status FROM annual_fee_installment_plan WHERE id=?').get(corrected.id).status,'ACTIVE');
    assert.deepEqual(f.sql.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally {f.close();}
});

test('G.3: Secretary may manage explicit family grouping without gaining fee or section financial access',async()=>{
  const f=fixture();
  try {
    const request=()=>crypto.randomUUID();
    const rounds=await listFamilyRounds(f.db,f.contexts[105],request());
    assert.equal(rounds[0].id,id(901));
    const group=await createFamilyGroup(f.db,f.contexts[105],request(),
      {roundId:id(901),reference:'DEMO-FAMILY-SECRETARY',participantIds:[id(501),id(502)]});
    const visible=await listFamilyGroups(f.db,f.contexts[105],request(),id(901));
    assert.equal(visible.groups.length,2);
    assert.equal(visible.groups[0].id,group.id);
    await assert.rejects(listRounds(f.db,f.contexts[105],request()),error=>error.status===403);
    await assert.rejects(createObligation(f.db,f.contexts[105],request(),
      {roundId:id(901),participantId:id(503)}),error=>error.status===403);
    await assert.rejects(listFamilyRounds(f.db,f.contexts[102],request()),error=>error.status===403);
    await assert.rejects(listFamilyRounds(f.db,f.contexts[107],request()),error=>error.status===403);
  } finally {f.close();}
});

test('3B blocker: 0007 migrates an existing two-part 0006 plan without losing either part',()=>{
  const sql=new DatabaseSync(':memory:');
  try {
    sql.exec('PRAGMA foreign_keys=ON');
    const migrations=join(root,'gestio/migrations');
    for (const name of readdirSync(migrations).filter(name=>name.endsWith('.sql') && name<'0007_').sort())
      sql.exec(readFileSync(join(migrations,name),'utf8'));
    sql.exec(readFileSync(join(root,'gestio/seed.sql'),'utf8'));
    sql.prepare(`INSERT INTO annual_fee_obligation
      (id,round_id,participant_id,sibling_ordinal,base_cents,discount_cents,amount_due_cents,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id(980),id(901),id(501),1,10000,0,10000,id(104),1,1);
    sql.prepare(`INSERT INTO annual_fee_installment_plan(id,obligation_id,authorized_by,authorized_at)
      VALUES(?,?,?,?)`).run(id(981),id(980),id(104),1);
    sql.prepare(`INSERT INTO annual_fee_installment_part(plan_id,ordinal,planned_cents,target_at)
      VALUES(?,?,?,?)`).run(id(981),1,3000,null);
    sql.prepare(`INSERT INTO annual_fee_installment_part(plan_id,ordinal,planned_cents,target_at)
      VALUES(?,?,?,?)`).run(id(981),2,7000,null);
    sql.exec(readFileSync(join(migrations,'0007_annual_fee_integrity.sql'),'utf8'));
    assert.deepEqual(sql.prepare(`SELECT ordinal,planned_cents FROM annual_fee_installment_part
      WHERE plan_id=? ORDER BY ordinal`).all(id(981)).map(row=>[row.ordinal,row.planned_cents]),[[1,3000],[2,7000]]);
    assert.equal(sql.prepare('PRAGMA foreign_key_check').all().length,0);
  } finally {sql.close();}
});

test('3B blocker: identical fee replay survives round closure while new submissions remain closed',async()=>{
  const f=fixture();
  try {
    const input=submission();
    const first=await submitFee(f.db,f.storage,input,crypto.randomUUID());
    f.sql.prepare('UPDATE annual_fee_round SET is_open=0 WHERE id=?').run(id(901));
    const replay=await submitFee(f.db,f.storage,input,crypto.randomUUID());
    assert.equal(replay.reference,first.reference);
    await assert.rejects(submitFee(f.db,f.storage,{...input,idempotencyKey:crypto.randomUUID().replaceAll('-','')},
      crypto.randomUUID()),error=>error.code==='fee_round_unavailable');
    assert.equal(count(f.sql,'annual_fee_payment'),1);
  } finally {f.close();}
});

function delegateTropa(f) {
  f.sql.prepare(`INSERT INTO delegated_permission(id,user_id,permission_code,section_id,authorized_by,
    provisioned_by,authorization_reference,granted_at,expires_at,ratification_status,
    ratified_at,ratified_by,ratification_reference) VALUES(?,?,?,?,?,?,?,?,?,'RATIFIED',?,?,?)`)
    .run(crypto.randomUUID(),id(105),'finance.fee.payment.review',id(2),id(101),id(107),
      'DEMO-FEE-TROPA-HARDEN',1700000000000,4102444800000,1700000000001,id(101),'DEMO-RATIFIED-FEE-HARDEN');
}

test('3B final: current section controls fee payment listing, detail and review',async()=>{
  const f=fixture();
  try {
    delegateTropa(f);
    const obligation=(await createObligation(f.db,f.contexts[104],crypto.randomUUID(),
      {roundId:id(901),participantId:id(502)})).id;
    const created=await submitFee(f.db,f.storage,
      {...submission(),children:[children[1]]},crypto.randomUUID());
    f.sql.prepare('UPDATE participant SET current_section_id=? WHERE id=?').run(id(3),id(502));
    assert.ok(!(await listFeePayments(f.db,f.contexts[105],crypto.randomUUID(),id(901))).payments
      .some(row=>row.id===created.reference));
    await assert.rejects(feePaymentDetail(f.db,f.contexts[105],crypto.randomUUID(),created.reference),
      error=>error.status===404 /* audit L1: out-of-scope read concealed */);
    await assert.rejects(reviewFeePayment(f.db,f.contexts[105],crypto.randomUUID(),created.reference,
      {verifiedAmountCents:10000,allocations:[{obligationId:obligation,amountCents:10000}]}),
    error=>error.status===403);
    assert.equal(f.sql.prepare('SELECT review_status FROM annual_fee_payment WHERE id=?')
      .get(created.reference).review_status,'PENDING_REVIEW');
    assert.equal(count(f.sql,'annual_fee_allocation'),0);
    assert.equal(f.sql.prepare('SELECT section_id FROM annual_fee_submission_person WHERE payment_id=?')
      .get(created.reference).section_id,id(2),'historical section remains in the financial record');

    f.sql.prepare(`INSERT INTO user_role(id,user_id,role_code,section_id,valid_from,expires_at,granted_by,justification)
      VALUES(?,?,'SECTION_DELEGATE',?,?,?,?,?)`).run(crypto.randomUUID(),id(105),id(3),
        1700000000000,4102444800000,id(101),'Synthetic current-section regression');
    f.sql.prepare(`INSERT INTO delegated_permission(id,user_id,permission_code,section_id,authorized_by,
      provisioned_by,authorization_reference,granted_at,expires_at,ratification_status,
      ratified_at,ratified_by,ratification_reference) VALUES(?,?,?,?,?,?,?,?,?,'RATIFIED',?,?,?)`)
      .run(crypto.randomUUID(),id(105),'finance.fee.payment.review',id(3),id(101),id(107),
        'DEMO-FEE-ESCOLTA-FINAL',1700000000000,4102444800000,1700000000001,id(101),
        'DEMO-FEE-ESCOLTA-RATIFIED');
    assert.ok((await listFeePayments(f.db,f.contexts[105],crypto.randomUUID(),id(901))).payments
      .some(row=>row.id===created.reference));
    assert.equal((await feePaymentDetail(f.db,f.contexts[105],crypto.randomUUID(),created.reference))
      .eligibleObligations[0].id,obligation);
    await reviewFeePayment(f.db,f.contexts[105],crypto.randomUUID(),created.reference,
      {verifiedAmountCents:10000,allocations:[{obligationId:obligation,amountCents:10000}]});
    assert.equal(status(f.sql,obligation),'PAID');
  } finally {f.close();}
});

test('3B final: multi-obligation payment denies a partially scoped allocation revision atomically',async()=>{
  const f=fixture();
  try {
    delegateTropa(f);
    const first=(await createObligation(f.db,f.contexts[104],crypto.randomUUID(),
      {roundId:id(901),participantId:id(502)})).id;
    const second=(await createObligation(f.db,f.contexts[104],crypto.randomUUID(),
      {roundId:id(901),participantId:id(503)})).id;
    const created=await submitFee(f.db,f.storage,
      {...submission(),children:children.slice(1)},crypto.randomUUID());
    await reviewFeePayment(f.db,f.contexts[104],crypto.randomUUID(),created.reference,
      {verifiedAmountCents:20000,allocations:[{obligationId:first,amountCents:10000},
        {obligationId:second,amountCents:10000}]});
    f.sql.prepare('UPDATE participant SET current_section_id=? WHERE id=?').run(id(3),id(503));
    const before=f.sql.prepare('SELECT obligation_id,amount_cents FROM annual_fee_allocation WHERE payment_id=? ORDER BY obligation_id')
      .all(created.reference);
    await assert.rejects(feePaymentDetail(f.db,f.contexts[105],crypto.randomUUID(),created.reference),
      error=>error.status===404 /* audit L1: out-of-scope read concealed */);
    await assert.rejects(reviseFeeAllocations(f.db,f.contexts[105],crypto.randomUUID(),created.reference,
      {expectedVersion:1,allocations:[{obligationId:first,amountCents:9000},
        {obligationId:second,amountCents:10000}]}),error=>error.status===403);
    assert.deepEqual(f.sql.prepare('SELECT obligation_id,amount_cents FROM annual_fee_allocation WHERE payment_id=? ORDER BY obligation_id')
      .all(created.reference),before);
    assert.equal(count(f.sql,'annual_fee_allocation_revision'),0);
    assert.equal(f.sql.prepare('SELECT allocation_version FROM annual_fee_payment WHERE id=?')
      .get(created.reference).allocation_version,1);
    assert.deepEqual([status(f.sql,first),status(f.sql,second)],['PAID','PAID']);
  } finally {f.close();}
});

test('3B final: direct SQL cannot use the legacy gate to orphan or move funded family membership',async()=>{
  const f=fixture();
  try {
    const {groupId,ids}=await obligations(f);
    for (const attack of [
      ()=>f.sql.prepare('DELETE FROM annual_fee_family_member WHERE group_id=? AND participant_id=?')
        .run(groupId,id(501)),
      ()=>f.sql.prepare('UPDATE annual_fee_family_member SET sibling_ordinal=9 WHERE group_id=? AND participant_id=?')
        .run(groupId,id(501)),
      ()=>f.sql.prepare('UPDATE annual_fee_family_member SET participant_id=? WHERE group_id=? AND participant_id=?')
        .run(id(505),groupId,id(501))
    ]) {
      f.sql.exec('BEGIN');
      f.sql.prepare('INSERT INTO annual_fee_family_correction_gate(group_id,opened_at) VALUES(?,?)')
        .run(groupId,Date.now());
      try {assert.throws(()=>{attack();f.sql.exec('COMMIT');},
        /FOREIGN KEY constraint failed|invalid_fee_family_binding/);}
      finally {f.sql.exec('ROLLBACK');}
    }
    f.sql.exec('BEGIN');
    try {
      f.sql.prepare('INSERT INTO annual_fee_family_correction_gate(group_id,opened_at) VALUES(?,?)')
        .run(groupId,Date.now());
      assert.throws(()=>f.sql.prepare(`INSERT INTO annual_fee_family_member
        (group_id,round_id,participant_id,sibling_ordinal,assigned_by,assigned_at)
        VALUES(?,?,?,?,?,?)`).run(groupId,id(901),id(505),5,id(104),Date.now()),
      /invalid_fee_family_binding/);
      assert.throws(()=>f.sql.prepare('UPDATE annual_fee_obligation SET family_group_id=NULL WHERE id=?')
        .run(ids.get(501)),/invalid_fee_family_binding/);
    } finally {f.sql.exec('ROLLBACK');}
    assert.equal(f.sql.prepare('SELECT family_group_id FROM annual_fee_obligation WHERE id=?')
      .get(ids.get(501)).family_group_id,groupId);
    assert.equal(f.sql.prepare('PRAGMA foreign_key_check').all().length,0);
    assert.equal(count(f.sql,'annual_fee_family_correction_gate'),0);
    await correctFamilyGroup(f.db,f.contexts[104],crypto.randomUUID(),groupId,
      {participantIds:[id(502),id(501),id(503),id(504)]});
    assert.equal(f.sql.prepare('PRAGMA foreign_key_check').all().length,0);
  } finally {f.close();}
});

test('3B final: 0009 upgrades populated 0008 family obligations without losing history',()=>{
  const sql=new DatabaseSync(':memory:');
  try {
    sql.exec('PRAGMA foreign_keys=ON');
    const migrations=join(root,'gestio/migrations');
    for (const name of readdirSync(migrations).filter(name=>name.endsWith('.sql') && name<'0009_').sort())
      sql.exec(readFileSync(join(migrations,name),'utf8'));
    sql.exec(readFileSync(join(root,'gestio/seed.sql'),'utf8'));
    sql.prepare('INSERT INTO annual_fee_family_group(id,round_id,reference,created_by,created_at) VALUES(?,?,?,?,?)')
      .run(id(910),id(901),'DEMO-FINAL-009',id(104),1);
    for (const [participant,ordinal] of [[501,1],[502,2]]) {
      sql.prepare(`INSERT INTO annual_fee_family_member
        (group_id,round_id,participant_id,sibling_ordinal,assigned_by,assigned_at) VALUES(?,?,?,?,?,?)`)
        .run(id(910),id(901),id(participant),ordinal,id(104),1);
      sql.prepare(`INSERT INTO annual_fee_obligation
        (id,round_id,participant_id,family_group_id,sibling_ordinal,base_cents,discount_cents,
          amount_due_cents,created_by,created_at,updated_at) VALUES(?,?,?,?,?,10000,0,10000,?,?,?)`)
        .run(id(920+ordinal),id(901),id(participant),id(910),ordinal,id(104),1,1);
    }
    sql.prepare(`INSERT INTO annual_fee_amount_revision
      (id,obligation_id,previous_amount_cents,new_amount_cents,changed_by,changed_at) VALUES(?,?,?,?,?,?)`)
      .run(id(930),id(921),10000,10000,id(104),2);
    sql.exec(readFileSync(join(migrations,'0009_annual_fee_final_integrity.sql'),'utf8'));
    assert.equal(count(sql,'annual_fee_obligation'),2);
    assert.equal(count(sql,'annual_fee_amount_revision'),1);
    assert.equal(sql.prepare('PRAGMA foreign_key_check').all().length,0);
    sql.prepare('INSERT INTO annual_fee_family_correction_gate(group_id,opened_at) VALUES(?,?)')
      .run(id(910),3);
    assert.throws(()=>sql.prepare('DELETE FROM annual_fee_family_member WHERE group_id=? AND participant_id=?')
      .run(id(910),id(501)),/FOREIGN KEY constraint failed/);
  } finally {sql.close();}
});

test('3B final: 0009 rejects a pre-existing family orphan from the legacy gate',()=>{
  const sql=new DatabaseSync(':memory:');
  try {
    sql.exec('PRAGMA foreign_keys=ON');
    const migrations=join(root,'gestio/migrations');
    for (const name of readdirSync(migrations).filter(name=>name.endsWith('.sql') && name<'0009_').sort())
      sql.exec(readFileSync(join(migrations,name),'utf8'));
    sql.exec(readFileSync(join(root,'gestio/seed.sql'),'utf8'));
    sql.prepare('INSERT INTO annual_fee_family_group(id,round_id,reference,created_by,created_at) VALUES(?,?,?,?,?)')
      .run(id(910),id(901),'DEMO-FINAL-BAD',id(104),1);
    sql.prepare(`INSERT INTO annual_fee_family_member
      (group_id,round_id,participant_id,sibling_ordinal,assigned_by,assigned_at) VALUES(?,?,?,?,?,?)`)
      .run(id(910),id(901),id(501),1,id(104),1);
    sql.prepare(`INSERT INTO annual_fee_obligation
      (id,round_id,participant_id,family_group_id,sibling_ordinal,base_cents,discount_cents,
        amount_due_cents,created_by,created_at,updated_at) VALUES(?,?,?,?,?,10000,0,10000,?,?,?)`)
      .run(id(921),id(901),id(501),id(910),1,id(104),1,1);
    sql.prepare('INSERT INTO annual_fee_family_correction_gate(group_id,opened_at) VALUES(?,?)')
      .run(id(910),2);
    sql.prepare('DELETE FROM annual_fee_family_member WHERE group_id=?').run(id(910));
    assert.throws(()=>sql.exec(readFileSync(join(migrations,'0009_annual_fee_final_integrity.sql'),'utf8')),
      /CHECK constraint failed/);
  } finally {sql.close();}
});

test('3B second review: issue creation requires a funded relationship and resolution checks obligation scope',async()=>{
  const f=fixture();
  try {
    delegateTropa(f);
    const troop=(await createObligation(f.db,f.contexts[104],crypto.randomUUID(),
      {roundId:id(901),participantId:id(503)})).id;
    const scout=(await createObligation(f.db,f.contexts[104],crypto.randomUUID(),
      {roundId:id(901),participantId:id(504)})).id;
    const created=await submitFee(f.db,f.storage,{...submission(),children:[children[2]]},crypto.randomUUID());
    await reviewFeePayment(f.db,f.contexts[104],crypto.randomUUID(),created.reference,
      {verifiedAmountCents:10000,allocations:[{obligationId:troop,amountCents:10000}]});
    await assert.rejects(openFeeIssue(f.db,f.contexts[104],crypto.randomUUID(),
      {paymentId:created.reference,obligationId:scout,code:'DISCREPANCY'}),
    error=>error.code==='invalid_fee_issue');
    const issue=await openFeeIssue(f.db,f.contexts[104],crypto.randomUUID(),
      {paymentId:created.reference,obligationId:troop,code:'BANK_NOT_FOUND'});
    f.sql.prepare('UPDATE participant SET current_section_id=? WHERE id=?').run(id(3),id(503));
    await assert.rejects(resolveFeeIssue(f.db,f.contexts[105],crypto.randomUUID(),issue.id),
      error=>error.status===403);
    assert.equal(f.sql.prepare('SELECT status FROM annual_fee_issue WHERE id=?').get(issue.id).status,'OPEN');
    await resolveFeeIssue(f.db,f.contexts[104],crypto.randomUUID(),issue.id);
    assert.equal(status(f.sql,troop),'PAID');
  } finally {f.close();}
});

test('3B second review: stale allocation version never writes a false before value',async()=>{
  const f=fixture();
  try {
    const {ids}=await obligations(f);
    const paymentId=await payment(f,[{obligationId:ids.get(501),amountCents:10000}]);
    await reviseFeeAllocations(f.db,f.contexts[104],crypto.randomUUID(),paymentId,
      {expectedVersion:1,allocations:[{obligationId:ids.get(501),amountCents:6000}]});
    const audits=count(f.sql,'annual_fee_allocation_revision');
    await assert.rejects(reviseFeeAllocations(f.db,f.contexts[104],crypto.randomUUID(),paymentId,
      {expectedVersion:1,allocations:[{obligationId:ids.get(501),amountCents:8000}]}),
    error=>error.status===409);
    assert.equal(count(f.sql,'annual_fee_allocation_revision'),audits);
    assert.equal(f.sql.prepare('SELECT amount_cents FROM annual_fee_allocation WHERE payment_id=?').get(paymentId).amount_cents,6000);
  } finally {f.close();}
});

test('3B second review: an intervening allocation commit aborts every stale write and audit',async()=>{
  const f=fixture();
  try {
    const {ids}=await obligations(f);
    const paymentId=await payment(f,[{obligationId:ids.get(501),amountCents:10000}]);
    const revisions=count(f.sql,'annual_fee_allocation_revision');
    const audits=f.sql.prepare("SELECT count(*) AS n FROM audit_event WHERE action='FEE_ALLOCATION_REVISED'").get().n;
    f.race(()=>f.sql.prepare('UPDATE annual_fee_payment SET allocation_version=allocation_version+1 WHERE id=?')
      .run(paymentId));
    await assert.rejects(reviseFeeAllocations(f.db,f.contexts[104],crypto.randomUUID(),paymentId,
      {expectedVersion:1,allocations:[{obligationId:ids.get(501),amountCents:6000}]}),
    error=>error.status===409 && error.code==='stale_fee_allocation');
    assert.equal(f.sql.prepare('SELECT amount_cents FROM annual_fee_allocation WHERE payment_id=?').get(paymentId).amount_cents,10000);
    assert.equal(count(f.sql,'annual_fee_allocation_revision'),revisions);
    assert.equal(f.sql.prepare("SELECT count(*) AS n FROM audit_event WHERE action='FEE_ALLOCATION_REVISED'").get().n,audits);
  } finally {f.close();}
});

test('3B second review: direct D1 writes cannot fund PAID from pending review',async()=>{
  const f=fixture();
  try {
    const obligation=(await createObligation(f.db,f.contexts[104],crypto.randomUUID(),
      {roundId:id(901),participantId:id(501)})).id;
    const created=await submitFee(f.db,f.storage,{...submission(),children:[children[0]]},crypto.randomUUID());
    f.sql.prepare('UPDATE annual_fee_payment SET verified_amount_cents=10000 WHERE id=?').run(created.reference);
    assert.throws(()=>f.sql.prepare(`INSERT INTO annual_fee_allocation
      (id,payment_id,obligation_id,amount_cents,created_by,created_at) VALUES(?,?,?,?,?,?)`)
      .run(crypto.randomUUID(),created.reference,obligation,10000,id(104),Date.now()));
    assert.equal(status(f.sql,obligation),'PENDING');
    f.sql.prepare('UPDATE annual_fee_payment SET verified_amount_cents=NULL WHERE id=?').run(created.reference);
    await reviewFeePayment(f.db,f.contexts[104],crypto.randomUUID(),created.reference,
      {verifiedAmountCents:10000,allocations:[{obligationId:obligation,amountCents:10000}]});
    assert.throws(()=>f.sql.prepare("UPDATE annual_fee_payment SET review_status='PENDING_REVIEW' WHERE id=?")
      .run(created.reference));
    assert.throws(()=>f.sql.prepare('UPDATE annual_fee_payment SET reviewed_by=NULL WHERE id=?')
      .run(created.reference));
  } finally {f.close();}
});

test('3B second review: unallocated verified balance is visible, disputed and blocks confirmation',async()=>{
  const f=fixture();
  try {
    const {ids}=await obligations(f);
    const created=await submitFee(f.db,f.storage,submission(),crypto.randomUUID());
    await reviewFeePayment(f.db,f.contexts[104],crypto.randomUUID(),created.reference,
      {verifiedAmountCents:20000,allocations:[{obligationId:ids.get(501),amountCents:10000}]});
    assert.equal(f.sql.prepare('SELECT unallocated_cents FROM annual_fee_payment_balance WHERE id=?')
      .get(created.reference).unallocated_cents,10000);
    assert.equal(f.sql.prepare(`SELECT count(*) AS n FROM annual_fee_issue WHERE payment_id=?
      AND code='ALLOCATION_UNCLEAR' AND status='OPEN'`).get(created.reference).n,1);
    assert.throws(()=>f.sql.prepare(`UPDATE annual_fee_notification_outbox SET status='SENT'
      WHERE payment_id=? AND kind='FEE_PAYMENT_CONFIRMED'`).run(created.reference));
    const metrics=await feeMetrics(f.db,f.contexts[104],crypto.randomUUID(),id(901));
    assert.equal(metrics.unallocatedVerifiedCents,10000);
    const issue=f.sql.prepare(`SELECT id FROM annual_fee_issue WHERE payment_id=? AND code='ALLOCATION_UNCLEAR'`)
      .get(created.reference);
    await assert.rejects(resolveFeeIssue(f.db,f.contexts[104],crypto.randomUUID(),issue.id),
      error=>error.code==='unallocated_fee_balance');
  } finally {f.close();}
});

test('3B second review: exact and multi-sibling allocations have zero residual',async()=>{
  const f=fixture();
  try {
    const {ids}=await obligations(f);
    for (const allocations of [
      [{obligationId:ids.get(501),amountCents:10000}],
      [{obligationId:ids.get(502),amountCents:10000},{obligationId:ids.get(503),amountCents:5000}]
    ]) {
      const paymentId=await payment(f,allocations);
      assert.equal(f.sql.prepare('SELECT unallocated_cents FROM annual_fee_payment_balance WHERE id=?')
        .get(paymentId).unallocated_cents,0);
      assert.equal(f.sql.prepare("SELECT count(*) AS n FROM annual_fee_issue WHERE payment_id=? AND code='ALLOCATION_UNCLEAR'")
        .get(paymentId).n,0);
    }
  } finally {f.close();}
});

test('3B second review: bank dispute is excluded from collected metrics',async()=>{
  const f=fixture();
  try {
    const {ids}=await obligations(f);
    const paymentId=await payment(f,[{obligationId:ids.get(501),amountCents:10000}]);
    let metrics=await feeMetrics(f.db,f.contexts[104],crypto.randomUUID(),id(901));
    assert.equal(metrics.confirmedAllocatedCents,10000);
    await openFeeIssue(f.db,f.contexts[104],crypto.randomUUID(),{paymentId,code:'BANK_NOT_FOUND'});
    metrics=await feeMetrics(f.db,f.contexts[104],crypto.randomUUID(),id(901));
    assert.equal(metrics.confirmedAllocatedCents,0);
    assert.equal(metrics.disputedAllocatedCents,10000);
    assert.equal(metrics.collectedPercent,0);
    f.sql.prepare("UPDATE annual_fee_payment SET review_status='ISSUE' WHERE id=?").run(paymentId);
    metrics=await feeMetrics(f.db,f.contexts[104],crypto.randomUUID(),id(901));
    assert.equal(metrics.confirmedAllocatedCents,0);
    assert.equal(metrics.disputedAllocatedCents,0);
  } finally {f.close();}
});

test('3B second review: direct family member deletion cannot orphan an obligation',async()=>{
  const f=fixture();
  try {
    const {groupId,ids}=await obligations(f);
    assert.throws(()=>f.sql.prepare('DELETE FROM annual_fee_family_member WHERE group_id=? AND participant_id=?')
      .run(groupId,id(501)));
    assert.throws(()=>f.sql.prepare('UPDATE annual_fee_family_member SET sibling_ordinal=9 WHERE group_id=? AND participant_id=?')
      .run(groupId,id(501)));
    await correctFamilyGroup(f.db,f.contexts[104],crypto.randomUUID(),groupId,
      {participantIds:[id(502),id(501),id(503),id(504)]});
    assert.equal(f.sql.prepare('SELECT family_group_id FROM annual_fee_obligation WHERE id=?').get(ids.get(501)).family_group_id,groupId);
  } finally {f.close();}
});

test('3B second review: changing an unused member to an obligated participant is rejected',async()=>{
  const f=fixture();
  try {
    const group=await createFamilyGroup(f.db,f.contexts[104],crypto.randomUUID(),
      {roundId:id(901),reference:'DEMO-FAMILY-UPDATE-001',participantIds:[id(501),id(502)]});
    await createObligation(f.db,f.contexts[104],crypto.randomUUID(),{roundId:id(901),participantId:id(505)});
    assert.throws(()=>f.sql.prepare(`UPDATE annual_fee_family_member SET participant_id=?
      WHERE group_id=? AND participant_id=?`).run(id(505),group.id,id(501)));
  } finally {f.close();}
});

test('3B second review: each later issue has its own notification, retries do not duplicate',async()=>{
  const f=fixture();
  try {
    const {ids}=await obligations(f);
    const paymentId=await payment(f,[{obligationId:ids.get(501),amountCents:10000}]);
    const first=await openFeeIssue(f.db,f.contexts[104],crypto.randomUUID(),{paymentId,code:'BANK_NOT_FOUND'});
    assert.equal(f.sql.prepare(`SELECT count(*) AS n FROM annual_fee_issue_outbox
      WHERE issue_id=?`).get(first.id).n,1);
    const replay=await openFeeIssue(f.db,f.contexts[104],crypto.randomUUID(),{paymentId,code:'BANK_NOT_FOUND'});
    assert.equal(replay.id,first.id);
    assert.equal(f.sql.prepare(`SELECT count(*) AS n FROM annual_fee_issue_outbox
      WHERE issue_id=?`).get(first.id).n,1);
    await resolveFeeIssue(f.db,f.contexts[104],crypto.randomUUID(),first.id);
    const second=await openFeeIssue(f.db,f.contexts[104],crypto.randomUUID(),{paymentId,code:'BANK_NOT_FOUND'});
    assert.notEqual(second.id,first.id);
    assert.equal(f.sql.prepare(`SELECT count(*) AS n FROM annual_fee_issue_outbox
      WHERE issue_id=?`).get(second.id).n,1);
    assert.equal(f.sql.prepare(`SELECT count(*) AS n FROM annual_fee_issue_outbox
      WHERE payment_id=?`).get(paymentId).n,2);
  } finally {f.close();}
});

test('3B second review: an obligation-only issue without a funding payment remains internal',async()=>{
  const f=fixture();
  try {
    const obligation=(await createObligation(f.db,f.contexts[104],crypto.randomUUID(),
      {roundId:id(901),participantId:id(501)})).id;
    await openFeeIssue(f.db,f.contexts[104],crypto.randomUUID(),{obligationId:obligation,code:'DISCREPANCY'});
    assert.equal(count(f.sql,'annual_fee_issue_outbox'),0);
  } finally {f.close();}
});

test('3B second review: multi-obligation issue resolution is all-or-nothing across sections',async()=>{
  const f=fixture();
  try {
    delegateTropa(f);
    const ids=[];
    for (const number of [502,503]) ids.push((await createObligation(f.db,f.contexts[104],crypto.randomUUID(),
      {roundId:id(901),participantId:id(number)})).id);
    const created=await submitFee(f.db,f.storage,{...submission(),children:children.slice(1)},crypto.randomUUID());
    await reviewFeePayment(f.db,f.contexts[104],crypto.randomUUID(),created.reference,
      {verifiedAmountCents:20000,allocations:ids.map(obligationId=>({obligationId,amountCents:10000}))});
    const issue=await openFeeIssue(f.db,f.contexts[104],crypto.randomUUID(),
      {paymentId:created.reference,code:'BANK_NOT_FOUND'});
    f.sql.prepare('UPDATE participant SET current_section_id=? WHERE id=?').run(id(3),id(503));
    const before=f.sql.prepare("SELECT count(*) AS n FROM audit_event WHERE action='FEE_ISSUE_RESOLVED'").get().n;
    await assert.rejects(resolveFeeIssue(f.db,f.contexts[105],crypto.randomUUID(),issue.id),error=>error.status===403);
    assert.equal(f.sql.prepare('SELECT status FROM annual_fee_issue WHERE id=?').get(issue.id).status,'OPEN');
    assert.deepEqual(ids.map(obligationId=>status(f.sql,obligationId)),['ISSUE','ISSUE']);
    assert.equal(f.sql.prepare("SELECT count(*) AS n FROM audit_event WHERE action='FEE_ISSUE_RESOLVED'").get().n,before);
    await resolveFeeIssue(f.db,f.contexts[104],crypto.randomUUID(),issue.id);
    assert.deepEqual(ids.map(obligationId=>status(f.sql,obligationId)),['PAID','PAID']);
  } finally {f.close();}
});

test('3B second review: 0008 backfills a verified legacy residual with an issue and notice',()=>{
  const sql=new DatabaseSync(':memory:');
  try {
    sql.exec('PRAGMA foreign_keys=ON');
    const migrations=join(root,'gestio/migrations');
    for (const name of readdirSync(migrations).filter(name=>name.endsWith('.sql') && name<'0008_').sort())
      sql.exec(readFileSync(join(migrations,name),'utf8'));
    sql.exec(readFileSync(join(root,'gestio/seed.sql'),'utf8'));
    sql.prepare(`INSERT INTO annual_fee_obligation
      (id,round_id,participant_id,sibling_ordinal,base_cents,discount_cents,amount_due_cents,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id(985),id(901),id(501),1,10000,0,10000,id(104),1,1);
    sql.prepare(`INSERT INTO annual_fee_payment
      (id,round_id,receipt_email,submitted_by_name,verified_amount_cents,review_status,idempotency_key,
      payload_sha256,privacy_notice_version,privacy_notice_acknowledged_at,created_at,reviewed_by,reviewed_at)
      VALUES(?,?,?,?,?,'ISSUE',?,?,?,?,?,?,?)`).run(id(986),id(901),'legacy@example.test','Família fictícia',
      20000,'legacy-payment-key-0001','0'.repeat(64),'DEMO-3B-PRIVACY-NOTICE-V1',1,1,id(104),2);
    sql.prepare(`INSERT INTO annual_fee_submission_person
      (id,payment_id,submitted_name,match_key,section_id,participant_id,match_status)
      VALUES(?,?,?,?,?,?,'CLEAR')`).run(id(987),id(986),'Participante Manada A (ficticio)',
        'participante manada a ficticio',id(1),id(501));
    sql.prepare(`INSERT INTO annual_fee_allocation(id,payment_id,obligation_id,amount_cents,created_by,created_at)
      VALUES(?,?,?,?,?,?)`).run(id(988),id(986),id(985),10000,id(104),2);
    sql.prepare("UPDATE annual_fee_payment SET review_status='VERIFIED' WHERE id=?").run(id(986));
    sql.exec(readFileSync(join(migrations,'0008_annual_fee_hardening.sql'),'utf8'));
    assert.equal(sql.prepare('SELECT unallocated_cents FROM annual_fee_payment_balance WHERE id=?').get(id(986)).unallocated_cents,10000);
    const issue=sql.prepare("SELECT id FROM annual_fee_issue WHERE payment_id=? AND code='ALLOCATION_UNCLEAR' AND status='OPEN'")
      .get(id(986));
    assert.ok(issue);
    assert.equal(sql.prepare('SELECT count(*) AS n FROM annual_fee_issue_outbox WHERE issue_id=?').get(issue.id).n,1);
    assert.equal(sql.prepare('PRAGMA foreign_key_check').all().length,0);
  } finally {sql.close();}
});
