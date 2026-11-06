import test from 'node:test';
import assert from 'node:assert/strict';
import { modelText, vendorWork } from './agents.js';

test('configured AI mode requires local credentials rather than silently running offline',async()=>{
 await assert.rejects(modelText('instructions','brief','offline text',{AGENT_MODE:'llm'}),/Configure.*no offline substitute/);
});
test('offline customer help preserves exact founder policies and admits that translation was not performed',async()=>{
 const result=await vendorWork('lingualink','Translate into Marathi\nBusiness: Acme\nFounder-sourced FAQ:\nQ: Shipping?\nA: Ships in 4 business days.\nQ: Returns?\nA: Not supplied by the founder.',{AGENT_MODE:'offline'});
 assert(result.content.includes('Ships in 4 business days.'));assert(result.content.includes('Not supplied by the founder.'));assert(result.content.includes('translation has not been performed'));assert(!result.source.includes('OpenAI'));
});
test('SVG design uses the actual headline, product and validated brand colours without executable text',async()=>{
 const result=await vendorWork('pixelpress','Headline: A warm sandalwood welcome\nBusiness: Acme<script>\nProduct: Sandalwood candle\nBrand colours: #234f40,#e6d5b8',{});
 assert(result.content.includes('<title>A warm sandalwood welcome</title>'));assert(result.content.includes('Sandalwood candle'));assert(result.content.includes('#234f40'));assert(result.content.includes('#e6d5b8'));assert(!result.content.includes('<script>'));
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
