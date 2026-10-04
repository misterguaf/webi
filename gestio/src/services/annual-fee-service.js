import { versionCas } from '../concurrency.js';
import { pageRequest, pageResult } from '../pagination.js';
import { synthetic } from '../environment-policy.js';
import { append, statement } from '../domains/audit/repository.js';
import { AppError, requireGroupWide, requirePermission, requireUuid, validUuid } from './common.js';
import { evidenceKey, readEvidence, storeEvidence, validateSyntheticEvidence } from './evidence-service.js';
import { findMatch, matchCandidates, matchKey } from './registration-service.js';

const uuid=()=>crypto.randomUUID();
const cents=value=>Number.isSafeInteger(value) && value>0 && value<=10000000;
const roundCode=value=>typeof value==='string' && /^20\d\d\/20\d\d$/.test(value) && Number(value.slice(5))===Number(value.slice(0,4))+1;
const email=value=>typeof value==='string' && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value) && value.length<=254 && synthetic.email(value);
const nowDate=value=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value &&
  Date.parse(value+'T00:00:00Z')<=Date.now();
const keysOnly=(input,allowed)=>input && typeof input==='object' && !Array.isArray(input) &&
  Object.keys(input).every(key=>allowed.includes(key));
const fail=code=>{throw new AppError(400,code);};

function audit(db,context,requestId,action,resourceType,resourceId,now) {
  return statement(db,{requestId,actorUserId:context?.userId??null,sessionId:context?.sessionId??null,
    action,resourceType,resourceId,occurredAt:now});
}
async function globalPermission(db,context,requestId,permission,resourceType,resourceId=null) {
  await requireGroupWide(db,context,requestId,permission,{resourceType,resourceId});
}
async function roundById(db,id) {
  requireUuid(id);
  const row=await db.prepare('SELECT * FROM annual_fee_round WHERE id=?').bind(id).first();
  if (!row) throw new AppError(404,'not_found');
  return row;
}
export async function publicRound(db) {
  const row=await db.prepare(`SELECT code,base_cents,discount_from_ordinal,discount_percent,deadline_at,
    account_holder,iban,concept_template FROM annual_fee_round WHERE is_open=1`).first();
  if (!row) return {oberta:false};
  return {oberta:true,curs:row.code,baseCents:row.base_cents,discountFromOrdinal:row.discount_from_ordinal,
    discountPercent:row.discount_percent,deadlineAt:row.deadline_at,accountHolder:row.account_holder,
    iban:row.iban,conceptTemplate:row.concept_template};
}
export async function listRounds(db,context,requestId) {
  await globalPermission(db,context,requestId,'finance.fee.read','annual_fee_round');
  return (await db.prepare('SELECT * FROM annual_fee_round ORDER BY code DESC LIMIT 30').all()).results;
}
export async function listReviewRounds(db,context,requestId) {
  await requirePermission(db,context,requestId,'finance.fee.payment.review',{mode:'list',resourceType:'annual_fee_payment'});
  return (await db.prepare('SELECT id,code FROM annual_fee_round ORDER BY code DESC LIMIT 30').all()).results;
}
export async function listFamilyRounds(db,context,requestId) {
  await globalPermission(db,context,requestId,'finance.family.read','annual_fee_round');
  return (await db.prepare('SELECT id,code FROM annual_fee_round ORDER BY code DESC LIMIT 30').all()).results;
}
export async function roundRevisions(db,context,requestId,id) {
  await globalPermission(db,context,requestId,'finance.fee.read','annual_fee_round',id);
  await roundById(db,id);
  return (await db.prepare(`SELECT previous_base_cents,new_base_cents,previous_deadline_at,new_deadline_at,
    changed_by,changed_at FROM annual_fee_round_revision WHERE round_id=? ORDER BY changed_at DESC,id DESC LIMIT 50`)
    .bind(id).all()).results;
}
function validConfig(input,creating=false) {
  if (!keysOnly(input,['code','isOpen','baseCents','deadlineAt','accountHolder','iban','conceptTemplate']) ||
    (creating && !roundCode(input.code)) ||
    (input.code!==undefined && !roundCode(input.code)) ||
    (input.isOpen!==undefined && typeof input.isOpen!=='boolean') ||
    (input.baseCents!==undefined && (!cents(input.baseCents) || input.baseCents>1000000)) ||
    (input.deadlineAt!==undefined && input.deadlineAt!==null && (!Number.isSafeInteger(input.deadlineAt) || input.deadlineAt<0)) ||
    (input.accountHolder!==undefined && (typeof input.accountHolder!=='string' || input.accountHolder.trim().length<2 || input.accountHolder.length>120)) ||
    (input.iban!==undefined && (typeof input.iban!=='string' || !/^[A-Z]{2}[A-Z0-9]{13,32}$/.test(input.iban))) ||
    (input.conceptTemplate!==undefined && (typeof input.conceptTemplate!=='string' ||
      !input.conceptTemplate.includes('{Nombre educando}') || input.conceptTemplate.length>120))) fail('invalid_fee_round');
  if (creating && (!cents(input.baseCents) || !input.accountHolder || !input.iban || !input.conceptTemplate || input.isOpen===undefined))
    fail('invalid_fee_round');
}
export async function createRound(db,context,requestId,input,now=Date.now()) {
  await globalPermission(db,context,requestId,'finance.fee.config.manage','annual_fee_round');
  validConfig(input,true);
  const id=uuid();
  await db.batch([
    db.prepare(`INSERT INTO annual_fee_round(id,code,is_open,base_cents,deadline_at,account_holder,iban,concept_template,
      created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id,input.code,input.isOpen?1:0,input.baseCents,input.deadlineAt??null,input.accountHolder.trim(),
        input.iban,input.conceptTemplate,context.userId,context.userId,now,now),
    audit(db,context,requestId,'FEE_ROUND_CREATED','annual_fee_round',id,now)
  ]);
  return {id};
}
export async function updateRound(db,context,requestId,id,input,now=Date.now()) {
  await globalPermission(db,context,requestId,'finance.fee.config.manage','annual_fee_round',id);
  const row=await roundById(db,id);
  validConfig(input);
  if (input.code!==undefined) fail('invalid_fee_round');
  const fields={is_open:input.isOpen===undefined?row.is_open:input.isOpen?1:0,
    base_cents:input.baseCents??row.base_cents,deadline_at:input.deadlineAt===undefined?row.deadline_at:input.deadlineAt,
    account_holder:input.accountHolder?.trim()??row.account_holder,iban:input.iban??row.iban,
    concept_template:input.conceptTemplate??row.concept_template};
  const baseChanged=fields.base_cents!==row.base_cents;
  const deadlineChanged=fields.deadline_at!==row.deadline_at;
  try { await db.batch([
    db.prepare(`UPDATE annual_fee_round SET is_open=?,base_cents=?,deadline_at=?,account_holder=?,iban=?,concept_template=?,
      updated_by=?,updated_at=?,${versionCas('version')} WHERE id=?`)
      .bind(fields.is_open,fields.base_cents,fields.deadline_at,fields.account_holder,fields.iban,
        fields.concept_template,context.userId,now,row.version,id),
    audit(db,context,requestId,'FEE_ROUND_UPDATED','annual_fee_round',id,now),
    ...(baseChanged||deadlineChanged?[db.prepare(`INSERT INTO annual_fee_round_revision
      (id,round_id,previous_base_cents,new_base_cents,previous_deadline_at,new_deadline_at,changed_by,changed_at)
      VALUES(?,?,?,?,?,?,?,?)`).bind(uuid(),id,row.base_cents,fields.base_cents,row.deadline_at,
        fields.deadline_at,context.userId,now)]:[]),
    ...(baseChanged?[audit(db,context,requestId,'FEE_BASE_CHANGED','annual_fee_round',id,now)]:[]),
    ...(deadlineChanged?[audit(db,context,requestId,'FEE_DEADLINE_CHANGED','annual_fee_round',id,now)]:[])
  ]); } catch(error) {
    const current=await db.prepare('SELECT version FROM annual_fee_round WHERE id=?').bind(id).first();
    if (!current || current.version!==row.version) throw new AppError(409,'stale_fee_round');
    throw error;
  }
  return {id};
}
export async function createFamilyGroup(db,context,requestId,input,now=Date.now()) {
  await globalPermission(db,context,requestId,'finance.family.manage','annual_fee_family_group');
  if (!keysOnly(input,['roundId','reference','participantIds']) || !validUuid(input.roundId) ||
    !synthetic.reference(input.reference,{min:3,max:75}) ||
    !Array.isArray(input.participantIds) || input.participantIds.length<2 || input.participantIds.length>20 ||
    new Set(input.participantIds).size!==input.participantIds.length || input.participantIds.some(id=>!validUuid(id))) fail('invalid_family_group');
  await roundById(db,input.roundId);
  const active=(await db.prepare(`SELECT id FROM participant WHERE status='ACTIVE' AND id IN (${input.participantIds.map(()=>'?').join(',')})`)
    .bind(...input.participantIds).all()).results;
  if (active.length!==input.participantIds.length) fail('invalid_family_group');
  const existing=(await db.prepare(`SELECT participant_id FROM annual_fee_obligation WHERE round_id=? AND
    participant_id IN (${input.participantIds.map(()=>'?').join(',')})`)
    .bind(input.roundId,...input.participantIds).all()).results;
  const id=uuid();
  if (existing.length) return correctFamilyGroup(db,context,requestId,id,
    {participantIds:input.participantIds},now,{roundId:input.roundId,reference:input.reference});
  await db.batch([
    db.prepare(`INSERT INTO annual_fee_family_group(id,round_id,reference,created_by,created_at) VALUES(?,?,?,?,?)`)
      .bind(id,input.roundId,input.reference,context.userId,now),
    ...input.participantIds.map((participantId,index)=>db.prepare(`INSERT INTO annual_fee_family_member
      (group_id,round_id,participant_id,sibling_ordinal,assigned_by,assigned_at) VALUES(?,?,?,?,?,?)`)
      .bind(id,input.roundId,participantId,index+1,context.userId,now)),
    audit(db,context,requestId,'FEE_FAMILY_GROUP_CREATED','annual_fee_family_group',id,now)
  ]);
  return {id};
}
export async function correctFamilyGroup(db,context,requestId,id,input,now=Date.now(),creation=null) {
  await globalPermission(db,context,requestId,'finance.family.manage','annual_fee_family_group',id);
  const group=creation?{id:requireUuid(id),round_id:creation.roundId,version:1}:
    await db.prepare('SELECT * FROM annual_fee_family_group WHERE id=?').bind(requireUuid(id)).first();
  if (!group) throw new AppError(404,'not_found');
  if (!keysOnly(input,['participantIds']) || !Array.isArray(input.participantIds) || input.participantIds.length>20 ||
    new Set(input.participantIds).size!==input.participantIds.length || input.participantIds.some(value=>!validUuid(value)))
    fail('invalid_family_group');
  const before=creation?[]:(await db.prepare(`SELECT participant_id,sibling_ordinal FROM annual_fee_family_member
    WHERE group_id=? ORDER BY sibling_ordinal`).bind(id).all()).results;
  if (!creation && before.length===input.participantIds.length && before.every((row,index)=>row.participant_id===input.participantIds[index]))
    throw new AppError(409,'unchanged_family_group');
  if (input.participantIds.length) {
    const active=(await db.prepare(`SELECT id FROM participant WHERE status='ACTIVE' AND
      id IN (${input.participantIds.map(()=>'?').join(',')})`).bind(...input.participantIds).all()).results;
    if (active.length!==input.participantIds.length) fail('invalid_family_group');
    const assigned=(await db.prepare(`SELECT participant_id,group_id FROM annual_fee_family_member WHERE round_id=? AND
      participant_id IN (${input.participantIds.map(()=>'?').join(',')})`)
      .bind(group.round_id,...input.participantIds).all()).results;
    if (assigned.some(row=>row.group_id!==id)) throw new AppError(409,'participant_in_other_family_group');
  }
  const oldOrder=new Map(before.map(row=>[row.participant_id,row.sibling_ordinal]));
  const newOrder=new Map(input.participantIds.map((participantId,index)=>[participantId,index+1]));
  const affected=[...new Set([...oldOrder.keys(),...newOrder.keys()])];
  const obligations=(await db.prepare(`SELECT o.*,
    (SELECT COALESCE(SUM(a.amount_cents),0) FROM annual_fee_allocation a WHERE a.obligation_id=o.id) AS allocated_cents,
    EXISTS(SELECT 1 FROM annual_fee_installment_plan p WHERE p.obligation_id=o.id) AS has_installment
    FROM annual_fee_obligation o WHERE o.round_id=? AND o.participant_id IN (${affected.map(()=>'?').join(',')})`)
    .bind(group.round_id,...affected).all()).results;
  const obligationByPerson=new Map(obligations.map(row=>[row.participant_id,row]));
  const changes=[];
  for (const participantId of affected) {
    const row=obligationByPerson.get(participantId);
    if (!row) continue;
    const ordinal=newOrder.get(participantId)??1;
    const discount=ordinal>=3?Math.floor(row.base_cents/2):0;
    if (row.override_by && discount!==row.discount_cents) throw new AppError(409,'family_override_review_required');
    const amountDue=row.override_by?row.amount_due_cents:row.base_cents-discount;
    if (amountDue<row.allocated_cents) throw new AppError(409,'family_allocation_conflict');
    if (row.has_installment && amountDue!==row.amount_due_cents) throw new AppError(409,'installment_plan_exists');
    changes.push({row,groupId:newOrder.has(participantId)?id:null,ordinal,discount,amountDue,
      amountChanged:amountDue!==row.amount_due_cents,discountChanged:discount!==row.discount_cents});
  }
  const changeByPerson=new Map(changes.map(change=>[change.row.participant_id,change]));
  const revisionId=uuid();
  const correctionIssues=[];
  for (const change of changes.filter(item=>item.amountChanged && item.row.allocated_cents>0)) {
    const payments=(await db.prepare(`SELECT DISTINCT p.id,p.receipt_email FROM annual_fee_allocation a
      JOIN annual_fee_payment p ON p.id=a.payment_id WHERE a.obligation_id=?`).bind(change.row.id).all()).results;
    correctionIssues.push({change,id:uuid(),payments});
  }
  try { await db.batch([
    ...(creation?[db.prepare(`INSERT INTO annual_fee_family_group
      (id,round_id,reference,created_by,created_at) VALUES(?,?,?,?,?)`)
      .bind(id,group.round_id,creation.reference,context.userId,now),
    audit(db,context,requestId,'FEE_FAMILY_GROUP_CREATED','annual_fee_family_group',id,now)]:[]),
    db.prepare(`UPDATE annual_fee_family_group SET ${versionCas('version')} WHERE id=?`)
      .bind(group.version,id),
    db.prepare('INSERT INTO annual_fee_family_correction_gate(group_id,opened_at) VALUES(?,?)').bind(id,now),
    db.prepare('DELETE FROM annual_fee_family_member WHERE group_id=?').bind(id),
    // Compare-and-set on the whole financial state of each obligation (see concurrency.js).
    ...changes.map(change=>db.prepare(`UPDATE annual_fee_obligation SET family_group_id=?,sibling_ordinal=?,
      discount_cents=?,amount_due_cents=?,updated_at=CASE WHEN amount_due_cents=? AND discount_cents=?
      AND sibling_ordinal=? AND family_group_id IS ? AND override_by IS ? AND
      (SELECT COALESCE(SUM(amount_cents),0) FROM annual_fee_allocation WHERE obligation_id=annual_fee_obligation.id)=?
      AND EXISTS(SELECT 1 FROM annual_fee_installment_plan WHERE obligation_id=annual_fee_obligation.id)=?
      THEN ? ELSE NULL END WHERE id=?`)
      .bind(change.groupId,change.ordinal,change.discount,change.amountDue,
        change.row.amount_due_cents,change.row.discount_cents,change.row.sibling_ordinal,
        change.row.family_group_id,change.row.override_by,change.row.allocated_cents,
        change.row.has_installment,now,change.row.id)),
    ...input.participantIds.map((participantId,index)=>db.prepare(`INSERT INTO annual_fee_family_member
      (group_id,round_id,participant_id,sibling_ordinal,assigned_by,assigned_at) VALUES(?,?,?,?,?,?)`)
      .bind(id,group.round_id,participantId,index+1,context.userId,now)),
    db.prepare(`INSERT INTO annual_fee_family_revision
      (id,group_id,previous_version,new_version,changed_by,changed_at) VALUES(?,?,?,?,?,?)`)
      .bind(revisionId,id,group.version,group.version+1,context.userId,now),
    ...affected.map(participantId=>{
      const change=changeByPerson.get(participantId);
      return db.prepare(`INSERT INTO annual_fee_family_revision_member
        (revision_id,participant_id,previous_group_id,new_group_id,previous_ordinal,new_ordinal,
          previous_discount_cents,new_discount_cents,previous_amount_due_cents,new_amount_due_cents)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(revisionId,participantId,oldOrder.has(participantId)?id:null,
          newOrder.has(participantId)?id:null,oldOrder.get(participantId)??null,newOrder.get(participantId)??null,
          change?.row.discount_cents??null,change?.discount??null,change?.row.amount_due_cents??null,
          change?.amountDue??null);
    }),
    ...changes.filter(change=>change.amountChanged).map(change=>db.prepare(`INSERT INTO annual_fee_amount_revision
      (id,obligation_id,previous_amount_cents,new_amount_cents,changed_by,changed_at) VALUES(?,?,?,?,?,?)`)
      .bind(uuid(),change.row.id,change.row.amount_due_cents,change.amountDue,context.userId,now)),
    audit(db,context,requestId,'FEE_FAMILY_CORRECTED','annual_fee_family_group',id,now),
    ...changes.filter(change=>change.discountChanged).map(change=>
      audit(db,context,requestId,'FEE_DISCOUNT_RECALCULATED','annual_fee_obligation',change.row.id,now)),
    ...correctionIssues.flatMap(({change,id:issueId,payments})=>{
      return [db.prepare(`INSERT INTO annual_fee_issue
        (id,round_id,obligation_id,code,created_by,created_at) VALUES(?,?,?,'DISCREPANCY',?,?)`)
        .bind(issueId,group.round_id,change.row.id,context.userId,now),
      audit(db,context,requestId,'FEE_ISSUE_OPENED','annual_fee_issue',issueId,now),
      ...payments.flatMap(payment=>{
        const queued=issueQueue(db,issueId,payment,now);
        return [queued.query,audit(db,context,requestId,'NOTIFICATION_QUEUED','annual_fee_issue_outbox',queued.id,now)];
      })];
    }),
    db.prepare('DELETE FROM annual_fee_family_correction_gate WHERE group_id=?').bind(id)
  ]); } catch(error) {
    if (!creation) {
      const current=await db.prepare('SELECT version FROM annual_fee_family_group WHERE id=?').bind(id).first();
      if (!current || current.version!==group.version) throw new AppError(409,'stale_family_group');
    }
    if (/annual_fee_obligation\.updated_at|fee_allocation_exceeds_amount_due|invalid_installment_total/.test(error?.message??''))
      throw new AppError(409,'stale_family_financial_state');
    throw error;
  }
  return {id,revisionId};
}
export async function familyGroupRevisions(db,context,requestId,id) {
  await globalPermission(db,context,requestId,'finance.family.read','annual_fee_family_group',id);
  const group=await db.prepare('SELECT id FROM annual_fee_family_group WHERE id=?').bind(requireUuid(id)).first();
  if (!group) throw new AppError(404,'not_found');
  const revisions=(await db.prepare(`SELECT id,previous_version,new_version,changed_by,changed_at
    FROM annual_fee_family_revision WHERE group_id=? ORDER BY changed_at DESC,id DESC LIMIT 50`).bind(id).all()).results;
  for (const revision of revisions) revision.members=(await db.prepare(`SELECT participant_id,previous_group_id,new_group_id,
    previous_ordinal,new_ordinal,previous_discount_cents,new_discount_cents,
    previous_amount_due_cents,new_amount_due_cents FROM annual_fee_family_revision_member
    WHERE revision_id=? ORDER BY participant_id`).bind(revision.id).all()).results;
  return revisions;
}
export async function createObligation(db,context,requestId,input,now=Date.now()) {
  if (!keysOnly(input,['roundId','participantId']) || !validUuid(input.roundId) || !validUuid(input.participantId)) fail('invalid_fee_obligation');
  const person=await db.prepare("SELECT id,current_section_id FROM participant WHERE id=? AND status='ACTIVE'").bind(input.participantId).first();
  if (!person) throw new AppError(404,'not_found');
  await requirePermission(db,context,requestId,'finance.fee.manage',
    {sectionId:person.current_section_id,resourceType:'annual_fee_obligation'});
  const round=await roundById(db,input.roundId);
  const family=await db.prepare('SELECT group_id,sibling_ordinal FROM annual_fee_family_member WHERE round_id=? AND participant_id=?')
    .bind(input.roundId,input.participantId).first();
  const ordinal=family?.sibling_ordinal??1;
  const discount=ordinal>=round.discount_from_ordinal?Math.floor(round.base_cents*round.discount_percent/100):0;
  const id=uuid();
  await db.batch([
    db.prepare(`INSERT INTO annual_fee_obligation(id,round_id,participant_id,family_group_id,sibling_ordinal,
      base_cents,discount_cents,amount_due_cents,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id,input.roundId,input.participantId,family?.group_id??null,ordinal,round.base_cents,discount,
        round.base_cents-discount,context.userId,now,now),
    audit(db,context,requestId,'FEE_OBLIGATION_CREATED','annual_fee_obligation',id,now),
    ...(discount?[audit(db,context,requestId,'FEE_DISCOUNT_APPLIED','annual_fee_obligation',id,now)]:[])
  ]);
  return {id,amountDueCents:round.base_cents-discount,siblingOrdinal:ordinal};
}
export async function overrideAmount(db,context,requestId,id,input,now=Date.now()) {
  requireUuid(id);
  if (!keysOnly(input,['amountDueCents']) || !cents(input.amountDueCents) || input.amountDueCents>1000000) fail('invalid_fee_amount');
  const row=await db.prepare(`SELECT o.*,p.current_section_id FROM annual_fee_obligation o JOIN participant p ON p.id=o.participant_id WHERE o.id=?`).bind(id).first();
  if (!row) throw new AppError(404,'not_found');
  await requirePermission(db,context,requestId,'finance.fee.manage',
    {sectionId:row.current_section_id,resourceType:'annual_fee_obligation',resourceId:id});
  if (await db.prepare('SELECT 1 FROM annual_fee_installment_plan WHERE obligation_id=?').bind(id).first())
    throw new AppError(409,'installment_plan_exists');
  if (row.amount_due_cents===input.amountDueCents) throw new AppError(409,'unchanged_fee_amount');
  await db.batch([
    db.prepare('UPDATE annual_fee_obligation SET amount_due_cents=?,override_by=?,override_at=?,updated_at=? WHERE id=?')
      .bind(input.amountDueCents,context.userId,now,now,id),
    db.prepare(`INSERT INTO annual_fee_amount_revision
      (id,obligation_id,previous_amount_cents,new_amount_cents,changed_by,changed_at) VALUES(?,?,?,?,?,?)`)
      .bind(uuid(),id,row.amount_due_cents,input.amountDueCents,context.userId,now),
    audit(db,context,requestId,'FEE_AMOUNT_OVERRIDDEN','annual_fee_obligation',id,now)
  ]);
  return {id};
}

async function payloadHash(value) {
  const bytes=new TextEncoder().encode(JSON.stringify(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
    .map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
function validSubmission(input) {
  if (!keysOnly(input,['roundCode','children','submittedByName','contactPhone','receiptEmail','declaredAmountCents',
    'privacyAcknowledged','privacyNoticeVersion','idempotencyKey','evidence']) ||
    !roundCode(input.roundCode) || !Array.isArray(input.children) || input.children.length<1 || input.children.length>8 ||
    input.children.some(child=>!keysOnly(child,['name','birthDate','sectionCode']) ||
      typeof child.name!=='string' || child.name.length>120 || matchKey(child.name).length<2 ||
      !nowDate(child.birthDate) || !['MANADA','TROPA','ESCOLTA','CLAN'].includes(child.sectionCode)) ||
    typeof input.submittedByName!=='string' || input.submittedByName.trim().length<2 || input.submittedByName.length>120 ||
    !email(input.receiptEmail) ||
    (input.contactPhone!=null && (typeof input.contactPhone!=='string' || input.contactPhone.length>24 ||
      (input.contactPhone.trim() && (!/^[0-9+()\s.\-]{6,24}$/.test(input.contactPhone.trim()) ||
        input.contactPhone.replace(/\D/g,'').length<6 || input.contactPhone.replace(/\D/g,'').length>15)))) ||
    (input.declaredAmountCents!=null && !cents(input.declaredAmountCents)) ||
    input.privacyAcknowledged!==true || input.privacyNoticeVersion!==synthetic.terms.feePrivacy ||
    typeof input.idempotencyKey!=='string' || !/^[A-Za-z0-9_-]{16,100}$/.test(input.idempotencyKey))
    fail('invalid_fee_submission');
  const names=input.children.map(child=>[matchKey(child.name),child.birthDate,child.sectionCode].join('|'));
  if (new Set(names).size!==names.length) fail('invalid_fee_submission');
}
async function previousSubmission(db,key,hash,children) {
  const row=await db.prepare('SELECT id,payload_sha256 FROM annual_fee_payment WHERE idempotency_key=?').bind(key).first();
  if (!row) return null;
  if (row.payload_sha256!==hash) throw new AppError(409,'idempotency_conflict');
  const saved=(await db.prepare(`SELECT submitted_birth_date FROM annual_fee_submission_person
    WHERE payment_id=? ORDER BY rowid`).bind(row.id).all()).results;
  if (saved.length!==children.length || saved.some((person,index)=>
    person.submitted_birth_date && person.submitted_birth_date!==children[index].birthDate))
    throw new AppError(409,'idempotency_conflict');
  return row.id;
}
function feeQueue(db,paymentId,kind,recipient,now) {
  if (!email(recipient)) fail('synthetic_email_required');
  const id=uuid();
  return {id,query:db.prepare(`INSERT INTO annual_fee_notification_outbox
    (id,payment_id,kind,recipient_email,created_at) VALUES(?,?,?,?,?)
    ON CONFLICT(payment_id,kind) DO NOTHING`).bind(id,paymentId,kind,recipient,now)};
}
function issueQueue(db,issueId,payment,now) {
  if (!email(payment.receipt_email)) fail('synthetic_email_required');
  const id=uuid();
  return {id,query:db.prepare(`INSERT INTO annual_fee_issue_outbox
    (id,issue_id,payment_id,recipient_email,created_at) VALUES(?,?,?,?,?)
    ON CONFLICT(issue_id,payment_id) DO NOTHING`).bind(id,issueId,payment.id,payment.receipt_email,now)};
}
export async function submitFee(db,storage,input,requestId,now=Date.now()) {
  validSubmission(input);
  const round=await db.prepare('SELECT * FROM annual_fee_round WHERE code=?').bind(input.roundCode).first();
  if (!round) throw new AppError(404,'fee_round_unavailable');
  const evidence=await validateSyntheticEvidence(input.evidence);
  // The digest binds dates for idempotency without persisting a redundant plaintext date after clear matching.
  const hash=await payloadHash([round.id,input.children.map(child=>[matchKey(child.name),child.birthDate,child.sectionCode]),
    input.submittedByName.trim(),input.contactPhone?.trim()??'',input.receiptEmail.toLowerCase(),
    input.declaredAmountCents??null,input.privacyNoticeVersion,evidence.sha256]);
  const prior=await previousSubmission(db,input.idempotencyKey,hash,input.children);
  if (prior) return {ok:true,reference:prior};
  if (!round.is_open) throw new AppError(404,'fee_round_unavailable');
  const sections=(await db.prepare('SELECT id,code FROM section').all()).results;
  const submitted=[];
  for (const child of input.children) {
    const sectionId=sections.find(section=>section.code===child.sectionCode)?.id;
    const found=await findMatch(db,matchKey(child.name),child.birthDate,sectionId,[sectionId]);
    submitted.push({id:uuid(),name:child.name.trim(),key:matchKey(child.name),birthDate:child.birthDate,
      sectionId,matchStatus:found.status,participantId:found.participant?.id??null});
  }
  const clearIds=submitted.filter(person=>person.participantId).map(person=>person.participantId);
  if (new Set(clearIds).size!==clearIds.length) fail('invalid_fee_submission');
  const paymentId=uuid(),evidenceId=uuid(),objectKey=evidenceKey(),queued=feeQueue(db,paymentId,
    'FEE_SUBMISSION_RECEIVED',input.receiptEmail.toLowerCase(),now);
  await storeEvidence(storage,objectKey,evidence);
  try {
    await db.batch([
      db.prepare(`INSERT INTO annual_fee_payment(id,round_id,receipt_email,submitted_by_name,contact_phone,
        declared_amount_cents,idempotency_key,payload_sha256,privacy_notice_version,privacy_notice_acknowledged_at,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(paymentId,round.id,input.receiptEmail.toLowerCase(),
        input.submittedByName.trim(),input.contactPhone?.trim()||null,input.declaredAmountCents??null,
        input.idempotencyKey,hash,input.privacyNoticeVersion,now,now),
      ...submitted.map(person=>db.prepare(`INSERT INTO annual_fee_submission_person(id,payment_id,submitted_name,match_key,
        submitted_birth_date,section_id,participant_id,match_status) VALUES(?,?,?,?,?,?,?,?)`)
        .bind(person.id,paymentId,person.name,person.key,person.participantId?null:person.birthDate,
          person.sectionId,person.participantId,person.matchStatus)),
      db.prepare(`INSERT INTO annual_fee_evidence(id,payment_id,object_key,sha256,size_bytes,detected_mime,created_at)
        VALUES(?,?,?,?,?,?,?)`).bind(evidenceId,paymentId,objectKey,evidence.sha256,evidence.bytes.length,evidence.mime,now),
      audit(db,null,requestId,'FEE_SUBMISSION_RECEIVED','annual_fee_payment',paymentId,now),
      audit(db,null,requestId,'FEE_EVIDENCE_RECEIVED','annual_fee_evidence',evidenceId,now),
      queued.query,audit(db,null,requestId,'NOTIFICATION_QUEUED','annual_fee_notification_outbox',queued.id,now)
    ]);
  } catch(error) {
    await storage.delete(objectKey).catch(()=>{});
    const raced=await previousSubmission(db,input.idempotencyKey,hash,input.children);
    if (raced) return {ok:true,reference:raced};
    throw error;
  }
  return {ok:true,reference:paymentId};
}

async function paymentAccess(db,context,requestId,paymentId,permission='finance.fee.payment.review',conceal=false) {
  requireUuid(paymentId);
  const row=await db.prepare('SELECT * FROM annual_fee_payment WHERE id=?').bind(paymentId).first();
  if (!row) throw new AppError(404,'not_found');
  await requirePermission(db,context,requestId,permission,
    {mode:'list',resourceType:'annual_fee_payment',resourceId:paymentId});
  const people=(await db.prepare(`SELECT s.id,s.section_id,s.participant_id,p.current_section_id
    FROM annual_fee_submission_person s LEFT JOIN participant p ON p.id=s.participant_id
    WHERE s.payment_id=?`).bind(paymentId).all()).results;
  if (!people.length) throw new AppError(403,'forbidden');
  for (const person of people) {
    const sectionId=person.participant_id?person.current_section_id:person.section_id;
    if (!sectionId) throw new AppError(403,'forbidden');
    await requirePermission(db,context,requestId,permission,
      {sectionId,resourceType:'annual_fee_submission_person',resourceId:person.id,conceal});
  }
  await fundedObligationAccess(db,context,requestId,paymentId,permission,conceal);
  return row;
}
async function fundedObligationAccess(db,context,requestId,paymentId,permission='finance.fee.payment.review',conceal=false) {
  const funded=(await db.prepare(`SELECT DISTINCT o.id,p.current_section_id FROM annual_fee_allocation a
    JOIN annual_fee_obligation o ON o.id=a.obligation_id JOIN participant p ON p.id=o.participant_id
    WHERE a.payment_id=?`).bind(paymentId).all()).results;
  for (const row of funded) await requirePermission(db,context,requestId,permission,
    {sectionId:row.current_section_id,resourceType:'annual_fee_obligation',resourceId:row.id,conceal});
  return funded;
}
export async function listFeePayments(db,context,requestId,roundId,params=null) {
  const page=pageRequest(params,['number','string']);
  const decision=await requirePermission(db,context,requestId,'finance.fee.payment.review',{mode:'list',resourceType:'annual_fee_payment'});
  requireUuid(roundId);
  const scoped=decision.sections!==null;
  const sections=scoped?decision.sections.map(()=>'?').join(','):'';
  const scope=!scoped?'':` AND EXISTS(SELECT 1 FROM annual_fee_submission_person s WHERE s.payment_id=p.id)
    AND NOT EXISTS(SELECT 1 FROM annual_fee_submission_person s
      LEFT JOIN participant person ON person.id=s.participant_id WHERE s.payment_id=p.id AND
      (CASE WHEN s.participant_id IS NULL THEN s.section_id ELSE person.current_section_id END IS NULL OR
       CASE WHEN s.participant_id IS NULL THEN s.section_id ELSE person.current_section_id END NOT IN (${sections})))
    AND NOT EXISTS(SELECT 1 FROM annual_fee_allocation a
      JOIN annual_fee_obligation o ON o.id=a.obligation_id
      JOIN participant person ON person.id=o.participant_id WHERE a.payment_id=p.id
      AND person.current_section_id NOT IN (${sections}))`;
  // 3.5G.1A: no submitter name, e-mail or phone in listings (contact only through feePaymentContact).
  const rows=(await db.prepare(`SELECT p.id,p.round_id,p.review_status,p.declared_amount_cents,p.verified_amount_cents,
    p.created_at,e.id AS evidence_id,
    (SELECT count(*) FROM annual_fee_submission_person s WHERE s.payment_id=p.id) AS people_count,
    (SELECT count(*) FROM annual_fee_submission_person s WHERE s.payment_id=p.id AND s.match_status IN ('AMBIGUOUS','NONE')) AS pending_matches
    FROM annual_fee_payment p JOIN annual_fee_evidence e ON e.payment_id=p.id WHERE p.round_id=?${scope}
    ${page.after?'AND (p.created_at<? OR (p.created_at=? AND p.id<?))':''}
    ORDER BY p.created_at DESC,p.id DESC LIMIT ?`).bind(roundId,...(decision.sections??[]),...(decision.sections??[]),
      ...(page.after?[page.after[0],page.after[0],page.after[1]]:[]),page.limit+1).all()).results;
  const result=pageResult(rows,page.limit,row=>[row.created_at,row.id]);
  return {payments:result.items,nextCursor:result.nextCursor};
}
// 3.5G.1A: an explicit projection. Contact (submitter, e-mail, phone), idempotency key, payload hash,
// privacy-notice metadata and the declared birth date never leave the server through this read.
export async function feePaymentDetail(db,context,requestId,id) {
  const row=await paymentAccess(db,context,requestId,id,undefined,true);
  const balance=await db.prepare('SELECT unallocated_cents FROM annual_fee_payment_balance WHERE id=?').bind(id).first();
  const evidence=await db.prepare('SELECT id,detected_mime,size_bytes,created_at FROM annual_fee_evidence WHERE payment_id=?').bind(id).first();
  const payment={id:row.id,round_id:row.round_id,review_status:row.review_status,
    declared_amount_cents:row.declared_amount_cents,verified_amount_cents:row.verified_amount_cents,
    allocation_version:row.allocation_version,created_at:row.created_at,reviewed_at:row.reviewed_at,
    evidence:evidence?{id:evidence.id,mime:evidence.detected_mime,sizeBytes:evidence.size_bytes,receivedAt:evidence.created_at}:null};
  const people=(await db.prepare(`SELECT s.id,s.submitted_name,s.section_id,s.participant_id,
    s.match_status FROM annual_fee_submission_person s WHERE s.payment_id=? ORDER BY s.rowid`).bind(id).all()).results;
  const allocations=(await db.prepare(`SELECT a.id,a.obligation_id,a.amount_cents FROM annual_fee_allocation a
    WHERE a.payment_id=? ORDER BY a.created_at,a.id`).bind(id).all()).results;
  const allocationRevisions=(await db.prepare(`SELECT obligation_id,previous_amount_cents,new_amount_cents,
    changed_by,changed_at FROM annual_fee_allocation_revision WHERE payment_id=?
    ORDER BY changed_at DESC,id DESC LIMIT 100`).bind(id).all()).results;
  const linked=people.filter(person=>person.participant_id).map(person=>person.participant_id);
  const eligibleObligations=linked.length?(await db.prepare(`SELECT id,participant_id,amount_due_cents,allocated_cents,status
    FROM annual_fee_obligation_status WHERE round_id=? AND participant_id IN (${linked.map(()=>'?').join(',')})`)
    .bind(payment.round_id,...linked).all()).results:[];
  return {payment:{...payment,unallocated_cents:balance?.unallocated_cents??null},people,allocations,allocationRevisions,eligibleObligations};
}
export async function reviewFeeMatch(db,context,requestId,id,input,now=Date.now()) {
  requireUuid(id);
  if (!keysOnly(input,['decision','participantId']) || !['MATCH','REJECT'].includes(input.decision) ||
    (input.decision==='MATCH' && !validUuid(input.participantId)) ||
    (input.decision==='REJECT' && input.participantId!=null)) fail('invalid_fee_match');
  const row=await db.prepare('SELECT * FROM annual_fee_submission_person WHERE id=?').bind(id).first();
  if (!row) throw new AppError(404,'not_found');
  await paymentAccess(db,context,requestId,row.payment_id);
  if (!['AMBIGUOUS','NONE'].includes(row.match_status)) throw new AppError(409,'invalid_transition');
  let participant=null;
  if (input.decision==='MATCH') {
    participant=await db.prepare("SELECT id,current_section_id FROM participant WHERE id=? AND status='ACTIVE'")
      .bind(input.participantId).first();
    if (!participant || participant.current_section_id!==row.section_id) throw new AppError(404,'not_found');
  }
  await db.batch([
    db.prepare(`UPDATE annual_fee_submission_person SET participant_id=?,match_status=?,submitted_birth_date=NULL,
      reviewed_by=?,reviewed_at=? WHERE id=? AND match_status IN ('AMBIGUOUS','NONE')`)
      .bind(participant?.id??null,participant?'RESOLVED':'REJECTED',context.userId,now,id),
    audit(db,context,requestId,'FEE_MATCH_REVIEWED','annual_fee_submission_person',id,now)
  ]);
  return {id,status:participant?'RESOLVED':'REJECTED'};
}
export async function feeMatchCandidates(db,context,requestId,id,search=null) {
  const row=await db.prepare(`SELECT payment_id,section_id,match_status,submitted_name,submitted_birth_date
    FROM annual_fee_submission_person WHERE id=?`).bind(requireUuid(id)).first();
  if (!row) throw new AppError(404,'not_found');
  await paymentAccess(db,context,requestId,row.payment_id,undefined,true);
  if (!['AMBIGUOUS','NONE'].includes(row.match_status)) throw new AppError(409,'invalid_transition');
  // Resolution must stay in the declared section (reviewFeeMatch enforces the same rule).
  return matchCandidates(db,context,{submittedName:row.submitted_name,submittedBirthDate:row.submitted_birth_date,
    sectionIds:[row.section_id],search});
}
// Submitter contact of a fee payment, on demand (3.5G.1A): explicit permission, the same scope rule as
// the payment (every person and funded obligation), audited without the values.
export async function feePaymentContact(db,context,requestId,id) {
  const row=await paymentAccess(db,context,requestId,id,'finance.fee.contact.read',true);
  await append(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,action:'SENSITIVE_DATA_READ',
    resourceType:'annual_fee_payment',resourceId:id,result:'SUCCESS',reasonCode:'FEE_CONTACT_CONSULTED'});
  return {submittedByName:row.submitted_by_name,email:row.receipt_email,phone:row.contact_phone??null};
}
const EVIDENCE_EXTENSIONS={'application/pdf':'pdf','image/png':'png','image/jpeg':'jpg','image/webp':'webp'};
// View (inline inside Gestió) or download, both audited like 3.5F payment evidence (3.5G.1A).
export async function feeEvidenceDownload(db,storage,context,requestId,id,mode='download') {
  if (!['view','download'].includes(mode)) throw new AppError(400,'invalid_filter');
  const row=await db.prepare('SELECT id,payment_id,object_key,detected_mime,created_at FROM annual_fee_evidence WHERE id=?')
    .bind(requireUuid(id)).first();
  if (!row) throw new AppError(404,'not_found');
  await paymentAccess(db,context,requestId,row.payment_id,undefined,true);
  const extension=EVIDENCE_EXTENSIONS[row.detected_mime];
  if (!extension) throw new AppError(500,'invalid_evidence');
  const response=await readEvidence(storage,row.object_key,{mime:row.detected_mime,mode,
    filename:`justificant-quota-${new Date(row.created_at).toISOString().slice(0,10)}.${extension}`});
  await append(db,{requestId,actorUserId:context.userId,sessionId:context.sessionId,
    action:mode==='view'?'FEE_EVIDENCE_VIEWED':'FEE_EVIDENCE_DOWNLOADED',resourceType:'annual_fee_evidence',resourceId:id,result:'SUCCESS'});
  return response;
}

export async function reviewFeePayment(db,context,requestId,id,input,now=Date.now()) {
  const payment=await paymentAccess(db,context,requestId,id);
  if (!keysOnly(input,['verifiedAmountCents','allocations']) || !cents(input.verifiedAmountCents) ||
    !Array.isArray(input.allocations) || input.allocations.length<1 || input.allocations.length>8 ||
    input.allocations.some(item=>!keysOnly(item,['obligationId','amountCents']) ||
      !validUuid(item.obligationId) || !cents(item.amountCents)) ||
    new Set(input.allocations.map(item=>item.obligationId)).size!==input.allocations.length ||
    input.allocations.reduce((sum,item)=>sum+item.amountCents,0)>input.verifiedAmountCents) fail('invalid_fee_review');
  if (!['PENDING_REVIEW','ISSUE'].includes(payment.review_status) || payment.verified_amount_cents!==null)
    throw new AppError(409,'invalid_transition');
  const people=(await db.prepare('SELECT participant_id,match_status FROM annual_fee_submission_person WHERE payment_id=?')
    .bind(id).all()).results;
  if (!people.length || people.some(person=>!['CLEAR','RESOLVED'].includes(person.match_status)))
    throw new AppError(409,'fee_match_review_required');
  const allowedPeople=new Set(people.map(person=>person.participant_id));
  const obligations=[];
  for (const allocation of input.allocations) {
    const row=await db.prepare('SELECT * FROM annual_fee_obligation_status WHERE id=?').bind(allocation.obligationId).first();
    if (!row || row.round_id!==payment.round_id || !allowedPeople.has(row.participant_id)) fail('invalid_fee_allocation');
    obligations.push({...row,amount:allocation.amountCents});
  }
  const issues=obligations.filter(row=>row.allocated_cents+row.amount>row.amount_due_cents);
  const unallocated=input.verifiedAmountCents-input.allocations.reduce((sum,row)=>sum+row.amountCents,0);
  const paid=obligations.some(row=>row.allocated_cents+row.amount===row.amount_due_cents);
  const existingNotices=(await db.prepare('SELECT kind FROM annual_fee_notification_outbox WHERE payment_id=?')
    .bind(id).all()).results;
  const notified=new Set(existingNotices.map(row=>row.kind));
  const notifications=[];
  if (paid && !notified.has('FEE_PAYMENT_CONFIRMED')) notifications.push(feeQueue(db,id,'FEE_PAYMENT_CONFIRMED',payment.receipt_email,now));
  const openedIssues=[...issues.map(row=>({id:uuid(),obligationId:row.id,code:'OVERPAYMENT'})),
    ...(unallocated>0?[{id:uuid(),obligationId:null,code:'ALLOCATION_UNCLEAR'}]:[])];
  await db.batch([
    db.prepare(`UPDATE annual_fee_payment SET verified_amount_cents=?,reviewed_by=?,reviewed_at=?,review_status='ISSUE'
      WHERE id=? AND verified_amount_cents IS NULL AND review_status IN ('PENDING_REVIEW','ISSUE')`)
      .bind(input.verifiedAmountCents,context.userId,now,id),
    ...obligations.map(row=>db.prepare(`INSERT INTO annual_fee_allocation
      (id,payment_id,obligation_id,amount_cents,created_by,created_at) VALUES(?,?,?,?,?,?)`)
      .bind(uuid(),id,row.id,row.amount,context.userId,now)),
    db.prepare("UPDATE annual_fee_payment SET review_status='VERIFIED' WHERE id=? AND verified_amount_cents=?")
      .bind(id,input.verifiedAmountCents),
    audit(db,context,requestId,'FEE_PAYMENT_VERIFIED','annual_fee_payment',id,now),
    ...obligations.map(row=>audit(db,context,requestId,'FEE_ALLOCATION_CREATED','annual_fee_obligation',row.id,now)),
    ...openedIssues.flatMap(issue=>{
      return [db.prepare(`INSERT INTO annual_fee_issue
        (id,round_id,payment_id,obligation_id,code,created_by,created_at) VALUES(?,?,?,?,?,?,?)`)
        .bind(issue.id,payment.round_id,id,issue.obligationId,issue.code,context.userId,now),
      audit(db,context,requestId,'FEE_ISSUE_OPENED','annual_fee_issue',issue.id,now),
      ...(()=>{const queued=issueQueue(db,issue.id,payment,now);return [queued.query,
        audit(db,context,requestId,'NOTIFICATION_QUEUED','annual_fee_issue_outbox',queued.id,now)];})()];
    }),
    ...notifications.flatMap(queued=>[queued.query,
      audit(db,context,requestId,'NOTIFICATION_QUEUED','annual_fee_notification_outbox',queued.id,now)])
  ]);
  return {id,status:'VERIFIED'};
}

export async function reviseFeeAllocations(db,context,requestId,id,input,now=Date.now()) {
  const payment=await paymentAccess(db,context,requestId,id);
  if (payment.review_status!=='VERIFIED' || payment.verified_amount_cents===null)
    throw new AppError(409,'invalid_transition');
  if (!keysOnly(input,['allocations','expectedVersion']) || !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion<1 || !Array.isArray(input.allocations) || input.allocations.length<1 ||
    input.allocations.length>8 || input.allocations.some(item=>!keysOnly(item,['obligationId','amountCents']) ||
      !validUuid(item.obligationId) || !cents(item.amountCents)) ||
    new Set(input.allocations.map(item=>item.obligationId)).size!==input.allocations.length ||
    input.allocations.reduce((sum,item)=>sum+item.amountCents,0)>payment.verified_amount_cents)
    fail('invalid_fee_allocation');
  if (payment.allocation_version!==input.expectedVersion) throw new AppError(409,'stale_fee_allocation');
  const people=(await db.prepare(`SELECT participant_id FROM annual_fee_submission_person
    WHERE payment_id=? AND match_status IN ('CLEAR','RESOLVED')`).bind(id).all()).results;
  const allowed=new Set(people.map(row=>row.participant_id));
  const previous=(await db.prepare('SELECT obligation_id,amount_cents FROM annual_fee_allocation WHERE payment_id=?')
    .bind(id).all()).results;
  if (!previous.length) throw new AppError(409,'invalid_transition');
  const previousById=new Map(previous.map(row=>[row.obligation_id,row.amount_cents]));
  const obligations=[];
  for (const item of input.allocations) {
    const row=await db.prepare('SELECT * FROM annual_fee_obligation_status WHERE id=?').bind(item.obligationId).first();
    if (!row || row.round_id!==payment.round_id || !allowed.has(row.participant_id)) fail('invalid_fee_allocation');
    obligations.push({...row,amount:item.amountCents});
  }
  const issues=obligations.filter(row=>row.allocated_cents-(previousById.get(row.id)??0)+row.amount>row.amount_due_cents);
  const newPaid=obligations.some(row=>row.allocated_cents-(previousById.get(row.id)??0)+row.amount===row.amount_due_cents &&
    row.allocated_cents!==row.amount_due_cents);
  const existing=(await db.prepare('SELECT kind FROM annual_fee_notification_outbox WHERE payment_id=?').bind(id).all()).results;
  const notified=new Set(existing.map(row=>row.kind));
  const queued=[];
  if (newPaid && !notified.has('FEE_PAYMENT_CONFIRMED')) queued.push(feeQueue(db,id,'FEE_PAYMENT_CONFIRMED',payment.receipt_email,now));
  const unallocated=payment.verified_amount_cents-input.allocations.reduce((sum,row)=>sum+row.amountCents,0);
  const existingBalanceIssue=await db.prepare(`SELECT 1 FROM annual_fee_issue WHERE payment_id=?
    AND obligation_id IS NULL AND code='ALLOCATION_UNCLEAR' AND status='OPEN' LIMIT 1`).bind(id).first();
  const openedIssues=[...issues.map(row=>({id:uuid(),obligationId:row.id,code:'OVERPAYMENT'})),
    ...(unallocated>0 && !existingBalanceIssue?[{id:uuid(),obligationId:null,code:'ALLOCATION_UNCLEAR'}]:[])];
  const revisedById=new Map(obligations.map(row=>[row.id,row.amount]));
  const changedIds=[...new Set([...previousById.keys(),...revisedById.keys()])]
    .filter(obligationId=>(previousById.get(obligationId)??null)!==(revisedById.get(obligationId)??null));
  if (!changedIds.length) throw new AppError(409,'unchanged_fee_allocation');
  try { await db.batch([
    db.prepare(`UPDATE annual_fee_payment SET ${versionCas('allocation_version')} WHERE id=?`).bind(input.expectedVersion,id),
    db.prepare("UPDATE annual_fee_payment SET review_status='ISSUE' WHERE id=? AND review_status='VERIFIED'").bind(id),
    db.prepare('DELETE FROM annual_fee_allocation WHERE payment_id=?').bind(id),
    ...obligations.map(row=>db.prepare(`INSERT INTO annual_fee_allocation
      (id,payment_id,obligation_id,amount_cents,created_by,created_at) VALUES(?,?,?,?,?,?)`)
      .bind(uuid(),id,row.id,row.amount,context.userId,now)),
    db.prepare("UPDATE annual_fee_payment SET review_status='VERIFIED' WHERE id=? AND review_status='ISSUE'").bind(id),
    ...changedIds.map(obligationId=>db.prepare(`INSERT INTO annual_fee_allocation_revision
      (id,payment_id,obligation_id,previous_amount_cents,new_amount_cents,changed_by,changed_at)
      VALUES(?,?,?,?,?,?,?)`).bind(uuid(),id,obligationId,previousById.get(obligationId)??null,
      revisedById.get(obligationId)??null,context.userId,now)),
    audit(db,context,requestId,'FEE_ALLOCATION_REVISED','annual_fee_payment',id,now),
    ...openedIssues.flatMap(issue=>{
      return [db.prepare(`INSERT INTO annual_fee_issue
        (id,round_id,payment_id,obligation_id,code,created_by,created_at) VALUES(?,?,?,?,?,?,?)`)
        .bind(issue.id,payment.round_id,id,issue.obligationId,issue.code,context.userId,now),
      audit(db,context,requestId,'FEE_ISSUE_OPENED','annual_fee_issue',issue.id,now),
      ...(()=>{const notice=issueQueue(db,issue.id,payment,now);return [notice.query,
        audit(db,context,requestId,'NOTIFICATION_QUEUED','annual_fee_issue_outbox',notice.id,now)];})()];
    }),
    ...queued.flatMap(row=>[row.query,audit(db,context,requestId,'NOTIFICATION_QUEUED','annual_fee_notification_outbox',row.id,now)])
  ]); } catch(error) {
    const current=await db.prepare('SELECT allocation_version FROM annual_fee_payment WHERE id=?').bind(id).first();
    if (!current || current.allocation_version!==input.expectedVersion) throw new AppError(409,'stale_fee_allocation');
    throw error;
  }
  return {id,status:'VERIFIED'};
}

export async function openFeeIssue(db,context,requestId,input,now=Date.now()) {
  if (!keysOnly(input,['paymentId','obligationId','code']) ||
    (!validUuid(input.paymentId) && !validUuid(input.obligationId)) ||
    !['BANK_NOT_FOUND','OVERPAYMENT','EVIDENCE_PROBLEM','UNIDENTIFIED_TRANSFER','ALLOCATION_UNCLEAR','DISCREPANCY'].includes(input.code))
    fail('invalid_fee_issue');
  let payment=null,obligation=null;
  if (input.paymentId) {
    payment=await paymentAccess(db,context,requestId,input.paymentId);
  }
  if (input.obligationId) {
    obligation=await db.prepare('SELECT * FROM annual_fee_obligation_status WHERE id=?').bind(input.obligationId).first();
    if (!obligation) throw new AppError(404,'not_found');
    await requirePermission(db,context,requestId,payment?'finance.fee.payment.review':'finance.fee.manage',
      {sectionId:obligation.current_section_id,resourceType:'annual_fee_obligation',resourceId:obligation.id});
  }
  if (payment && obligation && payment.round_id!==obligation.round_id) fail('invalid_fee_issue');
  if (payment && obligation && !await db.prepare(`SELECT 1 FROM annual_fee_allocation
    WHERE payment_id=? AND obligation_id=?`).bind(payment.id,obligation.id).first()) fail('invalid_fee_issue');
  const repeated=await db.prepare(`SELECT id FROM annual_fee_issue WHERE status='OPEN' AND code=?
    AND payment_id IS ? AND obligation_id IS ? LIMIT 1`)
    .bind(input.code,payment?.id??null,obligation?.id??null).first();
  if (repeated) return {id:repeated.id};
  const id=uuid(),roundId=payment?.round_id??obligation.round_id;
  const queued=payment?issueQueue(db,id,payment,now):null;
  await db.batch([
    db.prepare(`INSERT INTO annual_fee_issue(id,round_id,payment_id,obligation_id,code,created_by,created_at)
      VALUES(?,?,?,?,?,?,?)`).bind(id,roundId,payment?.id??null,obligation?.id??null,input.code,context.userId,now),
    ...(payment && payment.review_status==='PENDING_REVIEW'?
      [db.prepare("UPDATE annual_fee_payment SET review_status='ISSUE' WHERE id=?").bind(payment.id)]:[]),
    audit(db,context,requestId,'FEE_ISSUE_OPENED','annual_fee_issue',id,now),
    ...(queued?[queued.query,audit(db,context,requestId,'NOTIFICATION_QUEUED','annual_fee_issue_outbox',queued.id,now)]:[])
  ]);
  return {id};
}
export async function resolveFeeIssue(db,context,requestId,id,now=Date.now()) {
  const row=await db.prepare('SELECT * FROM annual_fee_issue WHERE id=?').bind(requireUuid(id)).first();
  if (!row) throw new AppError(404,'not_found');
  if (row.payment_id) {
    await paymentAccess(db,context,requestId,row.payment_id);
  }
  if (row.obligation_id) {
    const obligation=await db.prepare(`SELECT o.id,p.current_section_id FROM annual_fee_obligation o
      JOIN participant p ON p.id=o.participant_id WHERE o.id=?`).bind(row.obligation_id).first();
    if (!obligation) throw new AppError(404,'not_found');
    await requirePermission(db,context,requestId,row.payment_id?'finance.fee.payment.review':'finance.fee.manage',
      {sectionId:obligation.current_section_id,resourceType:'annual_fee_obligation',resourceId:obligation.id});
  } else if (!row.payment_id) await globalPermission(db,context,requestId,'finance.fee.manage','annual_fee_issue',id);
  if (row.status!=='OPEN') throw new AppError(409,'invalid_transition');
  // ALLOCATION_UNCLEAR means verified money not yet assigned: it is resolved by assigning that balance
  // (allocation revision), never by closing the issue while euros remain unassigned. The 0008 trigger
  // enforces the same rule in the database; this check answers before any write.
  if (row.code==='ALLOCATION_UNCLEAR' && row.payment_id && !row.obligation_id) {
    const balance=await db.prepare('SELECT unallocated_cents FROM annual_fee_payment_balance WHERE id=?').bind(row.payment_id).first();
    if ((balance?.unallocated_cents??0)>0) throw new AppError(409,'unallocated_fee_balance');
  }
  try { await db.batch([
    db.prepare(`UPDATE annual_fee_issue SET status=CASE WHEN status='OPEN' THEN 'RESOLVED' ELSE NULL END,
      resolved_by=?,resolved_at=? WHERE id=?`)
      .bind(context.userId,now,id),
    audit(db,context,requestId,'FEE_ISSUE_RESOLVED','annual_fee_issue',id,now)
  ]); } catch(error) {
    if (/unallocated_fee_balance/.test(error?.message??'')) throw new AppError(409,'unallocated_fee_balance');
    const current=await db.prepare('SELECT status FROM annual_fee_issue WHERE id=?').bind(id).first();
    if (!current || current.status!=='OPEN') throw new AppError(409,'invalid_transition');
    throw error;
  }
  return {id,status:'RESOLVED'};
}
export async function authorizeInstallments(db,context,requestId,id,input,now=Date.now()) {
  const row=await db.prepare('SELECT * FROM annual_fee_obligation_status WHERE id=?').bind(requireUuid(id)).first();
  if (!row) throw new AppError(404,'not_found');
  await requirePermission(db,context,requestId,'finance.fee.installment.authorize',
    {sectionId:row.current_section_id,resourceType:'annual_fee_obligation',resourceId:id});
  const role=await db.prepare(`SELECT 1 FROM user_role WHERE user_id=? AND role_code IN ('TREASURY','GROUP_COORDINATOR')
    AND revoked_at IS NULL AND valid_from<=? AND (expires_at IS NULL OR expires_at>?) LIMIT 1`)
    .bind(context.userId,now,now).first();
  if (!role) throw new AppError(403,'forbidden');
  if (!keysOnly(input,['parts','replacesPlanId','reason']) || !Array.isArray(input.parts) ||
    input.parts.length<2 || input.parts.length>100 ||
    input.parts.some(part=>!keysOnly(part,['amountCents','targetAt']) || !cents(part.amountCents) ||
      (part.targetAt!=null && (!Number.isSafeInteger(part.targetAt) || part.targetAt<0))) ||
    input.parts.reduce((sum,part)=>sum+part.amountCents,0)!==row.amount_due_cents) fail('invalid_installment_plan');
  const current=await db.prepare("SELECT id FROM annual_fee_installment_plan WHERE obligation_id=? AND status='ACTIVE'")
    .bind(id).first();
  if (current) {
    if (input.replacesPlanId!==current.id || typeof input.reason!=='string' ||
      input.reason.trim().length<3 || input.reason.trim().length>240)
      throw new AppError(409,'installment_plan_exists');
  } else if (input.replacesPlanId!==undefined || input.reason!==undefined) fail('invalid_installment_plan');
  const planId=uuid();
  await db.batch([
    db.prepare(`INSERT INTO annual_fee_installment_plan
      (id,obligation_id,status,replaces_plan_id,correction_reason,authorized_by,authorized_at)
      VALUES(?,?,'DRAFT',?,?,?,?)`).bind(planId,id,current?.id??null,input.reason?.trim()??null,context.userId,now),
    ...input.parts.map((part,index)=>db.prepare(`INSERT INTO annual_fee_installment_part
      (plan_id,ordinal,planned_cents,target_at) VALUES(?,?,?,?)`)
      .bind(planId,index+1,part.amountCents,part.targetAt??null)),
    ...(current?[db.prepare("UPDATE annual_fee_installment_plan SET status='SUPERSEDED' WHERE id=? AND status='ACTIVE'")
      .bind(current.id)]:[]),
    db.prepare("UPDATE annual_fee_installment_plan SET status='ACTIVE' WHERE id=? AND status='DRAFT'").bind(planId),
    audit(db,context,requestId,current?'FEE_INSTALLMENT_SUPERSEDED':'FEE_INSTALLMENT_AUTHORIZED',
      'annual_fee_installment_plan',planId,now)
  ]);
  return {id:planId};
}

export async function searchFeeParticipants(db,context,requestId,roundId,search='') {
  await roundById(db,roundId);
  await globalPermission(db,context,requestId,'finance.family.manage','annual_fee_family_group');
  if (typeof search!=='string' || search.length<2 || search.length>80) fail('invalid_fee_filter');
  const rows=(await db.prepare(`SELECT p.id,p.display_name,p.current_section_id,s.code AS section_code
    FROM participant p JOIN section s ON s.id=p.current_section_id
    WHERE p.status='ACTIVE' AND p.display_name LIKE ? ESCAPE '\\' ORDER BY p.display_name,p.id LIMIT 31`)
    .bind('%'+search.trim().replaceAll('\\','\\\\').replaceAll('%','\\%').replaceAll('_','\\_')+'%').all()).results;
  // Search results are capped, never silently: the caller refines the query when truncated.
  return {participants:rows.slice(0,30),truncated:rows.length>30};
}
export async function listFamilyGroups(db,context,requestId,roundId,params=null) {
  await globalPermission(db,context,requestId,'finance.family.read','annual_fee_family_group');
  await roundById(db,roundId);
  const page=pageRequest(params,['string','number']);
  const rows=(await db.prepare(`SELECT g.id,g.reference,m.participant_id,m.sibling_ordinal,p.display_name
    FROM annual_fee_family_group g JOIN annual_fee_family_member m ON m.group_id=g.id
    JOIN participant p ON p.id=m.participant_id WHERE g.round_id=?
    ${page.after?'AND (g.reference>? OR (g.reference=? AND m.sibling_ordinal>?))':''}
    ORDER BY g.reference,m.sibling_ordinal LIMIT ?`)
    .bind(roundId,...(page.after?[page.after[0],page.after[0],page.after[1]]:[]),page.limit+1).all()).results;
  const result=pageResult(rows,page.limit,row=>[row.reference,row.sibling_ordinal]);
  return {groups:result.items,nextCursor:result.nextCursor};
}
export async function feeObligationDetail(db,context,requestId,id) {
  const row=await db.prepare('SELECT * FROM annual_fee_obligation_status WHERE id=?').bind(requireUuid(id)).first();
  if (!row) throw new AppError(404,'not_found');
  await requirePermission(db,context,requestId,'finance.fee.read',
    {sectionId:row.current_section_id,resourceType:'annual_fee_obligation',resourceId:id,conceal:true});
  const allocations=(await db.prepare(`SELECT a.id,a.payment_id,a.amount_cents,p.review_status,p.verified_amount_cents
    FROM annual_fee_allocation a JOIN annual_fee_payment p ON p.id=a.payment_id WHERE a.obligation_id=?
    ORDER BY a.created_at,a.id`).bind(id).all()).results;
  const plan=await db.prepare("SELECT id,authorized_by,authorized_at FROM annual_fee_installment_plan WHERE obligation_id=? AND status='ACTIVE'")
    .bind(id).first();
  const parts=plan?(await db.prepare('SELECT ordinal,planned_cents,target_at FROM annual_fee_installment_part WHERE plan_id=? ORDER BY ordinal')
    .bind(plan.id).all()).results:[];
  const issues=(await db.prepare('SELECT id,code,status,created_at,resolved_at FROM annual_fee_issue WHERE obligation_id=? ORDER BY created_at DESC')
    .bind(id).all()).results;
  const amountRevisions=(await db.prepare(`SELECT previous_amount_cents,new_amount_cents,changed_by,changed_at
    FROM annual_fee_amount_revision WHERE obligation_id=? ORDER BY changed_at DESC,id DESC LIMIT 50`)
    .bind(id).all()).results;
  return {obligation:row,allocations,installmentPlan:plan?{...plan,parts}:null,issues,amountRevisions};
}
export async function listFeeIssues(db,context,requestId,roundId,params=null) {
  await globalPermission(db,context,requestId,'finance.fee.read','annual_fee_issue');
  await roundById(db,roundId);
  const page=pageRequest(params,['number','string']);
  // A payment-level ALLOCATION_UNCLEAR carries the verified amount still unassigned, so the screen can
  // send the user to the allocation instead of offering a resolution the server will refuse.
  const rows=(await db.prepare(`SELECT i.id,i.payment_id,i.obligation_id,i.code,i.status,i.created_at,i.resolved_at,
    CASE WHEN i.code='ALLOCATION_UNCLEAR' AND i.obligation_id IS NULL THEN
      (SELECT b.unallocated_cents FROM annual_fee_payment_balance b WHERE b.id=i.payment_id) END AS unallocated_cents
    FROM annual_fee_issue i WHERE i.round_id=? ${page.after?'AND (i.created_at<? OR (i.created_at=? AND i.id<?))':''}
    ORDER BY i.created_at DESC,i.id DESC LIMIT ?`)
    .bind(roundId,...(page.after?[page.after[0],page.after[0],page.after[1]]:[]),page.limit+1).all()).results;
  const result=pageResult(rows,page.limit,row=>[row.created_at,row.id]);
  return {issues:result.items,nextCursor:result.nextCursor};
}
