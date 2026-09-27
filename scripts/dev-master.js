import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import readline from 'node:readline/promises';

const root=process.cwd();
const pkg=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8'));
const npm=process.platform==='win32'?'npm.cmd':'npm';
const rl=readline.createInterface({input:process.stdin,output:process.stdout});
const services=[
  {key:'site',name:'Web pública',script:'dev:site',url:'http://localhost:4000/',health:'http://127.0.0.1:4000/',port:4000},
  {key:'portal',name:"Portal d'inscripcions",script:'dev:portal',url:'http://127.0.0.1:4100/',health:'http://127.0.0.1:4100/',port:4100},
  {key:'gestio',name:'Gestió',script:'dev:gestio',url:'http://127.0.0.1:8788/',
    health:'http://127.0.0.1:8788/api/dev/identities',port:8788}
];
const active=new Set();
let exitRequested=false;
let abortSession;
const interrupted=new Promise(resolveAbort=>{abortSession=resolveAbort;});

function checkProject() {
  if (pkg.name!=='web-parpallo' || !pkg.scripts || services.some(service=>typeof pkg.scripts[service.script]!=='string')) {
    throw new Error('No s\u0027han trobat els scripts npm canònics de Parpalló.');
  }
  for (const path of ['site/index.html','portal/dev.js','gestio/scripts/local.js','gestio/wrangler.toml']) {
    try { readFileSync(resolve(root,path)); }
    catch { throw new Error(`Falta el fitxer requerit del projecte: ${path}`); }
  }
  const version=spawnSync(npm,['--version'],{cwd:root,stdio:'ignore'});
  if (version.error || version.status!==0) throw new Error('npm està instal·lat però no s\u0027ha pogut executar.');
}

async function probe(service) {
  try {
    const response=await fetch(service.health,{signal:AbortSignal.timeout(900)});
    const body=await response.text();
    let identified=false;
    if (response.status>=200 && response.status<300) {
      if (service.key==='gestio') {
        try { identified=Array.isArray(JSON.parse(body).identities); } catch {}
      } else if (service.key==='portal') {
        identified=body.includes('Grup Scout Parpalló') && (body.includes('Accés privat')||body.includes('Inscripcions'));
      } else {
        identified=body.includes('<title>Grup Scout Parpalló');
      }
    }
    return {ready:identified,status:response.status};
  } catch { return {ready:false,status:null}; }
}

async function portIsFree(port) {
  const server=createServer();
  return new Promise((resolvePort,reject)=>{
    server.once('error',error=>error.code==='EADDRINUSE'?resolvePort(false):reject(error));
    server.listen(port,'127.0.0.1',()=>server.close(error=>error?reject(error):resolvePort(true)));
  });
}

function appendOutput(record,stream,chunk) {
  const value=chunk.toString();
  process[stream].write(value);
  record.output=(record.output+value).slice(-5000);
}

function launch(service) {
  const env={...process.env,APP_ENV:'development',WRANGLER_SEND_METRICS:'false'};
  if (service.key==='site') env.PORT='4000';
  const child=spawn(npm,['run',service.script],{cwd:root,stdio:['ignore','pipe','pipe'],detached:true,
    env});
  const record={service,child,output:'',close:null};
  child.stdout.on('data',chunk=>appendOutput(record,'stdout',chunk));
  child.stderr.on('data',chunk=>appendOutput(record,'stderr',chunk));
  record.close=new Promise(resolveClose=>{
    child.once('close',(code,signal)=>resolveClose({code,signal}));
    child.once('error',error=>resolveClose({code:1,signal:null,error}));
  });
  active.add(record);
  return record;
}

async function awaitReady(record) {
  const deadline=Date.now()+45000;
  while (Date.now()<deadline) {
    if (exitRequested) throw new Error('Arrancada cancel·lada.');
    const finished=await Promise.race([record.close.then(result=>({finished:true,result})),
      new Promise(resolveWait=>setTimeout(()=>resolveWait({finished:false}),250))]);
    if (finished.finished) {
      const {code,signal,error}=finished.result;
      throw new Error(`${record.service.name} s'ha tancat durant l'arrancada (${error?.message||`codi ${code??signal}`}).\n${record.output}`);
    }
    const result=await probe(record.service);
    if (result.ready) return;
    if (record.service.key==='gestio' && result.status>=500) {
      throw new Error('Gestió respon amb un error de D1. Comprova que la base local estiga migrada i sembrada; el launcher no l\u0027ha reiniciada ni modificada.');
    }
  }
  throw new Error(`${record.service.name} no ha arribat a estar disponible al port ${record.service.port}.\n${record.output}`);
}

async function preflight(selected) {
  const plans=[];
  for (const service of selected) {
    const current=await probe(service);
    if (current.ready) {
      plans.push({service,reused:true});
      continue;
    }
    if (!await portIsFree(service.port)) {
      throw new Error(`El port ${service.port} està ocupat per un servei que no puc identificar com ${service.name}. No l\u0027he aturat.`);
    }
    plans.push({service,reused:false});
  }
  return plans;
}

function runNpmScript(script) {
  const result=spawnSync(npm,['run',script],{cwd:root,stdio:'inherit',
    env:{...process.env,APP_ENV:'development',WRANGLER_SEND_METRICS:'false'}});
  if (result.error || result.status!==0) throw new Error(`Ha fallat npm run ${script}.`);
}

function localUserCount() {
  const result=spawnSync(resolve(root,'node_modules/.bin/wrangler'),['d1','execute','parpallo-gestio-local',
    '--local','--config','wrangler.toml',
    '--command','SELECT (SELECT count(*) FROM app_user) AS users,(SELECT count(*) FROM participant) AS participants,(SELECT count(*) FROM section) AS sections,(SELECT count(*) FROM activity) AS activities,(SELECT count(*) FROM annual_fee_round) AS rounds','--json'],
  {cwd:resolve(root,'gestio'),encoding:'utf8',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
  if (result.error || result.status!==0) throw new Error(`No he pogut comprovar l'estat de D1 local. ${(result.stderr||'').slice(-1200)}`);
  try { return JSON.parse(result.stdout)[0].results[0]; }
  catch { throw new Error('No he pogut interpretar la comprovació de D1 local; no he carregat el seed.'); }
}

function prepareLocalDatabase() {
  console.log('Comprovant D1 local sense reiniciar-la...');
  runNpmScript('gestio:migrate');
  const state=localUserCount();
  const counts=Object.values(state).map(Number);
  if (counts.some(count=>!Number.isSafeInteger(count)||count<0)) {
    throw new Error('D1 ha retornat recomptes invàlids; no he carregat el seed.');
  }
  if (counts.every(count=>count===0)) {
    console.log('D1 no té identitats locals; carregant el seed sintètic canònic una sola vegada.');
    runNpmScript('gestio:seed');
  } else if (Number(state.users)===0) {
    throw new Error('D1 conté dades locals però no té identitats seed; no he afegit fixtures per a evitar barrejar-les.');
  }
}

function openBrowser(service) {
  if (process.platform!=='darwin') {
    console.log(`Obri esta adreça al navegador: ${service.url}`);
    return;
  }
  const result=spawnSync('open',[service.url],{cwd:root,stdio:'ignore'});
  if (result.error || result.status!==0) console.log(`No he pogut obrir el navegador. Adreça: ${service.url}`);
}

function signalGroup(record,signal) {
  if (!record.child.pid) return;
  try { process.kill(-record.child.pid,signal); }
  catch(error) { if (error.code!=='ESRCH') console.error(`No s\u0027ha pogut tancar ${record.service.name}: ${error.message}`); }
}

async function stopStarted(records) {
  const owned=records.filter(record=>record && active.has(record));
  if (!owned.length) return;
  for (const record of owned) signalGroup(record,'SIGTERM');
  let timer;
  await Promise.race([Promise.all(owned.map(record=>record.close)),
    new Promise(resolveWait=>{timer=setTimeout(resolveWait,5000);})]);
  clearTimeout(timer);
  for (const record of owned) {
    if (active.has(record)) signalGroup(record,'SIGKILL');
  }
  await Promise.all(owned.map(record=>record.close));
  for (const record of owned) active.delete(record);
}

async function runSelection(selected) {
  let records=[];
  try {
    const plans=await preflight(selected);
    if (plans.some(plan=>!plan.reused) && selected.some(service=>service.key==='portal'||service.key==='gestio')) {
      prepareLocalDatabase();
    }
    for (const plan of plans) {
      if (plan.reused) {
        console.log(`${plan.service.name} ja estava actiu; reutilitze ${plan.service.url}`);
        continue;
      }
      console.log(`Arrancant ${plan.service.name} amb npm run ${plan.service.script}...`);
      const record=launch(plan.service);
      records.push(record);
      await awaitReady(record);
      console.log(`${plan.service.name} disponible: ${plan.service.url}`);
    }
    for (const plan of plans) openBrowser(plan.service);
    if (records.length) {
      console.log('\nEls serveis iniciats pel launcher continuaran actius. Prem Ctrl+C per a tancar-los tots.');
      const ended=await Promise.race([...records.map(record=>record.close.then(result=>({record,result}))),
        interrupted.then(()=>({interrupted:true}))]);
      if (!ended.interrupted) {
        console.error(`${ended.record.service.name} s\u0027ha tancat (${ended.result.error?.message||`codi ${ended.result.code??ended.result.signal}`}).`);
      }
    } else {
      console.log('No he iniciat cap procés nou; els serveis reutilitzats continuen sota el control del procés que els va iniciar.');
    }
  } catch(error) {
    console.error(`\nNo s\u0027ha pogut iniciar el conjunt demanat: ${error.message}`);
  } finally {
    await stopStarted(records);
  }
}

function requestExit() {
  if (exitRequested) return;
  exitRequested=true;
  abortSession();
  rl.close();
}
process.once('SIGINT',requestExit);
process.once('SIGTERM',requestExit);
rl.on('SIGINT',requestExit);

async function main() {
  checkProject();
  console.log('Parpalló local · dades sintètiques');
  while (!exitRequested) {
    console.log('\n1. Web pública\n2. Portal d\u0027inscripcions\n3. Gestió\n4. Obrir les tres\n5. Eixir');
    let answer;
    try { answer=(await rl.question('Tria una opció: ')).trim(); }
    catch { break; }
    if (answer==='5') break;
    const byChoice={'1':['site'],'2':['portal'],'3':['gestio'],'4':['site','gestio','portal']};
    const keys=byChoice[answer];
    if (!keys) { console.log('Opció no vàlida.'); continue; }
    await runSelection(services.filter(service=>keys.includes(service.key)));
    if (exitRequested) break;
  }
}

main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>rl.close());
