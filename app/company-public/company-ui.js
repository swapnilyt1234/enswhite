const $ = id => document.getElementById(id);
const money = units => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(units || 0)/10000);
const esc = text => String(text ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
const icons = { marketing:'✧',support:'◌',finance:'▤',copydesk:'Aa',pixelpress:'▧',lingualink:'अ' };
let state, busy = false, images = [], checkoutScript;
let missionKey = sessionStorage.getItem('relayMissionKey'), missionTitle = sessionStorage.getItem('relayMissionTitle');
const chainPreference = localStorage.getItem('relayShowOnchain') === 'true';
document.body.dataset.onchain = String(chainPreference); $('show-chain').checked = chainPreference;
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
async function api(path, options = {}) {
  const response = await fetch('/api' + path, { ...options, headers: { 'Content-Type':'application/json', ...options.headers } });
  const body = await response.json();
  if (response.status === 401) { $('login').hidden = false; throw new Error('Sign in with your founder password.'); }
  if (!response.ok) throw new Error(body.error || 'Request failed');
  return body;
}
function go(view) {
  if (!['team','mission','approvals','books','marketplace'].includes(view)) view='team';
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
function renderTeam() {
  $('team-cards').innerHTML=state.team.map(dept=>{
    const percent=Math.min(100,Math.max(0,Number(dept.spent)/Number(dept.weekly)*100));
    const last=dept.lastPurchase, vendor=last&&state.vendors.find(v=>v.address.toLowerCase()===last.vendor.toLowerCase());
    return `<article class="team-card"><div class="agent-heading"><span class="agent-icon ${dept.id}" aria-hidden="true">${icons[dept.id]}</span><span class="agent-tag">${dept.id==='finance'?'KEEPING THE BOOKS':'READY TO WORK'}</span></div><h3>${dept.name}</h3><p class="description">${dept.title}</p><span class="card-balance-label">AVAILABLE BUDGET</span><div class="card-balance"><strong>${money(Math.max(0,Number(dept.remaining)))}</strong><span>/ ${money(dept.weekly)} weekly</span></div><div class="budget-track"><span style="width:${percent}%"></span></div><div class="budget-caption"><span>${money(dept.spent)} spent</span><span>${percent.toFixed(0)}% of weekly cap</span></div><div class="card-policy"><span>Per call <strong>${money(dept.perCall)}</strong></span><span>Ask above <strong>${money(dept.approval)}</strong></span></div><p class="last-purchase">LAST PURCHASE<b>${last?esc(vendor?.name||'Vendor')+' · '+money(last.amount):dept.id==='finance'?'Signed allocation proposals. Watching the ledger.':'The first receipt is waiting to happen.'}</b></p><code class="onchain">${dept.address}<br>Zero WBT · USDT ${Number(dept.balance)/1e6}</code></article>`;
  }).join('');
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
  return `<article class="task-card"><div class="task-top"><span class="agent-icon ${dept?.id||''}">${icons[vendor?.id]||'↗'}</span><div><h3>${esc(vendor?.service)} <span>· ${money(task.amount)}</span></h3><p>${esc(dept?.name)} → ${esc(vendor?.name)} · Independent vendor</p></div>${tag(task.state)}</div><p class="task-brief">${esc(task.task)}</p>${delivery}<div class="task-footer"><span>${task.error?esc(task.error):task.result?esc(task.result.source):approval?'Above '+money(dept.approval)+' approval threshold. No payment has been signed.':'Funds reserved. The vendor delivers after payment confirmation.'}</span>${approval?`<div class="task-actions"><button class="btn reject" data-decision="false" data-task="${task.id}">Decline</button><button class="btn primary" data-decision="true" data-task="${task.id}">Approve ${money(task.amount)} →</button></div>`:txLink(job?.hash)}</div></article>`;
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
  $('mission-history').innerHTML=state.missions.slice(0,3).map(row=>`<div class="history-item"><strong>${esc(row.title)}</strong><br>${esc(row.source)}</div>`).join('');
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
  $('vendor-cards').innerHTML=state.vendors.map(vendor=>`<article class="team-card"><div class="agent-heading"><span class="agent-icon">${icons[vendor.id]}</span><span class="tiny-tag">INDEPENDENT VENDOR</span></div><h3>${vendor.name}</h3><div class="vendor-service">${vendor.service}</div><p class="description">Paid per task. Delivery after independently verified payment.</p><div class="vendor-price">${money(vendor.price)}<small>per task · 1% platform fee included</small></div><a class="text-link vendor-link" target="_blank" rel="noreferrer" href="${vendor.earningsUrl}">Open vendor earnings ↗</a><code class="onchain">${vendor.address}<br>Node process · port ${vendor.port}</code></article>`).join('');
}
async function refresh() {
  state=await api('/state');$('login').hidden=true;
  $('cash').textContent=money(state.companyBalance);
  $('team-balance').textContent=money(state.team.reduce((sum,d)=>sum+BigInt(d.balance),0n));
  $('vendor-spend').textContent=money(state.ledger.reduce((sum,row)=>sum+BigInt(row.amount),0n));
  $('receipt-count').textContent=state.ledger.length+' verifiable receipts';
  $('environment').textContent=state.mode==='simulated'?'Local simulation':'Testnet settlement';
  $('disclosure').textContent=state.mode==='simulated'?'Fiat and transfers are simulated locally. No real money or onchain transaction occurs.':'Razorpay test mode. Fiat is simulated; vendor payments settle in test USDT on Whitechain.';
  $('topup').disabled=busy;$('allocate').disabled=busy||BigInt(state.companyBalance)===0n;
  $('run-mission').disabled=busy||!state.team.some(d=>BigInt(d.balance)>0n);
  renderTeam();renderActivity();renderTasks();renderBooks();renderVendors();
  $('chain-details').textContent=`${state.scheme} · x402 v2 custom scheme · receiveWithAuthorization · ${state.network} · 1% fee`;
  $('company-address').textContent=state.company;$('relayer-address').textContent=state.relayer;
  $('gas-tank').textContent=state.mode==='simulated'?'Simulated':(Number(state.relayerWbt)/1e18).toFixed(4)+' WBT';
  $('job-errors').innerHTML=state.jobs.filter(row=>row.error).map(row=>`<div class="job-error">${esc(row.kind)}: ${esc(row.error)}</div>`).join('');
}
async function act(action) {
  if(busy)return;busy=true;document.querySelectorAll('button').forEach(button=>button.disabled=true);
  try{await action()}catch(error){status(error.message,true)}
  finally{busy=false;document.querySelectorAll('button').forEach(button=>button.disabled=false);try{await refresh()}catch(error){status(error.message,true)}}
}
$('allocate').addEventListener('click',()=>act(async()=>{await api('/allocate',{method:'POST'});status('Finance signed the budget allocations. Your team is ready.')}));
$('mission-form').addEventListener('submit',event=>{event.preventDefault();act(async()=>{
  const title=$('mission').value.trim();
  if(!missionKey||title!==missionTitle){missionKey=crypto.randomUUID();missionTitle=title;sessionStorage.setItem('relayMissionKey',missionKey);sessionStorage.setItem('relayMissionTitle',title)}
  status('Your departments are preparing their vendor briefs…');
  await api('/missions',{method:'POST',headers:{'idempotency-key':missionKey},body:JSON.stringify({title})});
  missionKey=null;sessionStorage.removeItem('relayMissionKey');status('Mission started. Check Approvals for purchases that need your decision.');
})});
document.addEventListener('click',event=>{const decision=event.target.closest('[data-decision]');if(decision)act(async()=>{await api('/approvals/'+decision.dataset.task,{method:'POST',body:JSON.stringify({approved:decision.dataset.decision==='true'})});status(decision.dataset.decision==='true'?'Approved. Your agent can authorize the vendor payment.':'Declined. The reserved budget has been released.');})});
function checkout(){return checkoutScript??=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://checkout.razorpay.com/v1/checkout.js';script.onload=resolve;script.onerror=()=>{checkoutScript=null;script.remove();reject(new Error('Could not load Razorpay'))};document.head.append(script)})}
$('topup').addEventListener('click',()=>act(async()=>{
  const order=await api('/orders',{method:'POST'});
  if(order.mode==='simulated'){await api('/simulate',{method:'POST',body:JSON.stringify({orderId:order.id})});status('Simulated top-up credited. Finance can now allocate ₹500.');return}
  await checkout();await new Promise(resolve=>{const widget=new window.Razorpay({key:order.keyId,order_id:order.id,amount:order.amount,currency:order.currency,name:'Relay · Test mode',description:'₹500 sandbox top-up → company budget',handler(){status('Checkout complete. Waiting for verified attestation and onchain company credit.');resolve()},modal:{ondismiss:resolve},theme:{color:'#195740'}});widget.on('payment.failed',()=>{status('Sandbox payment failed; no credit issued.',true);resolve()});widget.open()});
}));
$('login-form').addEventListener('submit',async event=>{event.preventDefault();try{await api('/login',{method:'POST',body:JSON.stringify({password:$('password').value})});$('password').value='';await refresh()}catch(error){$('login-error').textContent=error.message}});
go(location.hash.slice(1));refresh().catch(error=>status(error.message,true));
setInterval(()=>{if(!busy&&!document.hidden)refresh().catch(()=>{})},6000);
