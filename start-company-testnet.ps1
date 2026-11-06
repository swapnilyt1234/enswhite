$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
$config=Get-Content -LiteralPath 'data/company/testnet/setup.json' -Raw | ConvertFrom-Json
$deployment=Get-Content -LiteralPath 'data/company/testnet/deployment.json' -Raw | ConvertFrom-Json
$names=@('CHAIN_MODE','PAYMENT_MODE','PORT','APP_ORIGIN','COMPANY_DATA_DIR','VENDOR_DATA_DIR','RELAY_COMPANY_ADDRESS','COMPANY_DEPLOYMENT_BLOCK','TREASURY_ADDRESS','RELAYER_KEYSTORE','RELAYER_PASSWORD','ATTESTER_KEYSTORE','ATTESTER_PASSWORD','FOUNDER_PASSWORD','RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','RAZORPAY_WEBHOOK_SECRET')
$previous=@{};foreach($name in $names){$previous[$name]=[Environment]::GetEnvironmentVariable($name)}
function Read-CompanySecret($Name,$Prompt){
    if([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($Name))){
        $secret=Read-Host $Prompt -AsSecureString;$pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
        try{[Environment]::SetEnvironmentVariable($Name,[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer),'Process')}
        finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer);$secret.Dispose()}
    }
}
try {
    $env:CHAIN_MODE='testnet';$env:PAYMENT_MODE='razorpay';$env:PORT='3004'
    $env:COMPANY_DATA_DIR=Join-Path $PSScriptRoot 'data/company/testnet';$env:VENDOR_DATA_DIR=Join-Path $PSScriptRoot 'data/vendors/testnet'
    $env:RELAY_COMPANY_ADDRESS=$deployment.address;$env:COMPANY_DEPLOYMENT_BLOCK=[string]$deployment.block
    $env:TREASURY_ADDRESS=$config.roles.treasury.address;$env:RELAYER_KEYSTORE=$config.roles.relayer.keystore;$env:ATTESTER_KEYSTORE=$config.roles.attester.keystore
    $env:APP_ORIGIN=Read-Host 'Public HTTPS company app origin forwarded to port 3004 (no trailing slash)'
    $uri=[Uri]$env:APP_ORIGIN
    if($uri.Scheme -ne 'https' -or $uri.AbsolutePath -ne '/' -or $uri.Query -or $uri.Fragment -or $env:APP_ORIGIN.EndsWith('/')){throw 'Invalid HTTPS origin'}
    if(-not $env:RAZORPAY_KEY_ID){$env:RAZORPAY_KEY_ID=Read-Host 'Razorpay TEST key ID'}
    Read-CompanySecret 'RAZORPAY_KEY_SECRET' 'Razorpay TEST key secret'
    Read-CompanySecret 'RAZORPAY_WEBHOOK_SECRET' 'Razorpay webhook secret'
    Read-CompanySecret 'RELAYER_PASSWORD' 'Encrypted Relay relayer keystore password'
    Read-CompanySecret 'ATTESTER_PASSWORD' 'Encrypted Relay attester keystore password'
    Read-CompanySecret 'FOUNDER_PASSWORD' 'Choose a founder sign-in password (at least 12 characters)'
    Write-Host 'Policy: each verified INR 500 test payment credits 5 test USDT from the prefunded contract.'
    Write-Host 'Finance allocates 60/30/10 within weekly caps. Allowlisted vendor tasks cost 0.1/0.2/0.1 USDT; 1% stays as fees.'
    Write-Host 'Above-threshold tasks require a founder approval. The WBT-only relayer pays gas. Attester signs captured-payment confirmations.'
    Write-Host "Webhook: $env:APP_ORIGIN/api/webhooks/razorpay. Keep payment.captured active."
    if((Read-Host 'Start automatic signing under these limits? Type yes') -cne 'yes'){return}
    node app/run-company.js
} finally {foreach($name in $names){[Environment]::SetEnvironmentVariable($name,$previous[$name],'Process')}}
