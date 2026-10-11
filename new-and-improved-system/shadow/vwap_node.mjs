#!/usr/bin/env node
// ideas200 part A — VWAP-band × gamma-node rejections (shadow/DESIGN_ideas200.md + DESIGN_vwap_node.md). Data handling
// copied from trade_factory.mjs (audited): missing minutes filled, bad-print wicks clipped, previous-bar levels for
// intrabar touches, stop-first, gap fills at the open, $0.01/side.
//   node --max-old-space-size=8000 shadow/vwap_node.mjs [--smoke]
import fs from 'node:fs';
import path from 'node:path';

const SH = decodeURIComponent(new URL('.', import.meta.url).pathname), C = path.join(SH, '..', '.cache'), OUT = path.join(SH, 'results_ideas200'), SMOKE = process.argv.includes('--smoke');
if (!SMOKE && fs.existsSync(path.join(OUT, 'partA.md')) && !process.argv.includes('--force')) { console.error('already run'); process.exit(1); }
const IDEAS = JSON.parse(fs.readFileSync(path.join(SH, 'ideas200.json'), 'utf8')).ideas.filter((x) => x.part === 'A');
const SYMS = ['SPY', 'QQQ', 'IWM', 'DIA'], START = '2023-11-09', BUILD_END = '2025-03-31', HOLD_START = '2025-04-01', COST = 0.01, FRONT = 0.000033;
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN), sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const offC = new Map(), etMin = (t, d) => { if (!offC.has(d)) { const h = +new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date(d + 'T16:00:00Z')); offC.set(d, (h - 16) * 60); } return (((Math.floor(t / 60) + offC.get(d)) % 1440) + 1440) % 1440; };
function rng(seed) { let h = 1779033703; for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 3432918353), h = (h << 13) | (h >>> 19); let a = h >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function loadDay(T, d) { const f = path.join(C, 'uw', 'm1', T, `${d}.json`); if (!fs.existsSync(f)) return null; const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  let reg = raw.filter((b) => b.m === 'r').map((b) => ({ ...b, etm: etMin(b.t, d) })).filter((b) => b.etm >= 570 && b.etm < 960); if (reg.length < 200) return null;
  const filled = [reg[0]]; for (let i = 1; i < reg.length; i++) { for (let m = filled.at(-1).etm + 1; m < reg[i].etm; m++) { const c0 = filled.at(-1).c; filled.push({ t: filled.at(-1).t + 60, o: c0, h: c0, l: c0, c: c0, v: 0, etm: m }); } filled.push(reg[i]); }
  return filled.map((b, i, a) => { const ref = [b.o, b.c, a[i - 1]?.c, a[i + 1]?.c].filter(Number.isFinite); return { ...b, h: Math.min(b.h, Math.max(...ref) * 1.002), l: Math.max(b.l, Math.min(...ref) * 0.998) }; }); }
function simulate(B, i, dir, entry, stop, target) { const risk = Math.abs(entry - stop); if (!(risk > 0)) return null; const cost = (2 * COST) / risk;
  for (let j = i + 1; j < B.length && B[j].etm < 955; j++) { const b = B[j]; if (dir > 0 ? b.l <= stop : b.h >= stop) { const fill = dir > 0 ? Math.min(stop, b.o) : Math.max(stop, b.o); return (dir * (fill - entry)) / risk - cost; }
    if (target != null && (dir > 0 ? b.h >= target : b.l <= target)) return (dir * (target - entry)) / risk - cost; }
  let k = B.length - 1; while (k > i && B[k].etm >= 955) k--; return (dir * (B[k].c - entry)) / risk - cost; }

// ---------- per symbol: days, nodes, regime ----------
const TRADES = new Map(IDEAS.map((r) => [r.id, { real: [], nonode: [], twins: Array.from({ length: 20 }, () => []) }]));
for (const T of SYMS) {
  const bars = JSON.parse(fs.readFileSync(path.join(C, 'uwgreeks', `${T}_ohlc.json`), 'utf8')), GR = new Map(fs.readFileSync(path.join(C, 'uwgreeks', `${T}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => { const j = JSON.parse(l); return [j.d, j.s]; }));
  const bal2 = (i) => { const s = GR.get(bars[i].d), S = bars[i].c; if (!s) return NaN; let A = 0, N = 0; for (const r of s) { const g = r[1] + r[2]; if (Math.abs(r[0] / S - 1) <= 0.02) { A += Math.abs(g); N += g; } } return A > 0 ? N / A : NaN; };
  const zs = new Map(); for (let i = 62; i < bars.length; i++) { const h = []; for (let q = i - 61; q < i - 1; q++) { const v = bal2(q); if (Number.isFinite(v)) h.push(v); } const v = bal2(i - 1); if (h.length >= 40 && Number.isFinite(v) && sd(h) > 0) zs.set(bars[i].d, (v - mean(h)) / sd(h)); }
  const zb = [...zs].filter(([d]) => d <= BUILD_END).map(([, z]) => z).sort((a, b) => a - b), zMed = zb[zb.length >> 1];
  let days = bars.filter((b) => b.d >= START && b.d <= '2026-10-02').map((b) => b.d); if (SMOKE) days = days.slice(-60);
  for (const d of days) { const i = bars.findIndex((b) => b.d === d), p = bars[i - 1], s = GR.get(p.d); if (!s) continue; const B = loadDay(T, d); if (!B) continue;
    const g = s.map((r) => ({ k: r[0], g: r[1] + r[2], cg: r[1], pg: r[2] })).filter((x) => Math.abs(x.k / p.c - 1) <= 0.03); if (!g.length) continue;
    const king = g.reduce((a, x) => (Math.abs(x.g) > Math.abs(a.g) ? x : a)), strong = g.filter((x) => Math.abs(x.g) >= 0.5 * Math.abs(king.g)).map((x) => x.k);
    const above = g.filter((x) => x.k > p.c), below = g.filter((x) => x.k < p.c), cw = above.length ? above.reduce((a, x) => (x.cg > a.cg ? x : a)).k : null, pw = below.length ? below.reduce((a, x) => (Math.abs(x.pg) > Math.abs(a.pg) ? x : a)).k : null;
    const nodes = { STRONG: { up: strong, dn: strong }, KING: { up: [king.k], dn: [king.k] }, WALL: { up: cw ? [cw] : [], dn: pw ? [pw] : [] } };
    // VWAP and σ through each bar
    const vw = new Float64Array(B.length), sg = new Float64Array(B.length); let sv = 0, spv = 0, sp2 = 0; for (let j = 0; j < B.length; j++) { const tp = (B[j].h + B[j].l + B[j].c) / 3, v = B[j].v || 0; sv += v; spv += v * tp; sp2 += v * tp * tp; vw[j] = sv > 0 ? spv / sv : NaN; sg[j] = sv > 0 ? Math.sqrt(Math.max(0, sp2 / sv - vw[j] * vw[j])) : NaN; }
    const z = zs.get(d), gamOK = Number.isFinite(z) && z > zMed;
    for (const k of [1, 1.5, 2, 2.5]) for (let tw = -1; tw < 20; tw++) { // tw = −1: real bands; 0..19: random-level twins
      const r = tw >= 0 ? rng(`${T}|${d}|${k}|${tw}`) : null, shift = r ? { up: (0.0015 + r() * 0.0045) * (r() < 0.5 ? -1 : 1), dn: (0.0015 + r() * 0.0045) * (r() < 0.5 ? -1 : 1) } : { up: 0, dn: 0 };
      const band = (side, j) => (vw[j] + side * k * sg[j]) * (1 + (side > 0 ? shift.up : shift.dn));
      // collect rejection signals in time order: {i, dir, entry, stop, band, near: {STRONG, KING, WALL}}
      const sigs = [];
      for (const side of [1, -1]) { let j = 1; while (j < B.length) { const b = B[j], lv = band(side, j - 1); if (B[j].etm < 585 || B[j].etm > 930 || !Number.isFinite(lv)) { j++; continue; }
          const touched = side > 0 ? B[j - 1].c < lv && b.h >= lv : B[j - 1].c > lv && b.l <= lv; if (!touched) { j++; continue; }
          let ext = side > 0 ? b.h : b.l, hit = null; for (let q = j; q < Math.min(B.length, j + 6) && B[q].etm <= 930; q++) { ext = side > 0 ? Math.max(ext, B[q].h) : Math.min(ext, B[q].l); const lq = band(side, q - 1); if (side > 0 ? B[q].c < lq : B[q].c > lq) { hit = q; break; } }
          if (hit != null) { const near = {}; for (const nt of ['STRONG', 'KING', 'WALL']) near[nt] = nodes[nt][side > 0 ? 'up' : 'dn'].some((x) => Math.abs(x - lv) / lv <= 0.001);
            sigs.push({ i: hit, dir: -side, entry: B[hit].c, stop: side > 0 ? ext * 1.0003 : ext * 0.9997, near }); j = hit + 1; } else j++; } }
      sigs.sort((a, b) => a.i - b.i);
      for (const idea of IDEAS) { if (idea.k !== k || (idea.gam && !gamOK)) continue; const sideOK = (s) => idea.side === 'both' || (idea.side === 'short' ? s.dir < 0 : s.dir > 0);
        const take = (pred, bucket) => { const s = sigs.find((x) => sideOK(x) && pred(x)); if (!s) return; const risk = Math.abs(s.entry - s.stop); let tgt = null;
          if (idea.tgt === 'T2') tgt = s.entry + s.dir * 2 * risk; else { tgt = vw[s.i] * (1 - s.dir * FRONT); if (s.dir * (tgt - s.entry) < risk) return; }
          const R = simulate(B, s.i, s.dir, s.entry, s.stop, tgt); if (R != null) bucket.push({ d, T, R }); };
        const rec = TRADES.get(idea.id);
        if (tw < 0) { take((x) => x.near[idea.node], rec.real); take((x) => !x.near[idea.node], rec.nonode); } else if (d >= HOLD_START) take((x) => x.near[idea.node], rec.twins[tw]); } } }
  console.error(`${T} done`); }
if (SMOKE) { const n = [...TRADES].map(([id, x]) => [id, x.real.length, x.nonode.length]); console.log(JSON.stringify({ withTrades: n.filter((x) => x[1] > 0).length, sample: n.slice(0, 8) })); process.exit(0); }
// ---------- statistics ----------
const Phi = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
function st(a) { const n = a.length; if (n < 30) return { n, m: NaN, t: NaN, se: NaN }; const m = mean(a.map((x) => x.R)), by = new Map(); for (const x of a) by.set(x.d, (by.get(x.d) ?? 0) + (x.R - m)); const G = by.size, se = Math.sqrt(([...by.values()].reduce((s, v) => s + v * v, 0) * G) / Math.max(1, G - 1)) / n; return { n, m, t: m / se, se, win: a.filter((x) => x.R > 0).length / n }; }
const rows = IDEAS.map((idea) => { const x = TRADES.get(idea.id), H = (a) => a.filter((t) => t.d >= HOLD_START), Bd = (a) => a.filter((t) => t.d <= BUILD_END);
  const b = st(Bd(x.real)), h = st(H(x.real)), nn = st(H(x.nonode)), tw = x.twins.map((a) => mean(a.map((t) => t.R))); const dt = Number.isFinite(h.se) && Number.isFinite(nn.se) ? (h.m - nn.m) / Math.sqrt(h.se ** 2 + nn.se ** 2) : NaN;
  return { ...idea, b, h, nn, dt, twinBeat: tw.filter((m) => Number.isFinite(m) && h.m > m).length, p: Number.isFinite(h.t) ? 1 - Phi(h.t) : 1 }; });
const o = rows.map((r, i) => [r.p, i]).sort((a, b) => a[0] - b[0]); let kmax = -1; o.forEach(([p], r) => { if (p <= ((r + 1) / o.length) * 0.10) kmax = r; }); const pass = new Set(o.slice(0, kmax + 1).map(([, i]) => i));
rows.forEach((r, i) => { r.passBH = pass.has(i) && r.h.m > 0; r.validated = r.passBH && r.dt >= 1.65 && r.twinBeat >= 19; });
const fx = (x, d = 3) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : '—'), side = (s) => rows.filter((r) => r.side === s && Number.isFinite(r.h.m));
const L = ['# Ideas200 — Part A: VWAP band × gamma node rejections', `\nRun ${new Date().toISOString()} · 96 rules · SPY QQQ IWM DIA · build 2023-11 → 2025-03, holdout 2025-04 → 2026-10\n`,
  `**Validated (holdout BH within A + beats no-node twin t ≥ 1.65 + beats ≥ 19/20 random-level twins): ${rows.filter((r) => r.validated).length} of 96.** Passed BH alone: ${rows.filter((r) => r.passBH).length}.\n`,
  `"Puts do better" check (holdout, median rule mean R): short-only ${fx(side('short').map((r) => r.h.m).sort((a, b) => a - b)[side('short').length >> 1])} · long-only ${fx(side('long').map((r) => r.h.m).sort((a, b) => a - b)[side('long').length >> 1])} · both ${fx(side('both').map((r) => r.h.m).sort((a, b) => a - b)[side('both').length >> 1])}\n`,
  '| rule | build n, mean R (t) | holdout n, win, mean R (t) | no-node twin holdout mean R (n) | diff t | twins beaten | validated |', '|---|---|---|---|---|---|---|',
  ...rows.slice().sort((a, b) => (b.h.t || -9) - (a.h.t || -9)).map((r) => `| ${r.id} | ${r.b.n}, ${fx(r.b.m)} (${fx(r.b.t, 2)}) | ${r.h.n}, ${Number.isFinite(r.h.win) ? (r.h.win * 100).toFixed(0) + '%' : '—'}, **${fx(r.h.m)} (${fx(r.h.t, 2)})** | ${fx(r.nn.m)} (${r.nn.n}) | ${fx(r.dt, 2)} | ${r.twinBeat}/20 | ${r.validated ? 'yes' : ''} |`)];
fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'partA.md'), L.join('\n') + '\n'); console.log(L.slice(0, 5).join('\n'));
