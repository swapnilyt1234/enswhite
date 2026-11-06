import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {Contract,JsonRpcProvider,dnsEncode,getAddress,keccak256} from 'ethers';
import {checkENSTransaction,populateENSTransaction} from '../../app/ens.js';
import {openStore} from '../../app/payments.js';
import {walletStore} from '../../app/company-store.js';

const [label,amount,requestId]=process.argv.slice(2);
if(!['marketing','support','finance'].includes(label)||!/^\d+$/.test(amount||'')||BigInt(amount)<=0n||BigInt(amount)>=(1n<<256n)||!/^[a-zA-Z0-9_-]{8,80}$/.test(requestId||''))throw new Error('Use: node ens/scripts/finance-budget.js marketing 4000000 unique-request-id');
const runtime=JSON.parse(await readFile('data/ens/runtime.json','utf8'));
const provider=new JsonRpcProvider(runtime.SEPOLIA_RPC_URL,11155111,{cacheTimeout:0});
const store=openStore(resolve('data/company/testnet'));
try{
 if((await provider.getNetwork()).chainId!==11155111n)throw new Error('Use Sepolia');
 const finance=walletStore(store.db,store.key)('finance','department').connect(provider);
 const name=`${label}.${runtime.ENS_COMPANY_NAME}`,resolved=await provider.getResolver(name);
 if(!resolved)throw new Error('Employee name is not active');
 const resolver=new Contract(resolved.address,['function setText(bytes,string,string)'],provider);
 if(await resolved.getText('enswhite.budget.weekly')===amount){console.log('ENS budget already matches');}
 else{
  const file=join('data/ens',`finance-${requestId}.json`);let saved;
  try{saved=JSON.parse(await readFile(file,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
  if(saved&&(saved.name!==name||saved.amount!==amount||getAddress(saved.resolver)!==getAddress(resolver.target)))throw new Error('This request ID belongs to a different policy update');
  if(!saved){
   if(await provider.getBalance(finance.address)===0n)throw new Error(`Finance needs Sepolia ETH for this record edit: ${finance.address}. Its Whitechain WBT stays zero.`);
   const tx=await populateENSTransaction(finance,{to:resolver.target,data:resolver.interface.encodeFunctionData('setText',[dnsEncode(name),'enswhite.budget.weekly',amount]),chainId:11155111});
   checkENSTransaction(tx,await provider.getBalance(finance.address));
   const raw=await finance.signTransaction(tx);saved={raw,hash:keccak256(raw),name,amount,resolver:resolver.target};
   await writeFile(file,JSON.stringify(saved),{flag:'wx',mode:0o600});
  }
  let receipt=await provider.getTransactionReceipt(saved.hash);
  if(!receipt){try{await provider.broadcastTransaction(saved.raw)}catch{if(!await provider.getTransaction(saved.hash))throw new Error('Broadcast unknown; saved transaction retained')};receipt=await provider.waitForTransaction(saved.hash,1,30_000)}
  if(!receipt||receipt.status!==1)throw new Error('Budget update pending/reverted; inspect the saved transaction');
  if(await (await provider.getResolver(name)).getText('enswhite.budget.weekly')!==amount)throw new Error('The record differs from this completed request; use a new request ID for another update');
  console.log(`${name}: weekly budget ${amount} atomic test USDT. Finance signed only its delegated text key. https://sepolia.etherscan.io/tx/${saved.hash}`);
 }
}finally{store.db.close();provider.destroy()}
