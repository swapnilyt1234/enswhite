import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {Wallet,Interface,Transaction,keccak256,toUtf8Bytes} from 'ethers';
import {createEmploymentQueue,createEmploymentWorker} from './employment.js';
import {ENS_NAMES_ABI} from './ens.js';

function setup(t){
 const db=new DatabaseSync(':memory:'),wallet=Wallet.createRandom(),controller=Wallet.createRandom().address,employee=Wallet.createRandom().address;
 const config={controller,company:'acme.enswhite.eth',parent:'enswhite.eth',departments:[{id:'support',address:employee,perCall:'200000'}],vendors:[{id:'lingualink',dept:'support'}]},policy={weekly:'1500000',perCall:'200000',vendors:['lingualink.vendors.enswhite.eth']};
 const iface=new Interface(ENS_NAMES_ABI),receipts=new Map(),broadcasts=[];let signs=0,receiptStatus=1,gas=100000n,fee=1n,wrongChain=false,wrongOwner=false,wrongTarget=false;
 const provider={getNetwork:async()=>({chainId:wrongChain?1n:11155111n}),getBalance:async()=>10n**18n,getTransactionReceipt:async h=>receipts.get(h),getTransaction:async()=>null,broadcastTransaction:async raw=>{broadcasts.push(raw);if(receiptStatus!==null)receipts.set(keccak256(raw),{status:receiptStatus})}};
 const signer={address:wallet.address,populateTransaction:async tx=>({...tx,nonce:signs,type:2,gasLimit:gas,maxFeePerGas:fee,maxPriorityFeePerGas:1n}),signTransaction:async tx=>{signs++;return wallet.signTransaction(tx)}};
 const directory={provider,transaction:async(action,label,address,p,term)=>({from:wrongOwner?employee:wallet.address,to:wrongTarget?employee:controller,data:iface.encodeFunctionData(action,action==='hire'?[keccak256(toUtf8Bytes('acme')),label,address,term,p.weekly,p.perCall,p.vendors.join(',')]:action==='renew'?[keccak256(toUtf8Bytes('acme')),label,Math.floor(Date.now()/1000)+term]:[keccak256(toUtf8Bytes('acme')),label])})};
 let worker=createEmploymentWorker(db,config,directory,signer);const queue=createEmploymentQueue(db,config);
 t.after(()=>{worker.close();db.close()});
 return{db,config,policy,queue,provider,directory,signer,receipts,broadcasts,get worker(){return worker},restart(){worker.close();worker=createEmploymentWorker(db,config,directory,signer)},get signs(){return signs},set gas(x){gas=x},set fee(x){fee=x},set status(x){receiptStatus=x},set wrongChain(x){wrongChain=x},set wrongOwner(x){wrongOwner=x},set wrongTarget(x){wrongTarget=x}};
}

test('employee changes use fixed scope, terms and policy with idempotent requests',async t=>{
 const f=setup(t);assert(f.queue.ready());
 assert.throws(()=>f.queue.queue('transfer','support',2592000,f.policy),/Hire/);
 assert.throws(()=>f.queue.queue('hire','attacker',2592000,f.policy),/registered/);
 assert.throws(()=>f.queue.queue('hire','support',31536000,f.policy),/term/);
 assert.throws(()=>f.queue.queue('hire','support',2592000,{...f.policy,weekly:'50000001'}),/limits/);
 assert.throws(()=>f.queue.queue('hire','support',2592000,{...f.policy,perCall:'200001'}),/limits/);
 assert.throws(()=>f.queue.queue('hire','support',2592000,{...f.policy,vendors:['evil.eth']}),/limits/);
 assert.throws(()=>f.queue.queue('hire','support',2592000,{...f.policy,vendors:[...f.policy.vendors,...f.policy.vendors]}),/limits/);
 const a=f.queue.queue('fire','support',2592000,f.policy,'founder-request-1');assert(f.queue.firing('support'));
 assert.equal(f.queue.queue('fire','support',2592000,f.policy,'founder-request-1').id,a.id);
 assert.equal(f.queue.queue('fire','support',2592000,f.policy,'founder-request-2').id,a.id);
 assert.throws(()=>f.queue.queue('hire','support',2592000,f.policy,'founder-request-1'),/another/);
 assert.throws(()=>f.queue.queue('renew','support',2592000,f.policy,'founder-request-3'),/progress/);
 await f.worker.process();assert.equal(f.queue.jobs()[0].state,'confirmed');assert.equal(f.signs,1);assert(!f.queue.firing('support'));assert.deepEqual(f.queue.policy('support'),f.policy);
 assert(!JSON.stringify(f.queue.jobs()).includes('raw'));assert(!JSON.stringify(f.queue.jobs()).includes(walletSecret(f)));
 function walletSecret(x){return Transaction.from(x.broadcasts[0]).signature.serialized}
});

test('employee manager signs exactly the approved hire and journals before an ambiguous broadcast',async t=>{
 const f=setup(t);f.status=null;f.queue.queue('hire','support',300,f.policy,'hire-support-01');
 let raw;f.provider.broadcastTransaction=async bytes=>{raw=bytes;const row=f.db.prepare('SELECT raw,hash FROM employment_jobs').get();assert.equal(row.raw,bytes);assert.equal(row.hash,keccak256(bytes));throw new Error('unknown transport')};
 await f.worker.process();assert.equal(f.signs,1);assert.equal(f.queue.jobs()[0].state,'submitted');
 const tx=Transaction.from(raw),call=new Interface(ENS_NAMES_ABI).parseTransaction({data:tx.data});assert.equal(tx.chainId,11155111n);assert.equal(tx.to,f.config.controller);assert.equal(call.args[2],f.config.departments[0].address);assert.equal(call.args[3],300n);assert.equal(tx.gasLimit,120000n);
 f.restart();f.receipts.set(keccak256(raw),{status:1});await f.worker.process();assert.equal(f.signs,1);assert.equal(f.queue.jobs()[0].state,'confirmed');
});

test('only one private worker can sign, and a missing worker cannot accept new changes',async t=>{
 const f=setup(t);assert.throws(()=>createEmploymentWorker(f.db,f.config,f.directory,f.signer),/Another/);
 f.worker.close();assert(!f.queue.ready());assert.throws(()=>f.queue.queue('fire','support',2592000,f.policy),/unavailable/);
 f.restart();assert(f.queue.ready());
});

test('wrong chain, owner, controller and excessive gas or fees never sign',async t=>{
 const f=setup(t);f.queue.queue('fire','support',2592000,f.policy,'guarded-support-01');
 f.wrongChain=true;await assert.rejects(f.worker.process(),/Sepolia/);f.wrongChain=false;
 f.wrongOwner=true;await f.worker.process();f.wrongOwner=false;assert.equal(f.signs,0);
 f.wrongTarget=true;await f.worker.process();f.wrongTarget=false;assert.equal(f.signs,0);
 f.gas=7000000n;await f.worker.process();assert.equal(f.signs,0);
 f.gas=100000n;f.fee=100000000000n;await f.worker.process();assert.equal(f.signs,0);
 f.fee=1n;await f.worker.process();assert.equal(f.signs,1);
});

test('reverted employment updates stop and six signed calls exhaust the rolling-day allowance',async t=>{
 const f=setup(t);f.status=0;f.queue.queue('renew','support',2592000,f.policy,'renew-support-00');await f.worker.process();assert.equal(f.queue.jobs()[0].state,'failed');
 await f.worker.process();assert.equal(f.signs,1);f.status=1;
 for(let i=1;i<=6;i++){f.queue.queue('renew','support',2592000,f.policy,'renew-support-0'+i);await f.worker.process()}
 assert.equal(f.signs,6);assert.equal(f.queue.jobs()[0].state,'queued');assert.match(f.queue.jobs()[0].error,/paused/);
});
