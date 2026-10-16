#!/usr/bin/env node
// DESIGN_lottery.md amendment 3 — the SELLER side: weekly OTM credit spreads / iron condors on the same legs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const MON = process.argv.includes('--mon'), SH = path.dirname(fileURLToPath(import.meta.url)), C = path.join(SH, '..', '.cache'), OUT = path.join(SH, 'results_lottery'), SUM = MON ? 'sell_mon.md' : 'sell.md', LD = MON ? 'lottery_mon' : 'lottery';
if (!process.argv.includes('--smoke') && fs.existsSync(path.join(OUT, SUM)) && !process.argv.includes('--force')) { console.error('already run'); process.exit(1); }
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN), sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const cache = new Map(), px = (t, e) => { if (!cache.has(t)) { const f = path.join(C, 'winners', `${t}.json`); cache.set(t, fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).ohlc.slice().sort((a, b) => a.d.localeCompare(b.d)) : []); } const o = cache.get(t).filter((b) => b.d <= e).at(-1); return o && (Date.parse(e) - Date.parse(o.d)) / 864e5 <= 4 ? o.c : NaN; };
const weeks = fs.readdirSync(path.join(C, LD)).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(fs.readFileSync(path.join(C, LD, f), 'utf8'))).filter((w) => w.done);
const trades = []; let skipped = 0;
for (const w of weeks) for (const [t, p] of Object.entries(w.picks)) { const L = Object.fromEntries((p.legs ?? []).map((x) => [x.tag, x])); const e = (p.legs ?? [])[0]?.e; if (!e || e > '2026-10-15') continue; const S = px(t, e); if (!Number.isFinite(S)) continue;
  const side = (sh, lg) => { if (!sh || !lg || !(sh.bid > 0) || !(lg.ask > 0)) return null; const cp = sh.cp, wid = Math.abs(lg.k - sh.k); if (!(cp === 'C' ? lg.k > sh.k : lg.k < sh.k)) return null; const credit = sh.bid - lg.ask; if (!(credit > 0) || !(wid - credit > 0)) return null;
    const iv = (k) => (cp === 'C' ? Math.max(0, S - k) : Math.max(0, k - S)); return { pnl: credit - iv(sh.k) + iv(lg.k), risk: wid - credit, max: iv(sh.k) - iv(lg.k) >= wid - 1e-9 }; };
  const c = side(L.C5, L.C10), q = side(L.P5, L.P10); if (!c && !q) { skipped++; continue; }
  const condor = c && q ? { r: (c.pnl + q.pnl) / Math.max(c.risk, q.risk), max: c.max || q.max } : null;
  trades.push({ t0: w.t0, t, sets: p.sets, condor, put: q ? { r: q.pnl / q.risk, max: q.max } : null }); }
if (process.argv.includes('--smoke')) { console.log(JSON.stringify({ weeks: weeks.length, trades: trades.length, condors: trades.filter((x) => x.condor).length, puts: trades.filter((x) => x.put).length, skipped })); process.exit(0); }
const Phi = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
const H = []; let n = 0;
for (const kind of ['condor', 'put']) for (const set of ['S1', 'S4', 'CTL', 'ALL']) { n++; const by = new Map(); for (const x of trades) { if (!x[kind] || (set !== 'ALL' && !x.sets.includes(set))) continue; (by.get(x.t0) ?? by.set(x.t0, []).get(x.t0)).push(x[kind]); }
  const wk = [...by].sort().map(([t0, a]) => ({ t0, r: mean(a.map((z) => z.r)), n: a.length, win: a.filter((z) => z.r > 0).length, max: a.filter((z) => z.max).length }));
  const S = (a) => { const v = a.map((x) => x.r); return { weeks: v.length, m: mean(v), t: v.length > 2 ? mean(v) / (sd(v) / Math.sqrt(v.length)) : NaN }; }, per = (lo, hi) => wk.filter((x) => x.t0 >= lo && x.t0 <= hi);
  let w8 = 0; for (let i = 8; i <= wk.length; i++) w8 = Math.min(w8, mean(wk.slice(i - 8, i).map((x) => x.r)));
  const tot = wk.reduce((s, x) => s + x.n, 0); H.push({ id: `K${n}`, label: `${kind === 'condor' ? 'iron condor' : 'put credit spread'} — ${set}`, build: S(per('0', '2025-12-31')), hold: S(per('2026-01-01', '2026-10-09')), month: S(per('2026-09-08', '2026-10-15')), win: wk.reduce((s, x) => s + x.win, 0) / tot, maxl: wk.reduce((s, x) => s + x.max, 0) / tot, worst: Math.min(...wk.map((x) => x.r)), w8, trades: tot }); }
H.forEach((h) => (h.p = Number.isFinite(h.hold.t) ? 1 - Phi(h.hold.t) : 1)); const o = H.map((h, i) => [h.p, i]).sort((a, b) => a[0] - b[0]); let km = -1; o.forEach(([p], q) => { if (p <= ((q + 1) / o.length) * 0.1) km = q; }); const ps = new Set(o.slice(0, km + 1).map(([, i]) => i)); H.forEach((h, i) => (h.ok = ps.has(i) && h.hold.m > 0));
const pc = (x) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%' : '—'), f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '—');
const L = [`# Seller side — weekly OTM credit spreads / condors (${MON ? 'Monday entry → Friday expiry' : 'Friday entry → next Friday expiry'})`, `\nRun ${new Date().toISOString()} · ${trades.length} stock-weeks · sell 5% OTM at the bid, buy 10% OTM at the ask · return on max risk\n`, `**Validated (BH q = 0.10 across 8, holdout mean > 0): ${H.filter((h) => h.ok).map((h) => h.id).join(', ') || 'none'}**\n`,
  '| id | trade | build: mean/week on risk (t) | holdout 2026 (t) | last month | win rate | trades at max loss | worst week | worst 8 weeks | trades |', '|---|---|---|---|---|---|---|---|---|---|',
  ...H.map((h) => `| ${h.id} | ${h.label} | ${pc(h.build.m)} (${f2(h.build.t)}) | **${pc(h.hold.m)} (${f2(h.hold.t)})** | ${pc(h.month.m)} | ${pc(h.win)} | ${pc(h.maxl)} | ${pc(h.worst)} | ${pc(h.w8)} | ${h.trades} |`)];
fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, SUM), L.join('\n') + '\n'); console.log(L.join('\n'));
