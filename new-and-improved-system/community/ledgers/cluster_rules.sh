#!/bin/bash
cd "$(dirname "$0")"
split -l 300 -a 3 rules_input.txt rules_part_
: > rules_clusters_partial.md
for p in rules_part_*; do
  { echo "Below are trading rules/warnings/no-trade statements from Skylit Discord callers (Glitch, Giul, Hamoudi, TheArchitect, jack). Format: [author|kind|date] paraphrase || \"quote\". Group them into recurring RULES. For each rule output a markdown bullet: **Rule** (who says it, count of statements) — 1-line meaning — 1-2 verbatim quotes with dates. Order by count. Also list rules that seem to CONTRADICT each other. Be exhaustive; no intro text."; cat "$p"; } | claude -p --output-format text >> rules_clusters_partial.md 2>/dev/null
  echo "" >> rules_clusters_partial.md; echo "done $p"
done
{ echo "Merge these partial rule clusters (from several batches) into ONE deduplicated list. Sum counts across batches for the same rule. Output: a markdown section '## Recurring rules' (ordered by total count; each: **Rule** — meaning — who — total count — 2 best verbatim quotes with dates), then '## Contradictions / conditional rules', then '## Rules that are about NOT trading'. No intro."; cat rules_clusters_partial.md; } | claude -p --output-format text > rules_clusters.md 2>/dev/null
echo "CLUSTER DONE $(wc -l < rules_clusters.md) lines"
