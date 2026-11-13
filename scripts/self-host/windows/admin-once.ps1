# ONE TIME, as administrator: moves this PC from the old start-at-boot tasks to the BuPulse supervisor
# (docs/SELF_HOST.md, "Supervisor"). After this, updates and restarts never need an administrator PowerShell again.
#
#   Start PowerShell with "Run as administrator", then:
#   powershell -ExecutionPolicy Bypass -File C:\Users\WECPC015\BuPulse\scripts\self-host\windows\admin-once.ps1
#
# Why administrator: install.ps1 (before 13 November 2026) registered "BuPulse server", "BuPulse tunnel" and "BuPulse
# jobs" from an administrator PowerShell, to start at boot without anyone signed in (S4U). Windows lets only an
# administrator stop, start or change those tasks, which is why update.ps1 needed one (and a UAC prompt). This script:
#   1. switches the three old tasks off and stops them (kept, not deleted, so going back is one Enable-ScheduledTask);
#   2. stops the old `next start` still holding port 3002 (by the exact process ID listening there, once);
#   3. registers "BuPulse supervisor at boot": the supervisor starts when Windows starts, even with nobody signed in
#      (after a power cut, the site comes back by itself). -NoBootTask skips it (then it starts only at sign-in);
#   4. runs setup-supervisor.ps1 (the per-user sign-in task) and starts the supervisor.
# If "BuPulse jobs" was switched on, the jobs loop stays on (jobs-on file), now run by the supervisor.
# Changes nothing else: no firewall, no UAC, no services, no power settings.
param([switch]$NoBootTask)
$ErrorActionPreference = "Stop"
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw "Run this one in a PowerShell started with 'Run as administrator' (only this script needs it)." }
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$logs = Join-Path $env:USERPROFILE "bupulse-prod"
New-Item -ItemType Directory -Force $logs | Out-Null

Write-Host "1/4 Switching off the old tasks"
$jobs = Get-ScheduledTask -TaskName "BuPulse jobs" -ErrorAction SilentlyContinue
if ($jobs -and $jobs.State -ne "Disabled") {
  New-Item -ItemType File -Force (Join-Path $logs "jobs-on") | Out-Null
  Write-Host "    'BuPulse jobs' was on: the supervisor will run the jobs loop (jobs-on)"
}
foreach ($name in "BuPulse server", "BuPulse tunnel", "BuPulse jobs") {
  $t = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  if (-not $t) { continue }
  Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  Disable-ScheduledTask -TaskName $name | Out-Null
  Write-Host "    $($name): off"
}

Write-Host "2/4 Stopping the old website process on port 3002 (by its process ID)"
Start-Sleep -Seconds 2
$listener = Get-NetTCPConnection -LocalPort 3002 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($id in $listener) {
  Write-Host "    stopping process $id"
  Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
}

if (-not $NoBootTask) {
  Write-Host "3/4 Task 'BuPulse supervisor at boot' (starts with Windows, nobody needs to sign in)"
  $node = (Get-Command node).Source
  $action = New-ScheduledTaskAction -Execute $node -Argument "`"$repo\scripts\self-host\windows\supervisor.mjs`"" -WorkingDirectory $repo
  $boot = New-ScheduledTaskTrigger -AtStartup
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited
  Register-ScheduledTask -TaskName "BuPulse supervisor at boot" -Action $action -Trigger $boot -Settings $settings -Principal $principal -Force | Out-Null
} else {
  Write-Host "3/4 Skipped the start-at-boot task (-NoBootTask): the supervisor starts when you sign in"
}

Write-Host "4/4 The sign-in task and the first start"
& (Join-Path $PSScriptRoot "setup-supervisor.ps1")
