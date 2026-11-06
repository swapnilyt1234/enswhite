import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Wallet,Transaction,keccak256} from 'ethers';
import {sendDiscoveryTransaction} from './ens-discovery-send.js';

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'ens-discovery-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const wallet=Wallet.createRandom(),tx={to:Wallet.createRandom().address,data:'0x1234'},receipts=new Map();let signed=0,broadcast=0;
 const signer={address:wallet.address,populateTransaction:async x=>({...x,nonce:7,type:2,gasLimit:100000n,maxFeePerGas:1n,maxPriorityFeePerGas:1n}),signTransaction:async x=>{signed++;return wallet.signTransaction(x)}};
 const provider={getBalance:async()=>10n**18n,getTransactionReceipt:async h=>receipts.get(h),broadcastTransaction:async raw=>{broadcast++;const hash=keccak256(raw);receipts.set(hash,{hash,status:1});},waitForTransaction:async h=>receipts.get(h),getTransaction:async()=>null};
 return {dir,wallet,tx,receipts,signer,provider,counts:()=>({signed,broadcast}),async save(id,status){const raw=await wallet.signTransaction({chainId:11155111,...tx,nonce:6,type:2,gasLimit:100000n,maxFeePerGas:1n,maxPriorityFeePerGas:1n}),hash=keccak256(raw);await writeFile(join(dir,id+'.json'),JSON.stringify({raw,hash}));if(status!==null)receipts.set(hash,{hash,status});return hash;}};
}

test('discovery retains a confirmed revert and resumes its one replacement without duplicate signing',async t=>{
 const f=await fixture(t),id='binding-support',original=await f.save(id,0),before=await readFile(join(f.dir,id+'.json'),'utf8');
 const receipt=await sendDiscoveryTransaction(f.dir,f.provider,f.wallet.address,id,f.signer,f.tx);
 assert.notEqual(receipt.hash,original);assert.equal(await readFile(join(f.dir,id+'.json'),'utf8'),before);
 const replacement=JSON.parse(await readFile(join(f.dir,id+'.retry-1.json'),'utf8'));
 assert.equal(Transaction.from(replacement.raw).gasLimit,120000n);
 assert.equal((await sendDiscoveryTransaction(f.dir,f.provider,f.wallet.address,id,f.signer,f.tx)).hash,receipt.hash);
 assert.deepEqual(f.counts(),{signed:1,broadcast:1});
});

test('pending and unknown discovery broadcasts never create a replacement',async t=>{
 const f=await fixture(t),id='binding-support';await f.save(id,null);
 f.provider.broadcastTransaction=async()=>{};f.provider.waitForTransaction=async()=>null;
 await assert.rejects(sendDiscoveryTransaction(f.dir,f.provider,f.wallet.address,id,f.signer,f.tx),/pending/);
 f.provider.broadcastTransaction=async()=>{throw new Error('transport')};
 await assert.rejects(sendDiscoveryTransaction(f.dir,f.provider,f.wallet.address,id,f.signer,f.tx),/Unknown broadcast/);
 assert.deepEqual(await readdir(f.dir),[id+'.json']);assert.equal(f.counts().signed,0);
});

test('transport reads retry and a receipt-wait timeout rechecks the saved hash without another signature',async t=>{
 const f=await fixture(t);let reads=0;
 const original=f.provider.getTransactionReceipt;
 f.provider.getTransactionReceipt=async hash=>{if(!reads++)throw Object.assign(new Error('temporary timeout'),{code:'TIMEOUT'});return original(hash)};
 f.provider.waitForTransaction=async()=>{throw Object.assign(new Error('wait timeout'),{code:'TIMEOUT'})};
 const receipt=await sendDiscoveryTransaction(f.dir,f.provider,f.wallet.address,'register-pixelpress',f.signer,f.tx);
 assert.equal(receipt.status,1);assert.deepEqual(f.counts(),{signed:1,broadcast:1});
 await sendDiscoveryTransaction(f.dir,f.provider,f.wallet.address,'register-pixelpress',f.signer,f.tx);assert.equal(f.counts().signed,1);
});

test('reverted registration or changed record payload requires inspection',async t=>{
 const f=await fixture(t);await f.save('register-support',0);await f.save('binding-support',0);
 await assert.rejects(sendDiscoveryTransaction(f.dir,f.provider,f.wallet.address,'register-support',f.signer,f.tx),/reverted/);
 await assert.rejects(sendDiscoveryTransaction(f.dir,f.provider,f.wallet.address,'binding-support',f.signer,{...f.tx,data:'0xabcd'}),/reverted/);
 assert.equal(f.counts().signed,0);
});

test('discovery gas headroom remains subject to existing call and department fee caps',async t=>{
 const f=await fixture(t);f.signer.populateTransaction=async x=>({...x,gasLimit:7000000n,maxFeePerGas:1n});
 await assert.rejects(sendDiscoveryTransaction(f.dir,f.provider,f.wallet.address,'binding-support',f.signer,f.tx),/gas policy/);
 f.signer.populateTransaction=async x=>({...x,gasLimit:500000n,maxFeePerGas:1000000000n});
 await assert.rejects(sendDiscoveryTransaction(f.dir,f.provider,Wallet.createRandom().address,'binding-support',f.signer,f.tx),/Department identity/);
 assert.equal(f.counts().signed,0);
});

test('discovery stops after two reverted replacement attempts and preserves every journal',async t=>{
 const f=await fixture(t),id='binding-support';await f.save(id,0);
 f.provider.broadcastTransaction=async raw=>{const hash=keccak256(raw);f.receipts.set(hash,{hash,status:0})};
 await assert.rejects(sendDiscoveryTransaction(f.dir,f.provider,f.wallet.address,id,f.signer,f.tx),/reverted/);
 assert.deepEqual((await readdir(f.dir)).sort(),[id+'.json',id+'.retry-1.json',id+'.retry-2.json'].sort());
 assert.equal(f.counts().signed,2);
 await assert.rejects(sendDiscoveryTransaction(f.dir,f.provider,f.wallet.address,id,f.signer,f.tx),/reverted/);
 assert.equal(f.counts().signed,2);
});
