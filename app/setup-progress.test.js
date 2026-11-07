import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setupProgress} from './launch-public/setup-progress.js';

test('setup progress counts the selected team and ignores duplicate, unknown and unconfirmed steps',()=>{
 for(const [roles,total]of [[['finance','marketing','support'],33],[['finance','marketing'],24],[['finance','support'],23]]){
  const job={roles,state:'launched',steps:[]};assert.equal(setupProgress(job).total,total);assert.equal(setupProgress(job).percent,0);
  job.steps.push({step:'unrelated',state:'confirmed'},{step:'launch-company',state:'submitted'});assert.equal(setupProgress(job).count,0);
  job.steps.push({step:'launch-company',state:'confirmed'},{step:'launch-company',state:'confirmed'});assert.equal(setupProgress(job).count,1);assert.equal(setupProgress(job).phase,1);
 }
});
test('100 percent requires all planned receipts and final readiness, never just elapsed time',()=>{
 const job={roles:['finance','marketing','support'],state:'launched',steps:[]};let previous=0;
 while(setupProgress(job).next){const step=setupProgress(job).next;job.steps.push({step,state:'confirmed'});const progress=setupProgress(job);assert(progress.percent>=previous&&progress.percent<100);previous=progress.percent}
 let progress=setupProgress(job);assert.equal(progress.count,33);assert.equal(progress.percent,99);assert.equal(progress.phase,3);assert.equal(progress.complete,false);
 job.state='ready';progress=setupProgress(job);assert.equal(progress.percent,100);assert.equal(progress.phase,4);assert.equal(progress.complete,true);
 job.steps.pop();assert(setupProgress(job).percent<100,'A ready flag cannot stand in for a missing receipt');
});
test('a paused setup preserves confirmed progress and the next saved step',()=>{
 const job={roles:['finance','support'],state:'launched',steps:[{step:'launch-company',state:'confirmed'}]},before=setupProgress(job);job.error='Temporary connection failure';const after=setupProgress(job);assert.equal(after.percent,before.percent);assert.equal(after.next,before.next);assert.equal(after.paused,true);
});
test('each static app receives the same theme and preserves reduced-motion and form accessibility styles',()=>{
 const read=path=>readFileSync(new URL(path,import.meta.url),'utf8'),css=read('./judge-public/app-theme.css'),js=read('./styles/app-theme.js');
 for(const folder of ['company-public','launch-public','public']){assert.equal(read('./'+folder+'/app-theme.css'),css);assert.equal(read('./'+folder+'/app-theme.js'),js)}
 assert.equal(read('./judge-public/app-theme.js'),js);assert.match(css,/prefers-reduced-motion/);assert.match(css,/:focus-visible/);assert.match(css,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);assert.match(css,/--color-accent:#a1361c/);
 for(const path of ['company-public/index.html','company-public/kit.html','launch-public/index.html','judge-public/proof.html','judge-public/agent.html','judge-public/vendor.html','public/index.html']){const html=read('./'+path);assert(html.includes('app-theme.css'),path);assert(html.includes('app-theme.js'),path)}
});
import vm from 'node:vm';
test('shared app theme restores the landing preference and toggles without network or signing access',()=>{
 const handlers={},stored=[],root={dataset:{}},button={setAttribute:(key,value)=>button[key]=value,addEventListener:(name,fn)=>handlers[name]=fn},host={append:node=>{assert.equal(node,button)}};
 const context=vm.createContext({document:{documentElement:root,createElement:()=>button,querySelector:()=>host},matchMedia:()=>({matches:false,addEventListener(){}}),localStorage:{getItem:()=> 'dark',setItem:(key,value)=>stored.push([key,value])},fetch:()=>{throw new Error('No network allowed')}});
 vm.runInContext(readFileSync(new URL('./styles/app-theme.js',import.meta.url),'utf8'),context);assert.equal(root.dataset.theme,'dark');assert.equal(button['aria-label'],'Switch to light theme');handlers.click();assert.equal(root.dataset.theme,'light');assert.deepEqual(stored,[['enswhiteTheme','light']]);
});
test('native setup progress exposes the confirmed percentage and current phase accessibly',()=>{
 const launch=readFileSync(new URL('./launch-public/launch.js',import.meta.url),'utf8'),nodes=Object.fromEntries(['setup-progress','progress-percent','progress-title','progress-summary'].map(id=>[id,{}])),phases=Array.from({length:4},()=>({dataset:{},setAttribute(name,value){this[name]=value},removeAttribute(name){delete this[name]}}));
 const context=vm.createContext({setupProgress,$:id=>nodes[id],stepLabel:x=>x,document:{querySelectorAll:()=>phases}});vm.runInContext(launch.slice(launch.indexOf('function renderSetupProgress('),launch.indexOf('function refresh()')),context);
 context.renderSetupProgress({roles:['finance','marketing','support'],state:'launched',steps:[{step:'launch-company',state:'confirmed'}]});assert.equal(nodes['setup-progress'].value,3);assert.equal(nodes['progress-percent'].textContent,'3%');assert.match(nodes['progress-summary'].textContent,/1 of 33/);assert.equal(phases[0].dataset.complete,'true');assert.equal(phases[1]['aria-current'],'step');
});
