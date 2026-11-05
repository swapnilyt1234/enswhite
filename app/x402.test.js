import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createPayments } from './payments.js';
import { createApp } from './server.js';
import { encodePayment, decodePayment } from './x402.js';

async function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), 'relay-x402-'));
  const payments = await createPayments({ directory, env: {} });
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  server.on('request', createApp(payments, origin));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await payments.close(); rmSync(directory, { recursive: true, force: true }); });
  const first = await fetch(origin + '/api/state');
  const cookie = first.headers.get('set-cookie').split(';')[0];
  const headers = { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' };
  const post = (path, body, extra = {}) => fetch(origin + path, { method: 'POST', headers: { ...headers, ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const order = await (await post('/api/orders')).json();
  await post('/api/simulate', { orderId: order.id });
  return { payments, origin, post, headers };
}

test('x402 uses standard v2 headers, waits for submission, settles once, and returns a paid report', async t => {
  const { payments, post } = await setup(t);
  const challenge = await post('/api/report');
  assert.equal(challenge.status, 402);
  const required = decodePayment(challenge.headers.get('payment-required'));
  assert.equal(required.x402Version, 2);
  assert.equal(required.accepts[0].network, 'eip155:1874');
  assert.equal(required.accepts[0].amount, '100000');
  const key = { 'idempotency-key': 'x402-test-0001' };
  const payload = await (await post('/api/agent/authorize', null, key)).json();
  const repeated = await (await post('/api/agent/authorize', null, key)).json();
  assert.deepEqual(payload, repeated);
  await payments.processJobs();
  assert.equal(payments.db.prepare("SELECT COUNT(*) n FROM simulated_transactions WHERE kind='payment'").get().n, 0);
  const body = { x402Version: 2, paymentPayload: payload, paymentRequirements: payload.accepted };
  assert.equal((await (await post('/api/x402/verify', body)).json()).isValid, true);
  const response = await post('/api/report', null, { 'PAYMENT-SIGNATURE': encodePayment(payload) });
  assert.equal(response.status, 200);
  const report = await response.json();
  const settlement = decodePayment(response.headers.get('payment-response'));
  assert(report.report);
  assert.equal(settlement.success, true);
  assert.equal(settlement.transaction, report.hash);
  assert.equal(settlement.network, 'eip155:1874');
  const retry = await post('/api/report', null, { 'PAYMENT-SIGNATURE': encodePayment(payload) });
  assert.equal((await retry.json()).id, report.id);
  const settleRetry = await (await post('/api/x402/settle', body)).json();
  assert.equal(settleRetry.transaction, report.hash);
  assert.equal(payments.db.prepare("SELECT COUNT(*) n FROM simulated_transactions WHERE kind='payment'").get().n, 1);
});

test('x402 rejects wrong network, price, resource, signature and session without payment', async t => {
  const { payments, post, origin } = await setup(t);
  const payload = await (await post('/api/agent/authorize', null, { 'idempotency-key': 'x402-invalid-0001' })).json();
  for (const mutate of [
    value => { value.accepted.network = 'eip155:1'; },
    value => { value.accepted.amount = '1'; },
    value => { value.resource.url = origin + '/other'; },
    value => { value.payload.signature = '0x' + '00'.repeat(65); },
    value => { value.payload.authorization.value = '1'; },
  ]) {
    const changed = structuredClone(payload); mutate(changed);
    const response = await post('/api/report', null, { 'PAYMENT-SIGNATURE': encodePayment(changed) });
    assert.equal(response.status, 402);
    assert(!(await response.json()).report);
  }
  const wrongSession = await fetch(origin + '/api/report', { method: 'POST', headers: { Origin: origin, 'PAYMENT-SIGNATURE': encodePayment(payload) } });
  assert.equal(wrongSession.status, 402);
  const invalidHeader = await post('/api/report', null, { 'PAYMENT-SIGNATURE': '!!!' });
  assert.equal(invalidHeader.status, 402);
  assert.equal(payments.db.prepare("SELECT COUNT(*) n FROM simulated_transactions WHERE kind='payment'").get().n, 0);
});

test('unused x402 authorizations expire and release the reserved budget', async t => {
  const { payments, post } = await setup(t);
  const payload = await (await post('/api/agent/authorize', null, { 'idempotency-key': 'x402-expire-0001' })).json();
  const purchase = payments.db.prepare('SELECT * FROM purchases WHERE nonce=?').get(payload.payload.authorization.nonce);
  assert.equal(payments.available(purchase.user_id), 900_000n);
  const authorization = JSON.parse(purchase.authorization);
  authorization.validBefore = '1';
  payments.db.prepare('UPDATE purchases SET authorization=? WHERE id=?').run(JSON.stringify(authorization), purchase.id);
  await payments.processJobs();
  assert.equal(payments.db.prepare('SELECT state FROM purchases WHERE id=?').get(purchase.id).state, 'failed');
  assert.equal(payments.available(purchase.user_id), 1_000_000n);
});
