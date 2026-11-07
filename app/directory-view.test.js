import test from 'node:test';
import assert from 'node:assert/strict';
import {createDirectoryView} from './directory-view.js';
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('a slow ENS directory cannot block the balance screen and overlapping views share one read',async()=>{
 let finish,reads=0;const pending=new Promise(resolve=>{finish=resolve}),read=createDirectoryView({organization(){reads++;return pending},branding:async()=>({name:'Company'})});
 assert.equal(read().status,'loading');read();await flush();assert.equal(reads,1);finish([{name:'finance.company.eth'}]);await flush();const view=read();assert.equal(view.status,'ready');assert.equal(view.organization.length,1);assert(view.checkedAt);assert.equal(reads,1);
});
test('a directory outage is labelled unavailable and never discards its last checked display data',async t=>{
 const realNow=Date.now;let now=realNow(),fail=false; t.mock.method(Date,'now',()=>now);
 const read=createDirectoryView({organization:async()=>{if(fail)throw new Error('RPC timeout');return[{name:'finance.company.eth'}]},branding:async()=>null});
 read();await flush();const checked=read().checkedAt;fail=true;now+=61000;assert.equal(read().status,'refreshing');await flush();const view=read();assert.equal(view.status,'unavailable');assert.equal(view.checkedAt,checked);assert.equal(view.organization[0].name,'finance.company.eth');
});
