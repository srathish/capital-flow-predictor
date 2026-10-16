#!/usr/bin/env node
// DESIGN_lottery.md amendment 4 — earnings-week split and mid-fill sensitivity, both entry timings.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const SH = path.dirname(fileURLToPath(import.meta.url)), C = path.join(SH, '..', '.cache'), OUT = path.join(SH, 'results_lottery');
if (fs.existsSync(path.join(OUT, 'earnings_mid.md')) && !process.argv.includes('--force')) { console.error('already run'); process.exit(1); }
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN), sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const ER = JSON.parse(fs.readFileSync(path.join(C, 'lottery_earnings.json'), 'utf8'));
const earn = (t, t0, e) => (ER[t] ?? []).some((x) => (x.when === 'postmarket' ? x.d >= t0 && x.d < e : x.d > t0 && x.d <= e));
const cache = new Map(), px = (t, e) => { if (!cache.has(t)) { const f = path.join(C, 'winners', `${t}.json`); cache.set(t, fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).ohlc.slice().sort((a, b) => a.d.localeCompare(b.d)) : []); } const o = cache.get(t).filter((b) => b.d <= e).at(-1); return o && (Date.parse(e) - Date.parse(o.d)) / 864e5 <= 4 ? o.c : NaN; };
const Phi = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
const pc = (x) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%' : '—'), f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '—');
const L = ['# Lottery study amendment 4 — earnings weeks and mid fills', `\nRun ${new Date().toISOString()} · buyer legs: return on premium; spreads: return on max risk; week-level means\n`];
for (const [LD, name] of [['lottery', 'Friday pick → next Friday'], ['lottery_mon', 'Monday pick → Friday']]) {
  const weeks = fs.readdirSync(path.join(C, LD)).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(fs.readFileSync(path.join(C, LD, f), 'utf8'))).filter((w) => w.done);
  const legs = [], spreads = [];
  for (const w of weeks) for (const [t, p] of Object.entries(w.picks)) { const lg = p.legs ?? []; if (!lg.length || lg[0].e > '2026-10-15') continue; const e = lg[0].e, S = px(t, e); if (!Number.isFinite(S)) continue; const ew = earn(t, w.t0, e);
    const iv = (x) => (x.cp === 'C' ? Math.max(0, S - x.k) : Math.max(0, x.k - S));
    for (const x of lg) if (x.ask > 0) { const mid = x.bid > 0 ? (x.bid + x.ask) / 2 : NaN; legs.push({ t0: w.t0, sets: p.sets, tag: x.tag, ew, r: iv(x) / x.ask - 1, rm: Number.isFinite(mid) ? iv(x) / mid - 1 : NaN }); }
    const Lg = Object.fromEntries(lg.map((x) => [x.tag, x]));
    const side = (sh, lo, mid) => { if (!sh || !lo || !(lo.ask > 0) || !(sh.bid > 0)) return null; const cs = mid ? (sh.bid + sh.ask) / 2 - (lo.bid + lo.ask) / 2 : sh.bid - lo.ask, wid = Math.abs(lo.k - sh.k); if (!(cs > 0) || !(wid - cs > 0) || (sh.cp === 'C' ? lo.k <= sh.k : lo.k >= sh.k)) return null; return { pnl: cs - iv(sh) + iv(lo), risk: wid - cs }; };
    for (const mid of [false, true]) { const c = side(Lg.C5, Lg.C10, mid), q = side(Lg.P5, Lg.P10, mid); spreads.push({ t0: w.t0, ew, mid, put: q ? q.pnl / q.risk : NaN, condor: c && q ? (c.pnl + q.pnl) / Math.max(c.risk, q.risk) : NaN }); } }
  const wkly = (rows, f) => { const by = new Map(); for (const x of rows) { const v = f(x); if (!Number.isFinite(v)) continue; (by.get(x.t0) ?? by.set(x.t0, []).get(x.t0)).push(v); } return [...by].sort().map(([t0, a]) => ({ t0, r: mean(a), n: a.length })); };
  const S = (a) => { const v = a.map((x) => x.r); return { weeks: v.length, n: a.reduce((s, x) => s + x.n, 0), m: mean(v), t: v.length > 2 ? mean(v) / (sd(v) / Math.sqrt(v.length)) : NaN }; };
  const H = [['E1', 'radar 5% bought, earnings weeks', legs.filter((x) => x.sets.includes('S1') && x.tag.endsWith('5') && x.ew), 'r'], ['E2', 'radar 10% bought, earnings weeks', legs.filter((x) => x.sets.includes('S1') && x.tag.endsWith('10') && x.ew), 'r'], ['E3', 'all picks 5% bought, earnings weeks', legs.filter((x) => x.tag.endsWith('5') && x.ew), 'r'],
    ['E4', 'radar 5% bought, non-earnings weeks', legs.filter((x) => x.sets.includes('S1') && x.tag.endsWith('5') && !x.ew), 'r'], ['E5', 'radar 10% bought, non-earnings weeks', legs.filter((x) => x.sets.includes('S1') && x.tag.endsWith('10') && !x.ew), 'r'], ['E6', 'all picks 5% bought, non-earnings weeks', legs.filter((x) => x.tag.endsWith('5') && !x.ew), 'r'],
    ['E7', 'put credit spread, earnings weeks', spreads.filter((x) => !x.mid && x.ew), 'put'], ['E8', 'condor, earnings weeks', spreads.filter((x) => !x.mid && x.ew), 'condor'],
    ['E9', 'radar 5% bought at MID', legs.filter((x) => x.sets.includes('S1') && x.tag.endsWith('5')), 'rm'], ['E10', 'all picks 5% bought at MID', legs.filter((x) => x.tag.endsWith('5')), 'rm'], ['E11', 'put credit spread at MID', spreads.filter((x) => x.mid), 'put'], ['E12', 'condor at MID', spreads.filter((x) => x.mid), 'condor']]
    .map(([id, label, rows, k]) => { const a = wkly(rows, (x) => x[k]); return { id, label, build: S(a.filter((x) => x.t0 <= '2025-12-31')), hold: S(a.filter((x) => x.t0 >= '2026-01-01' && x.t0 <= '2026-10-09')), all: S(a) }; });
  H.forEach((h) => (h.p = Number.isFinite(h.hold.t) ? 1 - Phi(h.hold.t) : 1)); const o = H.map((h, i) => [h.p, i]).sort((a, b) => a[0] - b[0]); let km = -1; o.forEach(([p], q) => { if (p <= ((q + 1) / o.length) * 0.1) km = q; }); const ps = new Set(o.slice(0, km + 1).map(([, i]) => i)); H.forEach((h, i) => (h.ok = ps.has(i) && h.hold.m > 0));
  L.push(`\n## ${name}\n`, `**Validated (BH q = 0.10 across 12): ${H.filter((h) => h.ok).map((h) => h.id).join(', ') || 'none'}**\n`, '| id | trade | build: mean/week (t, trades) | holdout 2026 (t, trades) | whole period |', '|---|---|---|---|---|',
    ...H.map((h) => `| ${h.id} | ${h.label} | ${pc(h.build.m)} (${f2(h.build.t)}, ${h.build.n}) | **${pc(h.hold.m)} (${f2(h.hold.t)}, ${h.hold.n})** | ${pc(h.all.m)} |`)); }
fs.writeFileSync(path.join(OUT, 'earnings_mid.md'), L.join('\n') + '\n'); console.log(L.join('\n'));
