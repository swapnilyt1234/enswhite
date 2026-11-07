import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {setupProgress} from './launch-public/setup-progress.js';
const source=readFileSync(new URL('./company-public/company-ui.js',import.meta.url),'utf8');
const apiSource=source.slice(source.indexOf('async function api('),source.indexOf('function go('));
function client(fetch){const notices=[];const context=vm.createContext({fetch,TypeError,Error,routePrefix:'/company',status:message=>notices.push(message),setTimeout:fn=>fn(),$:()=>({hidden:true})});vm.runInContext(apiSource,context);return{api:context.api,notices}}
test('Finance approval reconnects using the identical request; checkout is never automatically repeated',async()=>{
 const requests=[];const {api,notices}=client(async(url,options)=>{requests.push({url,body:options.body});return{status:requests.length<3?503:200,ok:requests.length>=3,json:async()=>{if(requests.length<3)throw new SyntaxError('Gateway returned HTML');return{accepted:true}}}});
 assert.equal((await api('/allocate',{method:'POST',body:'{"proposalId":"saved"}'})).accepted,true);assert.equal(requests.length,3);assert(requests.every(x=>x.body===requests[0].body));assert.equal(notices.length,2);
 let count=0;const checkout=client(async()=>{count++;throw new TypeError('Network failed')});await assert.rejects(checkout.api('/orders',{method:'POST'}));assert.equal(count,1);
});
test('automatic UI recovery stops after its bound and never retries a policy refusal',async()=>{
 let count=0;const offline=client(async()=>{count++;throw new TypeError('Network failed')});await assert.rejects(offline.api('/allocate',{method:'POST'}));assert.equal(count,4);
 count=0;const policy=client(async()=>{count++;return{status:409,ok:false,json:async()=>({error:'Budget refused'})}});await assert.rejects(policy.api('/allocate',{method:'POST'}),/Budget refused/);assert.equal(count,1);
});

function sliceFunctions(start,end){return source.slice(source.indexOf(start),source.indexOf(end))}
function controlsFixture(){
 const buttons=Object.fromEntries(['topup','fund-topup','allocate','propose-finance','run-mission','employment','navigation'].map(id=>[id,{disabled:id==='employment',isConnected:true}]));
 const context=vm.createContext({state:{topup:{canCheckout:false},allocationProposal:null,companyBalance:'0',agentRuns:[],team:[]},busy:false,stateRevision:0,refreshPending:null,pendingFinance:null,pendingTopup:null,$:id=>buttons[id],document:{body:{setAttribute(){},removeAttribute(){}},querySelectorAll:()=>Object.values(buttons)},refreshAttention:async()=>{},refresh:()=>new Promise(()=>{}),refreshFailed(){},status(){},founderError:e=>e.message});
 vm.runInContext(sliceFunctions('function syncControls()',"$('propose-finance').addEventListener"),context);return{buttons,context};
}
test('action feedback returns without waiting for chain refresh and preserves unavailable controls',async()=>{
 const {buttons,context}=controlsFixture();await context.act(async()=>{});
 for(const id of ['topup','fund-topup','allocate','run-mission','employment'])assert.equal(buttons[id].disabled,true,id);
 assert.equal(buttons.navigation.disabled,false);assert.equal(context.busy,false);
 context.state.topup.canCheckout=true;context.state.companyBalance='5000000';context.state.allocationProposal={id:'saved'};context.state.team=[{balance:'300000'}];context.syncControls();
 assert.equal(buttons.allocate.disabled,false);assert.equal(buttons['propose-finance'].disabled,true);assert.equal(buttons['run-mission'].disabled,false);
});
test('profile polling never overwrites a founder edit, including a field that has lost focus',()=>{
 const input={value:'Unsaved company'};const context=vm.createContext({businessEdited:true,businessForm:{elements:{namedItem:()=>input}},document:{activeElement:null}});
 vm.runInContext(sliceFunctions('function refreshBusinessProfile(','async function refreshState()'),context);
 context.refreshBusinessProfile({name:'Old company'});assert.equal(input.value,'Unsaved company');context.businessEdited=false;context.refreshBusinessProfile({name:'Saved company'});assert.equal(input.value,'Saved company');
});
test('work timeline deduplicates repeated waiting updates and keeps technical traces opt-in',()=>{
 const nodes=Object.fromEntries(['desk-agents','desk-timeline'].map(id=>[id,{dataset:{},innerHTML:'',contains:()=>false,querySelectorAll:()=>[]}])),log={scrollHeight:100,scrollTop:0,clientHeight:100};
 const events=[{id:1,department:'support',kind:'agent_waiting',message:'Please confirm shipping.',time:1,data:{runId:'saved'}},{id:2,department:'support',kind:'agent_waiting',message:'Please confirm shipping.',time:2,data:{runId:'saved'}},{id:3,department:'support',kind:'tool_called',message:'Internal tool trace',time:3}];
 const context=vm.createContext({state:{team:[],tasks:[]},selectedAgent:'all',workEvents:new Map(events.map(e=>[e.id,e])),document:{body:{dataset:{onchain:'false'}},activeElement:null,querySelector:()=>log},$:id=>nodes[id],esc:String,money:String,empty:()=>''});
 vm.runInContext(sliceFunctions('function renderDesk()','function renderAttention('),context);context.renderDesk();assert.equal(nodes['desk-timeline'].innerHTML.split('Please confirm shipping.').length-1,1);assert(!nodes['desk-timeline'].innerHTML.includes('Internal tool trace'));
 context.document.body.dataset.onchain='true';context.renderDesk();assert(nodes['desk-timeline'].innerHTML.includes('Internal tool trace'));
});

test('launch polling coalesces reads and a stale response cannot replace a newly selected company',async()=>{
 const launch=readFileSync(new URL('./launch-public/launch.js',import.meta.url),'utf8'),button={disabled:false};
 const nodes=Object.fromEntries(['company-select','new-company','business','roles','company-switcher','progress','hire','launch-heading','launch-intro','company-name','operator','checklist','setup-error','open-company','status','setup-progress','progress-percent','progress-title','progress-summary'].map(id=>[id,{innerHTML:'',querySelector:selector=>selector==='button'?button:{checked:true}}]));
 let release,reads=0;const old=new Promise(r=>{release=r}),job=label=>({companyName:label,state:'ready',roles:['finance','marketing'],steps:[]});
 const context=vm.createContext({busy:false,currentJob:null,refreshPending:null,revision:0,setupProgress,$:id=>nodes[id],esc:String,document:{activeElement:null,querySelectorAll:()=>[]},api:async path=>{if(path==='new')return{};reads++;return reads===1?old:{job:job('New company'),operatorReady:true}},launchError:e=>e.message});
 vm.runInContext(launch.slice(launch.indexOf('function controls()'),launch.indexOf("$('business').onsubmit")),context);
 const first=context.refresh();assert.equal(context.refresh(),first);const change=context.act(()=>context.api('new'));release({job:job('Old company'),operatorReady:true});await change;
 assert.equal(reads,2);assert.equal(nodes['company-name'].textContent,'New company');assert.equal(nodes['company-select'].disabled,false);
});
test('founder scripts use valid UTF-8 and landing HTML is escaped in the page and downloaded as a file',()=>{
 new TextDecoder('utf-8',{fatal:true}).decode(readFileSync(new URL('./company-public/company-ui.js',import.meta.url)));
 const kit=readFileSync(new URL('./company-public/kit.js',import.meta.url),'utf8');assert(kit.includes('esc(kit.landing)'));assert(kit.includes('new Blob([kit.landing]'));assert(!kit.includes('.srcdoc='));assert(!source.includes('async function sendENS('));
});


test('an unfinished review survives a background update after its textarea loses focus',()=>{
 const makeForm=value=>{const input={name:'comment',value},elements=[input];elements.namedItem=()=>input;return{dataset:{reviewMission:'saved',reviewDepartment:'support'},elements}};
 let form=makeForm('My unfinished review');const panel={dataset:{},contains:()=>false,querySelectorAll:()=>[form],set innerHTML(value){form=makeForm('')}};
 const context=vm.createContext({$:()=>panel,document:{activeElement:null}});vm.runInContext(sliceFunctions('function renderPanel(','function renderAttention('),context);
 context.renderPanel('review-content','new-review-status','new markup');assert.equal(form.elements[0].value,'My unfinished review');
});


test('a successful checkout stays disabled until its exact saved credit confirms',()=>{
 const {buttons,context}=controlsFixture();context.state.topup.canCheckout=true;context.pendingTopup='order_saved';context.syncControls();assert.equal(buttons.topup.disabled,true);assert.equal(buttons['fund-topup'].disabled,true);
 context.state.jobs=[{id:'credit:another-order',state:'confirmed'}];context.syncControls();assert.equal(buttons.topup.disabled,true);
 const cleared=[];context.sessionStorage={removeItem:key=>cleared.push(key)};context.state.company='company';context.state.jobs.push({id:'credit:order_saved',state:'confirmed'});context.syncControls();assert.equal(buttons.topup.disabled,false);assert.equal(context.pendingTopup,null);assert.deepEqual(cleared,['enswhiteCheckout:company']);
});
