$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
Write-Host 'Sepolia ENSv2 only. Mainnet enswhite.eth is left untouched.'
Write-Host 'Register enswhite.eth separately at https://sepolia.app.ens.domains using your original owner wallet before continuing.'
forge build --root ens -q
if($LASTEXITCODE -ne 0){throw 'ENS contracts did not build'}
node --env-file-if-exists=.env.ens ens/scripts/bootstrap.js check
if($LASTEXITCODE -ne 0){throw 'ENS readiness check failed'}
Write-Host 'This deploys registries and registrars, attaches the Sepolia parent, hires the three departments, and permanently emancipates the vendor registry.'
Write-Host 'Per transaction: maximum 0.005 test ETH execution fee; deployments up to 20 million total gas, other calls up to 8 million gas.'
Write-Host 'Also installs the company branding resolver and sends 0.001 Sepolia ETH to each department that needs record-edit gas (at most 0.003 test ETH total). Completed steps are skipped.'
Write-Host 'The vendor registry emancipation removes our ability to revoke vendor identities. The parent namespace remains controlled by its parent owner.'
if((Read-Host 'Apply this Sepolia bootstrap? Type yes') -cne 'yes'){return}
$previous=[Environment]::GetEnvironmentVariable('OWNER_PASSWORD')
$secret=Read-Host 'Original whitechain-testnet keystore password (same owner address, Sepolia ETH gas)' -AsSecureString
$pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try{
 $env:OWNER_PASSWORD=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
 node --env-file-if-exists=.env.ens ens/scripts/bootstrap.js apply
 if($LASTEXITCODE -ne 0){throw 'ENS bootstrap paused. Completed transactions are journaled; inspect the error before rerunning.'}
}finally{
 [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer);$secret.Dispose()
 [Environment]::SetEnvironmentVariable('OWNER_PASSWORD',$previous,'Process')
}
