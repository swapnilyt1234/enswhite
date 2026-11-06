const $ = id => document.getElementById(id);
const money = units => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(units || 0)/10000);
const esc = text => String(text ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
const icons = { marketing:'✧',support:'◌',finance:'▤',copydesk:'Aa',pixelpress:'▧',lingualink:'अ' };
let state, busy = false, images = [], checkoutScript, refreshError=false;
const routePrefix=location.pathname.startsWith('/guest/')?'/guest':location.pathname.startsWith('/owner/')?'/owner':'';
let selectedAgent='all',activityStream;const workEvents=new Map();
const deskLink=document.createElement('a');deskLink.href='#desk';deskLink.dataset.view='desk';deskLink.className='nav-link';deskLink.innerHTML='<span aria-hidden="true">◉</span>Agent Desk';document.querySelector('nav').append(deskLink);
const businessForm=document.createElement('form');businessForm.className='business-form recent-panel';businessForm.innerHTML='<h2>Your business</h2><p class="micro">Give your employees the context they need. This profile guides future missions; it does not change ENS ownership or payment permissions.</p><label>Business name<input name="name" maxlength="80" required></label><label>What do you sell?<textarea name="description" maxlength="600" required></textarea></label><label>Who is it for?<input name="audience" maxlength="180" required></label><label>Customer help language<select name="language"><option>Hindi</option><option>Marathi</option></select></label><button class="btn outline" type="submit">Save business profile →</button>';
$('view-team').append(businessForm);
for(const [field,label,max]of [['productName','Product name',100],['shippingPolicy','Shipping policy (leave empty if unknown)',600],['returnPolicy','Return policy (leave empty if unknown)',600],['contact','Customer contact details',180],['brandColours','Brand colours (hex values)',100],['productImage','Product image HTTPS URL (optional)',500]]){const labelNode=document.createElement('label');labelNode.textContent=label;const input=document.createElement(field.endsWith('Policy')?'textarea':'input');input.name=field;input.maxLength=max;labelNode.append(input);businessForm.insertBefore(labelNode,businessForm.querySelector('button'))}
const financePanel=document.querySelector('.finance-panel');financePanel.querySelector('h2').textContent='Budget for the work ahead.';financePanel.querySelector('p').textContent='Finance studies task costs and existing funds. Review its proposal before authorizing an allocation.';financePanel.querySelector('.allocation-bar')?.remove();financePanel.querySelector('.allocation-legend')?.remove();const proposalBox=document.createElement('div');proposalBox.id='finance-proposal';financePanel.insertBefore(proposalBox,$('allocate'));const propose=document.createElement('button');propose.id='propose-finance';propose.className='btn outline';propose.textContent='Ask Finance for a proposal →';financePanel.insertBefore(propose,proposalBox);
for(const [id,label,icon]of [['overview','Overview','◈'],['deliverables','Deliverables','▱']]){const section=document.createElement('section');section.id='view-'+id;section.className='view';section.hidden=true;section.innerHTML=`<div class="page-heading"><div><p class="eyebrow">YOUR BUSINESS, OPERATED BY EMPLOYEES.</p><h1>${label}.</h1></div></div><div id="${id}-content"></div>`;$('view-team').before(section);const link=document.createElement('a');link.href='#'+id;link.dataset.view=id;link.className='nav-link';link.innerHTML=`<span aria-hidden="true">${icon}</span>${label}`;if(id==='overview')document.querySelector('nav').prepend(link);else document.querySelector('nav').append(link)}
document.querySelector('[data-view=team]').after(deskLink);document.querySelector('[data-view=mission]').after(document.querySelector('[data-view=deliverables]'));
businessForm.addEventListener('submit',event=>{event.preventDefault();act(async()=>{await api('/business',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(businessForm)))});status('Business profile saved. Your next mission will use this context.');await refresh()})});
let missionKey = sessionStorage.getItem('relayMissionKey'), missionTitle = sessionStorage.getItem('relayMissionTitle');
const chainPreference = localStorage.getItem('relayShowOnchain') === 'true';
document.body.dataset.onchain = String(chainPreference); $('show-chain').checked = chainPreference;
function status(message, error = false) { refreshError=false; $('status').textContent = message; $('status').classList.toggle('error', error); }
function refreshFailed(error){status(error.message,true);refreshError=true}
async function api(path, options = {}) {
  const response = await fetch(routePrefix+'/api' + path, { ...options, headers: { 'Content-Type':'application/json', ...options.headers } });
  const body = await response.json();
  if (response.status === 401) { if(routePrefix==='/guest'){location.href='/';throw new Error('Guest session expired.')} $('login').hidden = false; throw new Error('Sign in with your founder password.'); }
  if (!response.ok) throw new Error(body.error || 'Request failed');
  return body;
}
function go(view) {
  if (!['overview','team','mission','approvals','books','marketplace','desk','deliverables'].includes(view)) view='overview';
  document.querySelectorAll('.view').forEach(section=>{section.hidden=section.id!=='view-'+view});
  document.querySelectorAll('[data-view]').forEach(link=>link.classList.toggle('active',link.dataset.view===view));
  $('breadcrumb-view').textContent = view[0].toUpperCase()+view.slice(1);
  history.replaceState(null,'','#'+view);
}
document.addEventListener('click',event=>{
  const target=event.target.closest('[data-go],[data-view]');
  if(target){event.preventDefault();go(target.dataset.go||target.dataset.view);}
});
$('show-chain').addEventListener('change',()=>{document.body.dataset.onchain=String($('show-chain').checked);localStorage.setItem('relayShowOnchain',String($('show-chain').checked));});
function tag(value) { return `<span class="state ${['approval','queued','submitted','confirmed'].includes(value)?'pending':['failed','rejected'].includes(value)?'failed':''}">${esc(value==='approval'?'Needs your approval':value==='delivered'?'Delivered':value)}</span>`; }
function txLink(hash,label='View transaction ↗') { return state.explorer && hash ? `<a class="onchain onchain-link" target="_blank" rel="noreferrer" href="${state.explorer}/tx/${esc(hash)}">${esc(label)}</a>` : ''; }
function empty(title,subtitle='') { return `<div class="empty">${esc(title)}<span>${esc(subtitle)}</span></div>`; }
function renderDesk(){
 if(!state)return;
 const log=document.querySelector('.desk-log'),follow=log.scrollHeight-log.scrollTop-log.clientHeight<100;
 $('desk-agents').innerHTML=`<button class="desk-agent ${selectedAgent==='all'?'selected':''}" data-agent-filter="all">All departments</button>`+state.team.map(dept=>{const expiry=dept.identity?Math.max(0,Number(dept.identity.expiry)-Date.now()/1000):null;return `<button class="desk-agent ${selectedAgent===dept.id?'selected':''}" data-agent-filter="${dept.id}"><span class="agent-icon ${dept.id}">${icons[dept.id]}</span><strong>${esc(dept.name)}</strong><small>${esc(dept.ensName||(state.mode==='simulated'?'Simulated identity':'No ENS identity'))}</small><small>${esc(runStatus(dept))} · ${money(dept.remaining)} left</small><small>${expiry===null?'':`Contract: ${Math.floor(expiry/86400)}d ${Math.floor(expiry%86400/3600)}h ${Math.floor(expiry%3600/60)}m left`}</small></button>`}).join('');
 const events=[...workEvents.values()].filter(row=>selectedAgent==='all'||row.department===selectedAgent).sort((a,b)=>a.id-b.id).slice(-150);
 $('desk-timeline').innerHTML=events.length?events.map(row=>{const hash=row.data?.hash,base=row.data?.network==='sepolia'?'https://sepolia.etherscan.io':row.data?.network==='whitechain'?state.explorer:null;return `<article class="desk-entry ${row.kind==='refused'||row.kind==='declined'?'desk-refusal':''}"><div><strong>${esc(row.department==='company'?'EnsWhite':state.team.find(x=>x.id===row.department)?.name)}</strong><time>${new Date(row.time).toLocaleTimeString()}</time></div><p>${esc(row.message)}</p>${base&&/^0x[0-9a-f]{64}$/i.test(hash||'')?`<a target="_blank" rel="noreferrer" href="${base}/tx/${hash}">View transaction ↗</a>`:''}${row.data?.tool?`<details><summary>Tool arguments and result</summary><pre class="tool-json">${esc(JSON.stringify({arguments:row.data.arguments,result:row.data.result},null,2))}</pre></details>`:''}<small>${esc(row.kind.replaceAll('_',' '))}</small></article>`}).join(''):empty('Your employees will explain their work here.','Start a mission to see real quotes, checks, approvals and receipts.');
 if(follow)log.scrollTop=log.scrollHeight;
}
function runStatus(dept){const run=dept.currentRun;if(!run)return'Idle';if(run.state==='waiting')return state.tasks.some(x=>x.dept===dept.id&&x.mission_id===run.mission_id&&x.state==='approval')?'Waiting for approval':'Waiting for work';return({queued:'Assigned',thinking:'Thinking',executing:'Executing',completed:'Completed',failed:'Paused'})[run.state]||run.state}
function renderWorkforce(){
 const runs=state.agentRuns||[];document.querySelector('.live-label').textContent=runs.some(x=>x.state==='failed')?'Employee run needs attention':'Workspace connected';const kits=state.missions.filter(x=>x.kit_ready);
 $('overview-content').innerHTML=`<article class="recent-panel"><h2>${esc(state.business.name)}</h2><p>${esc(state.business.description)}</p><p>${runs.filter(x=>['queued','thinking','executing','waiting'].includes(x.state)).length} active employee assignments · ${kits.length} completed Campaign Kits · ${money(state.companyBalance)} company cash</p><button class="btn outline" data-go="team">Company profile & employees →</button><button class="btn primary" data-go="mission">Assign a business mission →</button></article><div class="team-grid">${state.team.map(d=>`<article class="team-card"><h3>${esc(d.name)}</h3><p>${esc(runStatus(d))}</p><p>${esc(d.capabilities.map(x=>x.replaceAll('_',' ')).join(' · '))}</p></article>`).join('')}</div>`;
 $('deliverables-content').innerHTML=kits.length?kits.map(m=>`<article class="recent-panel"><h2>${esc(m.title)}</h2><p>${esc(m.source==='offline tool workflow'?'Offline tool workflow':m.source==='OpenAI tool runtime'?'Model tool workflow':'Legacy workflow')} · Owned by Marketing</p><a class="btn outline" href="${routePrefix}/kit/${encodeURIComponent(m.id)}">Open Campaign Kit ↗</a></article>`).join(''):empty('Completed business work will appear here.','A Kit requires verified deliveries and completed employee submissions.');
 const panel=document.createElement('div');panel.className='run-list';panel.innerHTML=`<h2>Employee assignments</h2>${runs.slice(0,12).map(r=>`<article class="desk-entry"><strong>${esc(r.department)} · ${esc(r.state)} · ${r.calls}/8 tools</strong><p>${esc(state.missions.find(x=>x.id===r.mission_id)?.title||'Finance allocation proposal')} · ${r.source==='llm'?'Model runtime':'Offline workflow'}</p>${r.error?`<p class="error">${esc(r.error)}</p>${r.calls<8&&r.attempts<12?`<button class="btn outline" data-retry-run="${esc(r.id)}">Retry saved run</button>`:''}`:''}<button class="text-link" data-inspect-run="${esc(r.id)}">Inspect tool history ↗</button></article>`).join('')}`;document.querySelector('#view-desk .run-list')?.remove();$('view-desk').append(panel);
 for(const [index,d]of state.team.entries()){const card=$('team-cards').children[index],details=document.createElement('p');details.className='micro';details.textContent=`${runStatus(d)} · ${d.capabilities.map(x=>x.replaceAll('_',' ')).join(', ')} · ERC-8004 ${d.identity?.discovery?.binding?.verified?'#'+d.identity.discovery.binding.agentId:'registration pending'} · ${d.wbtBalance===null?'Simulated WBT':(Number(d.wbtBalance)/1e18).toFixed(6)+' WBT'}`;card.append(details)}
 const proposal=state.allocationProposal;$('finance-proposal').innerHTML=proposal?`<p>${esc(proposal.rationale)}</p>${Object.entries(JSON.parse(proposal.allocations)).map(([d,v])=>`<p>${esc(d)}: <strong>${money(v)}</strong></p>`).join('')}<p class="micro">${proposal.source==='llm'?'Model proposal':'Offline cost proposal'} · Funds move only after your approval.</p>`:'<p class="micro">No pending allocation proposal.</p>';$('allocate').textContent='Approve this proposal →';$('allocate').disabled=busy||!proposal;$('propose-finance').disabled=busy||runs.some(x=>x.purpose==='allocation'&&['queued','thinking','executing'].includes(x.state));
 const details=document.createElement('details');details.className='recent-panel';const handoffs=(state.agentMessages||[]).filter(x=>['design_handoff','budget_request','budget_policy_decision'].includes(x.kind));details.innerHTML='<summary>Structured employee handoffs</summary>'+handoffs.map(m=>`<article><strong>${esc(m.sender)} → ${esc(m.recipient)}</strong><pre class="tool-json">${esc(JSON.stringify(m.content,null,2))}</pre></article>`).join('');document.querySelector('#view-desk .handoff-list')?.remove();details.classList.add('handoff-list');$('view-desk').append(details);
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
  $('team-cards').innerHTML=state.team.map(dept=>{
    const percent=Math.min(100,Math.max(0,Number(dept.spent)/Number(dept.weekly)*100));
    const last=dept.lastPurchase, vendor=last&&state.vendors.find(v=>v.address.toLowerCase()===last.vendor.toLowerCase());
    return `<article class="team-card"><div class="agent-heading"><span class="agent-icon ${dept.id}" aria-hidden="true">${icons[dept.id]}</span><span class="agent-tag">${dept.id==='finance'?'KEEPING THE BOOKS':'READY TO WORK'}</span></div><h3>${dept.name}</h3><p class="description">${dept.title}</p><span class="card-balance-label">AVAILABLE BUDGET</span><div class="card-balance"><strong>${money(Math.max(0,Number(dept.remaining)))}</strong><span>/ ${money(dept.weekly)} weekly</span></div><div class="budget-track"><span style="width:${percent}%"></span></div><div class="budget-caption"><span>${money(dept.spent)} spent</span><span>${percent.toFixed(0)}% of weekly cap</span></div><div class="card-policy"><span>Per call <strong>${money(dept.perCall)}</strong></span><span>Ask above <strong>${money(dept.approval)}</strong></span></div><p class="last-purchase">LAST PURCHASE<b>${last?esc(vendor?.name||'Vendor')+' · '+money(last.amount):dept.id==='finance'?'Signed allocation proposals. Watching the ledger.':'The first receipt is waiting to happen.'}</b></p><code class="onchain">${dept.address}<br>${dept.wbtBalance===null?'Simulated WBT':(Number(dept.wbtBalance)/1e18).toFixed(6)+' WBT'} · USDT ${Number(dept.balance)/1e6}</code></article>`;
  }).join('');
  if(state.ens?.enabled){
    $('team-cards').querySelectorAll('.team-card').forEach((card,index)=>{
      const dept=state.team[index],identity=dept.identity;
      const remaining=identity?Math.max(0,Math.floor(Number(identity.expiry)-Date.now()/1000)):0;
      const panel=document.createElement('div');panel.className='ens-identity';
      panel.innerHTML=`<a class="text-link" target="_blank" rel="noreferrer" href="https://sepolia.app.ens.domains/${encodeURIComponent(dept.ensName)}">${esc(dept.ensName)} ↗</a><p class="micro">${identity?'Contract ends in '+Math.floor(remaining/86400)+'d '+Math.floor(remaining%86400/3600)+'h '+Math.floor(remaining%3600/60)+'m '+Math.floor(remaining%60)+'s':'Not hired, fired, or expired. Payments are blocked.'}</p><p class="micro">ENS status: ${esc(identity?.status||'Awaiting first update')}</p><div class="task-actions">${identity?`<button class="btn outline" data-ens-action="renew" data-label="${dept.id}">Renew 30 days</button><button class="btn reject" data-ens-action="fire" data-label="${dept.id}">Fire</button>`:`<button class="btn primary" data-ens-action="hire" data-label="${dept.id}">Hire for 30 days</button><button class="btn outline" data-ens-action="hire" data-term="300" data-label="${dept.id}">5-minute demo hire</button>`}</div>`;
      if(identity){const id=document.createElement('details');id.className='employee-id';id.innerHTML=`<summary>Employee ID · non-transferable badge</summary><p><code>Owner: ${esc(identity.wallet)}<br>Token: ${esc(identity.tokenId)}</code></p><p><a href="https://sepolia.etherscan.io/address/${esc(identity.resolver)}" target="_blank" rel="noreferrer">Inspect resolver ↗</a></p><p class="micro">Live scoped roles: ${identity.roles?.status?'employee status ✓':'status unavailable'} · ${identity.roles?.financeBudget?'Finance weekly budget ✓':'Finance scope unavailable'}</p>${identity.hire?`<ol class="hire-steps"><li>${identity.hire.resolverDeployed?'✓':'?'} Resolver deployed</li><li>${identity.hire.badgeMinted?'✓':'?'} Employee badge registered</li><li>${identity.hire.financeRoleGranted?'✓':'?'} Finance role granted</li></ol><a target="_blank" rel="noreferrer" href="https://sepolia.etherscan.io/tx/${esc(identity.hire.hash)}">Hire transaction ↗</a>`:''}<p class="micro">ERC-8004 / ENSIP-25: ${esc(identity.discovery?.binding?.verified?'Verified identity binding':identity.discovery?.binding?.reason||'Not configured')}</p>`;panel.append(id)}
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
    if(task.result.type==='svg'){
      const url=URL.createObjectURL(new Blob([task.result.content],{type:'image/svg+xml'})); images.push(url);
      delivery=`<div class="task-result"><img src="${url}" alt="Campaign banner delivered by PixelPress"></div>`;
    } else delivery=`<div class="task-result">${esc(task.result.content)}</div>`;
  }
  return `<article class="task-card"><div class="task-top"><span class="agent-icon ${dept?.id||''}">${icons[vendor?.id]||'↗'}</span><div><h3>${esc(vendor?.service)} <span>· ${money(task.amount)}</span></h3><p>${esc(dept?.name)} → ${esc(vendor?.name)} · Independent vendor</p></div>${tag(task.state)}</div><details class="task-brief"><summary>Vendor brief</summary><p>${esc(task.task)}</p></details>${delivery}<div class="task-footer"><span>${task.error?esc(task.error):task.result?'Delivery received after payment verification.':approval?'Above '+money(dept.approval)+' approval threshold. No payment has been signed.':'Funds reserved. The vendor delivers after payment confirmation.'}</span>${approval?`<div class="task-actions"><button class="btn reject" data-decision="false" data-task="${task.id}">Decline</button><button class="btn primary" data-decision="true" data-task="${task.id}">Approve ${money(task.amount)} →</button></div>`:txLink(job?.hash)}</div></article>`;
}
function renderTasks() {
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
async function refresh() {
  state=await api('/state');$('login').hidden=true;
  for(const [key,value] of Object.entries(state.business||{})){const input=businessForm.elements.namedItem(key);if(input&&document.activeElement!==input)input.value=value}
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
  $('cash').textContent=money(state.companyBalance);
  $('team-balance').textContent=money(state.team.reduce((sum,d)=>sum+BigInt(d.balance),0n));
  $('vendor-spend').textContent=money(state.ledger.reduce((sum,row)=>sum+BigInt(row.amount),0n));
  $('receipt-count').textContent=state.ledger.length+' verifiable receipts';
  $('environment').textContent=(state.mode==='simulated'?'Local simulation':'Testnet settlement')+' · '+(state.aiMode==='offline'?'Offline tools':state.aiMode==='configured'?'AI runtime':'AI '+state.aiMode);
  $('disclosure').textContent=state.mode==='simulated'?'Fiat and transfers are simulated locally. No real money or onchain transaction occurs.':'Razorpay test mode. Fiat is simulated; vendor payments settle in test USDT on Whitechain.';
  const backing=state.topup,canCheckout=backing.canCheckout!==false;
  $('topup').disabled=busy||!canCheckout;$('topup').textContent=canCheckout?'+ Add ₹500':'Pool funding needed';
  const warning=$('pool-warning');warning.hidden=canCheckout&&!backing.pendingCount;
  if(backing.pendingCount){warning.textContent=`${backing.pendingCount} verified sandbox payment(s), ${Number(backing.pendingUnits)/1e6} test USDT credit, awaiting settlement. ${BigInt(backing.shortfall||'0')>0n?`The business must deposit ${Number(backing.shortfall)/1e6} more test USDT into company ${state.company}. `:''}Existing payments retry automatically; do not repeat checkout.`}
  else if(!canCheckout){warning.textContent=`New sandbox top-ups require prefunded test USDT at company ${state.company}. Existing company credit and department budgets remain available; another checkout cannot refill the pool.`}
  $('allocate').disabled=busy||BigInt(state.companyBalance)===0n;
  $('run-mission').disabled=busy||!state.team.some(d=>BigInt(d.balance)>0n&&(!state.ens?.enabled||d.identity));
  renderTeam();renderActivity();renderTasks();renderBooks();renderVendors();renderWorkforce();
  $('chain-details').textContent=`${state.scheme} · x402 v2 custom scheme · receiveWithAuthorization · ${state.network} · 1% fee`;
  $('company-address').textContent=state.company;$('relayer-address').textContent=state.relayer;
  $('gas-tank').textContent=state.mode==='simulated'?'Simulated':(Number(state.relayerWbt)/1e18).toFixed(4)+' WBT';
  $('job-errors').innerHTML=state.jobs.filter(row=>row.error).map(row=>`<div class="job-error">${esc(row.kind)}: ${esc(row.error)}</div>`).join('');
}
async function act(action) {
  if(busy)return;busy=true;document.querySelectorAll('button').forEach(button=>button.disabled=true);
  try{await action()}catch(error){status(error.message,true)}
  finally{busy=false;document.querySelectorAll('button').forEach(button=>button.disabled=false);try{await refresh()}catch(error){refreshFailed(error)}}
}
$('propose-finance').addEventListener('click',()=>act(async()=>{await api('/finance/proposal',{method:'POST'});status('Finance is reviewing actual balances and service costs. Watch the Agent Desk.')}));
$('allocate').addEventListener('click',()=>act(async()=>{if(!state.allocationProposal)throw new Error('Ask Finance for a proposal first.');await api('/allocate',{method:'POST',body:JSON.stringify({proposalId:state.allocationProposal.id})});status('Proposal approved. Finance will sign the validated allocations.')}));
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
  if(!confirm(`${action} ${label}.${state.ens.companyName} on Sepolia? Your wallet will show the transaction and gas fee.`))return;
  const tx=await api('/ens/manage',{method:'POST',body:JSON.stringify({action,label,term:Number(button.dataset.term||2592000)})});
  const hash=await sendENS(tx);
  status(`ENS ${action} submitted: ${hash}. The directory refreshes after confirmation.`);
 });
});
async function sendENS(tx){
 if(!window.ethereum)throw new Error('Open this app in a browser with your founder Ethereum wallet to manage ENS names.');
 const accounts=await window.ethereum.request({method:'eth_requestAccounts'});
 if(accounts[0]?.toLowerCase()!==tx.from.toLowerCase())throw new Error('Connect the founder wallet that owns this ENS company.');
 await window.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:tx.chainId}]});
 return window.ethereum.request({method:'eth_sendTransaction',params:[{from:tx.from,to:tx.to,data:tx.data}]});
}
$('ens-signup-form').addEventListener('submit',event=>{event.preventDefault();act(async()=>{
 const label=$('ens-company-label').value.trim();
 if(!confirm(`Register ${label}.enswhite.eth and create its company registry on Sepolia?`))return;
 const tx=await api('/ens/signup',{method:'POST',body:JSON.stringify({label})});
 const hash=await sendENS(tx);status(`${tx.name} registration submitted: ${hash}. This workspace remains ${state.ens.companyName}.`);
})});
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
  await checkout();await new Promise(resolve=>{const widget=new window.Razorpay({key:order.keyId,order_id:order.id,amount:order.amount,currency:order.currency,name:'EnsWhite · Test mode',description:'₹500 sandbox top-up → company budget',handler(){status('Checkout complete. Waiting for verified attestation and onchain company credit.');resolve()},modal:{ondismiss:resolve},theme:{color:'#195740'}});widget.on('payment.failed',()=>{status('Sandbox payment failed; no credit issued.',true);resolve()});widget.open()});
}));
$('login-form').addEventListener('submit',async event=>{event.preventDefault();try{await api('/login',{method:'POST',body:JSON.stringify({password:$('password').value})});$('password').value='';await refresh()}catch(error){$('login-error').textContent=error.message}});
go(location.hash.slice(1));refresh().catch(refreshFailed);
setInterval(()=>{if(!busy&&!document.hidden)refresh().catch(refreshFailed)},6000);
