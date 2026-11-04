# Every minute: bupulse.com's scheduled jobs (/api/cron/tick runs the routes due that UTC minute, lib/cron/tick.ts).
# The Windows twin of scripts/self-host/cron-loop.sh. Run by the "BuPulse jobs" task, and only on ONE computer at a time.
$logs = Join-Path $env:USERPROFILE "bupulse-prod"
$log = Join-Path $logs "cron.log"
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
