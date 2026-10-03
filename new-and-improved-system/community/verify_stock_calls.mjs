#!/usr/bin/env node
// verify_stock_calls.mjs — do the room's STOCK picks (non-index) actually move the called way? Locked 2026-10-03 BEFORE running.
//   calls  : action entry|call|add|watch, direction bullish|bearish, ticker not an index/ETF/future; times are UTC.
//   dedupe : same author+ticker+direction within 5 sessions counts once (first post).
//   entry  : OPEN of the first session that starts after the post (no look-ahead; intraday posts give up that day's move).
//   score  : sign × (stock return − SPY return) to the close 1 / 5 / 20 sessions later.
//   beta   : also sign × (stock − β·SPY), β from the 60 sessions before entry (high-beta names beat SPY in up-markets by construction).
//   halves : split at the median call date. ✓ = 5-session excess > 0 in both halves, n ≥ 20 each, overall t ≥ 2.
// Daily bars: ../.cache/daily (rank_study), missing tickers fetched once via Atlas (1 credit each).
import fs from 'node:fs';
import path from 'node:path';
import { atlasHistory } from '../feeds/skylit.js';
import { etToUnix } from '../lib/time.js';

const HERE = decodeURIComponent(new URL('.', import.meta.url).pathname), DIR = path.join(HERE, '..', '.cache', 'daily');
const IDX = new Set('SPX SPXW SPY QQQ NDX NQ ES IWM VIX RUT DIA MES MNQ XSP DXY BTC ETH GLD SLV TLT SMH UVXY SQQQ TQQQ SOXL XLK XLF XLE XLV XLY XLP XLI XLU XLB XLC KRE ARKK IBIT HYG GDX USO CL GC'.split(' '));
const calls = [];
for (const f of fs.readdirSync(path.join(HERE, 'ledgers')).filter((f) => f.startsWith('calls_'))) {
  for (const l of fs.readFileSync(path.join(HERE, 'ledgers', f), 'utf8').split('\n')) {
    if (!l.trim()) continue; let r; try { r = JSON.parse(l); } catch { continue; }
    const tk = (r.ticker || '').toUpperCase().replace('$', '');
    if (!tk || IDX.has(tk) || !/^[A-Z.]{1,6}$/.test(tk) || !['bullish', 'bearish'].includes(r.direction) || !['entry', 'call', 'add', 'watch'].includes(r.action) || !r.time) continue;
    const t = Math.floor(Date.parse(r.time.length === 16 ? r.time + ':00Z' : r.time) / 1000); if (!Number.isFinite(t)) continue;
    calls.push({ t, tk, dir: r.direction === 'bullish' ? 1 : -1, author: (r.author || '?').replace(/[^\x20-\x7E]/g, '').trim().slice(0, 22), action: r.action, chan: r.chan, quote: r.quote });
  }
}
const ymd = (t) => new Date((t + 12 * 3600) * 1000).toISOString().slice(0, 10);
const bars = new Map();
const tks = [...new Set(calls.map((c) => c.tk)), 'SPY'];
let fetched = 0;
for (const tk of tks) {
  const f = path.join(DIR, `${tk}.json`);
  if (!fs.existsSync(f)) { const b = await atlasHistory(tk, 'D', etToUnix('2025-01-02', '09:30'), etToUnix('2026-10-02', '16:00')).catch(() => []); fs.writeFileSync(f, JSON.stringify(b)); fetched++; }
  const b = JSON.parse(fs.readFileSync(f, 'utf8')); if (b.length) bars.set(tk, b.map((x) => ({ ...x, d: ymd(x.t) })));
}
const spy = bars.get('SPY'), spyIx = new Map(spy.map((b, i) => [b.d, i]));
const openT = (d) => etToUnix(d, '09:30');
const rows = [], seen = new Map();
for (const c of calls.sort((a, b) => a.t - b.t)) {
  const b = bars.get(c.tk); if (!b) continue;
  const i = b.findIndex((x) => openT(x.d) > c.t); if (i < 0) continue;
  const key = `${c.author}|${c.tk}|${c.dir}`; const prev = seen.get(key); if (prev != null && i - prev < 5) continue; seen.set(key, i);
  const si = spyIx.get(b[i].d); if (si == null) continue;
  const out = { ...c, date: b[i].d };
  let beta = 1; if (i > 61 && si > 61) { const xs = [], ys = []; for (let k = i - 60; k < i; k++) { const sk = spyIx.get(b[k].d), sk1 = spyIx.get(b[k - 1].d); if (sk == null || sk1 == null) continue; xs.push(spy[sk].c / spy[sk1].c - 1); ys.push(b[k].c / b[k - 1].c - 1); }
    if (xs.length > 40) { const mx = xs.reduce((a, x) => a + x, 0) / xs.length, my = ys.reduce((a, x) => a + x, 0) / ys.length; beta = xs.reduce((a, x, k) => a + (x - mx) * (ys[k] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0); } }
  out.beta = beta;
  for (const h of [1, 5, 20]) { const j = i + h - 1; if (j >= b.length || si + h - 1 >= spy.length) { out[`x${h}`] = null; continue; } const sr = spy[si + h - 1].c / spy[si].o - 1, rr = b[j].c / b[i].o - 1; out[`x${h}`] = c.dir * (rr - sr); out[`b${h}`] = c.dir * (rr - beta * sr); }
  rows.push(out);
}
const med = [...rows].sort((a, b) => a.t - b.t)[Math.floor(rows.length / 2)].date;
const st = (R, k) => { const v = R.map((r) => r[k]).filter((x) => x != null); if (v.length < 2) return { n: v.length, m: NaN, t: NaN }; const m = v.reduce((a, x) => a + x, 0) / v.length, sd = Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1)); return { n: v.length, m, t: m / (sd / Math.sqrt(v.length)), hit: v.filter((x) => x > 0).length / v.length }; };
const pc = (x) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + (x * 100).toFixed(2) + '%' : '   -  ');
const line = (name, R) => {
  const a = st(R.filter((r) => r.date < med), 'b5'), b = st(R.filter((r) => r.date >= med), 'b5'), o1 = st(R, 'x1'), o5 = st(R, 'x5'), o20 = st(R, 'x20'), q5 = st(R, 'b5'), q20 = st(R, 'b20');
  const ok = a.m > 0 && b.m > 0 && a.n >= 20 && b.n >= 20 && q5.t >= 2;
  const medv = (k) => { const v = R.map((r) => r[k]).filter((x) => x != null).sort((x, y) => x - y); return v.length ? v[v.length >> 1] : NaN; };
  return `${ok ? '✓' : ' '} ${name.padEnd(28)} n=${String(o5.n).padStart(4)}  vsSPY 5d ${pc(o5.m).padStart(7)} 20d ${pc(o20.m).padStart(7)} | BETA-ADJ 5d ${pc(q5.m).padStart(7)} (t ${q5.t.toFixed(1).padStart(4)}, med ${pc(medv('b5'))}) 20d ${pc(q20.m).padStart(7)} (t ${q20.t.toFixed(1).padStart(4)}) | β-adj 5d halves ${pc(a.m)} n=${a.n} · ${pc(b.m)} n=${b.n}`;
};
console.log(`directional stock calls: ${calls.length} → ${rows.length} after dedupe/price match · ${new Set(rows.map((r) => r.tk)).size} tickers · fetched ${fetched} new · halves split at ${med}`);
console.log('excess return in the CALLED direction, entered next open · ✓ judged on BETA-ADJUSTED 5d\n');
console.log(line('ALL stock calls', rows));
for (const a of ['entry', 'add', 'call', 'watch']) console.log(line(`action: ${a}`, rows.filter((r) => r.action === a)));
console.log(line('bullish calls', rows.filter((r) => r.dir > 0))); console.log(line('bearish calls', rows.filter((r) => r.dir < 0)));
console.log('\n-- by caller (≥30 deduped calls) --');
const by = {}; for (const r of rows) (by[r.author] ??= []).push(r);
for (const [a, R] of Object.entries(by).filter(([, R]) => R.length >= 30).sort((x, y) => y[1].length - x[1].length)) console.log(line(a, R));
console.log('\n-- by channel --');
const bc = {}; for (const r of rows) (bc[r.chan] ??= []).push(r);
for (const [a, R] of Object.entries(bc)) console.log(line(a, R));
fs.writeFileSync(path.join(HERE, 'ledgers', 'verified_stock_calls.json'), JSON.stringify(rows));
