$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
forge build -q
if($LASTEXITCODE -ne 0){throw 'Whitechain contracts did not build'}
node app/prepare-ens-company.js
if($LASTEXITCODE -ne 0){throw 'ENS company preparation failed'}
Write-Host 'Run the printed deployment command in your own terminal. Stop the gas watcher before using the owner wallet on Whitechain.'
Write-Host 'Then run configure-enswhite-company.ps1 with the NEW contract address and deployment block.'
