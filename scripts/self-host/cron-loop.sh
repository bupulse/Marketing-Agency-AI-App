#!/bin/zsh
# Every minute: bupulse.com's scheduled jobs (/api/cron/tick runs the routes due that UTC minute, lib/cron/tick.ts).
while true; do
  S=$(security find-generic-password -s "BuPulse production Mac cron" -a bupulse -w 2>/dev/null)
  curl -s -m 1500 -X POST -H "authorization: Bearer $S" http://127.0.0.1:3002/api/cron/tick | cut -c1-300 >> ~/bupulse-prod/cron.log
  echo " $(date -u +%FT%TZ)" >> ~/bupulse-prod/cron.log
  unset S
  sleep 60
done
