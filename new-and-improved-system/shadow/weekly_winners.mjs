#!/usr/bin/env node
// Weekly winners from UW flow (shadow/DESIGN_weekly_winners.md + amendment 1). Writes results_winners/summary.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SH = path.dirname(fileURLToPath(import.meta.url)), W = path.join(SH, '..', '.cache', 'winners'), OUT = path.join(SH, 'results_winners');
const ETF = new Set(['SPY', 'QQQ', 'XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLI', 'XLU', 'XLB', 'XLRE', 'XLC', 'SMH', 'IGV']);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN), sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const D = {}; for (const f of fs.readdirSync(W)) { if (f.startsWith('_')) continue; const t = f.replace('.json', ''); if (ETF.has(t)) continue; const j = JSON.parse(fs.readFileSync(path.join(W, f), 'utf8'));
  const o = j.ohlc.slice().sort((a, b) => a.d.localeCompare(b.d)), fl = new Map(j.flow.map((x) => [x.date, x])); if (o.length < 300) continue; D[t] = { o, oi: new Map(o.map((b, i) => [b.d, i])), fl }; }
const T = Object.keys(D), cal = D.SPY ? null : [...new Set(Object.values(D).flatMap((x) => x.o.map((b) => b.d)))].sort();
const days = cal.filter((d) => Object.values(D).filter((x) => x.oi.has(d)).length > 200);
// week-end sessions: last session of each ISO week
const wk = (d) => { const x = new Date(d + 'T12:00:00Z'), day = (x.getUTCDay() + 6) % 7; return new Date(x.getTime() - day * 864e5).toISOString().slice(0, 10); };
const ends = []; for (let i = 0; i < days.length; i++) if (i === days.length - 1 || wk(days[i + 1]) !== wk(days[i])) ends.push(days[i]);
const num = (x) => (x == null ? NaN : +x);
function feats(t, d) { const X = D[t], i = X.oi.get(d); if (i == null || i < 65) return null; const o = X.o, last5 = days.slice(days.indexOf(d) - 4, days.indexOf(d) + 1), last30 = days.slice(days.indexOf(d) - 29, days.indexOf(d) + 1);
  const F = (dd) => X.fl.get(dd); const f5 = last5.map(F).filter(Boolean), f30 = last30.map(F).filter(Boolean); if (f5.length < 4 || f30.length < 20) return null;
  const prem30 = mean(f30.map((x) => num(x.call_premium) + num(x.put_premium))); if (!(prem30 > 0)) return null;
  const dir = (x) => num(x.net_call_premium) - num(x.net_put_premium);
  const bb = f5.reduce((s, x) => s + num(x.bullish_premium) - num(x.bearish_premium), 0), bbd = f5.reduce((s, x) => s + num(x.bullish_premium) + num(x.bearish_premium), 0);
  const cav = f5.reduce((s, x) => s + num(x.call_volume_ask_side), 0), cbv = f5.reduce((s, x) => s + num(x.call_volume_bid_side), 0), pav = f5.reduce((s, x) => s + num(x.put_volume_ask_side), 0), pbv = f5.reduce((s, x) => s + num(x.put_volume_bid_side), 0);
  const c30 = mean(f30.map((x) => num(x.call_volume))), oi0 = num(F(days[days.indexOf(d) - 5])?.call_open_interest), oi1 = num(F(d)?.call_open_interest);
  return { W1: f5.reduce((s, x) => s + dir(x), 0) / prem30, W2: dir(F(d) ?? {}) / prem30, W3: bbd > 0 ? bb / bbd : NaN, W4: c30 > 0 ? mean(f5.map((x) => num(x.call_volume))) / c30 : NaN,
    W5: cav + cbv > 0 && pav + pbv > 0 ? cav / (cav + cbv) - pav / (pav + pbv) : NaN, W6: oi0 > 0 ? oi1 / oi0 - 1 : NaN, W7: o[i].c / o[i - 5].c - 1, W8: o[i].c / o[i - 21].c - 1 }; }
const rets = (t, i0, i1) => { const X = D[t]; const a = X.oi.get(i0), b = X.oi.get(i1); return a != null && b != null ? X.o[b].c / X.o[a].c - 1 : NaN; };
// peer groups (60-day daily-return correlation as of t)
function peers(d, ts) { const k = days.indexOf(d), win = days.slice(k - 60, k + 1), R = {}; for (const t of ts) { const r = []; for (let q = 1; q < win.length; q++) r.push(rets(t, win[q - 1], win[q])); if (r.filter(Number.isFinite).length > 50) R[t] = r.map((x) => (Number.isFinite(x) ? x : 0)); }
  const z = {}; for (const [t, r] of Object.entries(R)) { const m = mean(r), s = sd(r) || 1; z[t] = r.map((x) => (x - m) / s); }
  const P = {}; const keys = Object.keys(z); for (const a of keys) { const c = keys.filter((b) => b !== a).map((b) => [b, z[a].reduce((s, v, q) => s + v * z[b][q], 0)]); c.sort((x, y) => y[1] - x[1]); P[a] = c.slice(0, 10).map((x) => x[0]); } return P; }
const rank = (rows, k) => { const v = rows.filter((r) => Number.isFinite(r[k])).sort((a, b) => a[k] - b[k]); v.forEach((r, i) => (r['r_' + k] = i / Math.max(1, v.length - 1))); };
const FE = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'W10', 'W11', 'W12'], panel = [];
for (let w = 0; w < ends.length - 1; w++) { const t0 = ends[w], t1 = ends[w + 1]; if (t0 < '2024-11-22') continue;
  const rows = []; for (const t of T) { const f = feats(t, t0); if (!f) continue; const r = rets(t, t0, t1); if (!Number.isFinite(r) || Math.abs(r) > 0.45) continue; rows.push({ t, ...f, ret: r }); }
  if (rows.length < 150) continue; const P = peers(t0, rows.map((r) => r.t)), by = new Map(rows.map((r) => [r.t, r]));
  for (const r of rows) { const p = (P[r.t] ?? []).map((x) => by.get(x)).filter(Boolean); r.W9 = p.length ? mean(p.map((x) => x.W7)) : NaN; r.W10 = p.length ? mean(p.map((x) => x.W1).filter(Number.isFinite)) : NaN; }
  for (const k of ['W1', 'W3', 'W9', 'W10', 'W4']) rank(rows, k);
  for (const r of rows) { const parts = ['r_W1', 'r_W3', 'r_W9', 'r_W10'].map((k) => r[k]); r.W11 = parts.every(Number.isFinite) ? mean(parts) : NaN; r.W12 = Number.isFinite(r.W11) && r.r_W4 >= 0.5 ? r.W11 : NaN; }
  const sorted = rows.map((r) => r.ret).sort((a, b) => a - b), hi = sorted[Math.floor(0.9 * (sorted.length - 1))], lo = sorted[Math.floor(0.1 * (sorted.length - 1))], um = mean(sorted);
  panel.push({ t0, t1, rows, hi, lo, um }); }
const res = [];
for (const k of FE) for (const side of ['long', 'short']) { const per = panel.map((p) => { const v = p.rows.filter((r) => Number.isFinite(r[k])).sort((a, b) => (side === 'long' ? b[k] - a[k] : a[k] - b[k])).slice(0, 10); if (v.length < 10) return null;
    return { t0: p.t0, t1: p.t1, ex: mean(v.map((r) => r.ret)) - p.um, hit: v.filter((r) => (side === 'long' ? r.ret >= p.hi : r.ret <= p.lo)).length / 10, picks: v.map((r) => `${r.t} ${(r.ret * 100).toFixed(1)}%`) }; }).filter(Boolean);
  const S = (a) => { const e = a.map((x) => (side === 'long' ? x.ex : -x.ex)); return { n: a.length, ex: mean(a.map((x) => x.ex)), t: a.length > 2 ? mean(e) / (sd(e) / Math.sqrt(a.length)) : NaN, hit: mean(a.map((x) => x.hit)) }; };
  res.push({ k, side, build: S(per.filter((x) => x.t0 <= '2025-12-26')), hold: S(per.filter((x) => x.t0 >= '2026-01-02' && x.t0 <= '2026-10-02')), month: S(per.filter((x) => x.t0 >= '2026-09-11')), monthWeeks: per.filter((x) => x.t0 >= '2026-09-11'), thisWeek: per.find((x) => x.t0 === '2026-10-09') }); }
const Phi = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
res.forEach((r) => { r.p = Number.isFinite(r.hold.t) ? 1 - Phi(r.hold.t) : 1; }); const o = res.map((r, i) => [r.p, i]).sort((a, b) => a[0] - b[0]); let kmax = -1; o.forEach(([p], q) => { if (p <= ((q + 1) / o.length) * 0.1) kmax = q; }); const pass = new Set(o.slice(0, kmax + 1).map(([, i]) => i));
res.forEach((r, i) => { r.ok = pass.has(i) && r.hold.t >= 2; });
const LAB = { W1: '5-day directional flow', W2: '1-day directional flow', W3: 'bullish − bearish premium', W4: 'call volume surge', W5: 'ask-side call − put share', W6: 'call OI growth', W7: '1-week momentum', W8: '1-month momentum', W9: 'peer (theme) momentum', W10: 'peer (theme) flow', W11: 'combined flow + theme', W12: 'combined, unusual-activity names' };
const pc = (x) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + (x * 100).toFixed(2) + '%' : '—'), f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '—');
const L = ['# Weekly winners — results', `\nRun ${new Date().toISOString()} · ${panel.length} weeks · universe ~${T.length} · top/bottom 10 picks per week · base hit rate 10%\n`, `**Validated (holdout t ≥ 2 + BH): ${res.filter((r) => r.ok).map((r) => r.k + ' ' + r.side).join(', ') || 'none'}**\n`,
  '| feature | side | LAST MONTH (5 wks): excess / hit | build: excess (t) / hit | holdout 2026: excess (t) / hit | this week |', '|---|---|---|---|---|---|',
  ...res.map((r) => `| ${r.k} ${LAB[r.k]} | ${r.side} | **${pc(r.month.ex)} / ${(r.month.hit * 100).toFixed(0)}%** | ${pc(r.build.ex)} (${f2(r.build.t)}) / ${(r.build.hit * 100).toFixed(0)}% | ${pc(r.hold.ex)} (${f2(r.hold.t)}) / ${(r.hold.hit * 100).toFixed(0)}% | ${r.thisWeek ? pc(r.thisWeek.ex) + ' / ' + (r.thisWeek.hit * 100).toFixed(0) + '%' : '—'} |`)];
fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'summary.md'), L.join('\n') + '\n'); fs.writeFileSync(path.join(OUT, 'detail.json'), JSON.stringify(res.map((r) => ({ k: r.k, side: r.side, monthWeeks: r.monthWeeks, thisWeek: r.thisWeek })), null, 1)); console.log(L.join('\n'));
