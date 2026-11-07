import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {Contract,Interface} from 'ethers';
import {createTestnetProvider} from './testnet-provider.js';
import {registrationKey,IDENTITY_REGISTRY} from './agent-identity.js';
import {parseCompanyLog} from './company-chain.js';

const cedar=JSON.parse(await readFile(new URL('../docs/deployments/cedar-studio-1107.json',import.meta.url),'utf8'));
const provider=createTestnetProvider('https://rpc.testnet.whitechain.io',1874),token='0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7';
const sepolia=createTestnetProvider('https://ethereum-sepolia-rpc.publicnode.com',11155111);
const transfers=new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
try{
 assert.equal((await provider.getNetwork()).chainId,1874n);
 const contract=new Contract(cedar.whitechainCompany,['function token() view returns(address)','function identityRequired() view returns(bool)'],provider);
 assert.equal((await contract.token()).toLowerCase(),token.toLowerCase());assert.equal(await contract.identityRequired(),true);
 const payments=[];
 for(const expected of cedar.mission.payments){
  const receipt=await provider.getTransactionReceipt(expected.hash);assert.equal(receipt?.status,1);
  const paid=receipt.logs.filter(log=>log.address.toLowerCase()===cedar.whitechainCompany.toLowerCase()).map(parseCompanyLog).find(log=>log?.name==='Paid');
  assert(paid);assert.equal(String(paid.args.amount),expected.amount);assert.notEqual(receipt.from.toLowerCase(),paid.args.dept.toLowerCase());
  const tokenEvents=receipt.logs.filter(log=>log.address.toLowerCase()===token.toLowerCase()).map(log=>transfers.parseLog(log)).filter(Boolean);
  assert(tokenEvents.some(log=>log.args.from.toLowerCase()===cedar.whitechainCompany.toLowerCase()&&log.args.to.toLowerCase()===paid.args.vendor.toLowerCase()&&log.args.value===paid.args.amount-paid.args.fee));
  payments.push({vendor:expected.vendor,hash:expected.hash,block:receipt.blockNumber,grossUnits:String(paid.args.amount),feeUnits:String(paid.args.fee),payer:String(paid.args.dept),gasPayer:receipt.from,tokenTransferVerified:true});
 }
 const departments=await Promise.all(cedar.employees.map(async employee=>({department:employee.label,address:employee.owner,wbt:String(await provider.getBalance(employee.owner))})));
 assert(departments.every(department=>department.wbt==='0'));
 const contracts=[];
 for(const address of ['0xbca635f00C07681f10269f69ca293bDB6536D6aB',cedar.whitechainCompany,'0x005d2a5A578fE3A048F6B69Df6146F42E29E8dEa','0x25643a29809999B5134B0aaB4f0Ac717b3100A12']){
  const response=await fetch('https://explorer.testnet.whitechain.io/api/v2/smart-contracts/'+address,{signal:AbortSignal.timeout(15000)});assert(response.ok);const info=await response.json();assert(info.is_verified||info.source_code);contracts.push({address,verified:true,name:info.name,compiler:info.compiler_version});
 }
 const employee=cedar.employees.find(row=>row.label==='marketing'),identity=new Contract(IDENTITY_REGISTRY,['function ownerOf(uint256) view returns(address)','function getAgentWallet(uint256) view returns(address)'],sepolia);
 const [network,owner,code,resolver]=await Promise.all([sepolia.getNetwork(),identity.ownerOf(employee.agentId),sepolia.getCode(cedar.ensRegistry),sepolia.getResolver(employee.name)]);
 assert.equal(network.chainId,11155111n);assert.equal(owner.toLowerCase(),employee.owner.toLowerCase());assert.equal((await identity.getAgentWallet(employee.agentId)).toLowerCase(),employee.owner.toLowerCase());assert.notEqual(code,'0x');assert(resolver);
 const [wallet,consent,context]=await Promise.all([resolver.getAddress(2147485522),resolver.getText(registrationKey(11155111,IDENTITY_REGISTRY,employee.agentId)),resolver.getText('agent-context')]);
 assert.equal(wallet.toLowerCase(),employee.owner.toLowerCase());assert.equal(consent,'1');assert(context);
 const ens={checkedAt:new Date().toISOString(),chainId:11155111,company:cedar.companyName,registry:cedar.ensRegistry,employee:employee.name,agentId:employee.agentId,wallet,ensip25ConsentVerified:true,agentContextPresent:true};
 const result={ens,checkedAt:new Date().toISOString(),chainId:1874,token,company:cedar.whitechainCompany,payments,departments,contracts};
 if(process.argv.includes('--save'))await writeFile(new URL('../docs/deployments/submission-checks.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result,null,2));
}finally{provider.destroy();sepolia.destroy()}
