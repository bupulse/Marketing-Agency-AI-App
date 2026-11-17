# Which COM Surrogate (dllhost.exe) holds the office PC's memory (17 November 2026: one held 2.35 GB). Read-only.
# Typed without Shift over Chrome Remote Desktop:
#   powershell -executionpolicy bypass -file scripts\self-host\windows\dllhost-check.ps1
# Without administrator rights Windows hides the command line of processes owned by SYSTEM ("(hidden: needs admin)").
$os = Get-CimInstance Win32_OperatingSystem
Write-Host ("RAM free {0} GB of {1} GB; committed {2} GB" -f [math]::Round($os.FreePhysicalMemory / 1MB, 1), [math]::Round($os.TotalVisibleMemorySize / 1MB, 1), [math]::Round(($os.TotalVirtualMemorySize - $os.FreeVirtualMemory) / 1MB, 1))
$procs = Get-CimInstance Win32_Process -Filter "Name='dllhost.exe'"
foreach ($p in $procs) {
  $gp = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue
  $mb = if ($gp) { [math]::Round($gp.PrivateMemorySize64 / 1MB) } else { "?" }
  $cmd = if ($p.CommandLine) { $p.CommandLine } else { "(hidden: needs admin)" }
  Write-Host ""
  Write-Host "PID $($p.ProcessId)  private $mb MB  started $($p.CreationDate)"
  Write-Host "  $cmd"
  if ($p.CommandLine -match "\{([0-9A-Fa-f-]{36})\}") {
    $id = $Matches[1]
    foreach ($root in "HKLM:\SOFTWARE\Classes\AppID", "HKLM:\SOFTWARE\Classes\CLSID", "HKLM:\SOFTWARE\WOW6432Node\Classes\AppID", "HKLM:\SOFTWARE\WOW6432Node\Classes\CLSID") {
      $key = Join-Path $root "{$id}"
      if (Test-Path $key) {
        $name = (Get-ItemProperty $key -ErrorAction SilentlyContinue)."(default)"
        Write-Host "  $root : $name"
        $server = Join-Path $key "InprocServer32"
        if (Test-Path $server) { Write-Host "  DLL: $((Get-ItemProperty $server)."(default)")" }
      }
    }
  }
}
