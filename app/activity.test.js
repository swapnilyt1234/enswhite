import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createActivity} from './activity.js';
import {campaignKitHTML} from './campaign-kit.js';

test('activity is durable, cursor-resumable and idempotent for a confirmed action',()=>{
 const db=new DatabaseSync(':memory:');let activity=createActivity(db),seen=[];const off=activity.subscribe(row=>seen.push(row));
 try{activity.record('marketing','settled','I paid the vendor.',{key:'payment-1',data:{hash:'public-hash'}});activity.record('marketing','settled','I paid the vendor.',{key:'payment-1'});assert.equal(seen.length,1);off();activity=createActivity(db);activity.record('support','refused','My employment is expired.');assert.deepEqual(activity.since(1).map(x=>x.kind),['refused']);assert.throws(()=>activity.since(-1),/cursor/)}finally{activity.close();db.close()}
});

test('downloaded Campaign Kit escapes text and embeds vendor SVG as an image rather than executable HTML',()=>{
 const html=campaignKitHTML({business:'<script>alert(1)</script>',title:'Campaign',mode:'simulated',banner:'<svg><script>alert(2)</script></svg>',copy:'<img src=x onerror=alert(3)>',faq:'FAQ',memo:'Memo',receipts:[]});
 assert(!html.includes('<script>'));assert(html.includes('data:image/svg+xml;base64,'));assert(html.includes('&lt;img'));assert(html.includes("default-src 'none'"));
});
