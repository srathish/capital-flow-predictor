# Charts-First 0DTE — SPXW 2026-04-24 (blind out-of-sample)

Session cf0424 · paper only (RESEARCH, Clause 0). Price action creates the thesis; GEX confirms.
Scored with real UW option intraday 1-min closes (ET+4 = UTC). net = exit*0.985/(entry*1.015) - 1.

## Day in one line
Tight morning range 7108-7130 (positive-gamma chop), then a regime-level break of the pin at
~11:45 ET carried SPX 7141 -> 7168, after which an enormous positive-gamma pin (net near-spot
gamma peaking +817M) welded price at 7155-7165 into the close. Two morning breakout longs taken;
the big afternoon leg fired inside a fast-forward and was (correctly) not chased afterward.

## Trades

### Trade 1 — LONG (LOSS)  SPXW260424C07130000
- **Entry 10:20 ET (14:20Z) @ spot 7127.72 · ATM strike 7130 · option 12.80**
- **Exit  10:29 ET (14:29Z) @ spot 7122.97 · option 9.90**
- **Chart thesis:** first breakout of the morning 7108-7127 range to a new session high (96% of
  range), HH forming, 5m/15m momentum turning positive, price back above VWAP-proxy 7122.
- **GEX confirm:** rising pika floor at 7125 (+12.9M, growing) directly beneath; king pika magnet
  7150 (+26.7M) overhead with clean air; positive-gamma regime "levels hold."
- **What happened:** the breakout was a first-touch that rejected 3x at 7128.5; the 7125 pika floor
  I entered on DISSOLVED (nearest floor jumped down to 7075) and net gamma faded. Thesis broken in
  9 minutes -> exited fast.
- **Real P&L: -24.94%.** A ~5pt adverse underlying move on a 0DTE ATM call + round-trip friction.
- **Verdict:** correct exit discipline, wrong entry. This was chasing the *first* test of the range
  high inside a positive-gamma regime the method itself flags as pin/chop. Marginal setup; taxed.

### Trade 2 — LONG (WIN)  SPXW260424C07135000
- **Entry 10:45 ET (14:45Z) @ spot 7133.54 · ATM strike 7135 · option 11.30**
- **Exit  11:05 ET (15:05Z) @ spot 7138.64 · option 12.70**
- **Chart thesis:** *confirmed* breakout — price cleared the 7128-7130 ceiling that had rejected 4x
  and held/extended to a fresh high on three green candles; 15m momentum best of day (+0.17%).
- **GEX confirm:** king pika magnet 7150 (+37.4M, growing) with clean air 7133-7150; strengthening
  positive gamma (+70M) draws price toward the largest strike, which now sat ABOVE.
- **What happened:** orderly grind 7133 -> 7139, then momentum died as net gamma ballooned +70M ->
  +107M (pin freezing price ~11pts short of the 7150 magnet). Capped the winner rather than wait
  for a magnet the pin was suppressing.
- **Real P&L: +9.07%.** Underlying rose ~5pts; option 11.30 -> 12.70 net of friction.
- **Verdict:** correct on both ends — took the *confirmed* (not first-touch) breakout, and capped
  before the round-trip. Exactly the "cap 0DTE winners" rule.

## Totals
| Trade | Dir | Entry ET | Exit ET | Strike | Option in->out | Net |
|-------|-----|----------|---------|--------|----------------|-----|
| 1 | long | 10:20 | 10:29 | 7130C | 12.80 -> 9.90 | **-24.94%** |
| 2 | long | 10:45 | 11:05 | 7135C | 11.30 -> 12.70 | **+9.07%** |

**Sum of nets: -15.87% · Avg/trade: -7.94% · Record: 1-1.**

Rest of session (from ~11:06 to 15:45): correctly flat. ~30 holds sitting out a positive-gamma pin
that intensified monotonically to +817M — the textbook untradeable strong pin.

## Self-assessment — did charts-first catch the day's move?
Partly, and honestly not the best part.

- **Risk management worked as designed.** Fast exit when the trade-1 thesis broke (limited it to
  -25% vs the option continuing to 8.70 minutes later); winner capped on trade 2 before it
  round-tripped in the pin. The firewall and decide-then-reveal discipline held.
- **The distinction between the two longs was real and the read caught it** — trade 1 (first-touch,
  floor dissolving) failed; trade 2 (confirmed break, magnet above) won. Same ~5pt underlying
  magnitude, opposite outcome, and the chart thesis called each correctly.
- **But the genuinely tradeable move was missed.** The clean +27pt afternoon leg (7141 -> 7168 at
  ~11:45 ET) broke the whole-morning pin — that was the day's real trend. It fired *inside* a 15-min
  fast-forward taken after an hour of dead +146M pin. Post-move, entering at 7162 with the next node
  (7170) only 8pts up was a negative-R:R chase, so I stood down — the correct call given where I
  was, but it means the edge was left on the table.
- **Net take:** on a strong positive-gamma pin day, the two morning breakouts were both fighting the
  "pin is untradeable" principle; trade 1 especially should probably have been a stand-down. The
  method's edge (regime-break entries via pullback to a freshly-formed floor) needed 1-min presence
  through the transition, which the hour of dead pin made impractical within the tool budget. Bank
  the lesson: in a hardening positive-gamma pin, favor pullback-to-floor entries over first-touch
  breakout chases, and tighten granularity when net gamma is *building* (a pin about to reprice)
  even if the tape looks dead. Flat was the highest-EV state for ~4.5 of the 5.75 hours, and I held
  it.
