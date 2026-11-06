import { getAddress } from 'ethers';

export async function pendingConfiguration(contract, config) {
  const plan = [];
  const finance = getAddress(config.departments.find(dept=>dept.id==='finance').address);
  if(getAddress(await contract.finance())!==finance) plan.push({label:'Finance',method:'setFinance',args:[finance]});
  for(const dept of config.departments){
    const address=getAddress(dept.address), limits=await contract.limits(address);
    if(limits.perCall!==BigInt(dept.perCall)||limits.perDay!==BigInt(dept.perDay)) plan.push({label:dept.name+' limits',method:'setLimits',args:[address,dept.perCall,dept.perDay]});
  }
  for(const vendor of config.vendors){
    const address=getAddress(vendor.address);
    if(await contract.vendorMaxPrice(address)!==BigInt(vendor.price)) plan.push({label:vendor.name+' price',method:'registerVendor',args:[address,vendor.price]});
  }
  return plan;
}
