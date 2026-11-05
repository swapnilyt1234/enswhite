$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

# Secrets remain in this process environment and its Node child, never in arguments or files.
function Read-SecretEnvironment($Name, $Prompt) {
    if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($Name))) {
        $secret = Read-Host $Prompt -AsSecureString
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
        try {
            [Environment]::SetEnvironmentVariable($Name, [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer), 'Process')
        } finally {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
            $secret.Dispose()
        }
    }
}

$names = @('PAYMENT_MODE','CHAIN_MODE','DATA_DIR','PORT','APP_ORIGIN','RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','RAZORPAY_WEBHOOK_SECRET','RELAYER_KEYSTORE','TREASURY_KEYSTORE','RELAYER_PASSWORD','TREASURY_PASSWORD')
$previous = @{}
foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name) }
try {
    $env:PAYMENT_MODE = 'razorpay'
    $env:CHAIN_MODE = 'testnet'
    $env:DATA_DIR = Join-Path $PSScriptRoot 'data\testnet'
    $env:PORT = '3001'
    if (-not $env:APP_ORIGIN) { $env:APP_ORIGIN = (Read-Host 'Public HTTPS app origin for Razorpay webhooks (no trailing slash)') }
    $appUri = [Uri]$env:APP_ORIGIN
    if ($appUri.Scheme -ne 'https' -or $appUri.AbsolutePath -ne '/' -or $appUri.Query -or $appUri.Fragment -or $env:APP_ORIGIN.EndsWith('/')) {
        throw 'Use a public HTTPS origin such as https://your-demo.example, with no path or trailing slash'
    }
    if (-not $env:RAZORPAY_KEY_ID) { $env:RAZORPAY_KEY_ID = Read-Host 'Razorpay TEST key ID (rzp_test_...)' }
    if ($env:RAZORPAY_KEY_ID -notmatch '^rzp_test_') { throw 'Only Razorpay test-mode keys are allowed' }
    Read-SecretEnvironment 'RAZORPAY_KEY_SECRET' 'Razorpay TEST key secret'
    Read-SecretEnvironment 'RAZORPAY_WEBHOOK_SECRET' 'Razorpay webhook secret'
    if (-not $env:RELAYER_KEYSTORE) { $env:RELAYER_KEYSTORE = Join-Path $env:USERPROFILE '.foundry\keystores\whitechain-testnet' }
    if (-not $env:TREASURY_KEYSTORE) { $env:TREASURY_KEYSTORE = $env:RELAYER_KEYSTORE }
    Read-SecretEnvironment 'RELAYER_PASSWORD' 'Encrypted relayer keystore password'
    if ($env:TREASURY_KEYSTORE -eq $env:RELAYER_KEYSTORE) { $env:TREASURY_PASSWORD = $env:RELAYER_PASSWORD }
    else { Read-SecretEnvironment 'TREASURY_PASSWORD' 'Encrypted treasury keystore password' }
    Write-Host 'Whitechain Sepolia (1874). Real TEST USDT transfers; simulated fiat.'
    Write-Host 'One captured INR 100 sandbox payment funds exactly 1 test USDT. A report costs 0.1 test USDT.'
    Write-Host 'This server signs treasury funding and agent payments automatically within those budgets. Relayer pays WBT gas.'
    Write-Host "Forward your public HTTPS origin to http://127.0.0.1:3001. Webhook: $env:APP_ORIGIN/api/webhooks/razorpay"
    if ((Read-Host 'Start the testnet signer with this payment policy? Type yes') -cne 'yes') { return }
    node app/server.js
    if ($LASTEXITCODE -ne 0) { throw 'Testnet server failed to start; check the message above' }
} finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
}
