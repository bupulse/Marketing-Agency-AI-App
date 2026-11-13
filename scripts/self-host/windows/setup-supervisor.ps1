# Registers the "BuPulse supervisor" task for THIS Windows user, without admin rights (docs/SELF_HOST.md, "Supervisor").
# The supervisor (supervisor.mjs) runs the website, the tunnel and the jobs loop and starts each again when it stops.
#
#   powershell -ExecutionPolicy Bypass -File scripts\self-host\windows\setup-supervisor.ps1 [-EnableJobs] [-NoStart]
#
# The task starts at sign-in and is looked at every 5 minutes (if the supervisor is not running it starts again; when it
# runs, nothing happens). It runs hidden (wscript, no window). Without a sign-in after a reboot it does not run: for that,
# admin-once.ps1 adds a start-at-boot task (one time, as administrator). Safe to run again.
#
# -EnableJobs  also runs the scheduled jobs loop (creates %USERPROFILE%\bupulse-prod\jobs-on). Only on ONE computer.
# -NoStart     register only (admin-once.ps1 starts it after retiring the old tasks).
param([switch]$EnableJobs, [switch]$NoStart)
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$logs = Join-Path $env:USERPROFILE "bupulse-prod"
New-Item -ItemType Directory -Force $logs | Out-Null

foreach ($tool in "node", "cloudflared") {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is not installed (docs/SELF_HOST.md, step 1)" }
}
$node = (Get-Command node).Source
$cloudflared = (Get-Command cloudflared).Source
$supervisor = Join-Path $repo "scripts\self-host\windows\supervisor.mjs"

Write-Host "1/3 Supervisor settings and hidden starter in $logs"
# Full paths, so the task finds node and cloudflared whatever PATH it gets.
$config = @{ node = $node; cloudflared = $cloudflared; tunnelConfig = (Join-Path $env:USERPROFILE ".cloudflared\bupulse-prod.yml") }
[System.IO.File]::WriteAllText((Join-Path $logs "supervisor-config.json"), (ConvertTo-Json $config))
# wscript runs node with no window at all and waits for it (so Task Scheduler sees the task running and starts no second
# one); its exit code is the supervisor's, so a crash makes the task restart it after a minute.
# The VBScript line is:  WScript.Quit shell.Run("""<node>"" ""<supervisor.mjs>""", 0, True)   ("" is one quote there).
$q = '"'
$vbs = 'Set shell = CreateObject("WScript.Shell")' + "`r`n" + 'WScript.Quit shell.Run(' + ($q * 3) + $node + ($q * 2) + ' ' + ($q * 2) + $supervisor + ($q * 3) + ', 0, True)'
[System.IO.File]::WriteAllText((Join-Path $logs "supervisor-hidden.vbs"), $vbs + "`r`n")
if ($EnableJobs) {
  New-Item -ItemType File -Force (Join-Path $logs "jobs-on") | Out-Null
  Write-Host "    jobs loop: on (jobs-on created)"
}
# A stop file left from before would keep the supervisor from starting.
Remove-Item -LiteralPath (Join-Path $logs "stop-supervisor") -ErrorAction SilentlyContinue

Write-Host "2/3 Task 'BuPulse supervisor' (at sign-in, checked every 5 minutes, this user only)"
$user = "$env:USERDOMAIN\$env:USERNAME"
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$(Join-Path $logs 'supervisor-hidden.vbs')`"" -WorkingDirectory $repo
$atLogon = New-ScheduledTaskTrigger -AtLogOn -User $user
$every5 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
try {
  Register-ScheduledTask -TaskName "BuPulse supervisor" -Action $action -Trigger @($atLogon, $every5) -Settings $settings -Principal $principal -Force -ErrorAction Stop | Out-Null
} catch {
  # Registered before from an administrator PowerShell (admin-once.ps1): a normal PowerShell may not replace it. It is
  # the same task, so carry on.
  if (-not (Get-ScheduledTask -TaskName "BuPulse supervisor" -ErrorAction SilentlyContinue)) { throw }
  Write-Host "    already registered (by admin-once.ps1); kept as it is"
}

# The old tasks (install.ps1 before 13 November 2026) would run a second server, tunnel and jobs loop.
$old = @()
foreach ($name in "BuPulse server", "BuPulse tunnel", "BuPulse jobs") {
  $t = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  if ($t -and $t.State -ne "Disabled") { $old += $name }
}
if ($old.Count -gt 0) {
  Write-Warning "The old tasks are still switched on: $($old -join ', '). They were made as administrator, so only an"
  Write-Warning "administrator PowerShell can switch them off. Run ONCE, as administrator:"
  Write-Warning "  powershell -ExecutionPolicy Bypass -File `"$repo\scripts\self-host\windows\admin-once.ps1`""
  Write-Warning "The supervisor is registered but NOT started, so nothing runs twice."
  exit 0
}
if ($NoStart) { Write-Host "Registered (not started)."; exit 0 }

Write-Host "3/3 Starting the supervisor"
try {
  Start-ScheduledTask -TaskName "BuPulse supervisor" -ErrorAction Stop
} catch {
  # A task made from an administrator PowerShell may refuse a normal one: start the same hidden starter directly.
  Start-Process -FilePath "wscript.exe" -ArgumentList "`"$(Join-Path $logs 'supervisor-hidden.vbs')`""
}
foreach ($i in 1..60) {
  Start-Sleep -Seconds 5
  try {
    if ((Invoke-RestMethod -Uri "http://127.0.0.1:3002/api/status" -TimeoutSec 5).status -eq "ok") {
      Write-Host "Done: the supervisor runs and http://127.0.0.1:3002/api/status says ok. Log: $logs\supervisor.log"
      exit 0
    }
  } catch { }
}
Write-Warning "The website did not answer within 5 minutes. Look at $logs\supervisor.log and $logs\server.log"
