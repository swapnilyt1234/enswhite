import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createCompany } from './company.js';
import { createCompanyApp } from './company-server.js';
import { createVendor } from './vendor-server.js';
import { VENDORS } from './company-store.js';
import { createSimulatedCompanyChain } from './company-chain.js';
import { encodePayment } from './x402.js';

async function setup(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'relay-company-'));
  const env = { CHAIN_MODE: 'simulated', COMPANY_DATA_DIR: join(directory, 'company'), VENDOR_DATA_DIR: join(directory, 'vendors'), ...options.env };
  const vendors = [], urls = new Map();
  for (const info of VENDORS) {
    const vendor = await createVendor(info.id, env), server = createServer(vendor.app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    urls.set(`http://127.0.0.1:${info.port}`, url); vendors.push({ vendor, server, url });
  }
  const vendorFetch = (url, init) => {
    const parsed = new URL(url);
    return fetch(urls.get(parsed.origin) + parsed.pathname, init);
  };
  const company = await createCompany({ env, vendorFetch, ...options });
  t.after(async () => { await company.close(); for (const row of vendors) { await new Promise(resolve => row.server.close(resolve)); row.vendor.close(); } rmSync(directory, { recursive: true, force: true }); });
  return { company, env, vendorFetch, vendors };
}
async function fund(company) { const order = await company.order(); await company.simulate(order.id); await company.processJobs(); return order; }

test('founder tops up, Finance allocates, departments pay three vendors, approvals and books reconcile', async t => {
  const { company, vendors } = await setup(t);
  const order = await fund(company);
  await company.simulate(order.id); await company.processJobs();
  assert.equal((await company.state()).companyBalance, '5000000');
  await company.allocate(); await company.allocate(); await company.processJobs();
  let state = await company.state();
  assert.deepEqual(state.team.map(d => d.balance), ['3000000','1500000','500000']);
  assert.equal(state.companyBalance, '0');
  await company.mission('Launch our Diwali sale', 'mission-first-001');
  await company.processJobs();
  state = await company.state();
  assert.equal(state.tasks.filter(row => row.state === 'delivered').length, 2);
  const approval = state.tasks.find(row => row.vendor === 'pixelpress');
  assert.equal(approval.state, 'approval');
  assert.equal(state.ledger.length, 2);
  company.approve(approval.id, true); await company.processJobs();
  state = await company.state();
  assert.equal(state.tasks.filter(row => row.state === 'delivered').length, 3);
  assert.equal(state.ledger.reduce((sum,row)=>sum+BigInt(row.amount),0n), 400000n);
  assert.equal(state.feePool, '4000');
  assert.equal(state.team[0].balance, '2700000');
  assert.equal(state.team[1].balance, '1400000');
  assert((await company.csv()).includes('PixelPress,0.2,0.002,0.198,20.00'));
  assert.equal((await company.vendorEarnings('copydesk')).netUnits,'99000');
  await assert.rejects(company.vendorEarnings('unknown'),/Unknown vendor/);
  for (const row of vendors) {
    const earnings = await (await fetch(row.url + '/api/earnings')).json();
    assert.equal(earnings.receipts.length, 1);
    assert(BigInt(earnings.netUnits) > 0n);
  }
  await company.mission('Launch our Diwali sale', 'mission-first-001'); await company.processJobs();
  assert.equal((await company.state()).ledger.length, 3);
});

test('unfunded missions resume safely and approval rejection releases the reservation', async t => {
  const { company } = await setup(t);
  await assert.rejects(company.mission('Launch the spring collection', 'mission-retry-001'), /allocation/);
  await fund(company); await company.allocate(); await company.processJobs();
  await company.mission('Launch the spring collection', 'mission-retry-001');
  let state = await company.state();
  const banner = state.tasks.find(row => row.vendor === 'pixelpress');
  const before = state.team[0].remaining;
  company.approve(banner.id, false);
  state = await company.state();
  assert.equal(BigInt(state.team[0].remaining)-BigInt(before),200000n);
  assert.equal(state.tasks.find(row=>row.id===banner.id).state,'rejected');
  assert.throws(()=>company.approve(banner.id,true), /awaiting approval/);
});

test('vendor rejects fake receipts and binds the request ID to its original task', async t => {
  const { company, vendors } = await setup(t);
  await fund(company); await company.allocate(); await company.processJobs();
  await company.mission('Create our summer launch', 'mission-vendor-001'); await company.processJobs();
  const state = await company.state(), task = state.tasks.find(row=>row.vendor==='copydesk');
  const dept = state.team.find(row=>row.id==='marketing');
  const body = {requestId:task.id,dept:dept.address,task:task.task};
  let response = await fetch(vendors[0].url+'/work',{method:'POST',headers:{'Content-Type':'application/json','PAYMENT-RESPONSE':encodePayment({success:true,transaction:'0x'+'ff'.repeat(32)})},body:JSON.stringify(body)});
  assert.equal(response.status,402);
  response = await fetch(vendors[0].url+'/work',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,task:'Different paid work'})});
  assert.equal(response.status,400);
});

test('saved company transactions recover from an ambiguous broadcast without duplicate credit', async t => {
  let lose = true;
  const { company } = await setup(t,{chainFactory: async (db,config)=>{
    const chain=createSimulatedCompanyChain(db,config),broadcast=chain.broadcast.bind(chain);
    return {...chain,async broadcast(...args){const result=await broadcast(...args);if(lose){lose=false;throw new Error('lost after mine')}return result}};
  }});
  await fund(company);
  const job=company.db.prepare('SELECT * FROM company_jobs').get();
  assert(job.raw); assert.equal(job.state,'submitted');
  await company.processJobs();
  assert.equal((await company.state()).companyBalance,'5000000');
  assert.equal(company.db.prepare('SELECT COUNT(*) n FROM company_events').get().n,1);
});

test('pool shortage blocks checkout, preserves captured credits and settles them once prefunded',async t=>{
  let inventory=20_000_000n;
  const {company}=await setup(t,{chainFactory:async(db,config)=>{
    const chain=createSimulatedCompanyChain(db,config);
    return {...chain,async snapshot(){const state=await chain.snapshot();return {...state,poolAvailable:String(inventory-BigInt(state.companyBalance)-BigInt(state.feePool))}}};
  }});
  const orders=[];
  for(let i=0;i<4;i++){const order=await company.order();orders.push(order);await company.simulate(order.id)}
  await assert.rejects(company.order(),error=>error.status===409&&/Company pool needs/.test(error.message));
  assert.equal(company.db.prepare('SELECT COUNT(*) n FROM company_orders').get().n,4);
  inventory=0n;await company.processJobs();
  let state=await company.state();
  assert.equal(state.topup.pendingCount,4);assert.equal(state.topup.shortfall,'20000000');assert.equal(state.topup.canCheckout,false);
  assert.match(state.jobs.find(row=>row.error).error,/do not repeat checkout/);
  assert.equal(company.db.prepare('SELECT COUNT(*) n FROM company_jobs WHERE raw IS NOT NULL').get().n,0);
  inventory=20_000_000n;await company.processJobs();
  state=await company.state();assert.equal(state.companyBalance,'20000000');assert.equal(state.topup.pendingCount,0);assert.equal(state.topup.canCheckout,false);
  assert(state.jobs.every(row=>row.state==='confirmed'&&row.error===null));
  await company.simulate(orders[0].id);await company.processJobs();assert.equal((await company.state()).companyBalance,'20000000');
  inventory=25_000_000n;assert.equal((await company.state()).topup.canCheckout,true);await company.order();
});

test('company founder login and state-changing requests require the password and correct origin', async t => {
  const { company }=await setup(t,{env:{FOUNDER_PASSWORD:'long-founder-password'}});
  const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  server.on('request',createCompanyApp(company,'  '+origin+'  '));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  assert.equal((await fetch(origin+'/api/state')).status,401);
  let response=await fetch(origin+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:'wrong'})});
  assert.equal(response.status,401);
  response=await fetch(origin+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:'long-founder-password'})});
  assert.equal(response.status,200);
  const cookie=response.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(origin+'/api/state',{headers:{Cookie:cookie}})).status,200);
  assert.equal((await fetch(origin+'/api/orders',{method:'POST',headers:{Cookie:cookie,Origin:'https://evil.example'}})).status,403);
});
