/* Local-only runner for the definitive family portal.
 * Activities use the shared synthetic D1/R2 state under gestio/.wrangler/state.
 * Annual-quota handling remains on its existing Worker route and is closed by default.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root=dirname(fileURLToPath(import.meta.url));
const repo=resolve(root,"..");
const config=readFileSync(resolve(root,"wrangler.toml"),"utf8");
if (process.env.APP_ENV==="production" || !/^APP_ENV\s*=\s*"development"\s*$/m.test(config)) {
  throw new Error("Portal preview is restricted to the local synthetic environment");
}
const result=spawnSync(resolve(repo,"node_modules/.bin/wrangler"),[
  "dev","--local","--env","local","--config","wrangler.toml",
  "--persist-to",resolve(repo,"gestio/.wrangler/state"),"--ip","127.0.0.1","--port","4100",
],{cwd:root,stdio:"inherit",env:{...process.env,WRANGLER_SEND_METRICS:"false"}});
if (result.error) throw result.error;
process.exit(result.status??1);
