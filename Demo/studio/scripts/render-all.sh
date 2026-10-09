#!/bin/bash
# Renders every demo video into Demo/Social media and Demo/In-person demo. Usage: bash scripts/render-all.sh [filter]
set -e
cd "$(dirname "$0")/.."
name() { case "$1" in
  01-intro) echo "1 Intro";; 02-starter) echo "2 Starter plan - Inzu Fashion";; 03-business) echo "3 Business plan - Urugo Homes";;
  04-custom) echo "4 Custom plan - Nova Phones Kigali";; 05-card) echo "5 Paying by card";; esac; }
for id in 01-intro 02-starter 03-business 04-custom 05-card 00-full; do
  for variant in social demo; do
    dir="../Social media"; [ "$variant" = demo ] && dir="../In-person demo"
    [ "$id" = 00-full ] && dir="../Full walkthrough"
    mkdir -p "$dir"
    for fmt in 16x9 9x16; do
      comp="$id-$variant-$fmt"
      [ -n "$1" ] && [[ "$comp" != *"$1"* ]] && continue
      label="landscape 16x9"; [ "$fmt" = 9x16 ] && label="vertical 9x16"
      out="$dir/$(name $id) ($label).mp4"
      if [ "$id" = 00-full ]; then kind="short, for social media"; [ "$variant" = demo ] && kind="long, for in-person demos"; out="$dir/BuPulse full walkthrough - $kind ($label).mp4"; fi
      echo "▶ $comp → $out"
      npx remotion render src/index.ts "$comp" "$out" --codec=h264 --crf=20 --audio-bitrate=192k --concurrency=3 --log=info
    done
  done
done
echo "All done."
