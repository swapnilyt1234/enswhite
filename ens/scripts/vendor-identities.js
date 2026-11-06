import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {createConnection} from 'node:net';
import {existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {Wallet,JsonRpcProvider,Contract,FetchRequest} from 'ethers';
import {openStore} from '../../app/payments.js';
import {walletStore,VENDORS} from '../../app/company-store.js';
import {AGENT_ABI,IDENTITY_REGISTRY,registrationURI} from '../../app/agent-identity.js';
import {REPUTATION_REGISTRY,REPUTATION_ABI} from '../../app/reputation.js';
import {retryRPCRead} from '../../app/chain.js';
import {sendDiscoveryTransaction} from '../../app/ens-discovery-send.js';

const listening=await new Promise(r=>{const socket=createConnection({host:'127.0.0.1',port:3004});socket.once('connect',()=>{socket.destroy();r(true)});socket.once('error',()=>r(false))});if(listening)throw new Error('Stop the company server before signing with vendor wallets.');
const runtime=JSON.parse(await readFile('data/ens/runtime.json','utf8')),origin=process.env.APP_ORIGIN;
if(!origin||new URL(origin).origin!==origin||!origin.startsWith('https://'))throw new Error('Public HTTPS origin required');
const request=new FetchRequest(runtime.SEPOLIA_RPC_URL);request.timeout=10000;
const provider=new JsonRpcProvider(request,11155111,{cacheTimeout:0}),dir=resolve('data/ens/vendor-identities-v1');await mkdir(dir,{recursive:true});
try{
 const planFile=join(dir,'origin.json');if(existsSync(planFile)){if(JSON.parse(await readFile(planFile,'utf8')).origin!==origin)throw new Error('Resume with the same public origin')}else await writeFile(planFile,JSON.stringify({origin}),{flag:'wx',mode:0o600});
 if((await retryRPCRead(()=>provider.getNetwork())).chainId!==11155111n||(await retryRPCRead(()=>new Contract(REPUTATION_REGISTRY,REPUTATION_ABI,provider).getIdentityRegistry())).toLowerCase()!==IDENTITY_REGISTRY.toLowerCase())throw new Error('Wrong Sepolia registries');
 const owner=(await Wallet.fromEncryptedJson(await readFile(join(homedir(),'.foundry/keystores/whitechain-testnet'),'utf8'),process.env.OWNER_PASSWORD)).connect(provider);delete process.env.OWNER_PASSWORD;
 const send=(id,signer,tx)=>sendDiscoveryTransaction(dir,provider,owner.address,id,signer,tx),entries=[];
 for(const label of [...VENDORS.map(x=>x.id),'founder-reviewer']){
  const store=openStore(label==='founder-reviewer'?resolve('data/company/ens-testnet'):resolve('data/vendors/testnet',label));
  try{
   const signer=walletStore(store.db,store.key)(label,label==='founder-reviewer'?'reviewer':'vendor').connect(provider);
   // A fixed, journaled transfer occurs once; reruns never silently replenish an emptied wallet.
   await send('fund-'+label,owner,{to:signer.address,value:1_000_000_000_000_000n});
   if(label==='founder-reviewer')continue;
   const identity=new Contract(IDENTITY_REGISTRY,AGENT_ABI,provider),receipt=await send('register-'+label,signer,{to:IDENTITY_REGISTRY,data:identity.interface.encodeFunctionData('register',[])});
   const event=receipt.logs.map(x=>{try{return x.address.toLowerCase()===IDENTITY_REGISTRY.toLowerCase()?identity.interface.parseLog(x):null}catch{return null}}).find(x=>x?.name==='Registered'&&x.args.owner===signer.address);
   if(!event)throw new Error('Vendor registration event missing');const id=String(event.args.agentId);
   const metadata={type:'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',name:`${label}.vendors.${runtime.ENS_PARENT_NAME}`,description:`Independent EnsWhite ${label} vendor; verifies Whitechain payment before delivery.`,services:[{name:'web',endpoint:`${origin}/vendors/${label}`},{name:'ENS',endpoint:`${label}.vendors.${runtime.ENS_PARENT_NAME}`,version:'2'}],registrations:[{agentId:Number(id),agentRegistry:`eip155:11155111:${IDENTITY_REGISTRY}`}],x402Support:true,active:true,supportedTrust:['reputation']};
   const uri=await send('uri-'+label,signer,{to:IDENTITY_REGISTRY,data:identity.interface.encodeFunctionData('setAgentURI',[id,registrationURI(metadata)])});
   if(await retryRPCRead(()=>identity.ownerOf(id))!==signer.address||await retryRPCRead(()=>identity.getAgentWallet(id))!==signer.address)throw new Error('Vendor identity ownership mismatch');
   entries.push({label,agentId:id,owner:signer.address,registry:IDENTITY_REGISTRY,registrationTransaction:receipt.hash,metadataTransaction:uri.hash});
  }finally{store.db.close()}
 }
 const file=resolve('docs/deployments/vendor-identities.json');await writeFile(file+'.next',JSON.stringify(entries,null,2));await rename(file+'.next',file);
 console.log('COMPLETE: vendors own their ERC-8004 identities; founder review service has Sepolia gas. Restart the company.');
}finally{provider.destroy()}
