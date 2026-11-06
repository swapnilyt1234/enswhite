import {readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {Transaction,keccak256,getAddress} from 'ethers';
import {retryRPCRead} from './chain.js';
import {checkENSTransaction,populateENSTransaction} from './ens.js';

export async function sendDiscoveryTransaction(dir,provider,owner,id,signer,transaction){
 for(let attempt=0;attempt<3;attempt++){
  const file=join(dir,id+(attempt?`.retry-${attempt}`:'')+'.json');let saved;
  if(existsSync(file))saved=JSON.parse(await readFile(file,'utf8'));
  else{
   const tx=await retryRPCRead(()=>populateENSTransaction(signer,{...transaction,chainId:11155111}));
   // Resolver storage estimates can vary slightly between estimation and mining.
   if(tx.to)tx.gasLimit=(BigInt(tx.gasLimit)*120n+99n)/100n;
   checkENSTransaction(tx,await retryRPCRead(()=>provider.getBalance(signer.address)));
   if(signer.address!==owner&&BigInt(tx.gasLimit)*BigInt(tx.maxFeePerGas??tx.gasPrice)>500_000_000_000_000n)throw new Error('Department identity transaction exceeds 0.0005 test ETH fee cap');
   const raw=await signer.signTransaction(tx);saved={raw,hash:keccak256(raw)};
   await writeFile(file,JSON.stringify(saved),{flag:'wx',mode:0o600});
  }
  let receipt=await retryRPCRead(()=>provider.getTransactionReceipt(saved.hash));
  if(!receipt){try{await provider.broadcastTransaction(saved.raw)}catch{if(!await retryRPCRead(()=>provider.getTransaction(saved.hash)))throw new Error('Unknown broadcast; saved signed bytes retained')};try{receipt=await provider.waitForTransaction(saved.hash,1,30000)}catch(error){if(error.code!=='TIMEOUT')throw error;receipt=await retryRPCRead(()=>provider.getTransactionReceipt(saved.hash))}}
  if(!receipt)throw new Error(`Step ${id} pending: ${saved.hash}. Resume this same script; do not delete its journal.`);
  if(receipt.status===1){console.log(`${id}: https://sepolia.etherscan.io/tx/${saved.hash}`);return receipt;}
  // Only confirmed, reverted discovery record edits may get a fresh nonce.
  const old=Transaction.from(saved.raw);
  if(!/^(binding|context|web|status)-(marketing|support|finance)$/.test(id)||attempt===2||!transaction.to||getAddress(old.to)!==getAddress(transaction.to)||old.data!==transaction.data||old.value!==BigInt(transaction.value??0)||old.from!==signer.address||old.chainId!==11155111n)throw new Error(`Step ${id} reverted: ${saved.hash}. Original journal retained; inspect before continuing.`);
  console.log(`${id}: confirmed revert ${saved.hash}; retaining journal and re-estimating the same record edit.`);
 }
}
