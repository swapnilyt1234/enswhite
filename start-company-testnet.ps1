$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
$companyDirectory='data/company/testnet'
if((Test-Path 'data/ens/runtime.json') -and (Test-Path 'data/company/ens-testnet/deployment.json')){$companyDirectory='data/company/ens-testnet'}
$config=Get-Content -LiteralPath "$companyDirectory/setup.json" -Raw | ConvertFrom-Json
$deployment=Get-Content -LiteralPath "$companyDirectory/deployment.json" -Raw | ConvertFrom-Json
$names=@('CHAIN_MODE','PAYMENT_MODE','PORT','APP_ORIGIN','COMPANY_DATA_DIR','VENDOR_DATA_DIR','RELAY_COMPANY_ADDRESS','COMPANY_DEPLOYMENT_BLOCK','TREASURY_ADDRESS','RELAYER_KEYSTORE','RELAYER_PASSWORD','ATTESTER_KEYSTORE','ATTESTER_PASSWORD','FOUNDER_PASSWORD','RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','RAZORPAY_WEBHOOK_SECRET','ENS_ENABLED','ENS_PARENT_NAME','ENS_COMPANY_NAME','ENS_COMPANY_REGISTRY','ENS_REGISTRY_BLOCK','ENS_NAMES_ADDRESS','SEPOLIA_RPC_URL')
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
    $env:COMPANY_DATA_DIR=Join-Path $PSScriptRoot $companyDirectory;$env:VENDOR_DATA_DIR=Join-Path $PSScriptRoot 'data/vendors/testnet'
    $env:ENS_ENABLED='false'
    if($companyDirectory -eq 'data/company/ens-testnet'){
        $ens=Get-Content -LiteralPath 'data/ens/runtime.json' -Raw | ConvertFrom-Json
        foreach($key in @('ENS_ENABLED','ENS_PARENT_NAME','ENS_COMPANY_NAME','ENS_COMPANY_REGISTRY','ENS_REGISTRY_BLOCK','ENS_NAMES_ADDRESS','SEPOLIA_RPC_URL')){[Environment]::SetEnvironmentVariable($key,[string]$ens.$key,'Process')}
        Write-Host "ENSv2 policy mode: $($ens.ENS_COMPANY_NAME). All vendor payments require fresh Sepolia resolution."
        Write-Host 'Employees automatically sign their own ENS status updates. Finance signs founder-requested and purchase-shortfall weekly-budget edits up to 50 test USDT, allocating only available company credit; hard daily, per-call and founder approval limits remain. All ENS writes share a saved sequential queue: at most 48 per UTC day, 1 million gas and 0.0001 Sepolia ETH execution fee per edit.'
        Write-Host 'Keep department Sepolia ETH funded. Do not run finance-budget.js or other department signing tools while this server is running.'
    }
    $env:RELAY_COMPANY_ADDRESS=$deployment.address;$env:COMPANY_DEPLOYMENT_BLOCK=[string]$deployment.block
    $env:TREASURY_ADDRESS=$config.roles.treasury.address;$env:RELAYER_KEYSTORE=$config.roles.relayer.keystore;$env:ATTESTER_KEYSTORE=$config.roles.attester.keystore
    $env:APP_ORIGIN=(Read-Host 'Public HTTPS company app origin forwarded to port 3004 (no trailing slash)').Trim()
    $uri=[Uri]$env:APP_ORIGIN
    if($uri.Scheme -ne 'https' -or $uri.AbsolutePath -ne '/' -or $uri.Query -or $uri.Fragment -or $env:APP_ORIGIN.EndsWith('/')){throw 'Invalid HTTPS origin'}
    if(-not $env:RAZORPAY_KEY_ID){$env:RAZORPAY_KEY_ID=Read-Host 'Razorpay TEST key ID'}
    Read-CompanySecret 'RAZORPAY_KEY_SECRET' 'Razorpay TEST key secret'
    Read-CompanySecret 'RAZORPAY_WEBHOOK_SECRET' 'Razorpay webhook secret'
    Read-CompanySecret 'RELAYER_PASSWORD' 'NEW 12+ character EnsWhite role-wallet password chosen in prepare-company.ps1 (not the original owner password)'
    $env:ATTESTER_PASSWORD=$env:RELAYER_PASSWORD
    Read-CompanySecret 'FOUNDER_PASSWORD' 'Choose a founder sign-in password (at least 12 characters)'
    Write-Host 'Policy: each verified INR 500 test payment credits 5 test USDT from the prefunded contract.'
    Write-Host 'Finance proposes task-based allocations for founder approval within weekly caps. Allowlisted vendor tasks cost 0.1/0.2/0.1 USDT; 1% stays as fees.'
    Write-Host 'Above-threshold tasks require a founder approval. The WBT-only relayer pays gas. Attester signs captured-payment confirmations.'
    Write-Host "Webhook: $env:APP_ORIGIN/api/webhooks/razorpay. Keep payment.captured active."
    if((Read-Host 'Start automatic signing under these limits? Type yes') -cne 'yes'){return}
    node --env-file-if-exists=.env.company app/run-company.js
} finally {foreach($name in $names){[Environment]::SetEnvironmentVariable($name,$previous[$name],'Process')}}
