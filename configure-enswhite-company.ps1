param([Parameter(Mandatory=$true)][string]$CompanyAddress,[Parameter(Mandatory=$true)][long]$DeploymentBlock)
$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
$previous=[Environment]::GetEnvironmentVariable('COMPANY_DATA_DIR')
try{
 $env:COMPANY_DATA_DIR=Join-Path $PSScriptRoot 'data/company/ens-testnet'
 & ./configure-company.ps1 -CompanyAddress $CompanyAddress -DeploymentBlock $DeploymentBlock
}finally{[Environment]::SetEnvironmentVariable('COMPANY_DATA_DIR',$previous,'Process')}
