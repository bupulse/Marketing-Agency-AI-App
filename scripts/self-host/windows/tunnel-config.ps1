# Writes %USERPROFILE%\.cloudflared\bupulse-prod.yml: the hostnames the tunnel "bupulse-prod" serves from this PC
# (docs/SELF_HOST.md). Used by install.ps1 and update.ps1. Prints "changed" when the file was rewritten, so the caller
# restarts the tunnel (update.ps1: the supervisor's restart-tunnel file); prints "same" otherwise.
$tunnelId = "cf9eb6ae-8290-4e87-8c8e-fc6e0c3375d0"
$credFile = Join-Path $env:USERPROFILE ".cloudflared\$tunnelId.json"
$config = Join-Path $env:USERPROFILE ".cloudflared\bupulse-prod.yml"
# marketing. and admin. (docs/HOSTS.md) are served only once MARKETING_APP_URL / ADMIN_APP_URL are set; until then
# they show the main site, and nothing links to them. agency. is phase 2: not here yet.
# pc. is only for the Mac's failover watcher (scripts/self-host/mac-failover): it always reaches this PC, wherever the
# public hostnames point, so the Mac can tell when the PC answers again.
$hosts = @("bupulse.com", "www.bupulse.com", "support.bupulse.com", "marketing.bupulse.com", "admin.bupulse.com", "pc.bupulse.com")
# protocol http2 (TCP), not QUIC (UDP): on the office network the PC's QUIC connections kept timing out ("failed to
# accept QUIC stream: timeout: no recent network activity"), so the tunnel dropped every few minutes (17 November 2026).
$lines = @("tunnel: $tunnelId", "credentials-file: $credFile", "protocol: http2", "ingress:")
foreach ($h in $hosts) { $lines += "  - hostname: $h"; $lines += "    service: http://localhost:3002" }
$lines += "  - service: http_status:404"
$text = ($lines -join "`r`n") + "`r`n"
$old = if (Test-Path -LiteralPath $config) { [System.IO.File]::ReadAllText($config) } else { "" }
if ($old -eq $text) { "same"; exit 0 }
[System.IO.File]::WriteAllText($config, $text)
"changed"
