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
import {createAgentTools} from './agent-tools.js';

async function setup(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'relay-company-'));
  const env = { CHAIN_MODE: 'simulated', COMPANY_DATA_DIR: join(directory, 'company'), VENDOR_DATA_DIR: join(directory, 'vendors'), ...options.env };
  const vendors = [], urls = new Map();
  for (const info of VENDORS) {
    const vendor = await createVendor(info.id, {...env,...options.vendorEnv}), server = createServer(vendor.app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    urls.set(`http://127.0.0.1:${info.port}`, url); vendors.push({ vendor, server, url });
  }
  const vendorFetch = (url, init) => {
    const parsed = new URL(url);
    return fetch(urls.get(parsed.origin) + parsed.pathname, init).then(response=>options.mutateResponse?options.mutateResponse(response):response);
  };
  const company = await createCompany({ ...options, env, vendorFetch });
  t.after(async () => { await company.close(); for (const row of vendors) { await new Promise(resolve => row.server.close(resolve)); row.vendor.close(); } rmSync(directory, { recursive: true, force: true }); });
  return { company, env, vendorFetch, vendors };
}
async function fund(company) { const order = await company.order(); await company.simulate(order.id); await company.processJobs(); return order; }

test('mocked Responses employees use tools end to end, hand off real copy and preserve founder policy facts',async t=>{
 const scripts={marketing:[['read_context',{}],['create_campaign_brief',{objective:'Launch sandalwood candles',audience:'Premium home decor buyers',designNotes:'Use the actual headline and forest brand palette'}],['request_quote',{vendor:'copydesk',brief:'Write our sandalwood launch copy'}],['purchase_service',{vendor:'copydesk'}],['read_work',{vendor:'copydesk'}],['request_quote',{vendor:'pixelpress',brief:'Use the delivered copy and product details'}],['purchase_service',{vendor:'pixelpress'}],['submit_work',{summary:'Campaign copy and banner delivered with receipts.'}]],support:[['read_context',{}],['draft_faq',{questions:[{question:'When does it ship?',source:'shipping'},{question:'Can I return it?',source:'returns'}]}],['review_faq',{}],['request_quote',{vendor:'lingualink',brief:'Translate only the reviewed facts'}],['purchase_service',{vendor:'lingualink'}],['submit_work',{summary:'Sourced customer help and translation draft delivered.'}]],finance:[['read_context',{}],['read_ledger',{}],['review_spending',{}],['propose_allocation',{marketingUnits:'0',supportUnits:'0',financeUnits:'0',rationale:'Existing founder-approved funds cover the three registered service costs.'}],['prepare_report',{}],['prepare_report',{}],['submit_work',{summary:'All three vendor receipts reconcile.'}]]};
 const indexes={marketing:0,support:0,finance:0},requests=[];
 const modelFetch=async(url,init)=>{const body=JSON.parse(init.body),role=body.instructions.match(/^You are EnsWhite (\w+)/)[1],index=indexes[role]++,[name,args]=scripts[role][index];requests.push(body);return new Response(JSON.stringify({output:[{type:'function_call',call_id:`${role}_${index}`,name,arguments:JSON.stringify(args)}]}))};
 const {company}=await setup(t,{env:{AGENT_MODE:'llm',OPENAI_API_KEY:'private-test-key',OPENAI_MODEL:'fixture-model'},vendorEnv:{AGENT_MODE:'offline'},modelFetch});
 company.updateBusiness({name:'Acme Sandalwood',description:'Sandalwood candles for premium home decor',audience:'Home decor buyers',language:'Hindi',productName:'Sandalwood candle',shippingPolicy:'Ships in 4 business days.',returnPolicy:'Unopened items may be returned within 7 days.',brandColours:'#234f40,#e6d5b8'});
 await fund(company);const proposal=await company.proposeAllocation({marketing:'300000',support:'100000',finance:'0'},'Founder-approved fixture budget','fixture-funding');await company.allocate(proposal.id);await company.processJobs();
 const mission=await company.mission('Launch a sandalwood candle campaign','model-acme-mission');await company.processJobs();let state=await company.state();const banner=state.tasks.find(x=>x.vendor==='pixelpress');assert.equal(banner.state,'approval');assert.equal(state.ledger.length,2);
 company.approve(banner.id,true);await company.processJobs();state=await company.state();assert(state.agentRuns.filter(x=>x.mission_id===mission.id).every(x=>x.state==='completed'));
 const kit=company.kit(mission.id);assert.equal(kit.receipts.length,3);assert.equal(kit.financialReport.grossUnits,'400000');assert(kit.banner.includes(kit.copy.split('\n')[0]));assert(kit.faq.includes('Ships in 4 business days.'));assert(kit.faq.includes('within 7 days'));
 assert(state.agentMessages.some(x=>x.kind==='design_handoff'&&x.content.copy===kit.copy));assert(requests.some(x=>x.input.some(i=>i.type==='function_call_output'&&i.output.includes('Ships in 4 business days.'))));
 assert(!JSON.stringify(requests).includes('private-test-key'));assert(!JSON.stringify(requests).includes('policySignature'));assert(!JSON.stringify(requests).includes('privateKey'));
 const before=state.ledger.length;await company.mission('Launch a sandalwood candle campaign','model-acme-mission');await company.processJobs();assert.equal((await company.state()).ledger.length,before);
 const tools=createAgentTools({db:company.db,store:company.agentStore,service:company,activity:company.activity}),run=company.agentStore.run(`${mission.id}:marketing:mission`);await tools.execute(run,'purchase_service',{vendor:'copydesk'});await tools.execute(run,'purchase_service',{vendor:'copydesk'});await company.processJobs();assert.equal((await company.state()).ledger.length,before);
});

test('unregistered vendors and spoofed 402 destinations cannot reserve or spend company funds',async t=>{
 const {company}=await setup(t,{mutateResponse:async response=>{if(response.status!==402)return response;const header=JSON.parse(Buffer.from(response.headers.get('payment-required'),'base64').toString());header.accepts[0].payTo='0x0000000000000000000000000000000000000001';return new Response(await response.text(),{status:402,headers:{'PAYMENT-REQUIRED':encodePayment(header)}})}});
 await assert.rejects(company.buy('marketing','attacker','Buy a service','unknown-mission'),/policy rejected/);await assert.rejects(company.quote('marketing','copydesk','Launch copy','spoofed-mission'),/quote differs/);
 assert.equal(company.db.prepare('SELECT COUNT(*) n FROM company_tasks').get().n,0);assert.equal((await company.chain.events()).length,0);
});

test('Finance funds a shortfall once, explains its decision and preserves founder approval',async t=>{
 const {company}=await setup(t);await fund(company);
 // Existing company credit, with Marketing almost out of its earlier allocation.
 await company.allocate();await company.processJobs();await fund(company);
 company.db.prepare('UPDATE company_sim_balances SET units=? WHERE address=?').run('50000',company.departments[0].address.toLowerCase());
 await company.mission('Launch our new collection','finance-shortfall-001');
 for(let i=0;i<12;i++)await company.processJobs();
 let state=await company.state();const banner=state.tasks.find(x=>x.vendor==='pixelpress');assert.equal(banner.state,'approval');
 assert(state.budgetRequests.every(x=>x.state==='funded'));assert(state.activity.some(x=>x.kind==='budget_approved'&&/reviewed/.test(x.message)));
 const allocations=company.db.prepare("SELECT COUNT(*) n FROM company_jobs WHERE id LIKE 'finance:%'").get().n;
 await company.processJobs();assert.equal(company.db.prepare("SELECT COUNT(*) n FROM company_jobs WHERE id LIKE 'finance:%'").get().n,allocations);
 assert.equal(state.tasks.filter(x=>x.vendor==='pixelpress'&&x.state==='delivered').length,0);
});

test('Finance refuses a request that would exceed its 50 USDT weekly ceiling',async t=>{
 const {company}=await setup(t);await fund(company);await company.allocate();await company.processJobs();
 company.db.prepare('UPDATE company_sim_balances SET units=? WHERE address=?').run('0',company.departments[0].address.toLowerCase());
 company.db.prepare("INSERT INTO company_jobs(id,kind,data,state,created_at) VALUES('prior-allocation','allocation',?,'confirmed',?)").run(JSON.stringify({dept:company.departments[0].address,amount:'50000000',week:Math.floor(Date.now()/604800000)}),Math.floor(Date.now()/1000));
 await company.mission('Launch within our limits','finance-ceiling-001');await company.processJobs();
 const state=await company.state();assert(state.budgetRequests.some(x=>x.dept==='marketing'&&x.state==='declined'));assert(state.activity.some(x=>x.kind==='declined'&&/50 test USDT/.test(x.message)));
 assert.equal(company.db.prepare("SELECT COUNT(*) n FROM company_jobs WHERE id LIKE 'finance:%'").get().n,0);
});

test('founder tops up, Finance allocates, departments pay three vendors, approvals and books reconcile', async t => {
  const { company, vendors } = await setup(t);
  const order = await fund(company);
  await company.simulate(order.id); await company.processJobs();
  assert.equal((await company.state()).companyBalance, '5000000');
  await company.allocate(); await company.allocate(); await company.processJobs();
  let state = await company.state();
  assert.deepEqual(state.team.map(d => d.balance), ['300000','100000','0']);
  assert.equal(state.companyBalance, '4600000');
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
  assert.equal(state.team[0].balance, '0');
  assert.equal(state.team[1].balance, '0');
  const kit=company.kit(state.missions[0].id);
  assert.equal(kit.receipts.length,3);assert.match(kit.memo,/0.004/);
  const headline=kit.copy.split('\n')[0];assert(kit.banner.includes(headline));
  assert(state.activity.some(x=>x.kind==='headline_handoff'));assert(state.activity.some(x=>x.kind==='kit_delivered'));
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
  await company.mission('Launch the spring collection', 'mission-retry-001');
  await company.processJobs();assert((await company.state()).budgetRequests.some(x=>x.state==='waiting'));
  await fund(company); await company.allocate(); await company.processJobs();
  await company.mission('Launch the spring collection', 'mission-retry-001');
  for(let i=0;i<5;i++)await company.processJobs();
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
  assert.equal((await fetch(origin+'/api/activity/stream')).status,401);
  let response=await fetch(origin+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:'wrong'})});
  assert.equal(response.status,401);
  response=await fetch(origin+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password:'long-founder-password'})});
  assert.equal(response.status,200);
  const cookie=response.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(origin+'/api/state',{headers:{Cookie:cookie}})).status,200);
  company.activity.record('marketing','plan_decided','I am planning this campaign.');company.activity.record('marketing','refused','I cannot override my spending limit.');
  const stream=await fetch(origin+'/api/activity/stream',{headers:{Cookie:cookie,'Last-Event-ID':'1'}}),reader=stream.body.getReader();
  const replay=new TextDecoder().decode((await reader.read()).value);assert.match(replay,/id: 2/);assert(!replay.includes('id: 1\n'));await reader.cancel();
  assert.equal((await fetch(origin+'/api/orders',{method:'POST',headers:{Cookie:cookie,Origin:'https://evil.example'}})).status,403);
});
