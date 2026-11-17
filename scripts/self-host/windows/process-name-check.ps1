# Read-only: processes whose names imitate Windows system programs (17 November 2026: a "dlIhost" with a capital I,
# not "dllhost", held 2.35 GB of the office PC's memory). Prints each suspicious name letter by letter, its PID, memory,
# start time and file path (the path of a SYSTEM process is only visible from an administrator window).
#   powershell -executionpolicy bypass -file scripts\self-host\windows\process-name-check.ps1
$real = "svchost", "dllhost", "lsass", "csrss", "winlogon", "services", "smss", "explorer", "taskhostw", "conhost", "rundll32", "spoolsv", "wininit", "searchhost", "runtimebroker"
$norm = { param($s) $s.ToLower().Replace("1", "l").Replace("0", "o") }
foreach ($p in Get-Process) {
  $n = $p.ProcessName
  $looksLike = $real | Where-Object { (& $norm $n) -eq $_ -or ($n.Length -eq $_.Length -and (& $norm $n) -ne $_ -and ([regex]::Replace($n.ToLower(), "[il1|]", "l") -eq $_)) }
  if ($looksLike -and ($real -cnotcontains $n)) {
    $codes = ($n.ToCharArray() | ForEach-Object { "$_=" + [int]$_ }) -join " "
    $w = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.Id)" -ErrorAction SilentlyContinue
    Write-Host "SUSPICIOUS: '$n' looks like '$looksLike'  PID $($p.Id)  private $([math]::Round($p.PrivateMemorySize64 / 1MB)) MB"
    Write-Host "  letters: $codes"
    Write-Host "  started: $($w.CreationDate)  parent PID: $($w.ParentProcessId)"
    Write-Host "  path: $(if ($w.ExecutablePath) { $w.ExecutablePath } else { '(hidden: needs admin)' })"
    Write-Host "  command: $(if ($w.CommandLine) { $w.CommandLine } else { '(hidden: needs admin)' })"
  }
}
Write-Host "check done"
