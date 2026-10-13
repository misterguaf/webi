export const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Madrid'}).format(Date.now());
export const dateLabel=value=>new Date(value+'T12:00:00Z').toLocaleDateString('ca-ES',{weekday:'short',day:'numeric',month:'short'});
export function addDays(date,days){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
export function calendarDays(date,view){
 if(view==='day')return [date];
 const d=new Date(date+'T12:00:00Z');
 if(view==='month')d.setUTCDate(1);
 const first=addDays(d.toISOString().slice(0,10),-((d.getUTCDay()+6)%7));
 return Array.from({length:view==='month'?42:7},(_,i)=>addDays(first,i));
}
export function navigateDate(date,view,direction){
 if(view!=='month')return addDays(date,direction*(view==='week'?7:1));
 const d=new Date(date+'T12:00:00Z');d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+direction);return d.toISOString().slice(0,10);
}
export const taskKind=task=>task.visibility==='PERSONAL'?'Personal':'Compartida';
