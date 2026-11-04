# Sets up the home Windows 11 Pro PC to host bupulse.com (docs/SELF_HOST.md). Run it from the repo folder in a
# PowerShell opened with "Run as administrator", AFTER `npx -y netlify-cli@27.12.0 login`, `cloudflared tunnel login` and
# `cloudflared tunnel token --cred-file ... bupulse-prod` (the guide's earlier steps). Safe to run again.
#
# What it does: keeps the PC awake on mains power, creates %USERPROFILE%\bupulse-prod (logs and this PC's own
# CRON_SECRET), installs the packages, links the folder to the Netlify site (for the production settings), builds,
# writes the tunnel config, and registers three tasks that start at boot: "BuPulse server", "BuPulse tunnel" and
# "BuPulse jobs". The jobs task is registered DISABLED: switch it on only once the Mac's job loop is stopped, so the
# scheduled jobs never run on two computers.
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
if (-not (Test-Path $secretFile)) {
  $bytes = New-Object byte[] 36
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  Set-Content -NoNewline $secretFile ([Convert]::ToBase64String($bytes) -replace '[+/=]', '')
}
icacls $secretFile /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null

Write-Host "3/6 Installing packages (several minutes)"
Push-Location $repo
npm ci
if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }

Write-Host "4/6 Linking this folder to the Netlify site (production settings)"
npx -y netlify-cli@27.12.0 link --id 9b52a3b8-0101-45b8-9a29-44bc042f53fd
if ($LASTEXITCODE -ne 0) { throw "netlify link failed: run npx -y netlify-cli@27.12.0 login first" }

Write-Host "5/6 Building the production site (several minutes)"
node scripts\self-host\windows\server.mjs build
if ($LASTEXITCODE -ne 0) { throw "build failed: see $logs\build.log" }
Pop-Location

Write-Host "6/6 Tunnel config and start-at-boot tasks"
@"
tunnel: $tunnelId
credentials-file: $credFile
ingress:
  - hostname: bupulse.com
    service: http://localhost:3002
  - hostname: www.bupulse.com
    service: http://localhost:3002
  - service: http_status:404
"@ | Set-Content $config

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$boot = New-ScheduledTaskTrigger -AtStartup
$node = (Get-Command node).Source
$cloudflared = (Get-Command cloudflared).Source
$tasks = @(
  @{ Name = "BuPulse server"; Action = New-ScheduledTaskAction -Execute $node -Argument "`"$repo\scripts\self-host\windows\server.mjs`" start" -WorkingDirectory $repo },
  @{ Name = "BuPulse tunnel"; Action = New-ScheduledTaskAction -Execute $cloudflared -Argument "tunnel --no-autoupdate --config `"$config`" run bupulse-prod" },
  @{ Name = "BuPulse jobs"; Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$repo\scripts\self-host\windows\cron-loop.ps1`"" }
)
foreach ($t in $tasks) {
  Register-ScheduledTask -TaskName $t.Name -Action $t.Action -Trigger $boot -Principal $principal -Settings $settings -Force | Out-Null
}
Disable-ScheduledTask -TaskName "BuPulse jobs" | Out-Null
Start-ScheduledTask -TaskName "BuPulse server"

Write-Host ""
Write-Host "Done. In about a minute, http://localhost:3002/api/status should say ""status"":""ok""."
Write-Host "Then follow the guide's switch step (tunnel on, Mac off, jobs on)."
