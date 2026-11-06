import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createAgentStore} from './agent-store.js';
import {createActivity} from './activity.js';
import {createAgentRuntime} from './agent-runtime.js';
import {EMPLOYEES,validateArguments} from './agent-definitions.js';
import {createAgentTools} from './agent-tools.js';

function setup(t,{calls=[],authorize=async()=>{},execute=async()=>({}),modelFetch}={}){
 const db=new DatabaseSync(':memory:'),store=createAgentStore(db),activity=createActivity(db);let index=0;
 const env={OPENAI_MODEL:'test-model',OPENAI_API_KEY:'test-key'};
 const request=modelFetch||(async(url,init)=>{const body=JSON.parse(init.body);assert.equal(body.parallel_tool_calls,false);assert(body.tools.every(x=>x.strict));const next=calls[index++];return new Response(JSON.stringify({output:next?[{type:'reasoning',encrypted_content:'opaque-test-item'},{type:'function_call',call_id:'call_'+index,name:next.name,arguments:JSON.stringify(next.args||{})}]:[{type:'message',content:[{type:'output_text',text:'All done'}]}]}))});
 const runtime=createAgentRuntime({db,store,activity,env,modelFetch:request,tools:{authorize,execute},context:async()=>({mission:'Launch Acme Candles',business:{name:'Acme'}}),observe:async()=>'',offline:async()=>({type:'function_call',call_id:'offline_'+index++,name:'read_context',arguments:'{}'})});
 t.after(async()=>{await runtime.close();activity.close();db.close()});return{db,store,runtime};
}
test('strict tool arguments reject arbitrary financial fields, unknown vendors and role escalation',async()=>{
 const purchase=EMPLOYEES.marketing.tools.find(x=>x.name==='purchase_service');assert.throws(()=>validateArguments(purchase.parameters,{vendor:'copydesk',amount:'999999',to:'attacker'}));assert.throws(()=>validateArguments(purchase.parameters,{vendor:'attacker'}));
 const executor=createAgentTools({db:null,store:null,service:{},activity:null});await assert.rejects(executor.execute({department:'support'},'propose_allocation',{}),/cannot use/);
});
test('a model cannot call outside its role or complete work using plain prose',async t=>{
 let effects=0;const {store,runtime}=setup(t,{calls:[{name:'propose_allocation'}],execute:async()=>{effects++;return{complete:true}}});const id=store.ensure('m','marketing','llm');await runtime.tick();assert.equal(store.run(id).state,'failed');assert.equal(effects,0);assert.match(store.run(id).error,/outside its role/);
 const next=store.ensure('n','support','llm');await runtime.tick();assert.equal(store.run(next).state,'failed');assert.equal(effects,0);
});
test('inactive employment refuses model access before any work is initiated',async t=>{
 let requested=0;const {store,runtime}=setup(t,{authorize:async()=>{throw new Error('Employee is fired or expired')},modelFetch:async()=>{requested++;throw new Error('must not call')}});const id=store.ensure('m','marketing','llm');await runtime.tick();assert.equal(requested,0);assert.equal(store.run(id).state,'failed');assert.equal(store.actions(id).length,0);
});

test('a transient context read retries before consuming a model decision or failing the saved run',async t=>{
 const db=new DatabaseSync(':memory:'),store=createAgentStore(db),activity=createActivity(db);let reads=0,modelCalls=0;
 const runtime=createAgentRuntime({db,store,activity,env:{OPENAI_MODEL:'fixture',OPENAI_API_KEY:'test'},context:async()=>{if(!reads++)throw Object.assign(new Error('temporary RPC timeout'),{code:'TIMEOUT'});return{mission:'Review startup budget'}},observe:async()=>'',tools:{authorize:async()=>{},execute:async()=>({complete:true,summary:'Verified budget'})},modelFetch:async()=>{modelCalls++;return Response.json({output:[{type:'function_call',call_id:'done',name:'submit_work',arguments:'{"summary":"Verified budget"}'}]})}});
 t.after(async()=>{await runtime.close();activity.close();db.close()});const id=store.ensure('budget','finance','llm');await runtime.tick();assert.equal(store.run(id).state,'completed');assert.equal(reads,2);assert.equal(modelCalls,1);assert.equal(store.run(id).calls,1);
});
test('Responses tool results and opaque reasoning are replayed; API failures cannot produce a deliverable',async t=>{
 let n=0;const {store,runtime}=setup(t,{execute:async()=>({fact:'verified tool result'}),modelFetch:async(url,init)=>{const body=JSON.parse(init.body);if(n++){assert(body.input.some(x=>x.type==='reasoning'&&x.encrypted_content==='opaque'));assert(body.input.some(x=>x.type==='function_call_output'&&x.output.includes('verified tool result')));return new Response('{}',{status:503})}return new Response(JSON.stringify({output:[{type:'reasoning',encrypted_content:'opaque'},{type:'function_call',call_id:'read1',name:'read_context',arguments:'{}'}]}))}});const id=store.ensure('m','marketing','llm');await runtime.tick();assert.equal(store.run(id).state,'failed');assert.match(store.run(id).error,/HTTP 503/);assert.equal(store.artifactFor('m','marketing','submission'),null);assert.equal(store.actions(id).length,1);
});
test('duplicate model call IDs reuse the saved result; changed arguments are refused',async t=>{
 let calls=0,effects=0;const {store,runtime}=setup(t,{execute:async()=>{effects++;return{}},modelFetch:async()=>new Response(JSON.stringify({output:[{type:'function_call',call_id:'same',name:calls++<2?'read_context':'create_campaign_brief',arguments:calls<=2?'{}':JSON.stringify({objective:'x',audience:'y',designNotes:'z'})}]}))});const id=store.ensure('m','marketing','llm');await runtime.tick();assert.equal(effects,1);assert.equal(store.run(id).state,'failed');assert.match(store.run(id).error,/replayed/);
});
test('interrupted tools resume from persisted inputs without another model call',async t=>{
 const {db,store}=setup(t);const id=store.ensure('m','marketing','llm');store.checkpoint(id,{state:'executing',calls:1,input:JSON.stringify([{role:'user',content:'mission'},{type:'function_call',call_id:'saved',name:'submit_work',arguments:'{"summary":"Saved work"}'}])});db.prepare("INSERT INTO agent_actions VALUES(?,?,?, ?,NULL,'started',?)").run(id,'saved','submit_work','{"summary":"Saved work"}',Date.now());
 const runtime=createAgentRuntime({db,store,activity:createActivity(db),env:{},context:async()=>({mission:'m'}),observe:async()=>'',offline:()=>{},tools:{authorize:async()=>{},execute:async()=>({complete:true,summary:'Saved work'})},modelFetch:async()=>{throw new Error('must not call')}});await runtime.tick();assert.equal(store.run(id).state,'completed');assert.equal(store.run(id).calls,1);
});
test('offline execution is bounded and never labeled as a model response',async t=>{
 const {store,runtime}=setup(t);const id=store.ensure('m','marketing','offline');await runtime.tick();assert.equal(store.run(id).calls,8);assert.equal(store.run(id).state,'failed');assert.equal(store.run(id).source,'offline');
});
test('a crash after the verified submission result does not require another model call',async t=>{
 const {db,store}=setup(t);const id=store.ensure('m','marketing','llm');store.checkpoint(id,{state:'executing',calls:8});db.prepare("INSERT INTO agent_actions VALUES(?,?,?,?,?,'done',?)").run(id,'final','submit_work','{"summary":"Done"}','{"complete":true,"summary":"Done"}',Date.now());
 const runtime=createAgentRuntime({db,store,activity:createActivity(db),env:{},context:async()=>{},observe:async()=>'',offline:()=>{},tools:{authorize:async()=>{},execute:async()=>{throw new Error('must not execute')}},modelFetch:async()=>{throw new Error('must not call')}});await runtime.tick();assert.equal(store.run(id).state,'completed');assert.equal(store.run(id).attempts,0);
});

test('model transport retries stop after three failures and count every API attempt',async t=>{
 let requests=0;const {store,runtime}=setup(t,{modelFetch:async()=>{requests++;throw Object.assign(new TypeError('fetch failed'),{cause:{code:'UND_ERR_CONNECT_TIMEOUT'}})}});
 const id=store.ensure('transport','finance','llm');await runtime.tick();
 assert.equal(requests,3);assert.equal(store.run(id).attempts,3);assert.equal(store.run(id).calls,0);assert.equal(store.run(id).state,'failed');assert.match(store.run(id).error,/UND_ERR_CONNECT_TIMEOUT/);
});

test('model transport recovery executes a returned tool only once',async t=>{
 let requests=0,effects=0;const {store,runtime}=setup(t,{execute:async()=>{effects++;return{complete:true,summary:'Verified'}},modelFetch:async()=>{if(++requests<3)throw new TypeError('fetch failed');return new Response(JSON.stringify({output:[{type:'function_call',call_id:'once',name:'submit_work',arguments:'{"summary":"Verified"}'}]}))}});
 const id=store.ensure('recover','marketing','llm');await runtime.tick();assert.equal(store.run(id).state,'completed');assert.equal(store.run(id).attempts,3);assert.equal(effects,1);
});

test('RPC tool failure preserves the pending identity and retries without another model decision',async t=>{
 let effects=0,requests=0;const {store,runtime}=setup(t,{execute:async()=>{if(++effects===1)throw Object.assign(new Error('RPC timeout'),{code:'TIMEOUT'});return{complete:true,summary:'Same order recovered'}},modelFetch:async()=>{requests++;return new Response(JSON.stringify({output:[{type:'function_call',call_id:'order',name:'purchase_service',arguments:'{"vendor":"pixelpress"}'}]}))}});
 const id=store.ensure('rpc','marketing','llm');await runtime.tick();assert.equal(store.run(id).state,'failed');assert.equal(store.actions(id)[0].state,'started');
 runtime.retry(id);await runtime.tick();assert.equal(store.run(id).state,'completed');assert.equal(store.run(id).calls,1);assert.equal(requests,1);assert.equal(effects,2);assert.equal(store.actions(id).length,1);
});

test('a saved refused tool can recheck policy at the tool cap without erasing the refusal event',async t=>{
 let effects=0,permitted=false;const {db,store,runtime}=setup(t,{authorize:async()=>{if(!permitted)throw new Error('Employee is fired or expired')},execute:async()=>{effects++;return{complete:true,summary:'Policy rechecked'}},modelFetch:async()=>{throw new Error('must not request model')}});
 const id=store.ensure('legacy-refusal','marketing','llm');store.checkpoint(id,{state:'failed',calls:8,attempts:9,input:JSON.stringify([{type:'function_call',call_id:'saved',name:'purchase_service',arguments:'{"vendor":"pixelpress"}'},{type:'function_call_output',call_id:'saved',output:'{"error":"Tool refused"}'}])});
 db.prepare("INSERT INTO agent_actions VALUES(?,?,?,?,?,'done',?)").run(id,'saved','purchase_service','{"vendor":"pixelpress"}','{"error":"Tool refused"}',Date.now());
 runtime.retry(id);await runtime.tick();assert.equal(store.run(id).state,'failed');assert.equal(effects,0);
 permitted=true;runtime.retry(id);await runtime.tick();assert.equal(store.run(id).state,'completed');assert.equal(store.run(id).calls,8);assert.equal(store.run(id).attempts,9);assert.equal(effects,1);
 const events=db.prepare("SELECT data FROM company_activity WHERE kind='tool_retry'").all();assert(events.some(x=>JSON.parse(x.data).previousResult?.error==='Tool refused'));
});
