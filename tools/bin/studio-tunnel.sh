#!/bin/zsh
# Puts the Video Studio online at https://studio.bupulse.com through its OWN Cloudflare tunnel ("bupulse-studio"),
# separate from the owner's test studio tunnel ("bupulse-video", video.bupulse.com, port 3100) and the app's tunnel,
# which keep running untouched. The production studio listens on port 3110 (tools/bin/studio-run.sh).
# Run it in a Terminal and leave that window open (or let launchd keep it: tools/launchd/com.bupulse.studio-tunnel.plist).
#   1. Creates the tunnel once (needs the Cloudflare login already in ~/.cloudflared/cert.pem).
#   2. Points studio.bupulse.com at it (once; "already exists" is fine).
#   3. Runs the tunnel to http://localhost:3110.
set -e
CF="$HOME/bin/cloudflared"
[ -x "$CF" ] || CF="$(dirname "$0")/cloudflared"
if [ ! -x "$CF" ]; then
  echo "cloudflared was not found (looked in ~/bin and tools/bin)."
  exit 1
fi
NAME="bupulse-studio"
PORT="${VIDEO_LAB_PORT:-3110}"
if ! "$CF" tunnel list 2>/dev/null | grep -q " $NAME "; then
  echo "Creating the tunnel $NAME…"
  "$CF" tunnel create "$NAME"
fi
"$CF" tunnel route dns "$NAME" studio.bupulse.com 2>&1 | grep -v -i "already exists" || true
echo "Online at https://studio.bupulse.com (the studio must be running on port $PORT; leave this window open)."
exec "$CF" tunnel --no-autoupdate run --url "http://localhost:$PORT" "$NAME"
