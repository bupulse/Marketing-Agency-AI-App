# Updates bupulse.com on the home Windows PC to the latest code on GitHub (docs/SELF_HOST.md). Run it from an
# administrator PowerShell:  powershell -ExecutionPolicy Bypass -File D:\BuPulse\scripts\self-host\windows\update.ps1
#
# Stop-ScheduledTask ends only server.mjs: the `next start` it launched keeps running and holding port 3002, so the
# restarted task cannot listen and the old version stays live (6 November 2026). This script also stops the process
# listening on port 3002, by its exact process ID, before building and starting again.
$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
Set-Location $repo

Write-Host "1/4 Downloading the new code"
git pull --ff-only
if ($LASTEXITCODE -ne 0) { throw "git pull failed: nothing was changed, the site still runs the old version" }

Write-Host "2/4 Stopping the website (down for a few minutes)"
Stop-ScheduledTask -TaskName "BuPulse server"
$listener = Get-NetTCPConnection -LocalPort 3002 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($id in $listener) { Stop-Process -Id $id -Force }
Start-Sleep -Seconds 3

Write-Host "3/4 Building the new version (several minutes)"
node scripts\self-host\windows\server.mjs build
$built = $LASTEXITCODE -eq 0

Write-Host "4/4 Starting the website"
Start-ScheduledTask -TaskName "BuPulse server"
if (-not $built) { throw "the build failed (see the messages above): send them to Claude" }
foreach ($i in 1..30) {
  Start-Sleep -Seconds 4
  try {
    if ((Invoke-RestMethod -Uri "http://127.0.0.1:3002/api/status" -TimeoutSec 5).status -eq "ok") { Write-Host "Done: bupulse.com runs $(git log --oneline -1)"; exit 0 }
  } catch { }
}
throw "the website did not answer within 2 minutes: check $env:USERPROFILE\bupulse-prod\server.log"
