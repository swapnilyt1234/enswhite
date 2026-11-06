import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('./company-public/company-ui.js',import.meta.url),'utf8');
const apiSource=source.slice(source.indexOf('async function api('),source.indexOf('function go('));
function client(fetch){const notices=[];const context=vm.createContext({fetch,TypeError,Error,routePrefix:'/company',status:message=>notices.push(message),setTimeout:fn=>fn(),$:()=>({hidden:true})});vm.runInContext(apiSource,context);return{api:context.api,notices}}
test('Finance approval reconnects using the identical request; checkout is never automatically repeated',async()=>{
 const requests=[];const {api,notices}=client(async(url,options)=>{requests.push({url,body:options.body});return{status:requests.length<3?503:200,ok:requests.length>=3,json:async()=>{if(requests.length<3)throw new SyntaxError('Gateway returned HTML');return{accepted:true}}}});
 assert.equal((await api('/allocate',{method:'POST',body:'{"proposalId":"saved"}'})).accepted,true);assert.equal(requests.length,3);assert(requests.every(x=>x.body===requests[0].body));assert.equal(notices.length,2);
 let count=0;const checkout=client(async()=>{count++;throw new TypeError('Network failed')});await assert.rejects(checkout.api('/orders',{method:'POST'}));assert.equal(count,1);
});
test('automatic UI recovery stops after its bound and never retries a policy refusal',async()=>{
 let count=0;const offline=client(async()=>{count++;throw new TypeError('Network failed')});await assert.rejects(offline.api('/allocate',{method:'POST'}));assert.equal(count,4);
 count=0;const policy=client(async()=>{count++;return{status:409,ok:false,json:async()=>({error:'Budget refused'})}});await assert.rejects(policy.api('/allocate',{method:'POST'}),/Budget refused/);assert.equal(count,1);
});
