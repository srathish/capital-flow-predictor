#!/usr/bin/env node
// Do 0DTE nodes make price react more than nearby random levels? (shadow/DESIGN_node_reaction.md). Cached data only.
//   node shadow/node_reaction.mjs [--smoke]     (runs once; --force only for logged audit fixes)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SH = decodeURIComponent(new URL('.', import.meta.url).pathname), REPO = path.join(SH, '..', '..');
const OUT = path.join(SH, 'results_node_reaction'), SMOKE = process.argv.includes('--smoke');
if (!SMOKE && fs.existsSync(path.join(OUT, 'summary.md')) && !process.argv.includes('--force')) { console.error('already run'); process.exit(1); }
const ARCH = path.join(REPO, 'apps/gex/data/skylit-archive/intraday'), UND = path.join(REPO, 'apps/gex/research/exit-study/cache_underlying');
const STRONG = 0.5, OPEN = 570;

const offCache = new Map();
const nyOff = (d) => { if (!offCache.has(d)) { const h = +new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date(d + 'T16:00:00Z')); offCache.set(d, (h - 16) * 60); } return offCache.get(d); };
const etMin = (ms, d) => (((Math.floor(ms / 60000) + nyOff(d)) % 1440) + 1440) % 1440;
function rng(seedStr) { let h = 1779033703; for (const ch of seedStr) h = Math.imul(h ^ ch.charCodeAt(0), 3432918353), h = (h << 13) | (h >>> 19);
  let a = h >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const gunz = (f) => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

function loadBoards(d, sym) {
  const f = path.join(ARCH, d, `${sym}.jsonl.gz`); if (!fs.existsSync(f)) return null;
  const B = gunz(f).map((x) => ({ ts: Date.parse(x.requestedTs), spot: x.spot, s: (x.strikes ?? []).map((k) => ({ k: k.strike, g: k.gamma })).filter((k) => Number.isFinite(k.g)) }));
  if (new Set(B.map((x) => x.spot)).size <= 1) return null;
  for (const b of B) { const king = b.s.reduce((a, k) => (Math.abs(k.g) > Math.abs(a?.g ?? 0) ? k : a), null); b.king = king?.k ?? null;
    const sk = king && Math.abs(king.g) > 0 ? b.s.filter((k) => Math.abs(k.g) >= STRONG * Math.abs(king.g)) : []; b.strong = sk.map((k) => k.k); b.gOf = new Map(b.s.map((k) => [k.k, k.g]));
    const pick = (arr) => arr.reduce((a, k) => (Math.abs(k.g) > Math.abs(a?.g ?? -1) ? k : a), null);
    b.floor = pick(sk.filter((k) => k.k < b.spot))?.k ?? null; b.ceil = pick(sk.filter((k) => k.k > b.spot))?.k ?? null; }
  return B.sort((a, b) => a.ts - b.ts);
}
function loadBars(d, sym) {
  const f = path.join(UND, `${sym}_${d}.json`); if (!fs.existsSync(f)) return null;
  const j = JSON.parse(fs.readFileSync(f, 'utf8')), a = Array.isArray(j) ? j : j.data ?? [];
  const bars = a.filter((x) => x.market_time === 'r').map((x) => { const ms = Date.parse(x.start_time); return { ms, etm: etMin(ms, d), o: +x.open, h: +x.high, l: +x.low, c: +x.close }; })
    .filter((b) => b.etm >= OPEN && b.etm < 960).sort((a, b) => a.ms - b.ms);
  return bars.length >= 200 ? bars : null;
}
const boardAt = (B, ms) => { let r = null; for (const b of B) { if (b.ts <= ms - 60000) r = b; else break; } return r; };

// one touch scanner per level set; M and H variants evaluated on the same touches
const VARIANTS = [{ M: 0.0012, H: 20, main: true }, { M: 0.0008, H: 20 }, { M: 0.002, H: 20 }, { M: 0.0012, H: 10 }, { M: 0.0012, H: 30 }];
function outcome(bars, i, L, side, M, H) { // side = +1 approached from above (level below price), -1 from below
  const up = L * (1 + M), dn = L * (1 - M);
  { const b = bars[i]; if (side > 0 ? b.l <= dn : b.h >= up) return 'break'; } // touch bar: only a move beyond the level is known to come after the touch (amendment 1)
  for (let j = i + 1; j < bars.length && j <= i + H; j++) { const b = bars[j], hitUp = b.h >= up, hitDn = b.l <= dn;
    if (hitUp && hitDn) return 'ambiguous';
    if (hitUp) return side > 0 ? 'reject' : 'break';
    if (hitDn) return side > 0 ? 'break' : 'reject'; }
  return 'stall';
}
function scan(day, sym, bars, levelsAt, tagsAt) {
  const st = new Map(), out = [];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i], prev = bars[i - 1];
    for (const [px, s] of st) if (!s.armed && i > s.busyUntil && Math.abs(prev.c - px) / px >= 0.0012) s.armed = true;
    for (const Lv of levelsAt(i)) {
      const L = Lv.px, s = st.get(L) ?? { armed: true, n: 0, busyUntil: -1 }; st.set(L, s); if (!s.armed) continue;
      let side = 0; if (prev.c > L && b.l <= L) side = 1; else if (prev.c < L && b.h >= L) side = -1; if (!side) continue;
      s.armed = false; s.n++;
      const res = VARIANTS.map((v) => outcome(bars, i, L, side, v.M, v.H));
      // the level is busy until the main outcome resolves (or its window ends)
      let end = i; { const up = L * 1.0012, dn = L * 0.9988; if (!(side > 0 ? bars[i].l <= dn : bars[i].h >= up)) for (end = i + 1; end < bars.length && end <= i + 20; end++) if (bars[end].h >= up || bars[end].l <= dn) break; }
      s.busyUntil = Math.min(end, i + 20);
      out.push({ day, sym, half: day < '2026-06-01' ? 'Apr–May' : 'Jun–Jul', kind: Lv.kind, px: L, side, touchNo: s.n, res, ...tagsAt(i, L) });
    }
  }
  return out;
}

const T = { node: [], matched: [], fixed: [] }; let days = 0;
const allDays = fs.readdirSync(ARCH).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort();
for (const d of SMOKE ? allDays.slice(0, 4) : allDays) {
  const data = {}; for (const sym of ['SPY', 'QQQ']) { const B = loadBoards(d, sym), bars = loadBars(d, sym); if (B && bars) data[sym] = { B, bars, bi: bars.map((b) => boardAt(B, b.ms)) }; }
  if (!data.SPY || !data.QQQ) continue; days++;
  for (const sym of ['SPY', 'QQQ']) {
    const { B, bars, bi } = data[sym];
    const tags = (i, L) => { const bd = bi[i]; const g = bd?.gOf.get(L); return { isKing: bd?.king === L, gSign: g == null ? 'n/a' : g > 0 ? 'positive' : 'negative' }; };
    T.node.push(...scan(d, sym, bars, (i) => { const bd = bi[i]; if (!bd) return []; return [bd.floor != null && { px: bd.floor, kind: 'floor' }, bd.ceil != null && { px: bd.ceil, kind: 'ceiling' }].filter(Boolean); }, tags));
    // matched level lives exactly as long as its node (seeded by node strike, amendment 1); dropped on boards where it sits within 0.12% of a strong node
    const mc = new Map();
    T.matched.push(...scan(d, sym, bars, (i) => { const bd = bi[i]; if (!bd) return []; const o = [];
      for (const [kind, N] of [['floor', bd.floor], ['ceiling', bd.ceil]]) { if (N == null) continue; const key = `${kind}${N}`;
        if (!mc.has(key)) { const r = rng(`M${sym}${d}${key}`); let pick = null;
          for (let t = 0; t < 50; t++) { const sg = r() < 0.5 ? -1 : 1, Lm = Math.round(N * (1 + sg * (0.0015 + r() * 0.0035))), dist = Math.abs(Lm - N) / N;
            if (dist >= 0.0015 && dist <= 0.005 && bd.strong.every((k) => Math.abs(k - Lm) / Lm > 0.0012)) { pick = Lm; break; } }
          mc.set(key, pick); }
        const Lm = mc.get(key); if (Lm != null && bd.strong.every((k) => Math.abs(k - Lm) / Lm > 0.0012)) o.push({ px: Lm, kind: `matched-${kind}` }); }
      return o; }, tags));
    const ob = B[0], open = bars[0].o, r = rng(`${sym}${d}`), fl = [];
    for (const side of [1, -1]) for (let t = 0; t < 50; t++) { const L = Math.round(open * (1 + side * (0.0015 + r() * 0.012))), dist = Math.abs(L - open) / open; if (dist >= 0.0015 && dist <= 0.0135 && ob.strong.every((k) => Math.abs(k - L) / L > 0.0012)) { fl.push({ px: L, kind: 'fixed' }); break; } }
    T.fixed.push(...scan(d, sym, bars, () => fl, tags));
  }
}
if (SMOKE) { console.log(JSON.stringify({ days, node: T.node.length, matched: T.matched.length, fixed: T.fixed.length, sample: T.node[0] })); process.exit(0); }

// ---- stats ----
const rate = (arr, v = 0) => { let r = 0, b = 0; for (const t of arr) { if (t.res[v] === 'reject') r++; else if (t.res[v] === 'break') b++; } return { r, b, n: arr.length, rate: r + b ? r / (r + b) : NaN, stall: arr.filter((t) => t.res[v] === 'stall').length, amb: arr.filter((t) => t.res[v] === 'ambiguous').length }; };
function bootDiff(a, b, v = 0, reps = 2000) { // day-block bootstrap of rate(a) − rate(b)
  const dayList = [...new Set([...a, ...b].map((t) => t.day))], ga = new Map(), gb = new Map();
  for (const t of a) (ga.get(t.day) ?? ga.set(t.day, []).get(t.day)).push(t); for (const t of b) (gb.get(t.day) ?? gb.set(t.day, []).get(t.day)).push(t);
  const r = rng('boot'), diffs = [];
  for (let k = 0; k < reps; k++) { const A = [], Bb = []; for (let q = 0; q < dayList.length; q++) { const d = dayList[Math.floor(r() * dayList.length)]; if (ga.has(d)) A.push(...ga.get(d)); if (gb.has(d)) Bb.push(...gb.get(d)); }
    const x = rate(A, v).rate - rate(Bb, v).rate; if (Number.isFinite(x)) diffs.push(x); }
  diffs.sort((x, y) => x - y); return { lo: diffs[Math.floor(0.025 * diffs.length)], hi: diffs[Math.floor(0.975 * diffs.length)] };
}
const pc = (x) => (Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : '—');
const line = (label, s) => `| ${label} | ${s.n} | ${s.r + s.b} | **${pc(s.rate)}** | ${pc(s.n ? s.stall / s.n : NaN)} | ${pc(s.n ? s.amb / s.n : NaN)} |`;
const H = '| group | touches | resolved | reject rate | stall | ambiguous |\n|---|---|---|---|---|---|';
const sub = (arr, f) => arr.filter(f);

const L = ['# Do 0DTE nodes make price react more than nearby random levels? — results', `\nRun ${new Date().toISOString()} · design shadow/DESIGN_node_reaction.md · ${days} days (SPY + QQQ) · M = 0.12%, 20 bars\n`];
const main = { node: rate(T.node), matched: rate(T.matched), fixed: rate(T.fixed) }, ci = bootDiff(T.node, T.matched);
const cond = [['all', () => true], ['SPY', (t) => t.sym === 'SPY'], ['QQQ', (t) => t.sym === 'QQQ'], ['Apr–May', (t) => t.half === 'Apr–May'], ['Jun–Jul', (t) => t.half === 'Jun–Jul']];
L.push(H); for (const [k, set] of [['Node floor/ceiling', T.node], ['Matched random (near the nodes)', T.matched], ['Fixed random (at the open)', T.fixed]]) L.push(line(k, rate(set)));
L.push('\n**Node minus matched random, reject rate**\n', '| slice | node | matched | difference | 95% day-bootstrap |', '|---|---|---|---|---|');
const diffs = {}; for (const [k, f] of cond) { const a = sub(T.node, f), b = sub(T.matched, f), d = rate(a).rate - rate(b).rate, c = k === 'all' ? ci : bootDiff(a, b); diffs[k] = d; L.push(`| ${k} | ${pc(rate(a).rate)} | ${pc(rate(b).rate)} | **${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)} pts** | ${(c.lo * 100).toFixed(1)} to ${(c.hi * 100).toFixed(1)} pts |`); }
const pass = diffs.all > 0 && ci.lo > 0 && diffs.SPY > 0 && diffs.QQQ > 0 && diffs['Apr–May'] > 0 && diffs['Jun–Jul'] > 0;
L.push(`\n## Verdict: **${pass ? 'PASS' : 'FAIL'}** (needs difference > 0 with the bootstrap interval above 0, and > 0 on SPY, QQQ, Apr–May and Jun–Jul)`);
L.push('\n## Secondary (not used for the verdict)\n', '**By group (node levels vs matched random, same slice)**\n', H);
for (const [k, f] of [['floor', (t) => t.kind.endsWith('floor')], ['ceiling', (t) => t.kind.endsWith('ceiling')], ['level is the king', (t) => t.isKing], ['level not the king', (t) => !t.isKing], ['positive gamma at level', (t) => t.gSign === 'positive'], ['negative gamma at level', (t) => t.gSign === 'negative'], ['1st touch of the level today', (t) => t.touchNo === 1], ['later touch', (t) => t.touchNo > 1]])
  L.push(line(`node · ${k}`, rate(sub(T.node, f))), line(`matched · ${k}`, rate(sub(T.matched, f))));
L.push('\n**Other move sizes and horizons (node − matched)**\n', '| variant | node | matched | difference |', '|---|---|---|---|');
VARIANTS.forEach((v, k) => { const a = rate(T.node, k).rate, b = rate(T.matched, k).rate; L.push(`| M ${(v.M * 100).toFixed(2)}%, ${v.H} bars | ${pc(a)} | ${pc(b)} | ${((a - b) * 100).toFixed(1)} pts |`); });
L.push(`\nNode vs fixed random: ${pc(main.node.rate)} vs ${pc(main.fixed.rate)} (fixed n=${main.fixed.n}).`);
fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'summary.md'), L.join('\n') + '\n'); fs.writeFileSync(path.join(OUT, 'touches.json'), JSON.stringify(T)); console.log(L.join('\n'));
