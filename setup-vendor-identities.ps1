$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
Write-Host 'Stop the company, employee manager and all other Sepolia signers first.'
Write-Host 'Sepolia only: fund three existing vendor wallets and the isolated founder-review wallet with 0.001 test ETH each (0.004 total). Each vendor registers its own ERC-8004 identity and metadata. Saved journals resume without duplicate transfers. Per-transaction fee caps: owner 0.005 test ETH; vendors 0.0005 test ETH.'
$previousOrigin=$env:APP_ORIGIN;$previousPassword=$env:OWNER_PASSWORD
try {
 $env:APP_ORIGIN=(Read-Host 'Existing public HTTPS origin (no trailing slash)').Trim()
 if((Read-Host 'Apply this fixed vendor identity policy? Type yes') -cne 'yes'){return}
 $secret=Read-Host 'Original owner keystore password (local only)' -AsSecureString
 $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
 try{$env:OWNER_PASSWORD=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer);$secret.Dispose()}
 node ens/scripts/vendor-identities.js
 if($LASTEXITCODE -ne 0){throw 'Setup paused. Preserve journals and rerun after inspecting the error.'}
}finally{$env:APP_ORIGIN=$previousOrigin;$env:OWNER_PASSWORD=$previousPassword}
