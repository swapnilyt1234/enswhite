import test from 'node:test';
import assert from 'node:assert/strict';
import {Wallet,Interface,keccak256,toUtf8Bytes} from 'ethers';
import {rankVendors,feedbackPayload,feedbackTransaction,REPUTATION_ABI} from './reputation.js';
import {landingSection} from './landing-section.js';

test('reputation summaries require explicit company clients and matching payee identities',async()=>{
 const client=Wallet.createRandom().address,vendor=Wallet.createRandom().address;let read=0;
 const registry={getSummary:async(id,clients,tag)=>{read++;assert.deepEqual(clients,[client]);assert.equal(tag,'starred');return[2n,80n,0n]}},identity={ownerOf:async()=>vendor,getAgentWallet:async()=>vendor};
 await assert.rejects(rankVendors(registry,identity,[],[]),/non-empty/);
 const result=await rankVendors(registry,identity,[{id:'copydesk',agentId:'1',address:vendor}],[client]);assert.equal(result[0].reputation.score,80);assert.equal(read,1);
 await assert.rejects(rankVendors(registry,identity,[{id:'spoof',agentId:'1',address:client}],[client]),/payee/);assert.equal(read,1);
});
test('feedback commits the exact payment-proof file and 1–5 stars become starred 0–100 scores',()=>{
 const payload=feedbackPayload({agentId:'11295',client:Wallet.createRandom().address,score:4,comment:'Useful output',proof:{chainId:'1874',txHash:'0x'+'ab'.repeat(32),fromAddress:Wallet.createRandom().address,toAddress:Wallet.createRandom().address}});
 assert.equal(payload.hash,keccak256(toUtf8Bytes(JSON.stringify(payload.file))));
 const decoded=new Interface(REPUTATION_ABI).parseTransaction(feedbackTransaction(payload));assert.equal(decoded.args.value,80n);assert.equal(decoded.args.tag1,'starred');assert.equal(payload.file.proofOfPayment.txHash,'0x'+'ab'.repeat(32));
 assert.throws(()=>feedbackTransaction({...payload,hash:'0x'+'00'.repeat(32)}),/integrity/);
});
test('model-written landing sections escape markup and cannot introduce executable attributes',()=>{
 const html=landingSection(JSON.stringify({headline:'<script>alert(1)</script>',body:'A & B',cta:'Buy "now"'}));assert(!html.includes('<script>'));assert(html.includes('&lt;script&gt;'));assert(html.includes('A &amp; B'));
 assert.throws(()=>landingSection('{"headline":"Title","body":"Body","cta":"Go","onclick":"bad"}'));
});
