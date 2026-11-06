import {Contract,getAddress,keccak256,toUtf8Bytes} from 'ethers';
import {IDENTITY_REGISTRY,registrationURI} from './agent-identity.js';

export const REPUTATION_REGISTRY='0x8004B663056A597Dffe9eCcC1965A193B7388713';
export const REPUTATION_ABI=[
 'function getIdentityRegistry() view returns(address)',
 'function giveFeedback(uint256 agentId,int128 value,uint8 valueDecimals,string tag1,string tag2,string endpoint,string feedbackURI,bytes32 feedbackHash)',
 'function getSummary(uint256 agentId,address[] clientAddresses,string tag1,string tag2) view returns(uint64 count,int128 summaryValue,uint8 summaryValueDecimals)',
];
export async function rankVendors(registry,identity,vendors,clients){
 if(!clients.length)throw new Error('A non-empty company department client list is required.');
 const trusted=[...new Set(clients.map(getAddress))];
 const result=[];
 for(const vendor of vendors){
  if(!vendor.agentId){result.push({...vendor,reputation:null});continue}
  if(getAddress(await identity.ownerOf(vendor.agentId))!==getAddress(vendor.address)||getAddress(await identity.getAgentWallet(vendor.agentId))!==getAddress(vendor.address))throw new Error('Vendor ERC-8004 identity differs from its approved payee.');
  const [count,value,decimals]=await registry.getSummary(vendor.agentId,trusted,'starred','');
  result.push({...vendor,reputation:{count:String(count),score:count?Number(value)/10**Number(decimals):null,clients:trusted}});
 }
 return result.sort((a,b)=>(b.reputation?.score??-1)-(a.reputation?.score??-1)||a.id.localeCompare(b.id));
}
export function feedbackPayload({agentId,client,score,comment,proof,context,createdAt=new Date().toISOString()}){
 if((!/^\d+$/.test(String(agentId))||!Number.isSafeInteger(Number(agentId)))||!Number.isInteger(score)||score<1||score>5||typeof comment!=='string'||!comment.trim()||comment.length>1000)throw new Error('Invalid review');
 if(proof&&(!/^0x[\da-f]{64}$/i.test(proof.txHash)||proof.chainId!=='1874'))throw new Error('A real Whitechain payment proof is required.');
 const file={agentRegistry:`eip155:11155111:${IDENTITY_REGISTRY}`,agentId:Number(agentId),clientAddress:`eip155:11155111:${getAddress(client)}`,createdAt,value:score*20,valueDecimals:0,tag1:'starred',tag2:'enswhite',comment,...(context?{context}:{}),...(proof?{proofOfPayment:{...proof,fromAddress:getAddress(proof.fromAddress),toAddress:getAddress(proof.toAddress)}}:{})};
 const json=JSON.stringify(file);
 return{agentId:String(agentId),score:score*20,uri:registrationURI(file),hash:keccak256(toUtf8Bytes(json)),file};
}
export function feedbackTransaction(payload){
 const json=JSON.stringify(payload.file);
 if(payload.uri!==registrationURI(payload.file)||payload.hash!==keccak256(toUtf8Bytes(json))||payload.file.value!==payload.score||String(payload.file.agentId)!==payload.agentId)throw new Error('Feedback file integrity rejected');
 const registry=new Contract(REPUTATION_REGISTRY,REPUTATION_ABI);
 return{to:REPUTATION_REGISTRY,data:registry.interface.encodeFunctionData('giveFeedback',[payload.agentId,payload.score,0,'starred','enswhite','',payload.uri,payload.hash]),chainId:11155111};
}
