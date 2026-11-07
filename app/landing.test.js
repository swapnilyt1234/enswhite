import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import vm from 'node:vm';
import {createJudgeApp} from './judge-server.js';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const html=read('./judge-public/index.html');

test('landing actions, artwork and policy links are served under the existing CSP',async t=>{
 const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`,judge=createJudgeApp({origin,proof:{close(){}}});server.on('request',judge.app);
 t.after(async()=>{await judge.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))});
 for(const path of ['/','/landing.css','/public.js','/privacy.html','/terms.html','/enswhite-press.png','/favicon.svg']){const response=await fetch(origin+path);assert.equal(response.status,200,path);assert.match(response.headers.get('content-security-policy'),/script-src 'self'/);await response.arrayBuffer()}
 assert.equal((html.match(/class="feature-card"/g)||[]).length,3);assert.equal((html.match(/class="quote-card"/g)||[]).length,3);assert.equal((html.match(/class="price-card /g)||[]).length,3);assert.equal((html.match(/class="price-card featured"/g)||[]).length,1);
 for(const [,id]of html.matchAll(/href="#([^"]+)"/g))assert(html.includes(`id="${id}"`),`Missing target ${id}`);
 assert.match(html,/Illustrative demo scenarios, not customer testimonials/);assert.match(html,/id="enter"/);assert.match(html,/name="viewport"/);assert.match(html,/property="og:image"/);assert(!/<script[^>]+src="https?:/.test(html));
});

test('theme control follows system preference, persists a choice and does not call any payment API',()=>{
 const handlers={},storage=new Map(),root={dataset:{}},button={addEventListener:(name,fn)=>handlers[name]=fn,setAttribute:(name,value)=>button[name]=value},system={matches:true,addEventListener:(name,fn)=>handlers.system=fn};
 const context=vm.createContext({document:{documentElement:root,getElementById:id=>id==='theme-toggle'?button:null,querySelectorAll:()=>[]},matchMedia:()=>system,localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},fetch:()=>{throw new Error('Theme changes cannot call an API')}});
 vm.runInContext(read('./judge-public/public.js'),context);assert.equal(root.dataset.theme,'dark');assert.equal(button['aria-label'],'Switch to light theme');handlers.click();assert.equal(root.dataset.theme,'light');assert.equal(storage.get('enswhiteTheme'),'light');assert.equal(button['aria-pressed'],'false');handlers.system({matches:true});assert.equal(root.dataset.theme,'light');
});

test('pricing suggestions only preselect valid working roles and never submit a hire',()=>{
 const launch=read('./launch-public/launch.js'),source=launch.slice(launch.indexOf('const suggestedTeam='),launch.indexOf('void refresh().catch'));
 for(const [team,expected]of [['marketing',[true,false]],['support',[false,true]],['full',[true,true]],['untrusted',[true,true]]]){
  const roles=[{value:'marketing',checked:true},{value:'support',checked:true}],context=vm.createContext({location:{search:'?team='+team},URLSearchParams,$:()=>({querySelectorAll:()=>roles})});vm.runInContext(source,context);assert.deepEqual(roles.map(x=>x.checked),expected);
  if(team!=='untrusted')assert(html.includes(`/launch/?team=${team}`));
 }
});

function luminance(hex){const channels=hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722}
function contrast(a,b){const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
test('light and dark text palettes meet WCAG AA contrast on each reading surface',()=>{
 const css=read('./styles/landing.css'),tokensCSS=read('./styles/tokens.css'),blocks=[tokensCSS.match(/@theme static\s*\{([^}]+)/)[1],tokensCSS.match(/:root\[data-theme=dark\]\s*\{([^}]+)/)[1]];
 for(const block of blocks){const tokens=Object.fromEntries([...block.matchAll(/--color-([\w-]+):\s*(#[0-9a-f]{6})/g)].map(x=>[x[1],x[2]]));for(const surface of ['bg','surface','surface-strong'])for(const ink of ['text','text-muted','accent'])assert(contrast(tokens[ink],tokens[surface])>=4.5,`${ink} on ${surface}`);assert(contrast(tokens.bg,tokens.primary)>=4.5)}
 assert.match(css,/prefers-reduced-motion/);assert.match(css,/:focus-visible/);assert.match(css,/max-width:520px/);
});


test('clicking the guest button SVG locks the actual button and creates only one workspace',async()=>{
 let click,resolve,calls=0;const gate=new Promise(r=>{resolve=r}),button={disabled:false,addEventListener:(event,fn)=>{click=fn}},message={},location={};
 const context=vm.createContext({document:{documentElement:{dataset:{}},getElementById:id=>id==='enter'?button:id==='message'?message:null,querySelectorAll:()=>[]},location,matchMedia:()=>({matches:false,addEventListener(){}}),localStorage:{getItem(){throw new Error('storage unavailable')}},fetch:async()=>{calls++;await gate;return{ok:true,json:async()=>({url:'/guest/'})}}});
 vm.runInContext(read('./judge-public/public.js'),context);const svg={},first=click({currentTarget:button,target:svg});assert.equal(button.disabled,true);assert.equal(svg.disabled,undefined);await click({currentTarget:button,target:svg});assert.equal(calls,1);resolve();await first;assert.equal(location.href,'/guest/');
});
