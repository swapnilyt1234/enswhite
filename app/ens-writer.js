import { Contract, dnsEncode, keccak256 } from 'ethers';
import { randomUUID } from 'node:crypto';
import { populateENSTransaction } from './ens.js';

export function createENSWriter(db,directory,getWallet) {
  const provider=directory.provider;
  db.exec('CREATE TABLE IF NOT EXISTS ens_writes (id TEXT PRIMARY KEY,label TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,state TEXT NOT NULL,raw TEXT,hash TEXT,error TEXT,created_at INTEGER NOT NULL)');
  function queue(label,key,value,id=randomUUID()) {
    if(!['marketing','support','finance'].includes(label)||!['enswhite.status','enswhite.budget.weekly'].includes(key))throw new Error('ENS write scope rejected');
    if(key==='enswhite.status'&&!['active','working','awaiting approval','delivered','blocked'].includes(value))throw new Error('Invalid agent status');
    if(key==='enswhite.budget.weekly'&&(!/^\d+$/.test(value)||BigInt(value)<=0n||BigInt(value)>50_000_000n))throw new Error('Weekly budget must be positive and at most 50 test USDT');
    if(!/^[a-zA-Z0-9_-]{8,80}$/.test(id))throw new Error('Invalid ENS request ID');
    const old=db.prepare('SELECT * FROM ens_writes WHERE id=?').get(id);
    if(old&&(old.label!==label||old.key!==key||old.value!==value))throw new Error('ENS request ID belongs to another edit');
    db.prepare("INSERT OR IGNORE INTO ens_writes(id,label,key,value,state,created_at) VALUES(?,?,?,?,'queued',?)").run(id,label,key,value,Math.floor(Date.now()/1000));
    return {id};
  }
  return {
    queue,
    jobs:()=>db.prepare('SELECT id,label,key,value,state,hash,error FROM ens_writes ORDER BY rowid DESC LIMIT 30').all(),
    async status(label,value) {
      const last=db.prepare('SELECT value,state FROM ens_writes WHERE label=? AND key=? ORDER BY rowid DESC LIMIT 1').get(label,'enswhite.status');
      if(last?.value===value&&last.state!=='failed')return;
      const identity=await directory.employee(label);
      if(identity.status!==value)queue(label,'enswhite.status',value);
    },
    async process() {
      for(const row of db.prepare("SELECT * FROM ens_writes WHERE state IN ('queued','submitted') ORDER BY rowid").all()) {
        try {
          if((await provider.getNetwork()).chainId!==11155111n)throw new Error('Use Sepolia');
          if(!row.raw) {
            const identity=await directory.employee(row.label),actor=row.key==='enswhite.status'?row.label:'finance';
            const signer=getWallet(actor,'department').connect(provider),authority=await directory.employee(actor);
            if(authority.wallet!==signer.address)throw new Error('ENS signer differs from employee identity');
            const count=db.prepare('SELECT COUNT(*) n FROM ens_writes WHERE raw IS NOT NULL AND created_at>=?').get(Math.floor(Date.now()/86400000)*86400).n;
            if(count>=48)throw new Error('ENS daily write cap reached');
            const resolver=new Contract(identity.resolver,['function setText(bytes,string,string)'],provider);
            const tx=await populateENSTransaction(signer,{to:resolver.target,data:resolver.interface.encodeFunctionData('setText',[dnsEncode(identity.name),row.key,row.value]),chainId:11155111});
            const fee=BigInt(tx.gasLimit)*BigInt(tx.maxFeePerGas??tx.gasPrice);
            if(BigInt(tx.gasLimit)>1_000_000n||fee>100_000_000_000_000n)throw new Error('ENS record edit exceeds gas policy');
            if(await provider.getBalance(signer.address)<fee)throw new Error('Employee needs Sepolia ETH');
            row.raw=await signer.signTransaction(tx);row.hash=keccak256(row.raw);
            db.prepare("UPDATE ens_writes SET raw=?,hash=?,state='submitted',error=NULL WHERE id=?").run(row.raw,row.hash,row.id);
          }
          let receipt=await provider.getTransactionReceipt(row.hash);
          if(!receipt) {
            try{await provider.broadcastTransaction(row.raw)}catch{if(!await provider.getTransaction(row.hash))throw new Error('Unknown ENS broadcast; original bytes retained')}
            receipt=await provider.getTransactionReceipt(row.hash);
          }
          if(!receipt)break;
          db.prepare('UPDATE ens_writes SET state=?,error=? WHERE id=?').run(receipt.status===1?'confirmed':'failed',receipt.status===1?null:'Resolver rejected the delegated edit',row.id);
        }catch(error) {
          if(!row.raw&&error.message==='Employee is fired or expired') {
            db.prepare("UPDATE ens_writes SET state='failed',error='Employee is fired or expired' WHERE id=?").run(row.id);
            continue;
          }
          db.prepare('UPDATE ens_writes SET error=? WHERE id=?').run('ENS edit paused. Check employment, scoped permissions and employee Sepolia ETH; saved transactions are retained.',row.id);
          break;
        }
      }
    },
  };
}
