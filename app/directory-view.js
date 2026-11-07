// Display cache only: signing and policy checks continue to resolve ENS directly.
export function createDirectoryView(directory){
 let view={organization:[],branding:null,status:directory?'loading':'disabled',checkedAt:null},pending,lastAttempt=0;
 return()=>{
  if(directory&&!pending&&Date.now()-lastAttempt>=60000){
   lastAttempt=Date.now();view={...view,status:view.checkedAt?'refreshing':'loading'};
   pending=Promise.all([
    Promise.resolve().then(()=>directory.organization()),
    Promise.resolve().then(()=>directory.branding()).catch(()=>null),
   ]).then(([organization,branding])=>{view={organization,branding,status:'ready',checkedAt:Date.now()}})
    .catch(()=>{view={...view,status:'unavailable'}}).finally(()=>{pending=null});
  }
  return view;
 };
}
