#!/bin/zsh
# Waits until bupulse.com is served through the Cloudflare tunnel (no longer "server: Netlify"), then starts the
# scheduled-jobs loop once and exits. Until then Netlify's old scheduled functions keep running the jobs.
while true; do
  SERVER=$(curl -sI -m 20 https://bupulse.com/api/status | tr -d '\r' | awk -F': ' 'tolower($1)=="server"{print tolower($2)}')
  if [ -n "$SERVER" ] && [ "$SERVER" != "netlify" ]; then
    echo "$(date -u +%FT%TZ) bupulse.com now served by '$SERVER': starting the cron loop" >> ~/bupulse-prod/switch.log
    (nohup ~/bupulse-prod/cron-loop.sh >> ~/bupulse-prod/cron.log 2>&1 &)
    exit 0
  fi
  sleep 60
done
