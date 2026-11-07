import {readPaymentStatus} from './payment-status.js';
import {createDirectoryView} from './directory-view.js';
import {normalizeLandingSection} from './landing-section.js';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {Contract} from 'ethers';
import {feedbackPayload,rankVendors,REPUTATION_REGISTRY,REPUTATION_ABI} from './reputation.js';
import {identityContract,identityManifest} from './agent-identity.js';
import { resolve } from 'node:path';
import { keccak256, toUtf8Bytes, formatUnits, verifyTypedData } from 'ethers';
import { openStore, createGateway, webhookSignature, digest, fail } from './payments.js';
import { DEPARTMENTS, VENDORS, walletStore } from './company-store.js';
import { createSimulatedCompanyChain, createRealCompanyChain, RECEIVE_TYPES, TOP_UP_TYPES, ALLOCATE_TYPES, boundNonce } from './company-chain.js';
import { decodePayment, encodePayment } from './x402.js';
import { NETWORK, TOKEN, EXPLORER, retryRPCRead } from './chain.js';
import { createENSDirectory, IDENTITY_TYPES } from './ens.js';
import { createENSWriter } from './ens-writer.js';
import { createActivity } from './activity.js';
import {createAgentStore} from './agent-store.js';
import {createAgentRuntime} from './agent-runtime.js';
import {createAgentTools,offlineAction} from './agent-tools.js';
import {EMPLOYEES} from './agent-definitions.js';
import {createEmploymentQueue} from './employment.js';

export const COMPANY_SCHEME = 'enswhite-receive';
const now = () => Math.floor(Date.now()/1000);
const week = () => Math.floor(Date.now()/604800000);
const publicError = 'Operation paused. Check contract setup, gas tank, pool funding or vendor availability; the saved transaction is retained.';
const poolShortage=(required,available)=>Object.assign(fail(`Company pool needs ${formatUnits(required-available,6)} more test USDT at the company contract. Verified payments remain queued; do not repeat checkout.`,409),{code:'POOL_UNFUNDED'});

export async function createCompany({ env = process.env, directory = resolve(env.COMPANY_DATA_DIR || `data/company/${env.CHAIN_MODE ?? 'simulated'}`), vendorFetch = fetch, chainFactory, ensDirectory, modelFetch } = {}) {
  const mode = env.CHAIN_MODE ?? 'simulated';
  if (!['simulated', 'testnet'].includes(mode)) throw new Error('Invalid chain mode');
  if (mode === 'testnet' && (env.PAYMENT_MODE !== 'razorpay' || !env.FOUNDER_PASSWORD || env.FOUNDER_PASSWORD.length < 12)) throw new Error('Testnet requires Razorpay TEST mode and a founder password of at least 12 characters');
  const { db, key } = openStore(directory);
  db.exec(`CREATE TABLE IF NOT EXISTS company_sessions (hash TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS company_orders (id TEXT PRIMARY KEY,amount INTEGER NOT NULL,units TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS company_missions (id TEXT PRIMARY KEY,request_key TEXT UNIQUE NOT NULL,title TEXT NOT NULL,source TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS company_tasks (id TEXT PRIMARY KEY,mission_id TEXT NOT NULL REFERENCES company_missions(id),dept TEXT NOT NULL,vendor TEXT NOT NULL,task TEXT NOT NULL,amount TEXT NOT NULL,salt TEXT NOT NULL,state TEXT NOT NULL,result TEXT,error TEXT,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS company_jobs (id TEXT PRIMARY KEY,kind TEXT NOT NULL,data TEXT NOT NULL,state TEXT NOT NULL,raw TEXT,hash TEXT,error TEXT,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS company_approvals (task_id TEXT PRIMARY KEY REFERENCES company_tasks(id),approved INTEGER NOT NULL,created_at INTEGER NOT NULL);
  `);
  db.exec(`CREATE TABLE IF NOT EXISTS company_plans(mission_id TEXT PRIMARY KEY,plan TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS company_handoffs(mission_id TEXT NOT NULL,vendor TEXT NOT NULL,task TEXT NOT NULL,state TEXT NOT NULL,PRIMARY KEY(mission_id,vendor));
    CREATE TABLE IF NOT EXISTS company_kits(mission_id TEXT PRIMARY KEY,kit TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS company_budget_requests(id TEXT PRIMARY KEY,mission_id TEXT NOT NULL,dept TEXT NOT NULL,vendor TEXT NOT NULL,task TEXT NOT NULL,state TEXT NOT NULL,amount TEXT,target TEXT,ens_id TEXT,reason TEXT);`);
  const fingerprint = `${mode}:${env.PAYMENT_MODE ?? 'simulated'}:${env.RELAY_COMPANY_ADDRESS ?? 'local'}`;
  const old = db.prepare("SELECT value FROM settings WHERE key='company_config'").get();
  if (old && old.value !== fingerprint) { db.close(); throw new Error('Use a new COMPANY_DATA_DIR when changing chain, payment mode or company address'); }
  const getWallet = walletStore(db, key);
  const roles=env.COMPANY_ROLES?JSON.parse(env.COMPANY_ROLES):DEPARTMENTS.map(x=>x.id);
  if(!Array.isArray(roles)||!roles.includes('finance')||roles.some(x=>!DEPARTMENTS.some(d=>d.id===x)))throw new Error('Invalid company roles');
  const departments = DEPARTMENTS.filter(x=>roles.includes(x.id)).map(dept => ({ ...dept, address: getWallet(dept.id, 'department').address }));
  let chain;
  const directoryENS = ensDirectory ?? (env.ENS_ENABLED === 'true' ? createENSDirectory(env) : null);
  try {
    const vendors = [];
    for (const expected of VENDORS.filter(x=>roles.includes(x.dept))) {
      const url = `http://127.0.0.1:${expected.port}`;
      const response = await vendorFetch(url + '/api/info', { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`Start ${expected.name} before the company server`);
      const info = await response.json();
      if (info.id !== expected.id || info.price !== expected.price || info.chainMode !== mode || !/^0x[a-f0-9]{40}$/i.test(info.address ?? '')) throw new Error('Vendor configuration mismatch');
      vendors.push({ ...expected, address: info.address, url,ensName:directoryENS?`${expected.id}.vendors.${env.ENS_PARENT_NAME}`:null });
    }
    const simulatedAttester = mode === 'simulated' ? getWallet('attester', 'attester') : null;
    const config = { departments, vendors, financeAddress: departments.find(d => d.id === 'finance').address, attesterAddress: simulatedAttester?.address, relayerAddress: mode === 'simulated' ? getWallet('relayer','relayer').address : undefined };
    chain = chainFactory ? await chainFactory(db, config) : mode === 'simulated' ? createSimulatedCompanyChain(db, config) : await createRealCompanyChain(env, config);
    await chain.checkConfiguration();
    const attester = simulatedAttester ?? chain.attester;
    const gateway = createGateway(env, db);
    const activity=createActivity(db);
    const agentStore=createAgentStore(db);let runtime;
    const employment=directoryENS?createEmploymentQueue(db,{controller:env.ENS_NAMES_ADDRESS,company:directoryENS.companyName,parent:env.ENS_PARENT_NAME,departments,vendors}):null;
    const assertNotFiring=label=>{if(employment?.firing(label))throw fail('This employee is being removed. New work and payments are paused.',409)};
    const vendorIdentityFile=resolve('docs/deployments/vendor-identities.json');
    const vendorIdentities=existsSync(vendorIdentityFile)?JSON.parse(readFileSync(vendorIdentityFile,'utf8')):[];
    db.exec('CREATE TABLE IF NOT EXISTS company_reviews(id TEXT PRIMARY KEY,kind TEXT NOT NULL,mission TEXT NOT NULL,target TEXT NOT NULL,department TEXT NOT NULL,score INTEGER NOT NULL,comment TEXT NOT NULL,created_at TEXT NOT NULL)');
    const ensWriter=directoryENS?createENSWriter(db,directoryENS,getWallet,event=>activity.record(event.label==='founder-reviewer'?'company':event.label,event.key==='erc8004.feedback'?'review_confirmed':event.key==='enswhite.status'?'ens_status':'budget_updated',event.key==='erc8004.feedback'?'My ERC-8004 review is confirmed.':event.key==='enswhite.status'?`My ENS status is now ${event.value}.`:`Finance updated my ENS weekly budget to ${formatUnits(event.value,6)} test USDT.`,{data:{hash:event.hash,network:'sepolia',value:event.value},key:`ens:${event.hash}`})):null;
    db.prepare('INSERT OR IGNORE INTO settings VALUES(?,?)').run('company_config', fingerprint);
    const directoryView=createDirectoryView(directoryENS);
    let running;
    const jobs = () => db.prepare('SELECT id,kind,state,hash,error,created_at FROM company_jobs ORDER BY created_at DESC').all();
    const enqueue = (id, kind, data) => db.prepare("INSERT OR IGNORE INTO company_jobs(id,kind,data,state,created_at) VALUES(?,?,?,'queued',?)").run(id, kind, JSON.stringify(data), now());
    function funding(snapshot) {
      const pending=db.prepare("SELECT data FROM company_jobs WHERE kind='topup' AND state IN ('queued','submitted')").all();
      const units=pending.reduce((sum,row)=>sum+BigInt(JSON.parse(row.data).amount),0n);
      const available=snapshot.poolAvailable==null?null:BigInt(snapshot.poolAvailable);
      return {pendingCount:pending.length,pendingUnits:String(units),available:available===null?null:String(available),shortfall:String(available!==null&&units>available?units-available:0n),canCheckout:available===null||available>=units+5_000_000n};
    }
    async function receipts() { return (await chain.events()).filter(event => event.kind === 'payment'); }
    const businessProfile=()=>({name:'Acme Candles',description:'Thoughtfully made candles and gifts',audience:'Customers looking for meaningful gifts',language:'Hindi',productName:'',shippingPolicy:'',returnPolicy:'',contact:'',brandColours:'#163b32,#cee2ae',productImage:'',...JSON.parse(db.prepare("SELECT value FROM settings WHERE key='business_profile'").get()?.value||'{}')});
    const simulatedWeekly=dept=>db.prepare('SELECT value FROM settings WHERE key=?').get('weekly:'+dept.id)?.value||dept.weekly;
    async function remaining(dept) {
      const balance = await chain.balance(dept.address);
      const reserved = db.prepare("SELECT amount FROM company_tasks WHERE dept=? AND state IN ('approval','queued','submitted')").all(dept.id).reduce((sum, row) => sum + BigInt(row.amount), 0n);
      return balance - reserved;
    }
    const service = {
      db, chain, departments, vendors, gateway, activity,agentStore,
      async rankVendors(candidates){
        if(!directoryENS)return candidates.map(v=>({id:v.id,name:v.name,price:v.price,reputation:null,simulated:true}));
        const entries=candidates.map(v=>({...v,agentId:vendorIdentities.find(x=>x.label===v.id&&x.owner.toLowerCase()===v.address.toLowerCase())?.agentId}));
        const ranked=await rankVendors(new Contract(REPUTATION_REGISTRY,REPUTATION_ABI,directoryENS.provider),identityContract(directoryENS.provider),entries,departments.map(x=>x.address));
        return ranked.map(({id,name,price,agentId,reputation})=>({id,name,price,agentId,reputation}));
      },
      async review(kind,mission,target,department,score,comment){
        if(!['vendor','employee'].includes(kind)||!Number.isInteger(score)||score<1||score>5||typeof comment!=='string'||!comment.trim()||comment.length>1000)throw fail('Invalid review');
        if(kind==='vendor'){
          const task=db.prepare("SELECT * FROM company_tasks WHERE mission_id=? AND vendor=? AND dept=? AND state='delivered'").get(mission,target,department);
          if(!task||!(await receipts()).some(x=>x.requestId===task.id))throw fail('Only delivered work with a confirmed payment may be reviewed',409);
        }else if(!departments.some(x=>x.id===target)||!db.prepare("SELECT id FROM agent_runs WHERE mission_id=? AND department=? AND state='completed'").get(mission,target))throw fail('Only completed employee assignments may be reviewed',409);
        const id=keccak256(toUtf8Bytes(`review:${kind}:${mission}:${target}`)),old=db.prepare('SELECT * FROM company_reviews WHERE id=?').get(id);
        if(old&&(old.score!==score||old.comment!==comment))throw fail('This work was already reviewed',409);
        db.prepare('INSERT OR IGNORE INTO company_reviews VALUES(?,?,?,?,?,?,?,?)').run(id,kind,mission,target,department,score,comment,new Date().toISOString());return{id,state:directoryENS?'queued':'simulated'};
      },
      async processReviews(){
        if(!ensWriter)return;
        for(const row of db.prepare('SELECT * FROM company_reviews ORDER BY rowid').all()){
          if(db.prepare('SELECT id FROM ens_writes WHERE id=?').get(row.id))continue;
          const target=row.kind==='vendor'?vendorIdentities.find(x=>x.label===row.target):identityManifest(env.ENS_IDENTITY_FILE).find(x=>x.label===row.target);
          if(!target)continue;
          const registered=identityContract(directoryENS.provider);
          if((await registered.ownerOf(target.agentId)).toLowerCase()!==target.owner.toLowerCase()||(await registered.getAgentWallet(target.agentId)).toLowerCase()!==target.owner.toLowerCase())throw new Error('Review target identity ownership mismatch');
          if(row.kind==='employee'&&departments.find(x=>x.id===row.target)?.address.toLowerCase()!==target.owner.toLowerCase())throw new Error('Employee review target differs from the company wallet');
          const client=row.kind==='vendor'?departments.find(x=>x.id===row.department).address:getWallet('founder-reviewer','reviewer').address;
          let proof;
          if(row.kind==='vendor'){
            const task=db.prepare("SELECT * FROM company_tasks WHERE mission_id=? AND vendor=? AND dept=? AND state='delivered'").get(row.mission,row.target,row.department),event=task&&(await receipts()).find(x=>x.requestId===task.id),vendor=vendors.find(x=>x.id===row.target);
            if(!event||event.vendor.toLowerCase()!==target.owner.toLowerCase()||vendor.address.toLowerCase()!==target.owner.toLowerCase()||event.dept.toLowerCase()!==client.toLowerCase())throw new Error('Review payment does not match vendor identity and buying department');
            proof={fromAddress:client,toAddress:vendor.address,chainId:'1874',txHash:event.hash};
          }
          const payload=feedbackPayload({agentId:target.agentId,client,score:row.score,comment:row.comment,proof,context:{missionId:row.mission,company:directoryENS.companyName,kind:row.kind,reviewer:row.kind==='employee'?'Authenticated founder through dedicated service wallet':'Buying department'},createdAt:row.created_at});
          ensWriter.queueFeedback(row.kind==='vendor'?row.department:'founder-reviewer',payload,row.id);
        }
      },
      async assertEmployee(label){const dept=departments.find(x=>x.id===label);if(!dept)throw fail('Unknown employee',403);assertNotFiring(label);if(directoryENS){const identity=await directoryENS.employee(label);if(identity.wallet.toLowerCase()!==dept.address.toLowerCase())throw fail('Employee identity differs from its signer',403);return identity}return{name:label,wallet:dept.address,simulated:true}},
      async agentLedger(missionId){
        const snapshot=await chain.snapshot(),all=await receipts(),payments=all.filter(x=>db.prepare('SELECT id FROM company_tasks WHERE id=? AND mission_id=?').get(x.requestId,missionId)),team=[];
        for(const dept of departments)team.push({id:dept.id,balance:String(await chain.balance(dept.address)),available:String(await remaining(dept)),weekly:directoryENS?(await directoryENS.employee(dept.id)).weekly:simulatedWeekly(dept),approval:dept.approval});
        return{companyBalance:snapshot.companyBalance,team,vendors:vendors.map(x=>({id:x.id,dept:x.dept,price:x.price})),payments,history:all.slice(-30),flags:payments.filter(x=>BigInt(x.amount)>BigInt(departments.find(d=>d.address.toLowerCase()===x.dept.toLowerCase())?.approval||0)).map(x=>({requestId:x.requestId,message:'Above-threshold expense: inspect its recorded founder approval.'}))};
      },
      async allocationNeeds(missionId){const ledger=await service.agentLedger(missionId),needs={marketing:'0',support:'0',finance:'0'};for(const dept of ledger.team){const demand=vendors.filter(v=>v.dept===dept.id&&!db.prepare('SELECT id FROM company_tasks WHERE mission_id=? AND vendor=?').get(missionId,v.id)).reduce((n,v)=>n+BigInt(v.price),0n);needs[dept.id]=String(demand>BigInt(dept.available)?demand-BigInt(dept.available):0n)}return needs},
      async agentContext(run){const row=db.prepare('SELECT title FROM company_missions WHERE id=?').get(run.mission_id),snapshot=db.prepare('SELECT profile FROM company_profiles WHERE mission_id=?').get(run.mission_id);return{mission:row?.title||'Recommend startup funds for the registered campaign services',business:snapshot?JSON.parse(snapshot.profile):businessProfile(),hiredDepartments:departments.map(x=>x.id),employee:await service.assertEmployee(run.department),purpose:run.purpose,source:run.source,memory:agentStore.memory(run.department),allocationNeeds:run.department==='finance'?await service.allocationNeeds(run.mission_id):null,work:db.prepare('SELECT id,dept,vendor,state,result FROM company_tasks WHERE mission_id=?').all(run.mission_id).map(x=>({...x,result:x.result?JSON.parse(x.result):null})),messages:agentStore.messages(run.mission_id).filter(x=>x.kind!=='model_output').slice(-10)}},
      answerFounder(id,answer){if(typeof answer!=='string'||!answer.trim()||answer.length>1500)throw fail('Answer must contain 1–1500 characters');const row=db.prepare('SELECT * FROM founder_questions WHERE id=?').get(id);if(!row)throw fail('Question not found',404);if(row.answer&&row.answer!==answer)throw fail('This question was already answered',409);db.prepare('UPDATE founder_questions SET answer=? WHERE id=?').run(answer,id);activity.record('company','founder_answer','The founder answered an employee question.',{data:{questionId:id}});return{id}},
      paymentStatus:()=>readPaymentStatus(db,chain.address,mode==='testnet'?EXPLORER:null),
      attention(){return{
        questions:db.prepare('SELECT id,run_id,question,answer FROM founder_questions WHERE answer IS NULL ORDER BY created_at').all(),
        paused:agentStore.runs().filter(x=>x.state==='failed'),
        recovering:agentStore.runs().filter(x=>x.state==='recovering'),
        approvals:db.prepare("SELECT id,dept,vendor,amount,mission_id FROM company_tasks WHERE state='approval' ORDER BY created_at").all(),
      }},
      agentHistory(id){const run=agentStore.runs().find(x=>x.id===id);if(!run)throw fail('Employee run not found',404);return{run,actions:agentStore.actions(id),messages:agentStore.messages(run.mission_id).filter(x=>x.kind!=='model_output')}},
      retryAgent:id=>runtime.retry(id),
      session(token, loginPassword) {
        if (token && /^[a-f0-9]{64}$/.test(token) && db.prepare('SELECT hash FROM company_sessions WHERE hash=?').get(digest(token))) return { user: { id: 'founder' } };
        if (mode === 'testnet' || env.FOUNDER_PASSWORD) {
          if (typeof loginPassword !== 'string' || !timingSafeEqual(Buffer.from(digest(loginPassword)), Buffer.from(digest(env.FOUNDER_PASSWORD)))) throw fail('Founder sign-in required', 401);
        }
        const created = randomBytes(32).toString('hex');
        db.prepare('INSERT INTO company_sessions VALUES(?)').run(digest(created));
        return { user: { id: 'founder' }, token: created };
      },
      async state() {
        const [snapshot,ledger]=await Promise.all([chain.snapshot(),receipts()]);
        const team = await Promise.all(departments.map(async dept=>{
          const own = ledger.filter(row => row.dept.toLowerCase() === dept.address.toLowerCase());
          const runs=agentStore.runs().filter(x=>x.department===dept.id),currentRun=runs.find(x=>['queued','thinking','executing','waiting','recovering'].includes(x.state))||runs[0]||null;
          const [balance,wbt]=await Promise.all([chain.balance(dept.address),chain.provider?chain.provider.getBalance(dept.address).catch(()=>null):null]);
          const reserved=db.prepare("SELECT amount FROM company_tasks WHERE dept=? AND state IN ('approval','queued','submitted')").all(dept.id).reduce((sum,row)=>sum+BigInt(row.amount),0n);
          return{...dept,capabilities:EMPLOYEES[dept.id].capabilities,currentRun,wbtBalance:wbt===null?null:String(wbt),weekly:simulatedWeekly(dept),balance:String(balance),remaining:String(BigInt(balance)-reserved),spent:own.reduce((sum,row)=>sum+BigInt(row.amount),0n).toString(),lastPurchase:own.at(-1)??null};
        }));
        const directory=directoryView(),organization=directory.organization;
        for(const dept of team){const identity=organization.find(row=>row.wallet.toLowerCase()===dept.address.toLowerCase());dept.identity=identity??null;dept.ensName=identity?.name??(directoryENS?`${dept.id}.${directoryENS.companyName}`:null);if(identity){dept.weekly=identity.weekly;dept.perCall=identity.perCall;}}
        const branding=directory.branding;
        const latest=db.prepare('SELECT id,source FROM company_missions ORDER BY created_at DESC,rowid DESC LIMIT 1').get();
        return { brand: 'EnsWhite', ens: { enabled: !!directoryENS, directoryStatus:directory.status, checkedAt:directory.checkedAt, organization, companyName:directoryENS?.companyName, branding, writes:ensWriter?.jobs()??[] }, mode, paymentMode: gateway.mode, scheme: COMPANY_SCHEME, company: chain.address, network: NETWORK, token: TOKEN,
          ...snapshot, team, vendors: vendors.map(v => ({ ...v, earningsUrl: `/api/vendors/${v.id}/earnings` })),
          tasks: db.prepare('SELECT * FROM company_tasks ORDER BY created_at DESC').all().map(row => ({ ...row, result: row.result ? JSON.parse(row.result) : null })),
          reviews:ensWriter?db.prepare('SELECT r.*,w.state,w.hash,w.error FROM company_reviews r LEFT JOIN ens_writes w ON w.id=r.id ORDER BY r.rowid DESC').all():db.prepare('SELECT *,\'simulated\' AS state FROM company_reviews').all(),business:businessProfile(),
          missions: db.prepare('SELECT m.*, CASE WHEN k.mission_id IS NULL THEN 0 ELSE 1 END kit_ready FROM company_missions m LEFT JOIN company_kits k ON k.mission_id=m.id ORDER BY m.created_at DESC').all(), ledger, jobs: jobs(),
          activity:db.prepare('SELECT * FROM company_activity ORDER BY id DESC LIMIT 200').all().reverse().map(row=>({...row,data:JSON.parse(row.data)})),
          employment:{ready:employment?.ready()||false,jobs:employment?.jobs()||[]},
          aiMode:env.AGENT_MODE==='llm'?(!env.OPENAI_API_KEY||!env.OPENAI_MODEL?'configuration required':agentStore.runs().some(x=>x.mission_id===latest?.id&&x.state==='failed')?'paused':'configured'):'offline',
          budgetRequests:db.prepare('SELECT id,mission_id,dept,vendor,state,amount,target,reason FROM company_budget_requests').all(),
          founderQuestions:db.prepare('SELECT id,run_id,question,answer FROM founder_questions ORDER BY created_at').all(),agentRuns:agentStore.runs(),agentMessages:db.prepare("SELECT id,run_id,mission_id,sender,recipient,kind,content,created_at FROM agent_messages WHERE kind!='model_output' ORDER BY id DESC LIMIT 100").all().reverse().map(x=>({...x,content:JSON.parse(x.content)})),
          allocationProposal:db.prepare("SELECT * FROM finance_proposals WHERE state='draft' ORDER BY created_at DESC LIMIT 1").get()||null,
          approvals: db.prepare('SELECT * FROM company_approvals ORDER BY created_at DESC').all(),
          topup: { inr: 500, usdt: '5', note: 'Fixed demo allocation. Fiat is simulated, not converted.',...funding(snapshot) },
          relayer: chain.relayerAddress, explorer: mode === 'testnet' ? EXPLORER : null,
          finance: { proposal: 'Task-based proposals cover registered service prices after existing funds. Unused company cash stays unallocated.', flags: ledger.filter(row => BigInt(row.amount) > BigInt(departments.find(d => d.address.toLowerCase() === row.dept.toLowerCase())?.approval ?? '0')).map(row => ({ requestId: row.requestId, message: 'Above the department approval threshold; review the matching founder approval.' })) },
        };
      },
      async order() {
        if (db.prepare('SELECT COUNT(*) n FROM company_orders').get().n >= 100) throw fail('Demo order limit reached', 429);
        const backing=funding(await chain.snapshot());
        if(!backing.canCheckout)throw poolShortage(BigInt(backing.pendingUnits)+5_000_000n,BigInt(backing.available));
        const order = await gateway.order(50_000);
        if (!/^order_[a-zA-Z0-9]+$/.test(order.id)) throw fail('Invalid payment-provider order');
        db.prepare('INSERT INTO company_orders VALUES(?,?,?)').run(order.id, 50_000, '5000000');
        return { id: order.id, amount: 50_000, currency: 'INR', keyId: gateway.keyId, mode: gateway.mode };
      },
      updateBusiness(input) {
        if(!input||typeof input!=='object')throw fail('Enter your business profile');
        const profile={};for(const [field,max] of [['name',80],['description',600],['audience',180]]){if(typeof input[field]!=='string'||!input[field].trim()||input[field].length>max||/[\u0000-\u001f]/.test(input[field]))throw fail(`Invalid business ${field}`);profile[field]=input[field].trim()}
        if(!['Hindi','Marathi'].includes(input.language))throw fail('Choose Hindi or Marathi customer help');profile.language=input.language;
        for(const [field,max]of [['productName',100],['shippingPolicy',600],['returnPolicy',600],['contact',180],['brandColours',100],['productImage',500]]){const value=input[field]??'';if(typeof value!=='string'||value.length>max||/[\u0000-\u001f]/.test(value))throw fail('Invalid business '+field);profile[field]=value.trim()}
        if(profile.productImage){let url;try{url=new URL(profile.productImage)}catch{throw fail('Use an HTTPS product image URL')}if(url.protocol!=='https:'||url.username||url.password)throw fail('Use an HTTPS product image URL')}
        db.prepare('INSERT INTO company_profiles(profile,created_at) VALUES(?,?)').run(JSON.stringify(profile),Date.now());
        db.prepare("INSERT OR REPLACE INTO settings VALUES('business_profile',?)").run(JSON.stringify(profile));return profile;
      },
      kit(id) {const row=db.prepare('SELECT kit FROM company_kits WHERE mission_id=?').get(id);if(!row)throw fail('Campaign Kit is waiting for all commissioned work to be delivered',409);const kit=JSON.parse(row.kit),landing=normalizeLandingSection(kit.landing);return{...kit,landing,...(landing!==kit.landing?{landingNote:'Nested markup was normalized for export. The original vendor delivery and its recorded review are preserved.'}:{})}},
      async manageENS(action,label,term=2592000,id) {
        if(!directoryENS||!employment)throw fail('Employee management is not configured',409);
        const dept=departments.find(row=>row.id===label);
        if(!dept)throw fail('Choose a registered department');
        if(!['hire','fire','renew'].includes(action)||![300,2592000].includes(term))throw fail('Invalid employee action or employment term');
        const prior=id&&employment.request(id);if(prior){if(prior.action!==action||prior.label!==label||prior.term!==term)throw fail('Request ID belongs to another employee change',409);return{id:prior.id,state:prior.state}}
        let identity;try{identity=await directoryENS.employee(label)}catch(error){if(error.message!=='Employee is fired or expired')throw error}
        if(action==='hire'&&identity)throw fail('This employee is already hired',409);
        if(action!=='hire'&&!identity)throw fail('This employee is no longer active',409);
        const saved=employment.policy(label),policy={weekly:identity?.weekly||saved?.weekly||dept.weekly,perCall:identity?.perCall||saved?.perCall||dept.perCall,vendors:identity?.vendors||saved?.vendors||vendors.filter(v=>v.dept===label).map(v=>`${v.id}.vendors.${env.ENS_PARENT_NAME}`)};
        const result=employment.queue(action,label,term,policy,id);
        activity.record(label,'employment_requested',`The founder requested ${action==='fire'?'employee removal':action==='hire'?'a new employment term':'an employment renewal'}. The business service will submit it.`,{data:{requestId:result.id},key:`employment-request:${result.id}`});return result;
      },
      async signupENS(label) {
        if(!directoryENS)throw fail('ENSv2 is not configured',409);
        return directoryENS.signup(label,departments.find(d=>d.id==='finance').address);
      },
      updateENSBudget(label,amount,id) {
        if(!ensWriter)throw fail('ENSv2 is not configured',409);
        return ensWriter.queue(label,'enswhite.budget.weekly',amount,id);
      },
      async vendorEarnings(id) {
        const vendor=vendors.find(row=>row.id===id);
        if(!vendor)throw fail('Unknown vendor',404);
        const response=await vendorFetch(vendor.url+'/api/earnings',{signal:AbortSignal.timeout(10000)});
        if(!response.ok)throw fail('Vendor earnings unavailable',502);
        return response.json();
      },
      async capture(raw, signature) {
        if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature) || !timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(webhookSignature(raw, gateway.secret), 'hex'))) throw fail('Invalid webhook signature', 401);
        let event; try { event = JSON.parse(raw.toString('utf8')); } catch { throw fail('Invalid JSON'); }
        if (event.event !== 'payment.captured') return { ignored: true };
        const id = event.payload?.payment?.entity?.id;
        if (!/^pay_[a-zA-Z0-9]+$/.test(id ?? '')) throw fail('Invalid payment ID');
        const payment = await gateway.payment(id);
        const order = payment && db.prepare('SELECT * FROM company_orders WHERE id=?').get(payment.order_id);
        if (!payment || payment.id !== id || !payment.captured || payment.status !== 'captured' || payment.currency !== 'INR' || !order || payment.amount !== order.amount) throw fail('Payment is not a captured, matching INR 500 company order');
        // Order ID, rather than an event ID, also prevents a second payment on the same order from crediting twice.
        enqueue(`credit:${order.id}`, 'topup', { paymentId: keccak256(toUtf8Bytes(id)), amount: order.units });
        return { accepted: true };
      },
      async simulate(orderId) {
        if (gateway.mode !== 'simulated') throw fail('Simulation disabled', 403);
        const order = db.prepare('SELECT * FROM company_orders WHERE id=?').get(orderId);
        if (!order) throw fail('Unknown order');
        let payment = db.prepare('SELECT * FROM simulated_payments WHERE order_id=?').get(orderId);
        if (!payment) { payment = { id: 'pay_' + randomBytes(12).toString('hex') }; db.prepare('INSERT INTO simulated_payments VALUES(?,?,?,?,?)').run(payment.id, orderId, order.amount, 'INR', 'captured'); }
        const raw = Buffer.from(JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: payment.id } } } }));
        return service.capture(raw, webhookSignature(raw, gateway.secret));
      },
      async proposeAllocation(allocations,rationale,missionId,source='offline') {
        if(!allocations||Object.keys(allocations).sort().join(',')!=='finance,marketing,support'||Object.values(allocations).some(x=>typeof x!=='string'||!/^\d{1,8}$/.test(x))||typeof rationale!=='string'||!rationale.trim()||rationale.length>1000)throw fail('Invalid Finance proposal');
        const pending=db.prepare("SELECT data FROM company_jobs WHERE kind='allocation' AND state IN ('queued','submitted')").all().reduce((n,x)=>n+BigInt(JSON.parse(x.data).amount),0n);
        if(Object.values(allocations).reduce((n,x)=>n+BigInt(x),0n)>BigInt((await chain.snapshot()).companyBalance)-pending)throw fail('Proposal exceeds available company credit');
        for(const [label,units]of Object.entries(allocations))if(!departments.some(x=>x.id===label)&&BigInt(units)!==0n)throw fail('Cannot fund an unhired department');
        for(const dept of departments){const identity=directoryENS?await directoryENS.employee(dept.id):null,limit=BigInt(identity?.weekly??simulatedWeekly(dept));const allocated=db.prepare("SELECT data FROM company_jobs WHERE kind='allocation' AND state!='failed'").all().map(x=>JSON.parse(x.data)).filter(x=>x.week===week()&&x.dept===dept.address).reduce((n,x)=>n+BigInt(x.amount),0n);if(BigInt(allocations[dept.id])+allocated>limit||BigInt(allocations[dept.id])>50_000_000n)throw fail('Proposal exceeds a department weekly cap');}
        const id=keccak256(toUtf8Bytes(JSON.stringify({allocations,missionId,week:week()})));
        db.prepare("INSERT OR IGNORE INTO finance_proposals VALUES(?,?,?,?,?,'draft',?)").run(id,missionId,JSON.stringify(allocations),rationale,source,Date.now());
        activity.record('finance','allocation_proposed',rationale,{mission:missionId,data:{proposalId:id,allocations,source},key:'proposal:'+id});return{id,allocations,rationale,requiresFounderApproval:true};
      },
      async requestFinanceProposal(){if(db.prepare("SELECT COUNT(*) n FROM agent_runs WHERE purpose='allocation'").get().n>=20)throw fail('Finance proposal run limit reached',429);const checkpoint=db.prepare("SELECT id,state FROM company_jobs WHERE kind IN ('topup','allocation') ORDER BY id").all(),id='allocation_'+keccak256(toUtf8Bytes(`${week()}:${JSON.stringify(checkpoint)}`)).slice(2,34);agentStore.ensure(id,'finance',env.AGENT_MODE==='llm'?'llm':'offline','allocation',env.AGENT_MODE==='llm'?2:1);const runId=`${id}:finance:allocation`,saved=agentStore.run(runId);if(saved.state==='failed'&&saved.calls===0&&saved.attempts===0)runtime.retry(runId);return{id}},
      async allocate(proposalId) {
        await retryRPCRead(()=>service.assertEmployee('finance'));
        if(!proposalId){if(env.AGENT_MODE==='llm')throw fail('Request and review a Finance proposal before approval');const missionId='allocation_'+week(),needs=await service.allocationNeeds(missionId);proposalId=(await service.proposeAllocation(needs,'Offline task-cost proposal for the registered campaign services, after existing department funds.',missionId)).id;}
        const proposal=db.prepare('SELECT * FROM finance_proposals WHERE id=?').get(proposalId);if(!proposal)throw fail('Finance proposal not found');if(proposal.state==='approved')return{accepted:true};
        const allocations=JSON.parse(proposal.allocations);await retryRPCRead(()=>service.proposeAllocation(allocations,proposal.rationale,proposal.mission_id,proposal.source));
        db.exec('BEGIN IMMEDIATE');try{for(const dept of departments){const amount=allocations[dept.id];if(BigInt(amount)>0n)enqueue(`proposal:${proposal.id}:${dept.id}`,'allocation',{dept:dept.address,amount,week:week(),mission:proposal.mission_id});}db.prepare("UPDATE finance_proposals SET state='approved' WHERE id=?").run(proposal.id);db.exec('COMMIT')}catch(error){db.exec('ROLLBACK');throw error}
        activity.record('finance','allocation_approved','The founder approved my task-based allocation proposal.',{mission:proposal.mission_id,key:'proposal-approved:'+proposal.id});return{accepted:true};
      },
      async mission(title, requestKey) {
        if (typeof title !== 'string' || title.trim().length < 5 || title.length > 600 || !/^[a-zA-Z0-9_-]{8,80}$/.test(requestKey ?? '')) throw fail('Enter a mission (5–600 characters) and an idempotency key');
        const old = db.prepare('SELECT * FROM company_missions WHERE request_key=?').get(requestKey);
        if (old && old.title !== title.trim()) throw fail('Idempotency key belongs to a different mission');
        if(!old){const duplicate=db.prepare("SELECT m.id FROM company_missions m WHERE m.title=? AND m.created_at>=? AND EXISTS(SELECT 1 FROM agent_runs r WHERE r.mission_id=m.id AND r.state IN ('queued','thinking','executing','waiting','recovering')) ORDER BY m.created_at LIMIT 1").get(title.trim(),now()-60);if(duplicate)return{id:duplicate.id,reused:true};}
        if (!old && db.prepare('SELECT COUNT(*) n FROM company_missions').get().n >= (env.GUEST_MODE==='true'||env.VISITOR_COMPANY==='true'?5:30)) throw fail('Demo mission limit reached', 429);
        const id = old?.id ?? randomUUID();
        if (!old) db.prepare('INSERT INTO company_missions VALUES(?,?,?,?,?)').run(id, requestKey, title.trim(), 'planning', now());
        activity.record('company','mission_received',`I received the mission: ${title.trim()}`,{mission:id,key:`mission:${id}`});
        if(old&&db.prepare('SELECT plan FROM company_plans WHERE mission_id=?').get(id))return{id};
        db.prepare('INSERT OR IGNORE INTO company_profiles(mission_id,profile,created_at) VALUES(?,?,?)').run(id,JSON.stringify(businessProfile()),Date.now());
        const source=env.AGENT_MODE==='llm'?'llm':'offline';
        for(const dept of departments)agentStore.ensure(id,dept.id,source,'mission',source==='llm'?2:1);
        db.prepare('UPDATE company_missions SET source=? WHERE id=?').run(source==='llm'?'OpenAI tool runtime':'offline tool workflow',id);
        return { id };
      },
      async quote(departmentId, vendorId, task, missionId) {
        const dept = departments.find(d => d.id === departmentId), vendor = vendors.find(v => v.id === vendorId && v.dept === departmentId);
        if (!dept || !vendor || typeof task !== 'string' || !task.trim() || task.length > 8000) throw fail('Department/vendor policy rejected');
        const id = keccak256(toUtf8Bytes(`${missionId}:${vendorId}`));
        let ensPolicy;
        try{ensPolicy=directoryENS?await directoryENS.authorize(dept.id, `${vendor.id}.vendors.${env.ENS_PARENT_NAME}`, dept.address, vendor.address, vendor.url+'/work', vendor.price):null}
        catch(error){activity.record(dept.id,'refused',/fired or expired/.test(error.message)?"I cannot authorize a purchase: my ENS employment is fired or expired.":/disagrees/.test(error.message)?"I refuse this vendor: its wallet or endpoint does not match ENS.":'I cannot verify the live ENS policy, so I will not sign a payment.',{mission:missionId,data:{vendor:vendor.id}});throw error}
        if(ensPolicy)activity.record(dept.id,'vendor_resolved',`I resolved ${ensPolicy.vendorName} through ENS. Its wallet and service endpoint match.`,{mission:missionId,data:{vendor:vendor.id,payee:ensPolicy.vendorWallet,employee:ensPolicy.name,expiry:ensPolicy.expiry},key:`resolved:${id}`});
        const body = { requestId: id, dept: dept.address, task, company:chain.address };
        const response = await vendorFetch(vendor.url + '/work', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
        if (response.status !== 402) throw fail('Vendor did not return a payment challenge', 502);
        const required = decodePayment(response.headers.get('payment-required'));
        const quote = required.accepts?.[0];
        if (required.x402Version !== 2 || quote?.scheme !== COMPANY_SCHEME || quote.network !== NETWORK || quote.asset?.toLowerCase() !== TOKEN.toLowerCase() || quote.payTo?.toLowerCase() !== chain.address.toLowerCase() || quote.extra?.vendor?.toLowerCase() !== vendor.address.toLowerCase() || quote.extra?.requestId !== id || quote.amount !== vendor.price){activity.record(dept.id,'refused','I refuse this quote: its payee, price or payment fields differ from the approved policy.',{mission:missionId,data:{vendor:vendor.id}});throw fail('Vendor quote differs from the registered policy')}
        activity.record(dept.id,'quote_received',`${vendor.name} requested ${formatUnits(vendor.price,6)} test USDT through HTTP 402. I checked its price and payment destination.`,{mission:missionId,data:{vendor:vendor.id,amount:vendor.price},key:`quote:${id}`});
        return{id,vendor:vendor.id,amount:vendor.price,weekly:ensPolicy?.weekly,ensVerified:!!ensPolicy,source:mode};
      },
      async buy(departmentId,vendorId,task,missionId){
        const dept=departments.find(d=>d.id===departmentId),vendor=vendors.find(v=>v.id===vendorId&&v.dept===departmentId);
        if(!dept||!vendor||typeof task!=='string'||!task.trim()||task.length>8000)throw fail('Department/vendor policy rejected');
        const id=keccak256(toUtf8Bytes(`${missionId}:${vendorId}`));if(db.prepare('SELECT id FROM company_tasks WHERE id=?').get(id))return id;
        const ensPolicy=await service.quote(departmentId,vendorId,task,missionId);
        const amount = BigInt(vendor.price);
        if (amount > BigInt(dept.perCall)){activity.record(dept.id,'refused','This purchase exceeds my hard per-call limit. Finance cannot override it.',{mission:missionId,key:`call-refused:${id}`});throw fail('Per-call policy limit exceeded',402)}
        // Budget permission comes from deterministic code and contract limits, never model text.
        const sinceWeek = now() - now()%604800;
        const spentJobs = db.prepare("SELECT amount,state,created_at FROM company_tasks WHERE dept=? AND state NOT IN ('rejected','failed')").all(departmentId);
        const weekly = spentJobs.filter(row => row.created_at >= sinceWeek).reduce((sum, row) => sum + BigInt(row.amount), 0n);
        const daily = spentJobs.filter(row => Math.floor(row.created_at/86400) === Math.floor(now()/86400)).reduce((sum, row) => sum + BigInt(row.amount), 0n);
        if(daily+amount>BigInt(dept.perDay)){activity.record(dept.id,'refused','My daily spending cap is exhausted. Finance cannot override the contract limit.',{mission:missionId,key:`daily-refused:${id}`});throw fail('Daily policy limit exceeded')}
        const available=await remaining(dept);
        if(available<amount||weekly+amount>BigInt(ensPolicy?.weekly??simulatedWeekly(dept))){
          db.prepare("INSERT OR IGNORE INTO company_budget_requests VALUES(?,?,?,?,?,'waiting',NULL,NULL,NULL,NULL)").run(id,missionId,dept.id,vendor.id,task);
          if(!db.prepare("SELECT id FROM agent_messages WHERE mission_id=? AND sender=? AND kind='budget_request' AND content LIKE ?").get(missionId,dept.id,'%'+vendor.id+'%'))agentStore.message({id:`${missionId}:${dept.id}:mission`,mission_id:missionId,department:dept.id},'finance','budget_request',{vendor:vendor.id,amount:vendor.price,shortfall:String(available<amount?amount-available:0n),note:'Request only; existing company policy decides whether funds or a scoped budget edit can be authorized.'});
          activity.record(dept.id,'budget_requested',available<amount?`I am asking Finance for +₹${(Number(amount-available)/10000).toFixed(2)} for ${vendor.name}. I will wait before reserving or signing this purchase.`:`I need Finance to review my weekly spending permission before buying from ${vendor.name}. I will not sign until the policy permits it.`,{mission:missionId,data:{amount:vendor.price,vendor:vendor.id},key:`budget-request:${id}`});return id;
        }
        const state = amount > BigInt(dept.approval) ? 'approval' : 'queued';
        db.prepare('INSERT INTO company_tasks VALUES(?,?,?,?,?,?,?,?,NULL,NULL,?)').run(id, missionId, dept.id, vendor.id, task, vendor.price, '0x' + randomBytes(32).toString('hex'), state, now());
        if (state === 'queued') enqueue(id, 'payment', { requestId: id });
        activity.record(dept.id,state==='approval'?'approval_requested':'policy_checked',state==='approval'?`This costs ₹${(Number(amount)/10000).toFixed(2)}, above my ₹${(Number(dept.approval)/10000).toFixed(2)} approval threshold. I am asking the founder before signing.`:'My spending policy and available budget allow this purchase.',{mission:missionId,data:{requestId:id,vendor:vendor.id},key:`policy:${id}`});
        return id;
      },
      approve(id, accepted) {
        const task = db.prepare('SELECT * FROM company_tasks WHERE id=?').get(id);
        if (!task || task.state !== 'approval' || typeof accepted !== 'boolean') throw fail('Task is not awaiting approval');
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare('UPDATE company_tasks SET state=? WHERE id=?').run(accepted ? 'queued' : 'rejected', id);
          db.prepare('INSERT INTO company_approvals VALUES(?,?,?)').run(id, accepted ? 1 : 0, now());
          if (accepted) enqueue(id, 'payment', { requestId: id });
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        activity.record(task.dept,accepted?'approved':'declined',accepted?'The founder approved my purchase. I can now authorize payment.':'The founder declined this purchase. I released the reserved budget.',{mission:task.mission_id,data:{requestId:id},key:`decision:${id}`});
      },
      async verify(payload) {
        const a = payload?.payload?.authorization;
        if (payload?.x402Version !== 2 || payload.accepted?.scheme !== COMPANY_SCHEME || payload.accepted.network !== NETWORK || typeof payload.payload?.requestId !== 'string') throw fail('Unsupported custom x402 payload');
        const task = db.prepare('SELECT * FROM company_tasks WHERE id=?').get(payload.payload.requestId);
        const dept = departments.find(d => d.id === task?.dept), vendor = vendors.find(v => v.id === task?.vendor);
        if (!task || !dept || !vendor || ['approval', 'rejected', 'failed'].includes(task.state)) throw fail('Policy or approval rejected');
        assertNotFiring(dept.id);
        if (payload.accepted.amount !== task.amount || payload.accepted.asset?.toLowerCase() !== TOKEN.toLowerCase() || payload.accepted.payTo?.toLowerCase() !== chain.address.toLowerCase() || a?.nonce !== boundNonce(vendor.address, task.id, task.salt) || a.from !== dept.address || a.to !== chain.address || a.value !== task.amount) throw fail('Payment does not match the reserved order');
        if (verifyTypedData(chain.domain, RECEIVE_TYPES, a, payload.payload.signature) !== dept.address) throw fail('Invalid department signature');
        if (Number(a.validAfter) >= now() || Number(a.validBefore) <= now() || Number(a.validBefore) > now()+300) throw fail('Authorization expired or invalid');
        return { task, dept, vendor };
      },
      async processJobs() {
        if (running) return running;
        running = (async () => {
          for(const job of employment?.jobs()||[])if(['confirmed','failed'].includes(job.state))activity.record(job.label,'employment_updated',job.state==='confirmed'?`The employee ${job.action==='fire'?'was removed':job.action==='hire'?'was hired':'employment was renewed'}.`:'The employee update needs operator attention.',{data:{requestId:job.id,hash:job.hash,network:'sepolia'},key:`employment-result:${job.id}`});
          if(mode==='testnet')runtime.start();else await runtime.tick();
          // One request at a time keeps Finance's ENS edit and allocation nonce ordered.
          const request=db.prepare("SELECT * FROM company_budget_requests WHERE state IN ('waiting','ens','allocating') ORDER BY rowid LIMIT 1").get();
          if(request){try{
            const dept=departments.find(x=>x.id===request.dept);
            if(request.state==='waiting'){
              const identity=directoryENS?await directoryENS.employee(dept.id):null;
              const tasks=db.prepare("SELECT amount FROM company_tasks WHERE dept=? AND state NOT IN ('failed','rejected') AND created_at>=?").all(dept.id,now()-now()%604800);
              const spent=tasks.reduce((n,x)=>n+BigInt(x.amount),0n),available=await remaining(dept),price=BigInt(vendors.find(x=>x.id===request.vendor).price),extra=price>available?price-available:0n;
              const allocations=db.prepare("SELECT data FROM company_jobs WHERE kind='allocation' AND state!='failed'").all().map(x=>JSON.parse(x.data));
              const allocated=allocations.filter(x=>x.week===week()&&x.dept===dept.address).reduce((n,x)=>n+BigInt(x.amount),0n);
              const reserved= db.prepare("SELECT data FROM company_jobs WHERE kind='allocation' AND state IN ('queued','submitted')").all().reduce((n,x)=>n+BigInt(JSON.parse(x.data).amount),0n);
              const current=BigInt(identity?.weekly??simulatedWeekly(dept)),needed=spent+price>allocated+extra?spent+price:allocated+extra,target=current>needed?current:needed;
              if(target>50_000_000n){db.prepare("UPDATE company_budget_requests SET state='declined',reason=? WHERE id=?").run('Requested weekly limit exceeds the 50 test USDT policy ceiling.',request.id);activity.record('finance','declined','I declined this request: it exceeds the 50 test USDT weekly ceiling.',{mission:request.mission_id,key:`finance-declined:${request.id}`})}
              else if(BigInt((await chain.snapshot()).companyBalance)-reserved<extra){activity.record('finance','budget_waiting','I cannot allocate unbacked money. This request is waiting for company credit; do not repeat an already captured checkout.',{mission:request.mission_id,key:`finance-waiting:${request.id}`})}
              else{
                const ensId=`finance_${request.id.slice(2,34)}`,reason=`I reviewed ${tasks.length} reserved or paid purchases (${formatUnits(spent,6)} test USDT). This task needs ${formatUnits(extra,6)} additional funds; a ${formatUnits(target,6)} weekly limit stays within 50. Hard daily, per-call and founder-approval limits remain in force.`;
                if(target>current){if(ensWriter)ensWriter.queue(dept.id,'enswhite.budget.weekly',String(target),ensId);else{db.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)').run('weekly:'+dept.id,String(target));activity.record('finance','budget_updated','I updated the simulated weekly budget. No ENS transaction was sent.',{mission:request.mission_id,key:`sim-budget:${request.id}`})}}
                db.prepare("UPDATE company_budget_requests SET state='ens',amount=?,target=?,ens_id=?,reason=? WHERE id=?").run(String(extra),String(target),target>current&&ensWriter?ensId:null,reason,request.id);
                activity.record('finance','budget_approved',reason,{mission:request.mission_id,key:`finance-approved:${request.id}`});agentStore.message({id:`${request.mission_id}:finance:mission`,mission_id:request.mission_id,department:'finance'},dept.id,'budget_policy_decision',{amount:String(extra),weeklyLimit:String(target),reason,source:'deterministic authorized policy'});
              }
            }else if(request.state==='ens'){
              const write=request.ens_id?db.prepare('SELECT state FROM ens_writes WHERE id=?').get(request.ens_id):null;
              if(!request.ens_id||write?.state==='confirmed'){
                const price=BigInt(vendors.find(x=>x.id===request.vendor).price),available=await remaining(dept),needed=price>available?price-available:0n;
                const allocated=db.prepare("SELECT data FROM company_jobs WHERE kind='allocation' AND state!='failed'").all().map(x=>JSON.parse(x.data)).filter(x=>x.week===week()&&x.dept===dept.address).reduce((n,x)=>n+BigInt(x.amount),0n);
                const limit=BigInt(directoryENS?(await directoryENS.employee(dept.id)).weekly:simulatedWeekly(dept));
                if(needed>BigInt(request.amount)||allocated+needed>limit){db.prepare("UPDATE company_budget_requests SET state='waiting' WHERE id=?").run(request.id)}
                else{
                  if(needed>0n)enqueue(`finance:${request.id}`,'allocation',{dept:dept.address,amount:String(needed),week:week(),mission:request.mission_id});
                  db.prepare("UPDATE company_budget_requests SET state='allocating',amount=? WHERE id=?").run(String(needed),request.id);
                }
              }else if(write?.state==='failed')db.prepare("UPDATE company_budget_requests SET state='declined',reason='Scoped ENS budget edit failed' WHERE id=?").run(request.id);
            }else{
              const job=db.prepare('SELECT state FROM company_jobs WHERE id=?').get(`finance:${request.id}`);
              if(BigInt(request.amount)===0n||job?.state==='confirmed'){
                await service.buy(request.dept,request.vendor,request.task,request.mission_id);
                if(db.prepare('SELECT id FROM company_tasks WHERE id=?').get(request.id))db.prepare("UPDATE company_budget_requests SET state='funded' WHERE id=?").run(request.id);
                else db.prepare("UPDATE company_budget_requests SET state='waiting' WHERE id=?").run(request.id);
              }else if(job?.state==='failed')db.prepare("UPDATE company_budget_requests SET state='declined',reason='Onchain allocation failed' WHERE id=?").run(request.id);
            }
          }catch{activity.record('finance','budget_waiting','I paused the budget request because live employment, scoped permissions or funding could not be verified.',{mission:request.mission_id,key:`finance-paused:${request.id}`})}}
          for (const row of db.prepare("SELECT * FROM company_jobs WHERE state IN ('queued','submitted') ORDER BY created_at,rowid").all()) {
            try {
              let data = JSON.parse(row.data);
              if (!row.raw) {
                const submittedToday = db.prepare('SELECT COUNT(*) n FROM company_jobs WHERE raw IS NOT NULL AND created_at>=?').get(now()-now()%86400).n;
                if (submittedToday >= 120) throw new Error('Relayer daily transaction cap exceeded');
                if (row.kind === 'topup') {
                  const available=(await chain.snapshot()).poolAvailable;
                  if(available!=null&&BigInt(available)<BigInt(data.amount))throw poolShortage(BigInt(data.amount),BigInt(available));
                  data.deadline = String(now()+300);
                  data.signature = await attester.signTypedData(chain.companyDomain, TOP_UP_TYPES, { paymentId: data.paymentId, amount: data.amount, deadline: data.deadline });
                } else if (row.kind === 'allocation') {
                  assertNotFiring('finance');
                  const dept=departments.find(d=>d.address===data.dept),limit=directoryENS?(await directoryENS.employee(dept.id)).weekly:simulatedWeekly(dept);
                  assertNotFiring(dept.id);
                  const committed=db.prepare("SELECT data FROM company_jobs WHERE kind='allocation' AND state!='failed'").all().map(x=>JSON.parse(x.data)).filter(x=>x.week===data.week&&x.dept===data.dept).reduce((n,x)=>n+BigInt(x.amount),0n);
                  if(committed>BigInt(limit))throw new Error('Cumulative weekly allocations exceed policy');
                  if(directoryENS){
                    const finance=await directoryENS.employee('finance');
                    if(finance.wallet!==departments.find(d=>d.id==='finance').address)throw new Error('ENS Finance signer mismatch');
                    const dept=departments.find(d=>d.address===data.dept),identity=await directoryENS.employee(dept.id);
                    if(identity.wallet!==dept.address||BigInt(data.amount)>BigInt(identity.weekly))throw new Error('ENS allocation policy rejected');
                  }
                  data.nonce = await chain.allocationNonce(); data.deadline = String(now()+300);
                  data.signature = await getWallet('finance', 'department').signTypedData(chain.companyDomain, ALLOCATE_TYPES, { dept: data.dept, amount: data.amount, nonce: data.nonce, deadline: data.deadline });
                } else {
                  const task = db.prepare('SELECT * FROM company_tasks WHERE id=?').get(row.id);
                  const dept = departments.find(d => d.id === task.dept), vendor = vendors.find(v => v.id === task.vendor);
                  assertNotFiring(dept.id);
                  if (!['queued','submitted'].includes(task.state)) throw new Error('Task not approved');
                  const identity = directoryENS ? await directoryENS.authorize(dept.id, `${vendor.id}.vendors.${env.ENS_PARENT_NAME}`, dept.address, vendor.address, vendor.url+'/work', task.amount) : null;
                  activity.record(dept.id,'policy_checked','I refreshed my employment and vendor policy immediately before signing.',{mission:task.mission_id,data:{requestId:task.id},key:`fresh:${task.id}`});
                  const authorization = { from: dept.address, to: chain.address, value: task.amount, validAfter: String(now()-1), validBefore: String(now()+300), nonce: boundNonce(vendor.address, task.id, task.salt) };
                  const signature = await getWallet(dept.id, 'department').signTypedData(chain.domain, RECEIVE_TYPES, authorization);
                  const payload = { x402Version: 2, accepted: { scheme: COMPANY_SCHEME, network: NETWORK, amount: task.amount, asset: TOKEN, payTo: chain.address }, payload: { requestId: task.id, authorization, signature } };
                  await service.verify(payload);
                  data = { requestId: task.id, dept: dept.address, vendor: vendor.address, amount: task.amount, salt: task.salt, authorization, signature };
                  if (identity) {
                    data.identity = { deptNode:identity.node, vendorNode:identity.vendorNode, weeklyMax:identity.weekly, perCallMax:identity.perCall, nameExpiry:identity.expiry, validUntil:identity.validUntil };
                    data.policySignature = await attester.signTypedData(chain.companyDomain, IDENTITY_TYPES, {requestId:task.id,dept:dept.address,vendor:vendor.address,...data.identity});
                  }
                }
                const tx = await chain.prepare(row.kind, data);
                db.prepare("UPDATE company_jobs SET data=?,raw=?,hash=?,state='submitted',error=NULL WHERE id=?").run(JSON.stringify(data), tx.raw, tx.hash, row.id);
                row.raw = tx.raw; row.hash = tx.hash;
                if (row.kind === 'payment') db.prepare("UPDATE company_tasks SET state='submitted' WHERE id=?").run(row.id);
                if(row.kind==='payment'){const task=db.prepare('SELECT * FROM company_tasks WHERE id=?').get(row.id);activity.record(task.dept,'signed','I signed the payment authorization. The relayer covers Whitechain gas; the signed transaction is saved before broadcast.',{mission:task.mission_id,data:{requestId:row.id,hash:row.hash},key:`signed:${row.id}`})}
              }
              const receipt = await chain.broadcast(row.raw, row.hash);
              db.prepare('UPDATE company_jobs SET state=?,error=? WHERE id=?').run(receipt.state, receipt.state === 'failed' ? 'Transaction reverted; no successful payment recorded' : null, row.id);
              if (row.kind === 'payment' && receipt.state !== 'submitted') db.prepare('UPDATE company_tasks SET state=?,error=? WHERE id=?').run(receipt.state, receipt.state === 'failed' ? 'Onchain policy rejected the payment' : null, row.id);
              if(row.kind==='payment'&&receipt.state==='confirmed'){const task=db.prepare('SELECT * FROM company_tasks WHERE id=?').get(row.id);activity.record(task.dept,'settled','My vendor payment settled. The receipt records the department, vendor and payment amount.',{mission:task.mission_id,data:{requestId:row.id,hash:row.hash,network:mode==='testnet'?'whitechain':'simulated'},key:`settled:${row.id}`})}
              if(row.kind==='allocation'&&receipt.state==='confirmed')activity.record('finance','allocation_settled',`I allocated ${formatUnits(data.amount,6)} test USDT to ${departments.find(x=>x.address===data.dept)?.name}.`,{mission:data.mission,data:{hash:row.hash,network:mode==='testnet'?'whitechain':'simulated'},key:`allocation:${row.id}`});
              if (receipt.state === 'submitted') break; // Keep Finance nonce and relayer transaction order deterministic.
            } catch(error) {
              db.prepare('UPDATE company_jobs SET error=? WHERE id=?').run(error.code==='POOL_UNFUNDED'?error.message:publicError, row.id);
              break;
            }
          }
          for (const task of db.prepare("SELECT t.*,j.hash FROM company_tasks t JOIN company_jobs j ON j.id=t.id WHERE t.state='confirmed'").all()) {
            try {
              const vendor = vendors.find(v => v.id === task.vendor), dept = departments.find(d => d.id === task.dept);
              const response = await vendorFetch(vendor.url + '/work', { method: 'POST', signal: AbortSignal.timeout(12_000), headers: { 'Content-Type': 'application/json', 'PAYMENT-RESPONSE': encodePayment({ success: true, transaction: task.hash, network: NETWORK }) }, body: JSON.stringify({ requestId: task.id, dept: dept.address, task: task.task, company:chain.address }) });
              if (!response.ok) throw new Error('Vendor not ready');
              const result = await response.json();
              if (result.requestId !== task.id || !['svg','text','html'].includes(result.type) || typeof result.content !== 'string' || result.content.length > 30_000) throw new Error('Invalid delivery');
              db.prepare("UPDATE company_tasks SET state='delivered',result=?,error=NULL WHERE id=?").run(JSON.stringify(result), task.id);
              activity.record(task.dept,'delivery_verified',`${vendor.name} verified its payment and delivered the work.`,{mission:task.mission_id,data:{requestId:task.id,vendor:vendor.id,hash:task.hash,network:mode==='testnet'?'whitechain':'simulated'},key:`delivered:${task.id}`});
            } catch { db.prepare('UPDATE company_tasks SET error=? WHERE id=?').run('Payment confirmed; vendor delivery pending. Retrying never charges again.', task.id); }
          }
          for(const handoff of db.prepare("SELECT * FROM company_handoffs WHERE state='waiting'").all()){
            const copy=db.prepare("SELECT * FROM company_tasks WHERE mission_id=? AND vendor='copydesk' AND state='delivered'").get(handoff.mission_id);
            if(!copy)continue;
            const headline=JSON.parse(copy.result).content.split('\n').find(line=>line.trim())?.replace(/^#+\s*/,'').slice(0,100)||'Explore our collection';
            try{await service.buy('marketing','pixelpress',`Headline: ${headline}\n${handoff.task}`,handoff.mission_id);db.prepare("UPDATE company_handoffs SET state='forwarded' WHERE mission_id=? AND vendor=?").run(handoff.mission_id,handoff.vendor);activity.record('marketing','headline_handoff','I handed CopyDesk’s delivered headline to PixelPress for the banner.',{mission:handoff.mission_id,data:{headline},key:`handoff:${handoff.mission_id}`})}catch{}
          }
          if(mode==='testnet')runtime.start();else await runtime.tick();
          for(const mission of db.prepare('SELECT m.* FROM company_missions m LEFT JOIN company_kits k ON k.mission_id=m.id WHERE k.mission_id IS NULL').all()){
            const runs=agentStore.runs().filter(x=>x.mission_id===mission.id);if(runs.length&&runs.some(x=>x.state!=='completed'))continue;
            const tasks=db.prepare('SELECT * FROM company_tasks WHERE mission_id=?').all(mission.id),plan=db.prepare('SELECT plan FROM company_plans WHERE mission_id=?').get(mission.id);
            if(!tasks.length||tasks.some(t=>t.state!=='delivered')||(plan&&JSON.parse(plan.plan).tasks.length!==tasks.length))continue;
            const ledger=await receipts(),paid=tasks.map(t=>({task:t,event:ledger.find(e=>e.requestId===t.id)}));if(paid.some(x=>!x.event))continue;
            const gross=paid.reduce((n,x)=>n+BigInt(x.event.amount),0n),fees=paid.reduce((n,x)=>n+BigInt(x.event.fee),0n);
            const result=id=>{const t=tasks.find(t=>t.vendor===id);return t?JSON.parse(t.result).content:null};
            const kit={missionId:mission.id,business:businessProfile().name,title:mission.title,owner:departments.find(x=>x.id!=='finance')?.id||'finance',mode,copy:result('copydesk'),banner:JSON.parse(tasks.find(x=>x.vendor==='pixelpress')?.result||'null')?.type==='html'?null:result('pixelpress'),landing:JSON.parse(tasks.find(x=>x.vendor==='pixelpress')?.result||'null')?.type==='html'?result('pixelpress'):null,faq:result('lingualink'),memo:`I reconciled ${paid.length} paid purchases: ${formatUnits(gross,6)} test USDT gross, ${formatUnits(gross-fees,6)} to vendors and ${formatUnits(fees,6)} in company fees. Every included delivery has a matching payment receipt.`,receipts:paid.map(({task,event})=>({vendor:vendors.find(v=>v.id===task.vendor).name,gross:formatUnits(event.amount,6),hash:event.hash,url:mode==='testnet'?`${EXPLORER}/tx/${event.hash}`:null}))};
            kit.brief=agentStore.artifactFor(mission.id,'marketing','campaign_brief');kit.policyFAQ=agentStore.artifactFor(mission.id,'support','faq');kit.financialReport=agentStore.artifactFor(mission.id,'finance','financial_report');kit.executionSource=runs.length?(runs.every(x=>x.source==='llm')?'LLM tool runtime':'Offline tool workflow'):'Legacy workflow';
            db.prepare('INSERT OR IGNORE INTO company_kits VALUES(?,?)').run(mission.id,JSON.stringify(kit));activity.record('finance','output_reviewed',kit.memo,{mission:mission.id,key:`memo:${mission.id}`});activity.record('marketing','kit_delivered','I checked that every commissioned piece was delivered and assembled your Campaign Kit.',{mission:mission.id,data:{kit:mission.id},key:`kit:${mission.id}`});
          }
          if(ensWriter) {
            for(const dept of departments) {
              const tasks=db.prepare('SELECT state FROM company_tasks WHERE dept=? ORDER BY created_at DESC,rowid DESC').all(dept.id);
              const handoffs=dept.id==='marketing'&&db.prepare("SELECT COUNT(*) n FROM company_handoffs WHERE state='waiting'").get().n>0;
              const budgetWaiting=db.prepare("SELECT COUNT(*) n FROM company_budget_requests WHERE dept=? AND state IN ('waiting','ens','allocating')").get(dept.id).n>0;
              const status=tasks.some(t=>t.state==='approval')?'awaiting approval':budgetWaiting||handoffs||tasks.some(t=>['queued','submitted','confirmed','funding'].includes(t.state))?'working':tasks[0]?.state==='delivered'?'delivered':tasks[0]?.state==='failed'?'blocked':'active';
              await ensWriter.status(dept.id,status).catch(()=>{});
            }
            await service.processReviews();
            await ensWriter.process();
          }
        })().finally(() => { running = null; });
        return running;
      },
      async settle(payload) {
        const { task } = await service.verify(payload);
        enqueue(task.id, 'payment', { requestId: task.id });
        await service.processJobs();
        const job = db.prepare('SELECT state,hash FROM company_jobs WHERE id=?').get(task.id);
        return { success: job.state === 'confirmed', network: NETWORK, transaction: job.state === 'confirmed' ? job.hash : '', ...(job.state !== 'confirmed' ? { errorReason: 'settlement_pending' } : {}) };
      },
      async csv() {
        const lines = ['request_id,department,vendor,gross_test_usdt,fee_test_usdt,net_test_usdt,demo_inr,transaction,department_ens_node,vendor_ens_node'];
        for (const event of await receipts()) {
          const dept = departments.find(d => d.address.toLowerCase() === event.dept.toLowerCase()), vendor = vendors.find(v => v.address.toLowerCase() === event.vendor.toLowerCase());
          lines.push([event.requestId, dept?.name ?? event.dept, vendor?.name ?? event.vendor, formatUnits(event.amount,6), formatUnits(event.fee,6), formatUnits(BigInt(event.amount)-BigInt(event.fee),6), (Number(event.amount)/10000).toFixed(2), event.hash,event.deptNode??'',event.vendorNode??''].join(','));
        }
        return lines.join('\r\n');
      },
      async close() { if (running) await running;await runtime.close(); activity.close(); directoryENS?.close(); chain.close(); db.close(); },
    };
    const agentTools=createAgentTools({db,store:agentStore,service,activity});
    runtime=createAgentRuntime({db,store:agentStore,activity,tools:agentTools,context:run=>service.agentContext(run),offline:offlineAction,env,modelFetch,observe:async run=>{const questions=db.prepare('SELECT id,answer FROM founder_questions WHERE run_id=?').all(run.id);
      const actions=agentStore.actions(run.id),last=actions.at(-1);
      if(run.version===2)return JSON.stringify({questions,handoffs:db.prepare("SELECT id FROM agent_messages WHERE mission_id=? AND recipient=? AND kind='employee_handoff'").all(run.mission_id,run.department),work:db.prepare('SELECT vendor,state FROM company_tasks WHERE mission_id=?').all(run.mission_id),balance:last?.name==='propose_allocation'?String((await chain.snapshot()).companyBalance):null});
      if(last?.name==='propose_allocation'&&last.result?.waiting)return String((await chain.snapshot()).companyBalance);
      const work=db.prepare('SELECT vendor,state FROM company_tasks WHERE mission_id=?').all(run.mission_id),terminal=x=>['delivered','failed','rejected'].includes(x?.state)?x.state:'pending';
      if(run.department==='finance')return String(work.length===3&&work.every(x=>terminal(x)!=='pending'));
      const vendor=actions.filter(x=>x.name==='purchase_service').at(-1)?.arguments.vendor||(run.department==='support'?'lingualink':'copydesk');return terminal(work.find(x=>x.vendor===vendor));
    }});
    return service;
  } catch (error) { directoryENS?.close(); chain?.close(); db.close(); throw error; }
}
