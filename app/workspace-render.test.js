import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {JSDOM,VirtualConsole} from 'jsdom';
import {createCompany} from './company.js';
import {VENDORS} from './company-store.js';

const pause=()=>new Promise(resolve=>setTimeout(resolve,10));
test('the complete workspace renders a confirmed INR 500 balance and unlocks valid actions without the removed Team counter',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'enswhite-full-ui-')),company=await createCompany({env:{CHAIN_MODE:'simulated',AGENT_MODE:'offline'},directory,vendorFetch:async url=>{const vendor=VENDORS.find(v=>String(v.port)===new URL(url).port);return Response.json({...vendor,chainMode:'simulated',address:'0x'+String(VENDORS.indexOf(vendor)+1).repeat(40)})}});
 const order=await company.order();await company.simulate(order.id);await company.processJobs();const state=await company.state();
 // The money remains usable while the separate ENS directory view is reconnecting.
 state.mode='testnet';state.explorer='https://explorer.testnet.whitechain.io';state.relayerWbt='19000000000000000';state.ens={...state.ens,enabled:true,companyName:'fixture.enswhite.eth',directoryStatus:'loading'};state.topup.canCheckout=false;
 const html=readFileSync(new URL('./company-public/index.html',import.meta.url),'utf8'),source=readFileSync(new URL('./company-public/company-ui.js',import.meta.url),'utf8'),errors=[];
 const virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',error=>errors.push(error.message));
 const dom=new JSDOM(html,{url:'https://demo.example/company/',runScripts:'outside-only',virtualConsole});
 t.after(async()=>{dom.window.close();await company.close();rmSync(directory,{recursive:true,force:true})});
 dom.window.EventSource=class{close(){}};
 dom.window.fetch=async url=>{const path=new URL(url,'https://demo.example').pathname;return Response.json(path.endsWith('/state')?state:path.endsWith('/payment-status')?company.paymentStatus():{questions:[],approvals:[],paused:[],recovering:[]})};
 dom.window.eval(source);
 for(let i=0;i<100&&!dom.window.document.querySelector('#cash').textContent.includes('500');i++)await pause();
 const doc=dom.window.document;
 assert.equal(doc.querySelector('[data-view=team] .nav-count'),null,'The navigation intentionally has no Team counter');
 assert.match(doc.querySelector('#cash').textContent,/500/);assert.equal(doc.querySelector('#team-cards').children.length,3);
 assert.equal(doc.querySelector('#propose-finance').disabled,false,'An existing cash credit can request a Finance proposal');
 assert.equal(doc.querySelector('.business-form button').disabled,false,'Profile editing must unlock after initial render');
 assert.equal(doc.querySelector('#topup').disabled,true,'Another checkout still requires additional pool backing');
 assert(!doc.querySelector('#status').textContent.includes('Loading your workspace'));assert(!doc.querySelector('#status').textContent.includes('Reconnecting'));assert.deepEqual(errors,[]);
 doc.querySelector('[data-view=fund]').dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true,cancelable:true}));assert.equal(doc.querySelector('#view-fund').hidden,false);
 assert.match(doc.querySelector('#payment-status').textContent,/500\.00 credited/);
});
