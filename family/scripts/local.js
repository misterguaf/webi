import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const repo=resolve(root,'..');
const config=readFileSync(resolve(root,'wrangler.toml'),'utf8');
if (process.env.APP_ENV==='production' || !/^APP_ENV\s*=\s*"development"\s*$/m.test(config) ||
    !/database_id\s*=\s*"00000000-0000-0000-0000-000000000001"/.test(config))
  throw new Error('Family activity preview requires local synthetic configuration');
const result=spawnSync(resolve(repo,'node_modules/.bin/wrangler'),['dev','--local','--config','wrangler.toml',
  '--persist-to',resolve(repo,'gestio/.wrangler/state'),'--ip','127.0.0.1','--port','8789'],
  {cwd:root,stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
process.exit(result.status||0);
