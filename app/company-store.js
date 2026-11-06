import { Wallet } from 'ethers';
import { encrypt, decrypt } from './payments.js';

export function walletStore(db, encryptionKey) {
  db.exec('CREATE TABLE IF NOT EXISTS company_wallets (name TEXT PRIMARY KEY,role TEXT NOT NULL,address TEXT NOT NULL,secret TEXT NOT NULL)');
  return (name, role) => {
    let row = db.prepare('SELECT * FROM company_wallets WHERE name=?').get(name);
    if (!row) {
      const wallet = Wallet.createRandom();
      db.prepare('INSERT INTO company_wallets VALUES(?,?,?,?)').run(name, role, wallet.address, encrypt(encryptionKey, wallet.privateKey));
      row = db.prepare('SELECT * FROM company_wallets WHERE name=?').get(name);
    }
    return new Wallet(decrypt(encryptionKey, row.secret));
  };
}

export const DEPARTMENTS = [
  { id: 'marketing', name: 'Marketing', title: 'Find the words. Make the launch.', weekly: '3000000', perCall: '500000', perDay: '3000000', approval: '150000' },
  { id: 'support', name: 'Support', title: 'Be there for every customer.', weekly: '1500000', perCall: '200000', perDay: '1500000', approval: '100000' },
  { id: 'finance', name: 'Finance', title: 'Keep the company accountable.', weekly: '500000', perCall: '100000', perDay: '500000', approval: '50000' },
];
export const VENDORS = [
  { id: 'copydesk', name: 'CopyDesk', port: 4001, price: '100000', service: 'Launch copy', dept: 'marketing' },
  { id: 'pixelpress', name: 'PixelPress', port: 4002, price: '200000', service: 'Campaign banner', dept: 'marketing' },
  { id: 'lingualink', name: 'LinguaLink', port: 4003, price: '100000', service: 'Hindi / Marathi FAQ', dept: 'support' },
];
