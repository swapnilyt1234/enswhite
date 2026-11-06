import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestnetProvider} from './testnet-provider.js';

test('native RPC transport preserves chain checks and refuses mainnet or insecure configuration',async()=>{
 assert.throws(()=>createTestnetProvider('http://example.invalid',11155111));assert.throws(()=>createTestnetProvider('https://example.invalid',1));
 let requests=0;const request=async(url,options)=>{requests++;assert(options.signal);const data=JSON.parse(Buffer.from(options.body).toString());const reply=x=>({jsonrpc:'2.0',id:x.id,result:x.method==='eth_chainId'?'0xaa36a7':'0x123'});return Response.json(Array.isArray(data)?data.map(reply):reply(data))};
 const provider=createTestnetProvider('https://example.invalid/rpc',11155111,request);
 try{assert.equal((await provider.getNetwork()).chainId,11155111n);assert.equal(await provider.getBlockNumber(),0x123);assert(requests>=2)}finally{provider.destroy()}
 const wrong=createTestnetProvider('https://example.invalid/rpc',11155111,async(url,options)=>{const x=JSON.parse(Buffer.from(options.body).toString());return Response.json({jsonrpc:'2.0',id:x.id,result:'0x1'})});
 try{await assert.rejects(wrong.getNetwork(),error=>error.code==='NETWORK_ERROR')}finally{wrong.destroy()}
});
