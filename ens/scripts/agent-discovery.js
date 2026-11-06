import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {createConnection} from 'node:net';
import {Contract,ContractFactory,Wallet,JsonRpcProvider,FetchRequest,dnsEncode,keccak256,toUtf8Bytes,getAddress} from 'ethers';
import {openStore} from '../../app/payments.js';
import {walletStore} from '../../app/company-store.js';
import {createENSDirectory} from '../../app/ens.js';
import {sendDiscoveryTransaction} from '../../app/ens-discovery-send.js';
import {IDENTITY_REGISTRY,AGENT_ABI,registrationKey,agentRegistration,registrationURI} from '../../app/agent-identity.js';

const dir=resolve('data/ens/agent-discovery-v1'),runtimeFile=resolve('data/ens/runtime.json');
await mkdir(dir,{recursive:true});
const listening=await new Promise(r=>{const socket=createConnection({host:'127.0.0.1',port:3004});socket.once('connect',()=>{socket.destroy();r(true)});socket.once('error',()=>r(false))});
if(listening)throw new Error('Stop the company server before using department Sepolia signers.');
const origin=process.env.AGENT_PUBLIC_ORIGIN?.trim();if(!origin||new URL(origin).origin!==origin||!origin.startsWith('https://'))throw new Error('Provide the existing public HTTPS origin');
const runtime=JSON.parse(await readFile(runtimeFile,'utf8')),request=new FetchRequest(runtime.SEPOLIA_RPC_URL);request.timeout=10000;
const provider=new JsonRpcProvider(request,11155111,{cacheTimeout:0});let store,directory;
try{
 if((await provider.getNetwork()).chainId!==11155111n||await provider.getCode(IDENTITY_REGISTRY)==='0x')throw new Error('Sepolia ERC-8004 registry is unavailable');
 const owner=(await Wallet.fromEncryptedJson(await readFile(join(homedir(),'.foundry/keystores/whitechain-testnet'),'utf8'),process.env.OWNER_PASSWORD)).connect(provider);
 const registryABI=['function getState(uint256) view returns(uint8 status,uint64 expiry,address latestOwner,uint256 tokenId,uint256 resource)','function getSubregistry(string) view returns(address)','function setSubregistry(uint256,address)','function grantRootRoles(uint256,address)','function revokeRootRoles(uint256,address)'];
 const platform=new Contract(runtime.platform,registryABI,provider),companyLabel=runtime.ENS_COMPANY_NAME.split('.')[0],companyHash=keccak256(toUtf8Bytes(companyLabel));
 const parentState=await platform.getState(BigInt(companyHash));if(Number(parentState.status)!==2||getAddress(parentState.latestOwner)!==owner.address)throw new Error('Original owner must own the active company parent token');
 const planFile=join(dir,'plan.json');let plan;
 if(existsSync(planFile))plan=JSON.parse(await readFile(planFile,'utf8'));
 else{
  directory=createENSDirectory(runtime,provider);
  const employees=[];for(const label of ['marketing','support','finance'])employees.push({label,...await directory.employee(label)});
  plan={origin,owner:owner.address,runtime,employees};await writeFile(planFile,JSON.stringify(plan),{flag:'wx',mode:0o600});
 }
 if(plan.origin!==origin||plan.owner!==owner.address||plan.runtime.platform!==runtime.platform)throw new Error('Resume with the same origin, owner and namespace');
 const companyDir=resolve('data/company/ens-testnet');if(!existsSync(join(companyDir,'payments.sqlite'))||!existsSync(join(companyDir,'wallet.key')))throw new Error('Existing company wallet store is missing');
 store=openStore(companyDir);const getWallet=walletStore(store.db,store.key);
 for(const table of ['ens_writes','company_jobs'])if(store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)&&store.db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE state IN ('queued','submitted')`).get().n)throw new Error('Outstanding signing jobs exist. Restart the company, let them settle, then stop it before migration. Do not delete signed journals.');
 if(store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='company_budget_requests'").get()&&store.db.prepare("SELECT COUNT(*) n FROM company_budget_requests WHERE state IN ('ens','allocating')").get().n)throw new Error('Finish the in-progress Finance request before migration.');
 for(const employee of plan.employees){if(!store.db.prepare('SELECT address FROM company_wallets WHERE name=?').get(employee.label)||getWallet(employee.label,'department').address!==employee.wallet)throw new Error('Existing department wallet differs from ENS employee');}
 const send=(id,signer,transaction)=>sendDiscoveryTransaction(dir,provider,owner.address,id,signer,transaction);
 const originalNames=new Contract(plan.runtime.ENS_NAMES_ADDRESS,['function factory() view returns(address)','function registryImplementation() view returns(address)','function resolverImplementation() view returns(address)'],provider);
 const artifact=JSON.parse(await readFile('ens/out/EnsWhiteNames.sol/EnsWhiteNames.json','utf8'));
 const factory=new ContractFactory(artifact.abi,artifact.bytecode.object,owner);
 const deployment=await send('controller',owner,await factory.getDeployTransaction(await originalNames.factory(),runtime.platform,await originalNames.registryImplementation(),await originalNames.resolverImplementation(),dnsEncode(runtime.ENS_PARENT_NAME)));
 const names=new Contract(deployment.contractAddress,artifact.abi,provider),finance=plan.employees.find(x=>x.label==='finance').wallet;
 await send('registrar-role',owner,{to:runtime.platform,data:platform.interface.encodeFunctionData('grantRootRoles',[1,names.target])});
 const adoption=await send('adopt-company',owner,{to:names.target,data:names.interface.encodeFunctionData('adoptCompany',[companyLabel,finance])});
 const info=await names.companies(companyHash),pointer=getAddress(await platform.getSubregistry(companyLabel));
 if(pointer!==getAddress(plan.runtime.ENS_COMPANY_REGISTRY)&&pointer!==getAddress(info.registry))throw new Error('Company parent pointer changed unexpectedly; refusing replacement');
 const entries=[];
 const identity=new Contract(IDENTITY_REGISTRY,AGENT_ABI,provider);
 for(const employee of plan.employees){
  const signer=getWallet(employee.label,'department').connect(provider);if(signer.address!==employee.wallet)throw new Error('Department wallet differs from ENS employee');
  const term=Math.floor(Number(employee.expiry)-Date.now()/1000);if(term<60)throw new Error('Saved employee term expired. Inspect migration before continuing.');
  await send('hire-'+employee.label,owner,{to:names.target,data:names.interface.encodeFunctionData('hire',[companyHash,employee.label,employee.wallet,term,employee.weekly,employee.perCall,employee.vendors.join(',')])});
  const registered=await send('register-'+employee.label,signer,{to:IDENTITY_REGISTRY,data:identity.interface.encodeFunctionData('register',[])});
  const event=registered.logs.filter(x=>x.address.toLowerCase()===IDENTITY_REGISTRY.toLowerCase()).map(x=>{try{return identity.interface.parseLog(x)}catch{return null}}).find(x=>x?.name==='Registered'&&getAddress(x.args.owner)===signer.address);if(!event)throw new Error('ERC-8004 registration event missing');
  const agentId=String(event.args.agentId);if(await identity.ownerOf(agentId)!==signer.address||await identity.getAgentWallet(agentId)!==signer.address)throw new Error('Agent owner/wallet mismatch');
  const metadata=agentRegistration(employee.label,employee.name,origin,agentId);
  const uri=await send('uri-'+employee.label,signer,{to:IDENTITY_REGISTRY,data:identity.interface.encodeFunctionData('setAgentURI',[agentId,registrationURI(metadata)])});
  const context=JSON.stringify({name:employee.name,department:employee.label,company:runtime.ENS_COMPANY_NAME,role:employee.label==='marketing'?'Plans campaigns, commissions copy and banners, assembles Campaign Kits':employee.label==='support'?'Commissions customer help in Hindi or Marathi':'Reviews spend, requests scoped budget edits and signs allocations',paymentPolicy:'ENS employment and company contract limits apply independently of discovery. Custom x402 enswhite-receive on Whitechain Sepolia. No public signing endpoint.'});
  for(const [suffix,key,value] of [['context','agent-context',context],['web','agent-endpoint[web]',`${origin}/agents/${employee.label}`],['binding',registrationKey(11155111,IDENTITY_REGISTRY,agentId),'1']])await send(suffix+'-'+employee.label,owner,{to:names.target,data:names.interface.encodeFunctionData('setAgentMetadata',[companyHash,employee.label,key,value])});
  const companyRegistry=new Contract(info.registry,['function getResolver(string) view returns(address)'],provider),resolver=await companyRegistry.getResolver(employee.label),text=new Contract(resolver,['function setText(bytes,string,string)'],provider);
  await send('status-'+employee.label,signer,{to:resolver,data:text.interface.encodeFunctionData('setText',[dnsEncode(employee.name),'enswhite.status',employee.status||'active'])});
  entries.push({label:employee.label,name:employee.name,agentId,registry:IDENTITY_REGISTRY,owner:signer.address,registrationTransaction:registered.hash,metadataTransaction:uri.hash});
 }
 if(pointer!==getAddress(info.registry))await send('attach-directory',owner,{to:runtime.platform,data:platform.interface.encodeFunctionData('setSubregistry',[companyHash,info.registry])});
 await send('retire-old-registrar',owner,{to:runtime.platform,data:platform.interface.encodeFunctionData('revokeRootRoles',[1,plan.runtime.ENS_NAMES_ADDRESS])});
 const next={...plan.runtime,ENS_NAMES_ADDRESS:names.target,ENS_COMPANY_REGISTRY:info.registry,ENS_REGISTRY_BLOCK:String(adoption.blockNumber),discoveryVersion:1};
 const identitiesFile=resolve('docs/deployments/agent-identities.json');await writeFile(identitiesFile+'.next',JSON.stringify(entries,null,2));await rename(identitiesFile+'.next',identitiesFile);
 await writeFile(runtimeFile+'.next',JSON.stringify(next,null,2));await rename(runtimeFile+'.next',runtimeFile);
 const manifestFile=resolve('docs/deployments/enswhite-testnets.json'),manifest=JSON.parse(await readFile(manifestFile,'utf8'));manifest.ens={...manifest.ens,...next};await writeFile(manifestFile+'.next',JSON.stringify(manifest,null,2));await rename(manifestFile+'.next',manifestFile);
 const check=createENSDirectory(next,provider);for(const employee of plan.employees){const result=await check.employee(employee.label);if(!result.discovery.binding.verified)throw new Error('Post-migration binding check failed for '+employee.label)}
 console.log('COMPLETE: three ERC-8004 identities, ENSIP-25 bindings and ENSIP-26 contexts verified. Restart company and public services. Whitechain balances and vendor registry were not changed.');
}finally{store?.db.close();directory?.close();provider.destroy()}
