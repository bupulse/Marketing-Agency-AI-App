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
# Success: .next-prev stays as a one-step rollback until the next update. Failure, Ctrl+C or any error: the outer
# `finally` of each path calls Restore-PreviousBuild BEFORE the site starts again, so it never starts on a broken .next.
$script:setAside = $false      # .next was renamed to .next-prev by this run
$script:asideFailed = $false   # .next could not be renamed (a locked file): nothing was built
$script:restored = $false
function Invoke-SafeBuild {
  $next = Join-Path $repo ".next"
  $prev = Join-Path $repo ".next-prev"
  if (Test-Path -LiteralPath $prev) {
    # The rollback copy of the update before: deleted, or moved aside when Windows will not delete it.
    try { Remove-Item -LiteralPath $prev -Recurse -Force -ErrorAction Stop }
    catch { Rename-Item -LiteralPath $prev -NewName ".next-stale-$(Get-Date -Format yyyyMMddHHmmss)" }
  }
  if (Test-Path -LiteralPath $next) {
    try { Rename-Item -LiteralPath $next -NewName ".next-prev" -ErrorAction Stop }
    catch {
      $script:asideFailed = $true
      throw "Could not set the current build aside (.next -> .next-prev): $($_.Exception.Message). A file in .next is probably locked. Nothing was built; the current version is started again unchanged."
    }
    $script:setAside = $true
    try {
      if (Test-Path -LiteralPath (Join-Path $prev "cache")) {
        New-Item -ItemType Directory -Force $next | Out-Null
        Move-Item -LiteralPath (Join-Path $prev "cache") -Destination (Join-Path $next "cache") -ErrorAction Stop
      }
    } catch {
      Write-Warning "The build cache could not be moved over ($($_.Exception.Message)): the build is slower, nothing else changes."
    }
  }
  # Out-Host: the build's lines go to the window, not into this function's return value.
  node scripts\self-host\windows\server.mjs build | Out-Host
  return ($LASTEXITCODE -eq 0)
}

# Puts the previous build back when this run set it aside and did not finish a good build. Only renames, never deletes:
# the failed build is kept as .next-failed-<time> (delete it by hand later). Never throws.
function Restore-PreviousBuild([bool]$built) {
  if ($built -or -not $script:setAside) { return }
  $next = Join-Path $repo ".next"
  $prev = Join-Path $repo ".next-prev"
  if (-not (Test-Path -LiteralPath $prev)) { Write-Warning "No previous build (.next-prev) to put back."; return }
  try {
    if (Test-Path -LiteralPath $next) { Rename-Item -LiteralPath $next -NewName ".next-failed-$(Get-Date -Format yyyyMMddHHmmss)" -ErrorAction Stop }
    Rename-Item -LiteralPath $prev -NewName ".next" -ErrorAction Stop
    $script:restored = $true
    Write-Warning "The new build did not finish: the previous build was put back (.next-prev -> .next)."
  } catch {
    Write-Warning "COULD NOT PUT THE PREVIOUS BUILD BACK: $($_.Exception.Message). By hand, with the site stopped: rename .next to .next-failed and .next-prev to .next in $repo."
  }
}

# The plain words for a run that did not build.
function Get-NotBuiltMessage {
  if ($script:asideFailed) { return "the current build could not be set aside (a locked file in .next?): nothing was built and the current version runs again. Send the messages above to Claude." }
  if ($script:restored) { return "the build failed or was stopped (see the messages above): the previous version was put back and started again. Send the messages to Claude." }
  if ($script:setAside) { return "the build failed and the previous build could NOT be put back (see the warning above). Send the messages to Claude." }
  return "the update stopped before building (see the messages above); the current version is started again."
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
    # Always, even on Ctrl+C or an error: the previous build back if needed, THEN the supervisor starts the website.
    Restore-PreviousBuild $built
    Remove-Item -LiteralPath $pause -ErrorAction SilentlyContinue
  }
  Write-Host "4/5 Starting the website"
  if (-not $built) { throw (Get-NotBuiltMessage) }
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
  # Always, even on Ctrl+C or an error: the previous build back if needed, THEN the website task starts again.
  Restore-PreviousBuild $built
  Write-Host "4/5 Starting the website"
  Start-ScheduledTask -TaskName "BuPulse server"
}
if (-not $built) { throw (Get-NotBuiltMessage) }
# This PC takes about 3 minutes to come up (Netlify's settings, then next start).
$up = Wait-SiteUp 300
# The job loop reads cron-loop.ps1 only when it starts: restart it (when it is switched on), also after a slow start.
Write-Host "5/5 Restarting the jobs task (when it is on)"
try {
  $jobs = Get-ScheduledTask -TaskName "BuPulse jobs" -ErrorAction SilentlyContinue
  if ($jobs -and $jobs.State -ne "Disabled") {
    Stop-ScheduledTask -TaskName "BuPulse jobs"
    Start-ScheduledTask -TaskName "BuPulse jobs"
  }
} catch {
  Write-Warning "The BuPulse jobs task could not be restarted: $($_.Exception.Message)"
}
if (-not $up) { throw "the website did not answer within 5 minutes: check $env:USERPROFILE\bupulse-prod\server.log" }
Write-Host "Done: bupulse.com runs $(git log --oneline -1)"
