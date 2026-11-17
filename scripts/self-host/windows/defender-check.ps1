# Read-only: what Microsoft Defender found and did (17 November 2026: offline scan after a fake "dlIhost" held 2.35 GB).
# Typed without Shift over Chrome Remote Desktop:
#   powershell -executionpolicy bypass -file scripts\self-host\windows\defender-check.ps1
try {
  $s = Get-MpComputerStatus -ErrorAction Stop
  Write-Host "Real-time protection: $($s.RealTimeProtectionEnabled)  antivirus on: $($s.AntivirusEnabled)  signatures: $($s.AntivirusSignatureLastUpdated)"
  Write-Host "Last quick scan: $($s.QuickScanEndTime)  last full scan: $($s.FullScanEndTime)"
} catch { Write-Host "Status: (not readable: $($_.Exception.Message))" }

Write-Host "`n== Threats Defender detected (newest first)"
try {
  $d = Get-MpThreatDetection -ErrorAction Stop | Sort-Object InitialDetectionTime -Descending | Select-Object -First 15
  if (-not $d) { Write-Host "none" }
  foreach ($x in $d) {
    $t = Get-MpThreat -ThreatID $x.ThreatID -ErrorAction SilentlyContinue
    Write-Host "$($x.InitialDetectionTime)  $($t.ThreatName)  action ok: $($x.ActionSuccess)  status: $($x.ThreatStatusID)"
    Write-Host "  $($x.Resources -join '; ')"
  }
} catch { Write-Host "(not readable without admin: $($_.Exception.Message))" }

Write-Host "`n== Defender event log: detections (1116), actions (1117), offline scan (2050/1000-1002), last 7 days"
try {
  Get-WinEvent -FilterHashtable @{ LogName = "Microsoft-Windows-Windows Defender/Operational"; Id = 1000, 1001, 1002, 1116, 1117, 1118, 1119; StartTime = (Get-Date).AddDays(-7) } -MaxEvents 30 -ErrorAction Stop |
    ForEach-Object { Write-Host "$($_.TimeCreated)  id $($_.Id)  $(($_.Message -split "`n")[0..6] -join ' | ')" }
} catch { Write-Host "(none or not readable: $($_.Exception.Message))" }

Write-Host "`n== Windows Defender offline scan results folder"
$off = "C:\Windows\Microsoft Antimalware\Support"
if (Test-Path $off) { Get-ChildItem $off -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 5 Name, LastWriteTime | Format-Table -AutoSize } else { Write-Host "(no folder)" }
Write-Host "check done"
