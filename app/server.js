import express from 'express';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPayments, fail } from './payments.js';
import { mountX402 } from './x402.js';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), 'public');

export function createApp(payments, origin) {
  const app = express();
  const sessionCookie = 'agent_session' + (new URL(origin).port ? '_' + new URL(origin).port : '');
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' https://checkout.razorpay.com; frame-src https://*.razorpay.com; connect-src 'self' https://*.razorpay.com; img-src 'self' data: https://*.razorpay.com; style-src 'self' 'unsafe-inline'",
    });
    // Bound to loopback by default. Reject DNS rebinding and cross-site session creation.
    if (req.get('host') !== new URL(origin).host) return res.status(403).json({ error: 'Unrecognized host' });
    if (req.get('sec-fetch-site') === 'cross-site' && req.path !== '/api/webhooks/razorpay') return res.status(403).json({ error: 'Cross-site request blocked' });
    next();
  });
  app.post('/api/webhooks/razorpay', express.raw({ type: 'application/json', limit: '128kb' }), async (req, res) => {
    if (payments.gateway.mode !== 'razorpay') throw fail('Razorpay webhooks are disabled in local simulation', 403);
    if (!Buffer.isBuffer(req.body)) throw fail('Expected application/json');
    const result = await payments.capture(req.body, req.get('x-razorpay-signature'));
    void payments.processJobs().catch(() => {});
    res.json(result);
  });
  app.use(express.json({ limit: '16kb' }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'GET' && req.get('origin') !== origin) return res.status(403).json({ error: 'Invalid request origin' });
    // A browser session is an opaque, unguessable capability for exactly one agent wallet.
    const cookie = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(sessionCookie + '='))?.slice(sessionCookie.length + 1);
    const { user, token } = payments.session(cookie);
    if (token) res.setHeader('Set-Cookie', `${sessionCookie}=${token}; Path=/; HttpOnly; SameSite=Strict${origin.startsWith('https:') ? '; Secure' : ''}`);
    req.user = user;
    next();
  });
  app.get('/api/state', async (req, res) => res.json(await payments.state(req.user)));
  app.post('/api/orders', async (req, res) => res.json(await payments.order(req.user)));
  app.post('/api/simulate', async (req, res) => {
    const result = await payments.simulate(req.user, req.body.orderId);
    await payments.processJobs();
    res.json(result);
  });
  app.post('/api/funding/:id/retry', async (req, res) => {
    await payments.retry(req.user, req.params.id);
    void payments.processJobs().catch(() => {});
    res.json({ accepted: true });
  });
  app.post('/api/purchases', async (req, res) => {
    const purchase = await payments.buy(req.user, req.get('idempotency-key'));
    await payments.processJobs();
    res.json(payments.result(req.user.id, purchase.id));
  });
  app.get('/api/purchases/:id', (req, res) => res.json(payments.result(req.user.id, req.params.id)));
  mountX402(app, payments, origin);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found' }));
  app.use(express.static(publicDir, { index: 'index.html' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
    res.status(status).json({ error: status < 500 || status === 502 ? error.message : 'Request failed. Check configuration and try again.' });
  });
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const origin = process.env.APP_ORIGIN || `http://localhost:${port}`;
  const payments = await createPayments({ directory: resolve(process.env.DATA_DIR || 'data') });
  const server = createApp(payments, origin).listen(port, '127.0.0.1', () => {
    console.log(`Agent payments: ${origin}\nFiat: ${payments.gateway.mode}; chain: ${payments.chain.mode}. Test/demo use only.\nx402 v2: exact USDT payments on eip155:1874; app-operated facilitator.`);
  });
  const timer = setInterval(() => { void payments.processJobs().catch(() => {}); }, 15_000);
  timer.unref();
  void payments.processJobs().catch(() => {});
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    clearInterval(timer);
    server.close(async () => { await payments.close(); });
  });
}
