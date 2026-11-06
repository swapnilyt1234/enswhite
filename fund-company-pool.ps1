$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
$config=Get-Content -LiteralPath 'data/company/testnet/setup.json' -Raw | ConvertFrom-Json
$deployment=Get-Content -LiteralPath 'data/company/testnet/deployment.json' -Raw | ConvertFrom-Json
Write-Host "Prefund RelayCompany $($deployment.address) with 10 test USDT from treasury $($config.roles.treasury.address)."
Write-Host 'Treasury signs an EIP-3009 transfer; the separate relayer pays WBT gas. The transaction is saved before broadcast.'
if((Read-Host 'Sign and submit this pool funding? Type yes') -cne 'yes'){return}
$names=@('TREASURY_PASSWORD','RELAYER_PASSWORD');$previous=@{}
try{
    foreach($name in $names){
        $previous[$name]=[Environment]::GetEnvironmentVariable($name)
        $secret=Read-Host "Encrypted $name keystore password" -AsSecureString
        $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
        try{[Environment]::SetEnvironmentVariable($name,[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer),'Process')}
        finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer);$secret.Dispose()}
    }
    node app/company-setup.js fund
    if($LASTEXITCODE -ne 0){throw 'Pool funding was not confirmed. Do not create another transfer without inspecting the saved transaction.'}
}finally{foreach($name in $names){[Environment]::SetEnvironmentVariable($name,$previous[$name],'Process')}}
