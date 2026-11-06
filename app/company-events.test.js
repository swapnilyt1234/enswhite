import test from 'node:test';
import assert from 'node:assert/strict';
import {companyInterface,readCompanyEvents} from './company-chain.js';

function fixture(){
 let head=5000,failures=0;const hashes=new Map(),ranges=[];let logs=[];
 const provider={getBlockNumber:async()=>head,getBlock:async n=>({hash:hashes.get(n)||'canonical-'+n}),getLogs:async filter=>{ranges.push([filter.fromBlock,filter.toBlock]);if(failures>0){failures--;throw Object.assign(new Error('RPC timeout'),{code:'TIMEOUT'})}return logs.filter(x=>x.blockNumber>=filter.fromBlock&&x.blockNumber<=filter.toBlock)}};
 const address='0x0000000000000000000000000000000000001874';
 function payment(block,id){const encoded=companyInterface.encodeEventLog(companyInterface.getEvent('Paid'),['0x'+id.repeat(64),address,address,100000n,1000n]);return{...encoded,address,blockNumber:block,transactionHash:'0x'+id.repeat(64)}}
 return{provider,address,ranges,hashes,payment,set head(x){head=x},set logs(x){logs=x},fail(count=3){failures=count}};
}

test('company event reads scan history once, then refresh recent and new blocks without duplicates',async()=>{
 const f=fixture();f.logs=[f.payment(100,'1'),f.payment(4999,'2')];
 const first=await readCompanyEvents(f.provider,f.address,1);assert.equal(first.length,2);assert.equal(f.ranges.length,3);
 f.head=5002;f.logs=[f.payment(100,'1'),f.payment(4999,'2'),f.payment(5001,'3')];
 first[0].amount='tampered';const next=await readCompanyEvents(f.provider,f.address,1);
 assert.deepEqual(f.ranges.at(-1),[4989,5002]);assert.equal(next.length,3);assert.equal(next[0].amount,'100000');
});

test('recent and deep reorganizations remove noncanonical company receipts',async()=>{
 const f=fixture();f.logs=[f.payment(100,'1'),f.payment(4999,'2')];await readCompanyEvents(f.provider,f.address,1);
 f.logs=[f.payment(100,'1'),f.payment(4999,'3')];assert.equal((await readCompanyEvents(f.provider,f.address,1))[1].hash,'0x'+'3'.repeat(64));
 f.hashes.set(4988,'reorganized');f.logs=[f.payment(200,'4')];
 const reset=await readCompanyEvents(f.provider,f.address,1);assert.equal(reset.length,1);assert.equal(reset[0].block,200);assert.deepEqual(f.ranges.at(-3),[1,2000]);
});

test('a failed company event refresh never advances its checkpoint or returns stale success',async()=>{
 const f=fixture();f.logs=[f.payment(100,'1')];await readCompanyEvents(f.provider,f.address,1);
 f.head=5002;f.fail();await assert.rejects(readCompanyEvents(f.provider,f.address,1),/RPC timeout/);
 f.logs=[f.payment(100,'1'),f.payment(5001,'2')];assert.equal((await readCompanyEvents(f.provider,f.address,1)).length,2);assert.deepEqual(f.ranges.at(-1),[4989,5002]);
});

test('a transient page read retries that page without restarting historical scanning',async()=>{
 const f=fixture();f.fail(1);f.logs=[f.payment(100,'1')];assert.equal((await readCompanyEvents(f.provider,f.address,1)).length,1);assert.deepEqual(f.ranges,[[1,2000],[1,2000],[2001,4000],[4001,5000]]);
});

test('concurrent event reads share a scan, while filters have separate checkpoints',async()=>{
 const f=fixture();f.logs=[f.payment(100,'1')];const [a,b]=await Promise.all([readCompanyEvents(f.provider,f.address,1),readCompanyEvents(f.provider,f.address,1)]);assert.equal(a.length,1);assert.deepEqual(a,b);assert.equal(f.ranges.length,3);
 await readCompanyEvents(f.provider,f.address,1,'0x0000000000000000000000000000000000000001');assert.equal(f.ranges.length,6);
});

test('a chain change during scanning refuses to commit mixed-chain event history',async()=>{
 const f=fixture();const original=f.provider.getLogs;f.provider.getLogs=async filter=>{const result=await original(filter);f.hashes.set(5000,'changed-during-scan');return result};
 await assert.rejects(readCompanyEvents(f.provider,f.address,1),/chain changed/);
 f.provider.getLogs=original;f.logs=[f.payment(200,'2')];const rows=await readCompanyEvents(f.provider,f.address,1);assert.equal(rows.length,1);assert.deepEqual(f.ranges.at(-3),[1,2000]);
});
