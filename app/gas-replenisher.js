import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Contract, Interface, Wallet, getAddress, keccak256, parseEther, formatEther } from 'ethers';
import { inspectToken, TOKEN, EXPLORER } from './chain.js';

// Published testnet deployments: https://docs.yetitrade.fi/reference/contracts
export const YETI_ROUTER = '0xe208cC685cD95D56E8ec6DEC9816476567fc6962';
export const YETI_QUOTER = '0x90f28c3a6233713d6Df00E5fa92a3f13EFe36191';
export const WWBT = '0x4200000000000000000000000000000000000006';
export const LOW_GAS = parseEther('0.05');
export const MAX_BATCH = 10_000_000n;
export const routerInterface = new Interface([
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns(uint256)',
  'function unwrapWETH9(uint256 amountMinimum,address recipient) payable',
  'function multicall(uint256 deadline,bytes[] data) payable returns(bytes[])',
  'function WETH9() view returns(address)',
]);

export function swapData(amount, quote, relayer, deadline) {
  return routerInterface.encodeFunctionData('multicall(uint256,bytes[])', [deadline, [
    routerInterface.encodeFunctionData('exactInputSingle', [[TOKEN, WWBT, quote.fee, YETI_ROUTER, amount, quote.minimum, 0]]),
    routerInterface.encodeFunctionData('unwrapWETH9', [quote.minimum, relayer]),
  ]]);
}

// The journal stores signed bytes before sending and tracks only USDT withdrawn by this worker.
export function createReplenisher(io, journal) {
  let running;
  async function run() {
    const state = journal.load() ?? { remaining: '0', cycle: null };
    const save = () => journal.save(state);
    const quote = async amount => {
      const result = await io.quote(amount);
      if (!result || result.minimum <= 0n) throw new Error('No liquid USDT/WWBT pool; fees retained');
      if (result.minimum < 2n * await io.gasBudget()) throw new Error('Fees too small to cover replenishment gas; fees retained');
      return result;
    };
    if (!state.cycle) {
      if (await io.relayerBalance() >= LOW_GAS) return { status: 'healthy' };
      const held = BigInt(state.remaining), pool = held ? 0n : await io.feePool();
      const available = held || pool;
      if (!available) return { status: 'waiting-for-fees' };
      const amount = available < MAX_BATCH ? available : MAX_BATCH;
      await quote(amount);
      state.cycle = { phase: held ? 'approve' : 'withdraw', amount: String(amount), attempts: 0, tx: null };
      save();
    }
    const cycle = state.cycle;
    for (let step = 0; step < 5; step++) {
      if (cycle.attempts >= 3) return { status: 'paused-after-reverts' };
      if (!cycle.tx) {
        let data;
        if (cycle.phase === 'reset') data = { amount: '0' };
        else if (cycle.phase === 'approve') {
          const allowance = await io.allowance();
          if (allowance === BigInt(cycle.amount)) { cycle.phase = 'swap'; save(); continue; }
          data = { amount: allowance === 0n ? cycle.amount : '0' };
          if (allowance !== 0n) cycle.phase = 'reset';
        } else if (cycle.phase === 'swap') {
          const fresh = await quote(BigInt(cycle.amount));
          data = { amount: cycle.amount, fee: fresh.fee, minimum: String(fresh.minimum), deadline: Math.floor(Date.now()/1000) + 120 };
        }
        cycle.tx = await io.prepare(cycle.phase, data);
        save();
      }
      const receipt = await io.broadcast(cycle.tx);
      if (receipt.status === 'pending') return { status: 'pending', hash: cycle.tx.hash };
      if (receipt.status === 'failed') {
        cycle.attempts++; cycle.tx = null; save();
        return { status: 'retrying-reverted-transaction' };
      }
      const hash = cycle.tx.hash;
      if (cycle.phase === 'withdraw') {
        if (!receipt.withdrawn || BigInt(receipt.withdrawn) < BigInt(cycle.amount)) throw new Error('Unexpected fee withdrawal receipt; inspect the saved transaction');
        state.remaining = String(BigInt(state.remaining) + BigInt(receipt.withdrawn));
        cycle.phase = 'approve';
      } else if (cycle.phase === 'reset') cycle.phase = 'approve';
      else if (cycle.phase === 'approve') cycle.phase = 'swap';
      else {
        state.remaining = String(BigInt(state.remaining) - BigInt(cycle.amount));
        state.cycle = null; state.lastSwap = hash; save();
        return { status: 'replenished', hash };
      }
      cycle.tx = null; cycle.attempts = 0; save();
    }
    return { status: 'pending' };
  }
  return { tick() { return running ??= run().finally(() => { running = null; }); } };
}

export async function createGasAdapter({ provider, token, owner, companyAddress, relayer }) {
  companyAddress = getAddress(companyAddress); relayer = getAddress(relayer);
  const company = new Contract(companyAddress, [
    'function owner() view returns(address)', 'function token() view returns(address)',
    'function feePool() view returns(uint256)', 'function withdrawFees(address)',
    'event FeesWithdrawn(address indexed to,uint256 amount)',
  ], provider);
  const router = new Contract(YETI_ROUTER, routerInterface, provider);
  const erc20 = new Contract(TOKEN, ['function approve(address,uint256) returns(bool)', 'function allowance(address,address) view returns(uint256)'], provider);
  const quoter = new Contract(YETI_QUOTER, ['function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns(uint256,uint160,uint32,uint256)'], provider);
  if ((await provider.getNetwork()).chainId !== 1874n || getAddress(await company.owner()) !== owner.address || getAddress(await company.token()) !== getAddress(TOKEN)) throw new Error('Wrong chain, company token or owner');
  if (owner.address === relayer || getAddress(await router.WETH9()) !== getAddress(WWBT)) throw new Error('Wrong relayer or wrapped WBT configuration');
  for (const address of [YETI_ROUTER, YETI_QUOTER]) if (await provider.getCode(address) === '0x') throw new Error('YetiTrade deployment is missing');
  const feePrice = async () => {
    const fees = await provider.getFeeData(), price = fees.maxFeePerGas ?? fees.gasPrice;
    if (!price || price <= 0n) throw new Error('Gas price unavailable');
    return price;
  };
  return {
    relayerBalance: () => provider.getBalance(relayer), feePool: () => company.feePool(),
    allowance: () => erc20.allowance(owner.address, YETI_ROUTER),
    // Conservative bound for withdrawal, zero-reset, exact approval and swap together.
    gasBudget: async () => await feePrice() * 900_000n,
    async quote(amount) {
      let best;
      // shortcut: direct USDT/WWBT pools only; add audited multi-hop routing if direct liquidity disappears.
      for (const fee of [100, 500, 3000, 10000]) {
        try {
          const [output] = await quoter.quoteExactInputSingle.staticCall([TOKEN, WWBT, amount, fee, 0]);
          if (!best || output > best.output) best = { fee, output, minimum: output * 9950n / 10_000n };
        } catch { /* Missing or illiquid fee tiers are not routes. */ }
      }
      return best;
    },
    async prepare(phase, data) {
      if ((await provider.getNetwork()).chainId !== 1874n) throw new Error('Wrong chain');
      let to, calldata;
      if (phase === 'withdraw') { to = companyAddress; calldata = company.interface.encodeFunctionData('withdrawFees', [owner.address]); }
      else if (phase === 'approve' || phase === 'reset') { to = TOKEN; calldata = erc20.interface.encodeFunctionData('approve', [YETI_ROUTER, data.amount]); }
      else {
        if (await token.balanceOf(owner.address) < BigInt(data.amount)) throw new Error('Withdrawn fees are no longer available');
        to = YETI_ROUTER; calldata = swapData(BigInt(data.amount), { fee: data.fee, minimum: BigInt(data.minimum) }, relayer, data.deadline);
      }
      const tx = await owner.populateTransaction({ to, data: calldata, chainId: 1874 });
      const price = tx.maxFeePerGas ?? tx.gasPrice;
      if (!price || tx.gasLimit > 600_000n || tx.gasLimit * price > parseEther('0.05')) throw new Error('Replenishment transaction exceeds gas cap');
      if (await provider.getBalance(owner.address) < tx.gasLimit * price + parseEther('0.001')) throw new Error('Owner wallet needs WBT to execute replenishment');
      const raw = await owner.signTransaction(tx);
      return { raw, hash: keccak256(raw), phase };
    },
    async broadcast(tx) {
      let receipt = await provider.getTransactionReceipt(tx.hash);
      if (!receipt) {
        try { await provider.broadcastTransaction(tx.raw); }
        catch { if (!(await provider.getTransaction(tx.hash))) throw new Error('Broadcast response unknown; original signed transaction retained'); }
        receipt = await provider.waitForTransaction(tx.hash, 1, 20_000);
      }
      if (!receipt) return { status: 'pending' };
      if (receipt.status !== 1) return { status: 'failed' };
      if (tx.phase === 'withdraw') {
        for (const log of receipt.logs) {
          if (log.address.toLowerCase() !== companyAddress.toLowerCase()) continue;
          try {
            const event = company.interface.parseLog(log);
            if (event?.name === 'FeesWithdrawn' && event.args.to === owner.address) return { status: 'confirmed', withdrawn: String(event.args.amount) };
          } catch {}
        }
        throw new Error('Fee withdrawal event missing; journal retained');
      }
      return { status: 'confirmed' };
    },
  };
}

function lockWorker(file) {
  const lock = new DatabaseSync(file);
  try {
    // A separate database holds the process lock; journal commits remain durable and independent.
    lock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE');
    return () => lock.close();
  } catch {
    lock.close(); throw new Error('A gas replenisher is already running or its lock is unavailable');
  }
}

async function main() {
  const directory = resolve(process.env.COMPANY_DATA_DIR || 'data/company/testnet'); mkdirSync(directory, { recursive: true });
  const unlock = lockWorker(join(directory, 'gas-worker-lock.sqlite'));
  let base, db;
  try {
    const setup = JSON.parse(await readFile(join(directory, 'setup.json'), 'utf8'));
    const deployment = JSON.parse(await readFile(join(directory, 'deployment.json'), 'utf8'));
    base = await inspectToken(process.env.RPC_URL);
    let owner;
    try { owner = (await Wallet.fromEncryptedJson(await readFile(join(homedir(), '.foundry/keystores/whitechain-testnet'), 'utf8'), process.env.OWNER_PASSWORD)).connect(base.provider); }
    catch { throw new Error('Could not unlock the original company owner keystore'); }
    const io = await createGasAdapter({ ...base, owner, companyAddress: deployment.address, relayer: setup.roles.relayer.address });
    db = new DatabaseSync(join(directory, 'gas-replenisher.sqlite'));
    db.exec('CREATE TABLE IF NOT EXISTS gas_journal(id INTEGER PRIMARY KEY, fingerprint TEXT NOT NULL, state TEXT NOT NULL)');
    const fingerprint = `${deployment.address}:${owner.address}:${setup.roles.relayer.address}:1874`;
    const saved = db.prepare('SELECT * FROM gas_journal WHERE id=1').get();
    if (saved && saved.fingerprint !== fingerprint) throw new Error('Gas journal belongs to another company or signer');
    const worker = createReplenisher(io, {
      load: () => { const row = db.prepare('SELECT state FROM gas_journal WHERE id=1').get(); return row ? JSON.parse(row.state) : null; },
      save: state => db.prepare('INSERT OR REPLACE INTO gas_journal VALUES(1,?,?)').run(fingerprint, JSON.stringify(state)),
    });
    let stop = false, wake;
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stop = true; wake?.(); });
    console.log(`Gas watcher: relayer ${setup.roles.relayer.address}; threshold ${formatEther(LOW_GAS)} WBT; 0.5% swap slippage.`);
    while (!stop) {
      try { const result = await worker.tick(); console.log(result.status + (result.hash ? ` ${EXPLORER}/tx/${result.hash}` : '')); }
      catch (error) { console.log('Replenishment paused: ' + (error.message.startsWith('Fees too small') || error.message.startsWith('No liquid') ? error.message : 'Check owner gas, RPC and journal; saved transactions are retained.')); }
      if (!stop) await new Promise(resolve => { const timer = setTimeout(resolve, 60_000); wake = () => { clearTimeout(timer); resolve(); }; });
    }
  } finally { db?.close(); base?.provider.destroy(); unlock(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Gas watcher could not start. Check the owner password, deployment and worker lock.'); process.exitCode = 1; });
}
