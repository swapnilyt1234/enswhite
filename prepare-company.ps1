$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
$previous=[Environment]::GetEnvironmentVariable('SETUP_KEYSTORE_PASSWORD')
$secret=Read-Host 'Password for the three separate Relay keystores (at least 12 characters)' -AsSecureString
$pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
    $env:SETUP_KEYSTORE_PASSWORD=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    node app/company-setup.js prepare
    if($LASTEXITCODE -ne 0){throw 'Role setup failed; existing keystores were not overwritten'}
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $secret.Dispose()
    [Environment]::SetEnvironmentVariable('SETUP_KEYSTORE_PASSWORD',$previous,'Process')
}
$config=Get-Content -LiteralPath 'data/company/testnet/setup.json' -Raw | ConvertFrom-Json
Write-Host "`nDeploy from your existing business wallet with:"
Write-Host "forge create src/RelayCompany.sol:RelayCompany --rpc-url https://rpc.testnet.whitechain.io --chain 1874 --account whitechain-testnet --broadcast --verify --verifier blockscout --verifier-url https://explorer.testnet.whitechain.io/api/ --constructor-args 0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7 $($config.roles.attester.address) 100"
Write-Host "`nFund the NEW relayer with test WBT and the NEW treasury with test USDT. The attester stays empty."
Write-Host "Relayer: $($config.roles.relayer.address)"
Write-Host "Treasury: $($config.roles.treasury.address)"
Write-Host "`nRun these funding commands in your terminal (your existing business wallet pays):"
Write-Host "cast send $($config.roles.relayer.address) --value 0.2ether --account whitechain-testnet --rpc-url https://rpc.testnet.whitechain.io"
Write-Host "cast send 0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7 'transfer(address,uint256)' $($config.roles.treasury.address) 10000000 --account whitechain-testnet --rpc-url https://rpc.testnet.whitechain.io"
