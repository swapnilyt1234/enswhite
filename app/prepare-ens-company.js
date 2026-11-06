import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { openStore, encrypt } from './payments.js';
import { walletStore } from './company-store.js';

const source=resolve('data/company/testnet'),target=resolve('data/company/ens-testnet');
const setup=JSON.parse(await readFile(join(source,'setup.json'),'utf8'));
await mkdir(target,{recursive:true});
const old=openStore(source),next=openStore(target);
try{
 const wallets=walletStore(old.db,old.key);walletStore(next.db,next.key);
 for(const dept of setup.departments){
  const wallet=wallets(dept.id,'department');
  const existing=next.db.prepare('SELECT address FROM company_wallets WHERE name=?').get(dept.id);
  if(existing&&existing.address!==wallet.address)throw new Error('ENS company has different employee keys; refusing to overwrite');
  next.db.prepare('INSERT OR IGNORE INTO company_wallets VALUES(?,?,?,?)').run(dept.id,'department',wallet.address,encrypt(next.key,wallet.privateKey));
 }
 await writeFile(join(target,'setup.json'),JSON.stringify(setup,null,2));
}finally{old.db.close();next.db.close()}
console.log('Prepared a separate ENS company ledger with the existing ENS-linked department wallets. Original history is intact.');
console.log(`forge create src/EnsWhiteCompany.sol:EnsWhiteCompany --rpc-url https://rpc.testnet.whitechain.io --chain 1874 --account whitechain-testnet --broadcast --verify --verifier blockscout --verifier-url https://explorer.testnet.whitechain.io/api/ --constructor-args 0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7 ${setup.roles.attester.address} 100`);
