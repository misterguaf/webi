import { createHash } from 'node:crypto';

// Fixed, obviously fictional fixtures; existing canonical seed records are synthetic too.
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const section = number => id(number);
const coordinator = id(101);
const treasury = id(104);
const round = id(901);
const at = (month, day) => Date.UTC(2026, month - 1, day, 12);
const createdAt = at(9, 1);
const sqlValue = value => value === null ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
const insert = (table, columns, rows) => rows.length ? `INSERT INTO ${table}(${columns.join(',')}) VALUES\n${rows.map(row => `  (${row.map(sqlValue).join(',')})`).join(',\n')};\n` : '';

export function demoPdf() {
  const stream = 'BT /F1 18 Tf 54 750 Td (SYNTHETIC DEMO) Tj 0 -32 Td /F1 11 Tf (Justificant fictici per a proves locals. Sense valor real.) Tj ET\n';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`
  ];
  let pdf = '%PDF-1.4\n%synthetic local fixture\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index++) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

export const DEMO_MARKER_ID = id(14001);
export const DEMO_VERSION = 'gestio-demo-v2';

export function buildDemoData({ now = Date.now() } = {}) {
  const pdf = demoPdf();
  const digest = createHash('sha256').update(pdf).digest('hex');
  const evidenceKeys = new Set(['fixture-only/no-binary']); // Repair the canonical synthetic 3A evidence link locally.
  const participants = [501, 502, 503, 504, 505].map((number, index) => ({id:id(number), number,
    name:['Participante Manada A (ficticio)','Participante Tropa A (ficticio)','Participante Tropa B (ficticio)',
      'Participante Escolta A (ficticio)','Participante Clan A (ficticio)'][index],
    section:[1,2,2,3,4][index], birth:['2017-06-12','2013-05-18','2012-11-03','2009-04-26','2007-08-09'][index]}));
  const familySizes = [1,1,1,1,1,2,2,2,3,3,3,3,4,4,4];
  const families = [];
  let nextParticipant = 1001;
  // Explicit section sequence avoids any dependence on the existing seed's names or contacts.
  const sectionSequence = Array.from({length:35},(_,index)=>[1,2,3,4][index%4]);
  for(let familyIndex=0;familyIndex<familySizes.length;familyIndex++){
    const members=[];
    for(let child=1;child<=familySizes[familyIndex];child++){
      const number=nextParticipant++, sectionNumber=sectionSequence[number-1001];
      const name=`Família Demo ${String(familyIndex+1).padStart(2,'0')} · Fill ${child}`;
      const birthYear={1:2017,2:2013,3:2009,4:2007}[sectionNumber];
      const person={id:id(number),number,name,section:sectionNumber,
        birth:`${birthYear}-${String((number%12)+1).padStart(2,'0')}-${String((number%25)+1).padStart(2,'0')}`};
      members.push(person);participants.push(person);
    }
    families.push({number:familyIndex+1,members});
  }
  const byNumber = new Map(participants.map(person=>[person.number,person]));
  const participantRows = participants.slice(5).map(person=>[person.id,person.name,section(person.section),'ACTIVE',person.birth]);
  const contactRows = participants.slice(5).map(person=>[person.id,`familia-demo-${person.number}@example.test`,createdAt]);
  // 3.5D (ACTIVITIES.md §21): activity scenarios D1–D12 are relative to the seed time T so that "deadline
  // soon", "in progress" and "ended" stay true whenever the demo is rebuilt. Fee data does not depend on them.
  const T = now, HOUR = 3600000, DAY = 24 * HOUR;
  const day = (offset, hour = 10) => { const d = new Date(T); d.setUTCHours(0, 0, 0, 0); return d.getTime() + offset * DAY + hour * HOUR; };
  const activities = [
    // D1 GENERAL, published, a few registrations incl. one pending review.
    {n:11002,code:'DEMO-GENERAL-OPEN',name:'Jornada Demo · tot el grup',status:'PUBLISHED',audience:'GENERAL',sections:[],price:0,start:day(21),end:day(21,17),deadline:day(14,20)},
    // D2 Tropa, paid, many registrations, deadline in under 48h; D12 evidence pending / issue / verified.
    {n:11003,code:'DEMO-TROPA-PAID',name:'Eixida Demo · Tropa',status:'PUBLISHED',audience:'SECTIONS',sections:[2],price:1500,start:day(10),end:day(11,17),deadline:T+40*HOUR},
    // D3 published without registrations.
    {n:11004,code:'DEMO-MANADA-FREE',name:'Taller Demo · Manada',status:'PUBLISHED',audience:'SECTIONS',sections:[1],price:0,start:day(30),end:day(30,14),deadline:day(20,20)},
    // D4 DRAFT, GENERAL, free: discardable.
    {n:11001,code:'DEMO-NEW-DRAFT',name:'Projecte Demo · esborrany',status:'DRAFT',audience:'GENERAL',sections:[],price:0,start:day(40),end:day(41,17),deadline:day(30,20),
      description:''},
    // D5 DRAFT, section, paid, deadline already past (cannot be published until edited).
    {n:11008,code:'DEMO-ESCOLTA-DRAFT',name:'Activitat Demo · preparació',status:'DRAFT',audience:'SECTIONS',sections:[3],price:500,start:day(5),end:day(5,18),deadline:day(-1,20)},
    // D6 published, in progress.
    {n:11009,code:'DEMO-CLAN-NOW',name:'Campament Demo · Clan',status:'PUBLISHED',audience:'SECTIONS',sections:[4],price:2300,start:T-DAY,end:T+DAY,deadline:T-3*DAY},
    // D7 published, ended, pending close.
    {n:11010,code:'DEMO-ESCOLTA-ENDED',name:'Ruta Demo · Escolta',status:'PUBLISHED',audience:'SECTIONS',sections:[3],price:0,start:day(-10,9),end:day(-9,18),deadline:day(-14,20)},
    // D8 closed, past, with registrations (a historical Tropa intake whose participant is now in Escolta).
    {n:11005,code:'DEMO-TROPA-PAST',name:'Campament d’estiu Demo · Tropa',status:'CLOSED',audience:'SECTIONS',sections:[2],price:1200,start:day(-60,9),end:day(-58,17),deadline:day(-67,20)},
    {n:11006,code:'DEMO-ESCOLTA-PAST',name:'Ruta d’hivern Demo · Escolta',status:'CLOSED',audience:'SECTIONS',sections:[3],price:0,start:day(-120,9),end:day(-119,17),deadline:day(-127,20)},
    // D10 paid with group transport supplement (GROUP +3 €, FAMILY 0 €).
    {n:11007,code:'DEMO-CLAN-PAID',name:'Projecte Demo · Clan',status:'PUBLISHED',audience:'SECTIONS',sections:[4],price:2300,start:day(15,9),end:day(17,17),deadline:day(7,20),
      transport:[['GROUP',300],['FAMILY',0]]},
    // D11 mixed Tropa + Escolta (read-only for a Tropa-only coordinator).
    {n:11011,code:'DEMO-MIXED-OPEN',name:'Excursió Demo · Tropa i Escolta',status:'PUBLISHED',audience:'SECTIONS',sections:[2,3],price:0,start:day(25,8),end:day(25,19),deadline:day(15,20)}
  ];
  const activityRows=activities.map(a=>[id(a.n),a.code,a.name,a.status,a.audience,'Espai fictici',a.start,a.end,a.deadline,a.price,'EUR',
    a.description??'Contingut sintètic per a proves de Gestió.','Material de demostració.','',coordinator,
    Math.min(T-45*DAY,a.deadline-20*DAY),Math.min(T-45*DAY,a.deadline-20*DAY)]);
  const activitySectionRows=activities.flatMap(a=>a.sections.map(sectionNumber=>[id(a.n),section(sectionNumber)]));
  const transportRows=activities.flatMap(a=>(a.transport??[]).map(([code,cents])=>[id(a.n),code,cents]));
  const regs=[];
  const addReg=(activityNumber,participantNumber,status,matchStatus='CLEAR',opts={})=>{
    const person=byNumber.get(participantNumber);
    const activity=activities.find(a=>a.n===activityNumber);
    const number=12001+regs.length;
    const name=opts.name||person?.name||'Sol·licitud Demo sense fitxa';
    const transport=opts.transport??(activity.transport?'GROUP':null);
    const adjustment=activity.transport?.find(([code])=>code===transport)?.[1]??0;
    regs.push({number,activityNumber,person,status,matchStatus,name,sectionNumber:opts.section||person?.section||2,
      birth:opts.birth||null,amount:opts.amount??activity.price+adjustment,transport,
      evidence:opts.evidence||(activity.price>0&&status==='CONFIRMED'?'VERIFIED':null),
      created:opts.created||Math.min(T-2*DAY,activity.deadline-DAY)-number*60000});
  };
  const pending=(activity,name,sectionNumber,birth)=>addReg(activity,null,'NEEDS_PARTICIPANT_REVIEW','NONE',{name,section:sectionNumber,birth});
  const rejected=(activity,name,sectionNumber)=>addReg(activity,null,'REJECTED','REJECTED',{name,section:sectionNumber});
  // D1
  addReg(11002,1001,'CONFIRMED'); addReg(11002,1002,'CONFIRMED'); addReg(11002,1003,'CONFIRMED');
  addReg(11002,null,'NEEDS_PARTICIPANT_REVIEW','AMBIGUOUS',{name:'Família Demo · coincidència dubtosa',section:2,birth:'2013-04-10'});
  // D2: 20 registrations mixing confirmed, pending review, pending payment and rejected.
  for(const n of [1002,1006,1010,1018,1022,1026,1030,1034])addReg(11003,n,'CONFIRMED');
  addReg(11003,502,'AWAITING_PAYMENT_REVIEW','CLEAR',{evidence:'PENDING_REVIEW'});
  addReg(11003,503,'AWAITING_PAYMENT_REVIEW','CLEAR',{evidence:'PENDING_REVIEW'});
  addReg(11003,1014,'AWAITING_PAYMENT_REVIEW','CLEAR',{evidence:'ISSUE'});
  [['Demo Sol·licitud sense fitxa','2013-07-11'],['Demo Persona Nova Tropa','2012-02-03'],['Demo Germana Petita','2014-09-21']]
    .forEach(([name,birth])=>pending(11003,name,2,birth));
  [['Demo Sol·licitud duplicada',2],['Demo Secció equivocada',2],['Demo Sol·licitud retirada',2]].forEach(([name,sectionNumber])=>rejected(11003,name,sectionNumber));
  pending(11003,'Demo Inscripció tardana',2,'2013-01-15');
  pending(11003,'Demo Nom incomplet',2,'2012-06-30');
  pending(11003,'Demo Família nova',2,'2013-11-02');
  // D6
  addReg(11009,1004,'CONFIRMED'); addReg(11009,1008,'AWAITING_PAYMENT_REVIEW','CLEAR',{evidence:'PENDING_REVIEW'}); rejected(11009,'Demo Sol·licitud rebutjada',4);
  // D7
  addReg(11010,1007,'CONFIRMED'); addReg(11010,1011,'CONFIRMED');
  // D8
  addReg(11005,1003,'CONFIRMED','CLEAR',{section:2}); // Current section is Escolta: past Tropa intake.
  addReg(11006,1015,'CONFIRMED');
  // D10: group transport vs family transport (0 €).
  addReg(11007,1012,'CONFIRMED','CLEAR',{transport:'GROUP'});
  addReg(11007,1016,'AWAITING_PAYMENT_REVIEW','CLEAR',{transport:'FAMILY',evidence:'PENDING_REVIEW'});
  rejected(11007,'Demo Sol·licitud Clan rebutjada',4);
  // D11
  addReg(11011,1006,'CONFIRMED'); addReg(11011,1011,'CONFIRMED','CLEAR',{section:3});
  const registrationRows=regs.map(r=>[id(r.number),id(r.activityNumber),r.person?.id??null,r.name,
    r.name.toLocaleLowerCase('ca').normalize('NFD').replace(/[̀-ͯ]/g,''),section(r.sectionNumber),
    `inscripcio-demo-${r.number}@example.test`,r.transport,r.amount,r.matchStatus,r.status,'DEMO-3A',
    'DEMO-3A-PARTICIPATION-V1',r.created,'DEMO-3A-PRIVACY-NOTICE-V1',r.created,
    `demo-registration-${r.number}`,createHash('sha256').update(`registration-${r.number}`).digest('hex'),r.created,r.created,
    r.status==='REJECTED'?coordinator:null,r.status==='REJECTED'?r.created:null,
    'Tutor de demostració',r.number%3?`600 00${String(r.number).slice(-2)} 0${r.number%10}`:null,r.birth]);
  const activityEvidenceRows=regs.filter(r=>r.evidence).map(r=>{
    const key=`synthetic/demo-activity-${r.number}.pdf`;evidenceKeys.add(key);
    return [id(13000+r.number-12000),id(r.number),key,digest,pdf.length,'application/pdf',r.evidence,r.created,
      r.evidence==='PENDING_REVIEW'?null:r.created,r.evidence==='PENDING_REVIEW'?null:coordinator];
  });
  const familyGroupRows=[];const familyMemberRows=[];const familyForPerson=new Map();
  for(const family of families.filter(f=>f.members.length>=2)){
    const groupId=id(2000+family.number);
    familyGroupRows.push([groupId,round,`DEMO-FAM-${String(family.number).padStart(2,'0')}`,treasury,createdAt]);
    family.members.forEach((person,index)=>{familyForPerson.set(person.id,{id:groupId,ordinal:index+1});
      familyMemberRows.push([groupId,round,person.id,index+1,treasury,createdAt]);});
  }
  const obligations=participants.map((person,index)=>{
    const family=familyForPerson.get(person.id);
    const ordinal=family?.ordinal||1,discount=ordinal>=3?5000:0;
    return {index:index+1,person,id:id(3000+index+1),familyId:family?.id||null,ordinal,due:10000-discount,discount};
  });
  const obligationRows=obligations.map(o=>[o.id,round,o.person.id,o.familyId,o.ordinal,10000,o.discount,o.due,treasury,createdAt,createdAt]);
  const byPerson=new Map(obligations.map(o=>[o.person.number,o]));
  const paidShared=[1024,1025,1026,1027];
  const paidIndividual=[501,502,1001,1006,1012,1015,1020,1033];
  const partialShared=[1028,1029,1030,1031];
  const partialIndividual=[503,1002,1007,1013,1016,1021];
  const issuePeople=[504,1003,1008,1014,1017,1022];
  const paymentRows=[];const personRows=[];const feeEvidenceRows=[];const allocationRows=[];const verifyUpdates=[];
  let nextPayment=4001,nextSubmitted=5001,nextAllocation=7001;
  const addPayment=(people,{fraction=1,residual=0,status='VERIFIED'}={})=>{
    const number=nextPayment++, paymentId=id(number), selected=people.map(n=>byPerson.get(n));
    const amounts=selected.map(o=>Math.floor(o.due*fraction));
    const allocated=amounts.reduce((a,b)=>a+b,0),verified=status==='VERIFIED'?allocated+residual:null;
    const key=`synthetic/demo-fee-${number}.pdf`;evidenceKeys.add(key);
    paymentRows.push([paymentId,round,`pagament-demo-${number}@example.test`,
      `Família Demo · pagament ${number}`,null,allocated+residual||10000,verified,
      status==='VERIFIED'?'ISSUE':status,`demo-fee-payment-${number}`,createHash('sha256').update(`fee-${number}`).digest('hex'),
      'DEMO-3B-PRIVACY-NOTICE-V1',createdAt,createdAt,status==='VERIFIED'?treasury:null,status==='VERIFIED'?createdAt:null]);
    for(const o of selected)personRows.push([id(nextSubmitted++),paymentId,o.person.name,
      o.person.name.toLocaleLowerCase('ca').normalize('NFD').replace(/[\u0300-\u036f]/g,''),null,
      section(o.person.section),o.person.id,'CLEAR',null,null]);
    feeEvidenceRows.push([id(6000+number-4000),paymentId,key,digest,pdf.length,'application/pdf',createdAt]);
    if(status==='VERIFIED'){
      selected.forEach((o,index)=>allocationRows.push([id(nextAllocation++),paymentId,o.id,amounts[index],treasury,createdAt]));
      verifyUpdates.push(`UPDATE annual_fee_payment SET review_status='VERIFIED' WHERE id=${sqlValue(paymentId)};`);
    }
    return {number,id:paymentId,people:selected,allocated,verified};
  };
  const sharedPaid=addPayment(paidShared);
  for(const n of paidIndividual)addPayment([n]);
  const sharedPartial=addPayment(partialShared,{fraction:0.5});
  for(const n of partialIndividual)addPayment([n],{fraction:0.5});
  const residualPayment=addPayment([505],{fraction:0.2,residual:3000});
  const pendingPayment=addPayment([1004],{status:'PENDING_REVIEW'});
  const ambiguousPayment=addPayment([],{status:'ISSUE'});
  personRows.push([id(nextSubmitted++),ambiguousPayment.id,'Demo Coincidència Dubtosa','demo coincidencia dubtosa',
    '2013-02-14',section(2),null,'AMBIGUOUS',null,null]);
  const installmentPeople=[503,1002,1007];
  const installmentRows=installmentPeople.map((n,index)=>{
    const o=byPerson.get(n),half=Math.floor(o.due/2);
    return [id(8001+index),o.id,treasury,createdAt,half,o.due-half,at(10,15),at(12,15)];
  });
  const issueRows=[];let nextIssue=9001;
  for(const n of issuePeople){const o=byPerson.get(n);issueRows.push([id(nextIssue++),round,null,o.id,'DISCREPANCY','OPEN',treasury,createdAt,null,null]);}
  issueRows.push([id(nextIssue++),round,residualPayment.id,null,'ALLOCATION_UNCLEAR','OPEN',treasury,createdAt,null,null]);
  issueRows.push([id(nextIssue++),round,ambiguousPayment.id,null,'EVIDENCE_PROBLEM','OPEN',treasury,createdAt,null,null]);
  for(const n of [501,1005]){const o=byPerson.get(n);issueRows.push([id(nextIssue++),round,null,o.id,'DISCREPANCY','RESOLVED',treasury,at(8,1),treasury,at(8,5)]);}
  const markerRow=[DEMO_MARKER_ID,createdAt,createdAt,id(14002),treasury,'DEMO_DATASET_SEEDED','demo_dataset',DEMO_VERSION,'SUCCESS',null,0];
  const chunks=[
    '-- Gestió local-only synthetic demo dataset. Generated by demo/data.js. Do not apply remotely.\n',
    insert('participant',['id','display_name','current_section_id','status','birth_date'],participantRows),
    insert('participant_contact',['participant_id','notification_email','verified_at'],contactRows),
    insert('activity',['id','public_code','name','status','audience','location','starts_at','ends_at','registration_deadline','price_cents','currency','short_description','materials','special_notice','created_by','created_at','updated_at'],activityRows),
    insert('activity_section',['activity_id','section_id'],activitySectionRows),
    insert('activity_transport_option',['activity_id','code','price_adjustment_cents'],transportRows),
    insert('activity_registration',['id','activity_id','participant_id','submitted_name','match_key','submitted_section_id','receipt_email','transport_code','expected_amount_cents','match_status','status','consent_version','participation_terms_version','participation_authorized_at','privacy_notice_version','privacy_notice_acknowledged_at','idempotency_key','payload_sha256','created_at','updated_at','reviewed_by','reviewed_at','submitted_by_name','contact_phone','submitted_birth_date'],registrationRows),
    insert('payment_evidence',['id','registration_id','object_key','sha256','size_bytes','detected_mime','review_status','created_at','reviewed_at','reviewed_by'],activityEvidenceRows),
    insert('annual_fee_family_group',['id','round_id','reference','created_by','created_at'],familyGroupRows),
    insert('annual_fee_family_member',['group_id','round_id','participant_id','sibling_ordinal','assigned_by','assigned_at'],familyMemberRows),
    insert('annual_fee_obligation',['id','round_id','participant_id','family_group_id','sibling_ordinal','base_cents','discount_cents','amount_due_cents','created_by','created_at','updated_at'],obligationRows),
    insert('annual_fee_installment_plan',['id','obligation_id','authorized_by','authorized_at','first_cents','second_cents','first_target_at','second_target_at'],installmentRows),
    insert('annual_fee_payment',['id','round_id','receipt_email','submitted_by_name','contact_phone','declared_amount_cents','verified_amount_cents','review_status','idempotency_key','payload_sha256','privacy_notice_version','privacy_notice_acknowledged_at','created_at','reviewed_by','reviewed_at'],paymentRows),
    insert('annual_fee_submission_person',['id','payment_id','submitted_name','match_key','submitted_birth_date','section_id','participant_id','match_status','reviewed_by','reviewed_at'],personRows),
    insert('annual_fee_evidence',['id','payment_id','object_key','sha256','size_bytes','detected_mime','created_at'],feeEvidenceRows),
    insert('annual_fee_allocation',['id','payment_id','obligation_id','amount_cents','created_by','created_at'],allocationRows),
    ...verifyUpdates.map(row=>row+'\n'),
    insert('annual_fee_issue',['id','round_id','payment_id','obligation_id','code','status','created_by','created_at','resolved_by','resolved_at'],issueRows),
    `UPDATE payment_evidence SET sha256=${sqlValue(digest)}, size_bytes=${pdf.length} WHERE object_key='fixture-only/no-binary';\n`,
    insert('audit_event',['id','occurred_at','created_at','request_id','actor_user_id','action','resource_type','resource_id','result','reason_code','security_relevant'],[markerRow])
  ];
  return {sql:chunks.join(''),evidenceKeys:[...evidenceKeys],pdf,
    expected:{participants:40,activities:16,registrations:38,rounds:1,obligations:40,payments:19,
      families:{single:10,pair:3,triple:4,quadruple:3}}};
}
