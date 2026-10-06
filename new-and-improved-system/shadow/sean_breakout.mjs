#!/usr/bin/env node
// Sean (SRxTrades) breakout swing system — implements shadow/DESIGN_sean.md exactly (locked 001cf739, before results).
//   node shadow/sean_breakout.mjs            → development (signals 2023–2024)
//   node shadow/sean_breakout.mjs --holdout  → holdout (signals 2025-01 → 2026-09), runs ONCE (refuses if the report exists)
// Daily bars from .cache/wdaily (UW), SPY from .cache/daily. 0 Skylit credits.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), C = path.join(ROOT, '.cache'), REP = path.join(ROOT, 'shadow', 'reports');
const HOLD = process.argv.includes('--holdout'), [FROM, TO] = HOLD ? ['2025-01-01', '2026-09-30'] : ['2023-01-01', '2024-12-31'];
const OUT = path.join(REP, HOLD ? 'sean_holdout' : 'sean_dev');
if (HOLD && fs.existsSync(OUT + '.txt') && !process.argv.includes('--force')) { console.error('holdout already run — see ' + OUT + '.txt'); process.exit(1); }
const COST = 0.001, DRAWS = 200;

const ema = (x, n) => { const k = 2 / (n + 1), out = new Array(x.length); let e = x[0]; for (let i = 0; i < x.length; i++) { e = i ? x[i] * k + e * (1 - k) : x[0]; out[i] = e; } return out; };
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
function prep(bars) { const c = bars.map((b) => b.c); const S = { b: bars, d: bars.map((b) => b.d), e8: ema(c, 8), e21: ema(c, 21), e50: ema(c, 50), idx: new Map(bars.map((b, i) => [b.d, i])) };
  S.adr = bars.map((_, i) => (i < 20 ? null : mean(bars.slice(i - 20, i).map((b) => b.h / b.l - 1))));
  S.av20 = bars.map((_, i) => (i < 20 ? null : mean(bars.slice(i - 20, i).map((b) => b.v)))); return S; }

// SPY
const spyRaw = JSON.parse(fs.readFileSync(path.join(C, 'daily', 'SPY.json'), 'utf8')).map((x) => ({ d: new Date((x.t + 43200) * 1000).toISOString().slice(0, 10), o: x.o, h: x.h, l: x.l, c: x.c, v: x.v }));
const SPY = prep(spyRaw);
const gate = (d) => { const i = SPY.idx.get(d); if (i == null || i < 50) return false; const c = SPY.b[i].c; return c > SPY.e8[i] && c > SPY.e21[i] && c > SPY.e50[i]; };
const spyAt = (d, f) => { let i = SPY.idx.get(d); if (i == null) { i = SPY.d.findIndex((x) => x > d); if (i < 0) i = SPY.d.length - 1; } return SPY.b[i][f]; };

// rules (DESIGN steps 2–4)
const scan = (S, i) => { if (i < 60) return false; const b = S.b[i]; return b.c > 3 && b.v > 500e3 && b.c > S.b[i - 1].c && S.adr[i] > 0.02 && b.c > S.e8[i] && b.c > S.e21[i] && b.c > S.e50[i]; };
function setup(S, i) { const B = S.b.slice(i - 15, i), hi = Math.max(...B.map((b) => b.h)), lo = Math.min(...B.map((b) => b.l));
  if ((hi - lo) / lo > 3 * S.adr[i]) return null;
  const pre = S.b.slice(i - 55, i - 15); if (pre.length < 40 || S.b[i - 15].c < 1.2 * Math.min(...pre.map((b) => b.l))) return null;
  if (mean(B.map((b) => b.v)) >= mean(S.b.slice(i - 35, i - 15).map((b) => b.v))) return null;
  if (S.b[i - 1].c <= S.e21[i - 1]) return null; return hi; }
const trigger = (S, i, hi) => S.b[i].c > hi && S.b[i].v >= 1.5 * S.av20[i];

// management (DESIGN step 6). Returns null if skipped (open ≤ stop / no next bar).
function simulate(S, i, stop0) {
  const j = i + 1; if (j >= S.b.length) return null; const o = S.b[j].o; if (!(o > stop0)) return null;
  const R = o - stop0, tgt = o + 3 * R; let rem = 1, pend = 0, stop = stop0, t1 = false, f8 = false, f21 = false, pnl = 0, spyPnl = 0, last = j;
  const spy0 = spyAt(S.d[j], 'o'); const sell = (q, px, k, f = 'c') => { q = Math.min(q, rem); if (q <= 0) return; pnl += q * (px / o - 1); spyPnl += q * (spyAt(S.d[k], f) / spy0 - 1); rem -= q; last = k; };
  for (let k = j; k < S.b.length && rem > 1e-9; k++) { const b = S.b[k];
    if (pend > 0 && k > j) { sell(pend, b.o, k, 'o'); pend = 0; if (rem <= 1e-9) break; }
    if (k > j && b.o <= stop) { sell(rem, b.o, k, 'o'); break; }
    if (b.l <= stop) { sell(rem, stop, k); break; }
    if (!t1 && b.h >= tgt) { sell(0.25, Math.max(b.o, tgt), k); t1 = true; stop = Math.max(stop, o); if (rem <= 1e-9) break; }
    if (b.c < S.e50[k]) pend = rem;
    else { if (!f8 && b.c < S.e8[k]) { f8 = true; pend += 0.25; } if (!f21 && b.c < S.e21[k]) { f21 = true; pend += 0.25; } }
  }
  const open = rem > 1e-9; if (open) sell(rem, S.b.at(-1).c, S.b.length - 1);
  const ret = pnl - COST; return { ret, r: (ret * o) / R, ex: ret - spyPnl, hold: last - j, exit: S.d[last], open, entry: S.d[j], riskPct: R / o };
}

// load universe
const T = new Map();
for (const f of fs.readdirSync(path.join(C, 'wdaily'))) { const b = JSON.parse(fs.readFileSync(path.join(C, 'wdaily', f), 'utf8')); if (b.length > 120) T.set(f.replace('.json', ''), prep(b)); }
const scanByDate = new Map(); // date → [[ticker, i]] (scan pass, used for the random-entry control)
for (const [t, S] of T) for (let i = 60; i < S.b.length; i++) { const d = S.d[i]; if (d < FROM || d > TO) continue; if (scan(S, i)) { const a = scanByDate.get(d) ?? []; a.push([t, i]); scanByDate.set(d, a); } }

function run(useGate) { const trades = [];
  for (const [t, S] of T) { let busyUntil = -1;
    for (let i = 60; i < S.b.length - 1; i++) { const d = S.d[i]; if (d < FROM || d > TO || i <= busyUntil) continue;
      if (useGate && !gate(d)) continue; if (!scan(S, i)) continue; const hi = setup(S, i); if (hi == null || !trigger(S, i, hi)) continue;
      const r = simulate(S, i, S.b[i].l); if (!r) continue; trades.push({ t, sig: d, ...r }); busyUntil = S.idx.get(r.exit); } }
  return trades.sort((a, b) => a.sig.localeCompare(b.sig)); }

let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
function control(trades) { const means = [];
  for (let k = 0; k < DRAWS; k++) { const rs = [];
    for (const tr of trades) { const pool = (scanByDate.get(tr.sig) ?? []).filter(([t]) => t !== tr.t); if (!pool.length) continue;
      for (let a = 0; a < 10; a++) { const [t, i] = pool[Math.floor(rnd() * pool.length)], S = T.get(t), r = simulate(S, i, S.b[i].l); if (r) { rs.push(r.ret); break; } } }
    if (rs.length) means.push(mean(rs)); }
  return means.sort((a, b) => a - b); }

const pc = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}%`;
function stats(tr) { const r = tr.map((x) => x.ret), s = [...r].sort((a, b) => a - b), tot = r.reduce((a, x) => a + x, 0), top5 = [...r].sort((a, b) => b - a).slice(0, 5).reduce((a, x) => a + x, 0);
  return { n: r.length, win: r.filter((x) => x > 0).length / r.length, mean: mean(r), med: s[s.length >> 1], t: mean(r) / (sd(r) / Math.sqrt(r.length)), meanR: mean(tr.map((x) => x.r)), ex: mean(tr.map((x) => x.ex)), top5: top5 / tot, hold: mean(tr.map((x) => x.hold)), open: tr.filter((x) => x.open).length, risk: mean(tr.map((x) => x.riskPct)) }; }
const line = (s) => `n ${s.n} · win ${(s.win * 100).toFixed(0)}% · mean ${pc(s.mean)} (t ${s.t.toFixed(2)}) · median ${pc(s.med)} · mean R ${s.meanR.toFixed(2)} · excess vs SPY ${pc(s.ex)} · avg hold ${s.hold.toFixed(0)} sessions · avg risk ${pc(s.risk)} · top-5 trades = ${(s.top5 * 100).toFixed(0)}% of total P&L · still open ${s.open}`;

const main = run(true), nog = run(false), ctl = control(main), S0 = stats(main), Sn = stats(nog);
const p95 = ctl[Math.floor(ctl.length * 0.95)], beat = ctl.filter((m) => m >= S0.mean).length / ctl.length;
const out = [];
out.push(`# Sean breakout swing — ${HOLD ? 'HOLDOUT' : 'DEVELOPMENT'} (signals ${FROM} → ${TO}) · ${T.size} tickers · design DESIGN_sean.md\n`);
out.push(`**With SPY gate (the system):** ${line(S0)}`);
out.push(`**No SPY gate:** ${line(Sn)}`);
out.push(`**Random-entry control** (${ctl.length} draws, same day, scan-passing stock, same management): median of means ${pc(ctl[ctl.length >> 1])} · 95th pct ${pc(p95)} · share of draws ≥ system ${(beat * 100).toFixed(1)}%`);
const yrs = [...new Set(main.map((x) => x.sig.slice(0, 4)))];
out.push('\n**By year:** ' + yrs.map((y) => { const s = stats(main.filter((x) => x.sig.startsWith(y))); return `${y}: n ${s.n}, mean ${pc(s.mean)}, win ${(s.win * 100).toFixed(0)}%, excess ${pc(s.ex)}`; }).join(' · '));
out.push('\n**Biggest winners:** ' + [...main].sort((a, b) => b.ret - a.ret).slice(0, 8).map((x) => `${x.t} ${x.sig} ${pc(x.ret)} (${x.hold}d)`).join(' · '));
out.push('**Biggest losers:** ' + [...main].sort((a, b) => a.ret - b.ret).slice(0, 5).map((x) => `${x.t} ${x.sig} ${pc(x.ret)}`).join(' · '));
const pass = [S0.mean > 0 && S0.t >= 2, S0.mean > p95, S0.ex > 0];
out.push(`\n**Pass criteria${HOLD ? '' : ' (informational on dev)'}:** mean>0 & t≥2 ${pass[0] ? 'PASS' : 'FAIL'} · beats control 95th pct ${pass[1] ? 'PASS' : 'FAIL'} · excess vs SPY > 0 ${pass[2] ? 'PASS' : 'FAIL'} → **${pass.every(Boolean) ? 'PASS' : 'FAIL'}**`);
const txt = out.join('\n'); console.log(txt);
fs.mkdirSync(REP, { recursive: true }); fs.writeFileSync(OUT + '.txt', txt + '\n'); fs.writeFileSync(OUT + '.json', JSON.stringify({ stats: S0, nogate: Sn, control: { p95, beat, n: ctl.length }, pass, trades: main }, null, 1));
