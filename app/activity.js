import {EventEmitter} from 'node:events';

export function createActivity(db) {
  db.exec('CREATE TABLE IF NOT EXISTS company_activity (id INTEGER PRIMARY KEY AUTOINCREMENT, mission TEXT, department TEXT NOT NULL, kind TEXT NOT NULL, message TEXT NOT NULL, data TEXT NOT NULL, time INTEGER NOT NULL, event_key TEXT UNIQUE)');
  const events=new EventEmitter();events.setMaxListeners(100);
  const decode=row=>row?{...row,data:JSON.parse(row.data)}:null;
  return {
    record(department,kind,message,{mission=null,data={},key=null}={}) {
      if(!['marketing','support','finance','company'].includes(department)||typeof message!=='string'||!message||message.length>1200)throw new Error('Invalid activity');
      const result=db.prepare('INSERT OR IGNORE INTO company_activity(mission,department,kind,message,data,time,event_key) VALUES(?,?,?,?,?,?,?)').run(mission,department,kind,message,JSON.stringify(data),Date.now(),key);
      if(result.changes){const row=decode(db.prepare('SELECT * FROM company_activity WHERE id=?').get(result.lastInsertRowid));events.emit('activity',row);return row}
      return null;
    },
    since(after=0) {
      if(!Number.isSafeInteger(after)||after<0)throw new Error('Invalid activity cursor');
      return db.prepare('SELECT * FROM company_activity WHERE id>? ORDER BY id LIMIT 200').all(after).map(decode);
    },
    subscribe(listener){events.on('activity',listener);return ()=>events.off('activity',listener)},
    close(){events.removeAllListeners()},
  };
}
