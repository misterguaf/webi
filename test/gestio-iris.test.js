import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const css=readFileSync(new URL('../gestio/public/shell.css',import.meta.url),'utf8');
const rules=css.slice(0,css.indexOf('*,*::before')).split(':root[data-theme="dark"]');
const tokens=rule=>Object.fromEntries([...rule.matchAll(/(--[\w-]+):([^;]+);/g)].map(m=>[m[1],m[2].trim()]));
const rgb=hex=>hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255);
const luminance=hex=>rgb(hex).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
for(const [i,theme]of ['light','dark'].entries())test(`Iris ${theme}: ordinary text, filled controls and focus have usable contrast`,()=>{
 const t={...tokens(rules[0]),...(i?tokens(rules[1]):{})};
 for(const surface of ['--bg-primary','--surface-primary','--surface-elevated'])for(const text of ['--text-primary','--text-secondary'])
  assert.ok(contrast(t[text],t[surface])>=4.5,`${text} / ${surface}: ${contrast(t[text],t[surface]).toFixed(2)}`);
 for(const fill of ['--iris-button','--iris-button-hover','--danger-button','--danger-button-hover'])
  assert.ok(contrast(t['--on-iris'],t[fill])>=4.5,`${fill} / label`);
 assert.ok(contrast(t['--focus-ring'],t['--surface-primary'])>=3,'focus outline / surface');
});

test('Iris local icon resources used by its CSS masks exist, and the login scene has reduced-motion controls',()=>{
 const iris=readFileSync(new URL('../gestio/public/iris.css',import.meta.url),'utf8');
 for(const match of iris.matchAll(/url\(['"]?(icons\/[^)'"\s]+)['"]?\)/g))
  assert.match(readFileSync(new URL('../gestio/public/'+match[1],import.meta.url),'utf8'),/<svg\b/);
 const scene=readFileSync(new URL('../gestio/public/login-scene.js',import.meta.url),'utf8');
 assert.match(scene,/prefers-reduced-motion: reduce/);assert.match(scene,/visibilitychange/);
});
