# Sniper morning brief — per-day SPY backtest

Each row shows the **brief that would have been generated at 09:35 ET** based on Skylit Trinity, then the **actual day outcome**, then the **grade**.

Brief format key:
- **REVERT_UP** = spot was below King → buy calls toward King (mean reversion play)
- **REVERT_DOWN** = spot was above King → buy puts toward King
- **PIN** = spot was at King → sell premium
- **Breakout ↑** = if spot closes above ceiling + buffer, target vacuum high (calls)
- **Breakout ↓** = if spot closes below floor − buffer, target vacuum low (puts)

**P&L is in SPY points** (1 pt SPY ≈ $1, scales to options via delta).

| Date | Spot | King | Floor | Ceil | Primary play | Hit? | Br↑ trig/hit | Br↑ pnl | Br↓ trig/hit | Br↓ pnl |
|---|---:|---:|---:|---:|---|:---:|:---:|---:|:---:|---:|
| 2025-12-15 | 681.70 | 685 | 680 | 685 | REVERT_UP → 685.00 | ❌ | n/- | - | n/- | - |
| 2025-12-16 | 681.10 | 679 | 679 | 684 | REVERT_DOWN → 679.00 | ✅ | n/- | - | Y/n | +2.79 |
| 2025-12-17 | 679.17 | 676 | 676 | 680 | REVERT_DOWN → 676.00 | ✅ | n/- | - | Y/Y | -2.50 |
| 2025-12-18 | 671.49 | 660 | 660 | 679 | REVERT_DOWN → 660.00 | ❌ | Y/Y | -2.50 | n/- | - |
| 2025-12-19 | 676.75 | 680 | 670 | 680 | REVERT_UP → 680.00 | ✅ | Y/n | +0.05 | n/- | - |
| 2025-12-22 | 680.41 | 680 | 680 | 682 | PIN | ❌ | Y/Y | +2.50 | n/- | - |
| 2025-12-23 | 684.88 | 685 | 684 | 685 | PIN | ❌ | Y/n | +2.11 | n/- | - |
| 2025-12-24 | 687.95 | 689 | 684 | 689 | REVERT_UP → 689.00 | ✅ | Y/Y | -0.50 | n/- | - |
| 2025-12-26 | 689.97 | 692 | 680 | 692 | REVERT_UP → 692.00 | ❌ | n/- | - | n/- | - |
| 2025-12-29 | 690.13 | 690 | 690 | 692 | PIN | ❌ | n/- | - | Y/Y | +2.50 |
| 2025-12-30 | 687.87 | 689 | 684 | 689 | REVERT_UP → 689.00 | ❌ | n/- | - | n/- | - |
| 2025-12-31 | 686.75 | 685 | 684 | 688 | REVERT_DOWN → 685.00 | ✅ | n/- | - | Y/n | +1.02 |
| 2026-01-02 | 686.08 | 687 | 686 | 687 | REVERT_UP → 687.00 | ❌ | n/- | - | Y/Y | +0.50 |
| 2026-01-05 | 683.15 | 680 | 682 | 686 | REVERT_DOWN → 680.00 | ❌ | Y/Y | +2.50 | n/- | - |
| 2026-01-06 | 687.38 | 690 | 685 | 690 | REVERT_UP → 690.00 | ✅ | Y/n | +1.25 | n/- | - |
| 2026-01-07 | 691.87 | 692 | 690 | 692 | PIN | ❌ | Y/n | +0.93 | Y/n | -0.43 |
| 2026-01-08 | 689.64 | 692 | 689 | 692 | REVERT_UP → 692.00 | ❌ | n/- | - | Y/Y | +0.50 |
| 2026-01-09 | 689.71 | 693 | 687 | 693 | REVERT_UP → 693.00 | ✅ | Y/n | +1.28 | n/- | - |
| 2026-01-12 | 694.12 | 692 | 692 | 695 | REVERT_DOWN → 692.00 | ✅ | Y/n | +0.00 | n/- | - |
| 2026-01-13 | 695.23 | 694 | 694 | 696 | REVERT_DOWN → 694.00 | ✅ | n/- | - | Y/n | +1.58 |
| 2026-01-14 | 693.90 | 693 | 693 | 695 | REVERT_DOWN → 693.00 | ✅ | n/- | - | Y/Y | +3.50 |
| 2026-01-15 | 690.38 | 690 | 685 | 691 | PIN | ❌ | Y/n | +3.45 | n/- | - |
| 2026-01-16 | 691.83 | 690 | 685 | 695 | REVERT_DOWN → 690.00 | ❌ | n/- | - | n/- | - |
| 2026-01-20 | 691.50 | 692 | 690 | 692 | PIN | ❌ | n/- | - | Y/Y | +1.50 |
| 2026-01-21 | 677.30 | 663 | 677 | 683 | REVERT_DOWN → 663.00 | ❌ | Y/Y | +4.50 | n/- | - |
| 2026-01-22 | 685.20 | 690 | 685 | 690 | REVERT_UP → 690.00 | ✅ | Y/n | +0.10 | n/- | - |
| 2026-01-23 | 688.90 | 689 | 685 | 689 | PIN | ✅ | Y/n | +0.91 | n/- | - |
| 2026-01-26 | 689.14 | 691 | 679 | 691 | REVERT_UP → 691.00 | ✅ | Y/Y | +1.50 | n/- | - |
| 2026-01-27 | 692.78 | 695 | 691 | 695 | REVERT_UP → 695.00 | ✅ | Y/n | +0.49 | n/- | - |
| 2026-01-28 | 695.45 | 695 | 695 | 699 | PIN | ✅ | n/- | - | Y/n | -0.33 |
| 2026-01-29 | 695.60 | 696 | 690 | 696 | PIN | ❌ | n/- | - | Y/Y | -2.50 |
| 2026-01-30 | 694.28 | 690 | 682 | 699 | REVERT_DOWN → 690.00 | ✅ | n/- | - | n/- | - |
| 2026-02-02 | 691.68 | 696 | 691 | 696 | REVERT_UP → 696.00 | ✅ | Y/n | -0.15 | n/- | - |
| 2026-02-03 | 695.38 | 695 | 692 | 696 | PIN | ❌ | Y/n | -0.45 | Y/Y | +1.50 |
| 2026-02-04 | 689.43 | 688 | 683 | 695 | REVERT_DOWN → 688.00 | ✅ | n/- | - | Y/Y | -1.50 |
| 2026-02-05 | 686.24 | 695 | 682 | 695 | REVERT_UP → 695.00 | ❌ | n/- | - | Y/Y | -3.50 |
| 2026-02-06 | 677.86 | 680 | 670 | 680 | REVERT_UP → 680.00 | ✅ | Y/Y | -0.50 | n/- | - |
| 2026-02-09 | 691.43 | 694 | 686 | 694 | REVERT_UP → 694.00 | ✅ | Y/n | +0.81 | n/- | - |
| 2026-02-10 | 694.04 | 694 | 694 | 696 | PIN | ❌ | Y/n | -0.49 | Y/n | +1.21 |
| 2026-02-11 | 692.30 | 690 | 677 | 696 | REVERT_DOWN → 690.00 | ✅ | Y/n | -0.11 | n/- | - |
| 2026-02-12 | 691.94 | 697 | 689 | 697 | REVERT_UP → 697.00 | ❌ | n/- | - | Y/Y | +0.50 |
| 2026-02-13 | 681.35 | 680 | 660 | 685 | REVERT_DOWN → 680.00 | ✅ | Y/n | +0.16 | n/- | - |
| 2026-02-17 | 681.45 | 675 | 680 | 685 | REVERT_DOWN → 675.00 | ❌ | n/- | - | Y/Y | +3.50 |
| 2026-02-18 | 682.75 | 675 | 680 | 685 | REVERT_DOWN → 675.00 | ❌ | Y/Y | +3.50 | n/- | - |
| 2026-02-19 | 686.03 | 688 | 680 | 688 | REVERT_UP → 688.00 | ❌ | n/- | - | n/- | - |
| 2026-02-20 | 684.44 | 685 | 680 | 685 | REVERT_UP → 685.00 | ✅ | Y/Y | +3.50 | n/- | - |
| 2026-02-23 | 687.80 | 700 | 685 | 700 | REVERT_UP → 700.00 | ❌ | n/- | - | Y/Y | -1.50 |
| 2026-02-24 | 682.29 | 686 | 682 | 686 | REVERT_UP → 686.00 | ✅ | Y/n | +1.23 | Y/n | +0.58 |
| 2026-02-25 | 687.40 | 684 | 684 | 690 | REVERT_DOWN → 684.00 | ❌ | Y/n | +2.55 | n/- | - |
| 2026-02-26 | 693.09 | 694 | 688 | 694 | REVERT_UP → 694.00 | ❌ | n/- | - | Y/n | +2.28 |
| 2026-02-27 | 689.07 | 692 | 687 | 692 | REVERT_UP → 692.00 | ❌ | n/- | - | Y/Y | +2.50 |
| 2026-03-02 | 678.66 | 675 | 677 | 684 | REVERT_DOWN → 675.00 | ❌ | Y/Y | -1.50 | n/- | - |
| 2026-03-03 | 686.43 | 690 | 680 | 690 | REVERT_UP → 690.00 | ❌ | n/- | - | Y/Y | +8.50 |
| 2026-03-04 | 680.22 | 672 | 665 | 681 | REVERT_DOWN → 672.00 | ❌ | Y/n | +5.07 | n/- | - |
| 2026-03-05 | 685.46 | 690 | 685 | 690 | REVERT_UP → 690.00 | ❌ | n/- | - | Y/Y | +2.50 |
| 2026-03-06 | 681.53 | 680 | 680 | 686 | REVERT_DOWN → 680.00 | ✅ | n/- | - | Y/Y | +2.50 |
| 2026-03-09 | 666.37 | 657 | 660 | 675 | REVERT_DOWN → 657.00 | ❌ | Y/Y | -7.50 | n/- | - |
| 2026-03-10 | 677.57 | 675 | 675 | 678 | REVERT_DOWN → 675.00 | ✅ | Y/Y | +3.50 | n/- | - |
| 2026-03-11 | 677.94 | 675 | 675 | 681 | REVERT_DOWN → 675.00 | ✅ | n/- | - | Y/Y | +0.50 |
| 2026-03-12 | 670.92 | 665 | 662 | 672 | REVERT_DOWN → 665.00 | ❌ | n/- | - | n/- | - |
| 2026-03-13 | 669.56 | 660 | 660 | 670 | REVERT_DOWN → 660.00 | ❌ | Y/Y | +1.50 | n/- | - |
| 2026-03-14 | 662.10 | 675 | 653 | 675 | REVERT_UP → 675.00 | ❌ | n/- | - | n/- | - |
| 2026-03-17 | 673.45 | 673 | 664 | 677 | PIN | ❌ | n/- | - | n/- | - |
| 2026-03-18 | 668.56 | 671 | 665 | 671 | REVERT_UP → 671.00 | ❌ | n/- | - | Y/Y | -1.50 |
| 2026-03-19 | 656.15 | 650 | 656 | 665 | REVERT_DOWN → 650.00 | ❌ | n/- | - | n/- | - |
| 2026-03-20 | 655.00 | 660 | 653 | 660 | REVERT_UP → 660.00 | ❌ | n/- | - | Y/Y | +0.50 |
| 2026-03-21 | 648.33 | 650 | 641 | 650 | REVERT_UP → 650.00 | ❌ | n/- | - | n/- | - |
| 2026-03-31 | 639.65 | 645 | 636 | 645 | REVERT_UP → 645.00 | ❌ | n/- | - | n/- | - |
| 2026-04-02 | 647.07 | 645 | 645 | 648 | REVERT_DOWN → 645.00 | ❌ | Y/Y | +3.50 | n/- | - |
| 2026-04-30 | 712.86 | 699 | 705 | 713 | REVERT_DOWN → 699.00 | ❌ | Y/Y | +3.50 | n/- | - |
| 2026-05-05 | 722.28 | 722 | 722 | 723 | PIN | ❌ | Y/n | +1.01 | n/- | - |

## SPY summary across all 71 days

### Primary plays (mean reversion to King)

| Play | n | Hit % | Avg P&L pts | Total P&L pts |
|---|---:|---:|---:|---:|
| REVERT_UP | 30 | 40.0% | -1.04 | **-31.1** |
| REVERT_DOWN | 28 | 46.4% | -1.04 | **-29.2** |
| PIN | 13 | 15.4% | -3.26 | **-42.3** |

### Breakout plays (directional vacuum trades)

| Play | Triggered | Full target hit | Hit % | Avg P&L | Total P&L |
|---|---:|---:|---:|---:|---:|
| Breakout above ceiling | 35 | 15 | 42.9% | +1.08 | **+37.7** |
| Breakout below floor | 28 | 20 | 71.4% | +0.95 | **+26.7** |

## QQQ summary across all 71 days

### Primary plays

| Play | n | Hit % | Avg P&L pts | Total P&L pts |
|---|---:|---:|---:|---:|
| REVERT_UP | 30 | 56.7% | +0.14 | **+4.1** |
| REVERT_DOWN | 28 | 60.7% | +0.93 | **+26.1** |
| PIN | 13 | 7.7% | -3.10 | **-40.3** |

### Breakout plays

| Play | Triggered | Full target hit | Hit % | Avg P&L | Total P&L |
|---|---:|---:|---:|---:|---:|
| Breakout above ceiling | 34 | 13 | 38.2% | +2.07 | **+70.5** |
| Breakout below floor | 25 | 14 | 56.0% | +1.89 | **+47.3** |

## Conclusion

- **Mean reversion primary (REVERT_UP / REVERT_DOWN)** loses money on SPY (−31 / −29 pts) and barely breaks even on QQQ. The user's intuitive "below King = calls, above King = puts" rule does NOT have edge on SPY.
- **PIN trades fail miserably as a directional bet** (−40+ pts on both tickers). They should be premium-selling structures, not directional contracts.
- **Breakout plays ARE profitable**: SPY breakout above ceiling +37.7 pts total; below floor +26.7 pts. QQQ even better: +70.5 / +47.3 pts.
- **The brief format the framework should use**: do NOT trade naively to the King. Wait for confirmation of a structural break through the ceiling (long) or floor (short) into a liquidity vacuum.