#!/usr/bin/env node
// Amendment 4 — same-day theme capture at 10:30 / 11:00 (shadow/DESIGN_weekly_winners.md).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const SH = path.dirname(fileURLToPath(import.meta.url)), W = path.join(SH, '..', '.cache', 'winners'), IN = path.join(W, '_intraday'), OUT = path.join(SH, 'results_winners'), COST = 0.0005;
const ETF = new Set(['SPY', 'QQQ', 'XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLI', 'XLU', 'XLB', 'XLRE', 'XLC', 'SMH', 'IGV']);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN), sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const D = {}; for (const f of fs.readdirSync(W)) { if (!f.endsWith('.json') || f.startsWith('_')) continue; const t = f.replace('.json', ''); if (ETF.has(t)) continue; const o = JSON.parse(fs.readFileSync(path.join(W, f), 'utf8')).ohlc.slice().sort((a, b) => a.d.localeCompare(b.d)); D[t] = { o, oi: new Map(o.map((b, i) => [b.d, i])) }; }
const allDays = [...new Set(Object.values(D).flatMap((x) => x.o.map((b) => b.d)))].sort();
function peers(d, ts) { const k = allDays.indexOf(d), win = allDays.slice(k - 61, k), z = {}; for (const t of ts) { const X = D[t], r = []; for (let q = 1; q < win.length; q++) { const a = X.oi.get(win[q - 1]), b = X.oi.get(win[q]); r.push(a != null && b != null ? X.o[b].c / X.o[a].c - 1 : 0); } const m = mean(r), s = sd(r) || 1; z[t] = r.map((x) => (x - m) / s); }
  const P = {}, ks = Object.keys(z); for (const a of ks) { const c = ks.filter((b) => b !== a).map((b) => [b, z[a].reduce((s, v, q) => s + v * z[b][q], 0)]); c.sort((x, y) => y[1] - x[1]); P[a] = c.slice(0, 10).map((x) => x[0]); } return P; }
const days = fs.readdirSync(IN).map((f) => f.slice(0, 10)).sort(), per = {};
for (const d of days) { const B = JSON.parse(fs.readFileSync(path.join(IN, `${d}.json`), 'utf8')); const ts = Object.keys(B).filter((t) => B[t] && D[t]); if (ts.length < 200) continue; const P = peers(d, ts);
  for (const [entryIdx, tag] of [[1, '1030'], [2, '1100']]) { const rows = ts.map((t) => { const [o, a, b, c] = B[t]; const e = entryIdx === 1 ? a : b; return { t, m: e / o - 1, r: c / e - 1 }; }).filter((x) => Number.isFinite(x.m) && Number.isFinite(x.r) && Math.abs(x.r) < 0.3);
    const by = new Map(rows.map((x) => [x.t, x])); for (const x of rows) { const p = (P[x.t] ?? []).map((q) => by.get(q)).filter(Boolean); x.p = p.length ? mean(p.map((q) => q.m)) : NaN; }
    const rk = (k) => { const v = rows.filter((x) => Number.isFinite(x[k])).sort((a, b) => a[k] - b[k]); v.forEach((x, i) => (x['q' + k] = i / (v.length - 1))); }; rk('m'); rk('p');
    for (const x of rows) { x.I1 = x.qm + x.qp; x.I2 = x.p; x.I3 = Math.sign(x.m) === Math.sign(x.p) ? x.I1 : NaN; } const um = mean(rows.map((x) => x.r));
    for (const k of tag === '1030' ? ['I1', 'I2', 'I3'] : ['I1']) { const v = rows.filter((x) => Number.isFinite(x[k])).sort((a, b) => b[k] - a[k]), L = v.slice(0, 10), S = v.slice(-10);
      (per[`${k}@${tag}`] ??= []).push({ d, long: mean(L.map((x) => x.r)) - um - 2 * COST, short: mean(S.map((x) => x.r)) - um + 2 * COST, lp: L.map((x) => `${x.t} ${(x.r * 100).toFixed(1)}%`), sp: S.map((x) => `${x.t} ${(x.r * 100).toFixed(1)}%`) }); } } }
const St = (a, f) => { const v = a.map(f); return { n: v.length, m: mean(v), t: v.length > 2 ? mean(v) / (sd(v) / Math.sqrt(v.length)) : NaN }; };
const Phi = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
const H = []; for (const [k, a] of Object.entries(per)) for (const side of ['long', 'short']) { const b = a.filter((x) => x.d <= '2026-08-31'), h = a.filter((x) => x.d >= '2026-09-01'), sg = side === 'long' ? 1 : -1;
  const hs = St(h, (x) => sg * x[side]), sp = St(h, (x) => x.long - x.short); H.push({ k, side, build: St(b, (x) => x[side]), hold: St(h, (x) => x[side]), spread: sp, buildSpread: St(b, (x) => x.long - x.short), p: Number.isFinite(hs.t) ? 1 - Phi(hs.t) : 1, last: a.at(-1) }); }
const o = H.map((r, i) => [r.p, i]).sort((a, b) => a[0] - b[0]); let kmax = -1; o.forEach(([p], q) => { if (p <= ((q + 1) / o.length) * 0.1) kmax = q; }); const pass = new Set(o.slice(0, kmax + 1).map(([, i]) => i));
H.forEach((r, i) => { r.ok = pass.has(i) && r.spread.t >= 2 && (r.side === 'long' ? r.hold.m > 0 : r.hold.m < 0); });
const pc = (x) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + (x * 100).toFixed(3) + '%' : '—'), f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '—');
const L = ['# Weekly winners — amendment 4: same-day theme capture', `\nRun ${new Date().toISOString()} · ${days.length} sessions · excess vs universe, after 0.05%/side\n`, `**Validated: ${H.filter((r) => r.ok).map((r) => r.k + ' ' + r.side).join(', ') || 'none'}**\n`,
  '| rule | side | build Jul–Aug: excess/day (t) | holdout Sep 1 → Oct 15: excess/day (t) | holdout long − short (t) | 10-15 picks |', '|---|---|---|---|---|---|',
  ...H.map((r) => `| ${r.k} | ${r.side} | ${pc(r.build.m)} (${f2(r.build.t)}) | **${pc(r.hold.m)} (${f2(r.hold.t)})** | ${pc(r.spread.m)} (${f2(r.spread.t)}) | ${(r.side === 'long' ? r.last.lp : r.last.sp).slice(0, 5).join(', ')} |`)];
fs.writeFileSync(path.join(OUT, 'intraday_theme.md'), L.join('\n') + '\n'); console.log(L.join('\n'));
