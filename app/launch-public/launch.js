import {setupProgress} from './setup-progress.js';
const $=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let busy=false,currentJob=null,refreshPending,revision=0;
function launchError(error){if(/Daily operator/i.test(error.message))return 'The demo has reached its daily company limit. Please try tomorrow.';return /code=|TIMEOUT|ECONN|keystore|gas policy|nonce|RPC|file:\/\//i.test(error.message)?'Setup is temporarily paused. Your progress is saved.':error.message||'Unable to complete this request. Your progress is saved.'}
async function api(path,body){const response=await fetch('/launch/api/'+path,{...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});if([502,503,504].includes(response.status))throw new Error('Setup is temporarily unavailable. Your progress is saved.');const result=await response.json();if(!response.ok)throw new Error(result.error||'Setup unavailable');return result}
function controls(){
 $('company-select').disabled=busy;
 $('new-company').disabled=busy||!!currentJob&&currentJob.state!=='ready';
 $('business').querySelector('button').disabled=busy;
 $('roles').querySelector('button').disabled=busy||!$('roles').querySelector('input[name="role"]:checked');
}
function stepLabel(step){
 const fixed={'launch-company':'Register company name','fund-reviewer':'Prepare review account','whitechain-company':'Create payment account','whitechain-finance':'Connect Finance','relayer-gas':'Prepare transaction fees','test-pool':'Prepare test funding'};
 if(fixed[step])return fixed[step];
 const [action,...parts]=step.split('-'),label=parts.join('-'),names={copydesk:'CopyDesk',pixelpress:'PixelPress',lingualink:'LinguaLink',marketing:'Marketing',support:'Support',finance:'Finance'},name=names[label]||label;
 return({fund:`Prepare ${name} wallet`,hire:`Hire ${name}`,identity:`Register ${name} identity`,metadata:`Publish ${name} profile`,ensip25:`Link ${name} identity`,ensip26:`Set ${name} role context`,web:`Connect ${name} profile`,limits:`Set ${name} spending limits`,vendor:`Connect ${name} service`})[action]||step.replaceAll('-',' ');
}
function renderSetupProgress(job){
 const progress=setupProgress(job);$('setup-progress').value=progress.percent;$('progress-percent').textContent=progress.percent+'%';
 $('progress-title').textContent=progress.complete?'Your company is ready':progress.paused?'Setup paused — progress saved':'Your company is taking shape';
 const detail=progress.complete?'Ready to fund and work.':progress.next?'Next: '+stepLabel(progress.next)+'.':'Checking employee identities and final configuration.';
 const summary=`${progress.count} of ${progress.total} transactions confirmed. ${progress.paused?'Saved work will resume when the service recovers.':detail}`;
 if($('progress-summary').textContent!==summary)$('progress-summary').textContent=summary;
 document.querySelectorAll('.setup-phases li').forEach((step,index)=>{step.dataset.complete=String(index<progress.phase);if(index===progress.phase)step.setAttribute('aria-current','step');else step.removeAttribute('aria-current')});
}
function refresh(){return refreshPending??=(async()=>{
 const version=revision,{job,companies=[],operatorReady}=await api('state');if(version!==revision)return;
 currentJob=job;$('company-switcher').hidden=!companies.length;
 const options=`<option value="" disabled ${job?'':'selected'}>Select a company</option>`+companies.map(c=>`<option value="${esc(c.id)}" ${job?.id===c.id?'selected':''}>${esc(c.name)} · ${esc(c.label)}.enswhite.eth</option>`).join('');
 if(document.activeElement!==$('company-select')&&$('company-select').innerHTML!==options)$('company-select').innerHTML=options;
 $('business').hidden=!!job;$('progress').hidden=!job||!job.roles;$('hire').hidden=!job||!!job.roles;
 $('launch-heading').textContent=!job?'What’s your business?':!job.roles?'Choose your team.':job.state==='ready'?'Your company is ready.':'Building your company.';
 $('launch-intro').hidden=!!job;
 if(job){
  renderSetupProgress(job);
  $('company-name').textContent=job.companyName;
  $('operator').textContent=job.state==='ready'?'Add a budget, give your team a mission and review the work they deliver.':operatorReady?'We’re setting up your company and employee identities. You can follow each transaction below.':'Your setup request is saved. It will continue when the launch service reconnects.';
  const checklist=job.steps.map(s=>`<li>${esc(stepLabel(s.step))} · ${esc(s.state)} <a target="_blank" rel="noreferrer" href="${s.chain===11155111?'https://sepolia.etherscan.io':'https://explorer.testnet.whitechain.io'}/tx/${esc(s.hash)}">View transaction ↗</a></li>`).join('');
  if($('checklist').innerHTML!==checklist)$('checklist').innerHTML=checklist;
  $('setup-error').textContent=job.error?launchError(new Error(job.error)):'';$('open-company').hidden=job.state!=='ready';
 }
 controls();
})().finally(()=>{refreshPending=null})}
async function act(work){
 if(busy)return;busy=true;revision++;controls();$('status').textContent='Saving…';
 try{await work();await refreshPending;await refresh();$('status').textContent=''}catch(error){$('status').textContent=launchError(error)}finally{busy=false;controls()}
}
$('business').onsubmit=event=>{event.preventDefault();act(async()=>{await api('session',{});await api('business',Object.fromEntries(new FormData(event.target)))})};
$('roles').onsubmit=event=>{event.preventDefault();if(!$('roles').querySelector('input[name="role"]:checked'))return;act(()=>api('hire',{roles:[...new FormData(event.target).getAll('role'),'finance']}))};
$('roles').addEventListener('change',controls);
const label=$('business').elements.label;$('business').elements.name.oninput=event=>{if(!label.dataset.edited)label.value=event.target.value.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)};label.oninput=()=>{label.dataset.edited='true'};
const suggestedTeam=new URLSearchParams(location.search).get('team');
if(['marketing','support','full'].includes(suggestedTeam))for(const input of $('roles').querySelectorAll('input[name=role]'))input.checked=suggestedTeam==='full'||input.value===suggestedTeam;
void refresh().catch(error=>{$('status').textContent=launchError(error)});setInterval(()=>{if(!busy&&!document.hidden)void refresh().catch(()=>{$('status').textContent='Reconnecting. Your progress is saved.'})},3000);
$('new-company').onclick=()=>act(async()=>{await api('new',{});$('business').reset();delete label.dataset.edited;});
$('company-select').onchange=event=>{const id=event.target.value;act(async()=>{await api(id?'select':'new',id?{id}:{});if(!id){$('business').reset();delete label.dataset.edited;}})};
