# What holds the office PC's memory (17 November 2026: memory climbs to ~80% a few hours after each restart, then the
# disk thrashes and the site and tunnel time out). Read-only. Typed without Shift over Chrome Remote Desktop:
#   powershell -executionpolicy bypass -file scripts\self-host\windows\memory-check.ps1
$os = Get-CimInstance Win32_OperatingSystem
$totalGb = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
$freeGb = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
$commitGb = [math]::Round(($os.TotalVirtualMemorySize - $os.FreeVirtualMemory) / 1MB, 1)
$limitGb = [math]::Round($os.TotalVirtualMemorySize / 1MB, 1)
$up = (Get-Date) - $os.LastBootUpTime
Write-Host "RAM $totalGb GB, free $freeGb GB; committed $commitGb of $limitGb GB; up $([int]$up.TotalHours) h $($up.Minutes) min"

$perf = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory
Write-Host ("Pool: paged {0} MB, non-paged {1} MB; cache {2} MB; page faults/s {3}; pages/s {4}" -f `
  [math]::Round($perf.PoolPagedBytes / 1MB), [math]::Round($perf.PoolNonpagedBytes / 1MB), [math]::Round($perf.CacheBytes / 1MB), $perf.PageFaultsPersec, $perf.PagesPersec)

Write-Host "`n== Top 20 processes by committed (private) memory"
Get-Process | Sort-Object PrivateMemorySize64 -Descending | Select-Object -First 20 `
  @{ n = "Private MB"; e = { [math]::Round($_.PrivateMemorySize64 / 1MB) } },
  @{ n = "In RAM MB"; e = { [math]::Round($_.WorkingSet64 / 1MB) } },
  Id, ProcessName, @{ n = "Started"; e = { try { $_.StartTime.ToString("HH:mm") } catch { "" } } } |
  Format-Table -AutoSize

Write-Host "== Totals by program name (top 12, private MB)"
Get-Process | Group-Object ProcessName | ForEach-Object {
  [pscustomobject]@{ Name = $_.Name; Count = $_.Count; "Private MB" = [math]::Round((($_.Group | Measure-Object PrivateMemorySize64 -Sum).Sum) / 1MB) }
} | Sort-Object "Private MB" -Descending | Select-Object -First 12 | Format-Table -AutoSize

Write-Host "== Disk: busiest processes right now (bytes/s, one sample)"
Get-CimInstance Win32_PerfFormattedData_PerfProc_Process |
  Where-Object { $_.Name -ne "_Total" -and $_.Name -ne "Idle" } |
  Sort-Object IODataBytesPersec -Descending | Select-Object -First 10 Name, IDProcess,
  @{ n = "IO KB/s"; e = { [math]::Round($_.IODataBytesPersec / 1KB) } }, @{ n = "Private MB"; e = { [math]::Round($_.PrivateBytes / 1MB) } } |
  Format-Table -AutoSize

Write-Host "== Services set to start automatically that are not Microsoft's (name, state)"
Get-CimInstance Win32_Service -Filter "StartMode='Auto'" |
  Where-Object { $_.PathName -notmatch "\\Windows\\" } |
  Select-Object Name, State, ProcessId, @{ n = "Program"; e = { ($_.PathName -split '\\')[-1].Trim('"') } } |
  Format-Table -AutoSize
