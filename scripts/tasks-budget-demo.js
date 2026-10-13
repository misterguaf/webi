// Fresh synthetic review environment: never reads or resets the ordinary gestio/.wrangler state.
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PORT_ARGS,readyBase} from '../test/helpers/wrangler-port.js';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..'),gestio=resolve(repo,'gestio');
const temporary=mkdtempSync(resolve(tmpdir(),'parpallo-tasks-budget-review-')),state=resolve(temporary,'state');
const wrangler=resolve(repo,'node_modules/.bin/wrangler'),env={...process.env,WRANGLER_SEND_METRICS:'false',
 WRANGLER_REGISTRY_PATH:resolve(temporary,'registry')};
function run(args){const r=spawnSync(wrangler,args,{cwd:gestio,env,encoding:'utf8',maxBuffer:8*1024*1024});
 if(r.status!==0)throw new Error((r.stderr||r.stdout).slice(-3000));}
let child;
try{
 console.log('Preparant D1/R2 temporal amb identitats sintètiques…');
 run(['d1','migrations','apply','parpallo-gestio-local','--local','--persist-to',state,'--config','wrangler.toml']);
 run(['d1','execute','parpallo-gestio-local','--local','--persist-to',state,'--config','wrangler.toml','--file','seed.sql','--yes']);
 const receipt=resolve(temporary,'synthetic-ticket.pdf');
 writeFileSync(receipt,'%PDF-1.4\n%synthetic local fixture\n1 0 obj <<>> endobj\n%%EOF');
 child=spawn(wrangler,['dev','--local','--persist-to',state,'--config','wrangler.toml',...PORT_ARGS],{cwd:gestio,env,stdio:['ignore','pipe','pipe']});
 let logs='',ready=false;
 const output=chunk=>{logs=(logs+chunk).slice(-10000);const base=readyBase(logs);
  if(base&&!ready){ready=true;console.log('Entorn de revisió: '+base);console.log('Justificant fictici: '+receipt);
   console.log('Identitats: Coordinació de Grup, Tresoreria i coordinacions de secció. Ctrl+C tanca només aquest entorn.');}
 };
 child.stdout.on('data',output);child.stderr.on('data',output);
 const timer=setTimeout(()=>{if(!ready){console.error(logs);child.kill('SIGTERM');}},45000);
 const stop=()=>child.kill('SIGTERM');
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 await new Promise(done=>child.once('exit',done));clearTimeout(timer);
 if(!ready)process.exitCode=1;
}catch(error){console.error(error.message);process.exitCode=1;}
finally{rmSync(temporary,{recursive:true,force:true});}
