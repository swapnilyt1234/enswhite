import { inspectToken, TOKEN, NETWORK } from './chain.js';
const chain = await inspectToken(process.env.RPC_URL);
try { console.log(JSON.stringify({ network: NETWORK, token: TOKEN, decimals: chain.decimals, domain: chain.domain, authorizationState: 'available' }, null, 2)); }
finally { chain.provider.destroy(); }
