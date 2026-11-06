import test from 'node:test';
import assert from 'node:assert/strict';
import { createReplenisher, LOW_GAS, MAX_BATCH, swapData, routerInterface, WWBT, YETI_ROUTER } from './gas-replenisher.js';
import { TOKEN } from './chain.js';

function setup(overrides = {}) {
  let saved, allowance = 0n, fees = 4_000n, sequence = 0;
  const prepared = [], completed = new Map();
  const journal = { load: () => saved ? structuredClone(saved) : null, save: value => { saved = structuredClone(value); } };
  const io = {
    relayerBalance: async () => 0n, feePool: async () => fees,
    allowance: async () => allowance, gasBudget: async () => 100n,
    quote: async () => ({ fee: 3000, minimum: 1000n }),
    async prepare(phase, data) { const tx = { phase, data, raw: 'signed-' + ++sequence, hash: 'tx-' + sequence }; prepared.push(tx); return tx; },
    async broadcast(tx) {
      if (completed.has(tx.hash)) return completed.get(tx.hash);
      let result = { status: 'confirmed' };
      if (tx.phase === 'withdraw') { result.withdrawn = String(fees); fees = 0n; }
      if (tx.phase === 'reset' || tx.phase === 'approve') allowance = BigInt(tx.data.amount);
      if (tx.phase === 'swap') allowance = 0n;
      completed.set(tx.hash, result); return result;
    },
    ...overrides,
  };
  return { io, journal, prepared, completed, state: () => journal.load(), setFees: n => { fees = n; }, setAllowance: n => { allowance = n; } };
}

test('healthy relayer, empty fee pool and uneconomic quotes never sign a transaction', async () => {
  let f = setup({ relayerBalance: async () => LOW_GAS });
  assert.equal((await createReplenisher(f.io, f.journal).tick()).status, 'healthy');
  assert.equal(f.prepared.length, 0);
  f = setup(); f.setFees(0n);
  assert.equal((await createReplenisher(f.io, f.journal).tick()).status, 'waiting-for-fees');
  f = setup({ quote: async () => ({ minimum: 199n }) });
  await assert.rejects(createReplenisher(f.io, f.journal).tick(), /too small/);
  assert.equal(f.prepared.length, 0);
  f = setup({ quote: async () => undefined });
  await assert.rejects(createReplenisher(f.io, f.journal).tick(), /No liquid/);
  assert.equal(f.prepared.length, 0);
});

test('low gas withdraws earned fees, resets old allowance, approves exact amount and swaps', async () => {
  const f = setup(); f.setAllowance(1n);
  assert.equal((await createReplenisher(f.io, f.journal).tick()).status, 'replenished');
  assert.deepEqual(f.prepared.map(tx => tx.phase), ['withdraw', 'reset', 'approve', 'swap']);
  assert.equal(f.prepared[1].data.amount, '0');
  assert.equal(f.prepared[2].data.amount, '4000');
  assert.equal(f.state().remaining, '0');
  assert.equal(f.state().lastSwap, 'tx-4');
});

test('unknown broadcast response resumes identical signed bytes after restart without withdrawing twice', async () => {
  const f = setup(), send = f.io.broadcast;
  let lost = false;
  f.io.broadcast = async tx => {
    assert.equal(f.state().cycle.tx.raw, tx.raw, 'must persist before broadcasting');
    const result = await send(tx);
    if (!lost) { lost = true; throw new Error('Connection lost after transaction mined'); }
    return result;
  };
  await assert.rejects(createReplenisher(f.io, f.journal).tick(), /Connection lost/);
  assert.equal(f.state().cycle.tx.hash, 'tx-1');
  assert.equal((await createReplenisher(f.io, f.journal).tick()).status, 'replenished');
  assert.equal(f.prepared.filter(tx => tx.phase === 'withdraw').length, 1);
  assert.equal(f.completed.size, 3);
  assert.equal(f.state().remaining, '0');
});

test('only tracked fee proceeds are swapped, in capped batches, including fees earned during withdrawal', async () => {
  const f = setup(); f.setFees(MAX_BATCH * 3n);
  await createReplenisher(f.io, f.journal).tick();
  assert.equal(f.prepared.find(tx => tx.phase === 'swap').data.amount, String(MAX_BATCH));
  assert.equal(f.state().remaining, String(MAX_BATCH * 2n));
  await createReplenisher(f.io, f.journal).tick();
  assert.equal(f.prepared.filter(tx => tx.phase === 'withdraw').length, 1);
  assert.equal(f.state().remaining, String(MAX_BATCH));
});

test('fresh quote failure after withdrawal retains the fee proceeds and does not swap unsafely', async () => {
  let quotes = 0;
  const f = setup({ quote: async () => ++quotes === 1 ? { fee: 3000, minimum: 1000n } : undefined });
  await assert.rejects(createReplenisher(f.io, f.journal).tick(), /No liquid/);
  assert.equal(f.state().remaining, '4000');
  assert.equal(f.state().cycle.phase, 'swap');
  assert.equal(f.prepared.filter(tx => tx.phase === 'swap').length, 0);
});

test('three proven reverts pause signing; ambiguous failures never replace the saved transaction', async () => {
  const f = setup({ broadcast: async () => ({ status: 'failed' }) });
  const worker = createReplenisher(f.io, f.journal);
  for (let n = 0; n < 3; n++) assert.equal((await worker.tick()).status, 'retrying-reverted-transaction');
  assert.equal((await worker.tick()).status, 'paused-after-reverts');
  assert.equal(f.prepared.length, 3);
  assert.equal(f.state().remaining, '0');
});

test('router calldata enforces exact input, nonzero minimum, deadline and native WBT output to relayer', () => {
  const relayer = '0x68C67De1969D1ea00bB80E751ce70D33978ff373';
  const data = swapData(4000n, { fee: 3000, minimum: 500n }, relayer, 12345);
  const [deadline, calls] = routerInterface.decodeFunctionData('multicall(uint256,bytes[])', data);
  assert.equal(deadline, 12345n);
  const [swap] = routerInterface.decodeFunctionData('exactInputSingle', calls[0]);
  assert.equal(swap.tokenIn, TOKEN); assert.equal(swap.tokenOut, WWBT);
  assert.equal(swap.recipient, YETI_ROUTER); assert.equal(swap.amountIn, 4000n); assert.equal(swap.amountOutMinimum, 500n);
  const [minimum, recipient] = routerInterface.decodeFunctionData('unwrapWETH9', calls[1]);
  assert.equal(minimum, 500n); assert.equal(recipient, relayer);
});
