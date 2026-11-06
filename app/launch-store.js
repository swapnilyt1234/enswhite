import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {openStore,fail} from './payments.js';

export const launchPolicy={companiesPerDay:2,sepoliaWei:20_000_000_000_000_000n,whitechainWei:100_000_000_000_000_000n,poolUnits:10_000_000n};
export const visitorHash=token=>createHash('sha256').update(token).digest('hex');
export function createLaunchStore(directory='data/launch'){
 const {db}=openStore(directory);
 db.exec(`CREATE TABLE IF NOT EXISTS launch_visitors(id TEXT PRIMARY KEY,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS launches(id TEXT PRIMARY KEY,visitor TEXT UNIQUE NOT NULL,label TEXT UNIQUE NOT NULL,name TEXT NOT NULL,description TEXT NOT NULL,roles TEXT,state TEXT NOT NULL,config TEXT,error TEXT,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS launch_transactions(id TEXT PRIMARY KEY,launch TEXT NOT NULL,step TEXT NOT NULL,chain INTEGER NOT NULL,raw TEXT NOT NULL,hash TEXT NOT NULL,fee TEXT NOT NULL,value TEXT NOT NULL,token_units TEXT NOT NULL,state TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS launch_worker(id INTEGER PRIMARY KEY CHECK(id=1),instance TEXT NOT NULL,heartbeat INTEGER NOT NULL);`);
 return{db,
  visitor(token){if(token&&/^[a-f0-9]{64}$/.test(token)&&db.prepare('SELECT id FROM launch_visitors WHERE id=?').get(visitorHash(token)))return token;
   if(db.prepare('SELECT COUNT(*) n FROM launch_visitors WHERE created_at>=?').get(Date.now()-86400000).n>=100)throw fail('Daily visitor limit reached',429);
   const value=randomBytes(32).toString('hex');db.prepare('INSERT INTO launch_visitors VALUES(?,?)').run(visitorHash(value),Date.now());return value},
  job(token){const row=db.prepare('SELECT * FROM launches WHERE visitor=?').get(visitorHash(token));if(!row)return null;const steps=db.prepare('SELECT step,chain,hash,state FROM launch_transactions WHERE launch=? ORDER BY rowid').all(row.id);return{id:row.id,name:row.name,description:row.description,label:row.label,companyName:`${row.label}.enswhite.eth`,roles:row.roles?JSON.parse(row.roles):null,state:row.state,error:row.error,steps}},
  create(token,input){
   if(!input||Object.keys(input).some(x=>!['name','description','label'].includes(x)))throw fail('Invalid business fields');
   const {name,description,label}=input;
   if(!db.prepare('SELECT id FROM launch_visitors WHERE id=?').get(visitorHash(token)))throw fail('Start a visitor session',401);
   if(typeof name!=='string'||!name.trim()||name.length>80||typeof description!=='string'||!description.trim()||description.length>600||typeof label!=='string'||!/^[a-z0-9][a-z0-9-]{0,39}$/.test(label))throw fail('Enter a name, one-line description and lowercase company label');
   const old=this.job(token);if(old){if(old.label!==label||old.name!==name||old.description!==description)throw fail('One company per visitor. Resume your existing launch.',409);return old}
   if(db.prepare('SELECT id FROM launches WHERE label=?').get(label))throw fail('That company label is already requested',409);
   if(db.prepare('SELECT COUNT(*) n FROM launches WHERE created_at>=?').get(Math.floor(Date.now()/86400000)*86400000).n>=launchPolicy.companiesPerDay)throw fail('Daily operator company budget reached',429);
   db.prepare("INSERT INTO launches VALUES(?,?,?,?,?,NULL,'queued',NULL,NULL,?)").run(randomUUID(),visitorHash(token),label,name,description,Date.now());return this.job(token);
  },
  hire(token,roles){
   const row=this.job(token);if(!row)throw fail('Launch your business first',409);
   if(!Array.isArray(roles)||roles.length<2||new Set(roles).size!==roles.length||!roles.includes('finance')||roles.some(x=>!['marketing','support','finance'].includes(x)))throw fail('Choose Finance and at least one working department');
   const saved=[...roles].sort();if(row.roles&&JSON.stringify([...row.roles].sort())!==JSON.stringify(saved))throw fail('The hiring plan is already saved',409);
   db.prepare('UPDATE launches SET roles=? WHERE id=?').run(JSON.stringify(saved),row.id);return this.job(token);
  },
  ready(){return(db.prepare('SELECT heartbeat FROM launch_worker WHERE id=1').get()?.heartbeat||0)>Date.now()-30000},
  close(){db.close()},
 };
}
