# Conviction Nest 🪶

A persistent, multi-source signal **daemon** that surfaces high-conviction stock buys.
It does **not** trade. It watches everything, remembers what it saw, grades itself against
what actually happened, and interrupts you only when independent signals converge on the
same name.

Three properties separate it from a scanner:

- **Persistence** — state survives across sessions. Conviction *accumulates* across days;
  it is not recomputed from scratch each cycle.
- **Self-grading** — every Call is logged and graded against realized price at 1d/5d/20d.
  Source weights update automatically from their track records; the Nest's own calibration
  ("its 80+ calls hit 64% at 5d") is queryable at all times.
- **Scarcity** — hard alert budget (floor 70, max 3 Calls/day, 5-session per-ticker
  cooldown). Two converged setups a day is a tool; twenty pings is a slot machine.

## Architecture

Everything is one of four event types on a single append-only stream. The engine, the
tracker, delivery, and the (future) field viz are all just subscribers.

```
SOURCES → INGESTORS → EVENT LOG (append-only SQLite) → CONVICTION ENGINE → DELIVERY
                          │                          └→ TRACKER (self-grading)
                          └→ (field viz — websocket subscriber, next iteration)
```

Storage is **local SQLite (WAL)**, not TimescaleDB — repo doctrine is local-only, no
Postgres (see `apps/athena/data/journal.db`). The `events` table is one wide, portable
row keyed by `(type, ticker, ts)` so it can move to a hypertable later untouched.

### Event types (`nest/events/schema.py`)

| type   | what it is                                              |
|--------|---------------------------------------------------------|
| signal | a normalized observation from one source                |
| score  | the engine's rolling conviction for a ticker            |
| call   | an alert that crossed the floor (rare, budgeted)        |
| grade  | the tracker scoring a past Call vs realized price        |

Keys are stable; payload-specific detail lives in `meta`. Nothing is updated in place.
Signals dedupe at ingest (hash of `source+ticker+meta` inside the TTL window).

## The conviction engine — three layers in cost order

1. **Mechanical accumulation** (free, every cycle). Each live Signal contributes
   `strength × source_weight × time_decay` to a signed tally. Decay is exponential with a
   half-life of `ttl/2`; past the TTL it contributes 0. Conviction is the saturated
   magnitude of the net tally; direction is its sign.
2. **Convergence gate** (free, every cycle). A score never triggers alone: it needs
   ≥3 agreeing signals from ≥2 **independent source families** (flow, levels, positioning,
   filings, social, macro) inside a rolling window. Three whale prints ≠ convergence.
3. **LLM synthesis** (gated, cached, rare). Only a gate-crosser reaches Haiku, which writes
   the two-sentence thesis, sanity-checks the stack for contradictions, sets final
   conviction, and defines entry zone + invalidation. A **persistent rate limiter**
   (`min-interval` + daily ceiling, state on disk) is load-bearing: the only way to blow
   the ~$1/day budget is letting the LLM into the hot loop. No key / exhausted limiter →
   deterministic mechanical thesis, and the Call still ships (the gate earned it).

## The tracker (self-grading loop)

Grades every Call at 1d/5d/20d against UW close prices, idempotently. Rolls up two ways:

- **Per source** → each contributor's hit rate becomes its live Layer-1 weight, shrunk
  toward a low prior by sample size (`weight = (prior·K + hits)/(K + n)`). A feed that
  doesn't pay decays toward zero on its own.
- **Per nest** → calibration by (conviction bucket, horizon). `calibration_note()` stamps
  each Call with "calls like this have hit 63% at 5d (n=19)".

> **Cold-start / bootstrap (known, by design):** sources start at low priors (0.15–0.55),
> so even a fully-converged stack scores below the floor until the tracker earns those
> weights up — the Nest stays quiet through the intended ~2-week shadow window. The
> resolution for earning weight *without* needing Calls to fire is **counterfactual
> (shadow) grading** of names that pass Layer 1 but fail the gate — spec'd in the brief §6,
> **not yet implemented** (next iteration, with the field viz).

## CLI

```bash
nest cycle                 # one live cycle over the watchlist (ingest → score → maybe Call)
nest cycle --offline       # re-score the existing log without hitting UW
nest cycle --no-deliver    # don't post Calls to Discord
nest grade                 # grade matured Calls, roll up source weights
nest book                  # current conviction book (latest score per ticker)
nest tail --limit 40       # recent events (the field-viz signal-log, as text)
nest weights               # live source weights + hit rates
nest calibration           # hit rate by conviction bucket
nest digest [--send]       # morning digest (the one scheduled Sonnet call/day)
nest kill | nest unkill    # the alert kill switch
```

### Environment

Reuses the repo's env (`.env` at the root):

- `UNUSUAL_WHALES_API_KEY` — Tier-1 sources (required for live cycles)
- `DISCORD_WEBHOOK_URL` — Call + digest delivery (optional)
- `ANTHROPIC_API_KEY` — Layer-3 synthesis + digest (optional; mechanical fallback without)
- `NEST_HOME` — data dir (default `apps/nest/data`); `nest.db` lives here

## Status

Built this iteration (brief build-order steps 1–5): event-log spine, UW ingestors
(flow / darkpool / gex / oi / insider), conviction engine (L1 + L2 + weights), gated
Haiku synthesis with hard rate limiter, self-grading tracker, Discord delivery + digest,
CLI, and offline tests (`uv run --with pytest pytest apps/nest/tests`).

**Next:** counterfactual shadow-grading (bootstrap), the canvas field viz (step 6), and
Tier-2/3 sources (EDGAR, caller-scored Discord, Reddit velocity) — each admitted only
after the tracker has history to weight it.

It does not trade. A Call is an input to your judgment, never an instruction — the moment
you click the number instead of reading the evidence stack, you've rebuilt the slot machine.
