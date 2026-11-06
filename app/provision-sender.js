import {keccak256,Transaction} from 'ethers';
import {retryRPCRead} from './chain.js';
import {launchPolicy} from './launch-store.js';

export function createProvisionSender(db,assertLease){
 return async function send(launch,step,signer,transaction,tokenUnits=0n){
  assertLease();
  const provider=signer.provider,chain=Number((await retryRPCRead(()=>provider.getNetwork())).chainId);
  if(![11155111,1874].includes(chain))throw new Error('Provisioning is testnet only');
  const id=`${launch}:${step}`;let saved=db.prepare('SELECT * FROM launch_transactions WHERE id=?').get(id);
  if(!saved){
   if(step==='launch-company'&&db.prepare("SELECT COUNT(*) n FROM launch_transactions WHERE step='launch-company' AND created_at>=?").get(Math.floor(Date.now()/86400000)*86400000).n>=launchPolicy.companiesPerDay)throw new Error('Daily operator company budget reached. Resume on a later UTC day.');
   const tx=await retryRPCRead(()=>signer.populateTransaction({...transaction,chainId:chain}));tx.gasLimit=(BigInt(tx.gasLimit)*120n+99n)/100n;
   const fee=BigInt(tx.gasLimit)*BigInt(tx.maxFeePerGas??tx.gasPrice),value=BigInt(tx.value??0),cap=chain===11155111?launchPolicy.sepoliaWei:launchPolicy.whitechainWei;
   if(tx.gasLimit>(tx.to?8_000_000n:20_000_000n)||fee>(chain===11155111?5_000_000_000_000_000n:20_000_000_000_000_000n))throw new Error('Provision transaction exceeds gas policy');
   const today=Math.floor(Date.now()/86400000)*86400000;
   const spent=db.prepare('SELECT fee,value,token_units FROM launch_transactions WHERE chain=? AND created_at>=?').all(chain,today);
   if(spent.reduce((n,x)=>n+BigInt(x.fee)+BigInt(x.value),0n)+fee+value>cap||spent.reduce((n,x)=>n+BigInt(x.token_units),0n)+tokenUnits>launchPolicy.poolUnits)throw new Error('Daily operator spending budget reached. Resume on a later UTC day.');
   if(await retryRPCRead(()=>provider.getBalance(signer.address))<fee+value)throw new Error('Operator or employee testnet gas is insufficient');
   assertLease();const raw=await signer.signTransaction(tx),hash=keccak256(raw);
   db.prepare("INSERT INTO launch_transactions VALUES(?,?,?,?,?,?,?,?,?,'submitted',?)").run(id,launch,step,chain,raw,hash,String(fee),String(value),String(tokenUnits),Date.now());
   saved=db.prepare('SELECT * FROM launch_transactions WHERE id=?').get(id);
  }
  const parsed=Transaction.from(saved.raw);
  if(Number(parsed.chainId)!==chain||parsed.from.toLowerCase()!==signer.address.toLowerCase()||(parsed.to||'').toLowerCase()!==(transaction.to||'').toLowerCase()||parsed.data!==(transaction.data||'0x')||parsed.value!==BigInt(transaction.value??0))throw new Error('Saved provision transaction differs from its planned step');
  let receipt=await retryRPCRead(()=>provider.getTransactionReceipt(saved.hash));
  if(!receipt){assertLease();try{await provider.broadcastTransaction(saved.raw)}catch{if(!await retryRPCRead(()=>provider.getTransaction(saved.hash)))throw new Error('Unknown broadcast. Original signed transaction retained; no replacement is allowed.')};try{receipt=await provider.waitForTransaction(saved.hash,1,15000)}catch(error){if(error.code!=='TIMEOUT')throw error;receipt=await retryRPCRead(()=>provider.getTransactionReceipt(saved.hash))}}
  if(!receipt)throw new Error('Provision transaction is pending. The saved job will resume.');
  db.prepare('UPDATE launch_transactions SET state=? WHERE id=?').run(receipt.status===1?'confirmed':'failed',id);
  if(receipt.status!==1)throw new Error('Provision transaction reverted. Inspect its public link; the original journal is retained.');
  return receipt;
 };
}
