import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {Interface} from 'ethers';
import {createENSWriter} from './ens-writer.js';

test('ENS edits use the delegated actor and recover signed bytes without signing a second transaction',async()=>{
 const db=new DatabaseSync(':memory:');
 const wallets={marketing:'0x0000000000000000000000000000000000000001',finance:'0x0000000000000000000000000000000000000002'};
 let receipt=null,signs=0;const signed=[],broadcasts=[];
 const provider={getNetwork:async()=>({chainId:11155111n}),getBalance:async()=>10n**18n,getTransactionReceipt:async()=>receipt,getTransaction:async()=>({}),broadcastTransaction:async raw=>broadcasts.push(raw)};
 const directory={provider,employee:async label=>({name:`${label}.acme.enswhite.eth`,wallet:wallets[label],status:'',resolver:'0x0000000000000000000000000000000000000003'})};
 const getWallet=label=>({address:wallets[label],connect(){return this},populateTransaction:async tx=>({...tx,gasLimit:100000n,maxFeePerGas:1n}),signTransaction:async tx=>{signed.push({label,tx});return '0x'+(++signs).toString(16).padStart(2,'0')}});
 try{
  let writer=createENSWriter(db,directory,getWallet);
  writer.queue('marketing','enswhite.budget.weekly','4000000','finance-demo-01');
  await writer.process();assert.equal(signs,1);assert.equal(signed[0].label,'finance');
  const iface=new Interface(['function setText(bytes,string,string)']);
  assert.equal(iface.decodeFunctionData('setText',signed[0].tx.data)[1],'enswhite.budget.weekly');
  writer=createENSWriter(db,directory,getWallet);await writer.process();
  assert.equal(signs,1);assert.equal(broadcasts[0],broadcasts[1]);
  receipt={status:1};await writer.process();assert.equal(writer.jobs()[0].state,'confirmed');
  await writer.status('marketing','working');await writer.status('marketing','working');
  assert.equal(writer.jobs().length,2);
  await writer.process();assert.equal(signed[1].label,'marketing');
  await writer.status('marketing','working');assert.equal(writer.jobs().length,3,'A rehired employee with an empty resolver status gets a fresh update');
  assert.throws(()=>writer.queue('marketing','enswhite.budget.weekly','50000001','finance-demo-02'),/at most 50/);
  assert.throws(()=>writer.queue('marketing','enswhite.vendors','evil.eth','finance-demo-02'),/scope/);
  assert.throws(()=>writer.queue('marketing','enswhite.budget.weekly','1','finance-demo-01'),/another edit/);
 }finally{db.close()}
});

test('ENS writer refuses inactive employees and excessive fees before signing',async()=>{
 const db=new DatabaseSync(':memory:');let active=false,signs=0;
 const wallet='0x0000000000000000000000000000000000000001';
 const directory={provider:{getNetwork:async()=>({chainId:11155111n})},employee:async()=>{if(!active)throw new Error('Employee is fired or expired');return {name:'marketing.acme.enswhite.eth',wallet,resolver:wallet}}};
 const writer=createENSWriter(db,directory,()=>({address:wallet,connect(){return this},populateTransaction:async()=>({gasLimit:1000001n,maxFeePerGas:1n}),signTransaction:async()=>{signs++;return '0x01'}}));
 try{writer.queue('marketing','enswhite.status','active','agent-status-01');await writer.process();assert.equal(signs,0);assert.equal(writer.jobs()[0].state,'failed');active=true;writer.queue('marketing','enswhite.status','active','agent-status-02');await writer.process();assert.equal(signs,0);assert.equal(writer.jobs()[0].state,'queued')}finally{db.close()}
});
