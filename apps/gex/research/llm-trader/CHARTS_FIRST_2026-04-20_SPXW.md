# Charts-First 0DTE — SPXW 2026-04-20 (blind out-of-sample)

Session `cf0420`. Paper/research only. Method: price action creates the thesis, GEX only
confirms; selective discretionary trading. Scored on real UW 1-min option closes at the
decision minutes (ET+4 = UTC). net = exit*0.985 / (entry*1.015) − 1.

## Day in one paragraph
Opened 7126, put in a slow ~40-pt morning bleed to a 7085 low by ~11:00, then spent the
ENTIRE afternoon pinned in a tight 7100–7110 band under a growing 7100 pika that finished as
a colossal +200M gamma king into the close (net gamma flipped strongly positive by 14:10).
No sustained trend. The only real directional event was the 10:50 break-flush of the 7100
floor. The dominant feature all day was the 7100 pika magnet: every break of 7100 got bought
back within a few points except the one sustained 10:50–11:09 leg. This was a low-realized-vol
pin day — structurally a "few trades / mostly flat" day, and 0DTE round-trips were punished by
cost + theta.

## Trades (chart thesis → GEX confirm → real P&L)

### T1 — SHORT 10:12 → 10:14 · ATM 7115 put · **LOSS −10.1%**
- **Chart:** lost VWAP 7115.3, lower high at 7122 then rolling down, momentum negative both
  5m/15m, 10:10 closed on its low.
- **GEX confirm:** 7115 barney flipped to overhead resistance; 7110 barney king = negative-node
  fuel below spot; negative-gamma "levels break" regime.
- **Outcome:** false breakdown — price reclaimed 7115/VWAP one minute later; cut per exit rule.
  entry put 13.50 → exit 12.50. **First-probe chop loss (avoidable).**

### T2 — LONG 10:48 → 10:51 · ATM 7105 call · **LOSS −17.7%**
- **Chart:** double-bottom 7103.7 (10:40+10:45) off the session low held, price lifting, 5m
  momentum flipped positive.
- **GEX confirm:** king became a +37M pika FLOOR at 7100 directly under spot (dominant node),
  overhead barney 7110. Long the floor bounce, cap into the 7110 barney.
- **Outcome:** thesis WORKED on the tape — price ran 7105→7110 (call spiked to 15.4–16.0 at
  10:49) and I banked the barney rejection. But the exit-minute (10:51) close was a wild bar
  (ranged 8.50–13.50) and printed 11.70 vs the 13.80 entry. **Right read, unlucky exit print /
  cost drag.**

### T3 — SHORT 10:52 → 10:58 · ATM 7100 put · **WIN +16.3%**
- **Chart:** BREAK-FLUSH — the 7100 floor that held all morning collapsed (10:50 candle
  7110→7099), new session low, momentum negative both TFs.
- **GEX confirm:** 7100 pika floor GONE (nearest floor jumped to 7050 = ~50pt air pocket), net
  near-spot gamma SPIKED −18M→−62M. The transition-out-of-the-pin the method hunts for.
- **Outcome:** rode the flush to the 7094 stall and banked it (entry put 13.60 → exit 16.30)
  as a +37M pika reasserted at 7100. **The one genuine A-setup of the day — and the only winner.**

### T4 — SHORT 11:38 → 11:41 · ATM 7100 put · **LOSS −20.8%**
- **Chart:** VWAP rejection (11:30 high 7107.4) + break back below 7100, downtrend intact.
- **GEX confirm:** looked like the extend condition again — 7100 floor collapsed, floor to 7050,
  net gamma spiked −32M→−56M.
- **Outcome:** false break / bull trap — pika reformed and price reclaimed 7100 within 3 min.
  Cut per stop. entry put 12.10 → exit 9.88. **Second break-chase of the unreliable 7100 —
  the clear avoidable mistake; I had already been faked once.**

### T5 — SHORT 14:30 → 14:34 · ATM 7105 put · **LOSS −25.8%**
- **Chart:** rejection off 7110 (repelled by the colossal barney), 5m momentum turned negative.
- **GEX confirm:** with-structure range fade — fade the enormous 7115 barney (−84M) toward the
  +73M pika floor at 7100.
- **Outcome:** fade stalled at VWAP 7104 and bounced; banked the marginal proxy gain. On real
  prints the 1-min closes were noisy (entry printed 5.10 near its bar high, exit 3.90 near its
  bar low; neighbors were ~4.10 both sides ≈ flat). Scored −25.8% by the letter of the method.
  **Marginal-edge trade in a balanced pin — arguably shouldn't have been taken (5th trade).**

## Totals
| # | Dir | Entry→Exit (ET) | ATM | entry→exit opt | net |
|---|-----|-----------------|-----|----------------|------|
| T1 | short | 10:12→10:14 | 7115p | 13.50→12.50 | −10.1% |
| T2 | long  | 10:48→10:51 | 7105c | 13.80→11.70 | −17.7% |
| T3 | short | 10:52→10:58 | 7100p | 13.60→16.30 | **+16.3%** |
| T4 | short | 11:38→11:41 | 7100p | 12.10→9.88 | −20.8% |
| T5 | short | 14:30→14:34 | 7105p | 5.10→3.90 | −25.8% |

**Sum of net = −58.1% · avg −11.6%/trade · record 1 win / 4 losses.**
On the harness proxy spot the reads were near break-even (correct direction on T2/T3/T5,
net ≈ −1.3 pts underlying); on real 0DTE ATM prints the ~3% round-trip cost + afternoon theta +
noisy 1-min closes turned small proxy edges into losses.

## Self-assessment
- **What charts-first caught:** the one real directional event of the day — the 10:52 break-flush
  (T3, +16.3%) — was correctly identified via the floor-collapse + gamma-spike + air-pocket
  signature and was the only winner. It also correctly read the afternoon as a strong positive-
  gamma pin and stood down (0 trades 11:42→14:30, and flat into a +200M pin close). That is the
  method working: trade the transition, avoid the pin.
- **What went wrong:** I got chopped TWICE (T1, T4) trying to short breaks of the 7100 pika. On
  a day whose dominant feature was a 7100 magnet, break-of-7100 shorts were a coin-flip that the
  costs made −EV. I flagged the pattern in real time after T1 yet still took T4 — the discipline
  lapse of the day. T5 was a marginal 5th trade in a balanced pin that the method says to skip.
- **Bigger lesson:** on a low-vol pin day, "flat is a position" needed to win harder. The correct
  day was ~1–2 trades (T3, maybe T2), not 5. The single high-conviction structural break was the
  edge; the range-noise trades gave it all back and then some. Overtrading a pin + 0DTE round-trip
  friction = the loss. Charts-first read the STRUCTURE well; it did not respect the count discipline.
