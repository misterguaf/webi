import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(root, '..');
const state = resolve(root, '.wrangler', 'state');
const wrangler = resolve(repo, 'node_modules', '.bin', 'wrangler');
const action = process.argv[2];
if (!['migrate','seed','reset','dev'].includes(action)) throw new Error('Unknown local action');
const config = readFileSync(resolve(root,'wrangler.toml'),'utf8');
if (process.env.APP_ENV === 'production' ||
    !/^APP_ENV\s*=\s*"development"\s*$/m.test(config) ||
    !/^DEV_IDENTITY_PROVIDER\s*=\s*"enabled"\s*$/m.test(config)) {
  throw new Error('Local gestio commands require development configuration; production with dev identity provider is forbidden');
}
if (!existsSync(wrangler)) throw new Error('Run npm ci before local D1 commands');
const run = args => {
  const result = spawnSync(wrangler, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
};
if (action === 'reset') {
  // Only the narrowly resolved local Wrangler state inside gestio is removed.
  if (state !== resolve(root, '.wrangler', 'state')) throw new Error('Unsafe reset target');
  rmSync(state, { recursive: true, force: true });
  run(['d1','migrations','apply','parpallo-gestio-local','--local','--config','wrangler.toml']);
  run(['d1','execute','parpallo-gestio-local','--local','--config','wrangler.toml','--file','seed.sql','--yes']);
} else if (action === 'migrate') {
  run(['d1','migrations','apply','parpallo-gestio-local','--local','--config','wrangler.toml']);
} else if (action === 'seed') {
  run(['d1','execute','parpallo-gestio-local','--local','--config','wrangler.toml','--file','seed.sql','--yes']);
} else {
  run(['dev','--local','--ip','127.0.0.1','--port','8788','--config','wrangler.toml']);
}
