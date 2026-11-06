export function createAgentStore(db){
 db.exec(`CREATE TABLE IF NOT EXISTS agent_runs(id TEXT PRIMARY KEY,mission_id TEXT NOT NULL,department TEXT NOT NULL,purpose TEXT NOT NULL,source TEXT NOT NULL,state TEXT NOT NULL,input TEXT NOT NULL DEFAULT '[]',calls INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,observation TEXT,error TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS agent_actions(run_id TEXT NOT NULL,call_id TEXT NOT NULL,name TEXT NOT NULL,arguments TEXT NOT NULL,result TEXT,state TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(run_id,call_id));
 CREATE TABLE IF NOT EXISTS agent_messages(id INTEGER PRIMARY KEY,run_id TEXT NOT NULL,mission_id TEXT NOT NULL,sender TEXT NOT NULL,recipient TEXT NOT NULL,kind TEXT NOT NULL,content TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS agent_memory(run_id TEXT PRIMARY KEY,department TEXT NOT NULL,mission_id TEXT NOT NULL,summary TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS mission_deliverables(mission_id TEXT NOT NULL,department TEXT NOT NULL,kind TEXT NOT NULL,content TEXT NOT NULL,source TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(mission_id,department,kind));
 CREATE TABLE IF NOT EXISTS company_profiles(id INTEGER PRIMARY KEY,mission_id TEXT UNIQUE,profile TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS agent_quotes(mission_id TEXT NOT NULL,vendor TEXT NOT NULL,department TEXT NOT NULL,brief TEXT NOT NULL,quote TEXT NOT NULL,PRIMARY KEY(mission_id,vendor));
 CREATE TABLE IF NOT EXISTS finance_proposals(id TEXT PRIMARY KEY,mission_id TEXT,allocations TEXT NOT NULL,rationale TEXT NOT NULL,source TEXT NOT NULL,state TEXT NOT NULL,created_at INTEGER NOT NULL);`);
 if(!db.prepare('PRAGMA table_info(agent_runs)').all().some(x=>x.name==='version'))db.exec('ALTER TABLE agent_runs ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
 db.exec("CREATE TABLE IF NOT EXISTS founder_questions(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,question TEXT NOT NULL,answer TEXT,created_at INTEGER NOT NULL)");
 const time=()=>Date.now();
 return{
  ensure(mission,department,source,purpose='mission',version=1){const id=`${mission}:${department}:${purpose}`,t=time();db.prepare("INSERT OR IGNORE INTO agent_runs(id,mission_id,department,purpose,source,state,created_at,updated_at,version) VALUES(?,?,?,?,?,'queued',?,?,?)").run(id,mission,department,purpose,source,t,t,version);return id},
  run:id=>db.prepare('SELECT * FROM agent_runs WHERE id=?').get(id),
  runs:()=>db.prepare('SELECT id,mission_id,department,purpose,source,state,calls,attempts,error,created_at,updated_at,version FROM agent_runs ORDER BY created_at DESC LIMIT 100').all(),
  actions:id=>db.prepare('SELECT * FROM agent_actions WHERE run_id=? ORDER BY rowid').all(id).map(x=>({...x,arguments:JSON.parse(x.arguments),result:x.result?JSON.parse(x.result):null})),
  message(run,recipient,kind,content){db.prepare('INSERT INTO agent_messages(run_id,mission_id,sender,recipient,kind,content,created_at) VALUES(?,?,?,?,?,?,?)').run(run.id,run.mission_id,run.department,recipient,kind,JSON.stringify(content),time())},
  messages:mission=>db.prepare('SELECT * FROM agent_messages WHERE mission_id=? ORDER BY id LIMIT 100').all(mission).map(x=>({...x,content:JSON.parse(x.content)})),
  artifact(mission,department,kind,content,source){const prior=db.prepare('SELECT content FROM mission_deliverables WHERE mission_id=? AND department=? AND kind=?').get(mission,department,kind);if(prior)return JSON.parse(prior.content);db.prepare('INSERT INTO mission_deliverables VALUES(?,?,?,?,?,?)').run(mission,department,kind,JSON.stringify(content),source,time());return content},
  artifactFor(mission,department,kind){const row=db.prepare('SELECT content FROM mission_deliverables WHERE mission_id=? AND department=? AND kind=?').get(mission,department,kind);return row?JSON.parse(row.content):null},
  memory:department=>db.prepare('SELECT mission_id,summary,created_at FROM agent_memory WHERE department=? ORDER BY created_at DESC LIMIT 5').all(department),
  checkpoint(id,patch){const allowed=['state','input','calls','attempts','observation','error'];if(Object.keys(patch).some(x=>!allowed.includes(x)))throw new Error('Invalid run checkpoint');const keys=Object.keys(patch);db.prepare(`UPDATE agent_runs SET ${keys.map(k=>k+'=?').join(',')},updated_at=? WHERE id=?`).run(...keys.map(k=>patch[k]),time(),id)},
 };
}
