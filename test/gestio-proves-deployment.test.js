import test from 'node:test';
import assert from 'node:assert/strict';
import {provesDeploymentArgs} from '../gestio/scripts/proves.js';

test('Proves deployment metadata identifies the full validated Git commit and only its staging config',()=>{
 const sha='1234567890abcdef1234567890abcdef12345678';
 const args=provesDeploymentArgs(sha);
 assert.equal(args[0],'deploy');assert.match(args[args.indexOf('--config')+1],/gestio\/wrangler\.proves\.toml$/);
 assert.equal(args[args.indexOf('--tag')+1],sha);
 assert.equal(args[args.indexOf('--message')+1],`Gestió Proves commit ${sha}`);
 for(const bad of ['',sha.slice(0,7),'main','--config production'])assert.throws(()=>provesDeploymentArgs(bad),/SHA Git complet/);
});
