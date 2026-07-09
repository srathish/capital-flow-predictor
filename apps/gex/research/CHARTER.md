# Autonomous Research Charter

Standing rules for self-directed research sessions on the GEX/VEX trading
system. A session = read this file + BACKLOG.md + latest JOURNAL.md entries,
ingest new data, execute the top backlog item, write a journal entry, commit
and push. No user input required; no user-visible surface changes ever.

## Hard scope limits (non-negotiable)

1. **Research only.** Writes are confined to `research/**` and the memory
   directory. NEVER touch `src/`, `scripts/` (live), `package.json`, env
   files, or deployment config. No live-code changes — a study that
   produces a ship-worthy rule writes a proposal in the journal's
   DECISIONS NEEDED section and stops there.
2. **Never touch running processes.** No kill/restart/start of the tracker
   or anything long-running. Verify with `node --check`, never by importing
   executable scripts (2026-07-09 incident: an import started rogue tracker
   instances).
3. **API discipline.** UW: ≥550ms pacing, 429 backoff, budget calls before
   starting a collection. Skylit: ≥350ms pacing. A collection that would
   exceed ~30 min of paced calls gets logged in the journal and run as a
   detached background job writing under `research/**`.
4. **No deployments, no pushes outside this repo, no external services.**

## The evidence bar (what "confirmed" means)

- **Real option dollars** (`pnl_atfire` or equivalent UW repricing). Points
  and bps proxies are for triage only — the 30bps proxy once hid a −24pp gap.
- **Stability cuts**: direction must hold on odd/even days, both halves,
  and be checked per-ticker and per-daytype. Ticker concentration is not
  disqualifying but must be named (see: dn_vex_mass is SPXW-only).
- **Placebo**: ≥95th percentile vs permutation AND date-shuffle (and
  within-day shuffle where sensible). 80-94th = `research_more`, never
  `confirmed`.
- **Incremental**: any entry-side finding must add EV *on top of* the bull
  tape gate + nflags. Study 77 discipline — three plausible rules died as
  gate shadows on 2026-07-09; that check is mandatory forever.
- **Sample floor**: cells with n<30 are directional evidence only and
  cannot graduate past `research_more`.
- **Verdicts are forced**: every study ends `confirmed` / `research_more` /
  `rejected` / `not_testable`. No open endings.

## Anti-rabbit-hole rules

1. **Pre-register before computing**: thesis, metric, and success bar
   written in the journal entry FIRST. Post-hoc threshold tuning = reject.
2. **One thread, one follow-up**: an anomaly discovered mid-study earns at
   most ONE follow-up computation in the same session. Anything deeper goes
   to BACKLOG.md as a new pre-registered item.
3. **Two dry sessions parks the thread**: a thread that produces nothing
   actionable twice in a row moves to the backlog ICEBOX with a note.
4. **`rejected` is final absent NEW DATA**: re-opening requires new data
   (forward days, new source), never new slicing of the same data.
5. **Session budget**: max 3 backlog items or ~2 hours of compute,
   whichever first. Stop while conclusions are still crisp; leftover work
   stays queued.
6. **New ideas are queued, not chased**: mid-study ideas get one BACKLOG
   line with a pre-registered thesis. The current study finishes first.
7. **Contradictions get flagged, not silently re-litigated**: if a result
   conflicts with a prior verdict, the journal names both and the backlog
   gets a reconciliation item.
8. **Recurring data-ingest first**: every session starts by updating the
   forward-validation trackers (observation logs, dry-gate would-blocks,
   archive growth) before any new study — forward data is the scarcest
   asset and several verdicts are waiting on it.

## Session deliverable

One JOURNAL.md entry (template at the top of that file): what ran, verdicts
with the key numbers, backlog re-rank, and a DECISIONS NEEDED section for
anything requiring the user (ship proposals, spend, scope). Commit and push
`research/**` changes at session end (repo convention: always push).
