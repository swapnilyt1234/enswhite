import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID,randomBytes} from 'node:crypto';
import {Wallet,Contract,ContractFactory,keccak256,toUtf8Bytes} from 'ethers';
import {createLaunchStore} from './launch-store.js';
import {createProvisionSender} from './provision-sender.js';
import {openStore} from './payments.js';
import {walletStore,DEPARTMENTS,VENDORS} from './company-store.js';
import {IDENTITY_REGISTRY,AGENT_ABI,registrationURI,registrationKey,agentRegistration} from './agent-identity.js';
import {TOKEN} from './chain.js';
import {createTestnetProvider} from './testnet-provider.js';
import {createENSDirectory} from './ens.js';

const root=resolve('data/launch'),queue=createLaunchStore(root),db=queue.db,instance=randomUUID();let stopping=false,timer;
const runtime=JSON.parse(await readFile('data/ens/runtime.json','utf8'));
if(!process.env.APP_ORIGIN||new URL(process.env.APP_ORIGIN).origin!==process.env.APP_ORIGIN||!process.env.APP_ORIGIN.startsWith('https://'))throw new Error('Existing HTTPS origin required');
const sepolia=createTestnetProvider(runtime.SEPOLIA_RPC_URL,11155111),whitechain=createTestnetProvider('https://rpc.testnet.whitechain.io',1874);
function lease(){const row=db.prepare('SELECT * FROM launch_worker WHERE id=1').get();if(stopping||row?.instance!==instance||row.heartbeat<Date.now()-30000)throw new Error('Launch worker lease lost')}
try{
 const old=db.prepare('SELECT * FROM launch_worker WHERE id=1').get();if(old?.heartbeat>Date.now()-30000)throw new Error('Another launch worker is active');
 db.prepare('INSERT OR REPLACE INTO launch_worker VALUES(1,?,?)').run(instance,Date.now());
 timer=setInterval(()=>db.prepare('UPDATE launch_worker SET heartbeat=? WHERE id=1 AND instance=?').run(Date.now(),instance),5000);timer.unref();
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{stopping=true});
 const owner=await Wallet.fromEncryptedJson(await readFile(join(homedir(),'.foundry/keystores/whitechain-testnet'),'utf8'),process.env.OWNER_PASSWORD);delete process.env.OWNER_PASSWORD;
 const namesArtifact=JSON.parse(await readFile('ens/out/EnsWhiteNames.sol/EnsWhiteNames.json','utf8')),bankArtifact=JSON.parse(await readFile('out/EnsWhiteCompany.sol/EnsWhiteCompany.json','utf8'));
 const names=new Contract(runtime.ENS_NAMES_ADDRESS,namesArtifact.abi,sepolia),send=createProvisionSender(db,lease);
 const vendors=[];for(const v of VENDORS){const store=openStore(resolve('data/vendors/testnet',v.id));try{vendors.push({...v,address:walletStore(store.db,store.key)(v.id,'vendor').address})}finally{store.db.close()}}
 async function provision(job){
  const directory=join(root,job.id);await mkdir(directory,{recursive:true});
  const store=openStore(directory),getWallet=walletStore(store.db,store.key),finance=getWallet('finance','department'),hash=keccak256(toUtf8Bytes(job.label)),ownerSep=owner.connect(sepolia),ownerWbt=owner.connect(whitechain);
  try{
   if(!db.prepare('SELECT id FROM launch_transactions WHERE launch=? AND step=?').get(job.id,'test-pool')){const token=new Contract(TOKEN,['function balanceOf(address) view returns(uint256)'],whitechain);if(await token.balanceOf(owner.address)<5_000_000n)throw new Error('Owner treasury needs 5 test USDT before starting this new company');}
   const launched=await send(job.id,'launch-company',ownerSep,{to:names.target,data:names.interface.encodeFunctionData('createCompany',[job.label,finance.address])});
   const info=await names.companies(hash);
   if(info.owner.toLowerCase()!==owner.address.toLowerCase())throw new Error('Company namespace owner mismatch');
   db.prepare("UPDATE launches SET state='launched',error=NULL WHERE id=?").run(job.id);
   if(!job.roles)return;
   const roles=JSON.parse(job.roles),entries=[];
   for(const label of roles){
    const dept=DEPARTMENTS.find(x=>x.id===label),signer=getWallet(label,'department').connect(sepolia),name=`${label}.${job.label}.${runtime.ENS_PARENT_NAME}`;
    await send(job.id,'fund-'+label,ownerSep,{to:signer.address,value:1_000_000_000_000_000n});
    await send(job.id,'hire-'+label,ownerSep,{to:names.target,data:names.interface.encodeFunctionData('hire',[hash,label,signer.address,2592000,dept.weekly,dept.perCall,vendors.filter(x=>x.dept===label).map(x=>`${x.id}.vendors.${runtime.ENS_PARENT_NAME}`).join(',')])});
    const identity=new Contract(IDENTITY_REGISTRY,AGENT_ABI,sepolia),registered=await send(job.id,'identity-'+label,signer,{to:IDENTITY_REGISTRY,data:identity.interface.encodeFunctionData('register',[])});
    const event=registered.logs.map(x=>{try{return x.address.toLowerCase()===IDENTITY_REGISTRY.toLowerCase()?identity.interface.parseLog(x):null}catch{return null}}).find(x=>x?.name==='Registered'&&x.args.owner===signer.address);
    if(!event)throw new Error('Department identity event missing');const agentId=String(event.args.agentId);
    const metadata=agentRegistration(label,name,process.env.APP_ORIGIN,agentId);metadata.services[0].endpoint=`${process.env.APP_ORIGIN}/launch/profiles/${job.id}/${label}`;
    await send(job.id,'metadata-'+label,signer,{to:IDENTITY_REGISTRY,data:identity.interface.encodeFunctionData('setAgentURI',[agentId,registrationURI(metadata)])});
    const context=JSON.stringify({name,company:`${job.label}.${runtime.ENS_PARENT_NAME}`,department:label,business:job.description,role:dept.title,paymentPolicy:'Only live ENS-authorized vendors and contract-enforced budgets; founder approval thresholds remain.'});
    for(const [key,value,suffix]of [[registrationKey(11155111,IDENTITY_REGISTRY,agentId),'1','ensip25'],['agent-context',context,'ensip26'],['agent-endpoint[web]',metadata.services[0].endpoint,'web']])await send(job.id,suffix+'-'+label,ownerSep,{to:names.target,data:names.interface.encodeFunctionData('setAgentMetadata',[hash,label,key,value])});
    if(await identity.ownerOf(agentId)!==signer.address||await identity.getAgentWallet(agentId)!==signer.address)throw new Error('New department identity owner mismatch');
    entries.push({label,name,agentId,registry:IDENTITY_REGISTRY,owner:signer.address,registration:metadata});
   }
   const reviewer=getWallet('founder-reviewer','reviewer');await send(job.id,'fund-reviewer',ownerSep,{to:reviewer.address,value:1_000_000_000_000_000n});
   const configFile=join(directory,'activation.json');let config;
   if(existsSync(configFile))config=JSON.parse(await readFile(configFile,'utf8'));
   else{
    const password=randomBytes(32).toString('hex');config={FOUNDER_PASSWORD:randomBytes(32).toString('hex'),RELAYER_PASSWORD:password,ATTESTER_PASSWORD:password,RELAYER_KEYSTORE:join(directory,'relayer.json'),ATTESTER_KEYSTORE:join(directory,'attester.json')};
    await writeFile(configFile,JSON.stringify(config),{flag:'wx',mode:0o600});
   }
   for(const role of ['relayer','attester']){const wallet=getWallet(role,role),file=config[role.toUpperCase()+'_KEYSTORE'];if(!existsSync(file))await writeFile(file,await wallet.encrypt(config.RELAYER_PASSWORD),{flag:'wx',mode:0o600});else if((await Wallet.fromEncryptedJson(await readFile(file,'utf8'),config.RELAYER_PASSWORD)).address!==wallet.address)throw new Error('Provisioned role keystore mismatch')}
   const attester=getWallet('attester','attester'),relayer=getWallet('relayer','relayer'),factory=new ContractFactory(bankArtifact.abi,bankArtifact.bytecode.object,ownerWbt);
   const deployed=await send(job.id,'whitechain-company',ownerWbt,await factory.getDeployTransaction(TOKEN,attester.address,100)),bank=new Contract(deployed.contractAddress,bankArtifact.abi,whitechain);
   await send(job.id,'whitechain-finance',ownerWbt,{to:bank.target,data:bank.interface.encodeFunctionData('setFinance',[finance.address])});
   for(const role of roles){const dept=DEPARTMENTS.find(x=>x.id===role);await send(job.id,'limits-'+role,ownerWbt,{to:bank.target,data:bank.interface.encodeFunctionData('setLimits',[getWallet(role,'department').address,dept.perCall,dept.perDay])})}
   for(const vendor of vendors.filter(x=>roles.includes(x.dept)))await send(job.id,'vendor-'+vendor.id,ownerWbt,{to:bank.target,data:bank.interface.encodeFunctionData('registerVendor',[vendor.address,vendor.price])});
   await send(job.id,'relayer-gas',ownerWbt,{to:relayer.address,value:20_000_000_000_000_000n});
   const token=new Contract(TOKEN,['function transfer(address,uint256) returns(bool)'],whitechain);await send(job.id,'test-pool',ownerWbt,{to:TOKEN,data:token.interface.encodeFunctionData('transfer',[bank.target,5_000_000n])},5_000_000n);
   const identities=join(directory,'identities.json');await writeFile(identities,JSON.stringify(entries),{mode:0o600});
   config={...config,...runtime,CHAIN_MODE:'testnet',PAYMENT_MODE:'razorpay',COMPANY_DATA_DIR:directory,COMPANY_ROLES:JSON.stringify(roles),ENS_ENABLED:'true',ENS_COMPANY_NAME:`${job.label}.${runtime.ENS_PARENT_NAME}`,ENS_COMPANY_REGISTRY:info.registry,ENS_REGISTRY_BLOCK:String(launched.blockNumber),ENS_IDENTITY_FILE:identities,RELAY_COMPANY_ADDRESS:bank.target,COMPANY_DEPLOYMENT_BLOCK:String(deployed.blockNumber),TREASURY_ADDRESS:owner.address,VISITOR_COMPANY:'true'};
   await writeFile(configFile+'.next',JSON.stringify(config),{mode:0o600});await rename(configFile+'.next',configFile);
   store.db.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)').run('business_profile',JSON.stringify({name:job.name,description:job.description,audience:'Customers of '+job.name,language:'Hindi'}));
   const check=createENSDirectory(config,sepolia);try{for(const role of roles){const identity=await check.employee(role);if(!identity.discovery.binding.verified||identity.wallet!==getWallet(role,'department').address)throw new Error('New employee ENS/identity verification failed')}}finally{check.close()}
   const approvedFile=join(root,'approved-companies.json'),approved=existsSync(approvedFile)?JSON.parse(await readFile(approvedFile,'utf8')):[];
   if(!approved.some(x=>x.address.toLowerCase()===String(bank.target).toLowerCase())){approved.push({address:bank.target,block:deployed.blockNumber});await writeFile(approvedFile+'.next',JSON.stringify(approved));await rename(approvedFile+'.next',approvedFile)}
   db.prepare("UPDATE launches SET state='ready',config=?,error=NULL WHERE id=?").run(configFile,job.id);
  }finally{store.db.close()}
 }
 console.log('Launch operator ready. Two companies/day; maximum 0.02 Sepolia ETH, 0.1 WBT and 10 test USDT/day.');
 while(!stopping){for(const row of db.prepare("SELECT * FROM launches WHERE state!='ready' ORDER BY created_at").all()){if(row.state==='launched'&&!row.roles)continue;try{await provision(row)}catch(error){db.prepare('UPDATE launches SET error=? WHERE id=?').run(error.message.slice(0,500),row.id);console.log(`Launch ${row.label} paused: ${error.message}`);break}if(stopping)break}if(!stopping)await new Promise(r=>setTimeout(r,3000))}
}finally{delete process.env.OWNER_PASSWORD;clearInterval(timer);db.prepare('DELETE FROM launch_worker WHERE instance=?').run(instance);queue.close();sepolia.destroy();whitechain.destroy()}
