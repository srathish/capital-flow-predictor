# Run the system tomorrow — operator checklist

## ⚠️ Day-1 reality
Zero forward-validated days. The +88 pts / +6.8-per-trade is IN-SAMPLE on 19 historical days, on the
underlying — not real option fills. **Tomorrow is validation day 1. Paper-trade or trade MINIMUM size.**
Do not bet big. The co-pilot logs every read so tomorrow becomes real data.

## 1. Pre-open (by ~9:15 ET) — auth check
```
cd "apps/gex"
ENV_FILE=research/stock-gex/session-b.env ENV_FILE_PATH=research/stock-gex/session-b.env DATABASE_URL= \
  /usr/local/bin/node research/doctrine/live_copilot.mjs
```
If it prints a snapshot → session B is good. If it says "SKYLIT AUTH FAILED" → re-auth:
`cfp-jobs skylit-login --env-file research/stock-gex/session-b.env`  (do the Discord popup).

## 2. Cash open → run the loop (re-reads every 15 min)
```
ENV_FILE=research/stock-gex/session-b.env ENV_FILE_PATH=research/stock-gex/session-b.env DATABASE_URL= \
  /usr/local/bin/node research/doctrine/live_copilot.mjs --loop 15
```
Do NOT act before ~10:00-10:30 — let the 0DTE structure and tape form.

## 3. How to read it — the co-pilot prints everything
The tool marks the MAP + the RULES; you react (it never forecasts direction — that's proven impossible).
Each refresh shows: SPX spot · TRINITY (aligned=trend / diverging=chop) · tape · VIX regime · the KING and
the pika ceiling/floor + barney accelerants, each with a **reach%** (validated prob price gets there), and
the **DIRECTION-FREE LOOP** contextualized to right now.

- **STAND ASIDE** (no strong king ≥15M): no trade. ~half of days. A strong king can build later (07-28 case).
- **TREND** (trinity aligned + tape/king agree): ride a confirmed move to the next pika = your EXIT. A barney
  ahead = accelerant → ride through it. Stop ~8 pts against.
- **CHOP / RANGE**: fade the walls back toward the king. Stop ~6. Two stops same way → stand down.
- **At any pika**: expect reversal (79%; vanna+ holds/deflect 74%, vanna− breaks). Wait for the retrace.
- **FAILED-REACH (the strong tell)**: if price stalls ~4pt SHORT of a pika and rejects *without touching* →
  fade HARDER (reverses ~7-9pt vs ~4pt). The wall rejected price before contact = 2× snapback.
- Reach% tells you conviction on getting to a level: big/far node = low reach (pins); small/close = high.

## 4. Every trade (Falcon's execution — non-negotiable)
- Cheap CONVEX 0DTE in the signal direction. Identical size every trade.
- **Manage the pop: exit +20-30%. NEVER hold 0DTE to expiry** (real data: 2 of 3 Falcon puts expired near $0;
  his gains were all management).
- Few trades. When in doubt, stand aside.

## 5. After close (~16:05) — log the day for validation
```
ENV_FILE=research/stock-gex/session-b.env ENV_FILE_PATH=research/stock-gex/session-b.env DATABASE_URL= \
  bash research/doctrine/run_forward.sh <tomorrow's date YYYY-MM-DD>
```
This pulls the full day, re-scores it, prices the signals on REAL 0DTE marks, and appends to forward_log.txt.
After ~2 weeks of this we have a real expectancy number — the thing that decides if this is a real system.

## Levels legend
king = dominant pika (magnet/wall). call/put wall = strongest pika above/below spot. barney = negative-gamma
node (accelerant): price BREAKS through it (trapdoor), doesn't bounce. Pika = price BOUNCES (deflection).
