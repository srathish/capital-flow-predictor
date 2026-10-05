#!/usr/bin/env node
// INSIDER-BUY BOOK in SHARES — does the validated stock signal make money as a real, overlapping portfolio? Locked 2026-10-05.
// Events: INS_BUY_100K (open-market Form-4 purchase ≥ $100k) from journal/uw_signals.json — entry = OPEN of the first session after
// the filing, exit = CLOSE 20 sessions later. $10k per position. Cost 0.10% round trip (0.20% if entry price < $20).
//   UNHEDGED  long the stock          HEDGED  long the stock, short β×$10k SPY over the same window (β from prior 60 sessions)
// Book: daily mark-to-market of all open positions; capital = $10k × open positions that day. Sharpe from daily book P&L ÷ capital.
// TRAIN 2022–2024 · TEST 2025–2026.  PASS = TEST hedged mean per trade > 0 after costs with t ≥ 2, and hedged-book Sharpe > 0 in both.
// No new data, 0 credits.
import fs from 'node:fs';
import path from 'node:path';
import { loadDaily } from '../desk/common.mjs';

const HERE = decodeURIComponent(new URL('.', import.meta.url).pathname);
const E = JSON.parse(fs.readFileSync(path.join(HERE, 'journal', 'uw_signals.json'), 'utf8')).filter((e) => e.sig === 'INS_BUY_100K');
const spy = loadDaily('SPY'), sIx = new Map(spy.map((b, i) => [b.d, i]));
const cache = new Map(), bars = (s) => cache.get(s) ?? cache.set(s, loadDaily(s)).get(s);
const trades = [], book = new Map(); // day → {pnlU, pnlH, cap}
for (const e of E) {
  const b = bars(e.s), i0 = b.findIndex((x) => x.d === e.d); if (i0 < 61 || i0 + 19 >= b.length) continue;
  const si0 = sIx.get(b[i0].d); if (si0 == null || si0 + 19 >= spy.length) continue;
  const xs = [], ys = []; for (let k = i0 - 60; k < i0; k++) { const a = sIx.get(b[k].d), p = sIx.get(b[k - 1].d); if (a == null || p == null) continue; xs.push(spy[a].c / spy[p].c - 1); ys.push(b[k].c / b[k - 1].c - 1); }
  const mx = xs.reduce((a, x) => a + x, 0) / xs.length, my = ys.reduce((a, x) => a + x, 0) / ys.length, beta = Math.max(0, Math.min(3, xs.reduce((a, x, k) => a + (x - mx) * (ys[k] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0) || 1));
  const cost = b[i0].o < 20 ? 0.002 : 0.001, N = 10000;
  // daily mark-to-market
  let prevS = b[i0].o, prevP = spy[si0].o;
  for (let k = 0; k < 20; k++) { const bs = b[i0 + k], ps = spy[si0 + k]; if (!bs || !ps || bs.d !== ps.d) continue;
    const rS = bs.c / prevS - 1, rP = ps.c / prevP - 1; prevS = bs.c; prevP = ps.c;
    const day = book.get(bs.d) ?? { u: 0, h: 0, cap: 0 }; day.u += N * rS; day.h += N * (rS - beta * rP); day.cap += N; book.set(bs.d, day); }
  const ret = b[i0 + 19].c / b[i0].o - 1, spyRet = spy[si0 + 19].c / spy[si0].o - 1;
  const lastDay = book.get(b[i0 + 19].d); if (lastDay) { lastDay.u -= N * cost; lastDay.h -= N * cost; }
  trades.push({ s: e.s, d: e.d, set: e.d < '2025-01-01' ? 'TRAIN' : 'TEST', u: ret - cost, h: ret - beta * spyRet - cost, spy: spyRet, val: e.val, px: b[i0].o });
}
const st = (v) => { const m = v.reduce((a, x) => a + x, 0) / v.length, sd = Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1)), s = [...v].sort((a, b) => a - b); return { n: v.length, m, t: m / (sd / Math.sqrt(v.length)), med: s[s.length >> 1], win: v.filter((x) => x > 0).length / v.length }; };
const pc = (x) => (x >= 0 ? '+' : '') + (x * 100).toFixed(2) + '%';
const sharpe = (set, k) => { const days = [...book.entries()].filter(([d]) => (set === 'TRAIN' ? d < '2025-01-01' : d >= '2025-01-01')).sort(); const r = days.map(([, v]) => v[k] / v.cap); const m = r.reduce((a, x) => a + x, 0) / r.length, sd = Math.sqrt(r.reduce((a, x) => a + (x - m) ** 2, 0) / (r.length - 1));
  const capAvg = days.reduce((a, [, v]) => a + v.cap, 0) / days.length, pnl = days.reduce((a, [, v]) => a + v[k], 0), yrs = days.length / 252; return { sh: (m / sd) * Math.sqrt(252), annRet: pnl / capAvg / yrs, capAvg, days: days.length, pnl }; };
console.log(`INSIDER-BUY BOOK (shares, $10k per position, 20-session hold, costs included) · ${trades.length} trades\n`);
let pass = true;
for (const set of ['TRAIN', 'TEST']) {
  const T = trades.filter((t) => t.set === set), u = st(T.map((t) => t.u)), h = st(T.map((t) => t.h)), sp = st(T.map((t) => t.spy)), SU = sharpe(set, 'u'), SH = sharpe(set, 'h');
  console.log(`== ${set} (${set === 'TRAIN' ? '2022–2024' : '2025–2026'}) · ${u.n} trades`);
  console.log(`  unhedged per trade ${pc(u.m)} (t ${u.t.toFixed(1)}, median ${pc(u.med)}, win ${Math.round(u.win * 100)}%) · SPY same windows ${pc(sp.m)}`);
  console.log(`  HEDGED   per trade ${pc(h.m)} (t ${h.t.toFixed(1)}, median ${pc(h.med)}, win ${Math.round(h.win * 100)}%)`);
  console.log(`  book: avg capital $${Math.round(SU.capAvg).toLocaleString()} · unhedged ann. ${pc(SU.annRet)} Sharpe ${SU.sh.toFixed(2)} · HEDGED ann. ${pc(SH.annRet)} Sharpe ${SH.sh.toFixed(2)} · P&L $${Math.round(SH.pnl).toLocaleString()} hedged`);
  if (SH.sh <= 0) pass = false; if (set === 'TEST' && !(h.m > 0 && h.t >= 2)) pass = false;
}
console.log(`\nVERDICT: ${pass ? 'PASS' : 'FAIL'}`);
const yrs = {}; for (const t of trades) (yrs[t.d.slice(0, 4)] ??= []).push(t.h); console.log('hedged per trade by year: ' + Object.entries(yrs).sort().map(([y, v]) => { const s = st(v); return `${y} ${pc(s.m)} (n ${s.n})`; }).join(' · '));
fs.writeFileSync(path.join(HERE, 'journal', 'insider_book.json'), JSON.stringify(trades));
