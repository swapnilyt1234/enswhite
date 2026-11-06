import express from 'express';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCompany, COMPANY_SCHEME } from './company.js';
import { baseApp, sessionRoutes } from './http.js';
import { NETWORK } from './chain.js';
import { campaignKitHTML } from './campaign-kit.js';
import { vendorHTML } from './vendor-page.js';

export function createCompanyApp(company, origin, { guest = false } = {}) {
  const app = baseApp(origin);
  app.post('/api/webhooks/razorpay', express.raw({ type: 'application/json', limit: '128kb' }), async (req, res) => {
    if (company.gateway.mode !== 'razorpay' || !Buffer.isBuffer(req.body)) return res.status(403).json({ error: 'Razorpay webhook not enabled' });
    const result = await company.capture(req.body, req.get('x-razorpay-signature'));
    void company.processJobs().catch(() => {}); res.json(result);
  });
  sessionRoutes(app, company, origin, { login: !guest, guest });
  app.get('/api/state', async (req, res) => res.json(await company.state()));
  app.get('/api/agent-runs',(req,res)=>res.json(company.agentStore.runs()));
  app.get('/api/agent-runs/:id',(req,res)=>res.json(company.agentHistory(req.params.id)));
  app.post('/api/agent-runs/:id/retry',(req,res)=>{const result=company.retryAgent(req.params.id);void company.processJobs().catch(()=>{});res.json(result)});
  app.post('/api/finance/proposal',(req,res)=>{company.requestFinanceProposal().then(result=>{void company.processJobs().catch(()=>{});res.status(202).json(result)}).catch(error=>res.status(error.status||500).json({error:'Finance proposal could not start.'}))});
  app.post('/api/founder-questions/:id', (req,res)=>{const result=company.answerFounder(req.params.id,req.body.answer);void company.processJobs().catch(()=>{});res.json(result)});
  app.post('/api/reviews/employees',async(req,res)=>{const {mission,department,score,comment}=req.body||{};res.status(202).json(await company.review('employee',mission,department,'founder',score,comment));void company.processJobs().catch(()=>{})});
  app.post('/api/business',(req,res)=>res.json(company.updateBusiness(req.body)));
  app.get('/api/kits/:id',(req,res)=>res.json(company.kit(req.params.id)));
  app.get('/api/kits/:id/download',(req,res)=>res.type('html').set('Content-Disposition','attachment; filename="enswhite-campaign-kit.html"').send(campaignKitHTML(company.kit(req.params.id))));
  app.get('/api/activity/stream',(req,res)=>{
    let cursor=Number(req.get('last-event-id')||req.query.after||0);
    if(!Number.isSafeInteger(cursor)||cursor<0)return res.status(400).json({error:'Invalid activity cursor'});
    res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform',Connection:'keep-alive','X-Accel-Buffering':'no'});res.flushHeaders();
    const send=event=>{if(res.destroyed||event.id<=cursor)return;if(res.writableLength>262144){res.destroy();return}cursor=event.id;res.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`)};
    const unsubscribe=company.activity.subscribe(send);
    while(!res.destroyed){const rows=company.activity.since(cursor);rows.forEach(send);if(rows.length<200)break}
    const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),15000);heartbeat.unref();
    req.on('close',()=>{clearInterval(heartbeat);unsubscribe()});
  });
  app.get('/api/vendors/:id/earnings',async(req,res)=>res.json(await company.vendorEarnings(req.params.id)));
  app.post('/api/ens/manage',async(req,res)=>{if(!req.body||Object.keys(req.body).some(x=>!['action','label','term'].includes(x)))return res.status(400).json({error:'Invalid employee request'});res.status(202).json(await company.manageENS(req.body.action,req.body.label,req.body.term,req.get('idempotency-key')))});
  app.post('/api/ens/signup',async(req,res)=>res.json(await company.signupENS(req.body.label)));
  app.post('/api/ens/budget',async(req,res)=>res.json(company.updateENSBudget(req.body.label,req.body.amount,req.get('idempotency-key'))));
  app.post('/api/orders', async (req, res) => res.json(await company.order()));
  app.post('/api/simulate', async (req, res) => { const result = await company.simulate(req.body.orderId); await company.processJobs(); res.json(result); });
  app.post('/api/allocate', async (req, res) => { const result = await company.allocate(req.body.proposalId);void company.processJobs().catch(()=>{});res.json(result); });
  app.post('/api/missions', async (req, res) => { const result = await company.mission(req.body.title, req.get('idempotency-key'));void company.processJobs().catch(()=>{});res.status(202).json(result); });
  app.post('/api/approvals/:id', async (req, res) => { company.approve(req.params.id, req.body.approved); await company.processJobs(); res.json({ accepted: true }); });
  app.get('/api/books.csv', async (req, res) => res.type('csv').set('Content-Disposition', 'attachment; filename="enswhite-books.csv"').send(await company.csv()));
  app.get('/api/x402/supported', (req, res) => res.json({ kinds: [{ x402Version: 2, scheme: COMPANY_SCHEME, network: NETWORK }], extensions: [], signers: { [NETWORK]: [company.chain.relayerAddress] } }));
  app.post('/api/x402/verify', async (req, res) => {
    try { await company.verify(req.body.paymentPayload); res.json({ isValid: true, payer: req.body.paymentPayload.payload.authorization.from }); }
    catch { res.json({ isValid: false, invalidReason: 'policy_signature_or_approval_rejected' }); }
  });
  app.post('/api/x402/settle', async (req, res) => res.json(await company.settle(req.body.paymentPayload)));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found' }));
  app.get('/kit/:id',(req,res)=>res.sendFile(join(dirname(fileURLToPath(import.meta.url)),'company-public/kit.html')));
  app.get('/vendors/:id',(req,res)=>{const vendor=company.vendors.find(v=>v.id===req.params.id);if(!vendor)return res.sendStatus(404);res.type('html').send(vendorHTML(vendor,{endpoint:`../api/vendors/${vendor.id}/earnings`,script:'../vendor-ui.js',ensName:vendor.ensName,mode:company.chain.mode}))});
  app.use(express.static(join(dirname(fileURLToPath(import.meta.url)), 'company-public')));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if(['TIMEOUT','NETWORK_ERROR','ECONNRESET','ETIMEDOUT'].includes(error.code))return res.status(503).json({error:'A live chain connection timed out before this request completed. Your saved proposal and confirmed credit are retained. Retry the same action; do not repeat checkout.'});
    const status = error.status || 500;
    res.status(status).json({ error: status < 500 ? error.message : 'Request paused. Check vendor services and signer configuration; retrying the same mission does not duplicate existing orders.' });
  });
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 3003), origin = (process.env.APP_ORIGIN || `http://localhost:${port}`).trim();
  const company = await createCompany();
  const launch=process.env.ENS_ENABLED==='true'?(await import('./launch-server.js')).createLaunchGateway(origin,{appFactory:createCompanyApp}):null;
  const root=baseApp(origin);if(launch)root.use(launch.app);root.use(createCompanyApp(company,origin));root.use((error,req,res,next)=>res.status(error.status||500).json({error:error.status<500?error.message:'Company setup or RPC is unavailable; saved work is retained.'}));
  const server = root.listen(port, '127.0.0.1', () => console.log(`EnsWhite agent company: ${origin}\n${company.chain.mode} · custom x402 enswhite-receive · three departments, three independent vendors`));
  const timer = setInterval(() => { void company.processJobs().catch(() => {}); }, 5000); timer.unref();
  void company.processJobs().catch(() => {});
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { clearInterval(timer); server.close(async () => { await launch?.close();await company.close(); }); });
}
