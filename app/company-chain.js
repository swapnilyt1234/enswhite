import { readFile } from 'node:fs/promises';
import { Contract, Interface, Wallet, Signature, TypedDataEncoder, AbiCoder, keccak256, toUtf8Bytes, verifyTypedData, getAddress } from 'ethers';
import { inspectToken, TOKEN, retryRPCRead } from './chain.js';

export const RECEIVE_TYPES = { ReceiveWithAuthorization: [
  { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
  { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
] };
export const TOP_UP_TYPES = { TopUp: [{ name: 'paymentId', type: 'bytes32' }, { name: 'amount', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] };
export const ALLOCATE_TYPES = { Allocate: [{ name: 'dept', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] };
export const COMPANY_ABI = [
  'function token() view returns(address)', 'function owner() view returns(address)', 'function finance() view returns(address)', 'function attester() view returns(address)', 'function feeBps() view returns(uint256)',
  'function companyBalance() view returns(uint256)', 'function feePool() view returns(uint256)', 'function allocationNonce() view returns(uint256)',
  'function limits(address) view returns(uint256 perCall,uint256 perDay)', 'function vendorMaxPrice(address) view returns(uint256)',
  'function topUp(bytes32,uint256,uint256,bytes)', 'function allocateBySig(address,uint256,uint256,uint256,bytes)',
  'function pay(address,address,uint256,bytes32,bytes32,uint256,uint256,uint8,bytes32,bytes32)',
  'event ToppedUp(bytes32 indexed paymentId,uint256 amount)', 'event Allocated(address indexed dept,uint256 amount)',
  'event Paid(bytes32 indexed requestId,address indexed dept,address indexed vendor,uint256 amount,uint256 fee)',
];
export const companyInterface = new Interface(COMPANY_ABI);
export const IDENTITY_ABI = COMPANY_ABI.filter(x=>!x.startsWith('function pay(')&&!x.startsWith('event Paid(')).concat([
  'function identityRequired() view returns(bool)',
  'function pay(address,address,uint256,bytes32,bytes32,uint256,uint256,uint8,bytes32,bytes32,(bytes32 deptNode,bytes32 vendorNode,uint256 weeklyMax,uint256 perCallMax,uint256 nameExpiry,uint256 validUntil),bytes)',
  'event Paid(bytes32 indexed requestId,address indexed dept,address indexed vendor,uint256 amount,uint256 fee,bytes32 deptNode,bytes32 vendorNode)',
]);
const identityInterface = new Interface(IDENTITY_ABI);
export function parseCompanyLog(log) { return companyInterface.parseLog(log) || identityInterface.parseLog(log); }
export const boundNonce = (vendor, requestId, salt) => keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'bytes32', 'bytes32'], [vendor, requestId, salt]));
export const companyDomain = address => ({ name: 'RelayCompany', version: '1', chainId: 1874, verifyingContract: address });
const ZERO = '0x0000000000000000000000000000000000000000';

export function createSimulatedCompanyChain(db, config) {
  db.exec(`CREATE TABLE IF NOT EXISTS company_events (id TEXT PRIMARY KEY,kind TEXT NOT NULL,data TEXT NOT NULL,hash TEXT NOT NULL,block INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS company_sim_balances (address TEXT PRIMARY KEY,units TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS company_sim_state (key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
  const state = key => BigInt(db.prepare('SELECT value FROM company_sim_state WHERE key=?').get(key)?.value ?? '0');
  const set = (key, value) => db.prepare('INSERT OR REPLACE INTO company_sim_state VALUES(?,?)').run(key, String(value));
  const balance = address => BigInt(db.prepare('SELECT units FROM company_sim_balances WHERE address=?').get(address.toLowerCase())?.units ?? '0');
  const add = (address, units) => db.prepare('INSERT OR REPLACE INTO company_sim_balances VALUES(?,?)').run(address.toLowerCase(), String(balance(address) + units));
  const address = '0x0000000000000000000000000000000000001874';
  const domain = { name: 'Tether USD', version: '1', chainId: 1874, verifyingContract: TOKEN };
  const chain = {
    mode: 'simulated', address, domain, companyDomain: companyDomain(address), relayerAddress: config.relayerAddress ?? ZERO,
    async checkConfiguration() {}, async balance(address) { return balance(address); },
    async snapshot() { return { companyBalance: String(state('credit')), feePool: String(state('fees')), relayerWbt: 'simulated', treasuryUsdt: 'simulated' }; },
    async allocationNonce() { return state('allocationNonce').toString(); },
    async prepare(kind, data) { const raw = JSON.stringify({ kind, data }); return { raw, hash: keccak256(toUtf8Bytes(raw)) }; },
    async broadcast(raw, hash) {
      const { kind, data } = JSON.parse(raw);
      const id = data.paymentId ?? data.requestId ?? `allocation:${data.nonce}`;
      if (db.prepare('SELECT id FROM company_events WHERE id=?').get(id)) return { state: 'confirmed', hash };
      db.exec('BEGIN IMMEDIATE');
      try {
        let event;
        if (kind === 'topup') {
          if (Number(data.deadline) < Date.now() / 1000 || getAddress(verifyTypedData(chain.companyDomain, TOP_UP_TYPES, { paymentId: data.paymentId, amount: data.amount, deadline: data.deadline }, data.signature)) !== getAddress(config.attesterAddress)) throw new Error('Invalid top-up attestation');
          set('credit', state('credit') + BigInt(data.amount));
          event = { paymentId: data.paymentId, amount: data.amount };
        } else if (kind === 'allocation') {
          const a = { dept: data.dept, amount: data.amount, nonce: data.nonce, deadline: data.deadline };
          if (Number(data.deadline) < Date.now() / 1000 || BigInt(data.nonce) !== state('allocationNonce') || getAddress(verifyTypedData(chain.companyDomain, ALLOCATE_TYPES, a, data.signature)) !== getAddress(config.financeAddress)) throw new Error('Invalid finance authorization');
          if (BigInt(data.amount) <= 0n || state('credit') < BigInt(data.amount) || !config.departments.some(d => d.address === data.dept)) throw new Error('Invalid allocation');
          set('credit', state('credit') - BigInt(data.amount)); set('allocationNonce', state('allocationNonce') + 1n); add(data.dept, BigInt(data.amount));
          event = { dept: data.dept, amount: data.amount };
        } else if (kind === 'payment') {
          const vendor = config.vendors.find(v => v.address === data.vendor), dept = config.departments.find(d => d.address === data.dept);
          const a = data.authorization, amount = BigInt(data.amount);
          if (!vendor || !dept || amount <= 0n || amount > BigInt(vendor.price) || amount > BigInt(dept.perCall)) throw new Error('Vendor or call limit rejected');
          if (a.to !== address || a.from !== data.dept || BigInt(a.value) !== amount || a.nonce !== boundNonce(data.vendor, data.requestId, data.salt) || Number(a.validAfter) >= Date.now()/1000 || Number(a.validBefore) <= Date.now()/1000 || getAddress(verifyTypedData(domain, RECEIVE_TYPES, a, data.signature)) !== data.dept) throw new Error('Invalid receive authorization');
          const dayKey = `spent:${data.dept}:${Math.floor(Date.now()/86400000)}`;
          if (state(dayKey) + amount > BigInt(dept.perDay) || balance(data.dept) < amount) throw new Error('Budget or daily limit exceeded');
          set(dayKey, state(dayKey) + amount);
          const fee = amount / 100n;
          add(data.dept, -amount); add(data.vendor, amount - fee); set('fees', state('fees') + fee);
          event = { requestId: data.requestId, dept: data.dept, vendor: data.vendor, amount: data.amount, fee: String(fee) };
        } else throw new Error('Unknown operation');
        const block = db.prepare('SELECT COUNT(*) n FROM company_events').get().n + 1;
        db.prepare('INSERT INTO company_events VALUES(?,?,?,?,?)').run(id, kind, JSON.stringify(event), hash, block);
        db.exec('COMMIT'); return { state: 'confirmed', hash };
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    async events() { return db.prepare('SELECT * FROM company_events ORDER BY block').all().map(row => ({ ...JSON.parse(row.data), kind: row.kind, hash: row.hash, block: row.block })); },
    close() {},
  };
  return chain;
}

export async function createRealCompanyChain(env, config) {
  const base = await inspectToken(env.RPC_URL);
  try {
    if (base.decimals !== 6) throw new Error('RelayCompany expects six-decimal USDT');
    const address = getAddress(env.RELAY_COMPANY_ADDRESS);
    const identityEnabled = env.ENS_ENABLED === 'true';
    const contract = new Contract(address, identityEnabled ? IDENTITY_ABI : COMPANY_ABI, base.provider);
    const paymentInterface = identityEnabled ? identityInterface : companyInterface;
    if (identityEnabled && !(await contract.identityRequired())) throw new Error('ENS mode requires a newly deployed EnsWhiteCompany contract');
    if (getAddress(await contract.token()) !== getAddress(TOKEN) || await contract.feeBps() !== 100n) throw new Error('Wrong company token or fee policy');
    const relayJson = await readFile(env.RELAYER_KEYSTORE, 'utf8');
    const relayer = (await Wallet.fromEncryptedJson(relayJson, env.RELAYER_PASSWORD)).connect(base.provider);
    const attester = await Wallet.fromEncryptedJson(await readFile(env.ATTESTER_KEYSTORE, 'utf8'), env.ATTESTER_PASSWORD);
    if (relayer.address === attester.address || relayer.address === getAddress(env.TREASURY_ADDRESS) || attester.address === getAddress(env.TREASURY_ADDRESS)) throw new Error('Relayer, treasury and attester must be separate wallets');
    if (getAddress(await contract.attester()) !== attester.address) throw new Error('Attester does not match deployed contract');
    if (await base.token.balanceOf(relayer.address) !== 0n || await base.token.balanceOf(attester.address) !== 0n || await base.provider.getBalance(attester.address) !== 0n) throw new Error('Relayer must hold only WBT; attester must hold no tokens');
    if (!Number.isSafeInteger(Number(env.COMPANY_DEPLOYMENT_BLOCK)) || Number(env.COMPANY_DEPLOYMENT_BLOCK) < 1) throw new Error('Set COMPANY_DEPLOYMENT_BLOCK');
    const start = Number(env.COMPANY_DEPLOYMENT_BLOCK);
    return {
      mode: 'testnet', address, provider: base.provider, domain: base.domain, companyDomain: { ...companyDomain(address), name: identityEnabled ? 'EnsWhiteCompany' : 'RelayCompany' }, relayerAddress: relayer.address,
      attester,
      async checkConfiguration() {
        if (getAddress(await contract.finance()) !== getAddress(config.financeAddress)) throw new Error('Run the owner setup commands to configure Finance');
        for (const dept of config.departments) {
          const limits = await contract.limits(dept.address);
          if (limits.perCall !== BigInt(dept.perCall) || limits.perDay !== BigInt(dept.perDay)) throw new Error('Onchain department limits differ from local policy');
          if (await base.provider.getBalance(dept.address) !== 0n) throw new Error('Department wallets must hold zero WBT');
        }
        for (const vendor of config.vendors) if (await contract.vendorMaxPrice(vendor.address) !== BigInt(vendor.price)) throw new Error('Register vendor prices before starting');
      },
      async balance(address) { return retryRPCRead(()=>base.token.balanceOf(address)); },
      async allocationNonce() { return String(await retryRPCRead(()=>contract.allocationNonce())); },
      async snapshot() {
        const [credit,fees,gas,treasury,pool]=await Promise.all([()=>contract.companyBalance(),()=>contract.feePool(),()=>base.provider.getBalance(relayer.address),()=>base.token.balanceOf(getAddress(env.TREASURY_ADDRESS)),()=>base.token.balanceOf(address)].map(read=>retryRPCRead(read)));
        const available=pool-credit-fees;
        return {companyBalance:String(credit),feePool:String(fees),relayerWbt:String(gas),treasuryUsdt:String(treasury),poolAvailable:String(available>0n?available:0n)};
      },
      async prepare(kind, data) {
        if ((await base.provider.getNetwork()).chainId !== 1874n) throw new Error('Wrong chain');
        if (await base.provider.getBalance(relayer.address) < 1000000000000000n) throw new Error('Relayer gas tank low; fund WBT before continuing');
        let args, method;
        if (kind === 'topup') { method = 'topUp'; args = [data.paymentId, data.amount, data.deadline, data.signature]; }
        else if (kind === 'allocation') { method = 'allocateBySig'; args = [data.dept, data.amount, data.nonce, data.deadline, data.signature]; }
        else { const a = data.authorization, sig = Signature.from(data.signature); method = 'pay'; args = [data.dept, data.vendor, data.amount, data.requestId, data.salt, a.validAfter, a.validBefore, sig.v, sig.r, sig.s]; }
        if (kind === 'payment' && identityEnabled) {
          if (!data.identity || !data.policySignature) throw new Error('Missing fresh ENS policy');
          args.push(data.identity,data.policySignature);
        }
        const tx = await relayer.populateTransaction({ to: address, data: paymentInterface.encodeFunctionData(method, args), chainId: 1874 });
        if (tx.gasLimit > 600000n) throw new Error('Relayer per-transaction gas cap exceeded');
        if (tx.gasLimit * (tx.maxFeePerGas ?? tx.gasPrice ?? 0n) > 50000000000000000n) throw new Error('Relayer maximum transaction fee exceeded');
        const raw = await relayer.signTransaction(tx); return { raw, hash: keccak256(raw) };
      },
      async broadcast(raw, hash) {
        let receipt = await base.provider.getTransactionReceipt(hash);
        if (!receipt) {
          try { await base.provider.broadcastTransaction(raw); }
          catch { if (!(await base.provider.getTransaction(hash))) throw new Error('RPC broadcast failed; saved transaction retained'); }
          receipt = await base.provider.waitForTransaction(hash, 1, 20_000);
        }
        if (!receipt) return { state: 'submitted', hash };
        return { state: receipt.status === 1 ? 'confirmed' : 'failed', hash };
      },
      async events() { return readCompanyEvents(base.provider, address, start); },
      close() { base.provider.destroy(); },
    };
  } catch (error) { base.provider.destroy(); throw error; }
}

const eventReaders=new WeakMap();
export async function readCompanyEvents(provider, address, start, vendor) {
  let readers=eventReaders.get(provider);if(!readers){readers=new Map();eventReaders.set(provider,readers)}
  const key=JSON.stringify([address.toLowerCase(),start,vendor?.toLowerCase()]),state=readers.get(key)||{events:[],end:null,anchor:null,pending:null};readers.set(key,state);
  if(state.pending)return state.pending;
  state.pending=(async()=>{
  const end=await retryRPCRead(()=>provider.getBlockNumber()),head=end>=start?await retryRPCRead(()=>provider.getBlock(end)):null;let from=start;
  if(end>=start&&!head?.hash)throw new Error('Company event head unavailable');
  // Recheck the recent window and its canonical anchor; never cache payment permission.
  if(state.end!==null&&end>=state.end&&state.anchor&&(await retryRPCRead(()=>provider.getBlock(state.anchor.number)))?.hash===state.anchor.hash)from=Math.max(start,state.end-11);
  const output=state.events.filter(event=>event.block<from);
  const paid = [companyInterface.getEvent('Paid').topicHash,identityInterface.getEvent('Paid').topicHash];
  for (let block = from; block <= end; block += 2000) {
    const logs = await retryRPCRead(()=>provider.getLogs({ address, fromBlock: block, toBlock: Math.min(block + 1999, end), ...(vendor ? { topics: [paid, null, null, '0x' + vendor.slice(2).toLowerCase().padStart(64, '0')] } : {}) }));
    for (const log of logs) {
      const event = parseCompanyLog(log); if (!event) continue;
      const fields = {};
      event.fragment.inputs.forEach((field, index) => { fields[field.name] = String(event.args[index]); });
      if (['Paid', 'ToppedUp', 'Allocated'].includes(event.name)) output.push({ ...fields, kind: { Paid: 'payment', ToppedUp: 'topup', Allocated: 'allocation' }[event.name], hash: log.transactionHash, block: log.blockNumber });
    }
  }
  const number=Math.max(start,end-12),anchor=end>=start?await retryRPCRead(()=>provider.getBlock(number)):null;
  if(end>=start&&!anchor?.hash)throw new Error('Company event checkpoint unavailable');
  if(head&&(await retryRPCRead(()=>provider.getBlock(end)))?.hash!==head.hash)throw new Error('Company chain changed during event scan; retry the read');
  state.events=output;state.end=end;state.anchor=anchor?{number,hash:anchor.hash}:null;
  return output.map(event=>({...event}));
  })().finally(()=>{state.pending=null});
  return state.pending;
}
