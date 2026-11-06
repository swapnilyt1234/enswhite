param([Parameter(Mandatory=$true)][string]$CompanyAddress,[Parameter(Mandatory=$true)][long]$DeploymentBlock)
$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
if($CompanyAddress -notmatch '^0x[a-fA-F0-9]{40}$' -or $DeploymentBlock -lt 1){throw 'Invalid company address or deployment block'}
$config=Get-Content -LiteralPath 'data/company/testnet/setup.json' -Raw | ConvertFrom-Json
foreach($item in @($config.departments)+@($config.vendors)) { if($item.address -notmatch '^0x[a-fA-F0-9]{40}$'){throw 'Invalid setup address'} }
$rpc='https://rpc.testnet.whitechain.io'
if((cast chain-id --rpc-url $rpc).Trim() -ne '1874'){throw 'Wrong chain'}
Write-Host "Configure $CompanyAddress on Whitechain Sepolia: Finance, 3 department limits and 3 vendor prices."
Write-Host 'The owner account whitechain-testnet pays the setup gas. Password entry stays in your terminal.'
if((Read-Host 'Submit these seven configuration transactions? Type yes') -cne 'yes'){return}
$finance=($config.departments | Where-Object id -eq 'finance').address
cast send $CompanyAddress 'setFinance(address)' $finance --account whitechain-testnet --rpc-url $rpc
if($LASTEXITCODE -ne 0){throw 'Finance configuration failed'}
foreach($dept in $config.departments) {
    cast send $CompanyAddress 'setLimits(address,uint256,uint256)' $dept.address $dept.perCall $dept.perDay --account whitechain-testnet --rpc-url $rpc
    if($LASTEXITCODE -ne 0){throw 'Department configuration failed'}
}
foreach($vendor in $config.vendors) {
    cast send $CompanyAddress 'registerVendor(address,uint256)' $vendor.address $vendor.price --account whitechain-testnet --rpc-url $rpc
    if($LASTEXITCODE -ne 0){throw 'Vendor configuration failed'}
}
node app/company-setup.js deployment $CompanyAddress $DeploymentBlock
Write-Host 'Owner configuration complete. Prefund the pool with test USDT before starting company top-ups.'
