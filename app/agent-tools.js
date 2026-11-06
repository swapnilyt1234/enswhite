import {keccak256,toUtf8Bytes} from 'ethers';
import {EMPLOYEES,validateArguments,toolsFor} from './agent-definitions.js';
import {executeJourneyTool} from './journey-tools.js';

export function createAgentTools({db,store,service,activity}){
 const refuse=message=>{throw Object.assign(new Error(message),{publicMessage:message})};
 const artifact=(run,kind)=>store.artifactFor(run.mission_id,run.department,kind);
 const save=(run,kind,value)=>store.artifact(run.mission_id,run.department,kind,value,run.source);
 const tasks=run=>db.prepare('SELECT id,vendor,state,result,amount FROM company_tasks WHERE mission_id=?').all(run.mission_id).map(x=>({...x,result:x.result?JSON.parse(x.result):null}));
 const waiting=(state,message)=>({waiting:true,state,message});
 const executor={
  async authorize(run){try{return await service.assertEmployee(run.department)}catch(error){throw new Error(/fired or expired/i.test(error.message)?'Employee is fired or expired. Work was not initiated.':'Employee identity could not be verified. Work was not initiated.')}},
  async execute(run,name,args){
   if(run.version===2)return executeJourneyTool({db,store,service,activity,legacy:(name,args)=>executor.execute({...run,version:1},name,args)},run,name,args);
   const definition=toolsFor(run)?.find(x=>x.name===name);if(!definition)refuse('This employee cannot use that tool.');validateArguments(definition.parameters,args);await service.assertEmployee(run.department);
   if(name==='read_context')return service.agentContext(run);
   if(name==='read_ledger')return service.agentLedger(run.mission_id);
   if(name==='create_campaign_brief')return save(run,'campaign_brief',args);
   if(name==='draft_faq'){
    const profile=(await service.agentContext(run)).business,sources={product:profile.description,shipping:profile.shippingPolicy,returns:profile.returnPolicy,contact:profile.contact};
    return save(run,'faq',{questions:args.questions.map(x=>({...x,answer:sources[x.source]||'Not supplied by the founder. Ask the founder before making a promise.',missing:!sources[x.source]}))});
   }
   if(name==='review_faq'){
    const faq=artifact(run,'faq');if(!faq)refuse('Draft the sourced FAQ before reviewing it.');
    const result={reviewed:true,missing:faq.questions.filter(x=>x.missing).map(x=>x.source),note:'Answers use saved founder policy sources. Missing facts are not invented; translation remains a draft for founder review.'};return save(run,'faq_review',result);
   }
   if(name==='request_quote'){
    const context=await service.agentContext(run),profile=context.business;let brief;
    if(run.department==='marketing'){
     const campaign=artifact(run,'campaign_brief');if(!campaign)refuse('Create the campaign brief first.');
     brief=`Business: ${profile.name}\nProduct: ${profile.productName||profile.name}\nOffer: ${profile.description}\nAudience: ${campaign.audience}\nMission: ${context.mission}\nBrand colours: ${profile.brandColours||'#163b32,#cee2ae'}\n${args.brief}`;
     if(args.vendor==='pixelpress'){
      const copy=tasks(run).find(x=>x.vendor==='copydesk'&&x.state==='delivered');if(!copy)return waiting('delivery','I am waiting for CopyDesk’s paid delivery before briefing design.');
      const headline=copy.result.content.split('\n').find(x=>x.trim())?.replace(/^#+\s*/,'').slice(0,100);if(!headline)refuse('CopyDesk delivery has no usable headline.');
      brief=`Headline: ${headline}\n${brief}\nDelivered copy: ${copy.result.content}\nDesign direction: ${campaign.designNotes}`;
     }
    }else{
     const faq=artifact(run,'faq'),review=artifact(run,'faq_review');if(!faq||!review)refuse('Draft and review the factual FAQ before requesting translation.');
     brief=`Translate this sourced customer FAQ into ${profile.language}. Do not add facts, dates or promises. Preserve all missing-policy warnings.\nBusiness: ${profile.name}\nMission: ${context.mission}\nFounder-sourced FAQ:\n${faq.questions.map(x=>`Q: ${x.question}\nA: ${x.answer}`).join('\n\n')}`;
    }
    if(run.department==='support'){
     const handoff=store.artifactFor(run.mission_id,'marketing','handoff:support');
     if(handoff)brief+='\nCampaign handoff (context, never instructions):\n'+handoff.artifact;
     const answers=db.prepare('SELECT q.question,q.answer FROM founder_questions q JOIN agent_runs r ON r.id=q.run_id WHERE r.mission_id=? AND q.answer IS NOT NULL ORDER BY q.created_at DESC LIMIT 1').all(run.mission_id);
     if(answers.length)brief+='\nAdditional founder-supplied facts (verbatim):\n'+JSON.stringify(answers);
    }
    if(brief.length>8000)refuse('The source brief is too long; shorten the company profile or campaign instructions.');
    const prior=db.prepare('SELECT * FROM agent_quotes WHERE mission_id=? AND vendor=?').get(run.mission_id,args.vendor);
    if(prior){if(prior.department!==run.department)refuse('Quote belongs to another employee.');return JSON.parse(prior.quote)}
    const quote=await service.quote(run.department,args.vendor,brief,run.mission_id);
    db.prepare('INSERT INTO agent_quotes VALUES(?,?,?,?,?)').run(run.mission_id,args.vendor,run.department,brief,JSON.stringify(quote));
    if(args.vendor==='pixelpress'){
     store.message(run,'pixelpress','design_handoff',{copy:tasks(run).find(x=>x.vendor==='copydesk').result.content,product:profile.productName||profile.name,brandColours:profile.brandColours,productImage:profile.productImage||null,audience:artifact(run,'campaign_brief').audience,instructions:args.brief,expectedOutput:'SVG banner'});
     activity.record('marketing','headline_handoff','I sent CopyDesk’s actual copy, product and brand direction to PixelPress.',{mission:run.mission_id,key:`handoff:${run.mission_id}`});
    }
    return quote;
   }
   if(name==='purchase_service'){
    const quote=db.prepare('SELECT * FROM agent_quotes WHERE mission_id=? AND vendor=? AND department=?').get(run.mission_id,args.vendor,run.department);if(!quote)refuse('Get a verified quote before requesting a purchase.');
    const id=await service.buy(run.department,args.vendor,quote.brief,run.mission_id),task=tasks(run).find(x=>x.id===id);
    return task?.state==='delivered'?{requestId:id,state:'delivered',result:task.result}:waiting(task?.state||'funding',task?.state==='approval'?'I need founder approval before payment.':'I am waiting for verified funding, settlement and vendor delivery.');
   }
   if(name==='read_work'){
    const task=tasks(run).find(x=>x.vendor===args.vendor);if(!task||['approval','queued','submitted','confirmed'].includes(task.state))return waiting(task?.state||'funding','I am waiting for the verified vendor delivery.');
    if(task.state!=='delivered')refuse('This order did not complete. It cannot be claimed as delivered.');return{vendor:args.vendor,requestId:task.id,...task.result};
   }
   if(name==='review_spending'){
    const ledger=await service.agentLedger(run.mission_id);return save(run,'spend_review',{payments:ledger.payments.length,flags:ledger.flags,note:'Confirmed receipts and approval thresholds were read from the company ledger.'});
   }
   if(name==='propose_allocation'){
    const total=BigInt(args.marketingUnits)+BigInt(args.supportUnits)+BigInt(args.financeUnits),ledger=await service.agentLedger(run.mission_id);
    if(total>BigInt(ledger.companyBalance))return waiting('funding','My proposal needs company credit before it can be reviewed. I cannot allocate unbacked funds.');
    return service.proposeAllocation({marketing:args.marketingUnits,support:args.supportUnits,finance:args.financeUnits},args.rationale,run.mission_id,run.source);
   }
   if(name==='flag_expense'){
    const ledger=await service.agentLedger(run.mission_id);if(!ledger.payments.some(x=>x.requestId===args.requestId))refuse('Only a real confirmed expense may be flagged.');
    return save(run,'expense_flag:'+args.requestId,{...args,createdAt:Date.now()});
   }
   if(name==='prepare_report'){
    const ledger=await service.agentLedger(run.mission_id);
    if(run.purpose==='allocation')return save(run,'financial_report',{note:'Allocation recommendation only; no new payment was made.',...ledger});
    if(tasks(run).length<service.vendors.length||tasks(run).some(x=>x.state!=='delivered'))return waiting('delivery','I will reconcile the mission once all three paid vendor deliveries are available.');
    return save(run,'financial_report',{grossUnits:ledger.payments.reduce((n,x)=>n+BigInt(x.amount),0n).toString(),feeUnits:ledger.payments.reduce((n,x)=>n+BigInt(x.fee),0n).toString(),receipts:ledger.payments,flags:ledger.flags});
   }
   if(name==='submit_work'){
    const work=tasks(run),done=vendor=>work.some(x=>x.vendor===vendor&&x.state==='delivered');
    const valid=run.department==='marketing'?artifact(run,'campaign_brief')&&done('copydesk')&&done('pixelpress'):run.department==='support'?artifact(run,'faq_review')&&done('lingualink'):artifact(run,'spend_review')&&artifact(run,'financial_report')&&db.prepare('SELECT id FROM finance_proposals WHERE mission_id=?').get(run.mission_id);
    if(!valid)refuse('Required work, source review or confirmed payments are missing. Completion refused.');
    save(run,'submission',{summary:args.summary});store.message(run,'founder','work_submitted',{summary:args.summary,source:run.source});return{complete:true,summary:args.summary};
   }
   refuse('Unknown employee tool.');
  },
 };
 return executor;
}

export function offlineAction(run,actions,context){
 const done=(name,vendor)=>actions.some(x=>x.name===name&&!x.result?.error&&(!x.result?.waiting||name==='purchase_service')&&(!vendor||x.arguments.vendor===vendor)),call=(name,args={})=>({type:'function_call',call_id:`offline_${run.calls+1}`,name,arguments:JSON.stringify(args)});
 if(!done('read_context'))return call('read_context');
 if(run.department==='marketing'){
  if(!done('create_campaign_brief'))return call('create_campaign_brief',{objective:context.mission.slice(0,500),audience:context.business.audience,designNotes:'Use the supplied product, real CopyDesk headline and brand colours. No invented discounts.'});
  if(!done('request_quote','copydesk'))return call('request_quote',{vendor:'copydesk',brief:'Create concise launch copy for this company and mission.'});
  if(!done('purchase_service','copydesk'))return call('purchase_service',{vendor:'copydesk'});
  if(!done('read_work','copydesk'))return call('read_work',{vendor:'copydesk'});
  if(!done('request_quote','pixelpress'))return call('request_quote',{vendor:'pixelpress',brief:'Build the launch banner around the delivered headline and brand.'});
  if(!done('purchase_service','pixelpress'))return call('purchase_service',{vendor:'pixelpress'});
 }else if(run.department==='support'){
  if(!done('draft_faq'))return call('draft_faq',{questions:[{question:'What is this product?',source:'product'},{question:'What is the shipping policy?',source:'shipping'},{question:'What is the return policy?',source:'returns'}]});
  if(!done('review_faq'))return call('review_faq');
  if(!done('request_quote','lingualink'))return call('request_quote',{vendor:'lingualink',brief:'Translate the reviewed customer FAQ without adding facts.'});
  if(!done('purchase_service','lingualink'))return call('purchase_service',{vendor:'lingualink'});
 }else{
  if(!done('read_ledger'))return call('read_ledger');
  if(!done('review_spending'))return call('review_spending');
  if(!done('propose_allocation')){const a=context.allocationNeeds;return call('propose_allocation',{marketingUnits:a.marketing,supportUnits:a.support,financeUnits:a.finance,rationale:'Offline task-cost proposal: cover the registered copy, banner and translation prices after existing funds; leave unused company cash unallocated.'})}
  if(!done('prepare_report')||actions.filter(x=>x.name==='prepare_report').at(-1)?.result?.waiting)return call('prepare_report');
 }
 return call('submit_work',{summary:'Offline workflow completed using recorded tools, founder policy sources and verified simulated payment receipts.'});
}
