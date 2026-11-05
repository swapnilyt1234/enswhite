import { checkAuthorization, TOKEN, NETWORK } from './chain.js';
import { fail } from './payments.js';

export const encodePayment = value => Buffer.from(JSON.stringify(value)).toString('base64');
export function decodePayment(header) {
  if (typeof header !== 'string' || header.length > 12_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(header)) throw fail('Invalid PAYMENT-SIGNATURE header');
  try { return JSON.parse(Buffer.from(header, 'base64').toString('utf8')); }
  catch { throw fail('Invalid payment payload JSON'); }
}

// This facilitator serves this app's funded session wallets and fixed report price only.
export function mountX402(app, payments, origin) {
  const resource = { url: origin + '/api/report', description: 'Agent payment readiness report', mimeType: 'application/json' };
  const requirements = {
    scheme: 'exact', network: NETWORK, amount: payments.price, asset: TOKEN, payTo: payments.merchant,
    maxTimeoutSeconds: 300, extra: { name: payments.chain.domain.name, version: payments.chain.domain.version },
  };
  const required = error => ({ x402Version: 2, ...(error ? { error } : {}), resource, accepts: [requirements] });
  function sameRequirements(value) {
    return value && ['scheme', 'network', 'amount', 'asset', 'payTo', 'maxTimeoutSeconds'].every(key => value[key] === requirements[key]) &&
      value.extra?.name === requirements.extra.name && value.extra?.version === requirements.extra.version;
  }
  async function validate(user, payload, suppliedRequirements = requirements) {
    if (payload?.x402Version !== 2 || !sameRequirements(payload.accepted) || !sameRequirements(suppliedRequirements)) throw fail('invalid_payment_requirements');
    if (payload.resource && payload.resource.url !== resource.url) throw fail('invalid_resource');
    const a = payload.payload?.authorization, signature = payload.payload?.signature;
    if (typeof a?.nonce !== 'string' || !/^0x[0-9a-f]{64}$/i.test(a.nonce)) throw fail('invalid_payload');
    const purchase = payments.db.prepare("SELECT * FROM purchases WHERE user_id=? AND nonce=? AND request_key LIKE 'x402-%'").get(user.id, a.nonce);
    if (!purchase || typeof signature !== 'string' || signature !== purchase.signature) throw fail('invalid_exact_evm_payload_signature');
    const saved = JSON.parse(purchase.authorization);
    if (!Object.keys(saved).every(key => a[key] === saved[key])) throw fail('invalid_exact_evm_payload_authorization');
    if (['failed', 'external'].includes(purchase.state)) throw fail('invalid_transaction_state');
    // Already signed/broadcast jobs retain their original reservation and can finish after the authorization deadline.
    if (!purchase.raw && purchase.state !== 'confirmed') {
      checkAuthorization(payments.chain.domain, a, signature, { from: user.address, to: payments.merchant, value: payments.price });
      if (await payments.chain.used(a.from, a.nonce)) throw fail('authorization_already_used');
      if (await payments.chain.balance(a.from) < BigInt(a.value)) throw fail('insufficient_funds');
    }
    return purchase;
  }
  async function settle(user, payload, suppliedRequirements) {
    const purchase = await validate(user, payload, suppliedRequirements);
    payments.db.prepare("UPDATE purchases SET state='pending' WHERE id=? AND state='authorized'").run(purchase.id);
    await payments.processJobs();
    const result = payments.result(user.id, purchase.id);
    return { result, response: {
      success: result.state === 'confirmed', transaction: result.state === 'confirmed' ? result.hash : '', network: NETWORK, payer: user.address,
      ...(result.state === 'confirmed' ? {} : { errorReason: result.state === 'failed' ? 'invalid_transaction_state' : 'settlement_pending' }),
    } };
  }
  app.get('/api/x402/supported', (req, res) => res.json({
    kinds: [{ x402Version: 2, scheme: 'exact', network: NETWORK }], extensions: [],
    signers: payments.chain.relayerAddress ? { [NETWORK]: [payments.chain.relayerAddress] } : {},
  }));
  app.post('/api/agent/authorize', async (req, res) => {
    const requestKey = req.get('idempotency-key');
    if (!requestKey || !/^[a-zA-Z0-9_-]{8,70}$/.test(requestKey)) throw fail('A valid idempotency key is required');
    const purchase = await payments.buy(req.user, 'x402-' + requestKey, true);
    if (['failed', 'external'].includes(purchase.state)) throw fail('Previous authorization failed; start a new purchase');
    res.json({ x402Version: 2, resource, accepted: requirements, payload: { signature: purchase.signature, authorization: JSON.parse(purchase.authorization) } });
  });
  app.post('/api/x402/verify', async (req, res) => {
    try {
      if (req.body?.x402Version !== 2 || !req.body.paymentRequirements) throw fail('invalid_x402_version');
      await validate(req.user, req.body.paymentPayload, req.body.paymentRequirements);
      res.json({ isValid: true, payer: req.user.address });
    } catch { res.json({ isValid: false, invalidReason: 'invalid_payment', payer: req.user.address }); }
  });
  app.post('/api/x402/settle', async (req, res) => {
    if (req.body?.x402Version !== 2 || !req.body.paymentRequirements) throw fail('invalid_x402_version');
    try { res.json((await settle(req.user, req.body.paymentPayload, req.body.paymentRequirements)).response); }
    catch { res.json({ success: false, errorReason: 'invalid_payment', transaction: '', network: NETWORK, payer: req.user.address }); }
  });
  app.post('/api/report', async (req, res) => {
    if (!req.get('payment-signature')) return res.status(402).set('PAYMENT-REQUIRED', encodePayment(required('PAYMENT-SIGNATURE header is required'))).json({});
    let settlement;
    try { settlement = await settle(req.user, decodePayment(req.get('payment-signature'))); }
    catch {
      return res.status(402).set('PAYMENT-REQUIRED', encodePayment(required('Payment authorization was rejected'))).json({ error: 'Invalid payment authorization' });
    }
    res.set('PAYMENT-RESPONSE', encodePayment(settlement.response));
    if (!settlement.response.success) {
      return res.status(402).set('PAYMENT-REQUIRED', encodePayment(required('Payment has not settled'))).json({ ...settlement.result, error: settlement.response.errorReason });
    }
    res.json(settlement.result);
  });
}
