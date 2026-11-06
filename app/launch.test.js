import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLaunchStore} from './launch-store.js';
import {createProvisionSender} from './provision-sender.js';
import {Wallet,keccak256} from 'ethers';
import {createServer,request} from 'node:http';
import express from 'express';
import {createLaunchGateway} from './launch-server.js';
import {baseApp} from './http.js';

test('launches are isolated per visitor, idempotent, role-scoped and globally budgeted',t=>{
 const directory=mkdtempSync(join(tmpdir(),'enswhite-launch-')),store=createLaunchStore(directory);t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true})});
 const a=store.visitor(),b=store.visitor(),c=store.visitor(),input={name:'Candle shop',description:'Handmade candles',label:'candles'};
 const first=store.create(a,input);assert.equal(store.job(b),null);assert.equal(store.create(a,input).id,first.id);assert.throws(()=>store.create(a,{...input,label:'another'}),/One company/);assert.throws(()=>store.hire(a,['marketing']),/Finance/);store.hire(a,['finance','marketing']);assert.throws(()=>store.hire(a,['finance','support']),/already saved/);
 store.create(b,{...input,label:'second'});assert.throws(()=>store.create(c,{...input,label:'third'}),/Daily operator/);assert(!JSON.stringify(store.job(a)).includes('raw'));
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
