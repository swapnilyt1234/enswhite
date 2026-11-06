$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
Write-Host 'Private real-company launcher: Sepolia ENSv2 names/hires/ERC-8004/ENSIP-25/26 and a separate Whitechain payment contract for each visitor.'
Write-Host 'Policy: at most two new companies per UTC day; 0.02 test Sepolia ETH, 0.1 WBT and 10 test USDT total daily spending reservations. Each company receives at most 5 test USDT in its uncredited pool, 0.02 WBT in its own relayer and 0.001 Sepolia ETH per hired department/reviewer. Fees count toward daily native budgets.'
Write-Host 'Whitechain deployment maximum execution fee: 0.03 WBT; other Whitechain calls: 0.02 WBT each. All calls and gas funding still share the 0.1 WBT daily total.'
Write-Host 'The founder still pays through Razorpay TEST checkout before the contract credits a budget. A visitor can create and switch between isolated companies; the shared daily operator budget limits all launches, including new cookies.'
Write-Host 'Stop the employee manager and every other OWNER signer on both chains. Keep the company server and public gateway running. This worker receives no Razorpay or model secrets.'
$previousPassword=$env:OWNER_PASSWORD;$previousOrigin=$env:APP_ORIGIN
try{
 $env:APP_ORIGIN=(Read-Host 'Existing public HTTPS origin (no trailing slash)').Trim()
 if((Read-Host 'Start this bounded automatic launch policy? Type yes') -cne 'yes'){return}
 $secret=Read-Host 'Original owner keystore password (local only)' -AsSecureString;$pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
 try{$env:OWNER_PASSWORD=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer);$secret.Dispose()}
 node app/launch-worker.js
 if($LASTEXITCODE -ne 0){throw 'Launch operator paused. Preserve data/launch and all signed journals.'}
}finally{$env:OWNER_PASSWORD=$previousPassword;$env:APP_ORIGIN=$previousOrigin}
