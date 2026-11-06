import {Contract, getAddress} from 'ethers';
import {readFileSync,existsSync} from 'node:fs';
export const IDENTITY_REGISTRY='0x8004A818BFB912233c491871b3d84c89A494BD9e';
export const AGENT_ABI=['function register() returns(uint256)','function ownerOf(uint256) view returns(address)','function getAgentWallet(uint256) view returns(address)','function tokenURI(uint256) view returns(string)','function setAgentURI(uint256,string)','event Registered(uint256 indexed agentId,string agentURI,address indexed owner)'];
export function registrationKey(chainId,registry,agentId){
 const chain=BigInt(chainId),id=String(agentId);if(chain<=0n||!/^\d+$/.test(id))throw new Error('Invalid agent registration');
 let reference=chain.toString(16);if(reference.length%2)reference='0'+reference;if(reference.length>510)throw new Error('Chain reference too long');
 const address=getAddress(registry).slice(2).toLowerCase(),encoded=`0x00010000${(reference.length/2).toString(16).padStart(2,'0')}${reference}14${address}`;
 return `agent-registration[${encoded}][${BigInt(id)}]`;
}
export function agentRegistration(label,name,origin,id){
 if(!['marketing','support','finance'].includes(label)||new URL(origin).protocol!=='https:')throw new Error('Invalid public agent profile');
 if(!/^\d+$/.test(String(id))||!Number.isSafeInteger(Number(id)))throw new Error('Agent ID cannot be represented safely in registration JSON');
 return {type:'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',name,description:`EnsWhite ${label} department. Custom x402 enswhite-receive on Whitechain Sepolia; no public signing endpoint. ENS employment and company limits separately govern payments.`,image:'https://raw.githubusercontent.com/swapnilyt1234/enswhite/main/docs/images/enswhite-avatar.svg',services:[{name:'web',endpoint:`${new URL(origin).origin}/agents/${label}`},{name:'ENS',endpoint:name,version:'2'}],x402Support:true,active:true,registrations:[{agentId:Number(id),agentRegistry:`eip155:11155111:${IDENTITY_REGISTRY}`}],supportedTrust:['reputation']};
}
export const registrationURI=profile=>'data:application/json;base64,'+Buffer.from(JSON.stringify(profile)).toString('base64');
export function identityManifest(path){const file=path||new URL('../docs/deployments/agent-identities.json',import.meta.url);return existsSync(file)?JSON.parse(readFileSync(file,'utf8')):[]}
export async function verifyAgentBinding(identity,entry,getText,registry){
 const key=registrationKey(11155111,IDENTITY_REGISTRY,entry.agentId),claim=await getText(key);
 if(!claim)return {verified:false,key,reason:'ENS registration consent missing'};
 const [owner,wallet,uri]=await Promise.all([registry.ownerOf(entry.agentId),registry.getAgentWallet(entry.agentId),registry.tokenURI(entry.agentId)]);
 if(getAddress(owner)!==getAddress(identity.wallet)||getAddress(wallet)!==getAddress(identity.wallet))return {verified:false,key,reason:'Registry ownership or agent wallet differs from current ENS employee'};
 const prefix='data:application/json;base64,';if(!uri.startsWith(prefix)||uri.length>32000)return {verified:false,key,reason:'Unsupported registration URI'};
 const metadata=JSON.parse(Buffer.from(uri.slice(prefix.length),'base64').toString('utf8'));
 const matches=metadata.type==='https://eips.ethereum.org/EIPS/eip-8004#registration-v1'&&metadata.services?.some(x=>x.name==='ENS'&&x.endpoint===identity.name)&&metadata.registrations?.some(x=>String(x.agentId)===String(entry.agentId)&&x.agentRegistry?.toLowerCase()===`eip155:11155111:${IDENTITY_REGISTRY}`.toLowerCase());
 return {verified:!!matches,key,agentId:String(entry.agentId),registry:IDENTITY_REGISTRY,owner:getAddress(owner),registration:matches?metadata:null,reason:matches?'ENS consent and current registry owner/wallet match':'Registration metadata does not bind this ENS name'};
}
export const identityContract=provider=>new Contract(IDENTITY_REGISTRY,AGENT_ABI,provider);
