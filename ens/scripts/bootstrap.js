import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { AbiCoder, Contract, ContractFactory, Interface, JsonRpcProvider, Wallet, dnsEncode, getAddress, getBytes, keccak256, toUtf8Bytes } from 'ethers';
import { openStore } from '../../app/payments.js';
import { walletStore } from '../../app/company-store.js';
import { checkENSTransaction, populateENSTransaction } from '../../app/ens.js';

// Sepolia deployments published at https://docs.ens.domains/learn/deployments#sepolia-ensv2
const FACTORY='0xDa70306C98E97eCe36F997a21368e53298572991';
const REGISTRY_IMPL='0x9BD8a88719068D09ecee662f36C0E3856708366a';
const RESOLVER_IMPL='0x115eb53F0c60696633855F90b138178Fb40b2b2C';
const ALL=BigInt('0x'+'1'.repeat(64));
const registryABI=[
 'function initialize((address account,uint256 roleBitmap)[])',
 'function getState(uint256) view returns(uint8 status,uint64 expiry,address latestOwner,uint256 tokenId,uint256 resource)',
 'function getSubregistry(string) view returns(address)', 'function setSubregistry(uint256,address)', 'function setResolver(uint256,address)',
 'function setParent(address,string)', 'function grantRootRoles(uint256,address)', 'function revokeRootRoles(uint256,address)',
 'function register(string,address,address,address,uint256,uint64) returns(uint256)', 'function isEmancipated() view returns(bool)',
];
const resolverABI=['function initialize((address account,uint256 roleBitmap)[],bytes[])','function setAddress(bytes,uint256,bytes)','function setText(bytes,string,string)'];
const dir=resolve('data/ens'), source=resolve('data/company/testnet');
if(process.argv[2]==='apply'&&(existsSync(join(dir,'agent-discovery-v1/plan.json'))||(existsSync(join(dir,'runtime.json'))&&JSON.parse(await readFile(join(dir,'runtime.json'),'utf8')).discoveryVersion)))throw new Error('Discovery migration is active. Do not restore the original directory; use setup-agent-discovery.ps1 to resume.');
const parent=process.env.ENS_PARENT_NAME||'enswhite.eth', label=parent.split('.')[0];
if(!/^[a-z0-9-]+\.eth$/.test(parent))throw new Error('Use a normalized lowercase .eth parent');
const p=new JsonRpcProvider(process.env.SEPOLIA_RPC_URL||'https://ethereum-sepolia-rpc.publicnode.com',11155111,{cacheTimeout:0});
try {
 if((await p.getNetwork()).chainId!==11155111n)throw new Error('Use Sepolia, not Ethereum mainnet');
 const universal=new Contract('0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe',['function ROOT_REGISTRY() view returns(address)'],p);
 const root=new Contract(await universal.ROOT_REGISTRY(),['function getSubregistry(string) view returns(address)'],p);
 const ETH_REGISTRY=await root.getSubregistry('eth');
 const eth=new Contract(ETH_REGISTRY,registryABI,p);
 const state=await eth.getState(BigInt(keccak256(toUtf8Bytes(label))));
 if(process.argv[2]==='check'){
  console.log(JSON.stringify({network:'Sepolia ENSv2',parent,status:Number(state.status),owner:state.latestOwner,subregistry:await eth.getSubregistry(label),ready:Number(state.status)===2},null,2));
 }else{
  if(process.argv[2]!=='apply')throw new Error('Use check or apply');
  if(Number(state.status)!==2)throw new Error(`Register ${parent} separately on Sepolia at https://sepolia.app.ens.domains first. Mainnet ownership is not Sepolia ownership.`);
  let owner;
  try{owner=(await Wallet.fromEncryptedJson(await readFile(join(homedir(),'.foundry/keystores/whitechain-testnet'),'utf8'),process.env.OWNER_PASSWORD)).connect(p)}catch{throw new Error('Could not unlock the original owner keystore')}
  if(getAddress(state.latestOwner)!==owner.address)throw new Error('The original owner wallet must own the Sepolia parent name');
  const setup=JSON.parse(await readFile(join(source,'setup.json'),'utf8'));
  await mkdir(dir,{recursive:true});
  const companyLabel=process.env.ENS_COMPANY_LABEL||'acme';
  if(!/^[a-z0-9][a-z0-9-]{0,62}$/.test(companyLabel))throw new Error('Invalid company label');
  const plan={parent,companyLabel,owner:owner.address,finance:setup.departments.find(d=>d.id==='finance').address};
  const planFile=join(dir,'bootstrap-plan.json');
  try{if(JSON.stringify(JSON.parse(await readFile(planFile,'utf8')))!==JSON.stringify(plan))throw new Error('The saved ENS bootstrap belongs to another parent, company or owner');}
  catch(e){if(e.code!=='ENOENT')throw e;await writeFile(planFile,JSON.stringify(plan),{flag:'wx',mode:0o600});}
  async function send(id,transaction){
   const file=join(dir,id+'.json');let saved;
   try{saved=JSON.parse(await readFile(file,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
   if(!saved){
    const tx=await populateENSTransaction(owner,{...transaction,chainId:11155111});
    checkENSTransaction(tx,await p.getBalance(owner.address));
    const raw=await owner.signTransaction(tx);saved={raw,hash:keccak256(raw)};
    await writeFile(file,JSON.stringify(saved),{flag:'wx',mode:0o600});
   }
   let receipt=await p.getTransactionReceipt(saved.hash);
   if(!receipt){try{await p.broadcastTransaction(saved.raw)}catch{if(!await p.getTransaction(saved.hash))throw new Error('Unknown ENS broadcast; saved transaction retained')};receipt=await p.waitForTransaction(saved.hash,1,30_000)}
   if(!receipt||receipt.status!==1)throw new Error(`ENS step ${id} is pending or reverted; inspect ${saved.hash}. Do not delete its journal blindly.`);
   console.log(id+': '+saved.hash);return receipt;
  }
  const factory=new Contract(FACTORY,['function predictProxyAddress(address,uint256) view returns(address)','function verifyContract(address) view returns(address)','function deployProxy(address,uint256,bytes) returns(address)'],p);
  const regInterface=new Interface(registryABI),resInterface=new Interface(resolverABI);
  async function proxy(id,impl,initialization){
   const salt=BigInt(keccak256(toUtf8Bytes(`${parent}:${id}`))),address=await factory.predictProxyAddress(owner.address,salt);
   if(await p.getCode(address)==='0x')await send(id,{to:FACTORY,data:factory.interface.encodeFunctionData('deployProxy',[impl,salt,initialization])});
   if(getAddress(await factory.verifyContract(address))!==getAddress(impl))throw new Error('ENS proxy implementation mismatch');
   return address;
  }
  async function deploy(id,file,args){
   const artifact=JSON.parse(await readFile(file,'utf8'));
   const receipt=await send(id,await new ContractFactory(artifact.abi,artifact.bytecode.object,owner).getDeployTransaction(...args));
   return new Contract(receipt.contractAddress,artifact.abi,p);
  }
  const platform=await proxy('platform',REGISTRY_IMPL,regInterface.encodeFunctionData('initialize',[[[owner.address,ALL]]]));
  await send('platform-parent',{to:platform,data:regInterface.encodeFunctionData('setParent',[ETH_REGISTRY,label])});
  const old=await eth.getSubregistry(label);
  if(old!=='0x0000000000000000000000000000000000000000'&&getAddress(old)!==platform)throw new Error('Parent already points to a different registry; refusing to replace it');
  if(getAddress(old)!==platform)await send('attach-parent',{to:ETH_REGISTRY,data:regInterface.encodeFunctionData('setSubregistry',[keccak256(toUtf8Bytes(label)),platform])});
  const names=await deploy('names','ens/out/EnsWhiteNames.sol/EnsWhiteNames.json',[FACTORY,platform,REGISTRY_IMPL,RESOLVER_IMPL,dnsEncode(parent)]);
  await send('names-registrar',{to:platform,data:regInterface.encodeFunctionData('grantRootRoles',[1,names.target])});
  const companyHash=keccak256(toUtf8Bytes(companyLabel));
  const finance=setup.departments.find(d=>d.id==='finance').address;
  const companyReceipt=await send('company',{to:names.target,data:names.interface.encodeFunctionData('createCompany',[companyLabel,finance])});
  const info=await names.companies(companyHash),companyName=`${companyLabel}.${parent}`;
  for(const dept of setup.departments){
   const vendors=setup.vendors.filter(v=>v.dept===dept.id).map(v=>`${v.id}.vendors.${parent}`).join(',');
   await send('hire-'+dept.id,{to:names.target,data:names.interface.encodeFunctionData('hire',[companyHash,dept.id,dept.address,30*86400,dept.weekly,dept.perCall,vendors])});
  }
  const vendorRegistry=await proxy('vendors-registry',REGISTRY_IMPL,regInterface.encodeFunctionData('initialize',[[[owner.address,ALL]]]));
  await send('vendors-parent',{to:vendorRegistry,data:regInterface.encodeFunctionData('setParent',[platform,'vendors'])});
  const platformContract=new Contract(platform,registryABI,p),vendorState=await platformContract.getState(BigInt(keccak256(toUtf8Bytes('vendors'))));
  if(Number(vendorState.status)!==2)await send('vendors-name',{to:platform,data:regInterface.encodeFunctionData('register',['vendors',owner.address,vendorRegistry,'0x0000000000000000000000000000000000000000',0,18446744073709551615n])});
  else if(getAddress(await platformContract.getSubregistry('vendors'))!==vendorRegistry)throw new Error('Vendor namespace points elsewhere');
  const registrar=await deploy('vendor-registrar','ens/out/VendorRegistrar.sol/VendorRegistrar.json',[vendorRegistry]);
  const registry=new Contract(vendorRegistry,registryABI,p);
  if(!await registry.isEmancipated()){
   await send('vendors-registrar-role',{to:vendorRegistry,data:regInterface.encodeFunctionData('grantRootRoles',[1,registrar.target])});
   await send('vendors-emancipate',{to:vendorRegistry,data:regInterface.encodeFunctionData('revokeRootRoles',[ALL,owner.address])});
  }
  if(!await registry.isEmancipated())throw new Error('Vendor registry is not emancipated');
  for(const vendor of setup.vendors){
   const store=openStore(resolve('data/vendors/testnet',vendor.id));let wallet;
   try{wallet=walletStore(store.db,store.key)(vendor.id,'vendor')}finally{store.db.close()}
   if(wallet.address!==getAddress(vendor.address))throw new Error('Vendor wallet mismatch');
   const dns=dnsEncode(`${vendor.id}.vendors.${parent}`);
   const calls=[resInterface.encodeFunctionData('setAddress',[dns,2147485522,vendor.address]),resInterface.encodeFunctionData('setText',[dns,'x402.endpoint',`http://127.0.0.1:${vendor.port}/work`]),resInterface.encodeFunctionData('setText',[dns,'x402.price',vendor.price])];
   const resolver=await proxy('resolver-'+vendor.id,RESOLVER_IMPL,resInterface.encodeFunctionData('initialize',[[[vendor.address,ALL]],calls]));
   const digest=keccak256(AbiCoder.defaultAbiCoder().encode(['address','uint256','string','address','address'],[registrar.target,11155111,vendor.id,vendor.address,resolver]));
   const signature=await wallet.signMessage(getBytes(digest));
   const registered=await registry.getState(BigInt(keccak256(toUtf8Bytes(vendor.id))));
   if(Number(registered.status)!==2)await send('vendor-'+vendor.id,{to:registrar.target,data:registrar.interface.encodeFunctionData('registerFor',[vendor.id,vendor.address,resolver,signature])});
  }
  const companyURL=process.env.ENS_COMPANY_URL||'https://github.com/swapnilyt1234/enswhite';
  if(new URL(companyURL).protocol!=='https:')throw new Error('Company URL must use HTTPS');
  const brandingCalls=[['name','Acme Candles'],['url',companyURL],['avatar','https://raw.githubusercontent.com/swapnilyt1234/enswhite/main/docs/images/enswhite-avatar.svg']].map(([key,value])=>resInterface.encodeFunctionData('setText',['0x00',key,value]));
  const branding=await proxy('company-branding',RESOLVER_IMPL,resInterface.encodeFunctionData('initialize',[[[owner.address,ALL]],brandingCalls]));
  await send('company-branding-resolver',{to:platform,data:regInterface.encodeFunctionData('setResolver',[companyHash,branding])});
  for(const dept of setup.departments){
   const amount=1_000_000_000_000_000n;
   if(await p.getBalance(dept.address)<amount)await send('sepolia-gas-'+dept.id,{to:dept.address,value:amount});
  }
  const runtime={ENS_ENABLED:'true',ENS_PARENT_NAME:parent,ENS_COMPANY_NAME:companyName,ENS_COMPANY_REGISTRY:info.registry,ENS_REGISTRY_BLOCK:String(companyReceipt.blockNumber),ENS_NAMES_ADDRESS:names.target,SEPOLIA_RPC_URL:process.env.SEPOLIA_RPC_URL||'https://ethereum-sepolia-rpc.publicnode.com',vendorRegistry,vendorRegistrar:registrar.target,platform};
  await writeFile(join(dir,'runtime.json'),JSON.stringify(runtime,null,2));
  console.log('ENSv2 bootstrap complete. Public runtime configuration saved to data/ens/runtime.json.');
 }
}finally{p.destroy()}
