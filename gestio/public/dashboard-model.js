const DAY=86400000;

export function greeting(displayName,now=new Date()) {
  const name=String(displayName||'').replace(/\s*\([^)]*\)/g,'').trim().split(/\s+/)[0]||'equip';
  const hour=now.getHours();
  return `${hour<12?'Bon dia':hour<20?'Bona vesprada':'Bona nit'}, ${name}.`;
}

export function attentionPhrase(count) {
  if(count===null)return 'Estem comprovant què necessita la teua atenció.';
  if(count===0)return 'Tot al dia. Hui pots anar amb calma.';
  if(count===1)return 'Hi ha una cosa que necessita la teua atenció.';
  if(count===2)return 'Hi ha un parell de coses pendents.';
  return `Tens ${count} coses que necessiten la teua atenció.`;
}

export function upcomingActivities(activities,now=Date.now()) {
  const horizon=now+180*DAY;
  const upcoming=activities.filter(row=>row.status==='PUBLISHED' && row.ends_at>=now && row.starts_at<=horizon)
    .sort((a,b)=>{
      const aDeadline=a.registration_deadline>=now?a.registration_deadline:Infinity;
      const bDeadline=b.registration_deadline>=now?b.registration_deadline:Infinity;
      return aDeadline-bDeadline || a.starts_at-b.starts_at;
    });
  const result=upcoming.slice(0,3);
  const draft=activities.filter(row=>row.status==='DRAFT' && row.ends_at>=now && row.starts_at<=horizon)
    .sort((a,b)=>a.starts_at-b.starts_at)[0];
  if(draft && result.length<4)result.push(draft);
  return result;
}

export function registrationAttention(activity,registrations) {
  const count=registrations.filter(row=>row.status==='NEEDS_PARTICIPANT_REVIEW').length;
  return count?{kind:'registrations',count,activityId:activity.id,activityName:activity.name,
    text:`${count} ${count===1?'inscripció':'inscripcions'} per revisar · ${activity.name}`}:null;
}

export function paymentAttention(payments) {
  const count=payments.filter(row=>['PENDING_REVIEW','ISSUE'].includes(row.review_status)).length;
  return count?{kind:'payments',count,text:`${count} ${count===1?'pagament':'pagaments'} per revisar`}:null;
}

export function feeIssueAttention(issues) {
  const count=issues.filter(row=>row.status==='OPEN').length;
  return count?{kind:'fees',count,text:`${count} ${count===1?'incidència':'incidències'} de quotes`}:null;
}

export function dateLabel(value) {
  return new Intl.DateTimeFormat('ca-ES',{day:'numeric',month:'short'}).format(new Date(value));
}

export function deadlineLabel(deadline,now=Date.now()) {
  if(deadline<now)return 'Termini tancat';
  const days=Math.ceil((deadline-now)/DAY);
  return days===0?'Últim dia per inscriure’s':days===1?'Termini demà':`Termini en ${days} dies`;
}

export function sectionLabel(activity) {
  if(activity.audience==='GENERAL')return 'Tot el grup';
  const labels={MANADA:'Manada',TROPA:'Tropa',ESCOLTA:'Escolta',CLAN:'Clan'};
  return String(activity.sections||'').split(',').map(code=>labels[code.trim()]||'Secció').join(' · ');
}

export function financialSummary(metrics) {
  if(!metrics || !Number.isFinite(metrics.collectedPercent) || !metrics.statusCounts)return null;
  return {percent:Math.max(0,Math.min(100,metrics.collectedPercent)),
    paid:metrics.statusCounts.PAID||0,partial:metrics.statusCounts.PARTIAL||0,issues:metrics.issueCount||0};
}

export function basicFeeSummary(statuses) {
  if(!Array.isArray(statuses))return null;
  const counts={PAID:0,PARTIAL:0,PENDING:0,ISSUE:0};
  for(const row of statuses)if(Object.hasOwn(counts,row.status))counts[row.status]++;
  return counts;
}

// Mirrors listRegistrations scope: GENERAL activities are reviewable by any reviewer (rows are
// filtered server-side by section); section activities need an overlapping section.
export function canReviewActivity(activity,scope) {
  if(!scope)return false;
  if(scope.all || activity.audience==='GENERAL')return true;
  const codes=String(activity.sections||'').split(',').map(code=>code.trim());
  return scope.sections.some(section=>codes.includes(section.code));
}
