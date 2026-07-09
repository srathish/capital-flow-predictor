rows: 537

== S1/S11 MONEYNESS (full variants) ==
contract                      ALL               GEX+             GEX-/0              VIXdn              VIXup
ATM                   n=537 -3.5%        n=354 -8.9%        n=183 +3.3%        n=168 -0.5%        n=138 -8.0%
1 ITM                 n=410 -3.4%        n=268 -7.7%        n=142 +3.1%        n=116 +0.8%        n=105 -6.3%
2 ITM                 n=414 -1.9%        n=269 -6.3%        n=145 +5.0%        n=119 +0.9%        n=105 -4.3%
1 OTM                 n=404 -3.2%       n=259 -10.0%        n=145 +6.2%        n=115 +4.4%        n=103 -8.6%
2 OTM                 n=405 -1.5%        n=259 -8.1%        n=146 +7.1%        n=117 +0.1%        n=105 -8.0%
nextexp ATM           n=367 -0.1%        n=234 -2.1%        n=133 +2.7%        n=104 +2.4%         n=90 -1.4%

== S8x EXTREME FLOW → SPY fwd 30m, conditioned ==
extreme BULL flow (top5%): n=214 fwd30=-0.8bps up%=54
   morning: -5.1bps (n=99) · afternoon: +2.8bps (n=115)
   when VIX moves WITH the flow: -0.8bps (n=146)
extreme BEAR flow (bot5%): n=214 fwd30=-1.1bps up%=46
   morning: +1.3bps (n=104) · afternoon: -3.3bps (n=110)
   when VIX moves WITH the flow: -1.5bps (n=144)

== S9x GEX EXTENDED (final system, real $) ==
  gamma flip <30bps away                                 n= 140  pnl=$-2,912 (-3.1%)  win=49%
  gamma flip 30-100bps                                   n= 141  pnl=$+5,875 (+6.0%)  win=60%
  gamma flip >100bps                                     n= 230  pnl=$-15,153 (-9.9%)  win=48%
  pin on spot at fire                                    n= 160  pnl=$-1,155 (-1.9%)  win=56%
  no pin at fire                                         n= 377  pnl=$-11,155 (-3.9%)  win=50%
  TREND days (range mostly directional)                  n= 263  pnl=$+10,659 (+6.3%)  win=53%
  CHOP days                                              n= 274  pnl=$-22,969 (-12.6%)  win=50%

== S10x TIME OF DAY: time-to-peak + trail effectiveness ==
  9:30-10    n= 130 ret=  -4.1%  med_t_peak=  8min  trail_fired=22%
  10-11      n=  93 ret=  -0.4%  med_t_peak= 15min  trail_fired=22%
  11-12      n=  93 ret=  -2.5%  med_t_peak= 18min  trail_fired=26%
  lunch      n=  91 ret=  +3.3%  med_t_peak= 21min  trail_fired=24%
  13:30-15   n= 103 ret= -15.7%  med_t_peak= 10min  trail_fired=23%
  15-15:15   n=  27 ret=  +0.9%  med_t_peak=  9min  trail_fired=26%

== S12x CONVEXITY: option % per 10bps of favorable underlying move ==
  SPXW  option-%-per-10bps-favorable: median +3.6% (n=91)
  SPY   option-%-per-10bps-favorable: median +6.3% (n=91)
  QQQ   option-%-per-10bps-favorable: median +4.3% (n=87)

== S13 REGIME MATRIX: base system vs stack (real $ ret) ==
| dim     | value   |   n_base |   base_ret% |   n_stack |   stack_ret% |
|:--------|:--------|---------:|------------:|----------:|-------------:|
| GEX     | GEX+    |      354 |        -8.9 |        48 |         28.2 |
| GEX     | GEX-    |       81 |         1.2 |        18 |         11.3 |
| GEX     | GEX0    |      102 |         5.4 |        17 |         18.5 |
| VIX15   | dn      |      168 |        -0.5 |        23 |          8.9 |
| VIX15   | flat    |      231 |        -2.7 |        35 |         26.4 |
| VIX15   | up      |      138 |        -8   |        25 |         21.1 |
| daytype | down    |      122 |         4.2 |        18 |         36.5 |
| daytype | flat    |      275 |       -13.3 |        40 |          6.6 |
| daytype | up      |      140 |         8.3 |        25 |         35.1 |
| friday  | Fri     |       94 |        -0.3 |        17 |         29.2 |
| friday  | Mon-Thu |      443 |        -4.1 |        66 |         18.2 |
| trend   | chop    |      274 |       -12.6 |        37 |          5.4 |
| trend   | trend   |      263 |         6.3 |        46 |         36.5 |

== S14 CALENDAR / EVENT DAYS ==
  NFP days                                               n=  26  pnl=$+872 (+6.3%)  win=62%
    (stack subset)                                       n=   6  pnl=$+1,824 (+47.6%)  win=67%
  FOMC days (published sched)                            n=  23  pnl=$+457 (+2.6%)  win=48%
    (stack subset)                                       n=   6  pnl=$+946 (+21.2%)  win=67%
  big-open days (top decile 9:30-10 range)               n=  86  pnl=$-1,098 (-1.4%)  win=51%
    (stack subset)                                       n=  13  pnl=$+3,730 (+31.2%)  win=69%

== S15 NO-TRADE ZONE (score = count of red flags) ==
  0 red flags                                            n=  60  pnl=$+13,610 (+35.4%)  win=60%
  1 red flags                                            n= 178  pnl=$-6,248 (-5.4%)  win=48%
  2 red flags                                            n= 162  pnl=$-7,937 (-7.1%)  win=54%
  3 red flags                                            n= 101  pnl=$-9,395 (-14.5%)  win=53%
  4 red flags                                            n=  31  pnl=$-2,634 (-16.7%)  win=39%

  holdout check (rule: trade only if ≤1 flag; split by odd/even calendar day):
  odd days: ≤1 flag                                      n= 125  pnl=$+7,469 (+8.3%)  win=52%
  odd days: ≥2 flags                                     n= 148  pnl=$-11,845 (-11.9%)  win=52%
  even days: ≤1 flag                                     n= 113  pnl=$-107 (-0.2%)  win=50%
  even days: ≥2 flags                                    n= 151  pnl=$-7,827 (-8.0%)  win=52%