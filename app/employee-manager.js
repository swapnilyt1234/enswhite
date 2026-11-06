import {readFile,access} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {Wallet} from 'ethers';
import {createENSDirectory} from './ens.js';
import {createEmploymentWorker} from './employment.js';
import {VENDORS} from './company-store.js';

const folder=resolve('data/company/ens-testnet'),file=join(folder,'payments.sqlite');await access(file);
const env=JSON.parse(await readFile('data/ens/runtime.json','utf8')),setup=JSON.parse(await readFile(join(folder,'setup.json'),'utf8'));
const directory=createENSDirectory(env),db=new DatabaseSync(file);db.exec('PRAGMA busy_timeout=5000');let worker,timer,stopping=false;
try{
 const wallet=await Wallet.fromEncryptedJson(await readFile(join(homedir(),'.foundry/keystores/whitechain-testnet'),'utf8'),process.env.OWNER_PASSWORD);delete process.env.OWNER_PASSWORD;
 const check=await directory.transaction('fire','support',setup.departments.find(x=>x.id==='support').address,{},2592000);
 if(check.from.toLowerCase()!==wallet.address.toLowerCase())throw new Error('The local owner is not this company founder.');
 worker=createEmploymentWorker(db,{controller:env.ENS_NAMES_ADDRESS,company:env.ENS_COMPANY_NAME,parent:env.ENS_PARENT_NAME,departments:setup.departments,vendors:VENDORS},directory,wallet.connect(directory.provider));
 const stop=()=>{stopping=true;worker.close()};process.once('SIGINT',stop);process.once('SIGTERM',stop);
 timer=setInterval(()=>{try{worker.heartbeat()}catch{stop()}},5000);timer.unref();
 console.log(`Employee manager ready for ${env.ENS_COMPANY_NAME}. Founder buttons use the saved queue; no browser wallet is required.`);
 while(!stopping){try{await worker.process()}catch{if(!stopping)console.log('Employee manager paused; check Sepolia connectivity and the local worker lease.')}if(!stopping)await new Promise(r=>setTimeout(r,3000))}
}finally{delete process.env.OWNER_PASSWORD;clearInterval(timer);worker?.close();directory.close();db.close()}
