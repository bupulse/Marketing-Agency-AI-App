#!/bin/zsh
# Runs the Video Studio the way studio.bupulse.com needs it: production mode, the production env file kept OUTSIDE the
# repo, its own port (3110), from the repo this script lives in. The launchd job (tools/launchd/com.bupulse.studio.plist)
# calls this; you can also run it in a Terminal to try it. Nothing here starts a tunnel: tools/bin/studio-tunnel.sh does that.
set -e
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${STUDIO_ENV_FILE:-$HOME/.bupulse/studio.env}"
if [ ! -f "$ENV_FILE" ]; then
  echo "The production env file is missing: $ENV_FILE"
  echo "Copy tools/launchd/studio.env.example there and fill it in (see 'Going live' in docs/STUDIO_DEPLOY.md)."
  exit 1
fi
if ! grep -q '^STUDIO_ENV=production' "$ENV_FILE"; then
  echo "$ENV_FILE must contain STUDIO_ENV=production."
  exit 1
fi
cd "$REPO"
# The studio's own port, so the owner's test studio (port 3100, the TEST database) can keep running beside it.
export VIDEO_LAB_PORT="${VIDEO_LAB_PORT:-3110}"
exec node --env-file="$ENV_FILE" scripts/video-lab/start.mjs
