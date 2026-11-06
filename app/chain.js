import { readFile } from 'node:fs/promises';
import {
  Contract, FetchRequest, JsonRpcProvider, Wallet, TypedDataEncoder,
  getAddress, keccak256, toUtf8Bytes, verifyTypedData,
} from 'ethers';

export const TOKEN = '0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7';
export const NETWORK = 'eip155:1874';
export const EXPLORER = 'https://explorer.testnet.whitechain.io';
export const types = { TransferWithAuthorization: [
  { name: 'from', type: 'address' }, { name: 'to', type: 'address' },
  { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' },
  { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
] };
const abi = [
  'function name() view returns (string)', 'function decimals() view returns (uint8)',
  'function DOMAIN_SEPARATOR() view returns (bytes32)',
  'function balanceOf(address) view returns (uint256)',
  'function authorizationState(address,bytes32) view returns (bool)',
  'function transfer(address,uint256) returns (bool)',
  'function transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)',
];

export async function retryRPCRead(read) {
  for(let attempt=0;;attempt++) {
    try{return await read()}
    catch(error) {
      if(!['TIMEOUT','NETWORK_ERROR','ECONNRESET','ETIMEDOUT'].includes(error.code)||attempt===2)throw error;
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
  }
}

export async function inspectToken(rpc = 'https://rpc.testnet.whitechain.io') {
  if (new URL(rpc).protocol !== 'https:') throw new Error('RPC must use HTTPS');
  return retryRPCRead(async()=>{
  const request = new FetchRequest(rpc);
  request.timeout=10_000;
  request.setHeader('User-Agent', 'WhitechainHackathon/0.1');
  const provider = new JsonRpcProvider(request);
  try {
    if ((await provider.getNetwork()).chainId !== 1874n) throw new Error('Wrong chain: expected 1874');
    const token = new Contract(TOKEN, abi, provider);
    const [name, decimals, separator] = await Promise.all([token.name(), token.decimals(), token.DOMAIN_SEPARATOR()]);
    const domain = { name, version: '1', chainId: 1874, verifyingContract: TOKEN };
    if (TypedDataEncoder.hashDomain(domain).toLowerCase() !== separator.toLowerCase()) {
      throw new Error('Token signing domain differs from the verified implementation; refusing to sign');
    }
    if (decimals < 2n || decimals > 18n) throw new Error('Unsupported token decimals');
    // A view call confirms that the proxy exposes the authorization state API too.
    await token.authorizationState('0x0000000000000000000000000000000000000001', '0x' + '00'.repeat(32));
    return { provider, token, domain, decimals: Number(decimals) };
  } catch (error) { provider.destroy(); throw error; }
  });
}

export function checkAuthorization(domain, authorization, signature, expected) {
  const now = Math.floor(Date.now() / 1000);
  if (!authorization || !/^0x[0-9a-f]{64}$/i.test(authorization.nonce ?? '')) throw new Error('Invalid nonce');
  if (!/^\d+$/.test(String(authorization.value)) || BigInt(authorization.value) !== BigInt(expected.value)) throw new Error('Wrong payment amount');
  if (getAddress(authorization.from) !== getAddress(expected.from) || getAddress(authorization.to) !== getAddress(expected.to)) throw new Error('Wrong payment wallet');
  if (!Number.isSafeInteger(Number(authorization.validAfter)) || !Number.isSafeInteger(Number(authorization.validBefore)) ||
      Number(authorization.validAfter) >= now || Number(authorization.validBefore) <= now || Number(authorization.validBefore) > now + 300) throw new Error('Invalid authorization window');
  if (getAddress(verifyTypedData(domain, types, authorization, signature)) !== getAddress(expected.from)) throw new Error('Invalid payment signature');
}

export async function createChain(mode, db, env = process.env) {
  if (mode === 'simulated') {
    const domain = { name: 'Simulated Test USDT', version: '1', chainId: 1874, verifyingContract: TOKEN };
    return {
      mode, domain, decimals: 6,
      async prepareFunding(to, value, id) { return prepare({ kind: 'funding', to, value, id }); },
      async preparePayment(authorization, signature) {
        checkAuthorization(domain, authorization, signature, authorization);
        return prepare({ kind: 'payment', ...authorization });
      },
      async broadcast(raw) {
        const hash = keccak256(toUtf8Bytes(raw));
        const tx = JSON.parse(raw);
        if (!db.prepare('SELECT hash FROM simulated_transactions WHERE hash=?').get(hash)) {
          if (tx.kind === 'payment') {
            if (db.prepare('SELECT hash FROM simulated_transactions WHERE authorizer=? AND nonce=?').get(tx.from, tx.nonce)) throw new Error('Authorization already used');
            const available = await this.balance(tx.from);
            if (available < BigInt(tx.value)) throw new Error('Insufficient simulated token balance');
          }
          db.prepare('INSERT INTO simulated_transactions(hash,kind,recipient,authorizer,value,nonce) VALUES(?,?,?,?,?,?)')
            .run(hash, tx.kind, tx.to, tx.from ?? null, tx.value, tx.nonce ?? null);
        }
        return { status: 'confirmed', hash };
      },
      async balance(address) {
        return db.prepare('SELECT recipient,authorizer,value FROM simulated_transactions').all().reduce((sum, row) =>
          sum + (row.recipient.toLowerCase() === address.toLowerCase() ? BigInt(row.value) : 0n)
            - (row.authorizer?.toLowerCase() === address.toLowerCase() ? BigInt(row.value) : 0n), 0n);
      },
      async used(address, nonce) { return !!db.prepare('SELECT hash FROM simulated_transactions WHERE authorizer=? AND nonce=?').get(address, nonce); },
      close() {},
    };
  }
  if (mode !== 'testnet') throw new Error('CHAIN_MODE must be simulated or testnet');
  const chain = await inspectToken(env.RPC_URL);
  try {
    const load = async (path, password) => {
      if (!path || !password) throw new Error('Set encrypted keystore paths and RELAYER_PASSWORD / TREASURY_PASSWORD in your terminal environment');
      try { return (await Wallet.fromEncryptedJson(await readFile(path, 'utf8'), password)).connect(chain.provider); }
      catch { throw new Error('Could not read or decrypt the configured keystore. Check the local path and password.'); }
    };
    const relayer = await load(env.RELAYER_KEYSTORE, env.RELAYER_PASSWORD);
    const treasury = await load(env.TREASURY_KEYSTORE, env.TREASURY_PASSWORD);
    if (await chain.provider.getBalance(relayer.address) === 0n) throw new Error('Relayer needs test WBT');
    if (await chain.provider.getBalance(treasury.address) === 0n) throw new Error('Treasury needs test WBT for agent funding');
    const sign = async (wallet, data) => {
      if ((await chain.provider.getNetwork()).chainId !== 1874n) throw new Error('Chain changed');
      const tx = await wallet.populateTransaction({ to: TOKEN, data, chainId: 1874 });
      const raw = await wallet.signTransaction(tx);
      return { raw, hash: keccak256(raw) };
    };
    return {
      ...chain, mode, relayerAddress: relayer.address, treasuryAddress: treasury.address,
      async prepareFunding(to, value) {
        if (await chain.token.balanceOf(treasury.address) < BigInt(value)) throw new Error('Treasury needs test USDT');
        return sign(treasury, chain.token.interface.encodeFunctionData('transfer', [to, value]));
      },
      async preparePayment(a, signature) {
        checkAuthorization(chain.domain, a, signature, a);
        return sign(relayer, chain.token.interface.encodeFunctionData('transferWithAuthorization', [a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce, signature]));
      },
      async broadcast(raw, hash) {
        let receipt = await chain.provider.getTransactionReceipt(hash);
        if (!receipt) {
          try { await chain.provider.broadcastTransaction(raw); }
          catch (error) {
            if (!(await chain.provider.getTransaction(hash))) throw error;
          }
          receipt = await chain.provider.waitForTransaction(hash, 1, 20_000);
        }
        if (!receipt) return { status: 'pending', hash };
        if (receipt.status !== 1) return { status: 'reverted', hash };
        // A successful transaction alone is insufficient for tokens that return false.
        const expected = chain.token.interface.parseTransaction({ data: (await chain.provider.getTransaction(hash)).data });
        const to = expected.name === 'transfer' ? expected.args[0] : expected.args[1];
        const value = expected.name === 'transfer' ? expected.args[1] : expected.args[2];
        const topic = keccak256(toUtf8Bytes('Transfer(address,address,uint256)'));
        const transferred = receipt.logs.some(log => log.address.toLowerCase() === TOKEN.toLowerCase() && log.topics[0] === topic &&
          log.topics[2]?.slice(-40).toLowerCase() === to.slice(2).toLowerCase() && BigInt(log.data) === value);
        if (!transferred) return { status: 'reverted', hash };
        return { status: 'confirmed', hash };
      },
      async balance(address) { return chain.token.balanceOf(address); },
      async used(address, nonce) { return chain.token.authorizationState(address, nonce); },
      close() { chain.provider.destroy(); },
    };
  } catch (error) { chain.provider.destroy(); throw error; }
}

function prepare(tx) {
  const raw = JSON.stringify(tx);
  return { raw, hash: keccak256(toUtf8Bytes(raw)) };
}
