#!/bin/zsh
# Puts the Video Studio online at https://video.bupulse.com through its OWN Cloudflare tunnel ("bupulse-video"),
# separate from the app's "bupulse-test" tunnel (port 3001), which keeps running untouched.
# Run it in a Terminal and leave that window open: the studio stays online while this Mac is awake.
#   1. Creates the tunnel once (needs the Cloudflare login already in ~/.cloudflared/cert.pem).
#   2. Points video.bupulse.com at it (once; "already exists" is fine).
#   3. Runs the tunnel to http://localhost:3100 (the studio; a supervisor keeps the studio itself running).
set -e
CF="$HOME/bin/cloudflared"
[ -x "$CF" ] || CF="$(dirname "$0")/cloudflared"
if [ ! -x "$CF" ]; then
  echo "cloudflared was not found (looked in ~/bin and tools/bin)."
  exit 1
fi
NAME="bupulse-video"
if ! "$CF" tunnel list 2>/dev/null | grep -q " $NAME "; then
  echo "Creating the tunnel $NAME…"
  "$CF" tunnel create "$NAME"
fi
"$CF" tunnel route dns "$NAME" video.bupulse.com 2>&1 | grep -v -i "already exists" || true
echo "Online at https://video.bupulse.com (leave this window open)."
exec "$CF" tunnel --no-autoupdate run --url http://localhost:3100 "$NAME"
