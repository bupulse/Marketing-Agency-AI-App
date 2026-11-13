# ONE TIME, as administrator: moves this PC from the old start-at-boot tasks to the BuPulse supervisor
# (docs/SELF_HOST.md, "Supervisor"). After this, updates and restarts never need an administrator PowerShell again.
#
#   Start PowerShell with "Run as administrator", then:
#   powershell -ExecutionPolicy Bypass -File C:\Users\WECPC015\BuPulse\scripts\self-host\windows\admin-once.ps1
#
# Why administrator: install.ps1 (before 13 November 2026) registered "BuPulse server", "BuPulse tunnel" and "BuPulse
# jobs" from an administrator PowerShell (S4U, at startup). Windows lets only an administrator stop, start or change
# those tasks, which is why update.ps1 needed one (and a UAC prompt).
#
# Order, so the site is never left without a server or a tunnel:
#   1. registers "BuPulse supervisor at boot" (S4U: runs with nobody signed in, survives sign-out; at startup and looked
#      at every 5 minutes) and the per-user "BuPulse supervisor" (registered switched off for now: setup-supervisor.ps1);
#   2. starts the boot task. While the old server holds port 3002 the supervisor starts no server and no jobs loop; its
#      tunnel joins the old one (two connectors, as with the Mac before);
#   3. once the supervisor's tunnel is connected, switches off (does not delete) the old jobs task, then the old server
#      (and stops the old `next start` on port 3002 by its exact process ID), then the old tunnel; the supervisor then
#      starts its own server, and the jobs loop if "BuPulse jobs" was on (jobs-on);
#   4. switches the per-user task on and waits for http://127.0.0.1:3002/api/status; only then stops the cloudflared
#      started by hand on 12 November (its command line names tunnel-test.log) by its exact process ID.
# If anything in 3-4 fails, it puts the old tasks back: the old tunnel first (so one connector always runs), then stops
# the supervisor, switches its tasks off, and switches the old server and jobs on again (each on its own, a failure
# never stops the others), then checks https://bupulse.com for 3 minutes and says loudly how to start a tunnel by hand. Changes nothing else: no firewall, no UAC, no services, no power settings.
param([switch]$NoPerUserTask)
$ErrorActionPreference = "Stop"
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw "Run this one in a PowerShell started with 'Run as administrator' (only this script needs it)." }
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$logs = Join-Path $env:USERPROFILE "bupulse-prod"
New-Item -ItemType Directory -Force $logs | Out-Null
$oldNames = @("BuPulse jobs", "BuPulse server", "BuPulse tunnel")
$boot = "BuPulse supervisor at boot"

function Get-SupervisorState { try { return Invoke-RestMethod -Uri "http://127.0.0.1:3019/" -TimeoutSec 5 } catch { return $null } }
function Test-TunnelReady { try { return (Invoke-WebRequest -Uri "http://127.0.0.1:20249/ready" -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200 } catch { return $false } }

$wasOn = @{}
foreach ($name in $oldNames) {
  $t = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  $wasOn[$name] = [bool]($t -and $t.State -ne "Disabled")
}

Write-Host "1/4 Registering the supervisor tasks"
$node = (Get-Command node).Source
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$repo\scripts\self-host\windows\supervisor.mjs`"" -WorkingDirectory $repo
$atStartup = New-ScheduledTaskTrigger -AtStartup
# Looked at every 5 minutes too: if the supervisor ever exits, Task Scheduler starts it again (IgnoreNew: never twice).
$every5 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited
Register-ScheduledTask -TaskName $boot -Action $action -Trigger @($atStartup, $every5) -Settings $settings -Principal $principal -Force | Out-Null
if (-not $NoPerUserTask) { & (Join-Path $PSScriptRoot "setup-supervisor.ps1") -NoStart }
Remove-Item -LiteralPath (Join-Path $logs "stop-supervisor") -ErrorAction SilentlyContinue

Write-Host "2/4 Starting the supervisor (next to the old tasks for a moment)"
Start-ScheduledTask -TaskName $boot
$up = $false
foreach ($i in 1..45) { Start-Sleep -Seconds 2; if (Get-SupervisorState) { $up = $true; break } }
if (-not $up) {
  # It may still come up late: the stop file makes it stop at once (and keeps it from starting).
  New-Item -ItemType File -Force (Join-Path $logs "stop-supervisor") | Out-Null
  Disable-ScheduledTask -TaskName $boot | Out-Null
  throw "The supervisor did not answer within 90 seconds (see $logs\supervisor.log). The old tasks were not touched; the boot task is switched off again and stop-supervisor is written (delete it before trying again)."
}
$ready = $false
foreach ($i in 1..30) { if (Test-TunnelReady) { $ready = $true; break }; Start-Sleep -Seconds 3 }
if (-not $ready) {
  New-Item -ItemType File -Force (Join-Path $logs "stop-supervisor") | Out-Null
  Disable-ScheduledTask -TaskName $boot | Out-Null
  throw "The supervisor's tunnel did not connect within 90 seconds (see $logs\tunnel.log). The old tasks were not touched; the supervisor is stopped again."
}

try {
  Write-Host "3/4 Switching off the old tasks"
  foreach ($name in $oldNames) {
    if (-not (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue)) { continue }
    Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    Disable-ScheduledTask -TaskName $name | Out-Null
    Write-Host "    $($name): off"
    if ($name -eq "BuPulse server") {
      # The old `next start` outlives its task (6 November 2026): stopped by the process ID listening on port 3002.
      Start-Sleep -Seconds 2
      $listener = Get-NetTCPConnection -LocalPort 3002 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
      foreach ($id in $listener) { Write-Host "    stopping the old website process $id"; Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
    }
  }
  if ($wasOn["BuPulse jobs"]) {
    New-Item -ItemType File -Force (Join-Path $logs "jobs-on") | Out-Null
    Write-Host "    the jobs loop moves to the supervisor (jobs-on)"
  }

  Write-Host "4/4 Waiting for the supervisor's website"
  if (-not $NoPerUserTask) { Enable-ScheduledTask -TaskName "BuPulse supervisor" | Out-Null }
  $ok = $false
  foreach ($i in 1..60) {
    Start-Sleep -Seconds 5
    try { if ((Invoke-RestMethod -Uri "http://127.0.0.1:3002/api/status" -TimeoutSec 5).status -eq "ok") { $ok = $true; break } } catch { }
  }
  if (-not $ok) { throw "the supervisor's website did not answer within 5 minutes" }
} catch {
  Write-Warning "Switch failed ($($_.Exception.Message)): putting the old tasks back."
  # Each old task on its own try/catch: one that fails never stops the others.
  function Restore-OldTask([string]$name) {
    if (-not $wasOn[$name]) { return }
    try { Enable-ScheduledTask -TaskName $name -ErrorAction Stop | Out-Null } catch { Write-Warning "    $($name): could not be switched on: $($_.Exception.Message)" }
    try { Start-ScheduledTask -TaskName $name -ErrorAction Stop; Write-Host "    $($name): on again" } catch { Write-Warning "    $($name): could not be started: $($_.Exception.Message)" }
  }
  # The old tunnel first, BEFORE the supervisor (and its tunnel) stops, so there is always one connector.
  Restore-OldTask "BuPulse tunnel"
  Start-Sleep -Seconds 10
  try { New-Item -ItemType File -Force (Join-Path $logs "stop-supervisor") | Out-Null } catch { Write-Warning "    could not write stop-supervisor: $($_.Exception.Message)" }
  foreach ($i in 1..30) { Start-Sleep -Seconds 2; if (-not (Get-SupervisorState)) { break } }
  Remove-Item -LiteralPath (Join-Path $logs "jobs-on") -ErrorAction SilentlyContinue
  foreach ($t in @($boot, "BuPulse supervisor")) { try { Disable-ScheduledTask -TaskName $t -ErrorAction Stop | Out-Null } catch { } }
  Restore-OldTask "BuPulse server"
  Restore-OldTask "BuPulse jobs"
  Write-Host "    checking https://bupulse.com from outside (up to 3 minutes)"
  $public = $false
  foreach ($i in 1..18) {
    Start-Sleep -Seconds 10
    try { if ((Invoke-RestMethod -Uri "https://bupulse.com/api/status" -TimeoutSec 8).status -eq "ok") { $public = $true; break } } catch { }
  }
  if (-not $public) {
    Write-Warning "=================================================================================================="
    Write-Warning "BUPULSE.COM DOES NOT ANSWER FROM OUTSIDE after the rollback. Check the server and start a tunnel by hand:"
    Write-Warning "  Start-Process cloudflared -ArgumentList 'tunnel','--no-autoupdate','--config',`"$env:USERPROFILE\.cloudflared\bupulse-prod.yml`",'run','bupulse-prod' -WindowStyle Hidden"
    Write-Warning "and look at $env:USERPROFILE\bupulse-prod\server.log (http://127.0.0.1:3002/api/status should say ok)."
    Write-Warning "=================================================================================================="
  }
  throw "The old tasks run again (stop-supervisor is left in $logs; delete it before trying again). See $logs\supervisor.log."
}

# Only now that the switch worked: the cloudflared started by hand on 12 November 2026 (its command line names
# tunnel-test.log), stopped by its exact process ID. Until here it stayed as an extra connector.
foreach ($p in @(Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" | Where-Object { "$($_.CommandLine)" -like "*tunnel-test.log*" })) {
  Write-Host "    stopping the hand-started cloudflared $($p.ProcessId)"
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}
Write-Host "Done: the supervisor runs and http://127.0.0.1:3002/api/status says ok. Log: $logs\supervisor.log"
