#!/usr/bin/env node
// Weekly winners amendment 3 — bracket the likely big movers (shadow/DESIGN_weekly_winners.md).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const SH = path.dirname(fileURLToPath(import.meta.url)), W = path.join(SH, '..', '.cache', 'winners'), OUT = path.join(SH, 'results_winners');
const ETF = new Set(['SPY', 'QQQ', 'XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLI', 'XLU', 'XLB', 'XLRE', 'XLC', 'SMH', 'IGV']), COST = 0.001;
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN), sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); }, num = (x) => (x == null ? NaN : +x);
const D = {}; for (const f of fs.readdirSync(W)) { if (f.startsWith('_')) continue; const t = f.replace('.json', ''); if (ETF.has(t)) continue; const j = JSON.parse(fs.readFileSync(path.join(W, f), 'utf8')); const o = j.ohlc.slice().sort((a, b) => a.d.localeCompare(b.d)); if (o.length < 300) continue; D[t] = { o, oi: new Map(o.map((b, i) => [b.d, i])), fl: new Map(j.flow.map((x) => [x.date, x])) }; }
const T = Object.keys(D).sort(), days = [...new Set(Object.values(D).flatMap((x) => x.o.map((b) => b.d)))].sort().filter((d) => Object.values(D).filter((x) => x.oi.has(d)).length > 200);
const wk = (d) => { const x = new Date(d + 'T12:00:00Z'), day = (x.getUTCDay() + 6) % 7; return new Date(x.getTime() - day * 864e5).toISOString().slice(0, 10); };
const weeks = []; { let cur = null; for (const d of days) { if (!cur || cur.k !== wk(d)) { cur = { k: wk(d), s: [] }; weeks.push(cur); } cur.s.push(d); } }
let seed = 11; const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
function score(t, d) { const X = D[t], i = X.oi.get(d); if (i == null || i < 40) return null; const o = X.o; const lr = []; for (let q = i - 19; q <= i; q++) lr.push(Math.log(o[q].c / o[q - 1].c)); const rv = sd(lr);
  const k = days.indexOf(d), f5 = days.slice(k - 4, k + 1).map((z) => X.fl.get(z)).filter(Boolean), f30 = days.slice(k - 29, k + 1).map((z) => X.fl.get(z)).filter(Boolean); if (f5.length < 4 || f30.length < 20) return { rv, B2: NaN, B3: NaN };
  const c30 = mean(f30.map((x) => num(x.call_volume))), p30 = mean(f30.map((x) => num(x.call_premium) + num(x.put_premium)));
  return { rv, B2: c30 > 0 ? mean(f5.map((x) => num(x.call_volume))) / c30 : NaN, B3: p30 > 0 ? Math.abs(f5.reduce((s, x) => s + num(x.net_call_premium) - num(x.net_put_premium), 0) / p30) : NaN }; }
function bracket(t, d0, sess, X) { const Xo = D[t], c0 = Xo.o[Xo.oi.get(d0)].c, up = c0 * (1 + X), dn = c0 * (1 - X); let pos = null, entry = null;
  for (const d of sess) { const i = Xo.oi.get(d); if (i == null) continue; const b = Xo.o[i];
    if (!pos) { const hu = b.h >= up, hd = b.l <= dn; if (hu && hd) return -X - COST; if (!hu && !hd) continue; pos = hu ? 1 : -1; const gap = pos > 0 ? b.o >= up : b.o <= dn; entry = gap ? b.o : pos > 0 ? up : dn;
      if (!gap && (pos > 0 ? b.l <= c0 : b.h >= c0)) return pos * (c0 - entry) / entry - COST; if (pos > 0 ? b.c <= c0 : b.c >= c0) return pos * (c0 - entry) / entry - COST; continue; }
    if (pos > 0 ? b.l <= c0 : b.h >= c0) { const fill = pos > 0 ? Math.min(c0, b.o) : Math.max(c0, b.o); return pos * (fill - entry) / entry - COST; } }
  if (!pos) return 0; const last = Xo.o[Xo.oi.get(sess.at(-1))]; return last ? pos * (last.c - entry) / entry - COST : 0; }
const res = {}, cover = {}, trig = {};
for (let w = 1; w < weeks.length; w++) { const d0 = weeks[w - 1].s.at(-1), sess = weeks[w].s; if (d0 < '2024-11-22') continue; const rows = []; for (const t of T) { const s = score(t, d0); const a = D[t].oi.get(d0), b = D[t].oi.get(sess.at(-1)); if (!s || a == null || b == null) continue; const r = D[t].o[b].c / D[t].o[a].c - 1; if (Math.abs(r) > 0.45) continue; rows.push({ t, ...s, r }); }
  if (rows.length < 150) continue; const rk = (k) => { const v = rows.filter((r) => Number.isFinite(r[k])).sort((a, b) => a[k] - b[k]); v.forEach((r, i) => (r['q' + k] = i / (v.length - 1))); }; rk('rv'); rk('B2'); for (const r of rows) r.B4 = Number.isFinite(r.qrv) && Number.isFinite(r.qB2) ? (r.qrv + r.qB2) / 2 : NaN;
  const so = rows.map((r) => r.r).sort((a, b) => a - b), hi = so[Math.floor(0.9 * (so.length - 1))], lo = so[Math.floor(0.1 * (so.length - 1))];
  const ctl = [...rows]; for (let i = ctl.length - 1; i > 0; i--) { const k = Math.floor(rnd() * (i + 1)); [ctl[i], ctl[k]] = [ctl[k], ctl[i]]; }
  const sets = { B1: rows.slice().sort((a, b) => b.rv - a.rv).slice(0, 10), B2: rows.filter((r) => Number.isFinite(r.B2)).sort((a, b) => b.B2 - a.B2).slice(0, 10), B3: rows.filter((r) => Number.isFinite(r.B3)).sort((a, b) => b.B3 - a.B3).slice(0, 10), B4: rows.filter((r) => Number.isFinite(r.B4)).sort((a, b) => b.B4 - a.B4).slice(0, 10), CTL: ctl.slice(0, 10) };
  for (const X of [0.03, 0.05]) { const c = mean(sets.CTL.map((r) => bracket(r.t, d0, sess, X)));
    for (const k of ['B1', 'B2', 'B3', 'B4']) { const v = sets[k].map((r) => bracket(r.t, d0, sess, X)), key = `${k}_${X * 100}`; (res[key] ??= []).push({ t0: d0, ex: mean(v) - c, m: mean(v), c, picks: sets[k].map((r, i) => `${r.t} ${(v[i] * 100).toFixed(1)}%`) });
      (cover[key] ??= []).push(sets[k].filter((r) => r.r >= hi || r.r <= lo).length / 10); (trig[key] ??= []).push(v.filter((x) => x !== 0).length / 10); } } }
const S = (a) => ({ n: a.length, ex: mean(a.map((x) => x.ex)), m: mean(a.map((x) => x.m)), c: mean(a.map((x) => x.c)), t: a.length > 2 ? mean(a.map((x) => x.ex)) / (sd(a.map((x) => x.ex)) / Math.sqrt(a.length)) : NaN });
const Phi = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
const R = Object.entries(res).map(([k, a]) => ({ k, build: S(a.filter((x) => x.t0 <= '2025-12-26')), hold: S(a.filter((x) => x.t0 >= '2026-01-02' && x.t0 <= '2026-10-02')), month: S(a.filter((x) => x.t0 >= '2026-09-11')), thisWeek: a.find((x) => x.t0 === '2026-10-09'), cover: mean(cover[k]), trig: mean(trig[k]) }));
R.forEach((r) => { r.p = Number.isFinite(r.hold.t) ? 1 - Phi(r.hold.t) : 1; }); const o = R.map((r, i) => [r.p, i]).sort((a, b) => a[0] - b[0]); let kmax = -1; o.forEach(([p], q) => { if (p <= ((q + 1) / o.length) * 0.1) kmax = q; }); const pass = new Set(o.slice(0, kmax + 1).map(([, i]) => i)); R.forEach((r, i) => { r.ok = pass.has(i) && r.hold.ex > 0; });
const pc = (x) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + (x * 100).toFixed(2) + '%' : '—'), f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '—');
const LAB = { B1: '20-day realized vol', B2: 'call-volume surge', B3: '|directional flow|', B4: 'vol + call surge' };
const L = ['# Weekly winners — amendment 3: bracket the likely big movers', `\nRun ${new Date().toISOString()} · OCO buy-stop / sell-stop at ±X from Friday close, stop at Friday close, exit week end, 0.10% cost\n`, `**Validated (BH q = 0.10 across 8, holdout excess > 0): ${R.filter((r) => r.ok).map((r) => r.k).join(', ') || 'none'}**\n`,
  '| score, X | last month: per trade (vs random) | build: per trade − random (t) | holdout 2026: per trade − random (t) | this week | picks held a top/bottom-10% mover | triggered |', '|---|---|---|---|---|---|---|',
  ...R.map((r) => { const [b, x] = r.k.split('_'); return `| ${LAB[b]}, ±${x}% | **${pc(r.month.m)} (${pc(r.month.c)})** | ${pc(r.build.ex)} (${f2(r.build.t)}) | **${pc(r.hold.ex)} (${f2(r.hold.t)})**, raw ${pc(r.hold.m)} | ${r.thisWeek ? pc(r.thisWeek.m) + ' vs ' + pc(r.thisWeek.c) : '—'} | ${(r.cover * 100).toFixed(0)}% | ${(r.trig * 100).toFixed(0)}% |`; })];
fs.writeFileSync(path.join(OUT, 'bracket.md'), L.join('\n') + '\n'); fs.writeFileSync(path.join(OUT, 'bracket_detail.json'), JSON.stringify(R.map((r) => ({ k: r.k, thisWeek: r.thisWeek })), null, 1)); console.log(L.join('\n'));
