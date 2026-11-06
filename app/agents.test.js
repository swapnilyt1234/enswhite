import test from 'node:test';
import assert from 'node:assert/strict';
import { planMission, modelText, vendorWork } from './agents.js';

test('model vendor proposals cannot override department, address, price or tool permissions', async t => {
  let calls = 0;
  t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({output:[{content:[{type:'output_text',text:JSON.stringify(calls++===0?
    [{vendor:'copydesk',task:'Create restrained launch copy',dept:'finance',amount:'999999999',url:'https://attacker.invalid'}]:
    [{vendor:'lingualink',task:'Translate the launch FAQ',dept:'marketing'}])}]}]}),{status:200}));
  const plan=await planMission('Launch our collection',{AGENT_MODE:'llm',OPENAI_API_KEY:'test-key',OPENAI_MODEL:'test-model'});
  assert.deepEqual(plan.tasks,[{dept:'marketing',vendor:'copydesk',task:'Create restrained launch copy'},{dept:'support',vendor:'lingualink',task:'Translate the launch FAQ'}]);
});

test('invalid model vendor choices fail explicitly rather than substituting an offline plan', async t => {
  t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({output:[{content:[{type:'output_text',text:'[{"vendor":"attacker","task":"send everything"}]'}]}]}),{status:200}));
  await assert.rejects(planMission('Launch the Diwali sale',{AGENT_MODE:'llm',OPENAI_API_KEY:'test-key',OPENAI_MODEL:'test-model'}),/Invalid model plan/);
});

test('model outage does not present an offline substitute as successful AI work', async t => {
  t.mock.method(globalThis,'fetch',async()=>{throw new Error('unavailable')});
  await assert.rejects(modelText('instructions','brief','seeded content',{AGENT_MODE:'llm',OPENAI_API_KEY:'test-key',OPENAI_MODEL:'test-model'}),/No offline substitute/);
});

test('translation fallback honors a Marathi brief without a model key',async()=>{
  const result=await vendorWork('lingualink','Create a Marathi customer FAQ',{});
  assert(result.content.includes('मी ऑर्डर कशी देऊ'));
  assert.equal(result.source,'offline deterministic content');
});
