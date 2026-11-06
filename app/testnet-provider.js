import {FetchRequest,JsonRpcProvider} from 'ethers';

export function createTestnetProvider(url,chain,request=fetch){
 if(new URL(url).protocol!=='https:'||![11155111,1874].includes(chain))throw new Error('Expected an HTTPS testnet RPC');
 const rpc=new FetchRequest(url);rpc.timeout=10000;
 // Abort timed-out sockets as well as the promise; stale requests must not accumulate in the signing worker.
 rpc.getUrlFunc=async(req,cancel)=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),req.timeout);
  cancel?.addListener(()=>controller.abort());
  try{
   const response=await request(req.url,{method:req.method,headers:req.headers,body:req.body,signal:controller.signal});
   return{statusCode:response.status,statusMessage:response.statusText,headers:Object.fromEntries(response.headers),body:new Uint8Array(await response.arrayBuffer())};
  }catch(error){throw Object.assign(new Error(controller.signal.aborted?'RPC request cancelled or timed out':'RPC transport unavailable'),{code:cancel?.cancelled?'CANCELLED':controller.signal.aborted?'TIMEOUT':'NETWORK_ERROR'})}
  finally{clearTimeout(timer)}
 };
 return new JsonRpcProvider(rpc,chain,{cacheTimeout:0});
}
