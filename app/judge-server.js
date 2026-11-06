import express from 'express';
import { createServer, request as httpRequest } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { baseApp } from './http.js';
import { createCompany } from './company.js';
import { createCompanyApp } from './company-server.js';
import { createVendor } from './vendor-server.js';
import { VENDORS } from './company-store.js';
import { createLiveProof } from './live-proof.js';

async function guestWorkspace(origin){
  const root=mkdtempSync(join(tmpdir(),'enswhite-guest-')),vendors=[],urls=new Map();let company;
  // Deliberately construct the environment; never spread process.env into guest services.
  const env={CHAIN_MODE:'simulated',PAYMENT_MODE:'simulated',AGENT_MODE:'offline',GUEST_MODE:'true',COMPANY_DATA_DIR:join(root,'company'),VENDOR_DATA_DIR:join(root,'vendors')};
  async function close(){if(company)await company.close();for(const {server,vendor} of vendors){await new Promise(r=>server.close(r));vendor.close()}rmSync(root,{recursive:true,force:true})}
  try{
    for(const v of VENDORS){const vendor=await createVendor(v.id,env),server=createServer(vendor.app);vendors.push({vendor,server});await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r)});urls.set(`http://127.0.0.1:${v.port}`,`http://127.0.0.1:${server.address().port}`)}
    company=await createCompany({env,vendorFetch:(url,init)=>{const u=new URL(url),target=urls.get(u.origin);if(!target)throw new Error('Unknown guest vendor');return fetch(target+u.pathname,init)}});
    return {app:createCompanyApp(company,origin,{guest:true}),company,close};
  }catch(error){await close();throw error}
}

export function createJudgeApp({origin,owner=false,proof=createLiveProof(),workspace=guestWorkspace,ownerRequest=httpRequest}={}){
  const app=baseApp(origin),sessions=new Map(),attempts=new Map();let creating=0;
  const publicDir=join(dirname(fileURLToPath(import.meta.url)),'judge-public');
  app.post('/guest/start',express.json({limit:'1kb'}),async(req,res)=>{
    if(req.get('origin')!==origin)return res.status(403).json({error:'Invalid origin'});
    const ip=req.socket.remoteAddress,history=(attempts.get(ip)||[]).filter(t=>t>Date.now()-3600000);
    if(history.length>=6||sessions.size+creating>=12)return res.status(429).json({error:'Guest demo is at capacity. Please retry later.'});
    history.push(Date.now());attempts.set(ip,history);creating++;
    try{const space=await workspace(origin),id=randomBytes(32).toString('hex');sessions.set(id,{...space,created:Date.now(),requests:[],responses:new Set()});res.setHeader('Set-Cookie',`enswhite_guest=${id}; Path=/guest; HttpOnly; SameSite=Strict; Max-Age=3600${origin.startsWith('https:')?'; Secure':''}`);res.json({url:'/guest/'})}finally{creating--}
  });
  app.use('/guest',(req,res,next)=>{
    const id=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('enswhite_guest='))?.slice(15),space=sessions.get(id);
    if(!space||space.created<Date.now()-3600000)return req.path.startsWith('/api/')?res.status(401).json({error:'Guest session expired. Return to the public home page to start again.'}):res.redirect('/');
    space.responses.add(res);res.on('close',()=>space.responses.delete(res));space.requests=space.requests.filter(t=>t>Date.now()-60000);
    if(req.method!=='GET'){if(space.requests.length>=30)return res.status(429).json({error:'Please wait before making more changes.'});space.requests.push(Date.now())}
    space.app(req,res,next);
  });
  app.get('/proof/api',async(req,res)=>{try{res.set('Cache-Control','no-store').json(await proof.read())}catch{res.status(503).json({error:'Live RPC data is unavailable. No cached values are being presented as live; retry shortly.'})}});
  app.get(['/proof','/proof/'],(req,res)=>res.sendFile(join(publicDir,'proof.html')));
  app.get('/vendors/:id',(req,res)=>VENDORS.some(x=>x.id===req.params.id)?res.sendFile(join(publicDir,'vendor.html')):res.sendStatus(404));
  app.get('/agents/:id',(req,res)=>['marketing','support','finance'].includes(req.params.id)?res.sendFile(join(publicDir,'agent.html')):res.sendStatus(404));
  app.get('/agents/:id/registration',async(req,res)=>{try{const data=await proof.read(),agent=data.team.find(x=>x.name.split('.')[0]===req.params.id);if(!agent)return res.status(404).json({error:'No active ENS employee'});if(!agent.discovery?.binding?.verified)return res.status(409).json({error:'Agent registration is not verified on ENS and ERC-8004'});res.json(agent.discovery.binding.registration)}catch{res.status(503).json({error:'Live identity data unavailable'})}});
  if(owner){
    // Fixed upstream only. Keep raw webhook bytes and SSE streams intact.
    const proxy=(req,res)=>{const upstream=ownerRequest({hostname:'127.0.0.1',port:3004,path:req.url,method:req.method,headers:{...req.headers,host:new URL(origin).host}},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res)});upstream.on('error',()=>{if(!res.headersSent)res.status(502).json({error:'Founder service unavailable'});else res.destroy()});req.on('aborted',()=>upstream.destroy());res.on('close',()=>upstream.destroy());req.pipe(upstream)};
    app.post('/api/webhooks/razorpay',proxy);
    app.get(/^\/owner$/,(req,res)=>res.redirect('/owner/'));
    app.use('/owner',proxy);
  }
  app.use(express.static(publicDir));
  app.use((error,req,res,next)=>{if(res.headersSent)return next(error);res.status(error.status||500).json({error:'Public demo temporarily unavailable. Please retry.'})});
  const dispose=async space=>{for(const res of space.responses)res.end();await space.close()};
  const timer=setInterval(()=>{for(const [id,s] of sessions){if(s.created<Date.now()-3600000){sessions.delete(id);void dispose(s)}}for(const [ip,times] of attempts)if(times.every(t=>t<Date.now()-3600000))attempts.delete(ip)},60000);timer.unref();
  return {app,async close(){clearInterval(timer);await Promise.all([...sessions.values()].map(dispose));proof.close()}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const origin=(process.env.APP_ORIGIN||'http://localhost:3006').trim(),judge=createJudgeApp({origin,owner:process.env.OWNER_PROXY==='true'});
  const server=judge.app.listen(3006,process.env.PUBLIC_BIND||'127.0.0.1',()=>console.log(`Public demo: ${origin}/guest/ · Live Proof: ${origin}/proof/\nForward the public HTTPS tunnel to port 3006. Founder access: ${origin}/owner/`));
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.close();void judge.close().finally(()=>server.closeAllConnections())});
}
