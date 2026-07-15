# Charts-First 0DTE — SPXW 2026-06-08 (session cf0608, BLIND)

Open 7383.74 · session range 7383.74–7466.16 · close-region ~7404 (+0.28% on day).
**Day character: an exceptionally strong POSITIVE-gamma pin centered on the 7450 pika.** Net
near-spot gamma climbed all afternoon to an extreme +264M. Every attempt to leave the 7415–7466
band — a morning grind-up through 7450 and a midday flush below it — was reabsorbed. This was, in
hindsight, close to the method's textbook "strong positive-gamma pin → 0 trades" day. I stayed flat
for ~32 of 34 decisions and took 2 selective, tightly-managed trades at the only two apparent
transitions. Both transitions were false (the +gamma pin swallowed them); both trades were small,
fast-exited losses.

## Trades

### Trade 1 — LONG (7455C) · 10:47→10:51 ET (14:47→14:51 UTC) · LOSS -4.76%
- **Chart thesis:** After ~75 min pinned in a 7422–7450 band, price broke to a new day high (7453.9)
  on a strong green 5-min candle (7439.5→7453.9), momentum +0.16%/5m & +0.19%/15m, above VWAP —
  a bullish HH band-escape, the transition OUT of the pin.
- **GEX confirm:** The 7450 pika (+31M) flipped from overhead king/resistance to the FLOOR directly
  beneath price; overhead clear air until a weak 7500 pika (+13.6M, 46pts up). Real floor under +
  no wall overhead = long confirmed. Invalidation set at a fall-back below 7450.
- **What happened:** Price immediately retested and fell back below 7450 (7448.67); the GEX structure
  reverted (7450 back to resistance, floor gone to 7375). Invalidation hit → exited fast on the same
  minute. Positive-gamma whipsaw — the single-candle poke into a +31M wall got sucked back.
- **Real prints:** 7455C entry 14:47 close **16.10** → exit 14:51 close **15.80**.
  net = 15.80·0.985 / (16.10·1.015) − 1 = **−4.76%**.
- *(Note: the grind actually resumed after my stop, walking to 7466 — but the exit was rule-correct;
  trading right at a +31M pin whipsaws by nature.)*

### Trade 2 — SHORT (7440P) · 11:31→11:37 ET (15:31→15:37 UTC) · LOSS -16.34%
- **Chart thesis:** After grinding to the +1.1% high (7466), price rolled over and broke DECISIVELY
  below the all-morning 7450 support shelf — 5-min close at the low 7438.8, below VWAP (7444.5),
  momentum accelerating down (−0.26%/5m, −0.34%/15m). Failed-high reversal.
- **GEX confirm:** 7450 pika (+32M) flipped from floor to overhead resistance/barney; the floor
  structurally vacated to 7375 (63pts of air below, no pika between) — ceiling above + floor giving
  way = the short template. Cleaner than the 1-min poke of Trade 1 (this was a 5-min close below).
- **What happened:** Underlying fell ~9pts to a 7429 low, then the extreme +gamma reabsorbed it and
  bounced back to 7436.5 within minutes. On the *underlying* my exit was still marginally green
  (+0.04%), but I "banked it" a few minutes after the put's actual peak — the option round-tripped
  from ~20.3 (at the 7429 low, 15:33) back down. Classic 0DTE decay: the option peaks and fades
  faster than the index, and I'd bought into an elevated post-break mark.
- **Real prints:** 7440P entry 15:31 close **17.40** → exit 15:37 close **15.00**.
  net = 15.00·0.985 / (17.40·1.015) − 1 = **−16.34%**.

## Total
- Sum of per-trade net: **−21.11%** (compounded −20.33%).
- Both trades losses.

## Self-assessment
- **Read the day correctly.** Charts-first nailed the regime: a monster 7450-centered positive-gamma
  pin. I correctly refused ~30+ low-quality entries — three separate slow drifts (11:30, 12:35, 13:00)
  that all got reabsorbed, the endless midday chop, and the end-of-day magnet migration to 7395/7405.
  "Flat is a position" was the right stance ~94% of the session.
- **The move it "caught":** there was no big 0DTE directional move to catch — the index chopped and
  closed only +0.28%. Charts-first's main correct call was identifying that and staying out.
- **Where it cost:** I still took the two 7450 break attempts. Both were legitimate-looking
  transitions (the method explicitly hunts "transition OUT of the pin"), but on THIS day the +gamma
  was so extreme (>+100M and rising) that both breaks were false. On a pin this strong, the honest
  ideal was 0 trades. The losses were contained by tight invalidations and fast exits (−4.8% and
  −16.3% rather than blowups), but they were losses.
- **Lesson reinforced:** when net near-spot gamma is very large and *rising*, treat band breaks as
  guilty-until-proven — require a confirmed 5-min close AND hold-of-retest before entering, and if
  the pika you'd be trading into is >+30M and strengthening, stand down. Trade 2 also shows: on 0DTE,
  exit on the option's move, not just the underlying's — I was a few minutes late vs the put's peak.
