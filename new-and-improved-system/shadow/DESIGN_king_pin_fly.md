# King-pin butterfly: turn the validated Skylit pin into a trade — locked 2026-10-17, before any option price is pulled

**Goal (user):** "try to make something that works with this" (Skylit intraday data). The one Skylit map behavior that held
up on intraday data: price near the king tends to STAY near it (sniper validation: 50–60% vs 20–33% baseline 30 min
later). Direction tests all failed. A pin is monetized with a long butterfly centered on the pin strike.

## Trigger (Skylit 1-minute frames, aggregate γ of the 5 expirations; SPY and QQQ)
First minute between 11:00 and 14:30 ET when: (a) the king (largest |γ| within ±2%) has been the same strike for the
previous 15 minutes, (b) the king's γ is POSITIVE (dealers long gamma → pin), (c) spot is within $0.50 of the king.
One trade per ticker-day.
## Trade (real UW option minute prices, same-day expiry)
Long call butterfly centered on the king K, wings $2: buy K−2 call, sell 2× K call, buy K+2 call, at the trigger minute's
one-minute closes, each leg filled $0.01 worse (buys +0.01, sells −0.01). Held to expiry: payoff at the 15:59 SPY/QQQ
close (intrinsic). Return = payoff ÷ debit − 1 (skip if debit ≤ 0 or any leg lacks a price in [t, t+2]).
**Control (same minute, same structure):** a butterfly centered $2 ABOVE or BELOW the king (the side farther from spot,
so both flies are about equally far from price) — tests whether the KING strike matters.
## Hypotheses (one-sided; build = 2025-12-15 → 2026-02-27; holdout = 2026-03-02 → 2026-05-05; day-clustered)
P1 king fly mean return > 0 · P2 king fly minus control fly > 0 (paired). Both must pass on the holdout at p < 0.05
(BH across the two). Reported: trades, win rate, average return, median, account result at $200 per fly.
