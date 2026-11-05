import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, request } from 'node:http';
import { Wallet } from 'ethers';
import { createPayments, webhookSignature } from './payments.js';
import { checkAuthorization, types, createChain } from './chain.js';
import { createApp } from './server.js';

async function setup(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'agent-payments-test-'));
  const service = await createPayments({ directory, env: {}, ...options });
  t.after(async () => { await service.close(); rmSync(directory, { recursive: true, force: true }); });
  return { service, directory };
}
async function fund(service, user) {
  const order = await service.order(user);
  await service.simulate(user, order.id);
  await service.processJobs();
  return order;
}

test('captured payment funds once despite duplicate events, then agent pays with no native gas', async t => {
  const { service, directory } = await setup(t);
  const { user, token } = service.session();
  assert.equal(service.session(token).user.id, user.id);
  const order = await fund(service, user);
  await Promise.all([service.simulate(user, order.id), service.simulate(user, order.id)]);
  await service.processJobs();
  assert.equal(service.db.prepare('SELECT COUNT(*) n FROM credits').get().n, 1);
  assert.equal(await service.chain.balance(user.address), 1_000_000n);
  const purchase = await service.buy(user, 'request-first-001');
  assert.equal((await service.buy(user, 'request-first-001')).id, purchase.id);
  await service.processJobs();
  assert.equal(service.result(user.id, purchase.id).state, 'confirmed');
  assert.equal(service.result(user.id, purchase.id).report.simulated, true);
  assert.equal(service.available(user.id), 900_000n);
  assert.equal(await service.chain.balance(service.merchant), 100_000n);
  const stored = service.db.prepare('SELECT secret FROM users WHERE id=?').get(user.id).secret;
  assert(!stored.startsWith('0x'));
  assert.equal(readFileSync(join(directory, 'wallet.key')).length, 32);
});

test('webhook rejects forged signatures, API mismatches and non-captured payments', async t => {
  let payment;
  const { service } = await setup(t, { gatewayFactory: () => ({ mode: 'simulated', secret: 'test-secret', order: async () => ({ id: 'order_test' }), payment: async () => payment }) });
  const { user } = service.session();
  await service.order(user);
  const raw = Buffer.from(JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_test' } } } }));
  const signature = webhookSignature(raw, 'test-secret');
  await assert.rejects(service.capture(raw, '0'.repeat(64)), /signature/);
  payment = { id: 'pay_test', order_id: 'order_test', amount: 10_001, captured: true, status: 'captured', currency: 'INR' };
  await assert.rejects(service.capture(raw, signature), /match/);
  payment.amount = 10_000; payment.status = 'authorized';
  await assert.rejects(service.capture(raw, signature), /captured/);
  payment.status = 'captured'; payment.currency = 'USD';
  await assert.rejects(service.capture(raw, signature), /INR/);
  payment.currency = 'INR';
  await service.capture(raw, signature);
  await service.capture(raw, signature);
  assert.equal(service.db.prepare('SELECT COUNT(*) n FROM credits').get().n, 1);
  const changed = Buffer.from(raw.toString() + ' ');
  await assert.rejects(service.capture(changed, signature), /signature/);
});

test('parallel purchases cannot exceed funded budget; sessions cannot read each other', async t => {
  const { service } = await setup(t);
  const { user } = service.session();
  await assert.rejects(service.buy(user, 'no-budget-0001'), /Fund/);
  await fund(service, user);
  const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => service.buy(user, `parallel-${i.toString().padStart(3, '0')}`)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 10);
  assert.equal(service.available(user.id), 0n);
  const purchase = results.find(r => r.status === 'fulfilled').value;
  const other = service.session().user;
  assert.throws(() => service.result(other.id, purchase.id), /not found/);
  await service.processJobs();
  assert.equal(await service.chain.balance(user.address), 0n);
});

test('signature validation rejects changed recipient, amount, signer, chain and expired authorization', async t => {
  const { service } = await setup(t);
  const wallet = Wallet.createRandom(), other = Wallet.createRandom();
  const a = { from: wallet.address, to: service.merchant, value: '100000', validAfter: '0', validBefore: String(Math.floor(Date.now() / 1000) + 120), nonce: '0x' + 'ab'.repeat(32) };
  const signature = await wallet.signTypedData(service.chain.domain, types, a);
  checkAuthorization(service.chain.domain, a, signature, a);
  assert.throws(() => checkAuthorization(service.chain.domain, { ...a, value: '1' }, signature, a));
  assert.throws(() => checkAuthorization(service.chain.domain, { ...a, to: other.address }, signature, a));
  assert.throws(() => checkAuthorization({ ...service.chain.domain, chainId: 1 }, a, signature, a));
  assert.throws(() => checkAuthorization(service.chain.domain, { ...a, validBefore: '1' }, signature, a));
  const wrongSigner = await other.signTypedData(service.chain.domain, types, a);
  assert.throws(() => checkAuthorization(service.chain.domain, a, wrongSigner, a));
});

test('ambiguous broadcasts preserve signed bytes and retry without duplicate transfers', async t => {
  let loseResponse = true;
  const { service } = await setup(t, { chainFactory: async (...args) => {
    const chain = await createChain(...args), broadcast = chain.broadcast.bind(chain);
    return { ...chain, async broadcast(...tx) {
      const result = await broadcast(...tx);
      if (loseResponse) { loseResponse = false; throw new Error('Connection lost after broadcast'); }
      return result;
    } };
  } });
  const { user } = service.session();
  await fund(service, user);
  const pending = service.db.prepare('SELECT * FROM credits').get();
  assert.equal(pending.state, 'funding');
  assert(pending.raw);
  assert.equal(service.available(user.id), 0n);
  await service.processJobs();
  assert.equal(service.db.prepare('SELECT * FROM credits').get().hash, pending.hash);
  assert.equal(service.available(user.id), 1_000_000n);
  assert.equal(service.db.prepare('SELECT COUNT(*) n FROM simulated_transactions').get().n, 1);
});

test('database survives restart and mode changes cannot mix simulated and real balances', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-restart-'));
  let service = await createPayments({ directory, env: {} });
  const { user, token } = service.session();
  await fund(service, user);
  await service.close();
  service = await createPayments({ directory, env: {} });
  t.after(async () => { await service.close(); rmSync(directory, { recursive: true, force: true }); });
  assert.equal(service.session(token).user.address, user.address);
  assert.equal(service.available(user.id), 1_000_000n);
  await assert.rejects(createPayments({ directory, env: { CHAIN_MODE: 'testnet' } }), /requires Razorpay/);
  await assert.rejects(createPayments({ directory, env: { PAYMENT_MODE: 'razorpay' } }), /different DATA_DIR/);
});

test('HTTP endpoints enforce origin, host, session ownership and idempotency', async t => {
  const { service } = await setup(t);
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  server.on('request', createApp(service, origin));
  t.after(() => new Promise(resolve => server.close(resolve)));
  let response = await fetch(origin + '/api/state');
  const cookie = response.headers.get('set-cookie').split(';')[0];
  assert(response.headers.get('set-cookie').includes('HttpOnly'));
  assert.equal((await response.json()).chainMode, 'simulated');
  response = await fetch(origin + '/api/orders', { method: 'POST', headers: { Cookie: cookie, Origin: 'https://evil.example' } });
  assert.equal(response.status, 403);
  const headers = { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' };
  response = await fetch(origin + '/api/orders', { method: 'POST', headers });
  const order = await response.json();
  response = await fetch(origin + '/api/simulate', { method: 'POST', headers, body: JSON.stringify({ orderId: order.id }) });
  assert.equal(response.status, 200);
  const purchaseHeaders = { ...headers, 'idempotency-key': 'http-request-0001' };
  const first = await (await fetch(origin + '/api/purchases', { method: 'POST', headers: purchaseHeaders })).json();
  const second = await (await fetch(origin + '/api/purchases', { method: 'POST', headers: purchaseHeaders })).json();
  assert.equal(first.id, second.id);
  assert.equal(first.state, 'confirmed');
  assert(first.report);
  assert.equal((await fetch(origin + '/api/purchases/' + first.id)).status, 404);
  const reboundStatus = await new Promise((resolve, reject) => {
    const req = request(origin + '/api/state', { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(reboundStatus, 403);
});
