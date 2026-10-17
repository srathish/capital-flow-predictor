# Reactive map: does how Skylit nodes CHANGE during the day predict what price does? — locked 2026-10-17, before any engine

**User:** "this whole system has to be reactive to how the nodes are changing during the day — that's the whole point,
that's why there are so many losing days." Every earlier map test used a STATIC prior-close map. Data now found on disk:
Skylit Trinity replay (~/gex-data-replay-reader/data, 106 sessions 2025-12-15 → 2026-05-05), one frame per minute
(09:30–16:00), SPXW / SPY / QQQ, 5 expirations × ~92 strikes of gamma and vanna, plus spot. No credits needed.

## Map at minute t (Skylit's own numbers)
γ(k, t) = sum over the 5 expirations of gammaValues at strike k (the aggregate board); the 0DTE column alone is reported
as a sensitivity. Nodes(t) = strikes within ±2% of spot with |γ| ≥ 30% of that minute's king (largest |γ| within ±2%).
Node change Δ15(k, t) = |γ(k, t)| ÷ |γ(k, t−15)| − 1 (strike must exist at both times; |γ(t−15)| > 0).
Price = the frame's spot (one per minute). Ticker-specific tick: a "band" b = 0.05% of spot.

## Events and hypotheses (one-sided; build = 2025-12-15 → 2026-02-27, holdout = 2026-03-02 → 2026-05-05; day-clustered;
## BH q = 0.10 across 5; SPXW, SPY, QQQ pooled with a ticker effect, per-ticker reported)
**A — touch.** Price comes within b of a node N (its |γ| ≥ 30% of king at that minute) after being ≥ 3b away on the same
side within the previous 15 minutes (first such touch per node per side per hour). Outcome within the next 15 minutes:
BREAK = spot ≥ 2b beyond N on the far side at any minute; otherwise HOLD.
- **H1** break rate is HIGHER when N is shrinking (Δ15 ≤ −20%) than when it is growing (Δ15 ≥ +20%).
**B — reactive break trade.** A minute where spot crosses a node N (previous minute on the other side) 09:45–15:00, with
the next node N2 beyond N on the CURRENT map at least 0.40% away (air pocket). Entry = spot at that minute; stop = N ∓
0.15%; target = N2 ∓ 0.02% (N2 as of entry); exit 15:55; R units; no cost (spot only — option version to follow).
- **H2** breaks of SHRINKING nodes (Δ15 ≤ −20%) have mean R > 0.  **H3** shrinking-node breaks beat growing-node breaks.
**C — king migration.** The king moves to a new strike and stays there 5 consecutive minutes (09:45–15:00). Outcome: over
the next 30 minutes, does spot move toward the new king (closer at t+30 than at the switch)?
- **H4** P(toward) > 50% (binomial, day-clustered).
**D — sanity.** **H5** the static prior-close-style rule (B without the Δ filter) has mean R > 0 on this sample
(expected to fail — the comparison baseline).
Reported for every hypothesis: build, holdout, per ticker, n, and the 0DTE-only sensitivity.

## Amendment 1 (2026-10-17, registered before computing Dec–Feb trades) — the "target node fading" exit
Found by trying exits on March 2026 (52 trades, several exit rules tried → selection risk): exiting when the TARGET node's
|γ| (Skylit aggregate board) falls to ≤ 75% of its value at entry improved March from +6.8% to +9.9% ($10,000, $500 per
trade, real 0DTE option prices, $0.02/share slippage each side, $0.65/contract commission). Test it on sessions it was
NOT chosen from: 2025-12-15 → 2026-02-27 (Skylit 1-minute frames), same engine (reactive breaks, DESIGN B, outcome on UW
1-minute candles), same costs. **E1**: mean option return per trade with the fade exit > mean with engine exits only
(paired by trade, day-clustered t). **E2**: mean option return per trade with the fade exit > 0. Both one-sided; both must
pass at p < 0.05 to call it confirmed. Reported: account result for both, trades, winners, how trades ended.
