param([string]$CompanyDataDir='data/company/testnet')
$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
$config=Get-Content -LiteralPath "$CompanyDataDir/setup.json" -Raw | ConvertFrom-Json
$deployment=Get-Content -LiteralPath "$CompanyDataDir/deployment.json" -Raw | ConvertFrom-Json
Write-Host "Prefund EnsWhite company $($deployment.address) with 10 test USDT from treasury $($config.roles.treasury.address)."
Write-Host 'Treasury signs an EIP-3009 transfer; the separate relayer pays WBT gas. The transaction is saved before broadcast.'
if((Read-Host 'Sign and submit this pool funding? Type yes') -cne 'yes'){return}
$names=@('TREASURY_PASSWORD','RELAYER_PASSWORD','COMPANY_DATA_DIR');$previous=@{}
foreach($name in $names){$previous[$name]=[Environment]::GetEnvironmentVariable($name)}
$secret=Read-Host 'NEW EnsWhite role-wallet password from prepare-company.ps1 (12+ characters; NOT the original owner password)' -AsSecureString
$pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try{
    $password=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    foreach($name in @('TREASURY_PASSWORD','RELAYER_PASSWORD')){[Environment]::SetEnvironmentVariable($name,$password,'Process')}
    $env:COMPANY_DATA_DIR=Join-Path $PSScriptRoot $CompanyDataDir
    $password=$null
    node app/company-setup.js fund
    if($LASTEXITCODE -ne 0){throw 'Pool funding was not confirmed. Do not create another transfer without inspecting the saved transaction.'}
}finally{
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer);$secret.Dispose()
    foreach($name in $names){[Environment]::SetEnvironmentVariable($name,$previous[$name],'Process')}
}
