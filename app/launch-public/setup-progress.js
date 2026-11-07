// Keep these step identities aligned with launch-worker.js; only confirmed receipts count.
export function setupProgress(job){
 const roles=job.roles||[],employeeSteps=roles.flatMap(role=>['fund','hire','identity','metadata','ensip25','ensip26','web'].map(step=>step+'-'+role));
 const vendors=[['copydesk','marketing'],['pixelpress','marketing'],['lingualink','support']].filter(([,role])=>roles.includes(role)).map(([vendor])=>'vendor-'+vendor);
 const paymentSteps=['fund-reviewer','whitechain-company','whitechain-finance',...roles.map(role=>'limits-'+role),...vendors,'relayer-gas','test-pool'];
 const planned=['launch-company',...employeeSteps,...(roles.length?paymentSteps:[])],confirmed=new Set((job.steps||[]).filter(step=>step.state==='confirmed').map(step=>step.step));
 const count=planned.filter(step=>confirmed.has(step)).length,complete=count===planned.length&&job.state==='ready';
 const percent=complete?100:Math.min(99,Math.floor(count/planned.length*100));
 const phase=complete?4:!confirmed.has('launch-company')?0:employeeSteps.some(step=>!confirmed.has(step))?1:paymentSteps.some(step=>!confirmed.has(step))?2:3;
 return{count,total:planned.length,percent,phase,next:planned.find(step=>!confirmed.has(step))||null,complete,paused:!!job.error};
}
