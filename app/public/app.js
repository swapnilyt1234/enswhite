const $ = id => document.getElementById(id);
let state, busy = false;
let requestKey = sessionStorage.getItem('purchaseKey');
async function api(path, options = {}) {
  const response = await fetch('/api' + path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Request failed');
  return body;
}
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
async function refresh() {
  state = await api('/state');
  if (requestKey && state.purchases.some(p => [requestKey, 'x402-' + requestKey].includes(p.request_key) && ['confirmed', 'failed'].includes(p.state))) {
    requestKey = null; sessionStorage.removeItem('purchaseKey');
  }
  $('available').textContent = Number(state.available).toLocaleString(undefined, { maximumFractionDigits: 6, minimumFractionDigits: 2 });
  $('chain-balance').textContent = Number(state.chainBalance).toLocaleString(undefined, { maximumFractionDigits: 6 });
  $('wallet').textContent = state.wallet;
  $('wallet').title = state.wallet;
  $('mode').textContent = state.chainMode === 'testnet' ? 'REAL TESTNET SETTLEMENT' : 'LOCAL SIMULATION';
  $('topup-label').textContent = state.paymentMode === 'razorpay' ? 'Pay ₹100 in Razorpay test mode' : 'Simulate ₹100 sandbox payment';
  $('disclosure').textContent = state.chainMode === 'simulated'
    ? `${state.paymentMode === 'simulated' ? 'Local fiat simulation' : 'Razorpay test mode'} · Token transfers are simulated locally. No real fiat conversion or blockchain transaction occurs.`
    : 'Razorpay test mode · Fiat is simulated. Test USDT transfers settle on Whitechain Sepolia and have no real monetary value.';
  $('topup').disabled = busy;
  $('buy').disabled = busy || (!requestKey && Number(state.available) < Number(state.price));
  $('buy').firstElementChild.textContent = state.x402 ? 'Buy report via x402' : 'Buy report with agent';
  $('x402-note').textContent = state.x402 ? 'x402 v2 · HTTP 402 → signed authorization → onchain settlement. This app runs its own facilitator.' : 'Direct EIP-3009 payment flow. Restart the backend after updating to enable x402.';
  renderActivity();
}
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function renderActivity() {
  const rows = [...state.credits.map(row => ({ ...row, kind: 'funding' })), ...state.purchases.map(row => ({ ...row, kind: 'purchase' }))];
  if (!rows.length) return;
  $('activity').replaceChildren();
  for (const row of rows.reverse()) {
    const container = element('div', null, 'activity-row');
    const left = element('div'), right = element('div', null, 'activity-right');
    left.append(element('strong', row.kind === 'funding' ? 'Treasury → Agent · 1 test USDT' : 'Agent → Service · 0.1 test USDT' + (row.request_key?.startsWith('x402-') ? ' · x402' : '')));
    left.append(element('small', row.error || (state.chainMode === 'simulated' ? 'Local simulation · not a blockchain transaction' : row.hash ? 'Broadcast to Whitechain Sepolia' : 'Waiting for settlement')));
    const done = ['confirmed', 'funded'].includes(row.state);
    right.append(element('span', row.state, 'state' + (done ? '' : row.state === 'failed' ? ' failed' : ' pending')));
    if (row.hash && state.explorer) {
      const link = element('a', 'View transaction ↗');
      link.href = state.explorer + '/tx/' + row.hash; link.target = '_blank'; link.rel = 'noreferrer'; right.append(link);
    }
    if (row.kind === 'purchase' && done) {
      const button = element('button', 'Open report');
      button.addEventListener('click', () => act(async () => showReport(await api('/purchases/' + row.id))));
      right.append(button);
    }
    if (row.kind === 'funding' && row.state === 'failed') {
      const button = element('button', 'Retry funding');
      button.addEventListener('click', () => act(async () => { await api('/funding/' + row.id + '/retry', { method: 'POST' }); status('Funding retry queued.'); }));
      right.append(button);
    }
    container.append(left, right); $('activity').append(container);
  }
}
async function act(action) {
  if (busy) return;
  busy = true; $('buy').disabled = true; $('topup').disabled = true;
  try { await action(); }
  catch (error) { status(error.message, true); }
  finally { busy = false; try { await refresh(); } catch { status('Could not refresh. Check that the local server is running.', true); } }
}
let checkoutScript;
function loadCheckout() {
  return checkoutScript ??= new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = resolve; script.onerror = () => { checkoutScript = null; script.remove(); reject(new Error('Could not load Razorpay checkout')); };
    document.head.append(script);
  });
}
$('topup').addEventListener('click', () => act(async () => {
  const order = await api('/orders', { method: 'POST' });
  if (order.mode === 'simulated') {
    await api('/simulate', { method: 'POST', body: JSON.stringify({ orderId: order.id }) });
    status('Simulated payment checked. Your agent has been funded.');
    return;
  }
  await loadCheckout();
  await new Promise(resolve => {
    const checkout = new window.Razorpay({ key: order.keyId, order_id: order.id, amount: order.amount, currency: order.currency,
      name: 'Relay · Test mode', description: '₹100 sandbox payment → 1 test USDT agent budget',
      handler() { status('Checkout completed. Waiting for the verified payment webhook and treasury funding.'); resolve(); },
      modal: { ondismiss() { status('Checkout closed. No credit is issued until payment is captured and verified.'); resolve(); } },
      theme: { color: '#185d45' },
    });
    checkout.on('payment.failed', () => { status('Sandbox payment failed. No budget was credited.', true); resolve(); });
    checkout.open();
  });
}));
$('buy').addEventListener('click', () => act(async () => {
  requestKey ??= crypto.randomUUID();
  sessionStorage.setItem('purchaseKey', requestKey);
  status('Agent is authorizing payment. Waiting for settlement…');
  let purchase;
  if (state.x402) {
    const challenge = await fetch('/api/report', { method: 'POST' });
    if (challenge.status !== 402 || !challenge.headers.get('payment-required')) throw new Error('Expected an x402 payment challenge');
    const requirements = JSON.parse(atob(challenge.headers.get('payment-required')));
    if (requirements.x402Version !== 2 || requirements.accepts?.[0]?.network !== 'eip155:1874') throw new Error('Unexpected payment network');
    const payload = await api('/agent/authorize', { method: 'POST', headers: { 'idempotency-key': requestKey } });
    const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(payload))));
    const response = await fetch('/api/report', { method: 'POST', headers: { 'PAYMENT-SIGNATURE': encoded } });
    purchase = await response.json();
    if (!response.ok && !purchase.id) throw new Error(purchase.error || 'x402 payment failed');
    if (response.ok) {
      const settlement = JSON.parse(atob(response.headers.get('payment-response') || ''));
      if (!settlement.success || settlement.network !== 'eip155:1874') throw new Error('x402 settlement was not confirmed');
    }
  } else {
    purchase = await api('/purchases', { method: 'POST', headers: { 'idempotency-key': requestKey } });
  }
  if (['confirmed', 'failed'].includes(purchase.state)) {
    requestKey = null; sessionStorage.removeItem('purchaseKey');
  }
  if (purchase.report) showReport(purchase);
  else status(purchase.error || 'Payment is pending. The report will unlock after confirmation.');
}));
function showReport(purchase) {
  if (!purchase.report) return;
  $('report-summary').textContent = purchase.report.summary;
  $('report-checks').replaceChildren(...purchase.report.checks.map(check => element('li', check)));
  $('report-panel').hidden = false;
  status(purchase.report.simulated ? 'Report unlocked after a simulated payment.' : 'Report unlocked after confirmed test USDT payment.');
  $('report-panel').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' });
}
$('copy-wallet').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(state.wallet); status('Agent wallet address copied.'); }
  catch { status('Copy the wallet address shown above. Clipboard access is unavailable.', true); }
});
$('refresh').addEventListener('click', () => act(async () => { status('Activity updated.'); }));
refresh().catch(error => status(error.message, true));
setInterval(() => { if (!busy && !document.hidden) refresh().catch(() => {}); }, 5000);
