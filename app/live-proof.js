import { readFileSync } from 'node:fs';
import { Contract, FetchRequest, JsonRpcProvider } from 'ethers';
import { createENSDirectory, WHITECHAIN_COIN_TYPE } from './ens.js';
import { IDENTITY_ABI, readCompanyEvents } from './company-chain.js';
import { TOKEN } from './chain.js';
import { VENDORS } from './company-store.js';

// This module accepts public deployment information only; it never opens a wallet store.
export function createLiveProof() {
  const manifest=JSON.parse(readFileSync(new URL('../docs/deployments/enswhite-testnets.json',import.meta.url),'utf8'));
  const ens=createENSDirectory(manifest.ens), request=new FetchRequest('https://rpc.testnet.whitechain.io');request.timeout=10000;
  const provider=new JsonRpcProvider(request,1874,{cacheTimeout:0});
  const company=new Contract(manifest.whitechain.company,IDENTITY_ABI,provider);
  const token=new Contract(TOKEN,['function balanceOf(address) view returns(uint256)'],provider);
  let cache,pending,lastAttempt=0;
  return {
    async read(){
      if(cache&&Date.now()-cache.fetchedAt<30000)return cache;
      if(pending)return pending;
      if(Date.now()-lastAttempt<10000)throw new Error('RPC temporarily unavailable; retry shortly');
      lastAttempt=Date.now();
      pending=(async()=>{
        if((await provider.getNetwork()).chainId!==1874n)throw new Error('Wrong Whitechain network');
        const [organization,events,block,companyBalance,feePool]=await Promise.all([ens.organization(),readCompanyEvents(provider,company.target,manifest.whitechain.deploymentBlock),provider.getBlockNumber(),company.companyBalance(),company.feePool()]);
        const ledger=events.filter(x=>x.kind==='payment');
        const vendors=await Promise.all(VENDORS.map(async v=>{
          const name=`${v.id}.vendors.${manifest.ens.ENS_PARENT_NAME}`,resolver=await ens.provider.getResolver(name);
          if(!resolver)throw new Error('Vendor ENS resolution unavailable');
          const wallet=await resolver.getAddress(WHITECHAIN_COIN_TYPE);if(!wallet)throw new Error('Vendor wallet missing');
          const receipts=ledger.filter(x=>x.vendor.toLowerCase()===wallet.toLowerCase());
          return {...v,name:v.name,ensName:name,wallet,resolver:resolver.address,receipts,netUnits:String(receipts.reduce((n,x)=>n+BigInt(x.amount)-BigInt(x.fee),0n))};
        }));
        const team=await Promise.all(organization.map(async x=>({...x,balance:String(await token.balanceOf(x.wallet))})));
        cache={fetchedAt:Date.now(),mode:'testnet',company:company.target,companyName:ens.companyName,block,companyBalance:String(companyBalance),feePool:String(feePool),team,vendors,ledger,scope:'Read-only Sepolia ENS and Whitechain Sepolia. Fiat is simulated. No signer or payment endpoints.'};return cache;
      })().finally(()=>{pending=null});return pending;
    },
    close(){ens.close();provider.destroy()},
  };
}
