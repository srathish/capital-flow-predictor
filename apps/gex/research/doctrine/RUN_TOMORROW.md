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

## 3. How to read it
- **STAND ASIDE** (no strong king ≥15M): no trade. ~half of days are this — that's correct. Keep checking; a
  strong king can build later (that's how we'd catch a 07-28).
- **TREND BULL/BEAR** (tape agrees with king side, GEX concentrated): hold ONE thesis all day, in that
  direction. Expect price to push THROUGH levels. Stop ~8 pts against. Convex 0DTE in the thesis direction.
- **CHOP (fade)**: fade the king magnet — short the extension above it / long the extension below it, back to
  the king. Stop 6 pts. **Take the pop (+20-30% on the option), don't hold.** Two stops the same way → stand
  down (it's trending, not chopping).

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
