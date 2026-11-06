import express from 'express';

export function baseApp(origin) {
  const app = express(); app.disable('x-powered-by');
  const expected = new URL(origin);
  if (!['http:', 'https:'].includes(expected.protocol) || expected.pathname !== '/' || expected.search || expected.hash || expected.username || expected.password) throw new Error('APP_ORIGIN must be an HTTP(S) origin without a path');
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' https://checkout.razorpay.com; frame-src https://*.razorpay.com; connect-src 'self' https://*.razorpay.com; img-src 'self' data: blob: https://*.razorpay.com; style-src 'self' 'unsafe-inline'" });
    if (req.get('host') !== expected.host) return res.status(403).json({ error: 'Unrecognized host' });
    if (req.get('sec-fetch-site') === 'cross-site' && req.path !== '/api/webhooks/razorpay') return res.status(403).json({ error: 'Cross-site request blocked' });
    next();
  });
  return app;
}

export function sessionRoutes(app, service, origin, { login = false } = {}) {
  const cookieName = 'relay_company' + (new URL(origin).port ? '_' + new URL(origin).port : '');
  app.use(express.json({ limit: '16kb' }));
  const cookie = req => req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  const set = (res, token) => { if (token) res.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict${origin.startsWith('https:') ? '; Secure' : ''}`); };
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'GET' && req.get('origin') !== origin) return res.status(403).json({ error: 'Invalid request origin' });
    next();
  });
  if (login) {
    let attempts = [];
    app.post('/api/login', (req, res) => {
      attempts = attempts.filter(time => time > Date.now()-60000);
      if (attempts.length >= 8) return res.status(429).json({ error: 'Too many sign-in attempts. Wait one minute.' });
      attempts.push(Date.now());
      const session = service.session(cookie(req), req.body.password); set(res, session.token); res.json({ signedIn: true });
    });
  }
  app.use('/api', (req, res, next) => { const session = service.session(cookie(req)); set(res, session.token); req.user = session.user; next(); });
}
