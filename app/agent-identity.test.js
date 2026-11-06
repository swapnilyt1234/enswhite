import test from 'node:test';
import assert from 'node:assert/strict';
import {registrationKey,agentRegistration,registrationURI,verifyAgentBinding} from './agent-identity.js';
test('ENSIP-25 key uses the ERC-7930 minimal big-endian EVM chain reference',()=>{
 assert.equal(registrationKey(1,'0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',22),'agent-registration[0x000100000101148004a169fb4a3325136eb29fa0ceb6d2e539a432][22]');
 assert.match(registrationKey(11155111,'0x8004A818BFB912233c491871b3d84c89A494BD9e',3),/0x0001000003aa36a714/);assert.throws(()=>registrationKey(0,'bad',3));
});
test('identity requires ENS consent, matching metadata, current owner and current agent wallet',async()=>{
 const identity={name:'marketing.acme.enswhite.eth',wallet:'0x1111111111111111111111111111111111111111'},profile=agentRegistration('marketing',identity.name,'https://example.com',42),entry={agentId:42};
 const registry={ownerOf:async()=>identity.wallet,getAgentWallet:async()=>identity.wallet,tokenURI:async()=>registrationURI(profile)};
 assert.equal((await verifyAgentBinding(identity,entry,async()=>null,registry)).verified,false);
 assert.equal((await verifyAgentBinding(identity,entry,async()=>'1',registry)).verified,true);
 registry.getAgentWallet=async()=>'0x0000000000000000000000000000000000000000';assert.equal((await verifyAgentBinding(identity,entry,async()=>'1',registry)).verified,false);
 assert(!profile.services.some(x=>['MCP','A2A'].includes(x.name)));
});
