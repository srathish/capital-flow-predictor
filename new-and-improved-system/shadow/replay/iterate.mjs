#!/usr/bin/env node
// DESIGN_iterate.md search harness. BUILD = sessions before 2026-03 only (March is the sealed holdout; --holdout <rules.json> runs frozen rules on it once).
// Every variant: ATM 0DTE option at UW minute prices from the prefetch cache, $0.02/side slippage, day-clustered t, month consistency, placebo.
import fs from 'node:fs';
const HO = process.argv[2] === '--holdout' ? process.argv[3] : null, FAM = HO ? null : (process.argv[2] ?? 'ABCDE');
const D = JSON.parse(fs.readFileSync(new URL('./skylit_all.json', import.meta.url), 'utf8'));
const SES = D.sessions.filter((s) => (HO ? s.d.startsWith('2026-03') : s.d < '2026-03'));
const TK = {}; for (const mo of ['2025-12', '2026-01', '2026-02', '2026-03']) Object.assign(TK, JSON.parse(fs.readFileSync(new URL(`./trinity_kings_${mo}.json`, import.meta.url), 'utf8')));
const CACHE = new URL('../../.cache/uwopt_intraday/', import.meta.url), OC = new Map();
const SLIP = 0.02;
function opt(T, d, K, cp) {
  const id = `${T}${d.slice(2, 4)}${d.slice(5, 7)}${d.slice(8, 10)}${cp}${String(K * 1000).padStart(8, '0')}`, key = id + d;
  if (!OC.has(key)) { const f = new URL(`${id}_${d}.json`, CACHE); let rows = null; if (fs.existsSync(f)) { rows = JSON.parse(fs.readFileSync(f, 'utf8')); rows = { rows, by: new Map(rows.map((q) => [q.m, q])) }; } OC.set(key, rows); }
  return OC.get(key);
}
// per-session precompute
for (const s of SES) {
  s.B = new Map(s.bars.map((b) => [b[0], b])); s.F = s.maps; s.idx = new Map(s.F.map((x, i) => [x[0], i]));
  s.ten = []; s.flips = [];
  for (let i = 0; i < s.F.length; i++) { s.ten[i] = i && s.F[i][1] === s.F[i - 1][1] ? s.ten[i - 1] + 1 : 1; let f = 0; for (let j = Math.max(1, i - 59); j <= i; j++) if (s.F[j][1] !== s.F[j - 1][1]) f++; s.flips[i] = f; }
  s.px = (m) => s.B.get(m - 1)?.[4] ?? null;
}
const lean = (d, T, m) => { const r = TK[d]?.[T]?.find((x) => x[0] === m); if (!r) return 0; return r[2] > r[1] * 1.0005 ? 1 : r[2] < r[1] * 0.9995 ? -1 : 0; };
let missing = 0;
function sim(s, sig, ex) {
  const p = s.px(sig.m); if (p == null) return null;
  const K = Math.round(p), cp = sig.dir > 0 ? 'C' : 'P', O = opt(s.T, s.d, K, cp); if (!O) { missing++; return null; }
  const e0 = O.rows.find((q) => q.m >= sig.m && q.m <= sig.m + 2); if (!e0) return null;
  const w = ex.spread ?? 0, O2 = w ? opt(s.T, s.d, K + sig.dir * w, cp) : null; if (w && !O2) { missing++; return null; }
  const last = (OO, bm) => { for (let t = bm; t >= bm - 30; t--) { const q = OO.by.get(t); if (q) return q.c; } return null; };
  const short0 = w ? (last(O2, e0.m) ?? O2.rows.find((q) => q.m >= sig.m && q.m <= sig.m + 2)?.c) : 0; if (short0 == null) return null;
  const en = { m: e0.m, c: e0.c - short0 }; if (en.c <= 0.05) return null;
  const legs = w ? 2 : 1;
  const at = (bm) => { const a = last(O, bm) ?? e0.c, b = w ? (last(O2, bm) ?? short0) : 0; return a - b; };
  let out = null;
  for (let bm = sig.m; bm <= 950; bm++) {
    const q = O.by.get(bm), b = s.B.get(bm), dir = sig.dir;
    if (ex.optStop && q && q.m > en.m && (w ? at(bm) : q.l) <= en.c * (1 - ex.optStop)) { out = { m: bm, px: en.c * (1 - ex.optStop), how: 'optstop' }; break; }
    if (b && sig.stop != null && (ex.wick ? (dir > 0 ? b[3] <= sig.stop : b[2] >= sig.stop) : (dir > 0 ? b[4] < sig.stop : b[4] > sig.stop))) { out = { m: bm, px: at(bm), how: 'stop' }; break; }
    if (b && sig.tgt != null && (dir > 0 ? b[2] >= sig.tgt : b[3] <= sig.tgt)) { out = { m: bm, px: at(bm), how: 'target' }; break; }
    if (ex.maxHold && bm - sig.m >= ex.maxHold) { out = { m: bm, px: at(bm), how: 'time' }; break; }
    if (bm === 950) out = { m: bm, px: at(bm), how: 'close' };
  }
  if (!out) return null;
  const ux = out.how === 'target' ? sig.tgt : out.how === 'stop' && ex.wick ? sig.stop : s.B.get(out.m)?.[4] ?? p;
  return { u: sig.dir * (ux - p) / p * 1e4 - 1, d: s.d, T: s.T, m: sig.m, dir: sig.dir, K, entry: en.c, exit: out.px, exitM: out.m, how: out.how, r: (out.px - SLIP * legs) / (en.c + SLIP * legs) - 1 };
}
// run one rule over sessions: gen(s, i) returns a signal or null; at most maxDay trades per ticker-day, no overlap
function runRule(gen, ex, placebo = false) {
  const tr = [];
  for (const s of SES) {
    let busy = -1, n = 0;
    for (let i = 15; i < s.F.length && n < (ex.maxDay ?? 2); i++) {
      const m = s.F[i][0]; if (m <= busy || m < (ex.from ?? 600) || m > (ex.to ?? 870)) continue;
      let sig = gen(s, i); if (!sig) continue;
      if (placebo) { const p = s.px(m); sig = { m, dir: -sig.dir, tgt: sig.tgt == null ? null : 2 * p - sig.tgt, stop: sig.stop == null ? null : 2 * p - sig.stop }; }
      const t = sim(s, sig, ex); if (!t) continue; tr.push(t); n++; busy = t.exitM;
    }
  }
  return tr;
}
function score(tr) {
  const n = tr.length, mean = n ? tr.reduce((a, x) => a + x.r, 0) / n : 0, byD = new Map();
  for (const x of tr) { const a = byD.get(x.d) ?? []; a.push(x.r); byD.set(x.d, a); }
  const dm = [...byD.values()].map((a) => a.reduce((x, y) => x + y, 0) / a.length), k = dm.length, mu = k ? dm.reduce((a, b) => a + b, 0) / k : 0;
  const sd = k > 1 ? Math.sqrt(dm.reduce((a, b) => a + (b - mu) ** 2, 0) / (k - 1)) : 0, t = sd ? (mu / sd) * Math.sqrt(k) : 0;
  const mo = {}; for (const x of tr) { const q = x.d.slice(0, 7); (mo[q] ??= []).push(x.r); }
  const mm = Object.fromEntries(Object.entries(mo).map(([q, a]) => [q, a.reduce((x, y) => x + y, 0) / a.length]));
  return { n, mean, t, days: k, mm, win: n ? tr.filter((x) => x.r > 0).length / n : 0 };
}
// ---------- rule families ----------
const nodesAt = (s, i, minRel = 0.3) => s.F[i][2].filter((n) => Math.abs(n[1]) >= minRel);
const nextNode = (s, i, from, dir, minGap) => nodesAt(s, i).map((n) => n[0]).filter((k) => dir * (k - from) > from * minGap).sort((a, b) => dir * (a - b))[0] ?? null;
const FAMS = {
  // A: pull to a stable king
  A: { grid: () => cross({ ten: [10, 20, 40], flips: [1, 3, 6], dmin: [0.0015, 0.0025, 0.004], grow: [null, 0], stopR: [null, 0.5, 1], optStop: [null, 0.5] }),
    gen: (P) => (s, i) => { const [m, K, nodes] = s.F[i], p = s.px(m); if (K == null || p == null || s.ten[i] < P.ten || s.flips[i] > P.flips) return null;
      const kn = nodes.find((n) => n[0] === K); if (P.grow != null && (!kn || kn[2] == null || kn[2] < P.grow)) return null;
      const dist = (K - p) / p; if (Math.abs(dist) < P.dmin || Math.abs(dist) > 0.015) return null; const dir = Math.sign(dist);
      return { m, dir, tgt: K * (1 - dir * 0.0005), stop: P.stopR ? p - dir * Math.abs(K - p) * P.stopR : null }; } },
  // B: price crosses a stable king → trade the break
  B: { grid: () => cross({ lev: ['king', 'plain'], spread: [0, 2], ten: [10, 30], flips: [3, 8], stopPct: [0.0005, 0.001, 0.002], tgt: ['node', 0.003, 0.005], wick: [true], optStop: [null] }),
    gen: (P) => (s, i) => { let [m, K] = s.F[i]; const p = s.px(m), p0 = s.px(m - 1); if (K == null || p == null || p0 == null || s.F[i - 1][1] !== K || s.ten[i - 1] < P.ten || s.flips[i] > P.flips) return null;
      if (P.lev === 'plain') { const nd = new Set(s.F[i][2].map((n) => n[0])); const L = [Math.ceil(Math.min(p0, p)), Math.floor(Math.max(p0, p))].find((x) => x > Math.min(p0, p) && x < Math.max(p0, p) && !nd.has(x)); if (L == null) return null; K = L; }
      const dir = p0 <= K && p > K ? 1 : p0 >= K && p < K ? -1 : 0; if (!dir) return null;
      const tg = P.tgt === 'node' ? nextNode(s, i, K, dir, 0.002) : K * (1 + dir * P.tgt); if (tg == null) return null;
      return { m, dir, tgt: tg, stop: K * (1 - dir * P.stopPct) }; } },
  // C: king migrates to a new strike (held 5 frames) away from price → trade toward it
  C: { grid: () => cross({ spread: [0, 2], dmin: [0.0015, 0.0025, 0.004], grow: [null, 0, 20], stopR: [0.5, 1, null], optStop: [null] }),
    gen: (P) => (s, i) => { const [m, K, nodes] = s.F[i], p = s.px(m); if (K == null || p == null || s.ten[i] !== 5 || i < 6 || s.F[i - 5][1] === K) return null;
      const kn = nodes.find((n) => n[0] === K); if (P.grow != null && (!kn || kn[2] == null || kn[2] < P.grow)) return null;
      const dist = (K - p) / p; if (Math.abs(dist) < P.dmin || Math.abs(dist) > 0.015) return null; const dir = Math.sign(dist);
      return { m, dir, tgt: K * (1 - dir * 0.0005), stop: P.stopR ? p - dir * Math.abs(K - p) * P.stopR : null }; } },
  // D: touch of a growing positive node that holds → trade back away from it (toward the next node on the origin side)
  D: { grid: () => cross({ grow: [0, 20], minRel: [0.3, 0.6], confirm: [0.0005, 0.001], stopPct: [0.001, 0.002], optStop: [null, 0.5] }),
    gen: (P) => (s, i) => { const [m, K] = s.F[i], p = s.px(m); if (p == null) return null;
      for (const [N, rel, d15] of s.F[i][2]) { if (rel < P.minRel || d15 == null || d15 < P.grow) continue;
        let touched = -1; for (let j = Math.max(0, i - 5); j < i; j++) { const pj = s.px(s.F[j][0]); if (pj != null && Math.abs(pj - N) <= N * 0.0005) touched = j; }
        if (touched < 0) continue; const pt = s.px(s.F[Math.max(0, touched - 15)][0]); if (pt == null) continue; const side = Math.sign(pt - N); if (!side || Math.abs(pt - N) < N * 0.0015) continue;
        if (side * (p - N) < N * P.confirm) continue; const tg = nextNode(s, i, N, side, 0.002) ?? (K != null && side * (K - N) > 0 ? K : null); if (tg == null) continue;
        return { m, dir: side, tgt: tg, stop: N * (1 - side * P.stopPct) }; }
      return null; } },
  // E: the reactive engine's breaks, filtered
  E: { grid: () => cross({ flips: [99, 6, 3], trin: [0, 2, 3], kingSide: ['any', 'toward', 'away'], wick: [true, false] }),
    gen: (P) => { return (s, i) => { const m = s.F[i][0], b = s.breaks.find((x) => x.m === m); if (!b || s.flips[i] > P.flips) return null;
      if (P.trin && ['SPXW', 'SPY', 'QQQ'].filter((T) => lean(s.d, T, m) === b.dir).length < P.trin) return null;
      const K = s.F[i][1], p = s.px(m); if (P.kingSide !== 'any' && K != null && p != null) { const tw = Math.sign(K - p) === b.dir; if ((P.kingSide === 'toward') !== tw) return null; }
      return { m, dir: b.dir, tgt: b.target, stop: b.stop }; }; }, ex: { from: 585, to: 900 } },
};
function cross(o) { let out = [{}]; for (const [k, vs] of Object.entries(o)) out = out.flatMap((x) => vs.map((v) => ({ ...x, [k]: v }))); return out; }
const exOf = (fam, P) => ({ optStop: P.optStop ?? null, wick: P.wick ?? false, spread: P.spread ?? 0, maxDay: 2, ...(FAMS[fam].ex ?? {}) });
// ---------- run ----------
fs.mkdirSync(new URL('../results_iterate/', import.meta.url), { recursive: true });
if (HO) {
  const rules = JSON.parse(fs.readFileSync(HO, 'utf8')), rows = [];
  for (const r of rules) { const tr = runRule(FAMS[r.fam].gen(r.P), exOf(r.fam, r.P)); const sc = score(tr); rows.push({ ...r, ...sc }); console.log(r.id, r.fam, JSON.stringify(r.P), `n=${sc.n} mean ${(sc.mean * 100).toFixed(1)}% t ${sc.t.toFixed(2)} days ${sc.days}`); fs.writeFileSync(new URL(`../results_iterate/holdout_${r.id}_trades.json`, import.meta.url), JSON.stringify(tr)); }
  fs.writeFileSync(new URL('../results_iterate/holdout.json', import.meta.url), JSON.stringify(rows, null, 1)); process.exit(0);
}
// F: SELL a 0DTE iron butterfly (short call+put at S, long wings S±w) when price is pinned to a stable king; hold to the close (settle at the
// 15:59 candle close, intrinsic). Return on max risk, $0.02/leg slippage at entry only. Control (ctl): the same rule at minutes when the king is
// ≥0.4% from price, centered at round(price) — is it the king pin or just selling 0DTE premium at that hour?
function runFly(P, ctl = false) {
  const tr = [];
  for (const s of SES) {
    const lastBar = s.bars.filter((b) => b[0] <= 959).at(-1); if (!lastBar) continue; const close = lastBar[4];
    for (let i = 15; i < s.F.length; i++) {
      const [m, K] = s.F[i], p = s.px(m); if (m < P.from || m > 870 || K == null || p == null || s.ten[i] < P.ten || s.flips[i] > P.flips) continue;
      const d = Math.abs(K - p) / p; if (ctl ? d < 0.004 : d > P.pin) continue;
      const S = ctl ? Math.round(p) : K; if (S !== Math.round(S)) continue;
      const legs = [[S, 'C', -1], [S, 'P', -1], [S + P.w, 'C', 1], [S - P.w, 'P', 1]].map(([k, cp, sg]) => ({ O: opt(s.T, s.d, k, cp), sg }));
      if (legs.some((l) => !l.O)) continue;
      const px = legs.map((l) => { for (let t = m; t <= m + 2; t++) { const q = l.O.by.get(t); if (q) return q.c; } for (let t = m - 1; t >= m - 10; t--) { const q = l.O.by.get(t); if (q) return q.c; } return null; });
      if (px.some((x) => x == null)) continue;
      const credit = -legs.reduce((a, l, j) => a + l.sg * px[j], 0) - 4 * SLIP; if (credit <= 0.05 || credit >= P.w) continue;
      const settle = Math.max(0, P.w - Math.abs(close - S)), pnl = credit - (P.w - settle) * 1 - 0 , risk = P.w - credit;
      // payoff of a short fly at expiry = credit - (w - max(0, w - |close-S|)) ... equivalently credit - min(w, |close-S|)
      const r = (credit - Math.min(P.w, Math.abs(close - S))) / risk;
      tr.push({ d: s.d, T: s.T, m, r, credit, S, close }); break;
    }
  }
  return tr;
}
// G: sell the ATM fly when the king is FAR (>= far) from price; baseline = the ATM fly at the first minute >= from, every ticker-day, no board.
function runFlyG(P, base = false) {
  const tr = [];
  for (const s of SES) {
    const lastBar = s.bars.filter((b) => b[0] <= 959).at(-1); if (!lastBar) continue; const close = lastBar[4];
    for (let i = 15; i < s.F.length; i++) {
      const [m, K] = s.F[i], p = s.px(m); if (m < P.from || m > 870 || p == null) continue;
      if (!base) { if (K == null || s.ten[i] < P.ten || s.flips[i] > P.flips || Math.abs(K - p) / p < P.far) continue; }
      const S = Math.round(p), legs = [[S, 'C', -1], [S, 'P', -1], [S + P.w, 'C', 1], [S - P.w, 'P', 1]].map(([k, cp, sg]) => ({ O: opt(s.T, s.d, k, cp), sg }));
      if (legs.some((l) => !l.O)) continue;
      const px = legs.map((l) => { for (let t = m; t <= m + 2; t++) { const q = l.O.by.get(t); if (q) return q.c; } for (let t = m - 1; t >= m - 10; t--) { const q = l.O.by.get(t); if (q) return q.c; } return null; });
      if (px.some((x) => x == null)) continue;
      const credit = -legs.reduce((a, l, j) => a + l.sg * px[j], 0) - 4 * SLIP; if (credit <= 0.05 || credit >= P.w) continue;
      tr.push({ d: s.d, T: s.T, m, r: (credit - Math.min(P.w, Math.abs(close - S))) / (P.w - credit), credit, S, close, kingDist: K == null ? null : (K - p) / p }); break;
    }
  }
  return tr;
}
if (process.argv[2] === 'G') {
  const grid = cross({ far: [0.003, 0.004, 0.006], ten: [10, 30], flips: [3, 8], w: [1, 2, 3], from: [660, 720, 780] }), res = [];
  const LOGF = new URL('../results_iterate/log.tsv', import.meta.url), RUNF = new Date().toISOString();
  for (const P of grid) { const a = score(runFlyG(P)), b = score(runFlyG(P, true)); const posM = Object.values(a.mm).filter((v) => v > 0).length, cand = a.n >= 40 && posM >= 2 && a.t >= 2 && a.mean > b.mean; res.push({ P, a, b, cand });
    fs.appendFileSync(LOGF, [RUNF, 'G', JSON.stringify(P), a.n, (a.mean * 100).toFixed(1), a.t.toFixed(2), a.days, (a.win * 100).toFixed(0), Object.entries(a.mm).map(([k, v]) => k.slice(5) + ':' + (v * 100).toFixed(0)).join(' '), (b.mean * 100).toFixed(1), b.n, cand ? 'YES' : ''].join('\t') + '\n'); }
  const av = (f) => (res.reduce((s, x) => s + f(x), 0) / res.length * 100).toFixed(1);
  console.log(`G: ${res.length} variants, candidates ${res.filter((x) => x.cand).length} | far-king fly avg ${av((x) => x.a.mean)}% of risk, every-day baseline ${av((x) => x.b.mean)}% | beats baseline in ${res.filter((x) => x.a.mean > x.b.mean).length}/${res.length}`);
  for (const x of [...res].sort((a, b) => b.a.t - a.a.t).slice(0, 8)) console.log(`  t ${x.a.t.toFixed(2)} n ${x.a.n} mean ${(x.a.mean * 100).toFixed(1)}% win ${(x.a.win * 100).toFixed(0)}% months ${Object.values(x.a.mm).map((v) => (v * 100).toFixed(0)).join('/')} baseline ${(x.b.mean * 100).toFixed(1)}% t ${x.b.t.toFixed(2)} (n ${x.b.n}) ${x.cand ? 'CANDIDATE' : ''} ${JSON.stringify(x.P)}`);
  for (const w of [1, 2, 3]) for (const from of [660, 720, 780]) { const b = score(runFlyG({ w, from }, true)); console.log(`  baseline w${w} from ${from}: n ${b.n} mean ${(b.mean * 100).toFixed(1)}% t ${b.t.toFixed(2)} months ${Object.values(b.mm).map((v) => (v * 100).toFixed(0)).join('/')}`); }
  process.exit(0);
}
if (process.argv[2] === 'F') {
  const grid = cross({ pin: [0.0005, 0.001, 0.002], ten: [10, 30], flips: [3, 8], w: [1, 2, 3], from: [660, 720, 780] }), res = [];
  const LOGF = new URL('../results_iterate/log.tsv', import.meta.url), RUNF = new Date().toISOString();
  for (const P of grid) { const a = score(runFly(P)), b = score(runFly(P, true)); const posM = Object.values(a.mm).filter((v) => v > 0).length, cand = a.n >= 40 && posM >= 2 && a.t >= 2 && a.mean > b.mean; res.push({ P, a, b, cand });
    fs.appendFileSync(LOGF, [RUNF, 'F', JSON.stringify(P), a.n, (a.mean * 100).toFixed(1), a.t.toFixed(2), a.days, (a.win * 100).toFixed(0), Object.entries(a.mm).map(([k, v]) => k.slice(5) + ':' + (v * 100).toFixed(0)).join(' '), (b.mean * 100).toFixed(1), b.n, cand ? 'YES' : ''].join('\t') + '\n'); }
  const av = (f) => (res.reduce((s, x) => s + f(x), 0) / res.length * 100).toFixed(1);
  console.log(`F: ${res.length} variants, candidates ${res.filter((x) => x.cand).length} | king-pin fly avg ${av((x) => x.a.mean)}% of risk, control ${av((x) => x.b.mean)}% | pin beats control in ${res.filter((x) => x.a.mean > x.b.mean).length}/${res.length}`);
  for (const x of [...res].sort((a, b) => b.a.t - a.a.t).slice(0, 8)) console.log(`  t ${x.a.t.toFixed(2)} n ${x.a.n} mean ${(x.a.mean * 100).toFixed(1)}% win ${(x.a.win * 100).toFixed(0)}% months ${Object.values(x.a.mm).map((v) => (v * 100).toFixed(0)).join('/')} control ${(x.b.mean * 100).toFixed(1)}% (n ${x.b.n}) ${x.cand ? 'CANDIDATE' : ''} ${JSON.stringify(x.P)}`);
  process.exit(0);
}
if (process.argv[2] === '--under') {
  // diagnostic: the same trades scored on the stock itself (bps, 1 bp cost), rule vs placebo, all variants of each family
  for (const fam of process.argv[3] ?? 'ABCDE') { const rows = [];
    for (const P of FAMS[fam].grid()) { if (P.spread) continue; const ex = exOf(fam, P), u = (tr) => score(tr.map((x) => ({ ...x, r: x.u }))); rows.push({ P, a: u(runRule(FAMS[fam].gen(P), ex)), b: u(runRule(FAMS[fam].gen(P), ex, true)) }); }
    const av = (f) => (rows.reduce((s, x) => s + f(x), 0) / rows.length).toFixed(1), best = [...rows].sort((x, y) => y.a.t - x.a.t)[0];
    console.log(`${fam}: ${rows.length} variants | rule avg ${av((x) => x.a.mean)} bps/trade, placebo ${av((x) => x.b.mean)} bps | best t ${best.a.t.toFixed(2)} (${best.a.mean.toFixed(1)} bps, n ${best.a.n}, months ${Object.values(best.a.mm).map((v) => v.toFixed(0)).join('/')}) ${JSON.stringify(best.P)}`); }
  process.exit(0);
}
const LOG = new URL('../results_iterate/log.tsv', import.meta.url); if (!fs.existsSync(LOG)) fs.writeFileSync(LOG, 'run\tfam\tparams\tn\tmean\tt\tdays\twin\tmonths\tplaceboMean\tplaceboN\tcandidate\n');
const RUN = new Date().toISOString(), res = [];
for (const fam of FAM) {
  const grid = FAMS[fam].grid();
  for (const P of grid) {
    const ex = exOf(fam, P), tr = runRule(FAMS[fam].gen(P), ex), sc = score(tr), pl = score(runRule(FAMS[fam].gen(P), ex, true));
    const posM = Object.values(sc.mm).filter((v) => v > 0).length, cand = sc.n >= 40 && posM >= 2 && sc.t >= 2 && sc.mean > pl.mean;
    res.push({ fam, P, sc, pl, cand });
    fs.appendFileSync(LOG, [RUN, fam, JSON.stringify(P), sc.n, (sc.mean * 100).toFixed(1), sc.t.toFixed(2), sc.days, (sc.win * 100).toFixed(0), Object.entries(sc.mm).map(([k, v]) => k.slice(5) + ':' + (v * 100).toFixed(0)).join(' '), (pl.mean * 100).toFixed(1), pl.n, cand ? 'YES' : ''].join('\t') + '\n');
  }
  const fr = res.filter((x) => x.fam === fam), best = [...fr].sort((a, b) => b.sc.t - a.sc.t).slice(0, 5);
  console.log(`\n== ${fam}: ${fr.length} variants, candidates ${fr.filter((x) => x.cand).length}; avg of variant means ${(fr.reduce((a, x) => a + x.sc.mean, 0) / fr.length * 100).toFixed(1)}%`);
  for (const x of best) console.log(`  t ${x.sc.t.toFixed(2)} n ${x.sc.n} mean ${(x.sc.mean * 100).toFixed(1)}% win ${(x.sc.win * 100).toFixed(0)}% months ${Object.values(x.sc.mm).map((v) => (v * 100).toFixed(0)).join('/')} placebo ${(x.pl.mean * 100).toFixed(1)}% ${x.cand ? 'CANDIDATE' : ''} ${JSON.stringify(x.P)}`);
}
console.log('\nmissing option files', missing, '| total variants this run', res.length);
