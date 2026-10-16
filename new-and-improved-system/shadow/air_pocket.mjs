#!/usr/bin/env node
// DESIGN_air_pocket.md engine. node --max-old-space-size=8000 shadow/air_pocket.mjs [--smoke]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const SH = path.dirname(fileURLToPath(import.meta.url)), C = path.join(SH, '..', '.cache'), OUT = path.join(SH, 'results_air_pocket'), SMOKE = process.argv.includes('--smoke'), STOCKS = process.argv.includes('--stocks'), SUMF = STOCKS ? 'summary_stocks.md' : 'summary.md';
if (!SMOKE && fs.existsSync(path.join(OUT, SUMF)) && !process.argv.includes('--force')) { console.error('already run'); process.exit(1); }
const SYMS = STOCKS ? JSON.parse(fs.readFileSync(path.join(SH, 'data', 'air_pocket_stocks.json'), 'utf8')).picks : ['SPY', 'QQQ', 'IWM', 'DIA'], BEND = '2025-03-31', HST = '2025-04-01', COST = 0.01;
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const offC = new Map(), etMin = (t, d) => { if (!offC.has(d)) { const h = +new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date(d + 'T16:00:00Z')); offC.set(d, (h - 16) * 60); } return (((Math.floor(t / 60) + offC.get(d)) % 1440) + 1440) % 1440; };
function rng(seed) { let h = 1779033703; for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 3432918353), h = (h << 13) | (h >>> 19); let a = h >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function loadDay(T, d) { const f = path.join(C, 'uw', 'm1', T, `${d}.json`); if (!fs.existsSync(f)) return null; const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  let reg = raw.filter((b) => b.m === 'r').map((b) => ({ ...b, etm: etMin(b.t, d) })).filter((b) => b.etm >= 570 && b.etm < 960); if (reg.length < 200) return null;
  const filled = [reg[0]]; for (let i = 1; i < reg.length; i++) { for (let m = filled.at(-1).etm + 1; m < reg[i].etm; m++) { const c0 = filled.at(-1).c; filled.push({ t: filled.at(-1).t + 60, o: c0, h: c0, l: c0, c: c0, v: 0, etm: m }); } filled.push(reg[i]); }
  return filled.map((b, i, a) => { const ref = [b.o, b.c, a[i - 1]?.c, a[i + 1]?.c].filter(Number.isFinite); return { ...b, h: Math.min(b.h, Math.max(...ref) * 1.002), l: Math.max(b.l, Math.min(...ref) * 0.998) }; }); }
function sim(B, i, dir, entry, stop, tgt) { const R = Math.abs(entry - stop); if (!(R > 0) || dir * (tgt - entry) < R) return null; const cost = 2 * COST / R;
  for (let j = i + 1; j < B.length && B[j].etm < 955; j++) { const b = B[j]; if (dir > 0 ? b.l <= stop : b.h >= stop) { const f = dir > 0 ? Math.min(stop, b.o) : Math.max(stop, b.o); return { R: dir * (f - entry) / R - cost, hit: 0 }; } if (dir > 0 ? b.h >= tgt : b.l <= tgt) return { R: dir * (tgt - entry) / R - cost, hit: 1 }; }
  let k = B.length - 1; while (k > i && B[k].etm >= 955) k--; return { R: dir * (B[k].c - entry) / R - cost, hit: 0 }; }
function events(B, nodes, gam) { const out = []; const first = new Set();
  for (let i = 1; i < B.length; i++) { if (B[i].etm < 585 || B[i].etm > 900) continue; const p = B[i - 1].c, c = B[i].c;
    for (const N of nodes) { const up = p <= N && c > N, dn = p >= N && c < N; if (!up && !dn) continue; const key = N + (up ? 'u' : 'd'); if (first.has(key)) continue; first.add(key); const dir = up ? 1 : -1;
      const beyond = nodes.filter((x) => (dir > 0 ? x > N : x < N)).sort((a, b) => dir * (a - b)); const N2 = beyond[0]; if (N2 == null) continue; const A = Math.abs(N2 - N) / N;
      const pocketG = gam.filter((g) => (dir > 0 ? g.k > N && g.k < N2 : g.k < N && g.k > N2)).reduce((s, g) => s + g.g, 0);
      const stop = N * (1 - dir * 0.0005), tgt = N2 * (1 - dir * 0.0002);
      const im = sim(B, i, dir, c, stop, tgt); let rt = null;
      for (let j = i + 1; j < B.length && B[j].etm <= Math.min(B[i].etm + 30, 900); j++) { const b = B[j]; if (dir > 0 ? b.l <= N && b.c > N : b.h >= N && b.c < N) { rt = sim(B, j, dir, b.c, stop, tgt); break; } if (dir > 0 ? b.c < N : b.c > N) break; }
      out.push({ dir, A, neg: pocketG < 0, im, rt }); } } return out; }
const rows = []; // {d, T, dir, A, neg, im, rt, twin}
for (const T of SYMS) { const bars = JSON.parse(fs.readFileSync(path.join(C, 'uwgreeks', `${T}_ohlc.json`), 'utf8')), bi = new Map(bars.map((b, i) => [b.d, i]));
  const GR = new Map(fs.readFileSync(path.join(C, 'uwgreeks', `${T}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => { const j = JSON.parse(l); return [j.d, j.s]; }));
  let days = bars.filter((b) => b.d >= (STOCKS ? '2023-11-17' : '2023-11-09') && b.d <= '2026-10-02').map((b) => b.d); if (SMOKE) days = days.slice(0, 40);
  for (const d of days) { const i = bi.get(d); if (i == null || i < 1) continue; const p = bars[i - 1], s = GR.get(p.d); if (!s) continue; const B = loadDay(T, d); if (!B) continue;
    const gam = s.map((r) => ({ k: r[0], g: r[1] + r[2] })).filter((x) => Math.abs(x.k / p.c - 1) <= 0.03); if (gam.length < 5) continue; const king = Math.max(...gam.map((x) => Math.abs(x.g))); if (!(king > 0)) continue;
    const nodes = gam.filter((x) => Math.abs(x.g) >= 0.3 * king).map((x) => x.k); if (STOCKS) { const ks = gam.map((x) => x.k), p0 = B[0].c; if (p0 < Math.min(...ks) || p0 > Math.max(...ks)) continue; } /* amendment 1 basis guard */
    for (const e of events(B, nodes, gam)) rows.push({ d, T, twin: -1, ...e });
    for (let tw = 0; tw < 20; tw++) { const r = rng(`${T}|${d}|${tw}`), sh = (0.0015 + r() * 0.0045) * (r() < 0.5 ? -1 : 1); const tn = nodes.map((k) => k * (1 + sh)), tg = gam.map((x) => ({ k: x.k * (1 + sh), g: x.g }));
      for (const e of events(B, tn, tg)) rows.push({ d, T, twin: tw, ...e }); } }
  console.error(`${T} done`); }
if (SMOKE) { const r = rows.filter((x) => x.twin < 0); console.log(JSON.stringify({ events: r.length, air: r.filter((x) => x.A >= 0.004).length, crowd: r.filter((x) => x.A < 0.002).length, imTrades: r.filter((x) => x.im).length, rtTrades: r.filter((x) => x.rt).length })); process.exit(0); }
const st = (a, k) => { const v = a.filter((x) => x[k]).map((x) => ({ d: x.d, R: x[k].R, hit: x[k].hit })); if (v.length < 30) return { n: v.length, m: NaN, t: NaN }; const m = mean(v.map((x) => x.R)), by = new Map(); for (const x of v) by.set(x.d, (by.get(x.d) ?? 0) + x.R - m); const G = by.size, se = Math.sqrt([...by.values()].reduce((s, q) => s + q * q, 0) * G / Math.max(1, G - 1)) / v.length; return { n: v.length, m, t: m / se, se, hit: mean(v.map((x) => x.hit)) }; };
const diff = (a, b) => ({ m: a.m - b.m, t: (a.m - b.m) / Math.sqrt(a.se ** 2 + b.se ** 2), n: a.n, a: a.m, b: b.m });
const Phi = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
const H = [];
for (const [k, off] of [['im', 0], ['rt', 4]]) { const P = (per) => rows.filter((x) => x.twin < 0 && per(x.d)), Bp = (d) => d <= BEND, Hp = (d) => d >= HST;
  const air = (per) => st(P(per).filter((x) => x.A >= 0.004), k), crowd = (per) => st(P(per).filter((x) => x.A < 0.002), k), neg = (per) => st(P(per).filter((x) => x.A >= 0.004 && x.neg), k), pos = (per) => st(P(per).filter((x) => x.A >= 0.004 && !x.neg), k);
  const twins = Array.from({ length: 20 }, (_, tw) => st(rows.filter((x) => x.twin === tw && x.d >= HST && x.A >= 0.004), k).m), ah = air(Hp);
  H.push({ id: `G${1 + off}`, label: `${k} AIR breaks, mean R`, build: air(Bp), hold: ah }, { id: `G${2 + off}`, label: `${k} AIR minus CROWD`, build: diff(air(Bp), crowd(Bp)), hold: diff(ah, crowd(Hp)) }, { id: `G${3 + off}`, label: `${k} AIR: short-gamma pocket minus long-gamma pocket`, build: diff(neg(Bp), pos(Bp)), hold: diff(neg(Hp), pos(Hp)) },
    { id: `G${4 + off}`, label: `${k} AIR vs 20 random-level twins (holdout)`, build: { m: NaN, t: NaN }, hold: { m: ah.m - twins.filter(Number.isFinite).sort((a, b) => a - b)[10], t: NaN, beaten: twins.filter((t) => Number.isFinite(t) && ah.m > t).length } }); }
H.forEach((h) => (h.p = h.id.endsWith('4') || h.id.endsWith('8') ? (h.hold.beaten >= 19 ? 0 : 1) : Number.isFinite(h.hold.t) ? 1 - Phi(h.hold.t) : 1)); const o = H.map((h, i) => [h.p, i]).sort((a, b) => a[0] - b[0]); let km = -1; o.forEach(([p], q) => { if (p <= ((q + 1) / o.length) * 0.1) km = q; }); const ps = new Set(o.slice(0, km + 1).map(([, i]) => i)); H.forEach((h, i) => (h.ok = ps.has(i) && h.hold.m > 0));
const f3 = (x) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(3) : '—'), f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '—'), pc = (x) => (Number.isFinite(x) ? (x * 100).toFixed(0) + '%' : '—');
const L = [`# GEX map: node breaks into air pockets — results${STOCKS ? ' (10 random Skylit stocks)' : ''}`, `\nRun ${new Date().toISOString()} · ${SYMS.join('/')} · target = next node, stop behind the broken node · R units\n`, `**Validated (BH q = 0.10 across 8): ${H.filter((h) => h.ok).map((h) => h.id).join(', ') || 'none'}**\n`,
  '| id | test | build (t, n, hit) | holdout (t, n, hit) |', '|---|---|---|---|', ...H.map((h) => `| ${h.id} | ${h.label} | ${f3(h.build.m)} (${f2(h.build.t)}, ${h.build.n ?? ''}${h.build.hit != null ? ', ' + pc(h.build.hit) : ''}) | **${f3(h.hold.m)}** (${h.hold.beaten != null ? 'beat ' + h.hold.beaten + '/20 twins' : f2(h.hold.t) + ', ' + (h.hold.n ?? '') + (h.hold.hit != null ? ', ' + pc(h.hold.hit) : '')}) |`)];
const byS = SYMS.map((T) => `${T} ${f3(st(rows.filter((x) => x.twin < 0 && x.T === T && x.d >= HST && x.A >= 0.004), 'im').m)}`).join(' · '), byD = [1, -1].map((dd) => `${dd > 0 ? 'long' : 'short'} ${f3(st(rows.filter((x) => x.twin < 0 && x.dir === dd && x.d >= HST && x.A >= 0.004), 'im').m)}`).join(' · ');
L.push(`\nHoldout AIR immediate entry by symbol: ${byS}; by side: ${byD}.`);
fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, SUMF), L.join('\n') + '\n'); console.log(L.join('\n'));
