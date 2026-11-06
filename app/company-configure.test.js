import test from 'node:test';
import assert from 'node:assert/strict';
import {pendingConfiguration} from './company-configure.js';

test('owner configuration skips completed transactions when resuming after four password prompts',async()=>{
  const address=n=>'0x'+n.toString(16).padStart(40,'0');
  const config={departments:[1,2,3].map((n,index)=>({id:index===2?'finance':'dept'+n,name:'Dept '+n,address:address(n),perCall:'100',perDay:'300'})),vendors:[4,5,6].map(n=>({name:'Vendor '+n,address:address(n),price:'10'}))};
  const contract={finance:async()=>address(3),limits:async()=>({perCall:100n,perDay:300n}),vendorMaxPrice:async()=>0n};
  const plan=await pendingConfiguration(contract,config);
  assert.equal(plan.length,3);assert(plan.every(step=>step.method==='registerVendor'));
  contract.vendorMaxPrice=async()=>10n;
  assert.equal((await pendingConfiguration(contract,config)).length,0);
});
