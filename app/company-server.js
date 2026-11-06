import express from 'express';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCompany, COMPANY_SCHEME } from './company.js';
import { baseApp, sessionRoutes } from './http.js';
import { NETWORK } from './chain.js';

export function createCompanyApp(company, origin) {
  const app = baseApp(origin);
  app.post('/api/webhooks/razorpay', express.raw({ type: 'application/json', limit: '128kb' }), async (req, res) => {
    if (company.gateway.mode !== 'razorpay' || !Buffer.isBuffer(req.body)) return res.status(403).json({ error: 'Razorpay webhook not enabled' });
    const result = await company.capture(req.body, req.get('x-razorpay-signature'));
    void company.processJobs().catch(() => {}); res.json(result);
  });
  sessionRoutes(app, company, origin, { login: true });
  app.get('/api/state', async (req, res) => res.json(await company.state()));
  app.post('/api/orders', async (req, res) => res.json(await company.order()));
  app.post('/api/simulate', async (req, res) => { const result = await company.simulate(req.body.orderId); await company.processJobs(); res.json(result); });
  app.post('/api/allocate', async (req, res) => { const result = await company.allocate(); await company.processJobs(); res.json(result); });
  app.post('/api/missions', async (req, res) => { const result = await company.mission(req.body.title, req.get('idempotency-key')); await company.processJobs(); res.json(result); });
  app.post('/api/approvals/:id', async (req, res) => { company.approve(req.params.id, req.body.approved); await company.processJobs(); res.json({ accepted: true }); });
  app.get('/api/books.csv', async (req, res) => res.type('csv').set('Content-Disposition', 'attachment; filename="relay-books.csv"').send(await company.csv()));
  app.get('/api/x402/supported', (req, res) => res.json({ kinds: [{ x402Version: 2, scheme: COMPANY_SCHEME, network: NETWORK }], extensions: [], signers: { [NETWORK]: [company.chain.relayerAddress] } }));
  app.post('/api/x402/verify', async (req, res) => {
    try { await company.verify(req.body.paymentPayload); res.json({ isValid: true, payer: req.body.paymentPayload.payload.authorization.from }); }
    catch { res.json({ isValid: false, invalidReason: 'policy_signature_or_approval_rejected' }); }
  });
  app.post('/api/x402/settle', async (req, res) => res.json(await company.settle(req.body.paymentPayload)));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found' }));
  app.use(express.static(join(dirname(fileURLToPath(import.meta.url)), 'company-public')));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status || 500;
    res.status(status).json({ error: status < 500 ? error.message : 'Request paused. Check vendor services and signer configuration; retrying the same mission does not duplicate existing orders.' });
  });
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 3003), origin = (process.env.APP_ORIGIN || `http://localhost:${port}`).trim();
  const company = await createCompany();
  const server = createCompanyApp(company, origin).listen(port, '127.0.0.1', () => console.log(`Relay agent company: ${origin}\n${company.chain.mode} · custom x402 relay-receive · three departments, three independent vendors`));
  const timer = setInterval(() => { void company.processJobs().catch(() => {}); }, 5000); timer.unref();
  void company.processJobs().catch(() => {});
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { clearInterval(timer); server.close(async () => { await company.close(); }); });
}
