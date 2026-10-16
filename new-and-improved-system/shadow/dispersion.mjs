#!/usr/bin/env node
// DESIGN_dispersion.md engine.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const SH = path.dirname(fileURLToPath(import.meta.url)), C = path.join(SH, '..', '.cache'), OUT = path.join(SH, 'results_dispersion');
if (fs.existsSync(path.join(OUT, 'summary.md')) && !process.argv.includes('--force')) { console.error('already run'); process.exit(1); }
const NAMES = ['AAPL', 'AMZN', 'AVGO', 'GOOGL', 'META', 'MSFT', 'NVDA', 'TSLA'], SPLIT = { NVDA: ['2024-06-10', 10], AVGO: ['2024-07-15', 10] };
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN), sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const px = {}; for (const T of [...NAMES, 'QQQ']) px[T] = new Map(JSON.parse(fs.readFileSync(path.join(C, 'uwgreeks', `${T}_ohlc.json`), 'utf8')).map((b) => [b.d, SPLIT[T] && b.d < SPLIT[T][0] ? b.c * SPLIT[T][1] : b.c]));
const Q = JSON.parse(fs.readFileSync(path.join(C, 'ssprem', 'QQQ.json'), 'utf8')), ST = Object.fromEntries(NAMES.map((T) => [T, JSON.parse(fs.readFileSync(path.join(C, 'ssprem', `${T}.json`), 'utf8'))]));
const GR = new Map(fs.readFileSync(path.join(C, 'uwgreeks', 'QQQ.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { const j = JSON.parse(l); return [j.d, j.s]; }));
const a01 = (d, S) => { const s = GR.get(d); if (!s) return NaN; let A = 0, N = 0; for (const r of s) { const g = r[1] + r[2]; if (Math.abs(r[0] / S - 1) <= 0.01) { A += Math.abs(g); N += g; } } return A > 0 ? N / A : NaN; };
const rows = [];
for (const [key, q] of Object.entries(Q)) { if (!q?.legs?.C || !q.legs.P || !(q.legs.C.bid > 0 && q.legs.P.bid > 0)) continue; const t0 = key.split('|')[0], Se = px.QQQ.get(q.e); if (!Number.isFinite(Se)) continue;
  const prem = q.legs.C.bid + q.legs.P.bid, qr = 1 - Math.abs(Se - q.legs.C.k) / prem, longs = [];
  for (const T of NAMES) { const v = ST[T][`${t0}|W`]; if (!v?.legs?.C?.ask || !v.legs.P?.ask) continue; const S1 = px[T].get(v.e); if (!Number.isFinite(S1)) continue; const cost = v.legs.C.ask + v.legs.P.ask; longs.push(Math.abs(S1 - v.legs.C.k) / cost - 1); }
  if (longs.length < 6) continue; rows.push({ t0, qr, lr: mean(longs), g: +(a01(t0, q.S) >= 0.7562330965688158) }); }
const St = (a) => { const v = a; return { n: v.length, m: mean(v), t: v.length > 2 ? mean(v) / (sd(v) / Math.sqrt(v.length)) : NaN, win: v.filter((x) => x > 0).length / v.length, worst: Math.min(...v), w8: (() => { let w = 0; for (let i = 8; i <= v.length; i++) w = Math.min(w, v.slice(i - 8, i).reduce((s, x) => s + x, 0)); return w; })() }; };
const B = (x) => x.t0 <= '2025-06-30', Hd = (x) => x.t0 >= '2025-07-01';
const make = (Qh, gOnly) => (x) => (gOnly && !x.g ? NaN : x.qr + Qh * x.lr);
const H = [['D1', 'premium-neutral (Q 1.0), all weeks', make(1, false)], ['D2', 'half-hedged (Q 0.5), all weeks', make(0.5, false)], ['D3', 'Q 1.0, gamma weeks', make(1, true)], ['D4', 'Q 0.5, gamma weeks', make(0.5, true)], ['ref', 'naked QQQ weekly short straddle', (x) => x.qr], ['ref2', 'long 8-stock straddle basket alone', (x) => x.lr]]
  .map(([id, label, f]) => ({ id, label, build: St(rows.filter(B).map(f).filter(Number.isFinite)), hold: St(rows.filter(Hd).map(f).filter(Number.isFinite)) }));
const Phi = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
const R = H.slice(0, 4); R.forEach((h) => (h.p = Number.isFinite(h.hold.t) ? 1 - Phi(h.hold.t) : 1)); const o = R.map((h, i) => [h.p, i]).sort((a, b) => a[0] - b[0]); let km = -1; o.forEach(([p], q) => { if (p <= ((q + 1) / o.length) * 0.1) km = q; }); const ps = new Set(o.slice(0, km + 1).map(([, i]) => i)); R.forEach((h, i) => (h.ok = ps.has(i) && h.hold.m > 0));
const pc = (x) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%' : '—'), f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '—');
const L = ['# Dispersion — sell QQQ weekly, buy top-8 holdings\' weeklies', `\nRun ${new Date().toISOString()} · ${rows.length} weeks · P&L per $1 of QQQ premium sold · QQQ at the bid, stocks at the ask\n`, `**Validated (BH q = 0.10 across D1–D4): ${R.filter((h) => h.ok).map((h) => h.id).join(', ') || 'none'}**\n`,
  '| id | trade | build: mean/week (t) | holdout ≥ 2025-07: mean/week (t) | win | worst week | worst 8 weeks |', '|---|---|---|---|---|---|---|', ...H.map((h) => `| ${h.id} | ${h.label} | ${pc(h.build.m)} (${f2(h.build.t)}) | **${pc(h.hold.m)} (${f2(h.hold.t)})** | ${pc(h.hold.win)} | ${pc(h.hold.worst)} | ${pc(h.hold.w8)} |`)];
fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'summary.md'), L.join('\n') + '\n'); console.log(L.join('\n'));
