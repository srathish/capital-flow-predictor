#!/usr/bin/env node
// Weekly winners amendment 2 — ride the theme after the week's first session (shadow/DESIGN_weekly_winners.md).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const SH = path.dirname(fileURLToPath(import.meta.url)), W = path.join(SH, '..', '.cache', 'winners'), OUT = path.join(SH, 'results_winners');
const ETF = new Set(['SPY', 'QQQ', 'XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLI', 'XLU', 'XLB', 'XLRE', 'XLC', 'SMH', 'IGV']), ENTRY = +(process.argv.find((a) => a.startsWith('--entry='))?.slice(8) ?? 1);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN), sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const D = {}; for (const f of fs.readdirSync(W)) { if (f.startsWith('_')) continue; const t = f.replace('.json', ''); if (ETF.has(t)) continue; const j = JSON.parse(fs.readFileSync(path.join(W, f), 'utf8')); const o = j.ohlc.slice().sort((a, b) => a.d.localeCompare(b.d)); if (o.length < 300) continue; D[t] = { o, oi: new Map(o.map((b, i) => [b.d, i])), fl: new Map(j.flow.map((x) => [x.date, x])) }; }
const T = Object.keys(D), days = [...new Set(Object.values(D).flatMap((x) => x.o.map((b) => b.d)))].sort().filter((d) => Object.values(D).filter((x) => x.oi.has(d)).length > 200);
const wk = (d) => { const x = new Date(d + 'T12:00:00Z'), day = (x.getUTCDay() + 6) % 7; return new Date(x.getTime() - day * 864e5).toISOString().slice(0, 10); };
const weeks = []; { let cur = null; for (const d of days) { if (!cur || cur.k !== wk(d)) { cur = { k: wk(d), s: [] }; weeks.push(cur); } cur.s.push(d); } }
const close = (t, d) => { const X = D[t], i = X.oi.get(d); return i == null ? NaN : X.o[i].c; }, num = (x) => (x == null ? NaN : +x);
function peers(d, ts) { const k = days.indexOf(d), win = days.slice(k - 60, k + 1), z = {}; for (const t of ts) { const r = []; for (let q = 1; q < win.length; q++) { const a = close(t, win[q - 1]), b = close(t, win[q]); r.push(Number.isFinite(a) && Number.isFinite(b) ? b / a - 1 : 0); } const m = mean(r), s = sd(r) || 1; z[t] = r.map((x) => (x - m) / s); }
  const P = {}, ks = Object.keys(z); for (const a of ks) { const c = ks.filter((b) => b !== a).map((b) => [b, z[a].reduce((s, v, q) => s + v * z[b][q], 0)]); c.sort((x, y) => y[1] - x[1]); P[a] = c.slice(0, 10).map((x) => x[0]); } return P; }
const rank = (rows, k) => { const v = rows.filter((r) => Number.isFinite(r[k])).sort((a, b) => a[k] - b[k]); v.forEach((r, i) => (r['r_' + k] = i / Math.max(1, v.length - 1))); };
const panel = [];
for (let w = 1; w < weeks.length; w++) { const s = weeks[w].s; if (s.length < ENTRY + 1) continue; const prevEnd = weeks[w - 1].s.at(-1), e = s[ENTRY - 1], x = s.at(-1); if (prevEnd < '2024-11-22') continue;
  const rows = []; for (const t of T) { const c0 = close(t, prevEnd), c1 = close(t, e), c2 = close(t, x); if (![c0, c1, c2].every(Number.isFinite)) continue; const r1 = c1 / c0 - 1, rr = c2 / c1 - 1; if (Math.abs(r1) > 0.45 || Math.abs(rr) > 0.45) continue;
    const f30 = days.slice(days.indexOf(e) - 30, days.indexOf(e)).map((d) => D[t].fl.get(d)).filter(Boolean), fe = s.slice(0, ENTRY).map((d) => D[t].fl.get(d)).filter(Boolean); const cv30 = mean(f30.map((q) => num(q.call_volume)));
    const dir = fe.reduce((q, z) => q + num(z.net_call_premium) - num(z.net_put_premium), 0); rows.push({ t, R1: r1, ret: rr, R3: cv30 > 0 && fe.length ? (mean(fe.map((q) => num(q.call_volume))) / cv30) * Math.sign(dir) : NaN }); }
  if (rows.length < 150) continue; const P = peers(prevEnd, rows.map((r) => r.t)), by = new Map(rows.map((r) => [r.t, r]));
  for (const r of rows) { const p = (P[r.t] ?? []).map((q) => by.get(q)).filter(Boolean); r.R2 = p.length ? mean(p.map((q) => q.R1)) : NaN; r.pS = p.length > 2 ? sd(p.map((q) => q.R1)) : NaN; }
  rank(rows, 'R1'); rank(rows, 'R2'); const sR2 = sd(rows.map((r) => r.R2).filter(Number.isFinite));
  for (const r of rows) { r.R4 = Number.isFinite(r.r_R1) && Number.isFinite(r.r_R2) ? (r.r_R1 + r.r_R2) / 2 : NaN; r.R5 = Number.isFinite(r.R4) && Math.sign(r.R1) === Math.sign(r.R2) ? r.R4 : NaN; r.R6 = Number.isFinite(r.R2) && Math.abs(r.R2) >= sR2 ? r.R2 : NaN; }
  const so = rows.map((r) => r.ret).sort((a, b) => a - b); panel.push({ t0: e, rows, um: mean(so), hi: so[Math.floor(0.9 * (so.length - 1))], lo: so[Math.floor(0.1 * (so.length - 1))] }); }
const FE = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'], LAB = { R1: 'own day-1 move', R2: 'theme (peer group) day-1 move', R3: 'day-1 call surge × flow direction', R4: 'own + theme day-1 move', R5: 'own + theme, moving together', R6: 'strong theme days only' }, res = [];
for (const k of FE) for (const side of ['long', 'short']) { const per = panel.map((p) => { const v = p.rows.filter((r) => Number.isFinite(r[k])).sort((a, b) => (side === 'long' ? b[k] - a[k] : a[k] - b[k])).slice(0, 10); if (v.length < 5) return null;
    return { t0: p.t0, ex: mean(v.map((r) => r.ret)) - p.um, hit: v.filter((r) => (side === 'long' ? r.ret >= p.hi : r.ret <= p.lo)).length / v.length, picks: v.map((r) => `${r.t} ${(r.ret * 100).toFixed(1)}%`) }; }).filter(Boolean);
  const S = (a) => { const e = a.map((x) => (side === 'long' ? x.ex : -x.ex)); return { n: a.length, ex: mean(a.map((x) => x.ex)), t: a.length > 2 ? mean(e) / (sd(e) / Math.sqrt(a.length)) : NaN, hit: mean(a.map((x) => x.hit)) }; };
  res.push({ k, side, build: S(per.filter((x) => x.t0 <= '2025-12-31')), hold: S(per.filter((x) => x.t0 >= '2026-01-01' && x.t0 <= '2026-10-02')), month: S(per.filter((x) => x.t0 >= '2026-09-14')), thisWeek: per.find((x) => x.t0 >= '2026-10-12') }); }
const Phi = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
res.forEach((r) => { r.p = Number.isFinite(r.hold.t) ? 1 - Phi(r.hold.t) : 1; }); const o = res.map((r, i) => [r.p, i]).sort((a, b) => a[0] - b[0]); let kmax = -1; o.forEach(([p], q) => { if (p <= ((q + 1) / o.length) * 0.1) kmax = q; }); const pass = new Set(o.slice(0, kmax + 1).map(([, i]) => i)); res.forEach((r, i) => { r.ok = pass.has(i) && r.hold.t >= 2; });
const pc = (x) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + (x * 100).toFixed(2) + '%' : '—'), f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '—');
const L = [`# Weekly winners — amendment 2: ride the theme after session ${ENTRY}`, `\nRun ${new Date().toISOString()} · ${panel.length} weeks · enter at the close of the week's session ${ENTRY}, exit at the week's last close\n`, `**Validated (holdout t ≥ 2 + BH across 12): ${res.filter((r) => r.ok).map((r) => r.k + ' ' + r.side).join(', ') || 'none'}**\n`,
  '| feature | side | last month: excess / hit | build: excess (t) / hit | holdout 2026: excess (t) / hit | this week (picks) |', '|---|---|---|---|---|---|',
  ...res.map((r) => `| ${r.k} ${LAB[r.k]} | ${r.side} | **${pc(r.month.ex)} / ${(r.month.hit * 100).toFixed(0)}%** | ${pc(r.build.ex)} (${f2(r.build.t)}) / ${(r.build.hit * 100).toFixed(0)}% | ${pc(r.hold.ex)} (${f2(r.hold.t)}) / ${(r.hold.hit * 100).toFixed(0)}% | ${r.thisWeek ? pc(r.thisWeek.ex) + ': ' + r.thisWeek.picks.slice(0, 5).join(', ') : '—'} |`)];
fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, `ride_theme_entry${ENTRY}.md`), L.join('\n') + '\n'); console.log(L.join('\n'));
