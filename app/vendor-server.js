import express from 'express';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { openStore, digest, fail } from './payments.js';
import { walletStore, VENDORS } from './company-store.js';
import { inspectToken, TOKEN, NETWORK } from './chain.js';
import { companyInterface, readCompanyEvents } from './company-chain.js';
import { encodePayment, decodePayment } from './x402.js';
import { vendorWork } from './agents.js';

export async function createVendor(vendorId, env = process.env) {
  const info = VENDORS.find(v => v.id === vendorId);
  if (!info) throw new Error('Unknown vendor');
  const mode = env.CHAIN_MODE ?? 'simulated';
  if (!['simulated', 'testnet'].includes(mode)) throw new Error('Invalid chain mode');
  const { db, key } = openStore(resolve(env.VENDOR_DATA_DIR || `data/vendors/${mode}`, vendorId));
  db.exec('CREATE TABLE IF NOT EXISTS vendor_orders (id TEXT PRIMARY KEY,body_hash TEXT NOT NULL,result TEXT)');
  const wallet = walletStore(db, key)(vendorId, 'vendor');
  const company = env.RELAY_COMPANY_ADDRESS || '0x0000000000000000000000000000000000001874';
  const base = mode === 'testnet' ? await inspectToken(env.RPC_URL) : null;
  if (mode === 'testnet' && (!env.RELAY_COMPANY_ADDRESS || !Number.isSafeInteger(Number(env.COMPANY_DEPLOYMENT_BLOCK)) || Number(env.COMPANY_DEPLOYMENT_BLOCK) < 1)) throw new Error('Vendor needs company address and deployment block');
  async function events() {
    if (base) return readCompanyEvents(base.provider, company, Number(env.COMPANY_DEPLOYMENT_BLOCK), wallet.address);
    const path = resolve(env.COMPANY_DATA_DIR || `data/company/${mode}`, 'payments.sqlite');
    if (!existsSync(path)) return [];
    const chainDb = new DatabaseSync(path, { readOnly: true });
    try { return chainDb.prepare("SELECT data,hash,block FROM company_events WHERE kind='payment'").all().map(row => ({ ...JSON.parse(row.data), hash: row.hash, block: row.block })).filter(row => row.vendor.toLowerCase() === wallet.address.toLowerCase()); }
    catch { return []; } finally { chainDb.close(); }
  }
  async function paid(body, txHash) {
    if (!/^0x[a-f0-9]{64}$/i.test(txHash ?? '')) return false;
    if (!base) return (await events()).some(row => row.requestId === body.requestId && row.dept.toLowerCase() === body.dept.toLowerCase() && row.hash === txHash && row.amount === info.price);
    const receipt = await base.provider.getTransactionReceipt(txHash);
    if (receipt?.status !== 1) return false;
    return receipt.logs.some(log => {
      if (log.address.toLowerCase() !== company.toLowerCase()) return false;
      try { const event = companyInterface.parseLog(log); return event?.name === 'Paid' && event.args.requestId === body.requestId && event.args.vendor.toLowerCase() === wallet.address.toLowerCase() && event.args.dept.toLowerCase() === body.dept.toLowerCase() && event.args.amount === BigInt(info.price); } catch { return false; }
    });
  }
  const app = express(); app.disable('x-powered-by'); app.use(express.json({ limit: '12kb' }));
  app.get('/api/info', (req, res) => res.json({ ...info, address: wallet.address, chainMode: mode, company, scheme: 'relay-receive' }));
  app.get('/api/earnings', async (req, res) => {
    const receipts = await events();
    res.json({ vendor: info.name, address: wallet.address, mode, netUnits: receipts.reduce((sum, row) => sum + BigInt(row.amount) - BigInt(row.fee), 0n).toString(), receipts });
  });
  app.get('/', (req, res) => res.type('html').send(`<!doctype html><html lang="en"><meta charset="utf-8"><title>${info.name} · Vendor earnings</title><body style="font:16px system-ui;max-width:800px;margin:60px auto;background:#f7f8f2;color:#193d31"><h1>${info.name}</h1><p>${info.service} · Independent vendor · ${mode}</p><code>${wallet.address}</code><p>Earnings below are read independently from ${mode === 'testnet' ? 'RelayCompany Paid events on Whitechain' : 'the local simulated ledger'}.</p><pre id="earnings">Loading…</pre><script>fetch('/api/earnings').then(r=>r.json()).then(r=>document.getElementById('earnings').textContent=JSON.stringify(r,null,2))</script></body></html>`));
  // A vendor unlocks delivery only after independently finding its own Paid receipt.
  app.post('/work', async (req, res, next) => {
    const body = req.body;
    if (!body || !/^0x[a-f0-9]{64}$/i.test(body.requestId ?? '') || !/^0x[a-f0-9]{40}$/i.test(body.dept ?? '') || typeof body.task !== 'string' || !body.task.trim() || body.task.length > 2000) throw fail('Invalid task');
    const hash = digest(JSON.stringify({ task: body.task, dept: body.dept }));
    const order = db.prepare('SELECT * FROM vendor_orders WHERE id=?').get(body.requestId);
    if (order && order.body_hash !== hash) throw fail('Request ID is bound to a different task');
    const count = db.prepare('SELECT COUNT(*) n FROM vendor_orders').get().n;
    if (!order && count >= 1000) throw fail('Vendor demo order limit reached', 429);
    db.prepare('INSERT OR IGNORE INTO vendor_orders VALUES(?,?,NULL)').run(body.requestId, hash);
    const requirement = { x402Version: 2, resource: { url: `http://localhost:${info.port}/work`, description: info.service, mimeType: 'application/json' }, accepts: [{ scheme: 'relay-receive', network: NETWORK, amount: info.price, asset: TOKEN, payTo: company, maxTimeoutSeconds: 300, extra: { name: 'Tether USD', version: '1', vendor: wallet.address, requestId: body.requestId } }] };
    let payment; try { payment = req.get('payment-response') ? decodePayment(req.get('payment-response')) : null; } catch {}
    if (!payment?.success || !(await paid(body, payment.transaction))) return res.status(402).set('PAYMENT-REQUIRED', encodePayment(requirement)).json({ error: 'Confirmed vendor payment required' });
    next();
  }, async (req, res) => {
    const order = db.prepare('SELECT result FROM vendor_orders WHERE id=?').get(req.body.requestId);
    const result = order.result ? JSON.parse(order.result) : await vendorWork(vendorId, req.body.task, env);
    if (!order.result) db.prepare('UPDATE vendor_orders SET result=? WHERE id=?').run(JSON.stringify(result), req.body.requestId);
    res.json({ vendor: info.name, requestId: req.body.requestId, ...result });
  });
  app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.status ? error.message : 'Vendor could not verify or deliver; retry the same order' }));
  return { app, info: { ...info, address: wallet.address }, close() { base?.provider.destroy(); db.close(); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const vendor = await createVendor(process.argv[2]);
  const server = vendor.app.listen(vendor.info.port, '127.0.0.1', () => console.log(`${vendor.info.name}: http://localhost:${vendor.info.port} · ${vendor.info.address}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => vendor.close()));
}
