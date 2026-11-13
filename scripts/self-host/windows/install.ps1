# Sets up the home Windows 11 Pro PC to host bupulse.com (docs/SELF_HOST.md). Run it from the repo folder in a
# PowerShell opened with "Run as administrator", AFTER `npx -y netlify-cli@27.12.0 login`, `cloudflared tunnel login` and
# `cloudflared tunnel token --cred-file ... bupulse-prod` (the guide's earlier steps). Safe to run again.
#
# What it does: keeps the PC awake on mains power, creates %USERPROFILE%\bupulse-prod (logs and this PC's own
# CRON_SECRET), installs the packages, links the folder to the Netlify site (for the production settings), builds,
# writes the tunnel config, and sets up the BuPulse supervisor (admin-once.ps1: website, tunnel and jobs loop, started at
# boot and at sign-in, each restarted when it stops). The jobs loop starts switched OFF: switch it on (jobs-on file) only
# once the Mac's job loop is stopped, so the scheduled jobs never run on two computers. Later updates: update.ps1 in a
# normal PowerShell (no administrator).
$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$logs = Join-Path $env:USERPROFILE "bupulse-prod"
$tunnelId = "cf9eb6ae-8290-4e87-8c8e-fc6e0c3375d0"
$credFile = Join-Path $env:USERPROFILE ".cloudflared\$tunnelId.json"
$config = Join-Path $env:USERPROFILE ".cloudflared\bupulse-prod.yml"

foreach ($tool in "node", "npm", "git", "cloudflared") {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is not installed (see the guide, step 2)" }
}
if (-not (Test-Path $credFile)) { throw "Tunnel credentials missing: run the guide's tunnel step first ($credFile)" }

Write-Host "1/6 Keeping the PC awake on mains power"
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0

Write-Host "2/6 Logs folder and this PC's own job password"
New-Item -ItemType Directory -Force $logs | Out-Null
$secretFile = Join-Path $logs "cron-secret.txt"
if (-not (Test-Path -LiteralPath $secretFile -PathType Leaf)) {
  $bytes = New-Object byte[] 36
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  # .NET writes the file directly (a desktop on 6 November 2026 ended this step without the file via Set-Content).
  [System.IO.File]::WriteAllText($secretFile, ([Convert]::ToBase64String($bytes) -replace '[+/=]', ''))
}
if (-not (Test-Path -LiteralPath $secretFile -PathType Leaf)) { throw "Could not create $secretFile (antivirus or folder protection?)" }
icacls $secretFile /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null

Write-Host "3/6 Installing packages (several minutes)"
Push-Location $repo
# Run again after a failed step: packages installed from the same package-lock.json are kept (npm ci takes ~15 minutes).
$installed = Join-Path $repo "node_modules\.package-lock.json"
if ((Test-Path $installed) -and ((Get-Item $installed).LastWriteTime -ge (Get-Item (Join-Path $repo "package-lock.json")).LastWriteTime)) {
  Write-Host "    already installed, skipped"
} else {
  npm ci
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
}

Write-Host "4/6 Linking this folder to the Netlify site (production settings)"
npx -y netlify-cli@27.12.0 link --id 9b52a3b8-0101-45b8-9a29-44bc042f53fd
if ($LASTEXITCODE -ne 0) { throw "netlify link failed: run npx -y netlify-cli@27.12.0 login first" }

Write-Host "5/6 Building the production site (several minutes)"
node scripts\self-host\windows\server.mjs build
if ($LASTEXITCODE -ne 0) { throw "build failed: see the messages above" }
Pop-Location

Write-Host "6/6 Tunnel config and the supervisor (website, tunnel, jobs loop; starts at boot and at sign-in)"
& (Join-Path $PSScriptRoot "tunnel-config.ps1") | Out-Null
# admin-once.ps1 registers "BuPulse supervisor at boot" and the per-user "BuPulse supervisor" task and starts it
# (docs/SELF_HOST.md, "Supervisor"). The jobs loop stays off until %USERPROFILE%\bupulse-prod\jobs-on exists: create it
# only once the Mac's job loop is stopped, so the scheduled jobs never run on two computers.
& (Join-Path $PSScriptRoot "admin-once.ps1")

Write-Host ""
Write-Host "Done. http://localhost:3002/api/status should say ""status"":""ok""."
Write-Host "Then follow the guide's switch step (Mac off, then: New-Item -ItemType File $env:USERPROFILE\bupulse-prod\jobs-on)."
