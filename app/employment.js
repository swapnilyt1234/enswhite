import {randomUUID} from 'node:crypto';
import {Interface,Transaction,getAddress,keccak256,toUtf8Bytes} from 'ethers';
import {ENS_NAMES_ABI,checkENSTransaction,populateENSTransaction} from './ens.js';

const now=()=>Date.now(),pending="state IN ('queued','submitted')";
const refuse=message=>{throw Object.assign(new Error(message),{status:409})};
export function createEmploymentQueue(db,config){
 db.exec(`CREATE TABLE IF NOT EXISTS employment_jobs(id TEXT PRIMARY KEY,controller TEXT NOT NULL,company TEXT NOT NULL,action TEXT NOT NULL,label TEXT NOT NULL,term INTEGER NOT NULL,policy TEXT NOT NULL,state TEXT NOT NULL,raw TEXT,hash TEXT,error TEXT,signed_at INTEGER,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS employment_worker(id INTEGER PRIMARY KEY CHECK(id=1),instance TEXT NOT NULL,controller TEXT NOT NULL,heartbeat INTEGER NOT NULL);`);
 function validate(action,label,term,policy){
  const dept=config.departments.find(x=>x.id===label);if(!dept||!['hire','fire','renew'].includes(action))refuse('Choose Hire, Fire or Renew for a registered employee.');
  if(![300,2592000].includes(term))refuse('Choose a five-minute demo term or 30 days.');
  const vendors=config.vendors.filter(x=>x.dept===label).map(x=>`${x.id}.vendors.${config.parent}`).sort();
  if(!policy||!/^[0-9]{1,8}$/.test(policy.weekly)||BigInt(policy.weekly)<=0n||BigInt(policy.weekly)>50_000_000n||!/^[0-9]{1,8}$/.test(policy.perCall)||BigInt(policy.perCall)<=0n||BigInt(policy.perCall)>BigInt(dept.perCall)||!Array.isArray(policy.vendors)||new Set(policy.vendors).size!==policy.vendors.length||policy.vendors.some(x=>!vendors.includes(x)))refuse('Employment policy exceeds the registered employee limits.');
  return dept;
 }
 const jobs=()=>db.prepare('SELECT id,action,label,term,state,hash,error,created_at FROM employment_jobs ORDER BY rowid DESC LIMIT 30').all();
 const ready=()=>{const row=db.prepare('SELECT controller,heartbeat FROM employment_worker WHERE id=1').get();return !!row&&row.controller===config.controller&&row.heartbeat>now()-30000};
 return{validate,jobs,ready,request:id=>db.prepare('SELECT id,action,label,term,state FROM employment_jobs WHERE id=?').get(id),
  firing:label=>!!db.prepare(`SELECT id FROM employment_jobs WHERE label=? AND action='fire' AND ${pending}`).get(label),
  policy:label=>{const row=db.prepare('SELECT policy FROM employment_jobs WHERE label=? AND action=? AND state=? ORDER BY rowid DESC LIMIT 1').get(label,'fire','confirmed');return row?JSON.parse(row.policy):null},
  queue(action,label,term,policy,id=randomUUID()){
   validate(action,label,term,policy);if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{8,80}$/.test(id))refuse('Invalid employee request ID.');
   const old=db.prepare('SELECT * FROM employment_jobs WHERE id=?').get(id);if(old){if(old.action!==action||old.label!==label||old.term!==term||old.controller!==config.controller||old.company!==config.company)refuse('Request ID belongs to another employee change.');return{id:old.id,state:old.state}}
   if(!ready())refuse('Employee management is temporarily unavailable. Ask the operator to start the employee manager.');
   const active=db.prepare(`SELECT id,action,term FROM employment_jobs WHERE label=? AND ${pending}`).get(label);if(active){if(active.action===action&&active.term===term)return{id:active.id,state:'queued'};refuse('An employee update is already in progress.');}
   if(db.prepare('SELECT COUNT(*) n FROM employment_jobs WHERE created_at>=?').get(now()-86400000).n>=12)refuse('Daily employee-management request limit reached.');
   db.prepare("INSERT INTO employment_jobs VALUES(?,?,?,?,?,?,?,'queued',NULL,NULL,NULL,NULL,?)").run(id,config.controller,config.company,action,label,term,JSON.stringify(policy),now());return{id,state:'queued'};
  },
 };
}

export function createEmploymentWorker(db,config,directory,signer){
 const queue=createEmploymentQueue(db,config),provider=directory.provider,instance=randomUUID(),iface=new Interface(ENS_NAMES_ABI);
 const claim=db.prepare('INSERT INTO employment_worker VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET instance=excluded.instance,controller=excluded.controller,heartbeat=excluded.heartbeat WHERE employment_worker.heartbeat<?').run(instance,config.controller,now(),now()-30000);
 if(!claim.changes)throw new Error('Another employee manager is running.');
 function heartbeat(){if(!db.prepare('UPDATE employment_worker SET heartbeat=? WHERE id=1 AND instance=?').run(now(),instance).changes)throw new Error('Employee-manager lease was lost.');}
 function validateTx(tx,row){
  const dept=queue.validate(row.action,row.label,row.term,JSON.parse(row.policy)),call=iface.parseTransaction({data:tx.data}),args=call?.args;
  if(BigInt(tx.chainId)!==11155111n||getAddress(tx.to)!==getAddress(config.controller)||BigInt(tx.value??0)!==0n||call?.name!==row.action||args[0]!==keccak256(toUtf8Bytes(config.company.split('.')[0]))||args[1]!==row.label)throw new Error('Employee transaction is outside the configured company.');
  if(row.action==='hire'){const p=JSON.parse(row.policy);if(getAddress(args[2])!==getAddress(dept.address)||args[3]!==BigInt(row.term)||args[4]!==p.weekly||args[5]!==p.perCall||args[6]!==p.vendors.join(','))throw new Error('Employee hire differs from the approved policy.');}
  if(row.action==='renew'&&args[2]>BigInt(Math.floor(now()/1000)+row.term+60))throw new Error('Employee renewal exceeds its term.');
 }
 return{heartbeat,close(){db.prepare('DELETE FROM employment_worker WHERE id=1 AND instance=?').run(instance)},async process(){
  heartbeat();if((await provider.getNetwork()).chainId!==11155111n)throw new Error('Employee manager requires Sepolia.');
  const row=db.prepare(`SELECT * FROM employment_jobs WHERE ${pending} ORDER BY rowid LIMIT 1`).get();if(!row)return;
  try{
   if(row.controller!==config.controller||row.company!==config.company)throw new Error('Employee request targets another company.');
   if(!row.raw){
    if(db.prepare('SELECT COUNT(*) n FROM employment_jobs WHERE signed_at>=?').get(now()-86400000).n>=6)throw new Error('Daily signing limit reached.');
    const dept=queue.validate(row.action,row.label,row.term,JSON.parse(row.policy));
    const request=await directory.transaction(row.action,row.label,dept.address,JSON.parse(row.policy),row.term);
    if(getAddress(request.from)!==signer.address)throw new Error('Employee manager is not the company owner.');
    const tx=await populateENSTransaction(signer,{to:request.to,data:request.data,chainId:11155111,value:0});tx.gasLimit=(BigInt(tx.gasLimit)*120n+99n)/100n;
    validateTx(tx,row);checkENSTransaction(tx,await provider.getBalance(signer.address));heartbeat();
    row.raw=await signer.signTransaction(tx);row.hash=keccak256(row.raw);
    db.prepare("UPDATE employment_jobs SET raw=?,hash=?,signed_at=?,state='submitted',error=NULL WHERE id=?").run(row.raw,row.hash,now(),row.id);
   }
   const signed=Transaction.from(row.raw);validateTx(signed,row);if(signed.from!==signer.address||keccak256(row.raw)!==row.hash)throw new Error('Saved employee signer differs from its journal.');heartbeat();
   let receipt=await provider.getTransactionReceipt(row.hash);
   if(!receipt){try{await provider.broadcastTransaction(row.raw)}catch{if(!await provider.getTransaction(row.hash))throw new Error('Unknown broadcast; original transaction retained.');}receipt=await provider.getTransactionReceipt(row.hash)}
   if(receipt){db.prepare('UPDATE employment_jobs SET state=?,error=? WHERE id=?').run(receipt.status===1?'confirmed':'failed',receipt.status===1?null:'Employee update reverted. Ask the operator to inspect its receipt.',row.id);console.log(`${row.label} ${row.action}: https://sepolia.etherscan.io/tx/${row.hash}`)}
  }catch{db.prepare('UPDATE employment_jobs SET error=? WHERE id=?').run('Employee update paused. Check the private manager, permissions and service gas; saved requests are retained.',row.id)}
 }};
}
