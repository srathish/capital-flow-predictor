#!/usr/bin/env node
// Does SKYLIT FLOW tell us the direction of the move? Locked 2026-10-03 BEFORE running.
// Part A (weekly): every Friday Jan–Sep 2026, `aggregate_score` (date=Friday, timeframes 1d,7d; 3 credits) for 16 names.
//   Next week = Monday open → Friday close, beta-adjusted vs SPY (β from prior 60 sessions).
//   A1 direction: bullish → long, bearish → short (neutral skipped). A2 composite-7d rank: top-4 minus bottom-4 each week.
//   ✓ = positive in BOTH halves (Jan–May / Jun–Sep) and overall t ≥ 2.
// Part B (A+ trades): for every A+ walk trade, the score on the PRIOR session — would agreeing flow have kept us out of losers?
//   node shadow/flow_study.mjs
import fs from 'node:fs';
import path from 'node:path';
import { mcp } from '../feeds/skylit.js';

const HERE = decodeURIComponent(new URL('.', import.meta.url).pathname), C = path.join(HERE, '..', '.cache', 'agg'), DD = path.join(HERE, '..', '.cache', 'daily');
fs.mkdirSync(C, { recursive: true });
const NAMES = ['AAPL', 'ADBE', 'AMD', 'AMZN', 'AVGO', 'COST', 'CRM', 'GOOGL', 'JPM', 'META', 'MSFT', 'NFLX', 'NVDA', 'ORCL', 'TSLA', 'PLTR'];
const ymd = (t) => new Date((t + 12 * 3600) * 1000).toISOString().slice(0, 10);
const load = (s) => JSON.parse(fs.readFileSync(path.join(DD, `${s}.json`), 'utf8')).map((b) => ({ ...b, d: ymd(b.t) }));
const spy = load('SPY'), days = spy.map((b) => b.d), sIx = new Map(days.map((d, i) => [d, i]));
async function agg(sym, date) {
  const f = path.join(C, `${sym}_${date}.json`); if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  for (let k = 0; k < 6; k++) {
    try { const r = await mcp('aggregate_score', { ticker: sym, timeframes: '1d,7d', date }); const out = { d1: r.data.byTimeframe['1d'], d7: r.data.byTimeframe['7d'] }; fs.writeFileSync(f, JSON.stringify(out)); return out; }
    catch (e) { if (/rate limit/i.test(e.message)) { await new Promise((r) => setTimeout(r, 15000 * (k + 1))); continue; } console.error('agg fail', sym, date, e.message.slice(0, 100)); return null; }
  }
  console.error('agg gave up', sym, date); return null;
}
function fwd(bars, i0, n) { // i0 = index of entry session (open) in bars; beta-adjusted signed later
  const b = bars, d0 = b[i0].d, si = sIx.get(d0); if (si == null || i0 + n - 1 >= b.length || si + n - 1 >= spy.length) return null;
  const xs = [], ys = []; for (let k = Math.max(1, i0 - 60); k < i0; k++) { const a = sIx.get(b[k].d), p = sIx.get(b[k - 1].d); if (a == null || p == null) continue; xs.push(spy[a].c / spy[p].c - 1); ys.push(b[k].c / b[k - 1].c - 1); }
  const mx = xs.reduce((a, x) => a + x, 0) / xs.length, my = ys.reduce((a, x) => a + x, 0) / ys.length;
  const beta = xs.reduce((a, x, k) => a + (x - mx) * (ys[k] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0) || 1;
  return (b[i0 + n - 1].c / b[i0].o - 1) - beta * (spy[si + n - 1].c / spy[si].o - 1);
}
const fridays = days.filter((d, i) => d >= '2026-01-02' && d <= '2026-09-25' && i + 1 < days.length && new Date(days[i + 1] + 'T12:00:00Z') - new Date(d + 'T12:00:00Z') > 86400000 * 1.5);
const rows = [];
for (const s of NAMES) {
  const bars = load(s);
  for (const fd of fridays) {
    const i = bars.findIndex((b) => b.d > fd); if (i < 0) continue;
    const a = await agg(s, fd); if (!a?.d7) continue;
    const x = fwd(bars, i, 5); if (x == null) continue;
    rows.push({ s, fd, half: fd < '2026-06-01' ? 'H1' : 'H2', x, dir7: a.d7.direction, dir1: a.d1?.direction, c7: a.d7.composite, c1: a.d1?.composite, sweep: a.d7.sweepAlignment });
  }
}
const st = (v) => { if (v.length < 2) return { n: v.length, m: NaN, t: NaN }; const m = v.reduce((a, x) => a + x, 0) / v.length, sd = Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1)); return { n: v.length, m, t: m / (sd / Math.sqrt(v.length)) }; };
const pc = (x) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + (x * 100).toFixed(2) + '%' : '-');
const show = (name, f) => { const a = st(rows.filter((r) => r.half === 'H1').map(f).filter((x) => x != null)), b = st(rows.filter((r) => r.half === 'H2').map(f).filter((x) => x != null)), o = st(rows.map(f).filter((x) => x != null));
  console.log(`${a.m > 0 && b.m > 0 && o.t >= 2 ? '✓' : ' '} ${name.padEnd(36)} all ${pc(o.m)} (t ${o.t.toFixed(1)}, n ${o.n}) | Jan–May ${pc(a.m)} n ${a.n} | Jun–Sep ${pc(b.m)} n ${b.n}`); };
console.log(`Part A — ${rows.length} stock-weeks · ${new Set(rows.map((r) => r.s)).size} names · next-week beta-adjusted return, signed by the flow call\n`);
const sg = (d) => (d === 'bullish' ? 1 : d === 'bearish' ? -1 : null);
show('7d direction (bull long / bear short)', (r) => (sg(r.dir7) == null ? null : sg(r.dir7) * r.x));
show('1d direction', (r) => (sg(r.dir1) == null ? null : sg(r.dir1) * r.x));
show('7d bullish only (long)', (r) => (r.dir7 === 'bullish' ? r.x : null));
show('7d bearish only (short)', (r) => (r.dir7 === 'bearish' ? -r.x : null));
show('7d direction + sweep alignment', (r) => (sg(r.dir7) == null || !r.sweep ? null : sg(r.dir7) * r.x));
// A2 weekly long-short on composite
const ls = []; for (const fd of fridays) { const w = rows.filter((r) => r.fd === fd && Number.isFinite(r.c7)).sort((a, b) => b.c7 - a.c7); if (w.length < 10) continue; const top = w.slice(0, 4), bot = w.slice(-4); ls.push({ half: fd < '2026-06-01' ? 'H1' : 'H2', v: top.reduce((a, r) => a + r.x, 0) / 4 - bot.reduce((a, r) => a + r.x, 0) / 4 }); }
{ const a = st(ls.filter((x) => x.half === 'H1').map((x) => x.v)), b = st(ls.filter((x) => x.half === 'H2').map((x) => x.v)), o = st(ls.map((x) => x.v)); console.log(`${a.m > 0 && b.m > 0 && o.t >= 2 ? '✓' : ' '} ${'composite-7d top4 − bottom4 (weekly)'.padEnd(36)} all ${pc(o.m)} (t ${o.t.toFixed(1)}, n ${o.n} weeks) | Jan–May ${pc(a.m)} | Jun–Sep ${pc(b.m)}`); }
const xs = rows.filter((r) => Number.isFinite(r.c7)), mx = xs.reduce((a, r) => a + r.c7, 0) / xs.length, my = xs.reduce((a, r) => a + r.x, 0) / xs.length;
console.log(`  corr(composite 7d, next-week return) = ${(xs.reduce((a, r) => a + (r.c7 - mx) * (r.x - my), 0) / Math.sqrt(xs.reduce((a, r) => a + (r.c7 - mx) ** 2, 0) * xs.reduce((a, r) => a + (r.x - my) ** 2, 0))).toFixed(3)}`);

// Part B — A+ trades vs prior-session flow
console.log('\nPart B — A+ trades: did the prior session\'s flow agree with the trade?');
const J = path.join(HERE, 'journal'), tr = [];
for (const f of fs.readdirSync(J).filter((f) => /^aplus_walk\.[A-Z]+\.2026-\d\d-\d\d_2026-10-02\.json$/.test(f))) {
  const sym = f.split('.')[1]; for (const t of JSON.parse(fs.readFileSync(path.join(J, f), 'utf8')).trades) if (t.ret != null || Number.isFinite(t.R)) tr.push({ sym, ...t, file: f });
}
const uniq = new Map(); for (const t of tr) uniq.set(`${t.sym}|${t.D}|${t.dir}`, t);
const B = [];
for (const t of uniq.values()) { const prev = days[days.indexOf(t.D) - 1]; if (!prev) continue; const a = await agg(t.sym, prev); if (!a?.d7) continue; const want = t.dir === 'up' ? 'bullish' : 'bearish', against = t.dir === 'up' ? 'bearish' : 'bullish';
  B.push({ ...t, f7: a.d7.direction === want ? 'agree' : a.d7.direction === against ? 'against' : 'neutral', f1: a.d1?.direction === want ? 'agree' : a.d1?.direction === against ? 'against' : 'neutral' }); }
for (const k of ['f7', 'f1']) for (const v of ['agree', 'neutral', 'against']) { const X = B.filter((b) => b[k] === v), P = X.filter((b) => b.ret != null);
  console.log(`  ${k === 'f7' ? '7d' : '1d'} flow ${v.padEnd(8)} n ${String(X.length).padStart(3)} · win(R>0) ${X.length ? Math.round(X.filter((b) => b.R > 0).length / X.length * 100) : 0}% · avg R ${X.length ? (X.reduce((a, b) => a + b.R, 0) / X.length).toFixed(2) : '-'} · option-priced ${P.length}: ${P.length ? '$' + Math.round(P.reduce((a, b) => a + b.ret, 0) * 1000) : '-'}`); }
fs.writeFileSync(path.join(J, 'flow_study.json'), JSON.stringify({ weekly: rows, trades: B }));
