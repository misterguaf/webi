import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { childName, familyOf, mailOf, personName } from './names.js';

// Fixed fictional fixtures for the LOCAL demo. Since 3.5I the people look real (invented Valencian names, see
// names.js) so Gestió can be reviewed as if it were in use; addresses stay on @example.test and evidence files keep
// their synthetic marker. The canonical seed (seed.sql, used by tests) keeps its «(fictici)» names; the demo only
// renames its visible records in the local demo database.
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const section = number => id(number);
const coordinator = id(101);
const treasury = id(104);
const round = id(901);
const at = (month, day) => Date.UTC(2026, month - 1, day, 12);
const createdAt = at(9, 1);
const sqlValue = value => value === null ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
const insert = (table, columns, rows) => rows.length ? `INSERT INTO ${table}(${columns.join(',')}) VALUES\n${rows.map(row => `  (${row.map(sqlValue).join(',')})`).join(',\n')};\n` : '';
export const treasuryExpenseEvidenceKeys = numbers => numbers.map(number => `synthetic/demo-expense-${number}.pdf`);
const treasuryEvidenceRows = (numbers, atTime, uploader) => {
  const pdf = demoPdf(), digest = createHash('sha256').update(pdf).digest('hex');
  return numbers.map(number => [id(number + 300), id(number), `synthetic/demo-expense-${number}.pdf`, digest,
    pdf.length, 'application/pdf', uploader, atTime]);
};
export function buildTreasuryEvidenceBackfill(numbers) {
  return insert('finance_expense_evidence', ['id', 'expense_id', 'object_key', 'sha256', 'size_bytes', 'detected_mime', 'uploaded_by', 'created_at'],
    treasuryEvidenceRows(numbers, Date.UTC(2026, 9, 25, 9), treasury));
}

// A small, valid PNG receipt (3.5F image evidence) with the synthetic marker in a tEXt chunk inside the
// first KiB, as the SYNTHETIC_ONLY evidence fence requires. No external tools.
export function demoPng() {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = bytes => { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type, 'latin1'), data]); const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc(body), 8 + data.length); return out; };
  const width = 240, height = 120, raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) { const row = y * (width * 3 + 1); raw[row] = 0;
    for (let x = 0; x < width; x++) { const shade = (x >> 4) % 2 === (y >> 4) % 2 ? 236 : 214; raw.fill(shade, row + 1 + x * 3, row + 4 + x * 3); } }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('tEXt', Buffer.from('Comment\0synthetic demo receipt - no real value', 'latin1')), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

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

// Visible names the demo gives to the canonical seed records (accounts 101–107, participants 501–505, activities 801–805).
const SEED_PEOPLE = ['Lola Sanchis Gomar', 'Pau Mascarell Ribes', 'Carla Estruch Ivars', 'Jordi Pellicer Nadal', 'Irene Bolta Server'];
const SEED_USERS = { 101: 'Teresa Climent Faus', 102: 'Vicent Sendra Llorca', 103: 'Marina Peiró Tur', 104: 'Miquel Ortolà Puig',
  105: 'Anna Benavent Soler', 106: 'Carles Vidal Moll', 107: 'Lluís Bataller Grau' };
const SEED_ACTIVITIES = {
  801: ['TRO-PLATJA', 'Eixida a la platja de l’Ahuir · Tropa', 'Platja de l’Ahuir', 'Jocs a la platja i berenar.', 'Banyador, tovallola i crema solar'],
  802: ['ESC-BARX', 'Acampada a Barx · Esculta', 'Àrea d’acampada de Barx', 'Dues nits d’acampada amb construccions.', 'Sac, esterilla i frontal'],
  803: ['GRUP-PORTES', 'Jornada de portes obertes', 'Local del grup', 'Matí de jocs per a famílies noves.', ''],
  804: ['TRO-CALENDARI', 'Calendari del segon trimestre', 'Local del grup', '', ''],
  805: ['TRO-NETEJA', 'Neteja de la muntanya · Tropa', 'Serra de Mariola', 'Recollida de residus amb la Tropa.', 'Guants i bossa'] };
/** Statements that give the canonical seed records realistic visible names in the local demo database. */
function seedRenames(sqlValue) {
  const people = ['501','502','503','504','505'].map((n, index) => [id(Number(n)), SEED_PEOPLE[index]]);
  const key = name => name.toLocaleLowerCase('ca').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return [
    ...Object.entries(SEED_USERS).map(([n, name]) => `UPDATE app_user SET display_name=${sqlValue(name)} WHERE id=${sqlValue(id(Number(n)))};`),
    ...people.map(([pid, name]) => `UPDATE participant SET display_name=${sqlValue(name)} WHERE id=${sqlValue(pid)};`),
    ...people.map(([pid, name]) => `UPDATE activity_registration SET submitted_name=${sqlValue(name)},match_key=${sqlValue(key(name))} WHERE participant_id=${sqlValue(pid)};`),
    ...people.map(([pid, name]) => `UPDATE participant_contact SET notification_email=${sqlValue(mailOf(`familia ${name.split(' ').slice(1).join(' ')}`))} WHERE participant_id=${sqlValue(pid)};`),
    ...Object.entries(SEED_ACTIVITIES).map(([n, [code, name, place, description, materials]]) =>
      `UPDATE activity SET public_code=${sqlValue(code)},name=${sqlValue(name)},location=${sqlValue(place)},short_description=${sqlValue(description)},materials=${sqlValue(materials)} WHERE id=${sqlValue(id(Number(n)))};`),
    `UPDATE annual_fee_round SET account_holder='Grup Scout Parpalló' WHERE id=${sqlValue(id(901))};`,
    `UPDATE delegated_permission SET authorization_reference='ACTA-CONSELL-2026-03',ratification_reference='ACTA-CONSELL-2026-04' WHERE id=${sqlValue(id(741))};`
  ].join('\n') + '\n';
}

export const DEMO_MARKER_ID = id(14001);
export const DEMO_VERSION = 'gestio-demo-v2';

export function buildDemoData({ now = Date.now() } = {}) {
  const pdf = demoPdf(), png = demoPng();
  const digest = createHash('sha256').update(pdf).digest('hex'), pngDigest = createHash('sha256').update(png).digest('hex');
  const imageKeys = new Set();
  const evidenceKeys = new Set(['fixture-only/no-binary']); // Repair the canonical synthetic 3A evidence link locally.
  const participants = [501, 502, 503, 504, 505].map((number, index) => ({id:id(number), number,
    name:SEED_PEOPLE[index],
    section:[1,2,2,3,4][index], birth:['2017-06-12','2013-05-18','2012-11-03','2009-04-26','2007-08-09'][index]}));
  // The first 15 families (35 children) carry every fee/registration scenario and stay as they were; 3.5I adds
  // 45 more families (64 children) so the group has 104 educands with siblings in several sections.
  const familySizes = [1,1,1,1,1,2,2,2,3,3,3,3,4,4,4,
    ...Array(30).fill(1),...Array(11).fill(2),...Array(4).fill(3)];
  const families = [];
  let nextParticipant = 1001;
  // Explicit section sequence avoids any dependence on the existing seed's names or contacts.
  const sectionSequence = Array.from({length:99},(_,index)=>[1,2,3,4][index%4]);
  for(let familyIndex=0;familyIndex<familySizes.length;familyIndex++){
    const members=[];
    for(let child=1;child<=familySizes[familyIndex];child++){
      const number=nextParticipant++, sectionNumber=sectionSequence[number-1001];
      const name=childName(familyIndex,child);
      const birthYear={1:2017,2:2013,3:2009,4:2007}[sectionNumber];
      const person={id:id(number),number,name,section:sectionNumber,
        birth:`${birthYear}-${String((number%12)+1).padStart(2,'0')}-${String((number%25)+1).padStart(2,'0')}`};
      members.push(person);participants.push(person);
    }
    families.push({number:familyIndex+1,members,...familyOf(familyIndex)});
  }
  const byNumber = new Map(participants.map(person=>[person.number,person]));
  const participantRows = participants.slice(5).map(person=>[person.id,person.name,section(person.section),'ACTIVE',person.birth]);
  const contactRows = participants.slice(5).map(person=>[person.id,mailOf(`familia ${person.name.split(' ').slice(1).join(' ')} ${person.number}`),createdAt]);
  // 3.5D (ACTIVITIES.md §21): activity scenarios D1–D12 are relative to the seed time T so that "deadline
  // soon", "in progress" and "ended" stay true whenever the demo is rebuilt. Fee data does not depend on them.
  const T = now, HOUR = 3600000, DAY = 24 * HOUR;
  const day = (offset, hour = 10) => { const d = new Date(T); d.setUTCHours(0, 0, 0, 0); return d.getTime() + offset * DAY + hour * HOUR; };
  const activities = [
    // D1 GENERAL, published, a few registrations incl. one pending review.
    {n:11002,code:'GRUP-GERMANOR',name:'Jornada de germanor · tot el grup',place:'Parc de Sant Pere',status:'PUBLISHED',audience:'GENERAL',sections:[],price:0,start:day(21),end:day(21,17),deadline:day(14,20)},
    // D2 Tropa, paid, many registrations, deadline in under 48h; D12 evidence pending / issue / verified.
    {n:11003,code:'TRO-DROVA',name:'Eixida a la Drova · Tropa',place:'Alberg de la Drova',status:'PUBLISHED',audience:'SECTIONS',sections:[2],price:1500,start:day(10),end:day(11,17),deadline:T+40*HOUR},
    // D3 published without registrations.
    {n:11004,code:'MAN-NUSOS',name:'Taller de nusos · Manada',place:'Local del grup',status:'PUBLISHED',audience:'SECTIONS',sections:[1],price:0,start:day(30),end:day(30,14),deadline:day(20,20)},
    // D4 DRAFT, GENERAL, free: discardable.
    {n:11001,code:'GRUP-PRIMAVERA',name:'Projecte de primavera',place:'Per decidir',status:'DRAFT',audience:'GENERAL',sections:[],price:0,start:day(40),end:day(41,17),deadline:day(30,20),
      description:''},
    // D5 DRAFT, section, paid, deadline already past (cannot be published until edited).
    {n:11008,code:'ESC-PREPARACIO',name:'Preparació de la ruta · Esculta',place:'Local del grup',status:'DRAFT',audience:'SECTIONS',sections:[3],price:500,start:day(5),end:day(5,18),deadline:day(-1,20)},
    // D6 published, in progress.
    {n:11009,code:'CLA-HIVERN',name:'Campament d’hivern · Clan',place:'Refugi del Benicadell',status:'PUBLISHED',audience:'SECTIONS',sections:[4],price:2300,start:T-DAY,end:T+DAY,deadline:T-3*DAY},
    // D7 published, ended, pending close.
    {n:11010,code:'ESC-SAFOR',name:'Ruta pel circ de la Safor · Esculta',place:'Circ de la Safor',status:'PUBLISHED',audience:'SECTIONS',sections:[3],price:0,start:day(-10,9),end:day(-9,18),deadline:day(-14,20)},
    // D8 closed, past, with registrations (a historical Tropa intake whose participant is now in Escolta).
    {n:11005,code:'TRO-ESTIU',name:'Campament d’estiu · Tropa',place:'Campament de Bocairent',status:'CLOSED',audience:'SECTIONS',sections:[2],price:1200,start:day(-60,9),end:day(-58,17),deadline:day(-67,20)},
    {n:11006,code:'ESC-MONTDUVER',name:'Ruta d’hivern al Montdúver · Esculta',place:'Montdúver',status:'CLOSED',audience:'SECTIONS',sections:[3],price:0,start:day(-120,9),end:day(-119,17),deadline:day(-127,20)},
    // D10 paid with group transport supplement (GROUP +3 €, FAMILY 0 €).
    {n:11007,code:'CLA-SOLIDARI',name:'Projecte solidari · Clan',place:'Alberg de Xàtiva',status:'PUBLISHED',audience:'SECTIONS',sections:[4],price:2300,start:day(15,9),end:day(17,17),deadline:day(7,20),
      transport:[['GROUP',300],['FAMILY',0]]},
    // D11 mixed Tropa + Escolta (read-only for a Tropa-only coordinator).
    {n:11011,code:'TRO-ESC-MARXUQUERA',name:'Excursió a Marxuquera · Tropa i Esculta',place:'Marxuquera',status:'PUBLISHED',audience:'SECTIONS',sections:[2,3],price:0,start:day(25,8),end:day(25,19),deadline:day(15,20)}
  ];
  const activityRows=activities.map(a=>[id(a.n),a.code,a.name,a.status,a.audience,a.place,a.start,a.end,a.deadline,a.price,'EUR',
    a.description??'Activitat del calendari del grup. Les famílies reben la informació detallada per correu.','Roba còmoda, aigua i esmorzar.','',coordinator,
    Math.min(T-45*DAY,a.deadline-20*DAY),Math.min(T-45*DAY,a.deadline-20*DAY)]);
  const activitySectionRows=activities.flatMap(a=>a.sections.map(sectionNumber=>[id(a.n),section(sectionNumber)]));
  const transportRows=activities.flatMap(a=>(a.transport??[]).map(([code,cents])=>[id(a.n),code,cents]));
  const regs=[];
  const addReg=(activityNumber,participantNumber,status,matchStatus='CLEAR',opts={})=>{
    const person=byNumber.get(participantNumber);
    const activity=activities.find(a=>a.n===activityNumber);
    const number=12001+regs.length;
    const name=opts.name||person?.name||personName(900+regs.length);
    const transport=opts.transport??(activity.transport?'GROUP':null);
    const adjustment=activity.transport?.find(([code])=>code===transport)?.[1]??0;
    regs.push({number,activityNumber,person,status,matchStatus,name,sectionNumber:opts.section||person?.section||2,
      birth:opts.birth||null,amount:opts.amount??activity.price+adjustment,transport,
      evidence:opts.evidence||(activity.price>0&&status==='CONFIRMED'?'VERIFIED':null),mime:opts.mime||'application/pdf',paid:opts.paid??null,attempts:opts.attempts??[],
      escalation:opts.escalation||null,withdrawn:opts.withdrawn||null,correctedTo:opts.correctedTo||null,reviewed:!!opts.reviewed,
      created:opts.created||Math.min(T-2*DAY,activity.deadline-DAY)-number*60000});
  };
  const pending=(activity,name,sectionNumber,birth)=>addReg(activity,null,'NEEDS_PARTICIPANT_REVIEW','NONE',{name,section:sectionNumber,birth});
  const rejected=(activity,name,sectionNumber)=>addReg(activity,null,'REJECTED','REJECTED',{name,section:sectionNumber});
  // D1
  addReg(11002,1001,'CONFIRMED'); addReg(11002,1002,'CONFIRMED'); addReg(11002,1003,'CONFIRMED');
  addReg(11002,null,'NEEDS_PARTICIPANT_REVIEW','AMBIGUOUS',{name:'Martí Ferrer García',section:2,birth:'2013-04-10'});
  // D2: 20 registrations mixing confirmed, pending review, pending payment and rejected.
  for(const n of [1002,1006,1010,1018,1022,1026,1030])addReg(11003,n,'CONFIRMED');
  // 3.5F: confirmed and paid, then withdrawn by the family; the verified payment stays (no refund implied).
  addReg(11003,1034,'WITHDRAWN','CLEAR',{evidence:'VERIFIED',withdrawn:'FAMILY_COMMUNICATION'});
  // 3.5F instalments: a partial payment (5 € of 15 €) still awaiting the rest.
  addReg(11003,502,'AWAITING_PAYMENT_REVIEW','CLEAR',{evidence:'VERIFIED',paid:500});
  // 3.5F: image evidence (PNG) next to the PDF ones.
  addReg(11003,503,'AWAITING_PAYMENT_REVIEW','CLEAR',{evidence:'PENDING_REVIEW',mime:'image/png'});
  // An incidence after a first instalment: the 5 € already verified are kept.
  addReg(11003,1014,'AWAITING_PAYMENT_REVIEW','CLEAR',{evidence:'ISSUE',paid:500});
  [[personName(301),'2013-07-11'],[personName(302),'2012-02-03'],[personName(303),'2014-09-21']]
    .forEach(([name,birth])=>pending(11003,name,2,birth));
  [[personName(304),2],[personName(305),2]].forEach(([name,sectionNumber])=>rejected(11003,name,sectionNumber));
  // 3.5F: a withdrawal is not a rejection.
  addReg(11003,null,'WITHDRAWN','NONE',{name:personName(306),section:2,withdrawn:'FAMILY_COMMUNICATION'});
  pending(11003,personName(307),2,'2013-01-15');
  pending(11003,personName(308),2,'2012-06-30');
  pending(11003,personName(309),2,'2013-11-02');
  // D6
  // 3.5F: withdrawn after paying, then a new request: the withdrawn registration stays as history.
  addReg(11009,1004,'WITHDRAWN','CLEAR',{evidence:'VERIFIED',withdrawn:'FAMILY_COMMUNICATION'});
  addReg(11009,1004,'CONFIRMED'); addReg(11009,1008,'AWAITING_PAYMENT_REVIEW','CLEAR',{evidence:'PENDING_REVIEW'}); rejected(11009,personName(310),4);
  // D7
  addReg(11010,1007,'CONFIRMED'); addReg(11010,1011,'CONFIRMED');
  // D8
  addReg(11005,1003,'CONFIRMED','CLEAR',{section:2}); // Current section is Escolta: past Tropa intake.
  addReg(11006,1015,'CONFIRMED');
  // D10: group transport vs family transport (0 €).
  addReg(11007,1012,'CONFIRMED','CLEAR',{transport:'GROUP'});
  // 3.5F payment attempts: proof A verified 10 €, proof B with an open incidence, proof C verified 3 € →
  // 13 € / 23 € partial with one incidence still open on B.
  addReg(11007,1016,'AWAITING_PAYMENT_REVIEW','CLEAR',{transport:'FAMILY',evidence:'VERIFIED',paid:1000,
    attempts:[{status:'ISSUE'},{status:'VERIFIED',paid:300}]});
  rejected(11007,personName(311),4);
  // D11
  addReg(11011,1006,'CONFIRMED'); addReg(11011,1011,'CONFIRMED','CLEAR',{section:3});
  // D13 (3.5F, REGISTRATIONS.md): manual link, escalation to global review, manual escalation and a
  // corrected section. Names of the escalated request match an Escolta participant declared as Tropa.
  const free=(activityNumber,sectionNumber)=>participants.find(p=>p.section===sectionNumber && p.number>=1001 &&
    !regs.some(r=>r.activityNumber===activityNumber && r.person?.number===p.number));
  addReg(11011,free(11011,2).number,'CONFIRMED','RESOLVED',{reviewed:true});
  const escolta=free(11002,3);
  addReg(11002,null,'NEEDS_PARTICIPANT_REVIEW','NONE',{name:escolta.name,section:2,birth:escolta.birth,escalation:'POSSIBLE_OTHER_SECTION'});
  addReg(11003,null,'NEEDS_PARTICIPANT_REVIEW','NONE',{name:personName(312),section:2,birth:'2010-03-03',escalation:'REVIEWER_REQUEST'});
  addReg(11002,null,'NEEDS_PARTICIPANT_REVIEW','NONE',{name:personName(313),section:2,birth:'2006-05-05',correctedTo:4});
  const registrationRows=regs.map(r=>[id(r.number),id(r.activityNumber),r.person?.id??null,r.name,
    r.name.toLocaleLowerCase('ca').normalize('NFD').replace(/[̀-ͯ]/g,''),section(r.sectionNumber),
    mailOf(`${r.name} ${r.number}`),r.transport,r.amount,r.matchStatus,r.status,'DEMO-3A',
    'DEMO-3A-PARTICIPATION-V1',r.created,'DEMO-3A-PRIVACY-NOTICE-V1',r.created,
    `demo-registration-${r.number}`,createHash('sha256').update(`registration-${r.number}`).digest('hex'),r.created,r.created,
    r.status==='REJECTED'||r.reviewed?coordinator:null,r.status==='REJECTED'||r.reviewed?r.created:null,
    personName(r.number,{adult:true}),r.number%3?`600 00${String(r.number).slice(-2)} 0${r.number%10}`:null,r.status==='NEEDS_PARTICIPANT_REVIEW'?r.birth:null,
    r.escalation?'GLOBAL':'SECTION',r.escalation,r.escalation?r.created:null,r.escalation==='REVIEWER_REQUEST'?id(102):null,
    r.withdrawn?r.created+HOUR:null,r.withdrawn?coordinator:null,r.withdrawn]);
  // Section corrections happen after the insert (the declared section is kept), with their history.
  const corrections=regs.filter(r=>r.correctedTo);
  const correctionSql=corrections.map(r=>`UPDATE activity_registration SET registration_section_id=${sqlValue(section(r.correctedTo))} WHERE id=${sqlValue(id(r.number))};\n`).join('')+
    insert('activity_registration_section_change',['id','registration_id','from_section_id','to_section_id','reason','changed_by','changed_at'],
      corrections.map((r,index)=>[id(19500+index+1),id(r.number),section(r.sectionNumber),section(r.correctedTo),'CORRECTION',coordinator,r.created+HOUR]));
  const activityEvidenceRows=regs.filter(r=>r.evidence).map(r=>{
    const image=r.mime==='image/png';
    const key=`synthetic/demo-activity-${r.number}.${image?'png':'pdf'}`;(image?imageKeys:evidenceKeys).add(key);
    return [id(13000+r.number-12000),id(r.number),key,image?pngDigest:digest,image?png.length:pdf.length,r.mime,r.evidence,r.created,
      r.evidence==='PENDING_REVIEW'?null:r.created,r.evidence==='PENDING_REVIEW'?null:coordinator];
  });
  // Further payment attempts (proofs) of the same registration.
  const extraAttempts=regs.flatMap(r=>r.attempts.map(attempt=>({r,...attempt}))).map((x,index)=>({...x,evidenceId:id(13500+index+1),
    key:`synthetic/demo-activity-${x.r.number}-attempt-${index+1}.pdf`,created:x.r.created+(index+1)*DAY}));
  for (const x of extraAttempts) { evidenceKeys.add(x.key); activityEvidenceRows.push([x.evidenceId,id(x.r.number),x.key,digest,pdf.length,'application/pdf',
    x.status,x.created,x.status==='PENDING_REVIEW'?null:x.created,x.status==='PENDING_REVIEW'?null:treasury]); }
  // Verified amounts (3.5F instalments): full for verified evidence, partial where the scenario says so,
  // each linked to the proof it comes from.
  const allocationRowsActivity=[...regs.filter(r=>r.evidence && (r.evidence==='VERIFIED' || r.paid)).map(r=>({registration:id(r.number),
    evidence:id(13000+r.number-12000),amount:r.paid??r.amount,at:r.created+HOUR})),
    ...extraAttempts.filter(x=>x.paid).map(x=>({registration:id(x.r.number),evidence:x.evidenceId,amount:x.paid,at:x.created+HOUR}))]
    .map((a,index)=>[id(19700+index+1),a.registration,a.evidence,a.amount,'VERIFICATION',treasury,a.at]);
  const familyGroupRows=[];const familyMemberRows=[];const familyForPerson=new Map();
  for(const family of families.filter(f=>f.members.length>=2)){
    const groupId=id(2000+family.number);
    familyGroupRows.push([groupId,round,`FAM-${String(family.number).padStart(3,'0')} ${family.first}`,treasury,createdAt]);
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
    const payer=selected[0]?.person.name.split(' ').slice(1).join(' ')??personName(number,{adult:true});
    paymentRows.push([paymentId,round,mailOf(`familia ${payer} ${number}`),
      `Família ${payer}`,null,allocated+residual||10000,verified,
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
  personRows.push([id(nextSubmitted++),ambiguousPayment.id,'Nil Ferrer Llopis','nil ferrer llopis',
    '2013-02-14',section(2),null,'AMBIGUOUS',null,null]);
  const installmentPeople=[503,1002,1007];
  const installmentRows=installmentPeople.map((n,index)=>{
    const o=byPerson.get(n),half=Math.floor(o.due/2);
    return {id:id(8001+index),obligationId:o.id,first:half,second:o.due-half,firstAt:at(10,15),secondAt:at(12,15)};
  });
  const issueRows=[];let nextIssue=9001;
  for(const n of issuePeople){const o=byPerson.get(n);issueRows.push([id(nextIssue++),round,null,o.id,'DISCREPANCY','OPEN',treasury,createdAt,null,null]);}
  issueRows.push([id(nextIssue++),round,residualPayment.id,null,'ALLOCATION_UNCLEAR','OPEN',treasury,createdAt,null,null]);
  issueRows.push([id(nextIssue++),round,ambiguousPayment.id,null,'EVIDENCE_PROBLEM','OPEN',treasury,createdAt,null,null]);
  for(const n of [501,1005]){const o=byPerson.get(n);issueRows.push([id(nextIssue++),round,null,o.id,'DISCREPANCY','RESOLVED',treasury,at(8,1),treasury,at(8,5)]);}
  // 3.5E guardians, contacts, legal representation and administrative reviews (PARTICIPANTS.md §16).
  // Family 06 has two siblings in different sections (1006 Tropa, 1007 Escolta): a shared guardian
  // across sections. Names keep the synthetic '(fictici' marker. participant_contact already mirrors
  // an e-mail per participant, so adding a guardian completes a minor's record.
  const guardianRows=[], linkRows=[], guardianContactRows=[], repEventRows=[], reviewRows=[];
  const G=n=>id(15000+n);
  const guardian=(n,name)=>{ guardianRows.push([G(n),name,'ACTIVE',createdAt,createdAt]); return G(n); };
  const link=(participantNumber,n,{rel='PARENT',rep=false,basis=null}={})=>linkRows.push(
    [id(19000+linkRows.length+1),id(participantNumber),G(n),rel,rep?1:0,createdAt,rep?basis:null,coordinator,'DOCUMENTACIO_FISICA',createdAt,coordinator]);
  const gcontact=(cn,n,kind,value,primary=true)=>guardianContactRows.push([id(16000+cn),null,G(n),kind,value,'GENERAL',primary?1:0,null,createdAt,null]);
  const f6=families[5], f9=families[8];
  guardian(1,`${f6.mother} ${f6.second} ${familyOf(200).first}`); guardian(2,`${f6.father} ${f6.first} ${familyOf(201).second}`);
  guardian(3,`Carme ${f9.first} Pastor`); guardian(4,`${familyOf(202).father} ${familyOf(202).surnames}`);
  // Shared guardians across Tropa (1006) and Escolta (1007); the mother is a communicated representative.
  link(1006,1,{rep:true,basis:'COMUNICAT'}); link(1007,1,{});
  link(1006,2,{}); link(1007,2,{});
  // A complete Tropa family8 pair with a guardian and an accredited representative.
  link(1008,3,{rel:'LEGAL_GUARDIAN',rep:true,basis:'ACREDITAT'}); link(1009,3,{rel:'LEGAL_GUARDIAN'});
  // A guardian without a representative, on a Clan participant.
  link(1012,4,{});
  gcontact(1,1,'PHONE','600111222'); gcontact(2,1,'EMAIL',mailOf(guardianRows[0][1]));
  gcontact(3,2,'PHONE','600333444'); gcontact(4,3,'PHONE','600555666'); gcontact(5,4,'EMAIL',mailOf(guardianRows[3][1]));
  // 3.5I: the families added for 104 educands have a mother (phone + e-mail) and, in most, a father, as in a real group.
  let nextGuardian=100, nextContact=100;
  for(const family of families.slice(15)){
    guardian(nextGuardian++,`${family.mother} ${family.second} ${familyOf(family.number+300).second}`);
    for(const person of family.members)link(person.number,nextGuardian-1,{});
    // Same 600 0xx xxx pattern as the rest of the demo (never a plausible real number range is generated on purpose).
    gcontact(nextContact++,nextGuardian-1,'PHONE',`6000${String(family.number).padStart(2,'0')}${String(family.number*37%1000).padStart(3,'0')}`);
    gcontact(nextContact++,nextGuardian-1,'EMAIL',mailOf(guardianRows.at(-1)[1]));
    if(family.number%3){ guardian(nextGuardian++,`${family.father} ${family.first} ${familyOf(family.number+400).first}`);
      for(const person of family.members)link(person.number,nextGuardian-1,{}); }
  }
  repEventRows.push([id(17001),id(1006),G(1),'SET_REPRESENTATIVE','COMUNICAT','DOCUMENTACIO_FISICA',null,coordinator,createdAt]);
  repEventRows.push([id(17002),id(1008),G(3),'ACCREDIT','ACREDITAT','DOCUMENTACIO_FISICA',null,coordinator,createdAt]);
  // An open representation review, an open shared-guardian change request and a possible duplicate.
  reviewRows.push([id(18001),'REPRESENTATION_CHANGE','OPEN',id(1006),G(1),null,'Representant legal comunicat',null,coordinator,createdAt]);
  reviewRows.push([id(18002),'GUARDIAN_DATA_REQUEST','OPEN',id(1007),G(1),null,'Afegir telèfon a un tutor compartit',
    JSON.stringify({op:'ADD_CONTACT',kind:'PHONE',value:'600777888',purpose:'GENERAL'}),coordinator,createdAt]);
  const markerRow=[DEMO_MARKER_ID,createdAt,createdAt,id(14002),treasury,'DEMO_DATASET_SEEDED','demo_dataset',DEMO_VERSION,'SUCCESS',null,0];
  const chunks=[
    '-- Gestió local-only synthetic demo dataset. Generated by demo/data.js. Do not apply remotely.\n',
    insert('participant',['id','display_name','current_section_id','status','birth_date'],participantRows),
    insert('participant_contact',['participant_id','notification_email','verified_at'],contactRows),
    insert('activity',['id','public_code','name','status','audience','location','starts_at','ends_at','registration_deadline','price_cents','currency','short_description','materials','special_notice','created_by','created_at','updated_at'],activityRows),
    insert('activity_section',['activity_id','section_id'],activitySectionRows),
    insert('activity_transport_option',['activity_id','code','price_adjustment_cents'],transportRows),
    insert('activity_registration',['id','activity_id','participant_id','submitted_name','match_key','submitted_section_id','receipt_email','transport_code','expected_amount_cents','match_status','status','consent_version','participation_terms_version','participation_authorized_at','privacy_notice_version','privacy_notice_acknowledged_at','idempotency_key','payload_sha256','created_at','updated_at','reviewed_by','reviewed_at','submitted_by_name','contact_phone','submitted_birth_date','review_level','escalation_reason','escalated_at','escalated_by','withdrawn_at','withdrawn_by','withdrawal_source'],registrationRows),
    insert('payment_evidence',['id','registration_id','object_key','sha256','size_bytes','detected_mime','review_status','created_at','reviewed_at','reviewed_by'],activityEvidenceRows),
    insert('activity_payment_allocation',['id','registration_id','evidence_id','amount_cents','source','created_by','created_at'],allocationRowsActivity),
    correctionSql,
    // 3.5F: in the demo, Secretaria (seed-105) also works as the global registration reviewer.
    insert('user_permission_grant',['id','user_id','permission_code','valid_from','granted_by','justification'],
      ['activities.read','activities.registration.review','activities.registration.contact.read'].map((code,index)=>[id(19601+index),id(105),code,createdAt,null,'Fixture sintético'])),
    insert('annual_fee_family_group',['id','round_id','reference','created_by','created_at'],familyGroupRows),
    insert('annual_fee_family_member',['group_id','round_id','participant_id','sibling_ordinal','assigned_by','assigned_at'],familyMemberRows),
    insert('annual_fee_obligation',['id','round_id','participant_id','family_group_id','sibling_ordinal','base_cents','discount_cents','amount_due_cents','created_by','created_at','updated_at'],obligationRows),
    insert('annual_fee_installment_plan',['id','obligation_id','status','authorized_by','authorized_at'],
      installmentRows.map(row=>[row.id,row.obligationId,'DRAFT',treasury,createdAt])),
    insert('annual_fee_installment_part',['plan_id','ordinal','planned_cents','target_at'],
      installmentRows.flatMap(row=>[[row.id,1,row.first,row.firstAt],[row.id,2,row.second,row.secondAt]])),
    ...installmentRows.map(row=>`UPDATE annual_fee_installment_plan SET status='ACTIVE' WHERE id='${row.id}';\n`),
    insert('annual_fee_payment',['id','round_id','receipt_email','submitted_by_name','contact_phone','declared_amount_cents','verified_amount_cents','review_status','idempotency_key','payload_sha256','privacy_notice_version','privacy_notice_acknowledged_at','created_at','reviewed_by','reviewed_at'],paymentRows),
    insert('annual_fee_submission_person',['id','payment_id','submitted_name','match_key','submitted_birth_date','section_id','participant_id','match_status','reviewed_by','reviewed_at'],personRows),
    insert('annual_fee_evidence',['id','payment_id','object_key','sha256','size_bytes','detected_mime','created_at'],feeEvidenceRows),
    insert('annual_fee_allocation',['id','payment_id','obligation_id','amount_cents','created_by','created_at'],allocationRows),
    ...verifyUpdates.map(row=>row+'\n'),
    insert('annual_fee_issue',['id','round_id','payment_id','obligation_id','code','status','created_by','created_at','resolved_by','resolved_at'],issueRows),
    insert('guardian',['id','display_name','status','created_at','updated_at'],guardianRows),
    insert('participant_guardian',['id','participant_id','guardian_id','relationship','legal_representative','started_at','representation_basis','recorded_by','provenance','updated_at','created_by'],linkRows),
    insert('contact_point',['id','participant_id','guardian_id','kind','value','purpose','is_primary','verified_at','created_at','ended_at'],guardianContactRows),
    insert('participant_representation_event',['id','participant_id','guardian_id','action','basis','provenance','note','recorded_by','recorded_at'],repEventRows),
    insert('participant_review',['id','kind','status','participant_id','guardian_id','duplicate_of','detail','payload_json','created_by','created_at'],reviewRows),
    `UPDATE payment_evidence SET sha256=${sqlValue(digest)}, size_bytes=${pdf.length} WHERE object_key='fixture-only/no-binary';\n`,
    // 3.5I: realistic visible names for the canonical seed records too (local demo database only).
    seedRenames(sqlValue),
    insert('audit_event',['id','occurred_at','created_at','request_id','actor_user_id','action','resource_type','resource_id','result','reason_code','security_relevant'],[markerRow])
  ];
  return {sql:chunks.join(''),evidenceKeys:[...evidenceKeys],imageKeys:[...imageKeys],pdf,png,
    expected:{participants:104,activities:16,registrations:43,rounds:1,obligations:104,payments:19,
      families:{single:40,pair:14,triple:8,quadruple:3}}};
}

// 3.5G.1 financial foundation demo (TREASURY.md): round 2026/27 linked to the fee round, bank, card and
// cash, opening balances and reserves, a 3-level approved budget with one approved revision, an income
// allocation, a bank → cash → bank cash cycle as internal transfers, a cash expense and a card expense
// recognised and settled, and a scouter's advanced expense still proposed. Written with the same
// triggers the services use (allocation set versions, expense recognition after its lines).
export const TREASURY_DEMO_ROUND_ID = id(21001);
export function buildTreasuryDemo() {
  const R = TREASURY_DEMO_ROUND_ID, T = Date.UTC(2026, 9, 1, 9), u = treasury, c = coordinator;
  const bank = id(21011), card = id(21012), cash = id(21013);
  const line = (n, code, name, nature, parent = null, planned = null) => [id(n), R, code, name, parent ? id(parent) : null, n % 100, nature, planned, u, T, T];
  const lines = [
    line(21101, '1', 'Finançament', 'INCOME'), line(21102, '1.1', 'Quotes', 'INCOME', 21101, 1000000),
    line(21103, '1.2', 'Loteria', 'INCOME', 21101, 600000),
    line(21110, '1', 'Assegurança / Quota ASDE', 'EXPENSE'), line(21111, '1.1', 'Quota ASDE', 'EXPENSE', 21110, 450000),
    line(21120, '2', 'Campaments', 'EXPENSE'), line(21121, '2.3', 'Campament d’Estiu', 'EXPENSE', 21120),
    line(21122, '2.3.1', 'Autobús', 'EXPENSE', 21121, 600000), line(21123, '2.3.5', 'Cuina', 'EXPENSE', 21121, 1100000),
    line(21130, '3', 'Gastos corrents', 'EXPENSE'), line(21131, '3.3', 'Suministres', 'EXPENSE', 21130, 60000),
    line(21140, '5', 'Reserves pròpies', 'RESERVE_USE', null, 250000)];
  const fingerprint = n => createHash('sha256').update(`MANUAL|${id(n)}`).digest('hex');
  const movement = (n, position, date, amount, label) => [id(n), position, date, amount, 'MANUAL', fingerprint(n), label, u, T];
  const movements = [
    movement(21201, bank, '2026-10-05', 10000, 'Ingrés 2026-10-05'), movement(21202, bank, '2026-10-12', -50000, 'Càrrec 2026-10-12'),
    movement(21203, cash, '2026-10-12', 50000, 'Entrada a caixa'), movement(21204, cash, '2026-10-14', -43000, 'Pagament en efectiu'),
    movement(21205, cash, '2026-10-15', -7000, 'Reingrés del sobrant'), movement(21206, bank, '2026-10-15', 7000, 'Ingrés 2026-10-15'),
    movement(21207, card, '2026-10-20', -3000, 'Compra amb targeta')];
  const allocation = (n, movementN, kind, amount, target) => [id(n), id(movementN), 1, kind, amount,
    kind === 'INCOME' ? R : null, kind === 'INCOME' ? id(target) : null, kind.startsWith('EXPENSE') ? id(target) : null,
    kind === 'INTERNAL_TRANSFER' ? id(target) : null, u, T];
  const expense = (n, date, total, method, advancedBy = null) => [id(n), R, date, null, total, method, advancedBy, u, T, T];
  const scouter = id(21401);
  return [
    '-- 3.5G.1 treasury demo (synthetic). Generated by demo/data.js buildTreasuryDemo().\n',
    insert('finance_round', ['id', 'code', 'period_start', 'period_end', 'annual_fee_round_id', 'created_by', 'created_at', 'updated_at'],
      [[R, '2026/2027', '2026-10-01', '2027-09-30', round, u, T, T]]),
    `UPDATE activity_registration SET finance_round_id=${sqlValue(R)} WHERE expected_amount_cents>0 AND finance_round_id IS NULL
      AND activity_id IN (SELECT id FROM activity WHERE date(starts_at/1000,'unixepoch') BETWEEN '2026-10-01' AND '2027-09-30');\n`,
    `UPDATE finance_round SET status='OPEN',opened_by=${sqlValue(u)},opened_at=${T},version=2 WHERE id=${sqlValue(R)};\n`,
    insert('finance_position', ['id', 'kind', 'name', 'masked_reference', 'created_by', 'created_at', 'updated_at'],
      [[bank, 'BANK', 'Compte corrent', '0001', u, T, T], [card, 'CARD', 'Targeta de crèdit', '0002', u, T, T], [cash, 'CASH', 'Caixa', null, u, T, T]]),
    insert('finance_opening_balance', ['id', 'round_id', 'position_id', 'revision', 'amount_cents', 'source', 'recorded_by', 'recorded_at'],
      [[id(21021), R, bank, 1, 1568112, 'INITIALISATION', u, T], [id(21022), R, card, 1, 0, 'INITIALISATION', u, T],
        [id(21023), R, cash, 1, 0, 'INITIALISATION', u, T]]),
    insert('finance_reserve_opening', ['id', 'round_id', 'revision', 'amount_cents', 'source', 'recorded_by', 'recorded_at'],
      [[id(21031), R, 1, 1200000, 'INITIALISATION', u, T]]),
    insert('finance_budget_line', ['id', 'round_id', 'code', 'name', 'parent_id', 'sort_order', 'nature', 'planned_cents', 'created_by', 'created_at', 'updated_at'], lines),
    insert('finance_budget', ['id', 'round_id', 'created_by', 'created_at'], [[id(21051), R, u, T]]),
    `UPDATE finance_budget SET status='PROPOSED',proposed_by=${sqlValue(u)},proposed_at=${T},version=2 WHERE id=${sqlValue(id(21051))};\n`,
    `UPDATE finance_budget SET status='APPROVED',approved_by=${sqlValue(c)},approved_at=${T + 3600000},version=3 WHERE id=${sqlValue(id(21051))};\n`,
    insert('finance_budget_revision', ['id', 'budget_id', 'line_id', 'delta_cents', 'proposed_by', 'proposed_at'], [[id(21061), id(21051), id(21123), 50000, u, T]]),
    `UPDATE finance_budget_revision SET status='APPROVED',decided_by=${sqlValue(c)},decided_at=${T + 7200000},version=2 WHERE id=${sqlValue(id(21061))};\n`,
    insert('finance_counterparty', ['id', 'kind', 'display_name', 'created_by', 'created_at', 'updated_at'],
      [[scouter, 'PERSON', 'Jaume Seguí Reig', u, T, T], [id(21402), 'ORGANIZATION', 'Supermercat La Plaça', u, T, T]]),
    insert('finance_expense', ['id', 'round_id', 'expense_date', 'supplier_label', 'total_cents', 'payment_method', 'advanced_by_id', 'created_by', 'created_at', 'updated_at'],
      [expense(21301, '2026-10-14', 43000, 'CASH'), expense(21302, '2026-10-20', 3000, 'CARD'), expense(21303, '2026-10-22', 2500, 'ADVANCED', scouter)]),
    insert('finance_expense_line', ['expense_id', 'lines_version', 'line_no', 'budget_line_id', 'amount_cents'],
      [[id(21301), 1, 1, id(21123), 43000], [id(21302), 1, 1, id(21131), 3000], [id(21303), 1, 1, id(21122), 2500]]),
    insert('finance_expense_evidence', ['id', 'expense_id', 'object_key', 'sha256', 'size_bytes', 'detected_mime', 'uploaded_by', 'created_at'],
      treasuryEvidenceRows([21301, 21302], T, u)),
    `UPDATE finance_expense SET concept='Compra de menjar per a l’eixida' WHERE id=${sqlValue(id(21301))};\n`,
    `UPDATE finance_expense SET concept='Material de papereria',counterparty_id=${sqlValue(id(21402))} WHERE id=${sqlValue(id(21302))};\n`,
    `UPDATE finance_expense SET status='RECOGNISED',recognized_by=${sqlValue(u)},recognized_at=${T},version=2 WHERE id IN (${sqlValue(id(21301))},${sqlValue(id(21302))});\n`,
    insert('finance_movement', ['id', 'position_id', 'operation_date', 'amount_cents', 'origin', 'fingerprint', 'display_label', 'created_by', 'created_at'], movements),
    `UPDATE finance_movement SET allocation_version=1 WHERE id IN (${[21201, 21202, 21203, 21204, 21205, 21206, 21207].map(n => sqlValue(id(n))).join(',')});\n`,
    insert('finance_allocation', ['id', 'movement_id', 'set_version', 'kind', 'amount_cents', 'round_id', 'budget_line_id', 'expense_id', 'paired_movement_id', 'created_by', 'created_at'], [
      allocation(21501, 21201, 'INCOME', 10000, 21102),
      allocation(21502, 21202, 'INTERNAL_TRANSFER', 50000, 21203), allocation(21503, 21203, 'INTERNAL_TRANSFER', 50000, 21202),
      allocation(21504, 21204, 'EXPENSE_SETTLEMENT', 43000, 21301),
      allocation(21505, 21205, 'INTERNAL_TRANSFER', 7000, 21206), allocation(21506, 21206, 'INTERNAL_TRANSFER', 7000, 21205),
      allocation(21507, 21207, 'EXPENSE_SETTLEMENT', 3000, 21302)])
  ].join('');
}

export const TREASURY_OPERATIONS_MARKER_ID = id(22201);
/** 3.5G.2A operations demo, applied after buildTreasuryDemo(): a read-only synthetic import batch with a
 *  possible duplicate, pending and partial movements, a multi-line expense settled by a bank charge, a
 *  recognised expense still unpaid, a proposal, more counterparties, deeper budget lines and concepts. */
export function buildTreasuryOperationsDemo() {
  const R = TREASURY_DEMO_ROUND_ID, T = Date.UTC(2026, 9, 25, 9), u = treasury;
  const bank = id(21011);
  const line = (n, code, name, nature, parent) => [id(n), R, code, name, id(parent), n % 100, nature, null, u, T, T];
  const hash = text => createHash('sha256').update(text).digest('hex');
  const imported = (n, row, date, amount, reference, flag = null) => [id(n), bank, date, amount, 'IMPORT', id(22050), row, reference,
    hash(`DEMO-IMPORT|${id(n)}`), `${amount > 0 ? 'Ingrés' : 'Càrrec'} ${date} · ref. ${reference}`, flag, u, T];
  const expense = (n, date, concept, counterparty, total, method) => [id(n), R, date, concept, id(counterparty), total, method, u, T, T];
  return [
    '-- 3.5G.2A treasury operations demo (synthetic). Generated by demo/data.js buildTreasuryOperationsDemo().\n',
    `UPDATE finance_expense SET concept='Piles i cinta americana' WHERE id=${sqlValue(id(21303))};\n`,
    insert('finance_budget_line', ['id', 'round_id', 'code', 'name', 'parent_id', 'sort_order', 'nature', 'planned_cents', 'created_by', 'created_at', 'updated_at'], [
      line(22101, '1.3', 'Subvencions', 'INCOME', 21101),
      line(22110, '2.1', 'Campament de Nadal', 'EXPENSE', 21120), line(22111, '2.1.1', 'Transport', 'EXPENSE', 22110),
      line(22112, '2.1.2', 'Allotjament', 'EXPENSE', 22110), line(22120, '3.1', 'Material', 'EXPENSE', 21130)]),
    insert('finance_counterparty', ['id', 'kind', 'display_name', 'created_by', 'created_at', 'updated_at'], [
      [id(22401), 'ORGANIZATION', 'Autocars La Safor', u, T, T], [id(22402), 'ORGANIZATION', 'Alberg de la Drova', u, T, T],
      [id(22403), 'ORGANIZATION', 'Ferreteria Sant Josep', u, T, T]]),
    insert('finance_import_batch', ['id', 'position_id', 'source_format', 'file_sha256', 'row_count', 'created_count', 'duplicate_count', 'flagged_count', 'status', 'imported_by', 'imported_at'],
      [[id(22050), bank, 'SYNTHETIC_CSV_V1', hash('DEMO-IMPORT-BATCH-22050'), 5, 5, 0, 1, 'PARTIALLY_FLAGGED', u, T]]),
    insert('finance_movement', ['id', 'position_id', 'operation_date', 'amount_cents', 'origin', 'import_batch_id', 'batch_row', 'bank_reference', 'fingerprint', 'display_label', 'review_flag', 'created_by', 'created_at'], [
      imported(22201, 1, '2026-10-21', 45000, 'TRF-261021'), imported(22202, 2, '2026-10-22', -12000, 'TRF-261022'),
      imported(22203, 3, '2026-10-23', -8550, 'TRF-261023'), imported(22204, 4, '2026-10-23', -8550, 'TRF-261024', 'NEAR_MATCH'),
      imported(22205, 5, '2026-10-24', 20000, 'TRF-261025')]),
    insert('finance_movement_description', ['movement_id', 'original_text'], [
      [id(22201), 'TRANSFERENCIA RECIBIDA FAMILIA FERRER LLOPIS QUOTES OCTUBRE'], [id(22202), 'RECIBO LLOGUER FURGONETA AUTOCARS LA SAFOR'],
      [id(22203), 'COMPRA TARGETA FERRETERIA SANT JOSEP'], [id(22204), 'COMPRA TARGETA FERRETERIA SANT JOSEP REF 2'],
      [id(22205), 'TRANSFERENCIA AJUNTAMENT SUBVENCIO ACTIVITATS JUVENILS']]),
    insert('finance_movement', ['id', 'position_id', 'operation_date', 'amount_cents', 'origin', 'fingerprint', 'display_label', 'created_by', 'created_at'],
      [[id(22206), bank, '2026-10-26', -36000, 'MANUAL', hash(`MANUAL|${id(22206)}`), 'Càrrec 2026-10-26', u, T]]),
    insert('finance_expense', ['id', 'round_id', 'expense_date', 'concept', 'counterparty_id', 'total_cents', 'payment_method', 'created_by', 'created_at', 'updated_at'], [
      expense(22301, '2026-10-26', 'Autobús i alberg del Campament de Nadal', 22401, 36000, 'BANK'),
      expense(22302, '2026-10-22', 'Lloguer de furgoneta', 22401, 12000, 'BANK'),
      expense(22303, '2026-10-27', 'Material de manualitats', 22403, 4500, 'BANK')]),
    insert('finance_expense_line', ['expense_id', 'lines_version', 'line_no', 'budget_line_id', 'amount_cents'], [
      [id(22301), 1, 1, id(22111), 20000], [id(22301), 1, 2, id(22112), 16000], [id(22302), 1, 1, id(22111), 12000], [id(22303), 1, 1, id(22120), 4500]]),
    insert('finance_expense_evidence', ['id', 'expense_id', 'object_key', 'sha256', 'size_bytes', 'detected_mime', 'uploaded_by', 'created_at'],
      treasuryEvidenceRows([22301, 22302], T, u)),
    `UPDATE finance_expense SET status='RECOGNISED',recognized_by=${sqlValue(u)},recognized_at=${T},version=2 WHERE id IN (${sqlValue(id(22301))},${sqlValue(id(22302))});\n`,
    `UPDATE finance_movement SET allocation_version=1 WHERE id IN (${sqlValue(id(22205))},${sqlValue(id(22206))});\n`,
    insert('finance_allocation', ['id', 'movement_id', 'set_version', 'kind', 'amount_cents', 'round_id', 'budget_line_id', 'expense_id', 'created_by', 'created_at'], [
      [id(22501), id(22205), 1, 'INCOME', 15000, R, id(22101), null, u, T],
      [id(22502), id(22206), 1, 'EXPENSE_SETTLEMENT', 36000, null, null, id(22301), u, T]])
  ].join('');
}

export const TREASURY_INCOME_MARKER_ID = id(23001);
/** 3.5G.2A income extension demo: a grant pending reconciliation (its +1.500 € bank entry is still
 *  unidentified), a lottery sale already reconciled with its movement, and a +300 € entry nobody has
 *  identified yet. Applied after buildTreasuryOperationsDemo(). */
export function buildTreasuryIncomeDemo() {
  const R = TREASURY_DEMO_ROUND_ID, T = Date.UTC(2026, 9, 28, 9), u = treasury, bank = id(21011);
  const hash = text => createHash('sha256').update(text).digest('hex');
  return [
    '-- 3.5G.2A income demo (synthetic). Generated by demo/data.js buildTreasuryIncomeDemo().\n',
    insert('finance_counterparty', ['id', 'kind', 'display_name', 'created_by', 'created_at', 'updated_at'],
      [[id(23401), 'ORGANIZATION', 'Ajuntament (subvenció municipal)', u, T, T]]),
    insert('finance_income', ['id', 'round_id', 'income_date', 'concept', 'total_cents', 'budget_line_id', 'counterparty_id', 'created_by', 'created_at', 'updated_at'], [
      [id(23001), R, '2026-10-01', 'Subvenció Ajuntament', 150000, id(22101), id(23401), u, T, T],
      [id(23002), R, '2026-10-21', 'Venda de loteria de Nadal', 45000, id(21103), null, u, T, T]]),
    insert('finance_movement', ['id', 'position_id', 'operation_date', 'amount_cents', 'origin', 'fingerprint', 'display_label', 'created_by', 'created_at'], [
      [id(23201), bank, '2026-10-28', 150000, 'MANUAL', hash(`MANUAL|${id(23201)}`), 'Ingrés 2026-10-28', u, T],
      [id(23202), bank, '2026-10-29', 30000, 'MANUAL', hash(`MANUAL|${id(23202)}`), 'Ingrés 2026-10-29', u, T]]),
    `UPDATE finance_movement SET allocation_version=1 WHERE id=${sqlValue(id(22201))} AND allocation_version=0;\n`,
    insert('finance_allocation', ['id', 'movement_id', 'set_version', 'kind', 'amount_cents', 'round_id', 'budget_line_id', 'income_id', 'created_by', 'created_at'],
      [[id(23501), id(22201), 1, 'INCOME', 45000, R, id(21103), id(23002), u, T]])
  ].join('');
}
