import {keccak256,toUtf8Bytes} from 'ethers';
import {toolsFor,validateArguments} from './agent-definitions.js';

export async function executeJourneyTool({db,store,service,activity,legacy},run,name,args){
 const definition=toolsFor(run)?.find(x=>x.name===name);
 if(!definition)throw Object.assign(new Error('This employee cannot use that tool.'),{status:403});
 validateArguments(definition.parameters,args);
 await service.assertEmployee(run.department);
 const save=(kind,value)=>store.artifact(run.mission_id,run.department,kind,value,run.source);
 const context=()=>service.agentContext(run);
 if(name==='find_vendors'){
  const allowed=service.vendors.filter(v=>v.dept===run.department);
  const candidates=args.capability.toLowerCase()==='all'?allowed:allowed.filter(v=>`${v.id} ${v.name} ${v.description||''} ${v.id==='copydesk'?'copy copywriting':v.id==='pixelpress'?'design landing html banner':'faq translation'}`.toLowerCase().split(/\W+/).some(word=>word.length>2&&args.capability.toLowerCase().includes(word)));
  return service.rankVendors?service.rankVendors(candidates):candidates.map(v=>({id:v.id,name:v.name,price:v.price,reputation:null}));
 }
 if(name==='buy'){
  const vendor=service.vendors.find(v=>v.id===args.vendor&&v.dept===run.department);
  if(!vendor||BigInt(vendor.price)>BigInt(args.max_price))throw Object.assign(new Error('Vendor price exceeds the proposed maximum or role policy.'),{status:403});
  const ctx=await context();
  if(run.department==='support'&&ctx.hiredDepartments?.includes('marketing')&&!store.artifactFor(run.mission_id,'marketing','handoff:support'))return{waiting:true,resumeSameCall:true,message:'Waiting for Marketing’s campaign handoff before commissioning customer help.'};
  if(run.department==='marketing')save('campaign_brief',{objective:ctx.mission,audience:ctx.business.audience,designNotes:args.brief});
  else {
   await legacy('draft_faq',{questions:[{question:'What is the product?',source:'product'},{question:'What is the shipping policy?',source:'shipping'},{question:'What is the return policy?',source:'returns'},{question:'How can customers contact you?',source:'contact'}]});
   await legacy('review_faq',{});
  }
  const quote=await legacy('request_quote',{vendor:args.vendor,brief:args.vendor==='pixelpress'?'Deliverable: HTML landing section\n'+args.brief:args.brief});
  if(quote.waiting)return{...quote,resumeSameCall:true};
  if(BigInt(quote.amount)>BigInt(args.max_price))throw Object.assign(new Error('Verified quote exceeds the proposed maximum.'),{status:403});
  const result=await legacy('purchase_service',{vendor:args.vendor});
  return result.waiting?{...result,resumeSameCall:true}:result;
 }
 if(name==='handoff'){
  await service.assertEmployee(args.department);
  store.message(run,args.department,'employee_handoff',{artifact:args.artifact});
  save('handoff:'+args.department,{artifact:args.artifact});
  activity.record(run.department,'employee_handoff',`I handed work to ${args.department}.`,{mission:run.mission_id,data:args});
  return{shared:true,department:args.department};
 }
 if(name==='ask_founder'){
  const id=keccak256(toUtf8Bytes(`${run.id}:${args.question}`));
  db.prepare('INSERT OR IGNORE INTO founder_questions VALUES(?,?,?,NULL,?)').run(id,run.id,args.question,Date.now());
  const row=db.prepare('SELECT answer FROM founder_questions WHERE id=?').get(id);
  return row.answer?{answer:row.answer}:{waiting:true,resumeSameCall:true,message:args.question,questionId:id};
 }
 if(name==='propose_allocation')return legacy(name,args);
 if(name==='deliver'){
  if(run.department==='finance'){
   if(args.reviews.length)throw new Error('Finance cannot review another department’s purchase');
   await legacy('review_spending',{});
   const report=await legacy('prepare_report',{});
   if(report.waiting)return{...report,resumeSameCall:true};
  }
  const ctx=await context();
  if(run.department==='marketing'&&ctx.hiredDepartments?.includes('support')&&!store.artifactFor(run.mission_id,'marketing','handoff:support'))throw new Error('Hand the campaign to Support before delivering');
  const expected=run.department==='marketing'?['copydesk','pixelpress']:run.department==='support'?['lingualink']:[];
  if(args.reviews.length!==expected.length||new Set(args.reviews.map(x=>x.vendor)).size!==expected.length||args.reviews.some(x=>!expected.includes(x.vendor)))throw new Error('Rate each purchased vendor exactly once');
  // Legacy completion checks still require the actual paid deliveries and founder-sourced FAQ review.
  const result=await legacy('submit_work',{summary:args.artifact.slice(0,1200)});
  if(result.complete){for(const review of args.reviews)await service.review('vendor',run.mission_id,review.vendor,run.department,Number(review.stars),review.comment);save('employee_artifact',{content:args.artifact});}
  return result;
 }
 throw new Error('Unknown tool');
}
