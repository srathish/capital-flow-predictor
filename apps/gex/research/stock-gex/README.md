# Stock-GEX swing tool — pick stocks we like, use GEX to confirm the entry, then track it

Extends the GEX node-pattern system (king-floor, node-flip — the "Glitch model")
from 0DTE indexes to **individual stocks on weekly/monthly options, held over
days** (swing, not 0DTE). Weeklies decay far slower than 0DTE, so the same
directional node edge monetizes better — this sidesteps the theta wall that
capped the index program.

## The model (operator, 2026-07-16): GEX is the CONFIRMATION, not the finder

Three stages — we find ideas on factors, use GEX to green-light the entry, then
keep the GEX to manage the trade:

```
  1. SCREEN  screen.mjs   (UW factors, NO Skylit) ──▶ candidates.json   "stocks we like"
     + pinned.json (HOOD, GOOG archetypes)
                                   │
  2. VERIFY  verify.mjs   (current Skylit GEX) ─────▶ verdicts.json     ENTER / WAIT / AVOID now
                                   │                  (king-floor / air-pocket / ceiling-wall read)
                                   ▼
  3. TRACK   poll.mjs     (forward Skylit GEX, ~2mo) ▶ data/snapshots.jsonl
             tagged w/ each name's thesis+verdict → manage the entry (node-based exits)
             AND validate whether ENTER actually beat AVOID over the hold.
```

Why the forward track still matters (it is NOT a scanner): once we're **in**, we
have the ongoing node structure for the life of the trade — that's how we manage
exits (like the index full-surface reads), and it accrues a hindsight-proof record
to check the verify verdicts.

Two constraints shaped the plumbing:

1. **Skylit only retains ~2–3 months of history** (verified 2026-07-16: HOOD data
   back to ~mid-May, gone by mid-April) → a 6-month *backtest* is impossible, so
   the track is **forward** (which is also hindsight-proof).
2. **Never over-poll Skylit.** No 500-ticker universe: the UW screen (no Skylit)
   narrows to a handful; Skylit is touched only for those. Bounded ~10 names.

## The 0DTE-vs-swing data distinction (critical)

- **0DTE** uses column 0 of Skylit `GammaValues` (nearest expiry) — the index system.
- **Swing** uses the **AGGREGATE = sum across ALL expirations** — that's what
  `poll.mjs` stores (`g`, `v` per strike are summed over all 12 expirations). The
  further-out monthly nodes are where the multi-day dealer magnets live.

## Components

| File | Role |
|---|---|
| `screen.mjs` | **(1) SCREEN** — non-Skylit UW screener → ranks liquid, trending, unusually-active large-caps → `candidates.json`. `node research/stock-gex/screen.mjs [N=8]`. |
| `pinned.json` | Reference archetypes always included (HOOD = operator's pick; GOOG = Glitch's king-floor name). |
| `verify.mjs` | **(2) VERIFY** — pulls current Skylit aggregate GEX, grades each name's thesis (king-floor / air-pocket / ceiling-wall; pin = veto) → **ENTER/WAIT/AVOID** → `verdicts.json`. `node research/stock-gex/verify.mjs` (or `verify.mjs HOOD:bull NVDA:bear` for a manual list). |
| `poll.mjs` | **(3) TRACK** — pulls Skylit **aggregate** GEX for the verified basket, tagged with thesis+verdict, appends to `data/snapshots.jsonl`. `node research/stock-gex/poll.mjs` (add `--rth-gate` for scheduled runs). |
| `com.bellwether.stock-gex-poll.plist` | launchd job for stage 3: fires every 30 min; `--rth-gate` self-limits to weekdays 09:30–16:00 ET. |

## Screen criteria (candidate selection, NOT the GEX analysis)

Gates: Common Stock only, price $15–700, total OI ≥ 300k (tight spreads), mktcap
≥ $20B, implied move 2–15% (moves enough to swing, not a lottery ticket).
Composite score: liquidity 0.28, directional conviction 0.22, trend 0.22,
unusual-activity 0.12, move 0.08, UW-gamma-regime hint 0.08.

> **Doctrine:** the GEX/VEX *analysis* comes from **Skylit, never UW**. UW's own
> `gex_*` fields are used only as a weak *selection* hint (regime shifting = a
> possible node-flip). See memory `feedback_gexvex_source_skylit`.

## Snapshot schema (`data/snapshots.jsonl`, one line per ticker per poll)

`{ ts, ticker, spot, exps, band, nodes:[{k,g,v}], king, floor, ceiling, accel_below, accel_above, vmag }`
where `g`/`v` are **aggregate** gamma/vanna in $M; `king` = biggest |node|; `floor`
= strongest pika below spot (support); `ceiling` = strongest pika above (resistance);
`accel_*` = strongest barney below/above (acceleration/squeeze fuel); `vmag` = biggest vanna magnet.

## Patterns to test (once data accrues — same rigor as the index v2)

- **king-floor**: king pika BELOW spot acting as support → bounce long (Glitch GOOGL +371%).
- **node-flip**: king/node changing sign or the king flipping side → directional (Glitch GOOG +211%).

Test with: **mirror control** (does a king-floor bounce beat a phantom level? — the
test that killed every static index node idea), **real bid/ask fills** on the
weekly/monthly option, **walk-forward**. Fold in the one dynamic signal that
survived the index program: **vanna-velocity**.

## Auth: the stock-gex terminal needs its OWN Skylit session

Skylit's `__client` cookie **rotates on every JWT refresh** (auth.js:170). Two
processes refreshing the *same* session clobber each other → both 401 and die. The
live index tracker + Railway app already share one session (session A, via Postgres,
because root `.env` sets `DATABASE_URL`). So the stock-gex tools must run on a
**second, isolated session** — otherwise they'd knock the live tracker offline.

Isolation needs **no code change** — two env vars pin this terminal to its own session:

```bash
# 1. Capture a 2nd Skylit login's cookies into session-b.env (see session-b.env.example)
cp research/stock-gex/session-b.env.example research/stock-gex/session-b.env   # then fill it in

# 2. Run the stock-gex tools with ENV_FILE + ENV_FILE_PATH pointed at it:
ENV_FILE="$PWD/research/stock-gex/session-b.env" \
ENV_FILE_PATH="$PWD/research/stock-gex/session-b.env" \
  /usr/local/bin/node research/stock-gex/poll.mjs        # or verify.mjs
```

- `ENV_FILE` → `_env-bootstrap` loads it last with `override:true` → session B wins.
- `ENV_FILE_PATH` → cookie rotations persist back to `session-b.env`, never root `.env`.
- `DATABASE_URL=` (empty) in the file → `initAuth` skips Postgres, uses session B from the file.

The launchd plist already sets both vars. **Use session B for BOTH tools** (verify
and poll) whenever the live tracker is running — verify only refreshes ~once per run
(the JWT caches ~55s across all 10 names), but that one refresh can still trigger a
rotation, so keep it off session A. verify may use session A only if the live tracker
is stopped.

## Verify grading (stage 2, the entry gate)

Per name, for its thesis side: **support** (strongest pika below for BULL / above
for BEAR) × proximity, minus **block** (opposing pika wall near spot = CAP), plus
bonuses for **king-floor** (king IS the support) and a **barney in front** (squeeze
fuel / air pocket). A dominant pika **AT spot = PIN → capped at WAIT** (no
directional edge; wait for a break). Score → ENTER (≥62) / WAIT (≥42) / AVOID.
Advisory to inform a discretionary entry, **not** a validated mechanical signal.

## Status

- 2026-07-16: three-stage tool built + verified end-to-end. First basket: AAPL NFLX
  GOOGL IBM ORCL SOFI CRWD MSFT (screened) + HOOD GOOG (pinned). **Today's verify:
  AAPL BULL ENTER (84, king-floor 325 + clear headroom)** the lone confirmed entry;
  NFLX/SOFI WAIT (pinned at king); GOOGL/ORCL AVOID (capped / support against thesis);
  HOOD/GOOG/MSFT/CRWD/IBM WAIT. Forward TRACK begins on schedule load; basket frozen
  for the window (re-run screen→verify to start a new cohort).
