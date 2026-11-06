import test from 'node:test';
import assert from 'node:assert/strict';
import {retryRPCRead} from './chain.js';

test('RPC startup retries transport timeouts with a cap and never retries policy failures',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let attempts=0;
 const timeout=Object.assign(new Error('request timeout'),{code:'TIMEOUT'});
 const recovered=retryRPCRead(async()=>{if(++attempts===1)throw timeout;return 1874});
 await new Promise(resolve=>setImmediate(resolve));t.mock.timers.tick(1000);
 assert.equal(await recovered,1874);assert.equal(attempts,2);
 attempts=0;
 const failed=assert.rejects(retryRPCRead(async()=>{attempts++;throw timeout}),error=>error===timeout);
 for(let i=0;i<2;i++){await new Promise(resolve=>setImmediate(resolve));t.mock.timers.tick(1000)}
 await failed;assert.equal(attempts,3);
 attempts=0;await assert.rejects(retryRPCRead(async()=>{attempts++;throw new Error('Wrong chain')}),/Wrong chain/);assert.equal(attempts,1);
});
