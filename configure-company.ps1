param([Parameter(Mandatory=$true)][string]$CompanyAddress,[Parameter(Mandatory=$true)][long]$DeploymentBlock)
$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
if($CompanyAddress -notmatch '^0x[a-fA-F0-9]{40}$' -or $DeploymentBlock -lt 1){throw 'Invalid company address or deployment block'}
Write-Host "Configure $CompanyAddress on Whitechain Sepolia: Finance, 3 department limits and 3 vendor prices."
Write-Host 'Already applied settings will be skipped. Unlock the owner keystore once; the remaining transactions run sequentially.'
if((Read-Host 'Submit only the remaining configuration transactions? Type yes') -cne 'yes'){return}
$previous=[Environment]::GetEnvironmentVariable('OWNER_PASSWORD')
$secret=Read-Host 'Encrypted whitechain-testnet OWNER keystore password (once)' -AsSecureString
$pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try{
    $env:OWNER_PASSWORD=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    node app/company-setup.js configure $CompanyAddress $DeploymentBlock
    if($LASTEXITCODE -ne 0){throw 'Owner configuration paused. Completed settings are preserved; rerunning skips them.'}
}finally{
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer);$secret.Dispose()
    [Environment]::SetEnvironmentVariable('OWNER_PASSWORD',$previous,'Process')
}
