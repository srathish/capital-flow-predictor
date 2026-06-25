# 07 — Automation Plan

What to build, where, in what order. The goal is to compress the
60-second decision in `04-signal-stack.md` into a 5-second glance.

## Build into existing infrastructure

Don't make a new app. Sniper is a *view* on top of what already
exists:

- **`apps/gex`** — already produces SPY/QQQ GEX walls, gamma flip,
  net GEX, regime tags. Owns server-side ladder confluence.
- **`apps/web`** — owns the `/sniper` UI tab. Reads from `apps/gex`
  and from a quote/EMA feed.
- **`apps/api`** — stores ladders + trade journal.
- **`apps/discord_listener`** — optional: auto-ingest Rapid posts.

## Phase 1 — manual ladder, live stack (1–2 days of work)

The minimum useful build. Get the cockpit on screen.

### `apps/gex` — new endpoints

```
POST  /v1/sniper/ladder
  body: { ticker, session_date, pivot, bull{...}, bear{...} }
  → stores the ladder for today

GET   /v1/sniper/ladder/:ticker
  → returns the active ladder + per-rung confluence:
    {
      rung: 740.0,
      role: "TARGET_1",
      direction: "bull",
      wall_within_1pt: { strike: 740, size: 3.1e9, type: "call" },
      gex_regime: "TRENDING",
      flip: 737.10,
      score_contribution: { wall: +1, regime: +1 }
    }
```

The endpoint just enriches each rung with the GEX context. The
EMA / candle-close part runs client-side in `apps/web` against
the quote stream.

### `apps/web` — new `/sniper` tab

Layout (top to bottom):

```
┌────────────────────────────────────────────────────────────────┐
│ SPY  738.42  ▲0.31%   |   gex: TRENDING / NEG / wall 740C (3.1B)│
│ QQQ  528.20  ▼0.05%   |   gex: PINNING  / POS / wall 530C (2.4B)│
└────────────────────────────────────────────────────────────────┘
┌─── SPY ladder ──────────── live state ────── confluence ────────┐
│ 742.9     extension                   wall→ —          —        │
│ 741.88    extension                   wall→ 742C 3.1B  ★★       │
│ 740.8     break confirm                                ★★       │
│ 740.0     target_1            ← spot  wall→ 740C 3.1B  ★★★      │
│ 738.9     reclaim trigger     (armed) wall→ —          ★        │
│ ── 737.9 pivot ────────────────────────────                     │
│ 736.83    failure trigger                              ★        │
│ 735.9     break confirm               wall→ 735P 2.8B  ★★       │
│ 735–734   extension                   wall→ —          ★        │
│ 732.8     extension                                              │
└──────────────────────────────────────────────────────────────────┘
┌─── stack panel ────┐  ┌─── signal ──────┐
│ 1m  8 EMA: 738.10  │  │ score: 4/5      │
│ 5m  8 EMA: 737.94  │  │ direction: LONG │
│ 5m 21 EMA: 737.42  │  │ rung: 738.9     │
│ 5m stack: ↑ aligned│  │ status: ARMED   │
│ 15m stack: ↑       │  │ next: confirm   │
└────────────────────┘  └─────────────────┘
```

Pieces:

1. **Header strip** — pulls from `apps/gex /v1/regime` (already
   exists) every 60s.
2. **Ladder panel** — paste-in form to set today's rungs (one click
   "load latest" from `apps/discord_listener` if Phase 2 is built).
3. **Stack panel** — client-side EMA calc on a 1m bar stream
   (Polygon WS, or whatever apps/uw_socket already gives us).
4. **Signal panel** — runs the 5-input scorer from
   `04-signal-stack.md` once per closed 1m bar. Three states:
   `WATCH`, `ARMED`, `FIRE`.
   - `WATCH` — price near a rung but no body close yet.
   - `ARMED` — body close past rung, waiting for retest hold.
   - `FIRE` — retest held, all 5 checks pass, time-of-day clean.
5. **Audio cue on FIRE** — single short tone. Sniper is meant to be
   passively monitored.

## Phase 2 — auto-ingest the ladder (optional, 1 day)

`apps/discord_listener` already watches Discord channels. Add a
parser:

- Filter to Rapid Trading channel.
- Match messages with `$SPY` or `$QQQ` + the key tokens
  (`hold`, `reclaim`, `break`, `room to`, `gap`).
- Extract numbers in order, assign to ladder slots by keyword
  position.
- POST to `apps/gex /v1/sniper/ladder`.
- Notify in `/sniper` UI: "ladder loaded from Rapid post 09:12 ET."

Edge cases: multiple ladder updates during the day (treat as
*replace*, not merge); typos / shorthand (regex-tolerant numeric
extraction).

## Phase 3 — execution helpers (optional, 1–2 days)

Not auto-trading. Just the manual-execution boost:

- **Strike picker**: given the armed rung, the next target rung, and
  current price, pre-compute the recommended strike + delta + a
  ballpark fill price. Click → opens the broker order ticket
  pre-filled (only if your broker supports deep-linking).
- **Take-profit calculator**: estimate option premium at TARGET_1
  using current delta/gamma, show on the signal panel.
- **Trade ticket logger**: after a fill, one form to log the snipe
  to `apps/api` for the trade journal.

## Phase 4 — backtest hooks (1 week, deferred)

This is where the sniper proves itself.

Reuse `apps/backtester` infrastructure:

- Source 1m SPY/QQQ bars for the last 12 months.
- For each session day, reconstruct (or hand-label) the Rapid ladder.
  If hand-labeling is too expensive, *infer* a synthetic ladder from
  premarket high/low + first 30 min levels — this won't match Rapid
  exactly but will test the framework.
- Replay GEX snapshots from `apps/gex` historic data (you keep this,
  right? if not, this is the blocker — start saving snapshots now).
- Simulate the 5-input scoring on every rung touch.
- Simulate trades at score ≥ 4 with the execution rules from
  `05-execution.md` and risk rules from `06-risk-rules.md`.
- Output: hit rate, average R, distribution by score, distribution by
  rung type, drawdown profile, calendar buckets.

Decision rules from the backtest:

- Hit rate by score must monotonically increase (5 > 4 > 3). If it
  doesn't, the scoring is mis-weighted.
- Expected R per trade must be > 1.5R at score 4 to justify the
  capital cost.
- Max drawdown must stay under 8 % of bankroll. Otherwise reduce
  default sizing.

## Phase 5 — autonomous monitor (deferred, only after Phase 4 validates)

A `apps/jobs` cron that:

- At 09:25 ET pulls today's ladder + GEX state and posts a
  pre-market sniper brief to a Slack/Discord channel.
- Throughout the day, when a rung scores ≥ 4 *and* fires, posts a
  notification with the rung, score, recommended strike, TP1, stop.
- After 16:00 ET, posts a daily summary of every FIRE event,
  whether you traded it, and the realized P&L vs. theoretical.

**Never** make it pull the trigger automatically. The veto inputs in
`04-signal-stack.md` plus the news-aware risk rules in `06` require
human context. Auto-firing is one news bar away from an account
write-down.

## Build order (recommended)

| Order | Deliverable | Time | Value |
|---|---|---|---|
| 1 | `/sniper` tab with manual ladder + live stack (Phase 1) | 1–2 days | Immediate decision-time savings |
| 2 | GEX confluence enrichment endpoint (Phase 1 backend) | 1 day | The "wall" column on the ladder |
| 3 | Trade journal logger (Phase 3 last bullet) | 0.5 day | Required for backtest validation |
| 4 | Discord auto-ingest (Phase 2) | 1 day | Removes paste-in friction |
| 5 | Backtest replay (Phase 4) | 1 week | Decides whether sniper survives |
| 6 | Autonomous brief / fire alerts (Phase 5) | 2 days, after Phase 4 | Hands-off monitoring |

Total to MVP (Phase 1 + 2 of build order): **2–3 days of work**. The
backtest is the gate to anything past Phase 3.
