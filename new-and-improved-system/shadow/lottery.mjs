#!/usr/bin/env node
// DESIGN_lottery.md engine: weekly baskets of cheap OTM weekly options (entry at the ask, intrinsic at expiry close).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const SH = path.dirname(fileURLToPath(import.meta.url)), C = path.join(SH, '..', '.cache'), OUT = path.join(SH, 'results_lottery'), SMOKE = process.argv.includes('--smoke');
if (!SMOKE && fs.existsSync(path.join(OUT, 'summary.md')) && !process.argv.includes('--force')) { console.error('already run'); process.exit(1); }
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN), sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const closeOn = new Map(); const px = (t, e) => { if (!closeOn.has(t)) { const f = path.join(C, 'winners', `${t}.json`); closeOn.set(t, fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).ohlc.slice().sort((a, b) => a.d.localeCompare(b.d)) : []); } const o = closeOn.get(t).filter((b) => b.d <= e).at(-1); return o && (Date.parse(e) - Date.parse(o.d)) / 864e5 <= 4 ? o.c : NaN; };
const weeks = fs.readdirSync(path.join(C, 'lottery')).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(fs.readFileSync(path.join(C, 'lottery', f), 'utf8'))).filter((w) => w.done);
const legs = []; let noAsk = 0, notExpired = 0;
for (const w of weeks) for (const [t, p] of Object.entries(w.picks)) for (const L of p.legs ?? []) { if (!(L.ask > 0)) { noAsk++; continue; } if (L.e > '2026-10-15') { notExpired++; continue; } const S = px(t, L.e); if (!Number.isFinite(S)) continue;
  const pay = L.cp === 'C' ? Math.max(0, S - L.k) : Math.max(0, L.k - S); legs.push({ t0: w.t0, t, sets: p.sets, dir: p.dir, tag: L.tag, cp: L.cp, ret: pay / L.ask - 1, ask: L.ask }); }
if (SMOKE) { console.log(JSON.stringify({ weeks: weeks.length, legs: legs.length, noAsk, notExpired })); process.exit(0); }
const allRet = legs.map((x) => x.ret).sort((a, b) => a - b), cap = allRet[Math.floor(0.99 * (allRet.length - 1))];
function basket(set, mny, dirOnly = false) { const by = new Map(); for (const x of legs) { if (!x.sets.includes(set) || !x.tag.endsWith(mny)) continue; if (dirOnly && !((x.dir > 0 && x.cp === 'C') || (x.dir < 0 && x.cp === 'P'))) continue; (by.get(x.t0) ?? by.set(x.t0, []).get(x.t0)).push(x); }
  return [...by].sort().map(([t0, a]) => ({ t0, r: mean(a.map((x) => x.ret)), rw: mean(a.map((x) => Math.min(cap, x.ret))), n: a.length, big: a.filter((x) => x.ret >= 9).length })); }
const St = (a, k = 'r') => { const v = a.map((x) => x[k]); return { weeks: v.length, m: mean(v), t: v.length > 2 ? mean(v) / (sd(v) / Math.sqrt(v.length)) : NaN }; };
const per = (a, lo, hi) => a.filter((x) => x.t0 >= lo && x.t0 <= hi);
const extra = (a) => { let s = 0, best = 0; for (const x of a) { s = x.r < 0 ? s + 1 : 0; best = Math.max(best, s); } let w8 = 0; for (let i = 8; i <= a.length; i++) w8 = Math.min(w8, mean(a.slice(i - 8, i).map((x) => x.r))); return { streak: best, worst8: w8, legs: a.reduce((q, x) => q + x.n, 0), tenx: a.reduce((q, x) => q + x.big, 0) }; };
const H = [];
for (const [i, s] of ['S1', 'S2', 'S3', 'S4'].entries()) for (const [j, m] of ['5', '10'].entries()) { const a = basket(s, m); H.push({ id: `L${i + 1 + j * 4}`, label: `${s} ${m}% OTM strangle legs`, a }); }
H.push({ id: 'L9', label: 'S3 flow-direction legs only, 5%', a: basket('S3', '5', true) }, { id: 'L10', label: 'S3 flow-direction legs only, 10%', a: basket('S3', '10', true) });
for (const m of ['5', '10']) { const a = basket('S1', m), c = new Map(basket('CTL', m).map((x) => [x.t0, x])); H.push({ id: m === '5' ? 'L11' : 'L12', label: `S1 minus random, ${m}%`, a: a.filter((x) => c.has(x.t0)).map((x) => ({ ...x, r: x.r - c.get(x.t0).r, rw: x.rw - c.get(x.t0).rw })) }); }
const ctl = { '5': basket('CTL', '5'), '10': basket('CTL', '10') };
const Phi = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
for (const h of H) { h.build = St(per(h.a, '0', '2025-12-26')); h.hold = St(per(h.a, '2026-01-02', '2026-10-02')); h.holdW = St(per(h.a, '2026-01-02', '2026-10-02'), 'rw'); h.month = St(per(h.a, '2026-09-11', '2026-10-09')); h.x = extra(h.a); h.p = Number.isFinite(h.hold.t) ? 1 - Phi(h.hold.t) : 1; }
const o = H.map((h, i) => [h.p, i]).sort((a, b) => a[0] - b[0]); let km = -1; o.forEach(([p], q) => { if (p <= ((q + 1) / o.length) * 0.1) km = q; }); const ps = new Set(o.slice(0, km + 1).map(([, i]) => i)); H.forEach((h, i) => { h.ok = ps.has(i) && h.hold.m > 0 && h.holdW.m > 0; });
const pc = (x) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%' : '—'), f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '—');
const L = ['# Cheap weekly OTM options on likely big movers — results', `\nRun ${new Date().toISOString()} · ${weeks.length} weeks · ${legs.length} legs (no ask on entry: ${noAsk}) · buy at the ask, intrinsic at expiry\n`, `**Validated (BH q = 0.10 across 12, holdout mean > 0 also with the top 1% of legs capped): ${H.filter((h) => h.ok).map((h) => h.id).join(', ') || 'none'}**\n`,
  '| id | basket | build: mean/week (t) | holdout 2026: mean/week (t) | holdout, top-1% legs capped | last month | legs ≥10× / legs | longest losing streak (weeks) | worst 8 weeks |', '|---|---|---|---|---|---|---|---|---|',
  ...H.map((h) => `| ${h.id} | ${h.label} | ${pc(h.build.m)} (${f2(h.build.t)}) | **${pc(h.hold.m)} (${f2(h.hold.t)})** | ${pc(h.holdW.m)} | ${pc(h.month.m)} | ${h.x.tenx} / ${h.x.legs} | ${h.x.streak} | ${pc(h.x.worst8)} |`),
  `\nRandom-stock baskets for reference: 5% ${pc(St(ctl['5']).m)}/week (holdout ${pc(St(per(ctl['5'], '2026-01-02', '2026-10-02')).m)}), 10% ${pc(St(ctl['10']).m)}/week (holdout ${pc(St(per(ctl['10'], '2026-01-02', '2026-10-02')).m)}).`,
  `\nBiggest legs: ${legs.slice().sort((a, b) => b.ret - a.ret).slice(0, 10).map((x) => `${x.t} ${x.t0} ${x.tag} ${pc(x.ret)}`).join(' · ')}`];
fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'summary.md'), L.join('\n') + '\n'); console.log(L.join('\n'));
