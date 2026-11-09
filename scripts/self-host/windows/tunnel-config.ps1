# Writes %USERPROFILE%\.cloudflared\bupulse-prod.yml: the hostnames the tunnel "bupulse-prod" serves from this PC
# (docs/SELF_HOST.md). Used by install.ps1 and update.ps1. Prints "changed" when the file was rewritten, so the caller
# restarts the "BuPulse tunnel" task; prints "same" otherwise.
$tunnelId = "cf9eb6ae-8290-4e87-8c8e-fc6e0c3375d0"
$credFile = Join-Path $env:USERPROFILE ".cloudflared\$tunnelId.json"
$config = Join-Path $env:USERPROFILE ".cloudflared\bupulse-prod.yml"
$hosts = @("bupulse.com", "www.bupulse.com", "support.bupulse.com")
$lines = @("tunnel: $tunnelId", "credentials-file: $credFile", "ingress:")
foreach ($h in $hosts) { $lines += "  - hostname: $h"; $lines += "    service: http://localhost:3002" }
$lines += "  - service: http_status:404"
$text = ($lines -join "`r`n") + "`r`n"
$old = if (Test-Path -LiteralPath $config) { [System.IO.File]::ReadAllText($config) } else { "" }
if ($old -eq $text) { "same"; exit 0 }
[System.IO.File]::WriteAllText($config, $text)
"changed"
