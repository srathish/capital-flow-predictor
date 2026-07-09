# UW Research Module — ISOLATED, REVERSIBLE

Same contract as research/vix and research/darkpool: nothing under `src/`
imports this; reads existing artifacts + its own collected data; outputs stay
here. **Revert = `rm -rf apps/gex/research/uw`.**

Two studies (user re-authorized UW as a research source 2026-07-08):
- **A. Real-dollar repricing**: UW 1-min option candles for every replayed
  fire's exact 0DTE ATM contract → the 64-day validation in actual option
  dollars instead of the 30bps proxy; out-of-sample trail-stop test.
- **B. Flow confirmation**: UW net-premium ticks (intraday, historical) —
  does options flow agreeing with the fire direction improve real-dollar EV?

Run:
```bash
node research/uw/collect_candles.js && node research/uw/collect_flow.js
uv run --with numpy,pandas,matplotlib,scipy,tabulate python research/uw/uw_study.py
```
