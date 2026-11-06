$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
Write-Host 'Private employee manager: Sepolia only, existing acme.enswhite.eth controller and three fixed department wallets.'
Write-Host 'Founder Hire, Fire and Renew requests are queued by the authenticated app. No browser wallet, key, USDT or WBT is required from the founder.'
Write-Host 'Policy: only hire/fire/renew; five-minute demo or 30-day terms; existing approved vendors, at most 50 test USDT weekly and fixed per-call limits.'
Write-Host 'At most six signed calls per rolling day, eight million gas and 0.005 test ETH maximum fee per call. The owner funds Sepolia service gas.'
Write-Host 'Signed transactions are saved before broadcast. Pending/unknown transactions are never replaced. One employee manager may run at a time.'
Write-Host 'This worker alone unlocks the original owner. The company server, vendors and AI models receive no owner password. Do not run other OWNER signing commands on Sepolia concurrently.'
if((Read-Host 'Start this bounded employee-management signing policy? Type yes') -cne 'yes'){return}
$previousPassword=$env:OWNER_PASSWORD
$secret=Read-Host 'Original owner keystore password (local only)' -AsSecureString
$pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try{$env:OWNER_PASSWORD=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer);node app/employee-manager.js;if($LASTEXITCODE -ne 0){throw 'Employee manager stopped. Preserve its saved requests and inspect the error.'}}
finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer);$secret.Dispose();$env:OWNER_PASSWORD=$previousPassword}
