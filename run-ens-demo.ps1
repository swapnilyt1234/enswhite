param([string]$DemoId=('demo-'+(Get-Date -Format 'yyyyMMdd-HHmmss')))
$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
if($DemoId -cnotmatch '^[a-z0-9-]{8,40}$'){throw 'Use a lowercase demo ID, 8-40 characters'}
Write-Host "Demo ID: $DemoId. Keep this ID to resume if interrupted."
Write-Host 'Sepolia only: register a demo company namespace; fire Support; rehire it for 5 minutes; wait for expiry; restore it for 30 days.'
Write-Host 'Checks simulate rejected transfer, unauthorized Finance edit, spoofed payee and Whitechain expiry. No vendor payment or token transfer is broadcast by this script.'
Write-Host 'Maximum execution fee 0.005 test ETH per owner transaction; calls capped at 8 million gas. Company server may stay running; avoid Support missions during this demo.'
Write-Host 'If interrupted, resume this SAME DemoId to restore Support. No other owner signing commands should run concurrently on Sepolia.'
if((Read-Host 'Run these live lifecycle transactions? Type yes') -cne 'yes'){return}
$previous=[Environment]::GetEnvironmentVariable('OWNER_PASSWORD')
$secret=Read-Host 'Original owner keystore password (local only)' -AsSecureString
$pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try{
 $env:OWNER_PASSWORD=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
 node ens/scripts/demo.js $DemoId
 if($LASTEXITCODE -ne 0){throw "Demo paused. Resume with .\run-ens-demo.ps1 -DemoId $DemoId; saved transactions are retained."}
}finally{
 [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer);$secret.Dispose()
 [Environment]::SetEnvironmentVariable('OWNER_PASSWORD',$previous,'Process')
}
