#!/usr/bin/env node
// Judgment layer (DESIGN_v6, live only, not backtested): an LLM reads the live money list + radar (with each name's reason) and
// labels each theme "durable bottleneck" / "one-off spike" / "unclear", with one-line reasons. Commentary only — lists unchanged.
//   node world/judge_lists.mjs world/live/2026-10-02.md
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const f = process.argv[2]; const lists = fs.readFileSync(f, 'utf8');
const prompt = `You are the judgment layer of a systematic stock-research system. Below are this month's machine-generated lists (as of the date in the header): a 20-name "money list" (companies whose own SEC numbers show accelerating revenue and widening gross margins, in an uptrend) and a ~100-name "radar" (each name has the engine and reason that flagged it). The machine cannot tell durable bottlenecks from temporary spikes, and some radar reasons are noisy keyword matches.

Task:
1. Group the names into 6–12 themes (e.g. "memory/storage", "oil refining margins", "AI networking/optics", "cybersecurity re-rating", "biotech launches"...).
2. For each theme give: the tickers, a label — DURABLE BOTTLENECK (multi-quarter supply/demand imbalance likely to persist), ONE-OFF SPIKE (cyclical/price-driven, likely to mean-revert), or UNCLEAR — and one sentence why, naming what would prove you wrong.
3. List up to 8 individual names whose machine reason looks wrong or misleading (e.g. a keyword match that has nothing to do with the business), with one line each.
4. End with 3 concrete things a human should verify before acting (data to check, not opinions).
Be concise (under 600 words), plain English, no hype, no price targets, and say clearly that this is commentary, not advice. Use only general knowledge; do not invent specific recent numbers you are unsure of — say "verify" instead.

${lists}`;
const r = spawnSync('claude', ['-p', '--disallowedTools', 'Bash,Edit,Write,WebFetch,WebSearch,Read,Glob,Grep'], { input: prompt, encoding: 'utf8', maxBuffer: 20e6, timeout: 600000 });
const out = (r.stdout || r.stderr || '').trim(); const dst = f.replace(/\.md$/, '_judgment.md'); fs.writeFileSync(dst, `# Judgment layer (commentary, not advice) — ${f}\n\n${out}\n`); console.log(out);
