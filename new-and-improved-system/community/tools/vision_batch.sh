#!/bin/bash
# Triage real screenshots (>40KB) and describe them with claude -p (subscription), 3 per call, JSONL out.
cd "$(dirname "$0")"
OUT=discord_vision.jsonl; touch "$OUT"
LIST=$(mktemp)
DIRS="${VISION_DIRS:-dc_img_glitch dc_img_giul dc_img_trade-ideas dc_img_flow-ideas dc_img_oracle-non-index dc_img_oracle-index}"
for d in $DIRS; do [ -d "$d" ] && find "$d" -type f -size +40k \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.webp' \) ; done | sort > "$LIST"
TOTAL=$(wc -l < "$LIST"); echo "real screenshots: $TOTAL"
# skip already-described
grep -o '"file": *"[^"]*"' "$OUT" | sed -E 's/"file": *"//; s/"$//' | sort > done.txt
comm -23 "$LIST" done.txt > todo.txt
echo "to do: $(wc -l < todo.txt)"
rm -f batch_*; split -l 3 -a 4 todo.txt batch_   # 4-char suffix: default 2-char caps at 676 batches
n=0
for b in batch_*; do
  n=$((n+1)); files=$(cat "$b" | tr '\n' ' ')
  prompt="You are reading trading screenshots from a Skylit (GEX/VEX heatmap) Discord. For EACH file path below, use the Read tool to view it, then output EXACTLY one JSON object per image on its own line, nothing else. Schema: {\"file\":<path>,\"kind\":\"heatmap|chart|chart+heatmap|pnl|table|text|other\",\"ticker\":<string or null>,\"timeframe\":<string or null>,\"spot\":<number or null>,\"levels\":[{\"price\":<num>,\"label\":<king|gatekeeper|pika|barney|floor|ceiling|support|resistance|target|stop|other>,\"note\":<short>}],\"pattern\":<rug|reverse_rug|pika_cloud|beach_ball|whipsaw|rainbow_road|rolling_floor|rolling_ceiling|none|null>,\"direction_call\":<bullish|bearish|neutral|null>,\"pnl\":{\"ticker\":..,\"contract\":..,\"pct\":..,\"dollars\":..} or null,\"summary\":<one sentence>}. Files: $files"
  echo "$prompt" | claude -p --allowedTools Read --output-format text 2>/dev/null | grep -E '^\s*\{' >> "$OUT"
  echo "batch $n done ($(wc -l < "$OUT") rows)"
  rm -f "$b"
done
echo "VISION DONE: $(wc -l < "$OUT") rows"
