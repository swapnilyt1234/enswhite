import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {Contract,Wallet,keccak256,toUtf8Bytes,dnsEncode,namehash,ZeroHash} from 'ethers';
import {createENSDirectory,ENS_NAMES_ABI,checkENSTransaction,populateENSTransaction} from '../../app/ens.js';
import {inspectToken} from '../../app/chain.js';
import {IDENTITY_ABI} from '../../app/company-chain.js';

const id=process.argv[2];
if(!/^[a-z0-9-]{8,40}$/.test(id||''))throw new Error('Supply a unique lowercase demo ID (8–40 characters); reuse it only to resume that demo');
const env=JSON.parse(await readFile('data/ens/runtime.json','utf8')),directory=createENSDirectory(env),p=directory.provider;
const folder=resolve('data/ens','demo-'+id);await mkdir(folder,{recursive:true});
let whitechain;
try {
 if((await p.getNetwork()).chainId!==11155111n)throw new Error('Use Sepolia');
 const owner=(await Wallet.fromEncryptedJson(await readFile(join(homedir(),'.foundry/keystores/whitechain-testnet'),'utf8'),process.env.OWNER_PASSWORD)).connect(p);
 const names=new Contract(env.ENS_NAMES_ADDRESS,ENS_NAMES_ABI,p),companyHash=keccak256(toUtf8Bytes(env.ENS_COMPANY_NAME.split('.')[0]));
 const company=await names.companies(companyHash);assert.equal(company.owner,owner.address,'Original owner must own this company');
 let original;
 try{original=JSON.parse(await readFile(join(folder,'support.json'),'utf8'))}catch(e){if(e.code!=='ENOENT')throw e;original=await directory.employee('support');await writeFile(join(folder,'support.json'),JSON.stringify(original),{flag:'wx',mode:0o600})}
 async function send(step,data) {
  const file=join(folder,step+'.json');let saved;
  try{saved=JSON.parse(await readFile(file,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
  if(!saved){const tx=await populateENSTransaction(owner,{to:names.target,data,chainId:11155111});checkENSTransaction(tx,await p.getBalance(owner.address));const raw=await owner.signTransaction(tx);saved={raw,hash:keccak256(raw)};await writeFile(file,JSON.stringify(saved),{flag:'wx',mode:0o600})}
  let receipt=await p.getTransactionReceipt(saved.hash);
  if(!receipt){try{await p.broadcastTransaction(saved.raw)}catch{if(!await p.getTransaction(saved.hash))throw new Error('Unknown broadcast; original transaction retained')};receipt=await p.waitForTransaction(saved.hash,1,30000)}
  assert.equal(receipt?.status,1,`Step ${step} pending/reverted; do not delete its journal`);console.log(`${step}: https://sepolia.etherscan.io/tx/${saved.hash}`);return receipt;
 }
 const finance=await directory.employee('finance'),marketing=await directory.employee('marketing');
 const edit=new Contract(marketing.resolver,['function setText(bytes,string,string)'],p);
 await assert.rejects(p.call({from:finance.wallet,to:edit.target,data:edit.interface.encodeFunctionData('setText',[dnsEncode(marketing.name),'enswhite.vendors','evil.eth'])}),e=>e.code==='CALL_EXCEPTION');
 console.log('PASS: Finance cannot edit the vendor allowlist (read-only simulation).');
 const vendor='copydesk.vendors.'+env.ENS_PARENT_NAME,resolved=await p.getResolver(vendor),payee=await resolved.getAddress(2147485522),endpoint=await resolved.getText('x402.endpoint');
 await assert.rejects(directory.authorize('marketing',vendor,marketing.wallet,owner.address,endpoint,'100000'),/disagrees/);
 assert.notEqual(payee,owner.address);console.log('PASS: spoofed vendor payee refused by fresh ENS authorization.');
 const registry=new Contract(env.ENS_COMPANY_REGISTRY,['function safeTransferFrom(address,address,uint256,uint256,bytes)'],p);
 const active=await directory.employee('support').catch(()=>null);
 if(active)await assert.rejects(p.call({from:active.wallet,to:registry.target,data:registry.interface.encodeFunctionData('safeTransferFrom',[active.wallet,owner.address,active.tokenId,1,'0x'])}),e=>e.code==='CALL_EXCEPTION');
 const label='demo-'+id;
 await send('signup',names.interface.encodeFunctionData('createCompany',[label,finance.wallet]));
 assert.equal((await names.companies(keccak256(toUtf8Bytes(label)))).owner,owner.address);
 console.log(`PASS: ${label}.${env.ENS_PARENT_NAME} has its own company registry (no bank funds moved).`);
 await send('fire',names.interface.encodeFunctionData('fire',[companyHash,'support']));
 let hired=false;try{await readFile(join(folder,'hire-five-minutes.json'));hired=true}catch(e){if(e.code!=='ENOENT')throw e}
 if(!hired){await assert.rejects(directory.employee('support'),/fired or expired/);console.log('PASS: fired Support cannot obtain fresh payment authorization.');}
 const hire=term=>names.interface.encodeFunctionData('hire',[companyHash,'support',original.wallet,term,original.weekly,original.perCall,original.vendors.join(',')]);
 const hireReceipt=await send('hire-five-minutes',hire(300));
 const short={expiry:(await p.getBlock(hireReceipt.blockNumber)).timestamp+300};
 console.log('Waiting for the five-minute employee term to end. The company server may stay running; avoid Support missions until restoration.');
 while(Math.floor(Date.now()/1000)<=Number(short.expiry)+12){console.log('Support term seconds remaining:',Math.max(0,Number(short.expiry)-Math.floor(Date.now()/1000)));await new Promise(r=>setTimeout(r,10000))}
 let restored=false;try{await readFile(join(folder,'restore-thirty-days.json'));restored=true}catch(e){if(e.code!=='ENOENT')throw e}
 let checkError;
 if(!restored)try{
  await assert.rejects(directory.employee('support'),/fired or expired/);
  const deployment=JSON.parse(await readFile('data/company/ens-testnet/deployment.json','utf8'));whitechain=await inspectToken();
  const bank=new Contract(deployment.address,IDENTITY_ABI,whitechain.provider);
  await assert.rejects(bank.pay.staticCall(original.wallet,payee,1,ZeroHash,ZeroHash,0,Number(short.expiry)+300,27,ZeroHash,ZeroHash,{deptNode:namehash(original.name),vendorNode:namehash(vendor),weeklyMax:original.weekly,perCallMax:original.perCall,nameExpiry:short.expiry,validUntil:short.expiry},'0x'),e=>e.reason==='ENS policy expired');
  console.log('PASS: expired Support is refused by ENS and the deployed Whitechain expiry guard (eth_call, no payment broadcast).');
 }catch(error){checkError=error}
 await send('restore-thirty-days',hire(30*86400));
 assert.equal((await directory.employee('support')).wallet,original.wallet);
 if(checkError)throw checkError;
 console.log('DEMO COMPLETE: Support restored for 30 days. Public transaction links are above; local signed journals remain private.');
}finally{directory.close();whitechain?.provider.destroy()}
