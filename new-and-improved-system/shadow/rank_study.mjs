#!/usr/bin/env node
// HOW TO FIND THE STOCKS — weekly stock-picking rankers on the 296-stock universe (the Skylit-covered names, ETFs removed).
// Locked 2026-10-03 BEFORE running. Daily bars only (Atlas, 1 credit/stock once, cached in .cache/daily/).
//   Every Friday close: rank all stocks by each ranker → pick the top 20 → hold next 5 sessions (Mon open → Fri close).
//   Score = pick return MINUS the equal-weight universe return that week (the market is taken out), also per ATR.
//   TRAIN 2023–2024 · TEST 2025 · HOLDOUT 2026 YTD. A ranker "works" only if excess > 0 in all three AND overall t ≥ 2.
// Known bias: the universe is today's popular names (survivorship) — momentum-style rankers are flattered. Read with that in mind.
//   node shadow/rank_study.mjs [--fetch]
import fs from 'node:fs';
import path from 'node:path';
import { atlasHistory } from '../feeds/skylit.js';
import { etToUnix } from '../lib/time.js';

const HERE = decodeURIComponent(new URL('.', import.meta.url).pathname), DIR = path.join(HERE, '..', '.cache', 'daily');
const ETF = new Set('ARKK DIA DRAM ETHA EWY FXI GDX GLD HYG IBIT IGV IVV IWM KRE KWEB QQQ SLV SMH SOXL SPY SQQQ TLT TQQQ USO UVXY XLB XLC XLE XLF XLI XLK XLP XLU XLV XLY GOOG'.split(' '));
const UNI = JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', 'apps/gex/research/stock-gex/universe-structures.json'), 'utf8')).rows.map((r) => r.ticker).filter((t) => !ETF.has(t)).sort();
const ymd = (t) => new Date((t + 12 * 3600) * 1000).toISOString().slice(0, 10);
fs.mkdirSync(DIR, { recursive: true });
if (process.argv.includes('--fetch')) {
  let n = 0;
  for (const s of [...UNI, 'SPY']) {
    const f = path.join(DIR, `${s}.json`); if (fs.existsSync(f)) continue;
    const b = await atlasHistory(s, 'D', etToUnix('2022-01-03', '09:30'), etToUnix('2026-10-02', '16:00')).catch(() => []);
    fs.writeFileSync(f, JSON.stringify(b)); n++;
  }
  console.log(`fetched ${n}`);
}
const D = new Map();
for (const s of UNI) { const f = path.join(DIR, `${s}.json`); if (!fs.existsSync(f)) continue; const b = JSON.parse(fs.readFileSync(f, 'utf8')); if (b.length > 60) D.set(s, new Map(b.map((x) => [ymd(x.t), x]))); }
const spy = JSON.parse(fs.readFileSync(path.join(DIR, 'SPY.json'), 'utf8')), days = spy.map((x) => ymd(x.t));
const fridays = days.filter((d, i) => i + 1 < days.length && new Date(days[i + 1] + 'T12:00:00Z') - new Date(d + 'T12:00:00Z') > 86400000 * 1.5 && new Date(d + 'T12:00:00Z').getUTCDay() >= 4);

const ema = (xs, n) => { const k = 2 / (n + 1); let e = xs[0]; for (const x of xs.slice(1)) e = x * k + e * (1 - k); return e; };
// features as of the close of day index i (only bars ≤ i)
function feat(m, i) {
  const bs = []; for (let j = Math.max(0, i - 260); j <= i; j++) { const b = m.get(days[j]); if (b) bs.push(b); }
  if (bs.length < 60 || ymd(bs.at(-1).t) !== days[i]) return null;
  const c = bs.map((b) => b.c), L = c.length, r = (n) => (L > n ? c[L - 1] / c[L - 1 - n] - 1 : null);
  const tr = bs.slice(-15).map((b, k, xs) => (k ? Math.max(b.h - b.l, Math.abs(b.h - xs[k - 1].c), Math.abs(b.l - xs[k - 1].c)) : null)).filter((x) => x != null);
  const atr = tr.reduce((a, x) => a + x, 0) / tr.length / c[L - 1];
  const e20 = ema(c.slice(-120), 20), e50 = ema(c.slice(-150), 50), e50prev = ema(c.slice(-155, -5), 50);
  const v5 = bs.slice(-5).reduce((a, b) => a + b.v, 0) / 5, v50 = bs.slice(-50).reduce((a, b) => a + b.v, 0) / 50;
  const hi252 = Math.max(...bs.slice(-252).map((b) => b.h)), hi20 = Math.max(...bs.slice(-21, -1).map((b) => b.h));
  const up = c[L - 1] > e20 && e20 > e50 && e50 > e50prev;
  return { r5: r(5), r20: r(20), r60: r(60), r12_1: L > 252 ? c[L - 22] / c[L - 253] - 1 : null, atr, nearHi: c[L - 1] / hi252, full252: bs.length >= 253,
    trendQ: (c[L - 1] - e50) / (atr * c[L - 1]), up, volX: v5 / v50, brk20: c[L - 1] > hi20, px: c[L - 1], dollarVol: v50 * c[L - 1] };
}
// ranker → score (higher = pick) or null (not eligible). Direction is long for all.
const RANK = {
  'momentum 20d': (f) => f.r20,
  'momentum 60d': (f) => f.r60,
  'momentum 12-1 (classic)': (f) => f.r12_1,
  'near 52-week high': (f) => (f.full252 ? f.nearHi : null),
  'trend quality (above EMAs, dist/ATR)': (f) => (f.up ? f.trendQ : null),
  '20d breakout on volume': (f) => (f.brk20 && f.volX > 1.5 ? f.volX : null),
  'volume surge (5d/50d) + up week': (f) => (f.r5 > 0 ? f.volX : null),
  'pullback in uptrend (dip in leader)': (f) => (f.up && f.r60 > 0 ? -f.r5 : null),
  'short-term losers (5d reversal)': (f) => -f.r5,
  'calm stocks (low ATR%)': (f) => -f.atr,
  'wild stocks (high ATR%)': (f) => f.atr,
  'leader + pullback (60d top⅓, 5d down)': (f) => null, // filled by rank-within below
};
const HOLD = process.argv.includes('--hold') ? +process.argv[process.argv.indexOf('--hold') + 1] : 5, STEP = HOLD >= 20 ? 4 : 1;
const TOP = 20, per = (d) => (d < '2025-01-01' ? 'TRAIN' : d < '2026-01-01' ? 'TEST' : 'HOLD');
const res = Object.fromEntries(Object.keys(RANK).map((k) => [k, []]));
for (const [wk, fd] of fridays.filter((d) => d >= '2023-01-01').entries()) {
  if (wk % STEP) continue;
  const i = days.indexOf(fd); if (i < 260 || i + HOLD >= days.length) continue;
  const o = days[i + 1], cl = days[i + HOLD];
  const rows = [];
  for (const [s, m] of D) { const f = feat(m, i), bo = m.get(o), bc = m.get(cl); if (!f || !bo || !bc || f.px < 5 || f.dollarVol < 2e7) continue; rows.push({ s, f, ret: bc.c / bo.o - 1 }); }
  if (rows.length < 100) continue;
  const uni = rows.reduce((a, x) => a + x.ret, 0) / rows.length;
  const r60s = rows.map((x) => x.f.r60).sort((a, b) => a - b), cut = r60s[Math.floor(r60s.length * 2 / 3)];
  for (const [name, fn] of Object.entries(RANK)) {
    let sc = rows.map((x) => ({ ...x, sc: name.startsWith('leader + pullback') ? (x.f.r60 >= cut && x.f.r5 < 0 ? -x.f.r5 : null) : fn(x.f) })).filter((x) => x.sc != null && Number.isFinite(x.sc));
    if (sc.length < 5) continue; // fewer than 20 eligible (e.g. breakouts) → take all of them, min 5
    const pick = sc.sort((a, b) => b.sc - a.sc).slice(0, TOP), N = pick.length;
    const pr = pick.reduce((a, x) => a + x.ret, 0) / N, patr = pick.reduce((a, x) => a + x.ret / x.f.atr, 0) / N;
    res[name].push({ fd, per: per(fd), ex: pr - uni, exAtr: patr - rows.reduce((a, x) => a + x.ret / x.f.atr, 0) / rows.length, abs: pick.reduce((a, x) => a + Math.abs(x.ret), 0) / N, picks: pick.map((x) => x.s) });
  }
}
const S = (R, k = 'ex') => { if (!R.length) return { n: 0, m: NaN, t: NaN, hit: NaN }; const v = R.map((x) => x[k]), m = v.reduce((a, x) => a + x, 0) / v.length, sd = Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1)); return { n: v.length, m, t: m / (sd / Math.sqrt(v.length)), hit: v.filter((x) => x > 0).length / v.length }; };
const pc = (x) => (x >= 0 ? '+' : '') + (x * 100).toFixed(2) + '%';
console.log(`universe ${D.size} stocks (ETFs removed, px≥$5, $20M+/day) · ${res['momentum 20d'].length} weeks · top ${TOP} per rebalance, held ${HOLD} sessions (open→close)\n`);
console.log('weekly EXCESS return vs the equal-weight universe (avg per week)');
console.log(`${'ranker'.padEnd(40)} ${'TRAIN 23-24'.padStart(12)} ${'TEST 2025'.padStart(11)} ${'HOLD 2026'.padStart(11)}   all: t     hit   |move|`);
const out = [];
for (const [name, R] of Object.entries(res)) {
  const a = S(R.filter((x) => x.per === 'TRAIN')), b = S(R.filter((x) => x.per === 'TEST')), c = S(R.filter((x) => x.per === 'HOLD')), all = S(R);
  const works = a.m > 0 && b.m > 0 && c.m > 0 && all.t >= 2;
  out.push({ name, works, train: a.m, test: b.m, hold: c.m, t: all.t, n: all.n });
  console.log(`${works ? '✓' : ' '} ${name.padEnd(38)} ${pc(a.m).padStart(12)} ${pc(b.m).padStart(11)} ${pc(c.m).padStart(11)}   ${all.t.toFixed(1).padStart(5)}  ${(all.hit * 100).toFixed(0).padStart(3)}%  ${pc(R.reduce((x, y) => x + y.abs, 0) / R.length).padStart(7)}`);
}
console.log('\n(risk-adjusted: same, in ATR units of each pick — removes "it just picked volatile stocks")');
for (const [name, R] of Object.entries(res)) { const a = S(R.filter((x) => x.per === 'TRAIN'), 'exAtr'), b = S(R.filter((x) => x.per === 'TEST'), 'exAtr'), c = S(R.filter((x) => x.per === 'HOLD'), 'exAtr'), all = S(R, 'exAtr'); console.log(`  ${name.padEnd(38)} ${a.m.toFixed(3).padStart(12)} ${b.m.toFixed(3).padStart(11)} ${c.m.toFixed(3).padStart(11)}   t ${all.t.toFixed(1)}`); }
fs.writeFileSync(path.join(HERE, 'journal', `rank_study.hold${HOLD}.json`), JSON.stringify({ summary: out, weeks: res }));
const last = Object.fromEntries(Object.entries(res).map(([k, R]) => [k, R.at(-1)?.picks]));
console.log('\nlatest picks (week of', res['momentum 20d'].at(-1)?.fd, '):'); for (const [k, v] of Object.entries(last)) if (out.find((o) => o.name === k)?.works) console.log(`  ${k}: ${v?.join(' ')}`);
