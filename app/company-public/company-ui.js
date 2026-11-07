const $ = id => document.getElementById(id);
const money = units => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(units || 0)/10000);
const esc = text => String(text ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
const icons = {"marketing": "<svg class=\"ui-icon\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"m4 15 11-9v12L4 13v2Zm0 0 3 6h4l-2-6M18 8l3-2m-3 10 3 2\"/></svg>", "support": "<svg class=\"ui-icon\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M4 13v-2a8 8 0 0 1 16 0v2M4 11H2v7h4v-7H4Zm16 0h2v7h-4v-7h2ZM19 18c0 3-4 3-7 3\"/></svg>", "finance": "<svg class=\"ui-icon\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><rect x=\"4\" y=\"3\" width=\"16\" height=\"18\" rx=\"2\"/><path d=\"M8 8h8M8 12h3M8 16h8\"/></svg>", "copydesk": "<svg class=\"ui-icon\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"m14 4 6 6M3 21l5-1L21 7l-6-6L2 14l1 7ZM2 14l6 6\"/></svg>", "pixelpress": "<svg class=\"ui-icon\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><rect x=\"3\" y=\"4\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"m3 16 5-5 5 5 3-3 5 5\"/><circle cx=\"16\" cy=\"9\" r=\"1\"/></svg>", "lingualink": "<svg class=\"ui-icon\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M3 5h12M9 2v3m-4 0c0 7 8 12 8 12M13 5c0 7-8 12-8 12m9 4 4-11 4 11m-6-4h5\"/></svg>"};
let state, busy = false, images = [], checkoutScript, refreshError=false, businessEdited=false,stateRevision=0,pendingFinance=null,pendingTopup=null;
const routePrefix=location.pathname.startsWith('/guest/')?'/guest':location.pathname.startsWith('/owner/')?'/owner':location.pathname.startsWith('/company/')?'/company':'';
let selectedAgent='all',activityStream;const workEvents=new Map();
const attentionPanel=document.createElement('section');attentionPanel.id='founder-questions';attentionPanel.setAttribute('aria-label','Needs your attention');$('pool-warning').after(attentionPanel);$('pool-warning').before($('status'));
const paymentPanel=document.createElement('section');paymentPanel.id='payment-status';paymentPanel.className='recent-panel';paymentPanel.hidden=true;paymentPanel.setAttribute('aria-label','Payment confirmation');paymentPanel.setAttribute('aria-live','polite');$('pool-warning').after(paymentPanel);
const deskLink=document.createElement('a');deskLink.href='#desk';deskLink.dataset.view='desk';deskLink.className='nav-link';deskLink.innerHTML='<span aria-hidden="true">◉</span>Agent Desk';document.querySelector('nav').append(deskLink);
const businessForm=document.createElement('form');businessForm.className='business-form recent-panel';businessForm.innerHTML='<h2>Your business</h2><p class="micro">Give your employees the context they need. This profile guides future missions; it does not change ENS ownership or payment permissions.</p><label>Business name<input name="name" maxlength="80" required></label><label>What do you sell?<textarea name="description" maxlength="600" required></textarea></label><label>Who is it for?<input name="audience" maxlength="180" required></label><label>Customer help language<select name="language"><option>Hindi</option><option>Marathi</option></select></label><button class="btn outline" type="submit">Save business profile →</button>';
$('view-team').append(businessForm);businessForm.querySelector('button').disabled=true;
for(const [field,label,max]of [['productName','Product name',100],['shippingPolicy','Shipping policy (leave empty if unknown)',600],['returnPolicy','Return policy (leave empty if unknown)',600],['contact','Customer contact details',180],['brandColours','Brand colours (hex values)',100],['productImage','Product image HTTPS URL (optional)',500]]){const labelNode=document.createElement('label');labelNode.textContent=label;const input=document.createElement(field.endsWith('Policy')?'textarea':'input');input.name=field;input.maxLength=max;labelNode.append(input);businessForm.insertBefore(labelNode,businessForm.querySelector('button'))}
const financePanel=document.querySelector('.finance-panel');financePanel.querySelector('h2').textContent='Budget for the work ahead.';financePanel.querySelector('p').textContent='Finance studies task costs and existing funds. Review its proposal before authorizing an allocation.';financePanel.querySelector('.allocation-bar')?.remove();financePanel.querySelector('.allocation-legend')?.remove();const proposalBox=document.createElement('div');proposalBox.id='finance-proposal';financePanel.insertBefore(proposalBox,$('allocate'));const propose=document.createElement('button');propose.id='propose-finance';propose.className='btn outline';propose.textContent='Ask Finance for a proposal →';financePanel.insertBefore(propose,proposalBox);
for(const [id,label,icon]of [['overview','Overview','◈'],['deliverables','Deliverables','▱']]){const section=document.createElement('section');section.id='view-'+id;section.className='view';section.hidden=true;section.innerHTML=`<div class="page-heading"><div><p class="eyebrow">YOUR BUSINESS, OPERATED BY EMPLOYEES.</p><h1>${label}.</h1></div></div><div id="${id}-content"></div>`;$('view-team').before(section);const link=document.createElement('a');link.href='#'+id;link.dataset.view=id;link.className='nav-link';link.innerHTML=`<span aria-hidden="true">${icon}</span>${label}`;if(id==='overview')document.querySelector('nav').prepend(link);else document.querySelector('nav').append(link)}
document.querySelector('[data-view=team]').after(deskLink);document.querySelector('[data-view=mission]').after(document.querySelector('[data-view=deliverables]'));
// One founder journey; existing views and API handlers remain in place.
const fundView=document.createElement('section');fundView.id='view-fund';fundView.className='view';fundView.hidden=true;fundView.innerHTML='<div class="page-heading"><div><p class="eyebrow">03 · FUND</p><h1>Rupees in. <em>Budgets ready.</em></h1><p>Use Razorpay test checkout. Finance proposes budgets; you approve before funds move.</p></div><button class="btn primary" id="fund-topup">Add ₹500 in test mode →</button></div>';$('view-team').after(fundView);fundView.append(document.querySelector('.finance-panel'));$('fund-topup').onclick=()=>$('topup').click();
const reviewView=document.createElement('section');reviewView.id='view-review';reviewView.className='view';reviewView.hidden=true;reviewView.innerHTML='<div class="page-heading"><div><p class="eyebrow">06 · REVIEW</p><h1>Good work earns <em>trust.</em></h1><p>Rate your employees after a completed mission. Your feedback becomes part of their verified work history.</p></div></div><div id="review-content"></div>';$('view-deliverables').after(reviewView);
$('view-overview').append(businessForm);businessForm.querySelector('h2').textContent='What’s your business?';
$('view-desk').querySelector('.page-heading').after(document.querySelector('#view-mission .mission-form'));
for(const [view,label,number]of [['overview','Launch','01'],['team','Hire','02'],['fund','Fund','03'],['desk','Work','04'],['deliverables','Deliver','05'],['review','Review','06']]){
 let link=document.querySelector(`[data-view="${view}"]`);if(!link){link=document.createElement('a');link.dataset.view=view;link.href='#'+view;link.className='nav-link'}link.innerHTML=`<span aria-hidden="true">${number}</span>${label}`;document.querySelector('nav').append(link);
}
document.querySelector('[data-view=mission]').remove();
for(const node of [...$('view-mission').children].slice(1))$('view-desk').append(node);
for(const view of ['approvals']){const link=document.querySelector(`[data-view="${view}"]`);if(link)document.querySelector('nav').append(link)}
businessForm.addEventListener('input',()=>{businessEdited=true});
businessForm.addEventListener('submit',event=>{event.preventDefault();act(async()=>{await api('/business',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(businessForm)))});status('Business profile saved. Your next mission will use this context.')})});
let missionKey = sessionStorage.getItem('relayMissionKey'), missionTitle = sessionStorage.getItem('relayMissionTitle');
const chainPreference = localStorage.getItem('relayShowOnchain') === 'true';
document.body.dataset.onchain = String(chainPreference); $('show-chain').checked = chainPreference;
function status(message, error = false) { refreshError=false; $('status').textContent = message; $('status').classList.toggle('error', error); }
function founderError(error){const message=String(error?.message||error||'');return /code=|ECONN|ETIMEDOUT|NETWORK_ERROR|TIMEOUT|keystore|signer configuration|file:\/\/|127\.0\.0\.1|node_modules/i.test(message)?'The service is temporarily unavailable. Your saved work and payments are retained.':message||'Something went wrong. Your saved work is retained.'}
function refreshFailed(error){if(!refreshError)status('Reconnecting to your workspace. Your saved work is retained.',true);refreshError=true}
async function api(path, options = {}) {
  const recoverable=options.method==='POST'&&(/^\/(finance\/proposal|allocate)$/.test(path)||/^\/(founder-questions|approvals)\//.test(path));
  for(let attempt=0;;attempt++){
    try{
      const response = await fetch(routePrefix+'/api' + path, { ...options, headers: { 'Content-Type':'application/json', ...options.headers } });
      if([502,503,504].includes(response.status))throw Object.assign(new Error('Connection temporarily unavailable. Your saved request is retained.'),{status:response.status});
      const body = await response.json();
      if (response.status === 401) { if(routePrefix==='/guest'){location.href='/';throw new Error('Guest session expired.')} $('login').hidden = false; throw new Error('Sign in with your founder password.'); }
      if (!response.ok) throw Object.assign(new Error(body.error || 'Request failed'),{status:response.status});
      return body;
    }catch(error){
      if(!recoverable||attempt>=3||!(error instanceof TypeError||[502,503,504].includes(error.status)))throw error;
      status('Reconnecting automatically. Your saved request is retained; no repeat click or checkout is needed.');
      await new Promise(resolve=>setTimeout(resolve,1000*2**attempt));
    }
  }
}
function go(view) {
  if(view==='mission')view='desk';
  if (!['overview','team','approvals','desk','deliverables','fund','review'].includes(view)) view='overview';
  document.querySelectorAll('.view').forEach(section=>{section.hidden=section.id!=='view-'+view});
  document.querySelectorAll('[data-view]').forEach(link=>link.classList.toggle('active',link.dataset.view===view));
  $('breadcrumb-view').textContent = ({overview:'Company',team:'Team',fund:'Fund',desk:'Work',deliverables:'Deliver',review:'Review',approvals:'Approvals'})[view];
  history.replaceState(null,'','#'+view);
}
document.addEventListener('click',event=>{
  const target=event.target.closest('[data-go],[data-view]');
  if(target){event.preventDefault();go(target.dataset.go||target.dataset.view);if(target.hasAttribute('data-mission-example')){$('mission').value='Launch our Diwali sale. Create campaign copy, a landing section and a Hindi FAQ.';$('mission').focus()}}
});
$('show-chain').addEventListener('change',()=>{document.body.dataset.onchain=String($('show-chain').checked);localStorage.setItem('relayShowOnchain',String($('show-chain').checked));renderDesk();});
function tag(value) { return `<span class="state ${['approval','queued','submitted','confirmed'].includes(value)?'pending':['failed','rejected'].includes(value)?'failed':''}">${esc(value==='approval'?'Needs your approval':value==='delivered'?'Delivered':value)}</span>`; }
function txLink(hash,label='View transaction ↗') { return state.explorer && hash ? `<a class="onchain-link" target="_blank" rel="noreferrer" href="${state.explorer}/tx/${esc(hash)}">${esc(label)}</a>` : ''; }
function empty(title,subtitle='') { return `<div class="empty">${esc(title)}<span>${esc(subtitle)}</span></div>`; }
function renderDesk(){
 if(!state)return;
 const seen=new Set();
 const log=document.querySelector('.desk-log'),follow=log.scrollHeight-log.scrollTop-log.clientHeight<100;
 renderPanel('desk-agents',JSON.stringify({team:state.team,selectedAgent}),`<button class="desk-agent ${selectedAgent==='all'?'selected':''}" data-agent-filter="all">All departments</button>`+state.team.map(dept=>{const expiry=dept.identity?Math.max(0,Number(dept.identity.expiry)-Date.now()/1000):null;return `<button class="desk-agent ${selectedAgent===dept.id?'selected':''}" data-agent-filter="${dept.id}"><span class="agent-icon ${dept.id}">${icons[dept.id]}</span><strong>${esc(dept.name)}</strong><small>${esc(dept.ensName||(state.mode==='simulated'?'Simulated identity':'No ENS identity'))}</small><small>${esc(runStatus(dept))} · ${money(dept.remaining)} left</small><small>${expiry===null?'':`Contract: ${Math.floor(expiry/86400)}d ${Math.floor(expiry%86400/3600)}h ${Math.floor(expiry%3600/60)}m left`}</small></button>`}).join(''));
 const events=[...workEvents.values()].filter(row=>selectedAgent==='all'||row.department===selectedAgent).filter(row=>chainVisible()||!['tool_called','tool_result','tool_refused','tool_retry','agent_retry'].includes(row.kind)).sort((a,b)=>a.id-b.id).filter(row=>{if(!['agent_thinking','agent_waiting','agent_reconnecting'].includes(row.kind))return true;const key=JSON.stringify([row.data?.runId,row.department,row.kind,row.message]);if(seen.has(key))return false;seen.add(key);return true}).slice(-150);
 renderPanel('desk-timeline',JSON.stringify({events,technical:chainVisible()}),events.length?events.map(row=>{const hash=row.data?.hash,base=row.data?.network==='sepolia'?'https://sepolia.etherscan.io':row.data?.network==='whitechain'?state.explorer:null;return `<article class="desk-entry ${row.kind==='refused'||row.kind==='declined'?'desk-refusal':''}"><div><strong>${esc(row.department==='company'?'EnsWhite':state.team.find(x=>x.id===row.department)?.name)}</strong><time>${new Date(row.time).toLocaleTimeString()}</time></div><p>${esc(row.kind==='agent_failed'?'This assignment needs attention. Your completed work and payments are saved.':row.message)}</p>${base&&/^0x[0-9a-f]{64}$/i.test(hash||'')?`<a target="_blank" rel="noreferrer" href="${base}/tx/${hash}">View transaction ↗</a>`:''}${row.data?.tool?`<details class="onchain"><summary>Technical details</summary><pre class="tool-json">${esc(JSON.stringify({arguments:row.data.arguments,result:row.data.result},null,2))}</pre></details>`:''}<small class="onchain">${esc(row.kind.replaceAll('_',' '))}</small></article>`}).join(''):empty('Your employees will explain their work here.','Start a mission to see progress and receipts.'));
 if(follow)log.scrollTop=log.scrollHeight;
}
function chainVisible(){return document.body.dataset.onchain==='true'}
function runStatus(dept){const run=dept.currentRun;if(!run)return'Idle';if(run.state==='waiting')return (state.founderQuestions||[]).some(q=>q.run_id===run.id&&!q.answer)?'Needs your answer':state.tasks.some(x=>x.dept===dept.id&&x.mission_id===run.mission_id&&x.state==='approval')?'Waiting for approval':'Waiting for work';return({queued:'Assigned',thinking:'Thinking',executing:'Executing',recovering:'Reconnecting automatically',completed:'Completed',failed:'Paused'})[run.state]||run.state}
function renderPanel(id,revision,html){
 const panel=$(id);if(panel.dataset.revision===revision||(panel.contains(document.activeElement)&&document.activeElement.matches('input,textarea,select')))return;
 const key=form=>form.dataset.question||`${form.dataset.reviewMission}:${form.dataset.reviewDepartment}`;
 const drafts=new Map([...panel.querySelectorAll('form')].map(form=>[key(form),[...form.elements].filter(input=>input.name).map(input=>[input.name,input.value])]));
 panel.innerHTML=html;panel.dataset.revision=revision;
 for(const form of panel.querySelectorAll('form'))for(const [name,value]of drafts.get(key(form))||[]){const input=form.elements.namedItem(name);if(input)input.value=value}
}
let lastPaymentStatus;
function renderPaymentStatus(data){
 lastPaymentStatus=data;
 if(!state&&data.businessName){document.querySelector('.workspace-switch strong').textContent=data.businessName;document.querySelector('.breadcrumb').firstChild.textContent=data.businessName+' ';}
 const payment=data.payments?.[0],confirmed=payment?.state==='confirmed',pending=payment&&['queued','submitted'].includes(payment.state);
 paymentPanel.hidden=!confirmed&&!pending;
 if(!confirmed&&!pending)return;
 const receipt=confirmed&&data.explorer&&/^0x[0-9a-f]{64}$/i.test(payment.hash||'')?`<a target="_blank" rel="noreferrer" href="${esc(data.explorer)}/tx/${payment.hash}">View payment receipt ↗</a>`:'';
 const text=confirmed?`${money(payment.units)} credited to your company.`:'Your verified test payment is awaiting settlement. You do not need to pay again.';
 const note=confirmed&&refreshError?'Payment confirmation is saved. Live account details are reconnecting.':'';
 renderPanel('payment-status',JSON.stringify({payment,note}),`<p><strong>${esc(text)}</strong></p>${note?`<p class="micro">${esc(note)}</p>`:''}${receipt}`);
 if(confirmed){
  const key='enswhiteCheckout:'+data.company;if(sessionStorage.getItem(key)===payment.orderId)sessionStorage.removeItem(key);
  if(!state||!(state.jobs||[]).some(job=>job.id==='credit:'+payment.orderId&&job.state==='confirmed'))$('cash').textContent='Updating…';
 }
}
function renderAttention(data){
 const questions=data.questions||[],approvals=data.approvals||[],recovering=data.recovering||[],paused=(data.paused||[]).filter(r=>r.purpose==='mission');
 const count=questions.length+approvals.length+paused.length+recovering.length;
 attentionPanel.hidden=!count;
 const questionHTML=questions.map(q=>`<form class="recent-panel attention-question" data-question="${esc(q.id)}"><p class="eyebrow">YOUR ANSWER IS NEEDED · ${esc(q.run_id.split(':')[1]||'EMPLOYEE')}</p><h2>Your employee needs a business fact</h2><p>${esc(q.question)}</p><label>Your answer<textarea name="answer" required maxlength="1500" placeholder="Share confirmed details. If a policy is undecided, say so."></textarea></label><button class="btn primary">Send answer and resume →</button></form>`).join('');
 const approvalHTML=approvals.length?`<article class="recent-panel attention-question"><p>${approvals.length} purchase${approvals.length===1?'':'s'} waiting for your approval.</p><button class="btn primary" data-go="approvals">Review purchases →</button></article>`:'';
 const pausedHTML=paused.map(r=>`<article class="recent-panel attention-question"><p class="eyebrow">EMPLOYEE PAUSED</p><h3>${esc(r.department)}</h3><p>This assignment is paused. Completed work and payments are saved.</p><p class="onchain">${esc(r.error)}</p>${r.calls<(r.version===2?6:8)&&r.attempts<12?`<button class="btn outline" data-retry-run="${esc(r.id)}">Retry saved run</button>`:''}<button class="text-link" data-go="desk">Open work channel →</button></article>`).join('');
 renderPanel('founder-questions',JSON.stringify(data),questionHTML+approvalHTML+pausedHTML+recovering.map(r=>`<article class="recent-panel" role="status"><p class="eyebrow">RECONNECTING AUTOMATICALLY · ${esc(r.department)}</p><p>Your saved assignment will resume after the connection recovers. No repeat checkout, proposal or mission is needed.</p></article>`).join(''));
 const work=document.querySelector('[data-view="desk"]');work.setAttribute('aria-label',count?`Work · ${count} need your attention`:'Work');
}
let paymentStatusPending;
function refreshPaymentStatus(){return paymentStatusPending??=api('/payment-status').then(renderPaymentStatus).finally(()=>{paymentStatusPending=null})}
let attentionPending;
function refreshAttention(){return attentionPending??=api('/attention').then(renderAttention).finally(()=>{attentionPending=null})}
function renderWorkforce(){
 const runs=state.agentRuns||[];document.querySelector('.form-bottom>span').textContent=`${state.vendors.length} vendor tasks · ${money(state.vendors.reduce((sum,v)=>sum+Number(v.price),0))} estimated · spending policies apply`;
 $('fund-topup').disabled=$('topup').disabled;
 const completed=runs.filter(x=>x.purpose==='mission'&&x.state==='completed');
 renderPanel('review-content',JSON.stringify({completed:completed.map(x=>x.id),reviews:state.reviews}),completed.map(r=>{const review=(state.reviews||[]).find(x=>x.kind==='employee'&&x.mission===r.mission_id&&x.target===r.department);return review?'':`<form class="recent-panel" data-review-mission="${esc(r.mission_id)}" data-review-department="${esc(r.department)}"><h3>${esc(r.department)} · ${esc(state.missions.find(m=>m.id===r.mission_id)?.title)}</h3><label>Rating<select name="score"><option value="5">5 · Excellent</option><option value="4">4 · Good</option><option value="3">3 · Fair</option><option value="2">2 · Needs work</option><option value="1">1 · Poor</option></select></label><label>What worked, or needs improvement?<textarea name="comment" required maxlength="1000"></textarea></label><button class="btn primary">Submit review →</button></form>`}).join('')+(state.reviews||[]).filter(r=>r.kind==='employee').map(r=>`<article class="recent-panel"><h3>${esc(r.target)} · ${r.score}/5</h3><p>${esc(r.comment)}</p><p>${esc(r.state||(state.mode==='simulated'?'simulated':'Waiting for identity setup'))}</p>${r.hash?`<a target="_blank" rel="noreferrer" href="https://sepolia.etherscan.io/tx/${esc(r.hash)}">ERC-8004 review transaction ↗</a>`:''}</article>`).join('')||empty('Reviews follow completed work.','Complete a mission to rate the employees who delivered it.'));
document.querySelector('.live-label').textContent=runs.some(x=>x.state==='failed')?'Employee run needs attention':'Workspace connected';const kits=state.missions.filter(x=>x.kit_ready);
 $('overview-content').innerHTML=`<article class="recent-panel"><p class="eyebrow">01 · LAUNCH</p><h2>${esc(state.business.name)}</h2><p>${state.ens?.companyName?`Registered company: <strong>${esc(state.ens.companyName)}</strong>`:'Isolated guest simulation · no name minted'}</p><p>${esc(state.business.description)}</p><p>${runs.filter(x=>['queued','thinking','executing','waiting','recovering'].includes(x.state)).length} active employee assignments · ${kits.length} completed Campaign Kits · ${money(state.companyBalance)} company cash</p><a class="btn outline" href="/launch/">Switch or create a company →</a><button class="btn outline" data-go="team">Hire & manage employees →</button><button class="btn primary" data-go="mission">Assign a business mission →</button></article><div class="team-grid">${state.team.map(d=>`<article class="team-card"><h3>${esc(d.name)}</h3><p>${esc(runStatus(d))}</p><p>${esc(d.capabilities.map(x=>x.replaceAll('_',' ')).join(' · '))}</p></article>`).join('')}</div>`;
 $('deliverables-content').innerHTML=kits.length?kits.map(m=>`<article class="recent-panel"><h2>${esc(m.title)}</h2><p>Campaign copy, design and customer help, with payment receipts.</p><a class="btn outline" href="${routePrefix}/kit/${encodeURIComponent(m.id)}">Open Campaign Kit ↗</a></article>`).join(''):empty('Completed business work will appear here.','A Kit requires verified deliveries and completed employee submissions.');
 const panel=document.createElement('div');panel.className='run-list';panel.innerHTML=`<h2>Employee assignments</h2>${runs.slice(0,12).map(r=>`<article class="desk-entry"><strong>${esc(r.department)} · ${esc(runStatus({id:r.department,currentRun:r}))}<span class="onchain"> · ${r.calls}/${r.version===2?6:8} tools</span></strong><p>${esc(state.missions.find(x=>x.id===r.mission_id)?.title||'Finance allocation proposal')}</p>${r.error?`<p class="error">This assignment needs attention. Your completed work is saved.</p><p class="onchain">${esc(r.error)}</p>${r.calls<(r.version===2?6:8)&&r.attempts<12?`<button class="btn outline" data-retry-run="${esc(r.id)}">Retry saved run</button>`:''}`:''}<button class="text-link onchain" data-inspect-run="${esc(r.id)}">Inspect tool history ↗</button></article>`).join('')}`;document.querySelector('#view-desk .run-list')?.remove();$('view-desk').append(panel);
 const proposal=state.allocationProposal;renderPanel('finance-proposal',JSON.stringify({proposal,balance:state.companyBalance,runs:runs.filter(x=>x.purpose==='allocation').map(x=>[x.id,x.state])}),proposal?`${Object.entries(JSON.parse(proposal.allocations)).filter(([d])=>state.team.some(t=>t.id===d)).map(([d,v])=>`<p>${esc(d)}: <strong>${money(v)}</strong></p>`).join('')}<details><summary>Finance’s explanation</summary><p>${esc(proposal.rationale)}</p></details><p class="micro">Funds move only after your approval.</p>`:`<p class="micro">${BigInt(state.companyBalance)===0n?'Add funds to request your first budget.':runs.some(r=>r.purpose==='allocation'&&['queued','thinking','executing','recovering'].includes(r.state))?'Finance is preparing your proposal. Follow its progress in Work.':'Ask Finance to propose a budget for the work ahead.'}</p>`);$('allocate').textContent='Approve this proposal →';$('allocate').disabled=busy||!proposal;$('propose-finance').disabled=busy||runs.some(x=>x.purpose==='allocation'&&['queued','thinking','executing','recovering'].includes(x.state));
 const details=document.createElement('details');details.className='recent-panel onchain';const handoffs=(state.agentMessages||[]).filter(x=>['design_handoff','budget_request','budget_policy_decision'].includes(x.kind));details.innerHTML='<summary>Structured employee handoffs</summary>'+handoffs.map(m=>`<article><strong>${esc(m.sender)} → ${esc(m.recipient)}</strong><pre class="tool-json">${esc(JSON.stringify(m.content,null,2))}</pre></article>`).join('');document.querySelector('#view-desk .handoff-list')?.remove();details.classList.add('handoff-list');$('view-desk').append(details);
}
document.addEventListener('click',event=>{const retry=event.target.closest('[data-retry-run]'),inspect=event.target.closest('[data-inspect-run]');if(retry)act(async()=>{await api('/agent-runs/'+encodeURIComponent(retry.dataset.retryRun)+'/retry',{method:'POST'});status('Saved run queued; existing payments are reused.')});if(inspect)act(async()=>{const history=await api('/agent-runs/'+encodeURIComponent(inspect.dataset.inspectRun));let box=$('run-history');if(!box){box=document.createElement('details');box.id='run-history';box.className='recent-panel';$('view-desk').append(box)}box.innerHTML='<summary>Recorded tool actions</summary><pre class="tool-json">'+esc(JSON.stringify(history,null,2))+'</pre>';box.open=true})});
function connectActivity(){
 if(activityStream)return;
 const after=Math.max(0,...workEvents.keys());activityStream=new EventSource(routePrefix+'/api/activity/stream?after='+after);
 activityStream.onopen=()=>{$('desk-connection').textContent='Live work log'};
 activityStream.onerror=()=>{$('desk-connection').textContent='Reconnecting to work log'};
 activityStream.onmessage=event=>{try{const row=JSON.parse(event.data);if(!Number.isSafeInteger(row.id))return;workEvents.set(row.id,row);if(workEvents.size>1000)workEvents.delete(Math.min(...workEvents.keys()));renderDesk()}catch{}};
}
document.addEventListener('click',event=>{const button=event.target.closest('[data-agent-filter]');if(button){selectedAgent=button.dataset.agentFilter;renderDesk()}});
window.addEventListener('pagehide',()=>activityStream?.close());
function renderTeam() {
  const revision=JSON.stringify({team:state.team,employment:state.employment,ens:state.ens?.enabled});if($('team-cards').dataset.revision===revision)return;$('team-cards').dataset.revision=revision;
  $('team-cards').innerHTML=state.team.map(dept=>{
    const percent=Number(dept.weekly)>0?Math.min(100,Math.max(0,Number(dept.spent)/Number(dept.weekly)*100)):0;
    const last=dept.lastPurchase, vendor=last&&state.vendors.find(v=>v.address.toLowerCase()===last.vendor.toLowerCase());
    return `<article class="team-card"><div class="agent-heading"><span class="agent-icon ${dept.id}" aria-hidden="true">${icons[dept.id]}</span><span class="agent-tag">${dept.id==='finance'?'KEEPING THE BOOKS':'READY TO WORK'}</span></div><h3>${dept.name}</h3><p class="description">${esc(dept.title)}</p><p class="micro">${esc(runStatus(dept))}</p><span class="card-balance-label">AVAILABLE BUDGET</span><div class="card-balance"><strong>${money(Math.max(0,Number(dept.remaining)))}</strong><span>/ ${money(dept.weekly)} weekly</span></div><div class="budget-track"><span style="width:${percent}%"></span></div><div class="budget-caption"><span>${money(dept.spent)} spent</span><span>${percent.toFixed(0)}% of weekly cap</span></div><div class="card-policy"><span>Per call <strong>${money(dept.perCall)}</strong></span><span>Ask above <strong>${money(dept.approval)}</strong></span></div><p class="last-purchase">LAST PURCHASE<b>${last?esc(vendor?.name||'Vendor')+' · '+money(last.amount):dept.id==='finance'?'Signed allocation proposals. Watching the ledger.':'The first receipt is waiting to happen.'}</b></p><code class="onchain">${dept.address}<br>${dept.wbtBalance===null?(state.mode==='simulated'?'Simulated WBT':'Gas balance unavailable'):(Number(dept.wbtBalance)/1e18).toFixed(6)+' WBT'} · USDT ${Number(dept.balance)/1e6}</code></article>`;
  }).join('');
  if(state.ens?.enabled){
    $('team-cards').querySelectorAll('.team-card').forEach((card,index)=>{
      const dept=state.team[index],identity=dept.identity;
      const remaining=identity?Math.max(0,Math.floor(Number(identity.expiry)-Date.now()/1000)):0;
      const panel=document.createElement('div');panel.className='ens-identity';
      const identityUnavailable=state.ens.directoryStatus&&state.ens.directoryStatus!=='ready';
      const job=state.employment?.jobs?.find(x=>x.label===dept.id),pending=job&&['queued','submitted'].includes(job.state),disabled=!state.employment?.ready||pending||identityUnavailable?'disabled':'';
      panel.innerHTML=`<p class="micro">${pending?'Updating employment…':identityUnavailable?(state.ens.directoryStatus==='unavailable'?'Identity service reconnecting. This does not affect your credited funds.':'Checking employee identity. Your balance remains available.'):identity?'Employment ends in '+Math.floor(remaining/86400)+'d '+Math.floor(remaining%86400/3600)+'h '+Math.floor(remaining%3600/60)+'m':'Not currently employed. New work is blocked.'}</p><p class="micro">${state.employment?.ready?'The business covers service costs. No wallet is needed.':'Employee changes are temporarily unavailable. Your existing team can continue working.'}</p><div class="task-actions">${identity?`<button ${disabled} class="btn outline" data-ens-action="renew" data-label="${dept.id}">Renew 30 days</button><button ${disabled} class="btn reject" data-ens-action="fire" data-label="${dept.id}">Fire</button>`:`<button ${disabled} class="btn primary" data-ens-action="hire" data-label="${dept.id}">Hire for 30 days</button>`}</div>${job?.error?'<p class="micro">Employee update paused. The operator can resume the saved request.</p>':''}<a class="text-link onchain" target="_blank" rel="noreferrer" href="https://sepolia.app.ens.domains/${encodeURIComponent(dept.ensName)}">${esc(dept.ensName)} ↗</a><p class="micro onchain">ENS status: ${esc(identity?.status||'Awaiting first update')}${state.ens.checkedAt?' · Identity last checked '+esc(new Date(state.ens.checkedAt).toLocaleTimeString()):''}</p>`;
      if(identity){const id=document.createElement('details');id.className='employee-id onchain';id.innerHTML=`<summary>Employee ID · non-transferable badge</summary><p><code>Owner: ${esc(identity.wallet)}<br>Token: ${esc(identity.tokenId)}</code></p><p><a href="https://sepolia.etherscan.io/address/${esc(identity.resolver)}" target="_blank" rel="noreferrer">Inspect resolver ↗</a></p><p class="micro">Live scoped roles: ${identity.roles?.status?'employee status ✓':'status unavailable'} · ${identity.roles?.financeBudget?'Finance weekly budget ✓':'Finance scope unavailable'}</p>${identity.hire?`<ol class="hire-steps"><li>${identity.hire.resolverDeployed?'✓':'?'} Resolver deployed</li><li>${identity.hire.badgeMinted?'✓':'?'} Employee badge registered</li><li>${identity.hire.financeRoleGranted?'✓':'?'} Finance role granted</li></ol><a target="_blank" rel="noreferrer" href="https://sepolia.etherscan.io/tx/${esc(identity.hire.hash)}">Hire transaction ↗</a>`:''}<p class="micro">ERC-8004 / ENSIP-25: ${esc(identity.discovery?.binding?.verified?'Verified identity binding':identity.discovery?.binding?.reason||'Not configured')}</p>`;panel.append(id)}
      card.append(panel);
    });
  }
}
function renderActivity() {
  const recent=state.ledger.slice(-4).reverse();
  $('recent-activity').innerHTML=recent.length?recent.map(row=>{
    const dept=state.team.find(d=>d.address.toLowerCase()===row.dept.toLowerCase()),vendor=state.vendors.find(v=>v.address.toLowerCase()===row.vendor.toLowerCase());
    return `<div class="activity-row"><div>${esc(dept?.name||'Department')} paid ${esc(vendor?.name||'Vendor')}<small>${state.mode==='simulated'?'Local simulation':'Confirmed on Whitechain Sepolia'} · Vendor receipt verified</small></div><div class="right">${money(row.amount)}<small>${txLink(row.hash)}${state.mode==='simulated'?'Simulated payment':''}</small></div></div>`;
  }).join(''):empty('A quiet ledger is a fresh start.','Give your team its first mission to see the work happen.');
}
function taskCard(task,approval=false) {
  const dept=state.team.find(d=>d.id===task.dept),vendor=state.vendors.find(v=>v.id===task.vendor),job=state.jobs.find(j=>j.id===task.id);
  let delivery='';
  if(task.result){
    if(task.result.type==='html'){delivery=`<div class="task-result"><p>Landing section delivered. Find the finished page in your Campaign Kit.</p><details class="onchain"><summary>HTML source</summary><pre class="tool-json">${esc(task.result.content)}</pre></details></div>`;}else if(task.result.type==='svg'){
      const url=URL.createObjectURL(new Blob([task.result.content],{type:'image/svg+xml'})); images.push(url);
      delivery=`<div class="task-result"><img src="${url}" alt="Campaign banner delivered by PixelPress"></div>`;
    } else delivery=`<div class="task-result">${esc(task.result.content)}</div>`;
  }
  return `<article class="task-card"><div class="task-top"><span class="agent-icon ${dept?.id||''}">${icons[vendor?.id]||icons.finance}</span><div><h3>${esc(vendor?.service)} <span>· ${money(task.amount)}</span></h3><p>${esc(dept?.name)} → ${esc(vendor?.name)} · Independent vendor</p></div>${tag(task.state)}</div><details class="task-brief"><summary>Vendor brief</summary><p>${esc(task.task)}</p></details>${delivery}<div class="task-footer"><span>${task.error?'This delivery is paused. Your payment and order are saved.':task.result?'Delivery received after payment verification.':approval?'Above '+money(dept.approval)+' approval threshold. No payment has been signed.':'Funds reserved. The vendor delivers after payment confirmation.'}</span>${approval?`<div class="task-actions"><button class="btn reject" data-decision="false" data-task="${task.id}">Decline</button><button class="btn primary" data-decision="true" data-task="${task.id}">Approve ${money(task.amount)} →</button></div>`:txLink(job?.hash)}</div></article>`;
}
function renderTasks() {
  const revision=JSON.stringify({tasks:state.tasks,approvals:state.approvals,jobs:state.jobs.map(j=>({id:j.id,state:j.state,hash:j.hash})),mode:state.mode});if($('task-list').dataset.revision===revision)return;$('task-list').dataset.revision=revision;
  for(const image of images) URL.revokeObjectURL(image); images=[];
  $('task-list').innerHTML=state.tasks.length?state.tasks.map(task=>taskCard(task)).join(''):empty('Your team is ready when you are.','Start a mission after approving your department allocations.');
  const pending=state.tasks.filter(task=>task.state==='approval');
  $('approval-list').innerHTML=pending.length?pending.map(task=>taskCard(task,true)).join(''):empty('Nothing waiting on you.','Above-threshold purchases will appear here before your agent signs.');
  $('approval-count').textContent=pending.length;
  $('decision-list').innerHTML=state.approvals.length?state.approvals.map(row=>{
    const task=state.tasks.find(t=>t.id===row.task_id), vendor=state.vendors.find(v=>v.id===task?.vendor);
    return `<div class="activity-row"><span>${row.approved?'Approved':'Declined'} ${esc(vendor?.name)} · ${money(task?.amount)}<small>Founder decision · ${new Date(row.created_at*1000).toLocaleString()}</small></span>${tag(row.approved?'approved':'rejected')}</div>`;
  }).join(''):empty('Your decisions will leave a trail.');
  $('mission-history').innerHTML=state.missions.slice(0,3).map(row=>`<div class="history-item"><strong>${esc(row.title)}</strong><br>${row.kit_ready?`<a class="text-link" href="${routePrefix}/kit/${encodeURIComponent(row.id)}">Open your Campaign Kit ↗</a>`:'Marketing is assembling the commissioned work.'}</div>`).join('');
}
function renderBooks() {
  const total=state.ledger.reduce((sum,row)=>sum+BigInt(row.amount),0n),fees=state.ledger.reduce((sum,row)=>sum+BigInt(row.fee),0n);
  $('books-total').textContent=money(total);$('books-fees').textContent=money(fees);$('books-flags').textContent=state.finance.flags.length;
  $('ledger-body').innerHTML=state.ledger.length?state.ledger.slice().reverse().map(row=>{
    const dept=state.team.find(d=>d.address.toLowerCase()===row.dept.toLowerCase()),vendor=state.vendors.find(v=>v.address.toLowerCase()===row.vendor.toLowerCase());
    return `<tr><td>${esc(dept?.name)} → ${esc(vendor?.name)}<small>${esc(vendor?.service)}</small></td><td>${money(row.amount)}</td><td>${money(row.fee)}</td><td>${money(BigInt(row.amount)-BigInt(row.fee))}</td><td><span class="state">${state.mode==='simulated'?'Simulated':'Confirmed'}</span>${txLink(row.hash)}<code class="onchain">${esc(row.requestId.slice(0,12))}…</code></td></tr>`;
  }).join(''):'<tr><td colspan="5">No confirmed vendor payments yet.</td></tr>';
  $('finance-flags').innerHTML=state.finance.flags.length?`<div class="section-header"><h2>Finance review</h2></div>`+state.finance.flags.map(flag=>`<div class="history-item">${esc(flag.message)}<br><code>${esc(flag.requestId.slice(0,20))}…</code></div>`).join(''):'';
}
function renderVendors() {
  $('vendor-cards').innerHTML=state.vendors.map(vendor=>`<article class="team-card"><div class="agent-heading"><span class="agent-icon">${icons[vendor.id]}</span><span class="tiny-tag">INDEPENDENT VENDOR</span></div><h3>${vendor.name}</h3><div class="vendor-service">${vendor.service}</div><p class="description">Paid per task. Delivery after independently verified payment.</p><div class="vendor-price">${money(vendor.price)}<small>per task · 1% platform fee included</small></div><a class="text-link vendor-link" target="_blank" rel="noreferrer" href="${routePrefix}/vendors/${vendor.id}">Open vendor earnings ↗</a><code class="onchain">${vendor.address}<br>Node process · port ${vendor.port}</code></article>`).join('');
}
let refreshPending;
function refresh(){return refreshPending??=refreshState().finally(()=>{refreshPending=null})}
function refreshBusinessProfile(profile){for(const [key,value]of Object.entries(profile||{})){const input=businessForm.elements.namedItem(key);if(input&&!businessEdited&&document.activeElement!==input)input.value=value}}
async function refreshState() {
  const version=stateRevision,updated=await api('/state');if(version!==stateRevision)return;const firstLoad=!state;state=updated;pendingTopup=sessionStorage.getItem('enswhiteCheckout:'+state.company);if(pendingFinance&&(state.agentRuns||[]).some(r=>r.id===pendingFinance))pendingFinance=null;$('login').hidden=true;if(firstLoad)status('');
  refreshBusinessProfile(state.business);
  (state.activity||[]).forEach(row=>workEvents.set(row.id,row));renderDesk();connectActivity();
  if(refreshError)status('Connected. Showing confirmed company state.');
  $('ens-controls').hidden=!state.ens?.enabled;
  const branding=state.ens?.branding;
  $('ens-company-brand').textContent=branding?`${branding.name} · ${state.ens.companyName}`:(state.ens?.companyName||'');
  if(branding?.url){const link=document.createElement('a');link.href=branding.url;link.target='_blank';link.rel='noreferrer';link.textContent=' · Company profile ↗';$('ens-company-brand').append(link)}
  if(state.business||branding){
    document.querySelector('.workspace-switch strong').textContent=state.business?.name||branding.name;
    document.querySelector('.breadcrumb').firstChild.textContent=(state.business?.name||branding.name)+' ';
    document.querySelector('.founder-profile div span').textContent='Owner · '+(state.business?.name||branding.name);
    const avatar=document.querySelector('.company-avatar');
    if(branding?.avatar){avatar.replaceChildren(Object.assign(document.createElement('img'),{src:branding.avatar,alt:branding.name+' company avatar'}))}else{avatar.textContent=(state.business?.name||branding.name).slice(0,1)}
  }
  $('ens-writes').innerHTML=(state.ens?.writes||[]).slice(0,6).map(row=>`<p class="micro">${esc(row.label)} · ${esc(row.key)} → ${esc(row.value)} · ${esc(row.state)} ${row.hash?`<a target="_blank" rel="noreferrer" href="https://sepolia.etherscan.io/tx/${esc(row.hash)}">View ENS edit ↗</a>`:''}${row.error?'<br>'+esc(row.error):''}</p>`).join('');
  document.querySelector('#view-team .section-header h2 span').textContent=String(state.team.length).padStart(2,'0');
  $('cash').textContent=money(state.companyBalance);
  $('team-balance').textContent=money(state.team.reduce((sum,d)=>sum+BigInt(d.balance),0n));
  $('vendor-spend').textContent=money(state.ledger.reduce((sum,row)=>sum+BigInt(row.amount),0n));
  $('receipt-count').textContent=state.ledger.length+' verifiable receipts';
  $('environment').textContent=(state.mode==='simulated'?'Practice workspace':'Test workspace');
  $('disclosure').textContent=state.mode==='simulated'?'Fiat and transfers are simulated locally. No real money or onchain transaction occurs.':'Razorpay test mode. Fiat is simulated; vendor payments settle in test USDT on Whitechain.';
  const backing=state.topup,canCheckout=backing.canCheckout!==false;
  $('topup').disabled=busy||!canCheckout;$('topup').textContent=canCheckout?'+ Add ₹500':'Top-ups unavailable';
  const warning=$('pool-warning');warning.hidden=canCheckout&&!backing.pendingCount&&!pendingTopup;
  if(pendingTopup&&!backing.pendingCount){warning.textContent='Your test payment is processing. The balance will update automatically; you do not need to pay again.'}
  else if(backing.pendingCount){warning.textContent=`${backing.pendingCount} test payment${backing.pendingCount===1?' is':'s are'} being added to your company balance. You do not need to pay again.`}
  else if(!canCheckout){warning.textContent='Top-ups are temporarily unavailable while the service adds funding. Existing company and team budgets are still available.'}
  $('allocate').disabled=busy||BigInt(state.companyBalance)===0n;
  $('run-mission').disabled=busy||!state.team.some(d=>BigInt(d.balance)>0n&&(!state.ens?.enabled||d.identity));
  renderTeam();renderActivity();renderTasks();renderWorkforce();
  businessForm.querySelector('button').disabled=busy;syncControls();if(lastPaymentStatus)renderPaymentStatus(lastPaymentStatus);
  // Books and Marketplace UI are deferred; their renderers and backend remain available.
  $('chain-details').textContent=`${state.scheme} · x402 v2 custom scheme · receiveWithAuthorization · ${state.network} · 1% fee`;
  $('company-address').textContent=state.company;$('relayer-address').textContent=state.relayer;
  $('gas-tank').textContent=state.mode==='simulated'?'Simulated':state.relayerWbt==null?'Unavailable':(Number(state.relayerWbt)/1e18).toFixed(4)+' WBT';
  $('job-errors').classList.add('onchain');$('job-errors').innerHTML=state.jobs.filter(row=>row.error).map(row=>`<div class="job-error">${esc(row.kind)}: ${esc(row.error)}</div>`).join('');
}
function syncControls(){
 if(!state)return;
 const confirmed=pendingTopup&&(state.jobs||[]).some(job=>job.id==='credit:'+pendingTopup&&job.state==='confirmed');
 if(confirmed){sessionStorage.removeItem('enswhiteCheckout:'+state.company);pendingTopup=null;status('₹500 added to your company balance.')}
 const processing=!!pendingTopup||state.topup.pendingCount>0,canCheckout=state.topup.canCheckout!==false&&!processing;
 $('topup').textContent=processing?'Adding ₹500…':canCheckout?'+ Add ₹500':'Top-ups unavailable';$('fund-topup').textContent=processing?'Payment processing…':'Add ₹500 in test mode →';
 $('topup').disabled=busy||!canCheckout;$('fund-topup').disabled=$('topup').disabled;
 $('allocate').disabled=busy||!state.allocationProposal||BigInt(state.companyBalance)===0n;
 $('propose-finance').disabled=busy||!!pendingFinance||BigInt(state.companyBalance)===0n||!!state.allocationProposal||(state.agentRuns||[]).some(r=>r.purpose==='allocation'&&['queued','thinking','executing','recovering'].includes(r.state));
 $('run-mission').disabled=busy||!state.team.some(d=>BigInt(d.balance)>0n&&(!state.ens?.enabled||d.identity));
}
async function act(action) {
 if(busy)return;
 busy=true;stateRevision++;document.body.setAttribute('aria-busy','true');
 const buttons=new Map([...document.querySelectorAll('button')].map(button=>[button,button.disabled]));
 for(const button of buttons.keys())button.disabled=true;
 try{await action()}catch(error){status(founderError(error),true)}
 finally{
  busy=false;document.body.removeAttribute('aria-busy');
  for(const [button,disabled]of buttons)if(button.isConnected)button.disabled=disabled;
  syncControls();void refreshPaymentStatus().catch(()=>{});void refreshAttention().catch(()=>{});void Promise.resolve(refreshPending).catch(()=>{}).then(refresh).catch(refreshFailed);
 }
}
$('propose-finance').addEventListener('click',()=>act(async()=>{const result=await api('/finance/proposal',{method:'POST'});pendingFinance=result.id+':finance:allocation';status('Finance is preparing your budget proposal. Follow its progress in Work.')}));
$('allocate').addEventListener('click',()=>act(async()=>{if(!state.allocationProposal)throw new Error('Ask Finance for a proposal first.');await api('/allocate',{method:'POST',body:JSON.stringify({proposalId:state.allocationProposal.id})});state.allocationProposal=null;status('Budget approved. Finance is allocating it to your team.')}));
$('mission-form').addEventListener('submit',event=>{event.preventDefault();act(async()=>{
  const title=$('mission').value.trim();
  if(!missionKey||title!==missionTitle){missionKey=crypto.randomUUID();missionTitle=title;sessionStorage.setItem('relayMissionKey',missionKey);sessionStorage.setItem('relayMissionTitle',title)}
  status('Your departments are preparing their vendor briefs…');
  await api('/missions',{method:'POST',headers:{'idempotency-key':missionKey},body:JSON.stringify({title})});
  missionKey=null;sessionStorage.removeItem('relayMissionKey');status('Mission started. Check Approvals for purchases that need your decision.');
})});
document.addEventListener('click',event=>{const decision=event.target.closest('[data-decision]');if(decision)act(async()=>{await api('/approvals/'+decision.dataset.task,{method:'POST',body:JSON.stringify({approved:decision.dataset.decision==='true'})});status(decision.dataset.decision==='true'?'Approved. Your agent can authorize the vendor payment.':'Declined. The reserved budget has been released.');})});
document.addEventListener('click',event=>{
 const button=event.target.closest('[data-ens-action]');if(!button)return;
 act(async()=>{
  const action=button.dataset.ensAction,label=button.dataset.label;
  if(!confirm(`${action==='fire'?'Remove':action==='hire'?'Hire':'Renew'} ${state.team.find(x=>x.id===label)?.name}? ${action==='fire'?'New work will be paused.':'The employment term is 30 days.'} Your business covers the service cost.`))return;
  await api('/ens/manage',{method:'POST',headers:{'idempotency-key':crypto.randomUUID()},body:JSON.stringify({action,label,term:2592000})});
  status('Employee update queued. Your business is handling it; no wallet or payment from you is needed.');
 });
});
$('ens-budget-form').addEventListener('submit',event=>{event.preventDefault();act(async()=>{
 const value=$('ens-budget').value;
 if(!/^\d+(\.\d{1,6})?$/.test(value))throw new Error('Enter test USDT with at most six decimal places.');
 const [whole,fraction='']=value.split('.'),amount=(BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'))).toString();
 const label=$('ens-department').value;
 if(!confirm(`Ask Finance to set ${label}'s ENS weekly limit to ${value} test USDT? Finance pays Sepolia gas.`))return;
 await api('/ens/budget',{method:'POST',headers:{'idempotency-key':crypto.randomUUID()},body:JSON.stringify({label,amount})});
 status('Finance budget edit queued. Its confirmed ENS transaction appears in the company directory.');
})});
function checkout(){return checkoutScript??=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://checkout.razorpay.com/v1/checkout.js';script.onload=resolve;script.onerror=()=>{checkoutScript=null;script.remove();reject(new Error('Could not load Razorpay'))};document.head.append(script)})}
$('topup').addEventListener('click',()=>act(async()=>{
  const order=await api('/orders',{method:'POST'});
  if(order.mode==='simulated'){await api('/simulate',{method:'POST',body:JSON.stringify({orderId:order.id})});status('Simulated top-up credited. Finance can now allocate ₹500.');return}
  await checkout();await new Promise(resolve=>{const widget=new window.Razorpay({key:order.keyId,order_id:order.id,amount:order.amount,currency:order.currency,name:'EnsWhite · Test mode',description:'₹500 sandbox top-up → company budget',handler(){pendingTopup=order.id;sessionStorage.setItem('enswhiteCheckout:'+state.company,order.id);status('Test payment received. Your company balance will update automatically.');resolve()},modal:{ondismiss:resolve},theme:{color:'#195740'}});widget.on('payment.failed',()=>{status('Test payment failed. Retry in checkout or close it; no credit has been issued.',true)});widget.open()});
}));
$('login-form').addEventListener('submit',async event=>{event.preventDefault();try{await api('/login',{method:'POST',body:JSON.stringify({password:$('password').value})});$('password').value='';await refresh()}catch(error){$('login-error').textContent=founderError(error)}});
for(const id of ['run-mission','propose-finance','allocate','fund-topup','topup'])$(id).disabled=true;status('Opening your company…');go(location.hash.slice(1));void refreshPaymentStatus().catch(()=>{});void refreshAttention().catch(()=>{});refresh().catch(refreshFailed);
setInterval(()=>{if(!document.hidden){void refreshPaymentStatus().catch(()=>{});void refreshAttention().catch(()=>{})}},5000);
setInterval(()=>{if(!busy&&!document.hidden)refresh().catch(refreshFailed)},6000);
document.addEventListener('submit',event=>{
 const question=event.target.closest('[data-question]'),review=event.target.closest('[data-review-mission]');if(!question&&!review)return;event.preventDefault();const values=Object.fromEntries(new FormData(event.target));act(async()=>{if(question)await api('/founder-questions/'+question.dataset.question,{method:'POST',body:JSON.stringify(values)});else await api('/reviews/employees',{method:'POST',body:JSON.stringify({...values,score:Number(values.score),mission:review.dataset.reviewMission,department:review.dataset.reviewDepartment})});status(question?'Answer sent. Your employee can resume.':'Review saved; transaction status appears here.');if(question)await refreshAttention()})
});
