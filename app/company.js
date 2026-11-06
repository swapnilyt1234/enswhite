import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { keccak256, toUtf8Bytes, formatUnits, verifyTypedData } from 'ethers';
import { openStore, createGateway, webhookSignature, digest, fail } from './payments.js';
import { DEPARTMENTS, VENDORS, walletStore } from './company-store.js';
import { createSimulatedCompanyChain, createRealCompanyChain, RECEIVE_TYPES, TOP_UP_TYPES, ALLOCATE_TYPES, boundNonce } from './company-chain.js';
import { planMission } from './agents.js';
import { decodePayment, encodePayment } from './x402.js';
import { NETWORK, TOKEN, EXPLORER } from './chain.js';

export const COMPANY_SCHEME = 'relay-receive';
const now = () => Math.floor(Date.now()/1000);
const week = () => Math.floor(Date.now()/604800000);
const publicError = 'Operation paused. Check contract setup, gas tank, pool funding or vendor availability; the saved transaction is retained.';

export async function createCompany({ env = process.env, directory = resolve(env.COMPANY_DATA_DIR || `data/company/${env.CHAIN_MODE ?? 'simulated'}`), vendorFetch = fetch, chainFactory } = {}) {
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
  const fingerprint = `${mode}:${env.PAYMENT_MODE ?? 'simulated'}:${env.RELAY_COMPANY_ADDRESS ?? 'local'}`;
  const old = db.prepare("SELECT value FROM settings WHERE key='company_config'").get();
  if (old && old.value !== fingerprint) { db.close(); throw new Error('Use a new COMPANY_DATA_DIR when changing chain, payment mode or company address'); }
  const getWallet = walletStore(db, key);
  const departments = DEPARTMENTS.map(dept => ({ ...dept, address: getWallet(dept.id, 'department').address }));
  let chain;
  try {
    const vendors = [];
    for (const expected of VENDORS) {
      const url = `http://127.0.0.1:${expected.port}`;
      const response = await vendorFetch(url + '/api/info', { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`Start ${expected.name} before the company server`);
      const info = await response.json();
      if (info.id !== expected.id || info.price !== expected.price || info.chainMode !== mode || !/^0x[a-f0-9]{40}$/i.test(info.address ?? '')) throw new Error('Vendor configuration mismatch');
      vendors.push({ ...expected, address: info.address, url });
    }
    const simulatedAttester = mode === 'simulated' ? getWallet('attester', 'attester') : null;
    const config = { departments, vendors, financeAddress: departments.find(d => d.id === 'finance').address, attesterAddress: simulatedAttester?.address, relayerAddress: mode === 'simulated' ? getWallet('relayer','relayer').address : undefined };
    chain = chainFactory ? await chainFactory(db, config) : mode === 'simulated' ? createSimulatedCompanyChain(db, config) : await createRealCompanyChain(env, config);
    await chain.checkConfiguration();
    const attester = simulatedAttester ?? chain.attester;
    const gateway = createGateway(env, db);
    db.prepare('INSERT OR IGNORE INTO settings VALUES(?,?)').run('company_config', fingerprint);
    let running;
    const jobs = () => db.prepare('SELECT id,kind,state,hash,error,created_at FROM company_jobs ORDER BY created_at DESC').all();
    const enqueue = (id, kind, data) => db.prepare("INSERT OR IGNORE INTO company_jobs(id,kind,data,state,created_at) VALUES(?,?,?,'queued',?)").run(id, kind, JSON.stringify(data), now());
    async function receipts() { return (await chain.events()).filter(event => event.kind === 'payment'); }
    async function remaining(dept) {
      const balance = await chain.balance(dept.address);
      const reserved = db.prepare("SELECT amount FROM company_tasks WHERE dept=? AND state IN ('approval','queued','submitted')").all(dept.id).reduce((sum, row) => sum + BigInt(row.amount), 0n);
      return balance - reserved;
    }
    const service = {
      db, chain, departments, vendors, gateway,
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
        const snapshot = await chain.snapshot(), ledger = await receipts();
        const team = [];
        for (const dept of departments) {
          const own = ledger.filter(row => row.dept.toLowerCase() === dept.address.toLowerCase());
          team.push({ ...dept, balance: String(await chain.balance(dept.address)), remaining: String(await remaining(dept)), spent: own.reduce((sum, row) => sum + BigInt(row.amount), 0n).toString(), lastPurchase: own.at(-1) ?? null });
        }
        return { brand: 'Relay', mode, paymentMode: gateway.mode, scheme: COMPANY_SCHEME, company: chain.address, network: NETWORK, token: TOKEN,
          ...snapshot, team, vendors: vendors.map(v => ({ ...v, earningsUrl: `http://localhost:${v.port}/` })),
          tasks: db.prepare('SELECT * FROM company_tasks ORDER BY created_at DESC').all().map(row => ({ ...row, result: row.result ? JSON.parse(row.result) : null })),
          missions: db.prepare('SELECT * FROM company_missions ORDER BY created_at DESC').all(), ledger, jobs: jobs(),
          approvals: db.prepare('SELECT * FROM company_approvals ORDER BY created_at DESC').all(),
          topup: { inr: 500, usdt: '5', note: 'Fixed demo allocation. Fiat is simulated, not converted.' },
          relayer: chain.relayerAddress, explorer: mode === 'testnet' ? EXPLORER : null,
          finance: { proposal: 'Marketing 60% · Support 30% · Finance 10%, capped by weekly allocations.', flags: ledger.filter(row => BigInt(row.amount) > BigInt(departments.find(d => d.address.toLowerCase() === row.dept.toLowerCase())?.approval ?? '0')).map(row => ({ requestId: row.requestId, message: 'Above the department approval threshold; review the matching founder approval.' })) },
        };
      },
      async order() {
        if (db.prepare('SELECT COUNT(*) n FROM company_orders').get().n >= 100) throw fail('Demo order limit reached', 429);
        const order = await gateway.order(50_000);
        if (!/^order_[a-zA-Z0-9]+$/.test(order.id)) throw fail('Invalid payment-provider order');
        db.prepare('INSERT INTO company_orders VALUES(?,?,?)').run(order.id, 50_000, '5000000');
        return { id: order.id, amount: 50_000, currency: 'INR', keyId: gateway.keyId, mode: gateway.mode };
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
      async allocate() {
        const available = BigInt((await chain.snapshot()).companyBalance);
        const existing = db.prepare("SELECT data FROM company_jobs WHERE kind='allocation' AND state!='failed'").all().map(row => JSON.parse(row.data)).filter(row => row.week === week());
        let left = available;
        for (const dept of departments) {
          const allocated = existing.filter(row => row.dept === dept.address).reduce((sum, row) => sum + BigInt(row.amount), 0n);
          const maximum = BigInt(dept.weekly) - allocated;
          const proposed = available * BigInt(dept.share) / 100n;
          const amount = maximum < proposed ? maximum : proposed;
          if (amount > 0n && amount <= left) {
            const id = `allocation:${week()}:${dept.id}:${allocated}`;
            enqueue(id, 'allocation', { dept: dept.address, amount: String(amount), week: week() });
            left -= amount;
          }
        }
        return { accepted: true };
      },
      async mission(title, requestKey) {
        if (typeof title !== 'string' || title.trim().length < 5 || title.length > 600 || !/^[a-zA-Z0-9_-]{8,80}$/.test(requestKey ?? '')) throw fail('Enter a mission (5–600 characters) and an idempotency key');
        const old = db.prepare('SELECT * FROM company_missions WHERE request_key=?').get(requestKey);
        if (old && old.title !== title.trim()) throw fail('Idempotency key belongs to a different mission');
        if (!old && db.prepare('SELECT COUNT(*) n FROM company_missions').get().n >= 30) throw fail('Demo mission limit reached', 429);
        const id = old?.id ?? randomUUID();
        if (!old) db.prepare('INSERT INTO company_missions VALUES(?,?,?,?,?)').run(id, requestKey, title.trim(), 'planning', now());
        const plan = await planMission(title.trim(), env);
        db.prepare('UPDATE company_missions SET source=? WHERE id=?').run(plan.source, id);
        for (const task of plan.tasks) await service.buy(task.dept, task.vendor, task.task, id);
        return { id };
      },
      async buy(departmentId, vendorId, task, missionId) {
        const dept = departments.find(d => d.id === departmentId), vendor = vendors.find(v => v.id === vendorId && v.dept === departmentId);
        if (!dept || !vendor || typeof task !== 'string' || !task.trim() || task.length > 2000) throw fail('Department/vendor policy rejected');
        const id = keccak256(toUtf8Bytes(`${missionId}:${vendorId}`));
        if (db.prepare('SELECT id FROM company_tasks WHERE id=?').get(id)) return id;
        const body = { requestId: id, dept: dept.address, task };
        const response = await vendorFetch(vendor.url + '/work', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
        if (response.status !== 402) throw fail('Vendor did not return a payment challenge', 502);
        const required = decodePayment(response.headers.get('payment-required'));
        const quote = required.accepts?.[0];
        if (required.x402Version !== 2 || quote?.scheme !== COMPANY_SCHEME || quote.network !== NETWORK || quote.asset.toLowerCase() !== TOKEN.toLowerCase() || quote.payTo.toLowerCase() !== chain.address.toLowerCase() || quote.extra?.vendor?.toLowerCase() !== vendor.address.toLowerCase() || quote.extra?.requestId !== id || quote.amount !== vendor.price) throw fail('Vendor quote differs from the registered policy');
        const amount = BigInt(vendor.price);
        if (amount > BigInt(dept.perCall) || await remaining(dept) < amount) throw fail(`${dept.name} needs a sufficient allocation within its per-call limit`, 402);
        // Budget permission comes from deterministic code and contract limits, never model text.
        const sinceWeek = now() - now()%604800;
        const spentJobs = db.prepare("SELECT amount,state,created_at FROM company_tasks WHERE dept=? AND state NOT IN ('rejected','failed')").all(departmentId);
        const weekly = spentJobs.filter(row => row.created_at >= sinceWeek).reduce((sum, row) => sum + BigInt(row.amount), 0n);
        const daily = spentJobs.filter(row => Math.floor(row.created_at/86400) === Math.floor(now()/86400)).reduce((sum, row) => sum + BigInt(row.amount), 0n);
        if (weekly + amount > BigInt(dept.weekly) || daily + amount > BigInt(dept.perDay)) throw fail('Weekly or daily policy limit exceeded');
        const state = amount > BigInt(dept.approval) ? 'approval' : 'queued';
        db.prepare('INSERT INTO company_tasks VALUES(?,?,?,?,?,?,?,?,NULL,NULL,?)').run(id, missionId, dept.id, vendor.id, task, vendor.price, '0x' + randomBytes(32).toString('hex'), state, now());
        if (state === 'queued') enqueue(id, 'payment', { requestId: id });
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
      },
      async verify(payload) {
        const a = payload?.payload?.authorization;
        if (payload?.x402Version !== 2 || payload.accepted?.scheme !== COMPANY_SCHEME || payload.accepted.network !== NETWORK || typeof payload.payload?.requestId !== 'string') throw fail('Unsupported custom x402 payload');
        const task = db.prepare('SELECT * FROM company_tasks WHERE id=?').get(payload.payload.requestId);
        const dept = departments.find(d => d.id === task?.dept), vendor = vendors.find(v => v.id === task?.vendor);
        if (!task || !dept || !vendor || ['approval', 'rejected', 'failed'].includes(task.state)) throw fail('Policy or approval rejected');
        if (payload.accepted.amount !== task.amount || payload.accepted.asset?.toLowerCase() !== TOKEN.toLowerCase() || payload.accepted.payTo?.toLowerCase() !== chain.address.toLowerCase() || a?.nonce !== boundNonce(vendor.address, task.id, task.salt) || a.from !== dept.address || a.to !== chain.address || a.value !== task.amount) throw fail('Payment does not match the reserved order');
        if (verifyTypedData(chain.domain, RECEIVE_TYPES, a, payload.payload.signature) !== dept.address) throw fail('Invalid department signature');
        if (Number(a.validAfter) >= now() || Number(a.validBefore) <= now() || Number(a.validBefore) > now()+300) throw fail('Authorization expired or invalid');
        return { task, dept, vendor };
      },
      async processJobs() {
        if (running) return running;
        running = (async () => {
          for (const row of db.prepare("SELECT * FROM company_jobs WHERE state IN ('queued','submitted') ORDER BY created_at,rowid").all()) {
            try {
              let data = JSON.parse(row.data);
              if (!row.raw) {
                const submittedToday = db.prepare('SELECT COUNT(*) n FROM company_jobs WHERE raw IS NOT NULL AND created_at>=?').get(now()-now()%86400).n;
                if (submittedToday >= 120) throw new Error('Relayer daily transaction cap exceeded');
                if (row.kind === 'topup') {
                  data.deadline = String(now()+300);
                  data.signature = await attester.signTypedData(chain.companyDomain, TOP_UP_TYPES, { paymentId: data.paymentId, amount: data.amount, deadline: data.deadline });
                } else if (row.kind === 'allocation') {
                  data.nonce = await chain.allocationNonce(); data.deadline = String(now()+300);
                  data.signature = await getWallet('finance', 'department').signTypedData(chain.companyDomain, ALLOCATE_TYPES, { dept: data.dept, amount: data.amount, nonce: data.nonce, deadline: data.deadline });
                } else {
                  const task = db.prepare('SELECT * FROM company_tasks WHERE id=?').get(row.id);
                  const dept = departments.find(d => d.id === task.dept), vendor = vendors.find(v => v.id === task.vendor);
                  if (!['queued','submitted'].includes(task.state)) throw new Error('Task not approved');
                  const authorization = { from: dept.address, to: chain.address, value: task.amount, validAfter: String(now()-1), validBefore: String(now()+300), nonce: boundNonce(vendor.address, task.id, task.salt) };
                  const signature = await getWallet(dept.id, 'department').signTypedData(chain.domain, RECEIVE_TYPES, authorization);
                  const payload = { x402Version: 2, accepted: { scheme: COMPANY_SCHEME, network: NETWORK, amount: task.amount, asset: TOKEN, payTo: chain.address }, payload: { requestId: task.id, authorization, signature } };
                  await service.verify(payload);
                  data = { requestId: task.id, dept: dept.address, vendor: vendor.address, amount: task.amount, salt: task.salt, authorization, signature };
                }
                const tx = await chain.prepare(row.kind, data);
                db.prepare("UPDATE company_jobs SET data=?,raw=?,hash=?,state='submitted',error=NULL WHERE id=?").run(JSON.stringify(data), tx.raw, tx.hash, row.id);
                row.raw = tx.raw; row.hash = tx.hash;
                if (row.kind === 'payment') db.prepare("UPDATE company_tasks SET state='submitted' WHERE id=?").run(row.id);
              }
              const receipt = await chain.broadcast(row.raw, row.hash);
              db.prepare('UPDATE company_jobs SET state=?,error=? WHERE id=?').run(receipt.state, receipt.state === 'failed' ? 'Transaction reverted; no successful payment recorded' : null, row.id);
              if (row.kind === 'payment' && receipt.state !== 'submitted') db.prepare('UPDATE company_tasks SET state=?,error=? WHERE id=?').run(receipt.state, receipt.state === 'failed' ? 'Onchain policy rejected the payment' : null, row.id);
              if (receipt.state === 'submitted') break; // Keep Finance nonce and relayer transaction order deterministic.
            } catch {
              db.prepare('UPDATE company_jobs SET error=? WHERE id=?').run(publicError, row.id);
              break;
            }
          }
          for (const task of db.prepare("SELECT t.*,j.hash FROM company_tasks t JOIN company_jobs j ON j.id=t.id WHERE t.state='confirmed'").all()) {
            try {
              const vendor = vendors.find(v => v.id === task.vendor), dept = departments.find(d => d.id === task.dept);
              const response = await vendorFetch(vendor.url + '/work', { method: 'POST', signal: AbortSignal.timeout(12_000), headers: { 'Content-Type': 'application/json', 'PAYMENT-RESPONSE': encodePayment({ success: true, transaction: task.hash, network: NETWORK }) }, body: JSON.stringify({ requestId: task.id, dept: dept.address, task: task.task }) });
              if (!response.ok) throw new Error('Vendor not ready');
              const result = await response.json();
              if (result.requestId !== task.id || !['svg','text'].includes(result.type) || typeof result.content !== 'string' || result.content.length > 30_000) throw new Error('Invalid delivery');
              db.prepare("UPDATE company_tasks SET state='delivered',result=?,error=NULL WHERE id=?").run(JSON.stringify(result), task.id);
            } catch { db.prepare('UPDATE company_tasks SET error=? WHERE id=?').run('Payment confirmed; vendor delivery pending. Retrying never charges again.', task.id); }
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
        const lines = ['request_id,department,vendor,gross_test_usdt,fee_test_usdt,net_test_usdt,demo_inr,transaction'];
        for (const event of await receipts()) {
          const dept = departments.find(d => d.address.toLowerCase() === event.dept.toLowerCase()), vendor = vendors.find(v => v.address.toLowerCase() === event.vendor.toLowerCase());
          lines.push([event.requestId, dept?.name ?? event.dept, vendor?.name ?? event.vendor, formatUnits(event.amount,6), formatUnits(event.fee,6), formatUnits(BigInt(event.amount)-BigInt(event.fee),6), (Number(event.amount)/10000).toFixed(2), event.hash].join(','));
        }
        return lines.join('\r\n');
      },
      async close() { if (running) await running; chain.close(); db.close(); },
    };
    return service;
  } catch (error) { chain?.close(); db.close(); throw error; }
}
