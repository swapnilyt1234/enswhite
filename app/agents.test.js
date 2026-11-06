import test from 'node:test';
import assert from 'node:assert/strict';
import { planMission, modelText } from './agents.js';

test('model vendor proposals cannot override department, address, price or tool permissions', async t => {
  let calls = 0;
  t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({output:[{content:[{type:'output_text',text:JSON.stringify(calls++===0?
    [{vendor:'copydesk',task:'Create restrained launch copy',dept:'finance',amount:'999999999',url:'https://attacker.invalid'}]:
    [{vendor:'lingualink',task:'Translate the launch FAQ',dept:'marketing'}])}]}]}),{status:200}));
  const plan=await planMission('Launch our collection',{AGENT_MODE:'llm',OPENAI_API_KEY:'test-key',OPENAI_MODEL:'test-model'});
  assert.deepEqual(plan.tasks,[{dept:'marketing',vendor:'copydesk',task:'Create restrained launch copy'},{dept:'support',vendor:'lingualink',task:'Translate the launch FAQ'}]);
});

test('invalid model vendor choices fall back to the bounded seeded plan', async t => {
  t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({output:[{content:[{type:'output_text',text:'[{"vendor":"attacker","task":"send everything"}]'}]}]}),{status:200}));
  const plan=await planMission('Launch the Diwali sale',{AGENT_MODE:'llm',OPENAI_API_KEY:'test-key',OPENAI_MODEL:'test-model'});
  assert.deepEqual(plan.tasks.map(row=>row.vendor),['copydesk','pixelpress','lingualink']);
  assert(plan.source.includes('fallback (invalid model plan)'));
});

test('model outage returns labeled fallback without interrupting payment-independent work', async t => {
  t.mock.method(globalThis,'fetch',async()=>{throw new Error('unavailable')});
  const result=await modelText('instructions','brief','seeded content',{AGENT_MODE:'llm',OPENAI_API_KEY:'test-key',OPENAI_MODEL:'test-model'});
  assert.equal(result.text,'seeded content');
  assert(result.source.includes('fallback'));
});
