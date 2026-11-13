# Updates bupulse.com on the home Windows PC to the latest code on GitHub (docs/SELF_HOST.md). A NORMAL PowerShell is
# enough (no "Run as administrator", no UAC prompt):
#   powershell -ExecutionPolicy Bypass -File C:\Users\WECPC015\BuPulse\scripts\self-host\windows\update.ps1
#
# It talks to the BuPulse supervisor (supervisor.mjs) through files in %USERPROFILE%\bupulse-prod instead of stopping
# and starting scheduled tasks: until 13 November 2026 it used Stop-/Start-ScheduledTask on tasks an administrator had
# registered, which Windows allows only to administrators (that was the UAC prompt). The supervisor stops the server by
# the exact process ID it started (with its `next start` child), so nothing is left holding port 3002.
#
# Still on the old tasks (the supervisor is not running)? Run admin-once.ps1 once as administrator (docs/SELF_HOST.md).
$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$logs = Join-Path $env:USERPROFILE "bupulse-prod"
$pause = Join-Path $logs "pause-server"
Set-Location $repo

function Get-SupervisorState {
  try { return Invoke-RestMethod -Uri "http://127.0.0.1:3019/" -TimeoutSec 5 } catch { return $null }
}

if (-not (Get-SupervisorState)) {
  $old = Get-ScheduledTask -TaskName "BuPulse server" -ErrorAction SilentlyContinue
  if ($old -and $old.State -ne "Disabled") {
    throw "This PC still runs the old 'BuPulse server' task. Run once, in a PowerShell opened with 'Run as administrator': powershell -ExecutionPolicy Bypass -File `"$repo\scripts\self-host\windows\admin-once.ps1`" (docs/SELF_HOST.md). Nothing was changed."
  }
  throw "The BuPulse supervisor is not running. Start it (no administrator needed): Start-Process wscript.exe `"$logs\supervisor-hidden.vbs`" , wait a minute, and run this again. Nothing was changed."
}

Write-Host "1/5 Downloading the new code"
$before = (git rev-parse HEAD).Trim()
git pull --ff-only
if ($LASTEXITCODE -ne 0) { throw "git pull failed: nothing was changed, the site still runs the old version" }

# The tunnel's hostnames live in the repo (tunnel-config.ps1): a new one is picked up by restarting the tunnel, a few
# seconds offline. The supervisor does it (restart-tunnel).
if ((& (Join-Path $PSScriptRoot "tunnel-config.ps1")) -eq "changed") {
  Write-Host "    tunnel hostnames changed: the supervisor restarts the tunnel"
  New-Item -ItemType File -Force (Join-Path $logs "restart-tunnel") | Out-Null
}

Write-Host "2/5 Stopping the website (down for a few minutes)"
New-Item -ItemType File -Force $pause | Out-Null
$stopped = $false
foreach ($i in 1..30) {
  Start-Sleep -Seconds 2
  $s = Get-SupervisorState
  if ($s -and $s.children.server.state -eq "paused" -and -not $s.children.server.pid) { $stopped = $true; break }
}
if (-not $stopped) {
  Remove-Item -LiteralPath $pause -ErrorAction SilentlyContinue
  throw "The supervisor did not stop the website within a minute (see $logs\supervisor.log). Nothing was built; the site keeps running."
}

# A new supervisor.mjs takes effect only in a fresh supervisor: it replaces itself now, while the website is stopped
# anyway (pause-server stays, so the new one keeps it stopped).
if (git diff --name-only $before HEAD -- scripts/self-host/windows/supervisor.mjs) {
  Write-Host "    the supervisor changed: starting a fresh one"
  $oldPid = (Get-SupervisorState).supervisorPid
  New-Item -ItemType File -Force (Join-Path $logs "restart-supervisor") | Out-Null
  $fresh = $false
  foreach ($i in 1..45) {
    Start-Sleep -Seconds 2
    $s = Get-SupervisorState
    if ($s -and $s.supervisorPid -ne $oldPid) { $fresh = $true; break }
  }
  if (-not $fresh) { Write-Warning "The fresh supervisor did not answer within 90 seconds (see $logs\supervisor.log); the build goes on, and the 'BuPulse supervisor' task starts one within 5 minutes." }
}

Write-Host "3/5 Building the new version (several minutes)"
node scripts\self-host\windows\server.mjs build
$built = $LASTEXITCODE -eq 0

Write-Host "4/5 Starting the website"
Remove-Item -LiteralPath $pause -ErrorAction SilentlyContinue
if (-not $built) { throw "the build failed (see the messages above): send them to Claude. The supervisor starts the website again anyway." }
$up = $false
foreach ($i in 1..60) {
  Start-Sleep -Seconds 5
  try {
    if ((Invoke-RestMethod -Uri "http://127.0.0.1:3002/api/status" -TimeoutSec 5).status -eq "ok") { $up = $true; break }
  } catch { }
}
if (-not $up) { throw "the website did not answer within 5 minutes: check $logs\server.log and $logs\supervisor.log" }

# The jobs loop reads cron-loop.ps1 only when it starts: the supervisor restarts it (when it runs) so a new version of
# the loop takes effect. The server was stopped, so no job was mid-way.
Write-Host "5/5 Restarting the jobs loop (when it is on)"
if (Test-Path (Join-Path $logs "jobs-on")) { New-Item -ItemType File -Force (Join-Path $logs "restart-jobs") | Out-Null }
Write-Host "Done: bupulse.com runs $(git log --oneline -1)"
