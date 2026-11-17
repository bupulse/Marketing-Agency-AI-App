# Chrome Remote Desktop check for the office PC: why remote access is offline after a restart (17 November 2026: the
# service is set to start automatically, the tunnel comes back, but the PC stays "offline" until someone clicks
# "Turn on" again). Read-only: it changes nothing. Typed without Shift over Chrome Remote Desktop:
#   powershell -executionpolicy bypass -file scripts\self-host\windows\crd-check.ps1
$ErrorActionPreference = "Continue"
$boot = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
Write-Host "== Boot time: $boot (now $(Get-Date))"

Write-Host "`n== Service"
Get-Service chromoting | Format-List Name, DisplayName, Status, StartType
& sc.exe qc chromoting
& sc.exe qfailure chromoting
& sc.exe qtriggerinfo chromoting

Write-Host "`n== Service Control Manager events for Chrome Remote Desktop since 2 days"
Get-WinEvent -FilterHashtable @{ LogName = "System"; ProviderName = "Service Control Manager"; StartTime = (Get-Date).AddDays(-2) } -ErrorAction SilentlyContinue |
  Where-Object { $_.Message -match "Chrome Remote Desktop" } |
  Select-Object -First 40 TimeCreated, Id, @{ n = "Message"; e = { ($_.Message -replace "\s+", " ").Substring(0, [Math]::Min(160, $_.Message.Length)) } } |
  Format-Table -AutoSize -Wrap

Write-Host "`n== Chrome Remote Desktop's own events since 2 days"
Get-WinEvent -FilterHashtable @{ LogName = "Application"; ProviderName = "chromoting"; StartTime = (Get-Date).AddDays(-2) } -ErrorAction SilentlyContinue |
  Select-Object -First 40 TimeCreated, LevelDisplayName, Id, @{ n = "Message"; e = { ($_.Message -replace "\s+", " ").Substring(0, [Math]::Min(200, $_.Message.Length)) } } |
  Format-Table -AutoSize -Wrap

Write-Host "`n== Host files (names and dates only, never their contents)"
Get-ChildItem "$env:ProgramData\Google\Chrome Remote Desktop" -Force -ErrorAction SilentlyContinue | Format-Table Name, Length, LastWriteTime, CreationTime
$hostJson = "$env:ProgramData\Google\Chrome Remote Desktop\host.json"
if (Test-Path $hostJson) {
  try {
    $cfg = Get-Content $hostJson -Raw | ConvertFrom-Json
    # Only which fields exist and the account the host is registered to: no tokens or secrets are printed.
    Write-Host "host.json fields: $((($cfg | Get-Member -MemberType NoteProperty).Name) -join ', ')"
    Write-Host "host owner: $($cfg.host_owner)   host name: $($cfg.host_name)"
  } catch { Write-Host "host.json could not be read as JSON: $($_.Exception.Message)" }
} else { Write-Host "host.json is missing" }

Write-Host "`n== Processes"
Get-Process remoting_host, remoting_desktop, remoting_network_process -ErrorAction SilentlyContinue | Format-Table Id, ProcessName, StartTime -AutoSize

Write-Host "`n== Policies (Chrome Remote Desktop policies, if any)"
foreach ($k in "HKLM:\SOFTWARE\Policies\Google\Chrome", "HKLM:\SOFTWARE\Policies\Google\Chrome Remote Desktop") {
  if (Test-Path $k) { Get-ItemProperty $k | Format-List RemoteAccessHost* } else { Write-Host "$k : none" }
}

Write-Host "`n== Network at boot: first network events after boot"
Get-WinEvent -FilterHashtable @{ LogName = "Microsoft-Windows-NetworkProfile/Operational"; StartTime = $boot } -MaxEvents 5 -ErrorAction SilentlyContinue |
  Sort-Object TimeCreated | Format-Table TimeCreated, Id, @{ n = "Message"; e = { ($_.Message -replace "\s+", " ").Substring(0, [Math]::Min(120, $_.Message.Length)) } } -AutoSize -Wrap
Write-Host "`n== Done"
