$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
Write-Host 'Public guest sandbox and keyless Live Proof. Keep the existing company server on port 3004.'
Write-Host 'Forward your existing public HTTPS origin to port 3006. Razorpay webhook keeps the same URL.'
Write-Host 'Guests receive isolated simulated wallets, offline content and at most five missions. Founder access moves to /owner/.'
$publicOrigin=(Read-Host 'Existing public HTTPS origin (no trailing slash)').Trim()
node app/run-judge.js $publicOrigin
if($LASTEXITCODE -ne 0){throw 'Public judge server stopped with an error.'}
