# Read-only: what keeps relaunching the fake "dlIhost" (Defender removed C:\Users\WECPC015\AppData\Roaming\DLL\dlIhost.exe
# on 7 and 12 November 2026, it was running again on 17 November). Lists anything that starts automatically and points at
# AppData, Temp, ProgramData or the DLL folder. Typed without Shift over Chrome Remote Desktop:
#   powershell -executionpolicy bypass -file scripts\self-host\windows\persistence-check.ps1
$bad = "AppData|\\Temp\\|ProgramData|\\DLL\\|dlIhost|\.vbs|\.js\b|wscript|mshta|powershell.+-enc"
Write-Host "== The DLL folder"
$dir = Join-Path $env:APPDATA "DLL"
if (Test-Path $dir) { Get-ChildItem $dir -Force -Recurse -ErrorAction SilentlyContinue | Select-Object FullName, Length, LastWriteTime | Format-Table -AutoSize } else { Write-Host "gone ($dir does not exist)" }

Write-Host "== Run / RunOnce registry entries"
foreach ($k in "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run", "HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce",
               "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run", "HKLM:\Software\Microsoft\Windows\CurrentVersion\RunOnce",
               "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run") {
  if (Test-Path $k) {
    $p = Get-ItemProperty $k
    $p.PSObject.Properties | Where-Object { $_.Name -notlike "PS*" } | ForEach-Object {
      $flag = if ("$($_.Value)" -match $bad) { "  <== CHECK" } else { "" }
      Write-Host "$k  $($_.Name) = $($_.Value)$flag"
    }
  }
}

Write-Host "`n== Startup folders"
foreach ($f in [Environment]::GetFolderPath("Startup"), [Environment]::GetFolderPath("CommonStartup")) {
  Get-ChildItem $f -Force -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "$f\$($_.Name)" }
}

Write-Host "`n== Scheduled tasks that run something from AppData, Temp, ProgramData or a script host"
Get-ScheduledTask -ErrorAction SilentlyContinue | ForEach-Object {
  $t = $_
  foreach ($a in $t.Actions) {
    $line = "$($a.Execute) $($a.Arguments)"
    if ($line -match $bad) { Write-Host "$($t.TaskPath)$($t.TaskName)  [$($t.State)]  $line  <== CHECK" }
  }
}

Write-Host "`n== Services whose program is under AppData, Temp or ProgramData"
Get-CimInstance Win32_Service -ErrorAction SilentlyContinue | Where-Object { $_.PathName -match $bad } |
  ForEach-Object { Write-Host "$($_.Name)  [$($_.State), $($_.StartMode)]  $($_.PathName)  <== CHECK" }

Write-Host "`n== WMI event subscriptions (a hidden way to relaunch programs)"
Get-CimInstance -Namespace root\subscription -ClassName CommandLineEventConsumer -ErrorAction SilentlyContinue |
  ForEach-Object { Write-Host "$($_.Name)  $($_.CommandLineTemplate)  <== CHECK" }

Write-Host "`n== Running processes from AppData, Temp or ProgramData"
Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -match $bad } |
  ForEach-Object { Write-Host "PID $($_.ProcessId)  $($_.Name)  $($_.ExecutablePath)" }
Write-Host "check done"
