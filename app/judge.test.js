import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createJudgeApp} from './judge-server.js';

test('public guests have isolated simulated funds, no paid model, scoped cookies and a mission quota',async t=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const proof={read:async()=>({mode:'testnet',ledger:[]}),close(){}};
 const judge=createJudgeApp({origin,proof});server.on('request',judge.app);
 t.after(async()=>{await judge.close();server.closeAllConnections();await new Promise(r=>server.close(r))});
 const call=async(path,options={})=>{const response=await fetch(origin+path,options),body=await response.json();return{response,body}};
 assert.equal((await call('/guest/start',{method:'POST'})).response.status,403);
 async function guest(){const {response}=await call('/guest/start',{method:'POST',headers:{Origin:origin}});assert.equal(response.status,200);const cookie=response.headers.get('set-cookie').split(';')[0];assert.match(cookie,/enswhite_guest=[a-f0-9]{64}/);return cookie}
 const a=await guest(),b=await guest();assert.notEqual(a,b);
 const post=(cookie,body)=>({method:'POST',headers:{cookie,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await call('/guest/api/state')).response.status,401);
 const {body:order}=await call('/guest/api/orders',post(a,{}));await call('/guest/api/simulate',post(a,{orderId:order.id}));
 let state=(await call('/guest/api/state',{headers:{cookie:a}})).body;
 assert.equal(state.companyBalance,'5000000');assert.equal(state.aiMode,'offline');assert.equal(state.mode,'simulated');
 assert.equal((await call('/guest/api/state',{headers:{cookie:b}})).body.companyBalance,'0');
 await call('/guest/api/allocate',post(a,{}));
 for(let i=0;i<6;i++){const options=post(a,{title:'Launch our guest business '+i});options.headers['idempotency-key']='guest-mission-'+i;const result=await call('/guest/api/missions',options);assert.equal(result.response.status,i<5?202:429)}
 assert.equal((await fetch(origin+'/api/state')).status,404);
 assert.equal((await call('/proof/api')).body.mode,'testnet');
 assert.equal((await fetch(origin+'/guest/company-ui.js',{headers:{cookie:a}})).status,200);
});

test('Live Proof failure is explicit and never falls back to fabricated live data',async t=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`,judge=createJudgeApp({origin,proof:{async read(){throw new Error('timeout')},close(){}}});server.on('request',judge.app);
 t.after(async()=>{await judge.close();server.closeAllConnections();await new Promise(r=>server.close(r))});
 const result=await fetch(origin+'/proof/api');assert.equal(result.status,503);assert.match((await result.json()).error,/unavailable/);
});
