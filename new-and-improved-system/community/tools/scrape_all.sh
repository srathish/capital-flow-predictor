#!/bin/bash
cd "$(dirname "$0")"
PY="/Users/saiyeeshrathish/the final plan/.venv/bin/python"
for pair in glitch:1395387700164431995 giul:1521671060477448212 oracle-index:1398126185556344842 trade-ideas:1390160294654902272 flow-ideas:1493757196293636259 spx-regards:1374813337048842331; do
  name="${pair%%:*}"; id="${pair##*:}"
  echo "=============== $name ($id) $(date +%H:%M:%S) ==============="
  "$PY" discord_read.py "https://discord.com/channels/1364590772468449400/$id" --scrolls 2500 --out "dc_${name}.json" --download "dc_img_${name}" --max-images 4000 2>&1 | tr '\r' '\n' | tail -4
done
echo "SCRAPE ALL DONE $(date +%H:%M:%S)"
