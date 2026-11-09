# Every minute: bupulse.com's scheduled jobs (/api/cron/tick runs the routes due that UTC minute, lib/cron/tick.ts).
# The Windows twin of scripts/self-host/cron-loop.sh. Run by the "BuPulse jobs" task, and only on ONE computer at a time.
#
# Also every minute, on its own thread so a long tick never delays it: the PC's heartbeat for the support app's Server
# page (POST /api/monitor/heartbeat, same secret): CPU, memory, disks, restart time, the three tasks, node and
# cloudflared versions. Everything about the heartbeat is inside its own try/catch: if it fails, the tick goes on as
# before. Its failures go to heartbeat.log (only when something changes), never to cron.log. Windows PowerShell 5.1.
$logs = Join-Path $env:USERPROFILE "bupulse-prod"
$log = Join-Path $logs "cron.log"

$heartbeat = {
  param($logs, $repo)
  $hbLog = Join-Path $logs "heartbeat.log"
  # A new thread starts with no modules loaded; load the ones used below (all part of Windows 10).
  Import-Module CimCmdlets, ScheduledTasks, NetTCPIP -ErrorAction SilentlyContinue
  $last = "ok"
  $versions = $null
  $versionsAt = [DateTime]::MinValue
  while ($true) {
    try {
      # Versions change only with an update: read them once every 6 hours.
      if ($null -eq $versions -or ((Get-Date) - $versionsAt).TotalHours -ge 6) {
        $node = $null; $cf = $null
        try { $node = ((& node --version 2>&1) | Select-Object -First 1) } catch { }
        try { $cf = ((& cloudflared --version 2>&1) | Select-Object -First 1) } catch { }
        $versions = @{ node = "$node".Trim(); cloudflared = "$cf".Trim() }
        $versionsAt = Get-Date
      }

      $os = Get-CimInstance Win32_OperatingSystem
      $cpu = $null
      try { $cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average } catch { }

      $systemDrive = "$env:SystemDrive".ToUpper()
      $repoDrive = $null
      try { $repoDrive = (Split-Path -Qualifier $repo).ToUpper() } catch { }
      $disks = @()
      foreach ($name in @(@($systemDrive, $repoDrive) | Where-Object { $_ } | Select-Object -Unique)) {
        $roles = @()
        if ($name -eq $systemDrive) { $roles += "system" }
        if ($name -eq $repoDrive) { $roles += "repo" }
        $d = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$name'"
        if ($d -and $d.Size) {
          $disks += @{ name = $name; roles = $roles; freeGb = [Math]::Round($d.FreeSpace / 1GB, 1); totalGb = [Math]::Round($d.Size / 1GB, 1) }
        }
      }

      $tasks = @()
      foreach ($taskName in "BuPulse server", "BuPulse tunnel", "BuPulse jobs") {
        $state = "Unknown"
        try {
          $state = (Get-ScheduledTask -TaskName $taskName -ErrorAction Stop).State.ToString()
        } catch {
          if ("$($_.Exception.Message)" -match "No MSFT_ScheduledTask") { $state = "Missing" }
        }
        $tasks += @{ name = $taskName; state = $state }
      }

      $listening = $null
      try { $listening = [bool](Get-NetTCPConnection -LocalPort 3002 -State Listen -ErrorAction SilentlyContinue) } catch { }

      $body = @{
        machine = $env:COMPUTERNAME
        os = "$($os.Caption) $($os.Version)".Trim()
        bootAt = "$($os.LastBootUpTime.ToUniversalTime().ToString('s'))Z"
        cpuPercent = $cpu
        memTotalMb = [Math]::Round($os.TotalVisibleMemorySize / 1024)
        memUsedMb = [Math]::Round(($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / 1024)
        disks = $disks
        tasks = $tasks
        serverListening = $listening
        nodeVersion = $versions.node
        cloudflaredVersion = $versions.cloudflared
      }
      $json = ConvertTo-Json -InputObject $body -Depth 4 -Compress
      $secret = (Get-Content (Join-Path $logs "cron-secret.txt") -Raw).Trim()
      Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3002/api/monitor/heartbeat" -Headers @{ Authorization = "Bearer $secret" } -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($json)) -TimeoutSec 20 | Out-Null
      Remove-Variable secret -ErrorAction SilentlyContinue
      if ($last -ne "ok") { Add-Content $hbLog "heartbeat ok again $((Get-Date).ToUniversalTime().ToString('s'))Z" }
      $last = "ok"
    } catch {
      Remove-Variable secret -ErrorAction SilentlyContinue
      $message = "$($_.Exception.Message)"
      if ($message -ne $last) {
        try { Add-Content $hbLog "heartbeat failed: $message $((Get-Date).ToUniversalTime().ToString('s'))Z" } catch { }
      }
      $last = $message
    }
    Start-Sleep -Seconds 60
  }
}

# The heartbeat's own thread. If it cannot start, the jobs below still run.
$heartbeatRunner = $null
try {
  $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
  $heartbeatRunner = [PowerShell]::Create()
  [void]$heartbeatRunner.AddScript($heartbeat).AddArgument($logs).AddArgument($repoRoot)
  [void]$heartbeatRunner.BeginInvoke()
} catch {
  try { Add-Content (Join-Path $logs "heartbeat.log") "heartbeat could not start: $($_.Exception.Message) $((Get-Date).ToUniversalTime().ToString('s'))Z" } catch { }
}

while ($true) {
  try {
    $secret = (Get-Content (Join-Path $logs "cron-secret.txt") -Raw).Trim()
    $answer = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3002/api/cron/tick" -Headers @{ Authorization = "Bearer $secret" } -TimeoutSec 1500
    $text = ($answer | ConvertTo-Json -Compress -Depth 6)
    Add-Content $log "$($text.Substring(0, [Math]::Min(300, $text.Length))) $((Get-Date).ToUniversalTime().ToString('s'))Z"
  } catch {
    Add-Content $log "tick failed: $($_.Exception.Message) $((Get-Date).ToUniversalTime().ToString('s'))Z"
  }
  Remove-Variable secret -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 60
}
