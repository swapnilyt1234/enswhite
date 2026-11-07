import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {createLaunchStore,visitorHash} from './launch-store.js';
import {createProvisionSender} from './provision-sender.js';
import {Wallet,keccak256} from 'ethers';
import {createServer,request} from 'node:http';
import express from 'express';
import {createLaunchGateway} from './launch-server.js';
import {baseApp} from './http.js';

test('launches are isolated per visitor, idempotent, role-scoped and globally budgeted',t=>{
 const directory=mkdtempSync(join(tmpdir(),'enswhite-launch-')),store=createLaunchStore(directory);t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true})});
 const a=store.visitor(),b=store.visitor(),c=store.visitor(),input={name:'Candle shop',description:'Handmade candles',label:'candles'};
 const first=store.create(a,input);assert.equal(store.job(b),null);assert.equal(store.create(a,input).id,first.id);assert.throws(()=>store.create(a,{...input,label:'another'}),/Create another company/);assert.throws(()=>store.hire(a,['marketing']),/Finance/);store.hire(a,['finance','marketing']);assert.throws(()=>store.hire(a,['finance','support']),/already saved/);
 store.create(b,{...input,label:'second'});assert.throws(()=>store.create(c,{...input,label:'third'}),/Daily operator/);assert(!JSON.stringify(store.job(a)).includes('raw'));
});

test('legacy visitors keep their company and can create and switch workspaces without exposing another visitor',t=>{
 const directory=mkdtempSync(join(tmpdir(),'enswhite-launch-'));let store=createLaunchStore(directory);t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true})});
 const token=store.visitor(),stranger=store.visitor(),id='legacy-company';
 store.db.prepare("INSERT INTO launches VALUES(?,?,?,?,?,NULL,'ready',NULL,NULL,?)").run(id,visitorHash(token),'legacy','Legacy business','Existing company',Date.now());
 store.close();store=createLaunchStore(directory);assert.equal(store.job(token).id,id);assert.equal(store.companies(token).length,1);assert.equal(store.companies(stranger).length,0);
 store.newCompany(token);assert.equal(store.job(token),null);assert.equal(store.companies(token)[0].id,id);
 const second=store.create(token,{name:'New business',description:'Chosen during onboarding',label:'new-business'});assert.notEqual(second.id,id);assert.equal(store.companies(token).length,2);assert.throws(()=>store.newCompany(token),/Finish/);assert.throws(()=>store.select(stranger,second.id),/not found/);
 store.db.prepare("UPDATE launches SET state='ready' WHERE id=?").run(second.id);assert.equal(store.select(token,id).id,id);assert.equal(store.select(token,second.id).id,second.id);
 store.close();store=createLaunchStore(directory);assert.equal(store.job(token).id,second.id,'Restart keeps the selected company');
 store.newCompany(token);assert.throws(()=>store.create(token,{name:'Third',description:'Over the daily limit',label:'third'}),/Daily operator/);assert.equal(store.companies(token).length,2);
});

test('visitor cookies select only their company and internal founder sessions never reach the browser',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'enswhite-launch-')),store=createLaunchStore(directory),a=store.visitor(),b=store.visitor();
 for(const [token,label]of [[a,'first'],[b,'second']]){const job=store.create(token,{name:label,description:'Local test business',label}),file=join(directory,label+'.json');writeFileSync(file,JSON.stringify({FOUNDER_PASSWORD:'private-'+label,ENS_COMPANY_NAME:label}));store.db.prepare("UPDATE launches SET state='ready',config=? WHERE id=?").run(file,job.id)}
 const gateway=createLaunchGateway('http://localhost',{store,companyFactory:async({env})=>({name:env.ENS_COMPANY_NAME,session:()=>({token:'internal-secret-session'}),processJobs:async()=>{},close:async()=>{}}),appFactory:company=>{const app=express.Router();app.get('/api/state',(req,res)=>{assert(req.headers.cookie.includes('relay_company=internal-secret-session'));res.json({name:company.name})});return app}});
 const app=baseApp('http://localhost');app.use(gateway.app);app.use((error,req,res,next)=>res.status(error.status||500).json({error:error.message}));const server=createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await gateway.close();rmSync(directory,{recursive:true,force:true})});
 const get=cookie=>new Promise((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port:server.address().port,path:'/company/api/state',headers:{host:'localhost',...(cookie?{cookie:'enswhite_launch='+cookie}:{})}},res=>{let body='';res.on('data',x=>body+=x);res.on('end',()=>resolve({status:res.statusCode,body,headers:res.headers}))});req.on('error',reject);req.end()});
 assert.equal((await get()).status,401);const first=await get(a),second=await get(b);assert.equal(JSON.parse(first.body).name,'first');assert.equal(JSON.parse(second.body).name,'second');assert(!first.body.includes('internal-secret'));assert(!first.headers['set-cookie']);
});

test('launch sender journals before broadcast, recovers identical bytes and rejects daily budget overflow',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'enswhite-launch-')),store=createLaunchStore(directory);t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true})});
 const wallet=Wallet.createRandom();let broadcasts=0,populated=0,receipt=null;
 const signer={address:wallet.address,provider:{getNetwork:async()=>({chainId:11155111n}),getBalance:async()=>10n**18n,getTransactionReceipt:async()=>receipt,getTransaction:async()=>({}),broadcastTransaction:async raw=>{broadcasts++;assert(store.db.prepare('SELECT raw FROM launch_transactions').get());throw new Error('ambiguous')},waitForTransaction:async()=>null},populateTransaction:async tx=>(populated++,{...tx,nonce:0,gasLimit:21000n,gasPrice:1n,type:0}),signTransaction:tx=>wallet.signTransaction(tx)};
 const send=createProvisionSender(store.db,()=>{}),tx={to:Wallet.createRandom().address,value:1000n};await assert.rejects(send('job','fund',signer,tx),/pending/);const saved=store.db.prepare('SELECT * FROM launch_transactions').get();assert.equal(saved.hash,keccak256(saved.raw));
 receipt={status:1};await send('job','fund',signer,tx);assert.equal(populated,1);assert.equal(broadcasts,1);
 await assert.rejects(send('job','fund',signer,{...tx,value:1001n}),/differs/);
 await assert.rejects(send('job','over',signer,{...tx,value:20_000_000_000_000_000n}),/Daily operator/);assert.equal(store.db.prepare('SELECT COUNT(*) n FROM launch_transactions').get().n,1);
 for(let i=0;i<2;i++)store.db.prepare("INSERT INTO launch_transactions VALUES(?,?,'launch-company',11155111,?,?,'0','0','0','confirmed',?)").run('prior'+i,'prior'+i,saved.raw,saved.hash,Date.now());
 await assert.rejects(send('third','launch-company',signer,tx),/company budget/);
});

test('launch read timeouts retry in place and confirmation timeouts preserve one signed transaction',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'enswhite-launch-')),store=createLaunchStore(directory);t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true})});
 const wallet=Wallet.createRandom();let reads=0,signs=0,receipt=null;
 const provider={getNetwork:async()=>({chainId:11155111n}),getBalance:async()=>10n**18n,getTransactionReceipt:async()=>{if(!reads++)throw Object.assign(new Error('timeout'),{code:'TIMEOUT'});return receipt},broadcastTransaction:async()=>{receipt={status:1}},waitForTransaction:async()=>{throw Object.assign(new Error('timeout'),{code:'TIMEOUT'})}};
 const signer={address:wallet.address,provider,populateTransaction:async tx=>({...tx,nonce:0,gasLimit:21000n,gasPrice:1n,type:0}),signTransaction:async tx=>{signs++;return wallet.signTransaction(tx)}};
 const send=createProvisionSender(store.db,()=>{}),tx={to:Wallet.createRandom().address,value:1000n};assert.equal((await send('job','fund',signer,tx)).status,1);await send('job','fund',signer,tx);assert.equal(signs,1);
});

test('Whitechain deployment fee headroom fits the approved daily budget without raising ordinary call caps',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'enswhite-launch-')),store=createLaunchStore(directory);t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true})});const wallet=Wallet.createRandom();let signed=0;
 const provider={getNetwork:async()=>({chainId:1874n}),getBalance:async()=>10n**18n,getTransactionReceipt:async()=>({status:1})};
 const signer={address:wallet.address,provider,populateTransaction:async tx=>({...tx,nonce:0,gasLimit:1905403n,gasPrice:10001000000n,type:0}),signTransaction:async tx=>{signed++;return wallet.signTransaction(tx)}};
 const send=createProvisionSender(store.db,()=>{});await send('job','whitechain-company',signer,{data:'0x6000'});assert.equal(signed,1);
 assert(BigInt(store.db.prepare('SELECT fee FROM launch_transactions').get().fee)<30_000_000_000_000_000n);
 await assert.rejects(send('job','ordinary-call',signer,{to:Wallet.createRandom().address,data:'0x6000'}),/per-transaction cap 0.02/);assert.equal(signed,1);
});


test('a fresh visitor can read only its own saved credit even while company/RPC initialization is unavailable',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'enswhite-payment-view-')),store=createLaunchStore(directory),tokens=[store.visitor(),store.visitor()];
 for(const [index,token]of tokens.entries()){
  const label='company-'+index,job=store.create(token,{name:label,description:'Saved receipt fixture',label}),tenant=join(directory,label);mkdirSync(tenant);const db=new DatabaseSync(join(tenant,'payments.sqlite'));
  db.exec('CREATE TABLE company_orders(id TEXT PRIMARY KEY,amount INTEGER,units TEXT);CREATE TABLE company_jobs(id TEXT PRIMARY KEY,state TEXT,hash TEXT)');
  db.prepare('INSERT INTO company_orders VALUES(?,?,?)').run('order_'+index,50000,'5000000');db.prepare('INSERT INTO company_jobs VALUES(?,?,?)').run('credit:order_'+index,'confirmed','0x'+String(index+1).repeat(64));db.close();
  const config=join(directory,label+'.json');writeFileSync(config,JSON.stringify({COMPANY_DATA_DIR:tenant,RELAY_COMPANY_ADDRESS:'0x'+String(index+1).repeat(40),FOUNDER_PASSWORD:'must-stay-private'}));store.db.prepare("UPDATE launches SET state='ready',config=? WHERE id=?").run(config,job.id);
 }
 let starts=0;const gateway=createLaunchGateway('http://localhost',{store,companyFactory:async()=>{starts++;throw new Error('RPC unavailable')},appFactory:()=>{throw new Error('must not initialize')}}),app=baseApp('http://localhost');app.use(gateway.app);
 const server=createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await gateway.close();rmSync(directory,{recursive:true,force:true})});
 const get=token=>new Promise((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port:server.address().port,path:'/company/api/payment-status',headers:{host:'localhost',...(token?{cookie:'enswhite_launch='+token}:{})}},res=>{let body='';res.on('data',x=>body+=x);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(body),cache:res.headers['cache-control']}))});req.on('error',reject);req.end()});
 assert.equal((await get()).status,401);for(const [index,token]of tokens.entries()){const result=await get(token);assert.equal(result.status,200);assert.equal(result.body.payments[0].orderId,'order_'+index);assert.equal(result.body.payments[0].state,'confirmed');assert.equal(result.cache,'no-store');assert(!JSON.stringify(result.body).includes('must-stay-private'))}assert.equal(starts,0);
});
