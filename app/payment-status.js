export function readPaymentStatus(db,company,explorer){
 const exists=name=>!!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
 const payments=exists('company_orders')&&exists('company_jobs')?db.prepare("SELECT o.id AS orderId,o.amount,o.units,j.state,j.hash FROM company_orders o LEFT JOIN company_jobs j ON j.id='credit:'||o.id ORDER BY o.rowid DESC LIMIT 10").all():[];
 let businessName;if(exists('settings')){try{businessName=JSON.parse(db.prepare("SELECT value FROM settings WHERE key='business_profile'").get()?.value||'{}').name}catch{}}
 return{company,explorer,businessName,payments};
}
