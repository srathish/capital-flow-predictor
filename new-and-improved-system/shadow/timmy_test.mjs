#!/usr/bin/env node
// Timmy hunt / raked entry B test (shadow/DESIGN_timmy.md). Cached data only — no API calls.
//   Test 1: SPY + QQQ 0DTE Skylit nodes (5-min archive, 2026-04-10 → 07-14) on UW 1-min bars.
//   Test 2: SPY classic levels (prior-day high/low, premarket high/low), UW 1-min 2023 → 2026.
//   node shadow/timmy_test.mjs            (runs once; --force only for logged audit fixes)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SH = decodeURIComponent(new URL('.', import.meta.url).pathname), NIS = path.join(SH, '..'), REPO = path.join(NIS, '..');
const OUT = path.join(SH, 'results_timmy'), SMOKE = process.argv.includes('--smoke');
if (!SMOKE && fs.existsSync(path.join(OUT, 'summary.md')) && !process.argv.includes('--force')) { console.error('already run (see results_timmy/summary.md)'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

// ---- frozen parameters (raked's NQ points at NQ ≈ 30,000 → % of price) ----
const P = { REARM: 0.001, SWEEP: 0.0001, STOP_PAD: 0.000033, MIN_STOP: 0.000165, MAX_STOP: 0.00165, TGT_FRONT: 0.000033, RECLAIM_MIN: 15,
  LAST_CANDLE_END: 954, EOD_BAR: 955, SLIP: 0.01, STRONG: 0.5, FAST: 0.0013, COPIN: 0.001 };
const OPEN = 570; // 09:30 ET in minutes

// ---- helpers ----
const offCache = new Map();
const nyOff = (d) => { if (!offCache.has(d)) { const h = +new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date(d + 'T16:00:00Z')); offCache.set(d, (h - 16) * 60); } return offCache.get(d); };
const etMin = (ms, d) => (((Math.floor(ms / 60000) + nyOff(d)) % 1440) + 1440) % 1440;
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
function rng(seedStr) { let h = 1779033703; for (const ch of seedStr) h = Math.imul(h ^ ch.charCodeAt(0), 3432918353), h = (h << 13) | (h >>> 19);
  let a = h >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// stats with day-clustered standard error
function stats(trades, k = 'R') {
  const r = trades.map((t) => t[k]), n = r.length; if (!n) return { n: 0 };
  const m = mean(r), byDay = new Map(); for (const t of trades) byDay.set(t.day, (byDay.get(t.day) ?? 0) + (t[k] - m));
  const G = byDay.size, se = Math.sqrt(([...byDay.values()].reduce((s, x) => s + x * x, 0) * G) / Math.max(1, G - 1)) / n;
  const gw = r.filter((x) => x > 0).reduce((s, x) => s + x, 0), gl = -r.filter((x) => x < 0).reduce((s, x) => s + x, 0);
  return { n, mean: m, t: se > 0 ? m / se : NaN, win: r.filter((x) => x > 0).length / n, pf: gl > 0 ? gw / gl : Infinity, tot: m * n, days: byDay.size };
}
const fmt = (s) => (s.n ? `n=${s.n} · mean **${s.mean >= 0 ? '+' : ''}${s.mean.toFixed(3)}R** · t=${s.t.toFixed(2)} · win ${(s.win * 100).toFixed(0)}% · PF ${s.pf.toFixed(2)} · total ${s.tot.toFixed(1)}R` : 'n=0');
const row = (label, s) => `| ${label} | ${s.n} | ${s.n ? (s.mean >= 0 ? '+' : '') + s.mean.toFixed(3) : '—'} | ${s.n ? s.t.toFixed(2) : '—'} | ${s.n ? (s.win * 100).toFixed(0) + '%' : '—'} | ${s.n ? s.pf.toFixed(2) : '—'} |`;
const HDR = '| group | trades | mean R | t (day-clustered) | win | PF |\n|---|---|---|---|---|---|';

// ---- exit simulation from bar i+1 (entry at close of bar i) ----
// mode: 'base' | 'partial' (half off at +2R, rest to target) | 'be' (stop to entry after +1R reached)
function runExit(bars, i, dir, entry, stop, target, risk, mode = 'base') {
  let st = stop, mfe = 0, half = false, j = i + 1;
  const twoR = entry + dir * 2 * risk, HALF = 0.5 * (2 - P.SLIP / risk);
  for (; j < bars.length && bars[j].etm < P.EOD_BAR; j++) {
    const b = bars[j], adverse = dir > 0 ? b.l : b.h, fav = dir > 0 ? b.h : b.l;
    if (dir * (adverse - st) <= 0) { const fill = dir > 0 ? Math.min(st, b.o) : Math.max(st, b.o), px = fill - dir * P.SLIP, rRest = (dir * (px - entry)) / risk; return { R: half ? HALF + 0.5 * rRest : rRest, how: 'stop', j, mfe }; }
    if (mode === 'partial' && !half && dir * (fav - twoR) >= 0 && dir * (target - twoR) > 0) half = true;
    if (dir * (fav - target) >= 0) { const px = target - dir * P.SLIP, rRest = (dir * (px - entry)) / risk; return { R: half ? HALF + 0.5 * rRest : rRest, how: 'target', j, mfe: Math.max(mfe, rRest) }; }
    mfe = Math.max(mfe, (dir * (fav - entry)) / risk);
    if (mode === 'be' && mfe >= 1 && dir * (entry - st) > 0) st = entry;
  }
  const last = bars[Math.min(j, bars.length) - 1], px = last.c - dir * P.SLIP, rRest = (dir * (px - entry)) / risk;
  return { R: half ? HALF + 0.5 * rRest : rRest, how: 'eod', j: Math.min(j, bars.length) - 1, mfe };
}

// ---- generic tap → sweep → reclaim engine for one symbol-day ----
// levelsAt(i) → [{px, kind}] active at bar i; target(i, dir, entry, px, risk) → target price or null; tags(i, dir, entry, px) → extra fields
function engine(day, bars, levelsAt, target, tags, onSignal) {
  const state = new Map(), watches = [], trades = [], skipped = { wide: 0, noTarget: 0 };
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i], prev = bars[i - 1];
    for (const [px, st] of state) if (!st.armed && !watches.some((w) => w.px === px) && Math.abs(prev.c - px) / px >= P.REARM) st.armed = true;
    for (const L of levelsAt(i)) {
      const st = state.get(L.px) ?? { armed: true, taps: 0, stops: [] }; state.set(L.px, st);
      if (!st.armed || watches.some((w) => w.px === L.px)) continue;
      let dir = 0; if (prev.c > L.px && b.l <= L.px) dir = 1; else if (prev.c < L.px && b.h >= L.px) dir = -1; if (!dir) continue;
      st.armed = false; st.taps++;
      const back = bars[Math.max(0, i - 6)].c, fast = (dir * (back - L.px)) / L.px > P.FAST;
      watches.push({ px: L.px, kind: L.kind, dir, tapEtm: b.etm, tapI: i, tapNo: st.taps, fast, ext: dir > 0 ? Infinity : -Infinity, swept: false });
    }
    for (let w = watches.length - 1; w >= 0; w--) {
      const W = watches[w];
      W.ext = W.dir > 0 ? Math.min(W.ext, b.l) : Math.max(W.ext, b.h);
      if (W.dir * (W.px - W.ext) / W.px >= P.SWEEP) W.swept = true;
      const candleEnd = b.etm + 1, isCandleEnd = (candleEnd - OPEN) % 3 === 0;
      if (candleEnd > W.tapEtm + P.RECLAIM_MIN || candleEnd > P.LAST_CANDLE_END) { watches.splice(w, 1); continue; }
      if (!isCandleEnd || !W.swept || W.dir * (b.c - W.px) <= 0) continue;
      watches.splice(w, 1);
      onSignal?.({ i, etm: b.etm, dir: W.dir, px: W.px, kind: W.kind });
      const entry = b.c + W.dir * P.SLIP;
      const stop = W.dir > 0 ? Math.min(W.ext * (1 - P.STOP_PAD), W.px * (1 - P.MIN_STOP)) : Math.max(W.ext * (1 + P.STOP_PAD), W.px * (1 + P.MIN_STOP));
      const risk = W.dir * (entry - stop);
      if (risk / entry > P.MAX_STOP) { skipped.wide++; continue; }
      const tgt = target(i, W.dir, entry, W.px, risk);
      if (tgt == null || W.dir * (tgt - entry) < risk) { skipped.noTarget++; continue; }
      const st = state.get(W.px), stopsBefore = st.stops.filter((e) => e <= b.etm + 1).length;
      const base = runExit(bars, i, W.dir, entry, stop, tgt, risk), part = runExit(bars, i, W.dir, entry, stop, tgt, risk, 'partial'), be = runExit(bars, i, W.dir, entry, stop, tgt, risk, 'be');
      if (base.how === 'stop') st.stops.push(bars[base.j].etm + 1);
      let fail = null;
      if (base.how === 'stop') {
        let later = false; for (let j = base.j + 1; j < bars.length && bars[j].etm < P.EOD_BAR; j++) if (W.dir * ((W.dir > 0 ? bars[j].h : bars[j].l) - tgt) >= 0) { later = true; break; }
        fail = later ? 'right read, target hit later' : base.mfe >= 1 ? 'worked then reversed (≥ +1R first)' : base.j - i <= 2 ? 'instant (≤ 2 min)' : 'slow';
      }
      trades.push({ day, etm: b.etm, dir: W.dir, px: W.px, kind: W.kind, tapNo: W.tapNo, fast: W.fast, entry, stop, tgt, riskPct: risk / entry,
        R: base.R, how: base.how, mfe: base.mfe, Rpartial: part.R, Rbe: be.R, stopsBefore, fail, ...tags(i, W.dir, entry, W.px) });
    }
  }
  return { trades, skipped };
}

// =====================================================================================================
// TEST 1 — SPY + QQQ 0DTE nodes
// =====================================================================================================
const ARCH = path.join(REPO, 'apps/gex/data/skylit-archive/intraday'), UND = path.join(REPO, 'apps/gex/research/exit-study/cache_underlying');
const gunz = (f) => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
function loadBoards(d, sym) {
  const f = path.join(ARCH, d, `${sym}.jsonl.gz`); if (!fs.existsSync(f)) return null;
  const B = gunz(f).map((x) => ({ ts: Date.parse(x.requestedTs), spot: x.spot, s: (x.strikes ?? []).map((k) => ({ k: k.strike, g: k.gamma })).filter((k) => Number.isFinite(k.g)) }));
  if (new Set(B.map((x) => x.spot)).size <= 1) return null; // holiday / frozen
  for (const b of B) { const king = b.s.reduce((a, k) => (Math.abs(k.g) > Math.abs(a?.g ?? 0) ? k : a), null); b.king = king; b.net = b.s.reduce((s, k) => s + k.g, 0);
    b.strong = king && Math.abs(king.g) > 0 ? b.s.filter((k) => Math.abs(k.g) >= P.STRONG * Math.abs(king.g)).map((k) => k.k).sort((x, y) => x - y) : [];
    const pick = (arr) => arr.reduce((a, k) => (Math.abs(k.g) > Math.abs(a?.g ?? -1) ? k : a), null);
    const sk = b.s.filter((k) => b.strong.includes(k.k)); b.floor = pick(sk.filter((k) => k.k < b.spot))?.k ?? null; b.ceil = pick(sk.filter((k) => k.k > b.spot))?.k ?? null; }
  return B.sort((a, b) => a.ts - b.ts);
}
function loadBars1(d, sym) {
  const f = path.join(UND, `${sym}_${d}.json`); if (!fs.existsSync(f)) return null;
  const j = JSON.parse(fs.readFileSync(f, 'utf8')), a = Array.isArray(j) ? j : j.data ?? [];
  const bars = a.filter((x) => x.market_time === 'r').map((x) => { const ms = Date.parse(x.start_time); return { ms, etm: etMin(ms, d), o: +x.open, h: +x.high, l: +x.low, c: +x.close }; })
    .filter((b) => b.etm >= OPEN && b.etm < 960).sort((a, b) => a.ms - b.ms);
  return bars.length >= 200 ? bars : null;
}
const boardAt = (B, ms) => { let r = null; for (const b of B) { if (b.ts <= ms - 60000) r = b; else break; } return r; };

const t1 = [], t1r = [], t1m = [], t1skip = { node: { wide: 0, noTarget: 0 }, rand: { wide: 0, noTarget: 0 }, matched: { wide: 0, noTarget: 0 } }; let t1days = 0;
for (const d of fs.readdirSync(ARCH).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort().slice(0, SMOKE ? 4 : undefined)) {
  const data = {}; for (const sym of ['SPY', 'QQQ']) { const B = loadBoards(d, sym), bars = loadBars1(d, sym); if (B && bars) data[sym] = { B, bars, boardIdx: bars.map((b) => boardAt(B, b.ms)) }; }
  if (!data.SPY || !data.QQQ) continue; t1days++;
  for (const sym of ['SPY', 'QQQ']) {
    const { B, bars, boardIdx } = data[sym], other = data[sym === 'SPY' ? 'QQQ' : 'SPY'];
    const tgtFn = (i, dir, entry, px) => { const bd = boardIdx[i]; if (!bd) return null; const c = bd.strong.filter((k) => k !== px && dir * (k - entry) > 0).sort((a, b) => dir * (a - b)); return c.length ? c[0] * (1 - dir * P.TGT_FRONT) : null; };
    const tagFn = (i, dir, entry, px) => { const bd = boardIdx[i], K = bd?.king?.k, ob = other.bars.findIndex((x) => x.ms === bars[i].ms), obd = ob >= 0 ? other.boardIdx[ob] : null, oc = ob >= 0 ? other.bars[ob].c : null;
      return { sym, half: d < '2026-06-01' ? 'Apr–May' : 'Jun–Jul', kingBehind: K != null && dir * (K - entry) < 0, netPos: (bd?.net ?? 0) > 0,
        copin: !!(obd && oc && [obd.floor, obd.ceil].some((L) => L != null && Math.abs(oc - L) / L <= P.COPIN)) }; };
    const levels = (i) => { const bd = boardIdx[i]; if (!bd) return []; return [bd.floor != null && { px: bd.floor, kind: 'floor' }, bd.ceil != null && { px: bd.ceil, kind: 'ceiling' }].filter(Boolean); };
    const r1 = engine(d, bars, levels, tgtFn, tagFn); t1.push(...r1.trades.map((t) => ({ ...t, day: d }))); for (const k in r1.skipped) t1skip.node[k] += r1.skipped[k];
    // random baseline: 2 levels from the opening board, fixed all day
    const ob = B[0], open = bars[0].o, rnd = rng(`${sym}${d}`), rl = [];
    for (const side of [1, -1]) for (let tries = 0; tries < 50; tries++) { const u = 0.0015 + rnd() * 0.012, L = Math.round(open * (1 + side * u)), dist = Math.abs(L - open) / open; if (dist >= 0.0015 && dist <= 0.0135 && ob.strong.every((k) => Math.abs(k - L) / L > 0.0012)) { rl.push({ px: L, kind: side > 0 ? 'rand-above' : 'rand-below' }); break; } }
    const mcache = new Map(), matched = (i) => { const bd = boardIdx[i]; if (!bd) return []; if (!mcache.has(bd.ts)) { const out = [];
        for (const [kind, N] of [['floor', bd.floor], ['ceiling', bd.ceil]]) { if (N == null) continue; const r = rng(`M${sym}${d}${bd.ts}${kind}`);
          for (let tries = 0; tries < 50; tries++) { const sg = r() < 0.5 ? -1 : 1, Lm = Math.round(N * (1 + sg * (0.0015 + r() * 0.0035))), dist = Math.abs(Lm - N) / N;
            if (dist >= 0.0015 && dist <= 0.005 && bd.strong.every((k) => Math.abs(k - Lm) / Lm > 0.0012)) { out.push({ px: Lm, kind: `matched-${kind}` }); break; } } }
        mcache.set(bd.ts, out); } return mcache.get(bd.ts); };
    const r3 = engine(d, bars, matched, tgtFn, tagFn); t1m.push(...r3.trades.map((t) => ({ ...t, day: d }))); for (const k in r3.skipped) t1skip.matched[k] += r3.skipped[k];
    const r2 = engine(d, bars, () => rl, tgtFn, tagFn); t1r.push(...r2.trades.map((t) => ({ ...t, day: d }))); for (const k in r2.skipped) t1skip.rand[k] += r2.skipped[k];
  }
}

// =====================================================================================================
// TEST 2 — SPY classic levels 2023 → 2026
// =====================================================================================================
const S1 = path.join(NIS, '.cache/uw/spy1m'), sdays = fs.readdirSync(S1).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 10)).sort();
const t2 = [], t2r = [], t2skip = { real: { wide: 0, noTarget: 0 }, rand: { wide: 0, noTarget: 0 } }, wicksy = { flagged: [], all: [] }; let t2days = 0, prevBars = null;
for (const d of SMOKE ? sdays.slice(0, 6) : sdays) {
  const raw = JSON.parse(fs.readFileSync(path.join(S1, `${d}.json`), 'utf8')).map((x) => ({ ms: x.t * 1000, etm: etMin(x.t * 1000, d), o: x.o, h: x.h, l: x.l, c: x.c, m: x.m }));
  const bars = raw.filter((x) => x.m === 'r' && x.etm >= OPEN && x.etm < 960).sort((a, b) => a.ms - b.ms), pre = raw.filter((x) => x.m === 'pr' && x.etm < OPEN);
  if (bars.length < 300) { prevBars = null; continue; } // half days dropped (amendment 1)
  if (prevBars) {
    t2days++;
    const lv = [{ px: Math.max(...prevBars.map((b) => b.h)), kind: 'prior-day high' }, { px: Math.min(...prevBars.map((b) => b.l)), kind: 'prior-day low' }];
    if (pre.length) lv.push({ px: Math.max(...pre.map((b) => b.h)), kind: 'premarket high' }, { px: Math.min(...pre.map((b) => b.l)), kind: 'premarket low' });
    const lm = new Map(); for (const L of lv) lm.set(L.px, lm.has(L.px) ? { px: L.px, kind: lm.get(L.px).kind + ' + ' + L.kind } : L); const levels = [...lm.values()];
    const htf = []; const onSig = (s) => { if (s.kind.includes('prior-day')) htf.push(s); if (s.kind.includes('premarket low') && s.dir > 0 && s.etm < 630) wicksyHit ??= s; };
    let wicksyHit = null;
    const tgt2 = (i, dir, entry, px, risk) => entry + dir * 2 * risk;
    const tag2 = () => ({ sym: 'SPY', year: d.slice(0, 4) });
    const r = engine(d, bars, () => levels, tgt2, tag2, onSig);
    for (const t of r.trades) { const before = htf.filter((s) => s.etm < t.etm); t.glitch = before.some((s) => s.dir === -t.dir) ? 'counter' : before.some((s) => s.dir === t.dir) ? 'with' : 'none'; t.day = d; t2.push(t); }
    for (const k in r.skipped) t2skip.real[k] += r.skipped[k];
    const eod = bars.filter((b) => b.etm < P.EOD_BAR).at(-1).c, ten = bars.find((b) => b.etm >= 600);
    if (ten && !wicksyHit) wicksy.all.push(eod / ten.c - 1); if (wicksyHit) wicksy.flagged.push(eod / bars[wicksyHit.i].c - 1);
    const open = bars[0].o, rnd = rng(`T2${d}`), rl = [];
    for (const side of [1, 1, -1, -1]) for (let tries = 0; tries < 50; tries++) { const u = 0.001 + rnd() * 0.014, L = Math.round(open * (1 + side * u) * 100) / 100; if (levels.every((x) => Math.abs(x.px - L) / L > 0.0005) && !rl.some((x) => x.px === L)) { rl.push({ px: L, kind: 'random' }); break; } }
    const rr = engine(d, bars, () => rl, tgt2, tag2); for (const t of rr.trades) { t.day = d; t2r.push(t); } for (const k in rr.skipped) t2skip.rand[k] += rr.skipped[k];
  }
  prevBars = bars;
}

if (SMOKE) { console.log(JSON.stringify({ t1days, t1: t1.length, t1r: t1r.length, t1m: t1m.length, t1skip, t2days, t2: t2.length, t2r: t2r.length, t2skip, sample: t1[0] && Object.keys(t1[0]) })); process.exit(0); }
// =====================================================================================================
// REPORT
// =====================================================================================================
const L = [];
const by = (arr, f) => { const m = new Map(); for (const t of arr) { const k = f(t); (m.get(k) ?? m.set(k, []).get(k)).push(t); } return m; };
const section = (title, arr, f, order) => { L.push(`\n**${title}**\n`, HDR); const m = by(arr, f); for (const k of order ?? [...m.keys()].sort()) if (m.has(k)) L.push(row(String(k), stats(m.get(k)))); };
const halves = (title, arr, f) => { L.push(`\n**${title}** (Apr–May / Jun–Jul)\n`, '| group | Apr–May | Jun–Jul |', '|---|---|---|');
  const m = by(arr, f); for (const k of [...m.keys()].sort()) { const a = stats(m.get(k).filter((t) => t.half === 'Apr–May')), b = stats(m.get(k).filter((t) => t.half === 'Jun–Jul'));
    const c = (s) => (s.n ? `${s.mean >= 0 ? '+' : ''}${s.mean.toFixed(2)}R (n=${s.n}, win ${(s.win * 100).toFixed(0)}%)` : '—'); L.push(`| ${k} | ${c(a)} | ${c(b)} |`); } };

const s1 = stats(t1), s1r = stats(t1r), s1m = stats(t1m), s1spy = stats(t1.filter((t) => t.sym === 'SPY')), s1qqq = stats(t1.filter((t) => t.sym === 'QQQ'));
const pass1 = s1.n > 0 && s1.mean > 0 && s1.t >= 2 && s1r.n > 0 && s1.mean > s1r.mean && s1m.n > 0 && s1.mean > s1m.mean && s1spy.mean > 0 && s1qqq.mean > 0;
L.push('# Timmy hunt / raked entry B — results', `\nRun ${new Date().toISOString()} · design: shadow/DESIGN_timmy.md (locked before code). Cached data only.\n`);
L.push(`## Test 1 — SPY + QQQ 0DTE nodes (${t1days} days, ${[...new Set(t1.map((t) => t.day))].sort()[0] ?? '—'} → ${[...new Set(t1.map((t) => t.day))].sort().at(-1) ?? '—'})\n`);
L.push(`- **Node trades:** ${fmt(s1)}`, `- SPY: ${fmt(s1spy)}`, `- QQQ: ${fmt(s1qqq)}`, `- **Random levels fixed at the open (same rules):** ${fmt(s1r)}`, `- **Matched random levels (0.15–0.5% off each live floor/ceiling, redrawn every board):** ${fmt(s1m)}`,
  `- Skipped (stop too wide / no target ≥ 1R): nodes ${t1skip.node.wide} / ${t1skip.node.noTarget}; random ${t1skip.rand.wide} / ${t1skip.rand.noTarget}; matched ${t1skip.matched.wide} / ${t1skip.matched.noTarget}`,
  `\n### Verdict: **${pass1 ? 'PASS' : 'FAIL'}** (needs mean > 0 with t ≥ 2, beats both random baselines, positive on SPY and on QQQ)`);
L.push('\n### Secondary (not used for the verdict)');
halves('By level', t1, (t) => t.kind); halves('Exit type', t1, (t) => t.how);
halves('R1 king behind the trade', t1, (t) => (t.kingBehind ? 'king behind' : 'king not behind'));
halves('R2 approach speed', t1, (t) => (t.fast ? 'fast (> 0.13% in 5 min)' : 'normal'));
halves('R3 level already stopped twice today', t1, (t) => (t.stopsBefore >= 2 ? '≥ 2 stops before' : '< 2 stops before'));
halves('R4 0DTE net gamma', t1, (t) => (t.netPos ? 'net gamma > 0' : 'net gamma ≤ 0'));
halves('Co-pin (other symbol at its own floor/ceiling)', t1, (t) => (t.copin ? 'co-pinned' : 'not co-pinned'));
halves('Tap number', t1, (t) => (t.tapNo >= 3 ? '3rd+' : t.tapNo === 2 ? '2nd' : '1st'));
const all4 = t1.filter((t) => !t.kingBehind && !t.fast && t.stopsBefore < 2 && t.netPos);
L.push(`\n**raked's R1+R2+R3+R4 together:** ${fmt(stats(all4))} · Apr–May ${fmt(stats(all4.filter((t) => t.half === 'Apr–May')))} · Jun–Jul ${fmt(stats(all4.filter((t) => t.half === 'Jun–Jul')))}`);
L.push('\n**Management variants (same trades)**\n', HDR); for (const h of ['all', 'Apr–May', 'Jun–Jul']) { const a = h === 'all' ? t1 : t1.filter((t) => t.half === h); L.push(row(`${h}: as tested`, stats(a)), row(`${h}: half off at +2R`, stats(a, 'Rpartial')), row(`${h}: breakeven after +1R`, stats(a, 'Rbe'))); }
const cap3 = [...by(t1, (t) => t.sym + t.day).values()].flatMap((a) => a.sort((x, y) => x.etm - y.etm).slice(0, 3)); L.push(row('all: max 3 trades / symbol / day', stats(cap3)), row('Apr–May: max 3 / symbol / day', stats(cap3.filter((t) => t.half === 'Apr–May'))), row('Jun–Jul: max 3 / symbol / day', stats(cap3.filter((t) => t.half === 'Jun–Jul'))));
L.push('\n**Why stopped trades failed**\n', '| class | Apr–May | Jun–Jul |', '|---|---|---|'); for (const [k, v] of by(t1.filter((t) => t.fail), (t) => t.fail)) L.push(`| ${k} | ${v.filter((t) => t.half === 'Apr–May').length} | ${v.filter((t) => t.half === 'Jun–Jul').length} |`);
L.push(`\nMedian risk per trade: ${(([...t1.map((t) => t.riskPct)].sort((a, b) => a - b)[Math.floor(t1.length / 2)] ?? 0) * 100).toFixed(3)}% of price.`);

const s2 = stats(t2), s2r = stats(t2r), yrs = ['2023', '2024', '2025', '2026'], ys = yrs.map((y) => stats(t2.filter((t) => t.year === y)));
const pass2 = s2.n > 0 && s2.mean > 0 && s2.t >= 2 && s2r.n > 0 && s2.mean > s2r.mean && ys.filter((s) => s.n && s.mean > 0).length >= 3;
L.push(`\n## Test 2 — SPY classic levels (${t2days} days, ${sdays[0]} → ${sdays.at(-1)})\n`);
L.push(`- **Level trades:** ${fmt(s2)}`, `- **Random levels (same rules):** ${fmt(s2r)}`, ...yrs.map((y, k) => `- ${y}: ${fmt(ys[k])} · random ${fmt(stats(t2r.filter((t) => t.year === y)))}`),
  `- Skipped (stop too wide / no target): levels ${t2skip.real.wide} / ${t2skip.real.noTarget}; random ${t2skip.rand.wide} / ${t2skip.rand.noTarget}`,
  `\n### Verdict: **${pass2 ? 'PASS' : 'FAIL'}** (needs mean > 0 with t ≥ 2, beats random, positive in ≥ 3 of 4 years)`);
L.push('\n### Secondary (not used for the verdict)');
section('By level type', t2, (t) => t.kind); section('Glitch: HTF sweep earlier today', t2, (t) => t.glitch, ['with', 'none', 'counter']); section('Exit type', t2, (t) => t.how);
L.push('\n**Management variant**\n', HDR, row('as tested (2R target)', stats(t2)), row('breakeven after +1R', stats(t2, 'Rbe')));
L.push(`\n**Wicksy "Timmy hunt the lows = bullish":** premarket-low hunt+reclaim before 10:30 on ${wicksy.flagged.length} days → mean move from signal to 15:55 ${(mean(wicksy.flagged) * 100).toFixed(3)}% (up ${(wicksy.flagged.filter((x) => x > 0).length / (wicksy.flagged.length || 1) * 100).toFixed(0)}%) vs other days (no such signal) 10:00 → 15:55 ${(mean(wicksy.all) * 100).toFixed(3)}% (up ${(wicksy.all.filter((x) => x > 0).length / (wicksy.all.length || 1) * 100).toFixed(0)}%).`);

const md = L.join('\n') + '\n';
fs.writeFileSync(path.join(OUT, 'summary.md'), md);
fs.writeFileSync(path.join(OUT, 'trades.json'), JSON.stringify({ t1, t1r, t1m, t2, t2r }));
console.log(md);
