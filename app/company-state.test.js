import test from 'node:test';
import assert from 'node:assert/strict';
import {request,createServer} from 'node:http';
import {createCompanyApp} from './company-server.js';

test('concurrent company-state requests share only the in-flight read and refresh again after success or failure',async t=>{
 let reads=0,resolveRead,rejectRead;
 const company={session:()=>({user:{id:'founder'}}),state:()=>{reads++;return new Promise((resolve,reject)=>{resolveRead=resolve;rejectRead=reject})}};
 const app=createCompanyApp(company,'http://localhost'),server=createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close()});
 const get=()=>new Promise((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port:server.address().port,path:'/api/state',headers:{host:'localhost'}},res=>{let body='';res.on('data',x=>body+=x);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(body)}))});req.on('error',reject);req.end()});
 const started=async count=>{for(let i=0;i<100&&reads<count;i++)await new Promise(r=>setImmediate(r));assert.equal(reads,count)};
 let requests=0,arrived;const bothArrived=new Promise(resolve=>{arrived=resolve});server.on('request',()=>{if(++requests===2)arrived()});
 const a=get();await started(1);const b=get();await bothArrived;resolveRead({balance:'10000000'});
 const results=await Promise.all([a,b]);assert.equal(reads,1);assert.deepEqual(results[0].body,results[1].body);
 const failed=get();await started(2);rejectRead(Object.assign(new Error('RPC unavailable'),{code:'TIMEOUT'}));assert.equal((await failed).status,503);
 const fresh=get();await started(3);resolveRead({balance:'9600000'});assert.equal((await fresh).body.balance,'9600000');
});
