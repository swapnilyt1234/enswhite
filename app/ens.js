import {retryRPCRead} from './chain.js';
import {createTestnetProvider} from './testnet-provider.js';
import { Contract, Interface, getAddress, keccak256, namehash, toUtf8Bytes, parseEther } from 'ethers';
import {identityManifest,identityContract,verifyAgentBinding} from './agent-identity.js';
export const WHITECHAIN_COIN_TYPE = 2147485522;
export const IDENTITY_TYPES = { Identity: [
  {name:'requestId',type:'bytes32'},{name:'dept',type:'address'},{name:'vendor',type:'address'},
  {name:'deptNode',type:'bytes32'},{name:'vendorNode',type:'bytes32'},
  {name:'weeklyMax',type:'uint256'},{name:'perCallMax',type:'uint256'},
  {name:'nameExpiry',type:'uint256'},{name:'validUntil',type:'uint256'},
] };
export const ENS_REGISTRY_ABI = [
  'function getState(uint256) view returns(uint8 status,uint64 expiry,address latestOwner,uint256 tokenId,uint256 resource)',
  'function getResolver(string) view returns(address)',
  'event LabelRegistered(uint256 indexed tokenId,bytes32 indexed labelHash,string label,address owner,uint64 expiry,address indexed sender)',
];
export const ENS_NAMES_ABI = [
  'function companies(bytes32) view returns(address owner,address finance,address registry,bytes dns)',
  'function hire(bytes32,string,address,uint64,string,string,string) returns(address)',
  'function fire(bytes32,string)', 'function renew(bytes32,string,uint64)',
  'function createCompany(string,address) returns(address)',
];
export function checkENSTransaction(tx,balance) {
  if(BigInt(tx.chainId)!==11155111n)throw new Error('ENS transactions must use Sepolia');
  const gas=BigInt(tx.gasLimit??0),price=BigInt(tx.maxFeePerGas??tx.gasPrice??0);
  // Sepolia's state-creation gas is included in deployment estimates after Glamsterdam.
  const gasCap=tx.to?8_000_000n:20_000_000n;
  if(gas<=0n||price<=0n||gas>gasCap)throw new Error(`ENS transaction exceeds gas policy: estimated ${gas} gas, cap ${gasCap}; fee rate ${price} wei`);
  const maximum=gas*price;
  if(maximum>parseEther('0.005'))throw new Error('ENS transaction maximum fee exceeds 0.005 test ETH');
  if(BigInt(balance)<maximum+BigInt(tx.value??0))throw new Error('Owner needs more Sepolia ETH');
}

export async function populateENSTransaction(signer,transaction) {
  for(let attempt=0;;attempt++) {
    try{return await signer.populateTransaction(transaction)}
    catch(error) {
      // Public RPC nodes can estimate against state preceding the last confirmed deployment.
      if(error.code!=='CALL_EXCEPTION'||error.action!=='estimateGas'||attempt===3)throw error;
      await new Promise(resolve=>setTimeout(resolve,3000));
    }
  }
}

export function createENSDirectory(env = process.env, connection) {
  if (!env.ENS_COMPANY_NAME || !env.ENS_COMPANY_REGISTRY || !env.ENS_REGISTRY_BLOCK) throw new Error('Configure the ENS company name, registry and deployment block');
  const url = env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
  if (new URL(url).protocol !== 'https:') throw new Error('Sepolia RPC must use HTTPS');
  const provider = connection || createTestnetProvider(url,11155111);
  const registry = new Contract(env.ENS_COMPANY_REGISTRY, ENS_REGISTRY_ABI, provider);
  const registrations=identityManifest(env.ENS_IDENTITY_FILE);
  const hireReceipts=new Map();
  async function resolver(name) {
    if ((await retryRPCRead(()=>provider.getNetwork())).chainId !== 11155111n) throw new Error('ENS must resolve on Sepolia');
    const result = await retryRPCRead(()=>provider.getResolver(name));
    if (!result) throw new Error('ENS name does not resolve: ' + name);
    return result;
  }
  async function employee(label) {
    const name = `${label}.${env.ENS_COMPANY_NAME}`;
    const state = await retryRPCRead(()=>registry.getState(BigInt(keccak256(toUtf8Bytes(label)))));
    if (Number(state.status) !== 2 || Number(state.expiry) <= Date.now()/1000) throw new Error('Employee is fired or expired');
    const r = await resolver(name);
    const [wallet, weekly, perCall, vendors, status] = await Promise.all([
      retryRPCRead(()=>r.getAddress(WHITECHAIN_COIN_TYPE)), retryRPCRead(()=>r.getText('enswhite.budget.weekly')),
      retryRPCRead(()=>r.getText('enswhite.limit.perCall')), retryRPCRead(()=>r.getText('enswhite.vendors')), retryRPCRead(()=>r.getText('enswhite.status')),
    ]);
    if (!wallet || !/^\d+$/.test(weekly || '') || !/^\d+$/.test(perCall || '')) throw new Error('Employee records are incomplete');
    if (getAddress(wallet) !== getAddress(state.latestOwner)) throw new Error('Employee token owner and wallet differ');
    const identity={ name, node: namehash(name), wallet: getAddress(wallet), expiry: String(state.expiry), weekly, perCall, status:status||'', vendors: (vendors || '').split(',').map(x=>x.trim()).filter(Boolean), tokenId: String(state.tokenId), resolver: r.address };
    const entry=registrations.find(x=>x.name===name);
    identity.discovery={context:await retryRPCRead(()=>r.getText('agent-context')),web:await retryRPCRead(()=>r.getText('agent-endpoint[web]')),binding:entry?await verifyAgentBinding(identity,entry,key=>retryRPCRead(()=>r.getText(key)),identityContract(provider)).catch(()=>({verified:false,reason:'Identity registry verification unavailable'})):{verified:false,reason:'ERC-8004 registration not configured'}};
    return identity;
  }
  return {
    employee,
    companyName: env.ENS_COMPANY_NAME,
    provider,
    async branding() {
      const r=await resolver(env.ENS_COMPANY_NAME);
      const [name,avatar,url]=await Promise.all(['name','avatar','url'].map(key=>retryRPCRead(()=>r.getText(key))));
      const https=value=>{try{return new URL(value).protocol==='https:'?value:null}catch{return null}};
      return {name:name||env.ENS_COMPANY_NAME,avatar:https(avatar),url:https(url)};
    },
    async transaction(action,label,wallet,policy,term=30*86400) {
      if((await retryRPCRead(()=>provider.getNetwork())).chainId!==11155111n)throw new Error('ENS management must use Sepolia');
      if(!env.ENS_NAMES_ADDRESS || !['hire','fire','renew'].includes(action) || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(label))throw new Error('Invalid ENS management request');
      const names=new Contract(env.ENS_NAMES_ADDRESS,ENS_NAMES_ABI,provider);
      const companyHash=keccak256(toUtf8Bytes(env.ENS_COMPANY_NAME.split('.')[0]));
      const info=await names.companies(companyHash);
      if(getAddress(info.registry)!==getAddress(env.ENS_COMPANY_REGISTRY))throw new Error('ENS registrar does not manage this company');
      if(!Number.isSafeInteger(term)||term<60||term>365*86400)throw new Error('Term must be between one minute and one year');
      const args=action==='hire'?[companyHash,label,getAddress(wallet),term,policy.weekly,policy.perCall,policy.vendors.join(',')]:action==='renew'?[companyHash,label,Math.floor(Date.now()/1000)+term]:[companyHash,label];
      return {chainId:'0xaa36a7',from:info.owner,to:getAddress(env.ENS_NAMES_ADDRESS),data:new Interface(ENS_NAMES_ABI).encodeFunctionData(action,args)};
    },
    async signup(label,finance) {
      if((await retryRPCRead(()=>provider.getNetwork())).chainId!==11155111n)throw new Error('ENS management must use Sepolia');
      if(!env.ENS_NAMES_ADDRESS||!/^[a-z0-9][a-z0-9-]{0,62}$/.test(label))throw new Error('Use a lowercase company label');
      const names=new Contract(env.ENS_NAMES_ADDRESS,ENS_NAMES_ABI,provider);
      const current=await names.companies(keccak256(toUtf8Bytes(env.ENS_COMPANY_NAME.split('.')[0])));
      const existing=await names.companies(keccak256(toUtf8Bytes(label)));
      if(getAddress(current.registry)!==getAddress(env.ENS_COMPANY_REGISTRY))throw new Error('Company registry mismatch');
      if(existing.owner!=='0x0000000000000000000000000000000000000000')throw new Error('Company label already registered');
      return {chainId:'0xaa36a7',from:current.owner,to:getAddress(env.ENS_NAMES_ADDRESS),data:names.interface.encodeFunctionData('createCompany',[label,getAddress(finance)]),name:`${label}.${env.ENS_PARENT_NAME}`};
    },
    async authorize(label, vendorName, expectedWallet, expectedVendor, endpoint, amount) {
      const agent = await employee(label);
      if (agent.wallet !== getAddress(expectedWallet) || !agent.vendors.includes(vendorName) || BigInt(amount) > BigInt(agent.perCall)) throw new Error('ENS employee policy rejected payment');
      const vendor = await resolver(vendorName);
      const [wallet, registeredEndpoint] = await Promise.all([retryRPCRead(()=>vendor.getAddress(WHITECHAIN_COIN_TYPE)), retryRPCRead(()=>vendor.getText('x402.endpoint'))]);
      if (!wallet || getAddress(wallet) !== getAddress(expectedVendor) || registeredEndpoint !== endpoint) throw new Error('Vendor wallet or endpoint disagrees with ENS');
      return { ...agent, vendorNode: namehash(vendorName), vendorName, vendorWallet: getAddress(wallet), endpoint: registeredEndpoint, validUntil: String(Math.min(Number(agent.expiry), Math.floor(Date.now()/1000)+60)) };
    },
    async organization() {
      const start = Number(env.ENS_REGISTRY_BLOCK), end = await provider.getBlockNumber();
      if (!Number.isSafeInteger(start) || start < 1) throw new Error('Invalid ENS deployment block');
      const labels = new Map();
      for (let block=start;block<=end;block+=2000) {
        for (const event of await registry.queryFilter(registry.filters.LabelRegistered(), block, Math.min(block+1999,end))) labels.set(event.args.labelHash,{label:event.args.label,hash:event.transactionHash});
      }
      const result=[];
      const financeRecord=await employee('finance').catch(()=>null),finance=financeRecord?.wallet;
      for (const {label,hash} of labels.values()) {
        const state=await retryRPCRead(()=>registry.getState(BigInt(keccak256(toUtf8Bytes(label)))));
        if (Number(state.status)===2 && Number(state.expiry)>Date.now()/1000){
          const identity=label==='finance'&&financeRecord?financeRecord:await employee(label),permissions=new Contract(identity.resolver,['function hasRoles(uint256,uint256,address) view returns(bool)'],provider);
          const [statusRole,budgetRole]=await Promise.all([permissions.hasRoles(BigInt(keccak256(toUtf8Bytes('enswhite.status'))),16,identity.wallet),finance?permissions.hasRoles(BigInt(keccak256(toUtf8Bytes('enswhite.budget.weekly'))),16,finance):false]);identity.roles={status:statusRole,financeBudget:budgetRole};
          if(!hireReceipts.has(hash)){const receipt=await provider.getTransactionReceipt(hash);if(receipt)hireReceipts.set(hash,receipt)}
          const receipt=hireReceipts.get(hash),events=new Interface(['event EmployeeHired(bytes32 indexed companyHash,string label,address wallet,address resolver,uint64 expiry)','event EACRolesChanged(uint256 indexed resource,address indexed account,uint256 oldRoleBitmap,uint256 newRoleBitmap)']);
          const parsed=receipt?.logs.map(log=>{try{return {...events.parseLog(log),address:log.address}}catch{return null}}).filter(Boolean)||[];
          identity.hire={hash,resolverDeployed:parsed.some(x=>x.name==='EmployeeHired'&&x.args.resolver.toLowerCase()===identity.resolver.toLowerCase()&&x.args.wallet.toLowerCase()===identity.wallet.toLowerCase()),badgeMinted:true,financeRoleGranted:parsed.some(x=>x.name==='EACRolesChanged'&&x.address.toLowerCase()===identity.resolver.toLowerCase()&&x.args.account.toLowerCase()===finance?.toLowerCase()&&x.args.resource===BigInt(keccak256(toUtf8Bytes('enswhite.budget.weekly')))&&(x.args.newRoleBitmap&16n)!==0n)};
          result.push(identity);
        }
      }
      return result;
    },
    close() { if (!connection) provider.destroy(); },
  };
}
