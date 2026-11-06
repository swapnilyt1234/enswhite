param([string]$CompanyDataDir='data/company/testnet')
$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
$config=Get-Content -LiteralPath "$CompanyDataDir/setup.json" -Raw | ConvertFrom-Json
$deployment=Get-Content -LiteralPath "$CompanyDataDir/deployment.json" -Raw | ConvertFrom-Json
Write-Host 'Automatic fee-funded gas replenishment on Whitechain Sepolia (1874).'
Write-Host "Company: $($deployment.address). Native WBT recipient: $($config.roles.relayer.address)."
Write-Host 'When the relayer falls below 0.05 WBT: withdraw earned company fees, approve only the swap amount, swap at most 10 test USDT per cycle on YetiTrade, and deliver native WBT to the relayer.'
Write-Host 'Swaps use 0.5% slippage and a 2-minute deadline. Small/uneconomic fee pools remain untouched. Owner wallet pays execution gas.'
Write-Host 'The deployed contract requires its OWNER to withdraw fees. This dedicated process unlocks that owner wallet; do not run other owner signing commands concurrently.'
Write-Host 'Keep the existing company server running. No relayer/department key or Razorpay secret is needed here.'
if((Read-Host 'Start this automatic signing policy? Type yes') -cne 'yes'){return}
$previous=[Environment]::GetEnvironmentVariable('OWNER_PASSWORD')
$previousDirectory=[Environment]::GetEnvironmentVariable('COMPANY_DATA_DIR')
$secret=Read-Host 'Original whitechain-testnet OWNER keystore password (not the EnsWhite role-wallet password)' -AsSecureString
$pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try{
    $env:OWNER_PASSWORD=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $env:COMPANY_DATA_DIR=Join-Path $PSScriptRoot $CompanyDataDir
    node app/gas-replenisher.js
    if($LASTEXITCODE -ne 0){throw 'Gas watcher stopped with an error. Check deployment, password and saved journal; do not delete pending transactions.'}
}finally{
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer);$secret.Dispose()
    [Environment]::SetEnvironmentVariable('OWNER_PASSWORD',$previous,'Process')
    [Environment]::SetEnvironmentVariable('COMPANY_DATA_DIR',$previousDirectory,'Process')
}
