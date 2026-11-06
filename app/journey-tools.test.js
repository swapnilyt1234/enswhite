import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createAgentStore} from './agent-store.js';
import {createAgentRuntime} from './agent-runtime.js';
import {createActivity} from './activity.js';
import {executeJourneyTool} from './journey-tools.js';

test('six-step runs retain waiting purchase identity and refresh ENS role context',async t=>{
 const db=new DatabaseSync(':memory:'),store=createAgentStore(db),activity=createActivity(db);let modelCalls=0,buyCalls=0,observation='pending';
 const id=store.ensure('mission','marketing','llm','mission',2);
 const runtime=createAgentRuntime({db,store,activity,env:{OPENAI_MODEL:'test',OPENAI_API_KEY:'test'},context:async()=>({mission:'Launch',employee:{discovery:{context:'Verified role record'}}}),observe:async()=>observation,
 tools:{authorize:async()=>{},execute:async(run,name)=>name==='buy'?(++buyCalls===1?{waiting:true,resumeSameCall:true}:{delivered:true}):{complete:true,summary:'done'}},
 modelFetch:async(url,init)=>{const body=JSON.parse(init.body);assert.match(body.instructions,/Verified role record/);assert.match(body.instructions,/at most 6/);const name=modelCalls++?'deliver':'buy';return Response.json({output:[{type:'function_call',name,call_id:name,arguments:JSON.stringify(name==='buy'?{vendor:'copydesk',brief:'Copy',max_price:'100000'}:{artifact:'Work',reviews:[]})}]})}});
 t.after(async()=>{await runtime.close();activity.close();db.close()});
 await runtime.tick();assert.equal(store.run(id).state,'waiting');assert.equal(modelCalls,1);
 observation='delivered';await runtime.tick();assert.equal(store.run(id).state,'completed');assert.equal(buyCalls,2);assert.equal(modelCalls,2);assert.equal(store.run(id).calls,2);
});

test('new missions stop at six decisions; legacy runs retain eight',async t=>{
 const db=new DatabaseSync(':memory:'),store=createAgentStore(db),activity=createActivity(db);let calls=0;
 const runtime=createAgentRuntime({db,store,activity,env:{OPENAI_MODEL:'test',OPENAI_API_KEY:'test'},context:async()=>({mission:'Launch'}),observe:async()=>'',tools:{authorize:async()=>{},execute:async()=>({})},modelFetch:async()=>Response.json({output:[{type:'function_call',name:'find_vendors',call_id:String(++calls),arguments:'{"capability":"copy"}'}]})});
 t.after(async()=>{await runtime.close();activity.close();db.close()});const id=store.ensure('mission','marketing','llm','mission',2);await runtime.tick();assert.equal(store.run(id).calls,6);assert.equal(store.run(id).state,'failed');assert.equal(store.ensure('old','marketing','llm'), 'old:marketing:mission');assert.equal(store.run('old:marketing:mission').version,1);
});

test('buy maximums cannot bypass policy and questions resume only after a founder answer',async t=>{
 const db=new DatabaseSync(':memory:'),store=createAgentStore(db);t.after(()=>db.close());const run={id:'m:marketing',mission_id:'m',department:'marketing',source:'llm',version:2};let purchased=0;
 const options={db,store,activity:{record(){}},service:{assertEmployee:async()=>{},vendors:[{id:'copydesk',dept:'marketing',price:'100000'}],agentContext:async()=>({mission:'Launch',business:{audience:'People'}})},legacy:async name=>name==='request_quote'?{amount:'100000'}:(purchased++,{waiting:true})};
 await assert.rejects(executeJourneyTool(options,run,'buy',{vendor:'copydesk',brief:'Copy',max_price:'99999'}),/maximum/);assert.equal(purchased,0);
 const waiting=await executeJourneyTool(options,run,'ask_founder',{question:'What is your return policy?'});assert.equal(waiting.resumeSameCall,true);
 db.prepare('UPDATE founder_questions SET answer=? WHERE id=?').run('Returns within 7 days',waiting.questionId);
 assert.deepEqual(await executeJourneyTool(options,run,'ask_founder',{question:'What is your return policy?'}),{answer:'Returns within 7 days'});
});


test('a waiting question survives an observation timeout without consuming another model decision',async t=>{
 const db=new DatabaseSync(':memory:'),store=createAgentStore(db),activity=createActivity(db);let reads=0,ready=false,models=0,questions=0;
 const runtime=createAgentRuntime({db,store,activity,env:{OPENAI_MODEL:'test',OPENAI_API_KEY:'test'},context:async()=>({mission:'FAQ'}),observe:async()=>{if(++reads===3)throw Object.assign(new Error('RPC timeout'),{code:'TIMEOUT'});return String(ready)},tools:{authorize:async()=>{},execute:async(run,name)=>{if(name==='ask_founder'){questions++;return ready?{answer:'Not confirmed'}:{waiting:true,resumeSameCall:true}}return{complete:true,summary:'Done'}}},modelFetch:async()=>{const name=models++?'deliver':'ask_founder';return Response.json({output:[{type:'function_call',name,call_id:name,arguments:JSON.stringify(name==='ask_founder'?{question:'Shipping?'}:{artifact:'FAQ',reviews:[]})}]})}});
 t.after(async()=>{await runtime.close();activity.close();db.close()});const id=store.ensure('waiting','support','llm','mission',2);await runtime.tick();assert.equal(store.run(id).state,'waiting');ready=true;await runtime.tick();assert.equal(store.run(id).state,'recovering');store.checkpoint(id,{next_retry:0});await runtime.tick();assert.equal(store.run(id).state,'completed');assert.equal(models,2);assert.equal(questions,2);assert.equal(store.run(id).calls,2);
});
