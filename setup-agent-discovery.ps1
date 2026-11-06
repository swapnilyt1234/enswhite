$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
Write-Host 'Sepolia discovery migration: stop the company server first. No mainnet or Whitechain token transfer.'
Write-Host 'Prepare a replacement company registry/controller; keep employee names, wallets, spending policies and remaining terms; attach it only after all three identities are ready.'
Write-Host 'Each department registers its own ERC-8004 identity and metadata. The founder publishes ENSIP-25 consent and ENSIP-26 context/web records. No MCP/A2A service is advertised.'
Write-Host 'Existing public URI stays fixed. Owner transactions: at most 0.005 test ETH each; department transactions at most 0.0005 test ETH each. Department wallets need Sepolia ETH.'
Write-Host 'Controller deployment: at most 20 million total gas, including state creation. Other transactions remain capped at 8 million gas. ETH fee caps are unchanged.'
Write-Host 'Record calls include 20% gas headroom within those caps. Confirmed reverted discovery edits may be re-estimated twice; original journals remain intact. Pending or unknown transactions are never replaced.'
Write-Host 'Resume this same script after interruptions. Signed journals stay private under data/ens/agent-discovery-v1. Do not run other owner or department Sepolia signers concurrently.'
forge build --root ens -q
if($LASTEXITCODE -ne 0){throw 'ENS discovery contracts did not build'}
$origin=(Read-Host 'Existing public HTTPS origin (no trailing slash)').Trim()
if((Read-Host 'Apply this discovery policy and directory migration? Type yes') -cne 'yes'){return}
$oldPassword=$env:OWNER_PASSWORD;$oldOrigin=$env:AGENT_PUBLIC_ORIGIN
$secret=Read-Host 'Original owner keystore password (local only)' -AsSecureString
$pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try{$env:OWNER_PASSWORD=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer);$env:AGENT_PUBLIC_ORIGIN=$origin;node ens/scripts/agent-discovery.js;if($LASTEXITCODE -ne 0){throw 'Discovery setup paused. Keep the company stopped and resume the same script after inspecting the error.'}}
finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer);$secret.Dispose();$env:OWNER_PASSWORD=$oldPassword;$env:AGENT_PUBLIC_ORIGIN=$oldOrigin}
