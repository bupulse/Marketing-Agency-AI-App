# Updates bupulse.com on the home Windows PC to the latest code on GitHub (docs/SELF_HOST.md).
#   powershell -ExecutionPolicy Bypass -File C:\Users\WECPC015\BuPulse\scripts\self-host\windows\update.ps1
#
# Two ways, picked by itself:
# - With the BuPulse supervisor (supervisor.mjs, after admin-once.ps1): a NORMAL PowerShell is enough. It talks to the
#   supervisor through files in %USERPROFILE%\bupulse-prod (pause-server, restart-jobs, ...); the supervisor stops the
#   server by the exact process ID it started.
# - Without it (nothing answers on 127.0.0.1:3019 and no supervisor task is switched on): the old way, with the
#   "BuPulse server", "BuPulse tunnel" and "BuPulse jobs" tasks. Those were registered from an administrator PowerShell,
#   so this way needs one (Windows lets only administrators stop and start them: that was the UAC prompt).
# Both ways: the website is always started again (try/finally), and the previous build is kept as .next-prev and put
# back if the new build fails, so a failed build never leaves the site without a working version.
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$logs = Join-Path $env:USERPROFILE "bupulse-prod"
$pause = Join-Path $logs "pause-server"
Set-Location $repo

function Get-SupervisorState {
  try { return Invoke-RestMethod -Uri "http://127.0.0.1:3019/" -TimeoutSec 5 } catch { return $null }
}

function Wait-SiteUp([int]$seconds) {
  foreach ($i in 1..([Math]::Ceiling($seconds / 5))) {
    Start-Sleep -Seconds 5
    try { if ((Invoke-RestMethod -Uri "http://127.0.0.1:3002/api/status" -TimeoutSec 5).status -eq "ok") { return $true } } catch { }
  }
  return $false
}

# Builds with the previous build kept aside: .next -> .next-prev (its cache moved back in, so the build stays fast).
# Success: .next-prev stays as a one-step rollback until the next update. Failure: the previous build is put back.
function Invoke-SafeBuild {
  $next = Join-Path $repo ".next"
  $prev = Join-Path $repo ".next-prev"
  if (Test-Path -LiteralPath $prev) { Remove-Item -LiteralPath $prev -Recurse -Force }
  $kept = $false
  if (Test-Path -LiteralPath $next) {
    Rename-Item -LiteralPath $next -NewName ".next-prev"
    $kept = $true
    if (Test-Path -LiteralPath (Join-Path $prev "cache")) {
      New-Item -ItemType Directory -Force $next | Out-Null
      Move-Item -LiteralPath (Join-Path $prev "cache") -Destination (Join-Path $next "cache")
    }
  }
  # Out-Host: the build's lines go to the window, not into this function's return value.
  node scripts\self-host\windows\server.mjs build | Out-Host
  $ok = $LASTEXITCODE -eq 0
  if (-not $ok -and $kept) {
    Write-Warning "The build failed: putting the previous build back (.next-prev -> .next)."
    if (Test-Path -LiteralPath (Join-Path $next "cache")) {
      if (Test-Path -LiteralPath (Join-Path $prev "cache")) { Remove-Item -LiteralPath (Join-Path $prev "cache") -Recurse -Force }
      Move-Item -LiteralPath (Join-Path $next "cache") -Destination (Join-Path $prev "cache")
    }
    if (Test-Path -LiteralPath $next) { Remove-Item -LiteralPath $next -Recurse -Force }
    Rename-Item -LiteralPath $prev -NewName ".next"
  }
  return $ok
}

$sv = Get-SupervisorState
$supervisorTask = Get-ScheduledTask -TaskName "BuPulse supervisor*" -ErrorAction SilentlyContinue | Where-Object { $_.State -ne "Disabled" }
if (-not $sv -and $supervisorTask) {
  throw "The BuPulse supervisor is set up but not running. Start it (no administrator needed): Start-Process wscript.exe `"$logs\supervisor-hidden.vbs`" , wait a minute, and run this again. Nothing was changed."
}

Write-Host "1/5 Downloading the new code"
$before = (git rev-parse HEAD).Trim()
git pull --ff-only
if ($LASTEXITCODE -ne 0) { throw "git pull failed: nothing was changed, the site still runs the old version" }
$tunnelChanged = (& (Join-Path $PSScriptRoot "tunnel-config.ps1")) -eq "changed"

if ($sv) {
  # ---- with the supervisor ------------------------------------------------------------------------------------
  if ($tunnelChanged) {
    Write-Host "    tunnel hostnames changed: the supervisor restarts the tunnel"
    New-Item -ItemType File -Force (Join-Path $logs "restart-tunnel") | Out-Null
  }
  $built = $false
  try {
    Write-Host "2/5 Stopping the website (down for a few minutes)"
    New-Item -ItemType File -Force $pause | Out-Null
    $stopped = $false
    foreach ($i in 1..30) {
      Start-Sleep -Seconds 2
      $s = Get-SupervisorState
      if ($s -and $s.children.server.state -eq "paused" -and -not $s.children.server.pid) { $stopped = $true; break }
    }
    if (-not $stopped) { throw "The supervisor did not stop the website within a minute (see $logs\supervisor.log). Nothing was built; the site keeps running." }

    # A new supervisor.mjs takes effect only in a fresh supervisor: it replaces itself now, while the website is
    # stopped anyway (pause-server stays, so the new one keeps it stopped). Only when the new file loads.
    if (git diff --name-only $before HEAD -- scripts/self-host/windows/supervisor.mjs) {
      node --check scripts\self-host\windows\supervisor.mjs
      $syntaxOk = $LASTEXITCODE -eq 0
      if ($syntaxOk) { node scripts\self-host\windows\supervisor.mjs --self-test | Out-Null; $syntaxOk = $LASTEXITCODE -eq 0 }
      if (-not $syntaxOk) {
        Write-Warning "The new supervisor.mjs does not load: the running supervisor is kept. Send the messages above to Claude."
      } else {
        Write-Host "    the supervisor changed: starting a fresh one"
        $oldPid = (Get-SupervisorState).supervisorPid
        New-Item -ItemType File -Force (Join-Path $logs "restart-supervisor") | Out-Null
        $fresh = $false
        foreach ($i in 1..45) {
          Start-Sleep -Seconds 2
          $s = Get-SupervisorState
          if ($s -and $s.supervisorPid -ne $oldPid) { $fresh = $true; break }
        }
        if (-not $fresh) { Write-Warning "The fresh supervisor did not answer within 90 seconds (see $logs\supervisor.log); the build goes on, and the supervisor task starts one within 5 minutes." }
      }
    }

    Write-Host "3/5 Building the new version (several minutes)"
    $built = Invoke-SafeBuild
  } finally {
    # Always: the supervisor starts the website again (with the new build, or the previous one put back).
    Remove-Item -LiteralPath $pause -ErrorAction SilentlyContinue
  }
  Write-Host "4/5 Starting the website"
  if (-not $built) { throw "the build failed (see the messages above): the previous version was put back and the supervisor starts it again. Send the messages to Claude." }
  if (-not (Wait-SiteUp 300)) { throw "the website did not answer within 5 minutes: check $logs\server.log and $logs\supervisor.log" }
  # The jobs loop reads cron-loop.ps1 only when it starts: the supervisor restarts it (when it runs).
  Write-Host "5/5 Restarting the jobs loop (when it is on)"
  if (Test-Path (Join-Path $logs "jobs-on")) { New-Item -ItemType File -Force (Join-Path $logs "restart-jobs") | Out-Null }
  Write-Host "Done: bupulse.com runs $(git log --oneline -1)"
  exit 0
}

# ---- the old way: the three scheduled tasks (administrator PowerShell) -------------------------------------------
# Stop-ScheduledTask ends only server.mjs: the `next start` it launched keeps holding port 3002 (6 November 2026), so
# the process listening on port 3002 is stopped too, by its exact process ID.
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Write-Warning "No supervisor on this PC yet: the old tasks need a PowerShell opened with 'Run as administrator'. Trying anyway." }
if ($tunnelChanged) {
  Write-Host "    tunnel hostnames changed: restarting the tunnel task"
  Stop-ScheduledTask -TaskName "BuPulse tunnel"
  Start-Sleep -Seconds 2
  Start-ScheduledTask -TaskName "BuPulse tunnel"
}
$built = $false
try {
  Write-Host "2/5 Stopping the website (down for a few minutes)"
  Stop-ScheduledTask -TaskName "BuPulse server"
  $listener = Get-NetTCPConnection -LocalPort 3002 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($id in $listener) { Stop-Process -Id $id -Force }
  Start-Sleep -Seconds 3
  Write-Host "3/5 Building the new version (several minutes)"
  $built = Invoke-SafeBuild
} finally {
  # Always started again, even if a step above failed (with the new build, or the previous one put back).
  Write-Host "4/5 Starting the website"
  Start-ScheduledTask -TaskName "BuPulse server"
}
if (-not $built) { throw "the build failed (see the messages above): the previous version was put back and started again. Send the messages to Claude." }
if (-not (Wait-SiteUp 120)) { throw "the website did not answer within 2 minutes: check $env:USERPROFILE\bupulse-prod\server.log" }
# The job loop reads cron-loop.ps1 only when it starts: restart it (when it is switched on).
Write-Host "5/5 Restarting the jobs task (when it is on)"
try {
  $jobs = Get-ScheduledTask -TaskName "BuPulse jobs" -ErrorAction SilentlyContinue
  if ($jobs -and $jobs.State -ne "Disabled") {
    Stop-ScheduledTask -TaskName "BuPulse jobs"
    Start-ScheduledTask -TaskName "BuPulse jobs"
  }
} catch {
  Write-Warning "The site is updated, but the BuPulse jobs task could not be restarted: $($_.Exception.Message)"
}
Write-Host "Done: bupulse.com runs $(git log --oneline -1)"
