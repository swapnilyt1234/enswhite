const $=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));let busy=false,currentJob=null;
async function api(path,body){const response=await fetch('/launch/api/'+path,{...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});const result=await response.json();if(!response.ok)throw new Error(result.error||'Setup unavailable');return result}
async function refresh(){
 const {job,companies=[],operatorReady}=await api('state');currentJob=job;
 $('company-switcher').hidden=!companies.length;if(document.activeElement!==$('company-select'))$('company-select').innerHTML='<option value="">New business</option>'+companies.map(c=>`<option value="${esc(c.id)}" ${job?.id===c.id?'selected':''}>${esc(c.name)} · ${esc(c.label)}.enswhite.eth</option>`).join('');
 $('new-company').disabled=busy||!!job&&job.state!=='ready';
 $('business').hidden=!!job;$('progress').hidden=!job;$('hire').hidden=!job||!!job.roles;
 if(!job)return;
 $('company-name').textContent=job.companyName;$('operator').textContent=job.state==='ready'?'Your company is ready. Open it to fund budgets, assign work and review your team.':operatorReady?'The operator is processing saved transactions. Every confirmed step links to its explorer.':'Waiting for the private launch operator. Your request is saved; no name is claimed as minted yet.';
 $('checklist').innerHTML=job.steps.map(s=>`<li>${esc(s.step.replaceAll('-',' '))} · ${esc(s.state)} <a target="_blank" rel="noreferrer" href="${s.chain===11155111?'https://sepolia.etherscan.io':'https://explorer.testnet.whitechain.io'}/tx/${esc(s.hash)}">${s.chain===11155111?'Sepolia':'Whitechain'} transaction ↗</a></li>`).join('');$('setup-error').textContent=job.error||'';$('open-company').hidden=job.state!=='ready';
}
async function act(work){if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await work();$('status').textContent='';await refresh()}catch(error){$('status').textContent=error.message}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);$('new-company').disabled=!!currentJob&&currentJob.state!=='ready'}}
$('business').onsubmit=event=>{event.preventDefault();act(async()=>{await api('session',{});await api('business',Object.fromEntries(new FormData(event.target)))})};
$('roles').onsubmit=event=>{event.preventDefault();act(()=>api('hire',{roles:[...new FormData(event.target).getAll('role'),'finance']}))};
const label=$('business').elements.label;$('business').elements.name.oninput=event=>{if(!label.dataset.edited)label.value=event.target.value.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)};label.oninput=()=>{label.dataset.edited='true'};
void refresh().catch(error=>{$('status').textContent=error.message});setInterval(()=>void refresh().catch(()=>{}),2000);

$('new-company').onclick=()=>act(async()=>{await api('new',{});$('business').reset();delete label.dataset.edited;});
$('company-select').onchange=event=>{const id=event.target.value;act(async()=>{await api(id?'select':'new',id?{id}:{});if(!id){$('business').reset();delete label.dataset.edited;}})};
