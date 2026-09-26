const $=id=>document.getElementById(id);
let activities=[];
const money=cents=>(cents/100).toLocaleString('ca-ES',{style:'currency',currency:'EUR'});
function selected(){return activities.find(activity=>activity.publicCode===$('activity').value);}
function render(){
  const activity=selected();if(!activity) return;
  $('summary').replaceChildren();
  const lines=[activity.name,activity.audience==='GENERAL'?'Tot el grup':activity.sections.join(', '),
    `Preu: ${money(activity.priceCents)}`,`Del ${new Date(activity.startsAt).toLocaleString('ca-ES')} al ${new Date(activity.endsAt).toLocaleString('ca-ES')}`,
    `Inscripció fins: ${new Date(activity.registrationDeadline).toLocaleString('ca-ES')}`,
    `Lloc: ${activity.location}`,activity.shortDescription,`Material: ${activity.materials}`,activity.specialNotice];
  for(const line of lines.filter(Boolean)){const p=document.createElement('p');p.textContent=line;$('summary').append(p);}
  $('transportLabel').hidden=!activity.transportOptions.length;
  $('transport').replaceChildren(...activity.transportOptions.map(option=>{
    const item=document.createElement('option');item.value=option.code;
    item.textContent=(option.code==='GROUP'?'Transport del grup':'Porta/recull la família')+` · ${money(activity.priceCents+option.adjustmentCents)}`;
    return item;
  }));
  const amount=activity.priceCents+(activity.transportOptions.find(option=>option.code===$('transport').value)?.adjustmentCents??0);
  $('evidenceLabel').hidden=amount===0;
  $('evidence').required=amount>0;
  $('section').required=activity.audience==='SECTIONS' && activity.sections.length>1;
  for(const option of $('section').options){if(option.value)option.disabled=activity.audience==='SECTIONS' && !activity.sections.includes(option.value);}
  if($('section').selectedOptions[0]?.disabled)$('section').value='';
}
async function load(){
  try{
    const response=await fetch('/api/activities');if(!response.ok)throw new Error('catàleg no disponible');
    activities=(await response.json()).activities;
    $('activity').replaceChildren(...activities.map(activity=>{const option=document.createElement('option');option.value=activity.publicCode;option.textContent=activity.name;return option;}));
    render();
  }catch(error){$('message').textContent=error.message;$('submit').disabled=true;}
}
function base64(bytes){let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.slice(i,i+8192));return btoa(raw);}
$('activity').addEventListener('change',render);$('transport').addEventListener('change',render);
$('registration').addEventListener('submit',async event=>{
  event.preventDefault();const activity=selected();if(!activity)return;
  $('submit').disabled=true;$('message').textContent='Enviant...';
  try{
    const file=$('evidence').files[0];
    if(file && file.size>4*1024*1024)throw new Error('El justificant és massa gran.');
    const evidence=file?{filename:file.name,mime:file.type,dataBase64:base64(new Uint8Array(await file.arrayBuffer()))}:undefined;
    const body={publicCode:activity.publicCode,participantName:$('participantName').value,sectionCode:$('section').value||null,
      transportCode:activity.transportOptions.length?$('transport').value:null,receiptEmail:$('email').value,
      consentVersion:'DEMO-3A',idempotencyKey:crypto.randomUUID().replaceAll('-',''),...(evidence?{evidence}:{})};
    const response=await fetch('/api/registrations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'No s’ha pogut enviar.');
    $('message').textContent='Tràmit de prova rebut. Consulta el correu de prova; no es mostren dades privades ací.';
    $('registration').reset();render();
  }catch(error){$('message').textContent=error.message;}
  finally{$('submit').disabled=false;}
});
await load();
