import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Wallet, TypedDataEncoder, formatUnits, parseUnits, getAddress } from 'ethers';
import { createChain, checkAuthorization, types, TOKEN, NETWORK, EXPLORER } from './chain.js';

export const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export const digest = value => createHash('sha256').update(value).digest('hex');
export const webhookSignature = (body, secret) => createHmac('sha256', secret).update(body).digest('hex');

export function openStore(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const keyPath = join(directory, 'wallet.key');
  try { writeFileSync(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const key = readFileSync(keyPath);
  if (key.length !== 32) throw new Error('Invalid wallet encryption key');
  const db = new DatabaseSync(join(directory, 'payments.sqlite'));
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, session_hash TEXT UNIQUE NOT NULL, address TEXT NOT NULL, secret TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), amount INTEGER NOT NULL, units TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS credits (id TEXT PRIMARY KEY, order_id TEXT UNIQUE NOT NULL REFERENCES orders(id), user_id TEXT NOT NULL REFERENCES users(id), units TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'credited', raw TEXT, hash TEXT, error TEXT);
    CREATE TABLE IF NOT EXISTS purchases (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), request_key TEXT NOT NULL, units TEXT NOT NULL, nonce TEXT UNIQUE NOT NULL, authorization TEXT NOT NULL, signature TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', raw TEXT, hash TEXT, error TEXT, UNIQUE(user_id, request_key));
    CREATE TABLE IF NOT EXISTS simulated_transactions (hash TEXT PRIMARY KEY, kind TEXT NOT NULL, recipient TEXT NOT NULL, authorizer TEXT, value TEXT NOT NULL, nonce TEXT, UNIQUE(authorizer,nonce));
    CREATE TABLE IF NOT EXISTS simulated_payments (id TEXT PRIMARY KEY, order_id TEXT UNIQUE NOT NULL, amount INTEGER NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL);
  `);
  return { db, key };
}

function encrypt(key, secret) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}
function decrypt(key, encrypted) {
  const bytes = Buffer.from(encrypted, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
}

export function createGateway(env, db) {
  const mode = env.PAYMENT_MODE ?? 'simulated';
  if (mode === 'simulated') return {
    mode, secret: randomBytes(32).toString('hex'), keyId: null,
    async order() { return { id: 'order_' + randomBytes(12).toString('hex') }; },
    async payment(id) { return db.prepare('SELECT *, 1 AS captured FROM simulated_payments WHERE id=?').get(id); },
  };
  if (mode !== 'razorpay' || !/^rzp_test_/.test(env.RAZORPAY_KEY_ID ?? '') || !env.RAZORPAY_KEY_SECRET || !env.RAZORPAY_WEBHOOK_SECRET) {
    throw new Error('Razorpay requires TEST key ID, key secret and webhook secret. Live mode is disabled.');
  }
  async function request(path, body) {
    const response = await fetch('https://api.razorpay.com/v1/' + path, {
      method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: 'Basic ' + Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64'), 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw fail('Razorpay API request failed. Check test credentials and retry.', 502);
    return response.json();
  }
  return {
    mode, secret: env.RAZORPAY_WEBHOOK_SECRET, keyId: env.RAZORPAY_KEY_ID,
    order: amount => request('orders', { amount, currency: 'INR', receipt: randomUUID(), partial_payment: false }),
    payment: id => request(`payments/${id}`),
  };
}

export async function createPayments({ directory, env = process.env, chainFactory = createChain, gatewayFactory = createGateway }) {
  const { db, key } = openStore(directory);
  let chain;
  try {
    const mode = env.CHAIN_MODE ?? 'simulated';
    const paymentMode = env.PAYMENT_MODE ?? 'simulated';
    // A local "paid" button must never unlock real treasury funds.
    if (mode === 'testnet' && paymentMode !== 'razorpay') throw new Error('Real testnet funding requires Razorpay test-mode verification');
    const configured = db.prepare('SELECT value FROM settings WHERE key=?').get('modes');
    const modes = `${mode}:${paymentMode}`;
    if (configured && configured.value !== modes) throw new Error('Use a different DATA_DIR when changing payment or chain mode');
    chain = await chainFactory(mode, db, env);
    const gateway = gatewayFactory(env, db);
    db.prepare('INSERT OR IGNORE INTO settings VALUES(?,?)').run('modes', modes);
    const merchant = getAddress(env.MERCHANT_ADDRESS || '0x4f961b8abd8af7ccdccc4f76cd7326d8fbea0594');
    if (merchant === '0x0000000000000000000000000000000000000000') throw new Error('Merchant cannot be zero address');
    const savedMerchant = db.prepare('SELECT value FROM settings WHERE key=?').get('merchant');
    if (savedMerchant && savedMerchant.value !== merchant) throw new Error('Use a different DATA_DIR when changing merchant');
    db.prepare('INSERT OR IGNORE INTO settings VALUES(?,?)').run('merchant', merchant);
    const topUpUnits = parseUnits('1', chain.decimals).toString();
    const price = parseUnits('0.1', chain.decimals).toString();
    let running;
    const service = {
      db, chain, gateway, merchant, price,
      session(token) {
        const existing = token && /^[a-f0-9]{64}$/.test(token) && db.prepare('SELECT id,address FROM users WHERE session_hash=?').get(digest(token));
        if (existing) return { user: existing };
        const wallet = Wallet.createRandom(), id = randomUUID(), newToken = randomBytes(32).toString('hex');
        db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(id, digest(newToken), wallet.address, encrypt(key, wallet.privateKey));
        return { user: { id, address: wallet.address }, token: newToken };
      },
      available(userId) {
        const funded = db.prepare("SELECT units FROM credits WHERE user_id=? AND state='funded'").all(userId).reduce((sum, r) => sum + BigInt(r.units), 0n);
        const spent = db.prepare("SELECT units FROM purchases WHERE user_id=? AND state!='failed'").all(userId).reduce((sum, r) => sum + BigInt(r.units), 0n);
        return funded - spent;
      },
      async state(user) {
        const credits = db.prepare('SELECT id,units,state,hash,error FROM credits WHERE user_id=?').all(user.id);
        const purchases = db.prepare('SELECT id,request_key,units,state,hash,error FROM purchases WHERE user_id=?').all(user.id);
        return {
          wallet: user.address, paymentMode: gateway.mode, chainMode: chain.mode, network: NETWORK, token: TOKEN, x402: true,
          merchant, price: '0.1', available: formatUnits(service.available(user.id), chain.decimals),
          chainBalance: formatUnits(await chain.balance(user.address), chain.decimals),
          quote: { inr: 100, usdt: '1', note: 'Fixed demo allocation, not an exchange rate or fiat conversion.' },
          credits, purchases, explorer: chain.mode === 'testnet' ? EXPLORER : null,
        };
      },
      async order(user) {
        const count = db.prepare('SELECT COUNT(*) AS n FROM orders WHERE user_id=?').get(user.id).n;
        if (count >= 20) throw fail('Demo limit: 20 top-up orders per session', 429);
        const order = await gateway.order(10_000);
        if (!/^order_[a-zA-Z0-9]+$/.test(order.id)) throw fail('Invalid provider order', 502);
        db.prepare('INSERT INTO orders(id,user_id,amount,units) VALUES(?,?,?,?)').run(order.id, user.id, 10_000, topUpUnits);
        return { id: order.id, amount: 10_000, currency: 'INR', keyId: gateway.keyId, mode: gateway.mode };
      },
      async capture(raw, signature) {
        if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature) || !timingSafeEqual(Buffer.from(webhookSignature(raw, gateway.secret), 'hex'), Buffer.from(signature, 'hex'))) throw fail('Invalid webhook signature', 401);
        let event;
        try { event = JSON.parse(raw.toString('utf8')); } catch { throw fail('Invalid webhook JSON'); }
        if (event.event !== 'payment.captured') return { ignored: true };
        const id = event.payload?.payment?.entity?.id;
        if (!/^pay_[a-zA-Z0-9]+$/.test(id ?? '')) throw fail('Invalid payment ID');
        const payment = await gateway.payment(id);
        if (!payment || payment.id !== id || payment.status !== 'captured' || !payment.captured || payment.currency !== 'INR') throw fail('Payment is not captured in INR');
        const order = db.prepare('SELECT * FROM orders WHERE id=?').get(payment.order_id);
        if (!order || payment.amount !== order.amount) throw fail('Payment does not match a local order');
        // Unique payment ID AND order ID prevent crediting retries or a second event twice.
        db.prepare('INSERT OR IGNORE INTO credits(id,order_id,user_id,units) VALUES(?,?,?,?)').run(id, order.id, order.user_id, order.units);
        return { accepted: true };
      },
      async simulate(user, orderId) {
        if (gateway.mode !== 'simulated') throw fail('Local simulation is disabled', 403);
        const order = db.prepare('SELECT * FROM orders WHERE id=? AND user_id=?').get(orderId, user.id);
        if (!order) throw fail('Order not found', 404);
        let payment = db.prepare('SELECT * FROM simulated_payments WHERE order_id=?').get(order.id);
        if (!payment) {
          payment = { id: 'pay_' + randomBytes(12).toString('hex') };
          db.prepare('INSERT INTO simulated_payments VALUES(?,?,?,?,?)').run(payment.id, order.id, order.amount, 'INR', 'captured');
        }
        const raw = Buffer.from(JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: payment.id } } } }));
        return service.capture(raw, webhookSignature(raw, gateway.secret));
      },
      async buy(user, requestKey, hold = false) {
        if (typeof requestKey !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(requestKey)) throw fail('A valid idempotency key is required');
        const existing = db.prepare('SELECT * FROM purchases WHERE user_id=? AND request_key=?').get(user.id, requestKey);
        if (existing) return existing;
        // shortcut: one backend per database; add a transactional worker lease before running multiple instances.
        if (service.available(user.id) < BigInt(price)) throw fail('Fund your agent before buying a report', 402);
        const id = randomUUID(), nonce = '0x' + randomBytes(32).toString('hex'), now = Math.floor(Date.now() / 1000);
        const authorization = { from: user.address, to: merchant, value: price, validAfter: String(now - 1), validBefore: String(now + 300), nonce };
        const wallet = new Wallet(decrypt(key, db.prepare('SELECT secret FROM users WHERE id=?').get(user.id).secret));
        // Signing is synchronous to keep the balance check and reservation indivisible in this single-process app.
        const signature = wallet.signingKey.sign(TypedDataEncoder.hash(chain.domain, types, authorization)).serialized;
        checkAuthorization(chain.domain, authorization, signature, { from: user.address, to: merchant, value: price });
        db.prepare('INSERT INTO purchases(id,user_id,request_key,units,nonce,authorization,signature,state) VALUES(?,?,?,?,?,?,?,?)')
          .run(id, user.id, requestKey, price, nonce, JSON.stringify(authorization), signature, hold ? 'authorized' : 'pending');
        return db.prepare('SELECT * FROM purchases WHERE id=?').get(id);
      },
      result(userId, id) {
        const purchase = db.prepare('SELECT id,state,hash,error FROM purchases WHERE user_id=? AND id=?').get(userId, id);
        if (!purchase) throw fail('Purchase not found', 404);
        return { ...purchase, ...(purchase.state === 'confirmed' ? { report: {
          title: 'Agent payment readiness report',
          summary: 'Your agent purchased this deterministic demo report using its funded spending budget.',
          checks: ['Payment captured and checked server-side', 'Agent budget reserved before settlement', 'EIP-3009 signature validated', 'Payment settled before report access'],
          simulated: chain.mode === 'simulated',
        } } : {}) };
      },
      async processJobs() {
        if (running) return running;
        running = (async () => {
          for (const held of db.prepare("SELECT * FROM purchases WHERE state='authorized' AND CAST(json_extract(authorization,'$.validBefore') AS INTEGER)<=?").all(Math.floor(Date.now() / 1000))) {
            const a = JSON.parse(held.authorization);
            try {
              const used = await chain.used(a.from, a.nonce);
              db.prepare('UPDATE purchases SET state=?,error=? WHERE id=? AND state=?').run(used ? 'external' : 'failed', used ? 'Authorization used externally; budget retained for reconciliation' : 'Authorization expired before submission', held.id, 'authorized');
            } catch { /* Keep the reservation when chain state cannot be checked. */ }
          }
          for (const credit of db.prepare("SELECT * FROM credits WHERE state IN ('credited','funding')").all()) {
            await settle('credits', credit, async () => chain.prepareFunding(db.prepare('SELECT address FROM users WHERE id=?').get(credit.user_id).address, credit.units, credit.id), 'funding', 'funded');
          }
          for (const purchase of db.prepare("SELECT * FROM purchases WHERE state IN ('pending','settling')").all()) {
            await settle('purchases', purchase, async () => {
              const a = JSON.parse(purchase.authorization);
              checkAuthorization(chain.domain, a, purchase.signature, { from: db.prepare('SELECT address FROM users WHERE id=?').get(purchase.user_id).address, to: merchant, value: price });
              if (await chain.used(a.from, a.nonce)) throw new Error('Authorization already used outside this app');
              return chain.preparePayment(a, purchase.signature);
            }, 'settling', 'confirmed');
          }
        })().finally(() => { running = null; });
        return running;
      },
      async retry(user, id) {
        const row = db.prepare('SELECT * FROM credits WHERE id=? AND user_id=?').get(id, user.id);
        if (!row || row.state !== 'failed') throw fail('Only failed funding can be retried');
        // Only proven reverted transactions may be replaced; unknown broadcasts retain the original raw transaction.
        db.prepare("UPDATE credits SET state='credited',raw=NULL,hash=NULL,error=NULL WHERE id=?").run(id);
      },
      async close() { if (running) await running; chain.close(); db.close(); },
    };
    async function settle(table, row, prepare, pending, confirmed) {
      try {
        if (!row.raw) {
          const tx = await prepare();
          // Persist the signed bytes BEFORE broadcasting. A restart resends the same transaction, never a second transfer.
          db.prepare(`UPDATE ${table} SET raw=?,hash=?,state=?,error=NULL WHERE id=?`).run(tx.raw, tx.hash, pending, row.id);
          row.raw = tx.raw; row.hash = tx.hash;
        }
        const receipt = await chain.broadcast(row.raw, row.hash);
        if (receipt.status !== 'pending') db.prepare(`UPDATE ${table} SET state=?,error=? WHERE id=?`).run(receipt.status === 'confirmed' ? confirmed : 'failed', receipt.status === 'confirmed' ? null : 'Transaction reverted or did not transfer tokens', row.id);
      } catch (error) {
        // Once signed, an RPC timeout is ambiguous; preserve the reservation and retry identical signed bytes.
        db.prepare(`UPDATE ${table} SET error=?${!row.raw && table === 'purchases' ? ",state='failed'" : ''} WHERE id=?`).run(safeError(error), row.id);
      }
    }
    return service;
  } catch (error) { chain?.close(); db.close(); throw error; }
}

// Keep provider errors (which may contain signed data or credentialed URLs) out of API responses.
function safeError(error) {
  const known = ['Treasury needs test USDT', 'Relayer needs test WBT', 'Invalid authorization window', 'Authorization already used outside this app'];
  return known.includes(error.message) ? error.message : 'Settlement pending: check server configuration, balance and RPC; retry uses the saved transaction.';
}

