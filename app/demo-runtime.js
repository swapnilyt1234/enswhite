import {mkdtempSync,rmSync,writeFileSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,basename} from 'node:path';
import {createServer} from 'node:http';
import {createCompany} from './company.js';
import {createVendor} from './vendor-server.js';
import {VENDORS} from './company-store.js';
import {campaignKitHTML} from './campaign-kit.js';

const offline=process.argv.includes('--offline')||process.env.AGENT_MODE!=='llm';
if(process.argv.includes('--sample')&&!offline)throw new Error('Public samples must be generated offline; private AI output is not published automatically.');
const root=mkdtempSync(join(tmpdir(),'enswhite-runtime-')),vendors=[],urls=new Map();let company;
const env={CHAIN_MODE:'simulated',PAYMENT_MODE:'simulated',COMPANY_DATA_DIR:join(root,'company'),VENDOR_DATA_DIR:join(root,'vendors'),AGENT_MODE:offline?'offline':'llm',OPENAI_API_KEY:offline?'':process.env.OPENAI_API_KEY,OPENAI_MODEL:offline?'':process.env.OPENAI_MODEL};
try{
 for(const v of VENDORS){const vendor=await createVendor(v.id,env),server=createServer(vendor.app);vendors.push({vendor,server});await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r)});urls.set(`http://127.0.0.1:${v.port}`,`http://127.0.0.1:${server.address().port}`)}
 company=await createCompany({env,vendorFetch:(url,init)=>{const parsed=new URL(url);return fetch(urls.get(parsed.origin)+parsed.pathname,init)}});
 company.updateBusiness({name:'Acme Candles',description:'Sandalwood candles for premium home decor',audience:'People interested in premium home decor',language:'Hindi',productName:'Sandalwood candle',shippingPolicy:'Ships within 4 business days.',returnPolicy:'Unopened products can be returned within 7 days.',contact:'Contact Acme through the founder workspace.',brandColours:'#234f40,#e6d5b8'});
 const order=await company.order();await company.simulate(order.id);await company.processJobs();
 await company.requestFinanceProposal();await company.processJobs();let state=await company.state();if(!state.allocationProposal)throw new Error('Finance did not produce an allocation proposal. Inspect model configuration and run history.');
 await company.allocate(state.allocationProposal.id);await company.processJobs();
 const mission=await company.mission('Launch a sandalwood candle campaign with campaign copy, a branded banner and customer FAQ.','demo-sandalwood-001');
 for(let i=0;i<12;i++){await company.processJobs();state=await company.state();for(const task of state.tasks.filter(x=>x.state==='approval'))company.approve(task.id,true);if(state.missions.some(x=>x.id===mission.id&&x.kit_ready))break;if(state.agentRuns.some(x=>x.state==='failed'))throw new Error('An employee run failed. No successful AI delivery is being claimed.')}
 const kit=company.kit(mission.id),actions=state.agentRuns.filter(x=>x.mission_id===mission.id).map(run=>({employee:run.department,source:run.source,state:run.state,tools:company.agentStore.actions(run.id).map(a=>({name:a.name,state:a.state,resultState:a.result?.state||null}))}));
 console.log(JSON.stringify({mode:'simulated',model:offline?'OFFLINE TOOL WORKFLOW (no AI call)':env.OPENAI_MODEL,mission:mission.id,actions,receipts:kit.receipts.map(x=>({vendor:x.vendor,gross:x.gross,explorerLink:x.url})),grossUnits:kit.financialReport.grossUnits},null,2));
 if(process.argv.includes('--sample')){writeFileSync('app/judge-public/sample-kit.html',campaignKitHTML(kit));console.log('Saved public offline Campaign Kit sample.')}
}finally{if(company)await company.close();for(const {server,vendor}of vendors){await new Promise(r=>server.close(r));vendor.close()}const target=realpathSync(root);if(dirname(target)!==realpathSync(tmpdir())||!basename(target).startsWith('enswhite-runtime-'))throw new Error('Unexpected sandbox cleanup path');rmSync(target,{recursive:true,force:true})}
