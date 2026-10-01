#!/usr/bin/env python3
"""Turn Discord channel dumps into a structured CALL LEDGER with claude -p (subscription, not API).
For each chunk of ~70 messages, the model emits one JSON line per actionable statement:
  {chan, time, author, ticker, direction, level, level_type, setup, instrument, action, reasoning, outcome, quote}
Resumable: finished chunk ids are recorded in extract_done.txt. Output: calls_<chan>.jsonl
usage: python3 extract_calls.py glitch giul trade-ideas ...
"""
import json, subprocess, sys, re
from pathlib import Path

CHUNK = 70
SCHEMA = ('{"time":"ISO","author":"","ticker":"SPY|QQQ|SPX|<stock>|null","direction":"bullish|bearish|neutral|null",'
          '"level":<number or null>,"level_type":"king|gatekeeper|pika|barney|floor|ceiling|support|resistance|vwap|range_high|range_low|fib|other|null",'
          '"setup":"rug|reverse_rug|pika_cloud|beach_ball|sandwich|rolling_ceiling|rolling_floor|liq_sweep|breakout_retest|dip_buy|fade|trend_continuation|other|null",'
          '"instrument":"0dte|weekly|swing_option|shares|futures|null","action":"call|entry|add|trim|exit|watch|warning|no_trade|lesson|result",'
          '"reasoning":"<why, in their words, <=25 words>","outcome":"win|loss|partial|unknown","quote":"<verbatim fragment <=120 chars>"}')
PROMPT = f"""You are building a trade-call ledger from a Skylit (GEX/VEX heatmap) Discord trading channel.
Below are messages in order (time | author | text [imgs=N]). Extract EVERY actionable or instructive statement:
trade calls, levels/nodes being watched, entries/adds/trims/exits, explicit warnings or no-trade statements, lessons/rules,
and reported results. Skip pure chatter, scheduling, memes, product announcements.
Output ONLY JSON lines (one object per statement, no prose, no code fences). Schema:
{SCHEMA}
Use null when unknown. "direction" is the trader's bias for that ticker. "outcome" only if the message itself reports a result.
Messages:
"""

def chunks(msgs):
    for i in range(0, len(msgs), CHUNK):
        yield i // CHUNK, msgs[i:i + CHUNK]

def fmt(m):
    imgs = sum(1 for u in m["attachments"] if "/attachments/" in u and "media.discordapp.net" not in u)
    t = (m["text"] or "").strip().replace("\n", " / ")
    return f"{(m['time'] or '')[:16]} | {m['author']} | {t[:600]}" + (f" [imgs={imgs}]" if imgs else "")

done_f = Path("extract_done.txt"); done = set(done_f.read_text().split()) if done_f.exists() else set()
for chan in sys.argv[1:]:
    msgs = [m for m in json.load(open(f"dc_{chan}.json")) if (m["text"] or "").strip()]
    out = Path(f"calls_{chan}.jsonl")
    for cid, part in chunks(msgs):
        key = f"{chan}:{cid}"
        if key in done: continue
        prompt = PROMPT + "\n".join(fmt(m) for m in part)
        try:
            r = subprocess.run(["claude", "-p", "--output-format", "text"], input=prompt, capture_output=True, text=True, timeout=600)
            rows = [l for l in r.stdout.splitlines() if l.strip().startswith("{")]
            good = 0
            with out.open("a") as f:
                for l in rows:
                    try:
                        o = json.loads(l); o["chan"] = chan; f.write(json.dumps(o) + "\n"); good += 1
                    except Exception: pass
            print(f"{key}: {len(part)} msgs -> {good} calls", flush=True)
            with done_f.open("a") as f: f.write(key + "\n")
        except subprocess.TimeoutExpired:
            print(f"{key}: TIMEOUT", flush=True)
print("EXTRACT DONE", flush=True)
