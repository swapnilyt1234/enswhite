import express from 'express';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createLaunchStore} from './launch-store.js';
import {createCompany} from './company.js';

export function createLaunchGateway(origin,{store=createLaunchStore(),companyFactory=createCompany,appFactory}={}){
 const app=express.Router(),router=express.Router(),active=new Map(),starting=new Map();
 const cookie=req=>req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('enswhite_launch='))?.slice('enswhite_launch='.length);
 const secure=origin.startsWith('https:')?'; Secure':'';
 router.use(express.json({limit:'4kb'}));
 router.use((req,res,next)=>{res.set('Cache-Control','no-store');if(req.method!=='GET'&&req.get('origin')!==origin)return res.status(403).json({error:'Invalid origin'});next()});
 router.post('/api/session',(req,res)=>{const token=store.visitor(cookie(req));res.setHeader('Set-Cookie',`enswhite_launch=${token}; Path=/; HttpOnly; SameSite=Strict${secure}`);res.json({started:true})});
 router.get('/api/state',(req,res)=>res.json({job:cookie(req)?store.job(cookie(req)):null,operatorReady:store.ready(),policy:{companiesPerDay:2,missionsPerCompany:5,fiat:'Razorpay test mode; no real conversion'}}));
 router.post('/api/business',(req,res)=>res.status(202).json(store.create(cookie(req)||'',req.body)));
 router.post('/api/hire',(req,res)=>res.status(202).json(store.hire(cookie(req)||'',req.body.roles)));
 router.get('/profiles/:id/:label',async(req,res)=>{const row=store.db.prepare("SELECT config FROM launches WHERE id=? AND state='ready'").get(req.params.id);if(!row)return res.sendStatus(404);const config=JSON.parse(await readFile(row.config,'utf8')),entries=JSON.parse(await readFile(config.ENS_IDENTITY_FILE,'utf8')),entry=entries.find(x=>x.label===req.params.label);entry?res.json(entry.registration):res.sendStatus(404)});
 router.use(express.static(resolve('app/launch-public')));app.use('/launch',router);
 async function workspace(job){
  if(active.has(job.id))return active.get(job.id);
  if(starting.has(job.id))return starting.get(job.id);
  const promise=(async()=>{
   const row=store.db.prepare("SELECT config FROM launches WHERE id=? AND state='ready'").get(job.id);if(!row)throw Object.assign(new Error('Company setup is not complete'),{status:409});
   const config=JSON.parse(await readFile(row.config,'utf8')),company=await companyFactory({env:{...process.env,...config,APP_ORIGIN:origin}});
   const session=company.session(undefined,config.FOUNDER_PASSWORD),entry={company,app:appFactory(company,origin),token:session.token};active.set(job.id,entry);return entry;
  })().finally(()=>starting.delete(job.id));starting.set(job.id,promise);return promise;
 }
 app.use('/company',async(req,res,next)=>{
  try{
   const job=cookie(req)&&store.job(cookie(req));if(!job)return res.status(401).json({error:'Start your company at /launch/'});
   const entry=await workspace(job),name='relay_company'+(new URL(origin).port?'_'+new URL(origin).port:'');
   // The visitor cookie selects one workspace; its internal founder session never leaves this process.
   req.headers.cookie=(req.headers.cookie||'').split(';').filter(x=>!x.trim().startsWith(name+'=')).join(';')+`; ${name}=${entry.token}`;
   entry.app(req,res,next);
  }catch(error){next(error)}
 });
 app.post('/api/webhooks/razorpay',express.raw({type:'application/json',limit:'128kb'}),async(req,res,next)=>{
  try{
   const payload=JSON.parse(req.body.toString()),order=payload.payload?.payment?.entity?.order_id;
   if(typeof order!=='string')return next();
   // Only a locally-created order selects a tenant. capture still verifies the signature and Razorpay API.
   for(const row of store.db.prepare("SELECT id,config FROM launches WHERE state='ready'").all()){
    const config=JSON.parse(await readFile(row.config,'utf8'));
    const {DatabaseSync}=await import('node:sqlite'),db=new DatabaseSync(join(config.COMPANY_DATA_DIR,'payments.sqlite'),{readOnly:true});let matches;
    try{matches=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='company_orders'").get()&&db.prepare('SELECT id FROM company_orders WHERE id=?').get(order)}finally{db.close()}
    if(!matches)continue;
    const {company}=await workspace(row);await company.capture(req.body,req.get('x-razorpay-signature'));void company.processJobs().catch(()=>{});return res.json({accepted:true});
   }
   next();
  }catch(error){next(error)}
 });
 const timer=setInterval(()=>{for(const {company}of active.values())void company.processJobs().catch(()=>{})},5000);timer.unref();
 return{app,async close(){clearInterval(timer);await Promise.allSettled(starting.values());await Promise.all([...active.values()].map(x=>x.company.close()));store.close()}};
}
