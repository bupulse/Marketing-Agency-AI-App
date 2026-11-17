#!/bin/sh
# Installs bupulse.com's automatic failover on this Mac as three launchd jobs (they start at login and are restarted when
# they stop): the standby server (serve.mjs), its tunnel (bupulse-studio, config ~/.cloudflared/bupulse-prod-mac.yml)
# and the watcher (watch.mjs). Run again to update; `install.sh remove` takes them away. Logs in ~/bupulse-prod.
# Needs first: ~/BuPulse-deploy built at the production version, config.json's zoneId, and the Keychain item
# "BuPulse Cloudflare DNS" (account bupulse) holding a Cloudflare token that may edit bupulse.com's DNS only.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
agents="$HOME/Library/LaunchAgents"
logs="$HOME/bupulse-prod"
node="$(command -v node)"
path="$(dirname "$node"):$HOME/.local/bin:$HOME/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
mkdir -p "$agents" "$logs"

job() { # label, then the program and its arguments
  label="$1"; shift
  plist="$agents/$label.plist"
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  [ "${remove:-}" = 1 ] && { rm -f "$plist"; echo "removed $label"; return; }
  {
    echo '<?xml version="1.0" encoding="UTF-8"?>'
    echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
    echo '<plist version="1.0"><dict>'
    echo "<key>Label</key><string>$label</string>"
    echo '<key>ProgramArguments</key><array>'
    for a in "$@"; do echo "<string>$a</string>"; done
    echo '</array>'
    echo "<key>EnvironmentVariables</key><dict><key>PATH</key><string>$path</string></dict>"
    echo '<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>30</integer>'
    echo "<key>StandardOutPath</key><string>$logs/$label.log</string>"
    echo "<key>StandardErrorPath</key><string>$logs/$label.log</string>"
    echo '</dict></plist>'
  } > "$plist"
  launchctl bootstrap "gui/$(id -u)" "$plist"
  echo "installed $label"
}

[ "${1:-}" = remove ] && remove=1
job com.bupulse.failover.server "$node" "$here/serve.mjs"
job com.bupulse.failover.tunnel "$HOME/bin/cloudflared" tunnel --no-autoupdate --config "$HOME/.cloudflared/bupulse-prod-mac.yml" run
# caffeinate -i: the Mac does not go to sleep on its own while the watcher runs (a closed lid still sleeps).
job com.bupulse.failover.watch /usr/bin/caffeinate -i "$node" "$here/watch.mjs"
