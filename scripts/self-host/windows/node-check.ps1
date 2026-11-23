# Read-only: every node.exe on this PC with its memory, start time and the start of its command line (23 November 2026:
# the server never came up on the slow HDD; were old background refreshes piling up?). No secrets are in these command
# lines (settings travel in memory, never as arguments). Typed without Shift over Chrome Remote Desktop:
#   powershell -executionpolicy bypass -file scripts\self-host\windows\node-check.ps1
$list = Get-CimInstance Win32_Process -Filter "name='node.exe'" | Sort-Object CreationDate
foreach ($p in $list) {
  $cmd = "$($p.CommandLine)"
  if ($cmd.Length -gt 150) { $cmd = $cmd.Substring(0, 150) + "..." }
  Write-Host ("{0,6}  {1,5:N0} MB  {2:HH:mm:ss}  parent {3,6}  {4}" -f $p.ProcessId, ($p.WorkingSetSize / 1MB), $p.CreationDate, $p.ParentProcessId, $cmd)
}
Write-Host "`n$(@($list).Count) node processes"
$lock = Join-Path $env:USERPROFILE "bupulse-prod\refresh-env.lock"
if (Test-Path $lock) { Write-Host "refresh-env.lock: $((Get-Item $lock).LastWriteTime)" } else { Write-Host "refresh-env.lock: none" }
Write-Host "prod-env.json saved: $((Get-Item (Join-Path $env:USERPROFILE 'bupulse-prod\prod-env.json') -ErrorAction SilentlyContinue).LastWriteTime)"
Write-Host "`ncheck done"
