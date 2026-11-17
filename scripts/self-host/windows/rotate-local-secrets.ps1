# New values for this PC's own secrets (17 November 2026: malware ran on the PC, so every secret it could read is
# replaced). Re-reads the production settings from Netlify, writes a fresh cron-secret.txt and robot-secret.txt
# (readable by this Windows user only, like install.ps1), then restarts the supervisor so the server, jobs loop and
# video worker all use the new values. No admin needed. Typed without Shift over Chrome Remote Desktop:
#   powershell -executionpolicy bypass -file scripts\self-host\windows\rotate-local-secrets.ps1
$ErrorActionPreference = "Stop"
$repo = Split-Path (Split-Path (Split-Path $PSScriptRoot))
$logs = Join-Path $env:USERPROFILE "bupulse-prod"

Write-Host "1/3 Production settings from Netlify (new database password)"
Push-Location $repo
node scripts\self-host\windows\server.mjs refresh-env
Pop-Location
$envFile = Join-Path $logs "prod-env.json"
Write-Host "    prod-env.json updated $((Get-Item $envFile).LastWriteTime)"

Write-Host "2/3 New cron-secret.txt and robot-secret.txt"
foreach ($name in "cron-secret.txt", "robot-secret.txt") {
  $file = Join-Path $logs $name
  $bytes = New-Object byte[] 36
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  [System.IO.File]::WriteAllText($file, ([Convert]::ToBase64String($bytes) -replace '[+/=]', ''))
  icacls $file /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
  Write-Host "    $name replaced"
}

Write-Host "3/3 Restarting the supervisor (site down about 1-3 minutes)"
New-Item -ItemType File -Force (Join-Path $logs "restart-supervisor") | Out-Null
Write-Host "done"
