import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface } from 'ethers';
import { createENSDirectory, ENS_REGISTRY_ABI, ENS_NAMES_ABI, checkENSTransaction, populateENSTransaction } from './ens.js';
test('ENS payment checks reject expired employees, unapproved vendors and spoofed payees',async()=>{
  const wallet='0x0000000000000000000000000000000000000001',vendor='0x0000000000000000000000000000000000000002';
  let status=2,payee=vendor;
  const iface=new Interface(ENS_REGISTRY_ABI);
  const connection={
    getNetwork:async()=>({chainId:11155111n}),
    call:async()=>iface.encodeFunctionResult('getState',[status,Math.floor(Date.now()/1000)+3600,wallet,1,1]),
    getResolver:async name=>({address:vendor,getAddress:async()=>name.startsWith('marketing.')?wallet:payee,getText:async key=>({'enswhite.budget.weekly':'3000000','enswhite.limit.perCall':'500000','enswhite.vendors':'copydesk.vendors.enswhite.eth','x402.endpoint':'http://localhost:4001/work'}[key]||'')}),
  };
  const directory=createENSDirectory({ENS_COMPANY_NAME:'acme.enswhite.eth',ENS_COMPANY_REGISTRY:vendor,ENS_REGISTRY_BLOCK:'1'},connection);
  const args=['marketing','copydesk.vendors.enswhite.eth',wallet,vendor,'http://localhost:4001/work','100000'];
  assert.equal((await directory.authorize(...args)).wallet,wallet);
  payee=wallet;await assert.rejects(directory.authorize(...args),/disagrees/);
  payee=vendor;status=0;await assert.rejects(directory.authorize(...args),/fired or expired/);
  status=2;await assert.rejects(directory.authorize('marketing','evil.eth',wallet,vendor,args[4],args[5]),/policy rejected/);
});

test('founder management prepares only fixed Sepolia lifecycle calls for the configured company',async()=>{
 const founder='0x0000000000000000000000000000000000000001',registry='0x0000000000000000000000000000000000000002',names='0x0000000000000000000000000000000000000003';
 const iface=new Interface(ENS_NAMES_ABI);
 const connection={getNetwork:async()=>({chainId:11155111n}),call:async()=>iface.encodeFunctionResult('companies',[founder,founder,registry,'0x00'])};
 const directory=createENSDirectory({ENS_COMPANY_NAME:'acme.enswhite.eth',ENS_COMPANY_REGISTRY:registry,ENS_REGISTRY_BLOCK:'1',ENS_NAMES_ADDRESS:names},connection);
 const tx=await directory.transaction('hire','marketing',founder,{weekly:'3000000',perCall:'500000',vendors:['copydesk.vendors.enswhite.eth']},300);
 assert.equal(tx.chainId,'0xaa36a7');assert.equal(tx.from,founder);assert.equal(tx.to,names);
 assert.equal(iface.decodeFunctionData('hire',tx.data)[3],300n);
 await assert.rejects(directory.transaction('upgrade','marketing',founder,{},300),/Invalid ENS/);
 await assert.rejects(directory.transaction('hire','marketing',founder,{},1),/Term/);
});

test('ENS gas policy allows the observed 12.59M deployment estimate but caps network, calls and fees',()=>{
 const deploy={chainId:11155111,gasLimit:12585962n,maxFeePerGas:32n};
 checkENSTransaction(deploy,1000000000000000n);
 assert.throws(()=>checkENSTransaction({...deploy,gasLimit:16000001n},1000000000000000000n),/gas policy/);
 assert.throws(()=>checkENSTransaction({...deploy,to:'0x0000000000000000000000000000000000000001'},1000000000000000000n),/gas policy/);
 assert.throws(()=>checkENSTransaction({...deploy,maxFeePerGas:1000000000n},1000000000000000000n),/maximum fee/);
 assert.throws(()=>checkENSTransaction(deploy,0n),/more Sepolia/);
 assert.throws(()=>checkENSTransaction({...deploy,chainId:1},1000000000000000000n),/Sepolia/);
});

test('ENS bootstrap retries stale estimates, stops persistent reverts and never retries signing errors',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const stale=Object.assign(new Error('Missing vendor resolver'),{code:'CALL_EXCEPTION',action:'estimateGas'});
 const tx={chainId:11155111,to:'0x01'};let attempts=0;
 const recovered=populateENSTransaction({populateTransaction:async input=>{assert.equal(input,tx);if(++attempts===1)throw stale;return input}},tx);
 await new Promise(resolve=>setImmediate(resolve));t.mock.timers.tick(3000);
 assert.equal(await recovered,tx);assert.equal(attempts,2);
 attempts=0;
 const failed=assert.rejects(populateENSTransaction({populateTransaction:async()=>{attempts++;throw stale}},tx),error=>error===stale);
 for(let i=0;i<3;i++){await new Promise(resolve=>setImmediate(resolve));t.mock.timers.tick(3000)}
 await failed;assert.equal(attempts,4);
 attempts=0;
 await assert.rejects(populateENSTransaction({populateTransaction:async()=>{attempts++;throw Object.assign(new Error('denied'),{code:'ACTION_REJECTED'})}},tx),/denied/);
 assert.equal(attempts,1);
});

test('company signup prepares a founder-signed registry creation and rejects taken or invalid labels',async()=>{
 const owner='0x0000000000000000000000000000000000000001',registry='0x0000000000000000000000000000000000000002',names='0x0000000000000000000000000000000000000003';
 const iface=new Interface(ENS_NAMES_ABI);let reads=0;
 const connection={getNetwork:async()=>({chainId:11155111n}),call:async()=>iface.encodeFunctionResult('companies',[++reads%2?owner:'0x0000000000000000000000000000000000000000',owner,registry,'0x00'])};
 const directory=createENSDirectory({ENS_COMPANY_NAME:'acme.enswhite.eth',ENS_PARENT_NAME:'enswhite.eth',ENS_COMPANY_REGISTRY:registry,ENS_REGISTRY_BLOCK:'1',ENS_NAMES_ADDRESS:names},connection);
 const tx=await directory.signup('new-company',owner);assert.equal(tx.name,'new-company.enswhite.eth');assert.equal(tx.from,owner);assert.equal(iface.decodeFunctionData('createCompany',tx.data)[0],'new-company');
 await assert.rejects(directory.signup('../wrong',owner),/lowercase/);
 connection.call=async()=>iface.encodeFunctionResult('companies',[owner,owner,registry,'0x00']);
 await assert.rejects(directory.signup('acme',owner),/already registered/);
});

test('company branding reads ENS records and accepts only HTTPS avatar and URL links',async()=>{
 const directory=createENSDirectory({ENS_COMPANY_NAME:'acme.enswhite.eth',ENS_COMPANY_REGISTRY:'0x0000000000000000000000000000000000000001',ENS_REGISTRY_BLOCK:'1'},{getNetwork:async()=>({chainId:11155111n}),getResolver:async()=>({getText:async key=>({name:'Acme Candles',avatar:'javascript:alert(1)',url:'https://example.com'}[key])})});
 assert.deepEqual(await directory.branding(),{name:'Acme Candles',avatar:null,url:'https://example.com'});
});
