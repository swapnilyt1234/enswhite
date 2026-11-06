import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { Wallet, Contract, getAddress, keccak256 } from 'ethers';
import { randomBytes } from 'node:crypto';
import { inspectToken, types } from './chain.js';
import { openStore } from './payments.js';
import { walletStore, DEPARTMENTS, VENDORS } from './company-store.js';
import { pendingConfiguration } from './company-configure.js';
import { COMPANY_ABI } from './company-chain.js';

const directory = resolve('data/company/testnet');
const command = process.argv[2];
if (command === 'prepare') {
  if (!process.env.SETUP_KEYSTORE_PASSWORD || process.env.SETUP_KEYSTORE_PASSWORD.length < 12) throw new Error('Use a keystore password of at least 12 characters');
  const keystores = join(homedir(), '.foundry', 'keystores'); await mkdir(keystores, { recursive: true });
  const roles = {};
  for (const role of ['relayer','treasury','attester']) {
    const path = join(keystores, 'relay-' + role);
    let wallet;
    try { wallet = await Wallet.fromEncryptedJson(await readFile(path,'utf8'),process.env.SETUP_KEYSTORE_PASSWORD); }
    catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Existing role keystore could not be decrypted; nothing will be overwritten');
      wallet = Wallet.createRandom();
      await writeFile(path,await wallet.encrypt(process.env.SETUP_KEYSTORE_PASSWORD),{flag:'wx',mode:0o600});
    }
    roles[role] = { address:wallet.address,keystore:path };
  }
  const { db,key }=openStore(directory), wallets=walletStore(db,key);
  const departments=DEPARTMENTS.map(dept=>({...dept,address:wallets(dept.id,'department').address}));db.close();
  const vendors=[];
  for(const info of VENDORS){const store=openStore(resolve('data/vendors/testnet',info.id));vendors.push({...info,address:walletStore(store.db,store.key)(info.id,'vendor').address});store.db.close()}
  const config={roles,departments,vendors};
  await writeFile(join(directory,'setup.json'),JSON.stringify(config,null,2));
  console.log(JSON.stringify(config,null,2));
  console.log('\nEncrypted keystores created. No private key was displayed. Keep data/ and the keystores private.');
} else if(command==='deployment') {
  const address=getAddress(process.argv[3]),block=Number(process.argv[4]);
  if(!Number.isSafeInteger(block)||block<1)throw new Error('A positive deployment block is required');
  await writeFile(join(directory,'deployment.json'),JSON.stringify({address,block},null,2));
  console.log('Saved public company deployment configuration.');
} else if(command==='configure') {
  const address=getAddress(process.argv[3]),block=Number(process.argv[4]);
  if(!Number.isSafeInteger(block)||block<1)throw new Error('Invalid deployment block');
  const config=JSON.parse(await readFile(join(directory,'setup.json'),'utf8'));
  const base=await inspectToken(process.env.RPC_URL);
  try{
    const contract=new Contract(address,[...COMPANY_ABI,'function setFinance(address)','function setLimits(address,uint256,uint256)','function registerVendor(address,uint256)'],base.provider);
    let owner;
    try{owner=(await Wallet.fromEncryptedJson(await readFile(join(homedir(),'.foundry','keystores','whitechain-testnet'),'utf8'),process.env.OWNER_PASSWORD)).connect(base.provider)}catch{throw new Error('Could not unlock the owner keystore with that password')}
    if(getAddress(await contract.owner())!==owner.address)throw new Error('Owner keystore does not own this company');
    const plan=await pendingConfiguration(contract,config);
    console.log(`Skipping ${7-plan.length} settings already configured; ${plan.length} remain.`);
    for(const step of plan){
      if((await base.provider.getNetwork()).chainId!==1874n)throw new Error('Wrong chain');
      const data=contract.interface.encodeFunctionData(step.method,step.args);
      const path=join(directory,`owner-${address}-${keccak256(data)}.json`);
      let saved;
      try{saved=JSON.parse(await readFile(path,'utf8'))}catch(error){if(error.code!=='ENOENT')throw error}
      if(!saved){const raw=await owner.signTransaction(await owner.populateTransaction({to:address,data,chainId:1874}));saved={raw,hash:keccak256(raw)};await writeFile(path,JSON.stringify(saved),{flag:'wx',mode:0o600})}
      let receipt=await base.provider.getTransactionReceipt(saved.hash);
      if(!receipt){try{await base.provider.broadcastTransaction(saved.raw)}catch{if(!(await base.provider.getTransaction(saved.hash)))throw new Error('Broadcast unavailable; original transaction retained')};receipt=await base.provider.waitForTransaction(saved.hash,1,60000)}
      if(!receipt||receipt.status!==1)throw new Error('Configuration did not confirm; do not replace the saved transaction blindly');
      console.log(`${step.label}: confirmed ${saved.hash}`);
    }
    if((await pendingConfiguration(contract,config)).length)throw new Error('Onchain configuration does not match the setup');
    await writeFile(join(directory,'deployment.json'),JSON.stringify({address,block},null,2));
    console.log('All seven settings verified. You can now run fund-company-pool.ps1.');
  }finally{base.provider.destroy()}
} else if(command==='fund') {
  const config=JSON.parse(await readFile(join(directory,'setup.json'),'utf8'));
  const deployment=JSON.parse(await readFile(join(directory,'deployment.json'),'utf8'));
  const base=await inspectToken(process.env.RPC_URL);
  try {
    let treasury,relayer;
    try{treasury=await Wallet.fromEncryptedJson(await readFile(config.roles.treasury.keystore,'utf8'),process.env.TREASURY_PASSWORD)}catch{throw new Error('Cannot unlock relay-treasury: use the 12+ character role-wallet password chosen in prepare-company.ps1, not the original owner password. No transfer was sent.')}
    try{relayer=(await Wallet.fromEncryptedJson(await readFile(config.roles.relayer.keystore,'utf8'),process.env.RELAYER_PASSWORD)).connect(base.provider)}catch{throw new Error('Cannot unlock relay-relayer with the role-wallet password. No transfer was sent.')}
    if(treasury.address===relayer.address)throw new Error('Treasury and relayer must differ');
    const file=join(directory,`pool-funding-${getAddress(deployment.address)}.json`);
    let saved;
    try{saved=JSON.parse(await readFile(file,'utf8'))}catch(error){if(error.code!=='ENOENT')throw error}
    if(!saved){
      if(await base.token.balanceOf(treasury.address)<10_000_000n)throw new Error('Treasury needs 10 test USDT before prefunding');
      const a={from:treasury.address,to:getAddress(deployment.address),value:'10000000',validAfter:'0',validBefore:String(Math.floor(Date.now()/1000)+600),nonce:'0x'+randomBytes(32).toString('hex')};
      const signature=await treasury.signTypedData(base.domain,types,a);
      const data=base.token.interface.encodeFunctionData('transferWithAuthorization',[a.from,a.to,a.value,a.validAfter,a.validBefore,a.nonce,signature]);
      const raw=await relayer.signTransaction(await relayer.populateTransaction({to:base.token.target,data,chainId:1874}));
      saved={raw,hash:keccak256(raw)};await writeFile(file,JSON.stringify(saved),{flag:'wx',mode:0o600});
    }
    let receipt=await base.provider.getTransactionReceipt(saved.hash);
    if(!receipt){try{await base.provider.broadcastTransaction(saved.raw)}catch{if(!(await base.provider.getTransaction(saved.hash)))throw new Error('RPC broadcast unavailable; saved bytes retained')};receipt=await base.provider.waitForTransaction(saved.hash,1,60000)}
    if(!receipt||receipt.status!==1)throw new Error('Pool funding did not confirm; inspect the saved transaction before replacing it');
    console.log('Pool prefunded with 10 test USDT. Treasury signed, relayer paid WBT gas.');
    console.log(`https://explorer.testnet.whitechain.io/tx/${saved.hash}`);
  }finally{base.provider.destroy()}
} else throw new Error('Use prepare, configure/deployment <address> <block>, or fund');
