#!/usr/bin/env node
// Trade-rule factory engine (shadow/DESIGN_trade_factory.md): 504 intraday rules = level × trigger × exit × filter on
// SPY / QQQ / IWM / DIA 1-minute bars; build 2023-01 → 2025-03, holdout 2025-04 → 2026-10; BH both stages; random-level
// twins as each validated rule's own placebo.
//   node --max-old-space-size=8000 shadow/trade_factory.mjs [--smoke]   (runs once; --force only for logged audit fixes)
import fs from 'node:fs';
import path from 'node:path';

const SH = decodeURIComponent(new URL('.', import.meta.url).pathname), NIS = path.join(SH, '..'), C = path.join(NIS, '.cache');
const OUT = path.join(SH, 'results_trade_factory'), SMOKE = process.argv.includes('--smoke');
if (!SMOKE && fs.existsSync(path.join(OUT, 'summary.md')) && !process.argv.includes('--force')) { console.error('already run'); process.exit(1); }
const REG = JSON.parse(fs.readFileSync(path.join(SH, 'trade_registry.json'), 'utf8')).rules;
const SYMS = ['SPY', 'QQQ', 'IWM', 'DIA'], BUILD_END = '2025-03-31', HOLD_START = '2025-04-01', GAMMA_START = '2023-11-09';
const P = { STOP: 0.001, SWEEP: 0.0001, PAD: 0.000033, MINSTOP: 0.000165, MAXRISK: 0.00165, FRONT: 0.000033, COST: 0.01, LAST_ENTRY: 930, EOD: 955, FIRST: 575 };
const log = (s) => console.error(`${new Date().toISOString().slice(11, 19)} ${s}`);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const offC = new Map(), etMin = (t, d) => { if (!offC.has(d)) { const h = +new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date(d + 'T16:00:00Z')); offC.set(d, (h - 16) * 60); } return (((Math.floor(t / 60) + offC.get(d)) % 1440) + 1440) % 1440; };
function rng(seed) { let h = 1779033703; for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 3432918353), h = (h << 13) | (h >>> 19); let a = h >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------- data ----------
function dayFiles(T) { const dir = path.join(C, 'uw', 'm1', T); if (fs.existsSync(dir)) return { dir, files: fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort() };
  if (SMOKE && T === 'SPY') { const d2 = path.join(C, 'uw', 'spy1m'); return { dir: d2, files: fs.readdirSync(d2).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort() }; } return { dir: null, files: [] }; }
function greeksDaily(T) { const f = path.join(C, 'uwgreeks', `${T}.jsonl`); const m = new Map(); if (!fs.existsSync(f)) return m;
  for (const l of fs.readFileSync(f, 'utf8').split('\n')) { if (!l) continue; const j = JSON.parse(l); m.set(j.d, j.s); } return m; }

// prior-day gamma levels + local-gamma z regime (G23 of the idea factory: ±2% balance z-scored vs its prior 60 days)
function gammaInfo(G, days, closeOf) { const bal = new Map(), lv = new Map();
  for (const d of days) { const s = G.get(d), S = closeOf.get(d); if (!s?.length || !S) continue; let A = 0, N = 0; for (const r of s) { const g = r[1] + r[2]; if (Math.abs(r[0] / S - 1) <= 0.02) { A += Math.abs(g); N += g; } } bal.set(d, A > 0 ? N / A : NaN);
    let king = null, cw = null, pw = null; for (const r of s) { const g = r[1] + r[2]; if (!king || Math.abs(g) > Math.abs(king[1])) king = [r[0], g]; if (r[0] > S && (!cw || r[1] > cw[1])) cw = [r[0], r[1]]; if (r[0] < S && (!pw || Math.abs(r[2]) > Math.abs(pw[1]))) pw = [r[0], r[2]]; }
    lv.set(d, { KING: king?.[0], CALLW: cw?.[0], PUTW: pw?.[0] }); }
  const z = new Map(); for (let i = 0; i < days.length; i++) { const d = days[i], b = bal.get(d); if (!Number.isFinite(b)) continue; const h = []; for (let k = Math.max(0, i - 60); k < i; k++) { const x = bal.get(days[k]); if (Number.isFinite(x)) h.push(x); }
    if (h.length >= 40) { const m = mean(h), sd = Math.sqrt(mean(h.map((x) => (x - m) ** 2))); if (sd > 0) z.set(d, (b - m) / sd); } }
  return { lv, z }; }

// ---------- per symbol-day context ----------
function loadDays(T) {
  const { dir, files } = dayFiles(T); const out = [];
  for (const f of files) { const d = f.slice(0, 10), raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const reg = raw.filter((b) => b.m === 'r').map((b) => ({ ...b, etm: etMin(b.t, d) })).filter((b) => b.etm >= 570 && b.etm < 960);
    const pre = raw.filter((b) => b.m === 'pr').map((b) => ({ ...b, etm: etMin(b.t, d) })).filter((b) => b.etm < 570);
    if (reg.length < 300) { out.push({ d, skip: true }); continue; } out.push({ d, reg, pre }); }
  return out; }

// ---------- signal detection for one (day, level, trigger); levels object: name → number | Float64Array (per-bar VWAP) ----------
const lvlAt = (L, i) => (typeof L === 'number' ? L : L[i]);
function signals(day, L, trig, avail) { // avail = first bar index at which the level exists
  const B = day.reg, out = [];
  if (trig === 'BRK' || trig === 'RET') {
    for (let i = Math.max(avail, 4); i < B.length; i++) { if ((B[i].etm - 570 + 1) % 5 !== 0) continue; const pc = i >= 5 ? B[i - 5].c : B[0].o, lv = lvlAt(L, i), lp = lvlAt(L, Math.max(avail, i - 5));
      if (!Number.isFinite(lv)) continue; let dir = 0; if (pc <= lp && B[i].c > lv) dir = 1; else if (pc >= lp && B[i].c < lv) dir = -1; if (!dir) continue;
      if (trig === 'BRK') { if (B[i].etm + 1 <= P.LAST_ENTRY) out.push({ i, dir, entry: B[i].c, stop: lv * (1 - dir * P.STOP), lvl: lv }); continue; }
      // RET: within 60 min after the break, a 5-min bar touches the level and closes back on the breakout side
      for (let k = i + 5; k < B.length && B[k].etm - B[i].etm <= 60; k += 5) { if ((B[k].etm - 570 + 1) % 5 !== 0) continue; const lk = lvlAt(L, k); let lo = Infinity, hi = -Infinity; for (let q = k - 4; q <= k; q++) { lo = Math.min(lo, B[q].l); hi = Math.max(hi, B[q].h); }
        if ((dir > 0 ? lo <= lk && B[k].c > lk : hi >= lk && B[k].c < lk) && B[k].etm + 1 <= P.LAST_ENTRY) { out.push({ i: k, dir, entry: B[k].c, stop: lk * (1 - dir * P.STOP), lvl: lk }); break; } }
      if (trig === 'RET' && out.length) break; } }
  else if (trig === 'RCL') { let armed = true, W = null;
    for (let i = Math.max(avail, 1); i < B.length; i++) { const b = B[i], lv = lvlAt(L, i); if (!Number.isFinite(lv)) continue;
      if (!W && armed) { let side = 0; if (B[i - 1].c > lv && b.l <= lv) side = 1; else if (B[i - 1].c < lv && b.h >= lv) side = -1; if (side) { W = { side, tap: b.etm, ext: side > 0 ? b.l : b.h, lv }; armed = false; } }
      if (W) { W.ext = W.side > 0 ? Math.min(W.ext, b.l) : Math.max(W.ext, b.h); const swept = W.side * (W.lv - W.ext) / W.lv >= P.SWEEP, end = b.etm + 1;
        if (end > W.tap + 15 || end > P.LAST_ENTRY) { W = null; continue; }
        if ((end - 570) % 3 === 0 && swept && W.side * (b.c - W.lv) > 0) { const stop = W.side > 0 ? Math.min(W.ext * (1 - P.PAD), W.lv * (1 - P.MINSTOP)) : Math.max(W.ext * (1 + P.PAD), W.lv * (1 + P.MINSTOP));
          if (Math.abs(b.c - stop) / b.c <= P.MAXRISK) out.push({ i, dir: W.side, entry: b.c, stop, lvl: W.lv }); W = null; } }
      if (!armed && !W && Math.abs(b.c - lv) / lv >= 0.001) armed = true; } }
  else if (trig === 'FAD') { const seen = { 1: false, '-1': false };
    for (let i = Math.max(avail, 1); i < B.length; i++) { const b = B[i], lv = lvlAt(L, i); if (!Number.isFinite(lv) || b.etm > P.LAST_ENTRY) continue;
      for (const side of [1, -1]) { if (seen[side]) continue; const prev = B[i - 1].c; if (side > 0 ? prev > lv && b.l <= lv : prev < lv && b.h >= lv) { seen[side] = true;
        const fill = side > 0 ? Math.min(lv, b.o) : Math.max(lv, b.o), stop = lv * (1 - side * P.STOP); out.push({ i, dir: side, entry: fill, stop, lvl: lv, fillBar: true }); } } } }
  return out.sort((a, b) => a.i - b.i); }

// ---------- exit simulation (1-minute path after entry) ----------
function simulate(B, s, target) {
  const risk = Math.abs(s.entry - s.stop); if (!(risk > 0)) return null; const cost = (2 * P.COST) / risk;
  if (s.fillBar && (s.dir > 0 ? B[s.i].l <= s.stop : B[s.i].h >= s.stop)) return -1 - cost; // limit fill bar also reaches the stop → stop counts
  for (let j = s.i + 1; j < B.length && B[j].etm < P.EOD; j++) { const b = B[j];
    if (s.dir > 0 ? b.l <= s.stop : b.h >= s.stop) { const fill = s.dir > 0 ? Math.min(s.stop, b.o) : Math.max(s.stop, b.o); return (s.dir * (fill - s.entry)) / risk - cost; }
    if (target != null && (s.dir > 0 ? b.h >= target : b.l <= target)) return (s.dir * (target - s.entry)) / risk - cost; }
  let k = B.length - 1; while (k > s.i && B[k].etm >= P.EOD) k--; return (s.dir * (B[k].c - s.entry)) / risk - cost; }

// ---------- run every rule; twins = random level offsets (seeded) ----------
const ALL_LEVELS = ['PDH', 'PDL', 'PMH', 'PML', 'OR5H', 'OR5L', 'OR15H', 'OR15L', 'OR30H', 'OR30L', 'OR60H', 'OR60L', 'VWAP', 'KING', 'CALLW', 'PUTW'];
const STATIC = new Set(['PDH', 'PDL', 'PMH', 'PML', 'KING', 'CALLW', 'PUTW']);
function dayLevels(day, prev, glv) { const B = day.reg, lv = {}, avail = {};
  if (prev) { lv.PDH = Math.max(...prev.reg.map((b) => b.h)); lv.PDL = Math.min(...prev.reg.map((b) => b.l)); }
  if (day.pre.length) { lv.PMH = Math.max(...day.pre.map((b) => b.h)); lv.PML = Math.min(...day.pre.map((b) => b.l)); }
  for (const [n, w] of [['5', 5], ['15', 15], ['30', 30], ['60', 60]]) { const idx = B.findIndex((b) => b.etm >= 570 + w); if (idx > 0) { const sl = B.slice(0, idx); lv[`OR${n}H`] = Math.max(...sl.map((b) => b.h)); lv[`OR${n}L`] = Math.min(...sl.map((b) => b.l)); avail[`OR${n}H`] = avail[`OR${n}L`] = idx; } }
  if (B.every((b) => Number.isFinite(b.v))) { const vw = new Float64Array(B.length); let pv = 0, vv = 0; for (let i = 0; i < B.length; i++) { const tp = (B[i].h + B[i].l + B[i].c) / 3; pv += tp * B[i].v; vv += B[i].v; vw[i] = vv > 0 ? pv / vv : NaN; } lv.VWAP = vw; avail.VWAP = 5; }
  if (glv) for (const k of ['KING', 'CALLW', 'PUTW']) if (Number.isFinite(glv[k])) lv[k] = glv[k];
  for (const k of Object.keys(lv)) if (avail[k] == null) avail[k] = 1;
  return { lv, avail }; }
const shift = (L, u) => (typeof L === 'number' ? L * (1 + u) : Float64Array.from(L, (x) => x * (1 + u)));

const TR = new Map(REG.map((r) => [r.id, []])); // rule → [{d, R, T}]
const twinsWanted = new Set(); let gammaMedian = {};
const DATA = {};
for (const T of SYMS) { const days = loadDays(T); if (!days.length) continue; const ok = days.filter((x) => !x.skip), closeOf = new Map(ok.map((x) => [x.d, x.reg.at(-1).c]));
  const G = greeksDaily(T), gi = gammaInfo(G, ok.map((x) => x.d), closeOf);
  const zb = [...gi.z].filter(([d]) => d <= BUILD_END).map(([, z]) => z).sort((a, b) => a - b); gammaMedian[T] = zb.length ? zb[zb.length >> 1] : NaN;
  DATA[T] = { days, gi }; log(`${T}: ${ok.length} days, ${gi.z.size} with gamma regime, build median z ${gammaMedian[T]?.toFixed?.(2)}`); }
if (SMOKE) for (const T of Object.keys(DATA)) DATA[T].days = DATA[T].days.slice(-120);

function runDay(T, idx, twinK = null) { const { days, gi } = DATA[T], day = days[idx]; if (day.skip) return []; const prev = days[idx - 1]?.skip ? null : days[idx - 1];
  const dPrev = prev?.d, glv = dPrev ? gi.lv.get(dPrev) : null, z = dPrev ? gi.z.get(dPrev) : undefined;
  const { lv, avail } = dayLevels(day, prev, glv);
  if (twinK != null) { for (const k of Object.keys(lv)) { const r = rng(`${T}|${day.d}|${k}|${twinK}`), u = (0.0015 + r() * 0.0045) * (r() < 0.5 ? -1 : 1); lv[k] = shift(lv[k], u); } }
  const res = [], cache = new Map();
  for (const rule of REG) { if (twinK != null && !twinsWanted.has(rule.id)) continue; const L = lv[rule.level]; if (L == null) continue;
    if (rule.gammaStart && day.d < GAMMA_START) continue;
    if (rule.filter === 'GAM') { if (!Number.isFinite(z) || !Number.isFinite(gammaMedian[T])) continue; const brk = rule.trigger === 'BRK' || rule.trigger === 'RET'; if (brk ? !(z < gammaMedian[T]) : !(z > gammaMedian[T])) continue; }
    const key = rule.level + '|' + rule.trigger; if (!cache.has(key)) cache.set(key, signals(day, L, rule.trigger, avail[rule.level] ?? 1));
    for (const s of cache.get(key)) {
      if (rule.filter === 'VW') { const vw = lv.VWAP ? lv.VWAP[s.i] : NaN; if (!Number.isFinite(vw) || s.dir * (s.entry - vw) <= 0) continue; }
      let target = null; const risk = Math.abs(s.entry - s.stop);
      if (rule.exit === 'T2') target = s.entry + s.dir * 2 * risk;
      else if (rule.exit === 'NXT') { const cand = ALL_LEVELS.filter((k) => k !== rule.level && k !== 'VWAP' && lv[k] != null && (STATIC.has(k) || (avail[k] ?? 1e9) <= s.i)).map((k) => lv[k]).filter((x) => s.dir * (x - s.entry) > 0).sort((a, b) => s.dir * (a - b));
        if (!cand.length) break; target = cand[0] * (1 - s.dir * P.FRONT); if (s.dir * (target - s.entry) < risk) break; }
      const Rv = simulate(day.reg, s, target); if (Rv != null) res.push({ id: rule.id, d: day.d, T, R: Rv }); break; } } // first qualifying signal only
  return res; }
for (const T of Object.keys(DATA)) { for (let i = 1; i < DATA[T].days.length; i++) for (const r of runDay(T, i)) TR.get(r.id).push(r); log(`${T} rules done`); }
if (SMOKE) { const n = [...TR.values()].map((a) => a.length); console.log(JSON.stringify({ rulesWithTrades: n.filter((x) => x > 0).length, medianTrades: n.sort((a, b) => a - b)[n.length >> 1], sample: [...TR].slice(0, 6).map(([k, v]) => [k, v.length, +mean(v.map((x) => x.R)).toFixed(2)]).map(([k, n]) => `${k}:${n}`) })); process.exit(0); }

// ---------- statistics ----------
const Phi = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
const bh = (ps, q) => { const o = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]); let kmax = -1; o.forEach(([p], r) => { if (p <= ((r + 1) / o.length) * q) kmax = r; }); const keep = new Set(o.slice(0, kmax + 1).map(([, i]) => i)); return ps.map((_, i) => keep.has(i)); };
function stats(tr) { const n = tr.length; if (n < 30) return { n, m: NaN, t: NaN }; const m = mean(tr.map((x) => x.R)), by = new Map(); for (const x of tr) by.set(x.d, (by.get(x.d) ?? 0) + (x.R - m));
  const G = by.size, se = Math.sqrt(([...by.values()].reduce((s, v) => s + v * v, 0) * G) / Math.max(1, G - 1)) / n; return { n, m, t: se > 0 ? m / se : NaN, win: tr.filter((x) => x.R > 0).length / n }; }
const rules = REG.map((r) => { const all = TR.get(r.id), b = stats(all.filter((x) => x.d <= BUILD_END)); return { ...r, b, p1: Number.isFinite(b.t) ? 1 - Phi(b.t) : 1, all }; });
const k1 = bh(rules.map((r) => r.p1), 0.10); rules.forEach((r, i) => { r.stage1 = k1[i]; }); const surv = rules.filter((r) => r.stage1); log(`stage 1: ${surv.length} of ${rules.length}`);
for (const r of surv) { r.h = stats(r.all.filter((x) => x.d >= HOLD_START)); r.p2 = Number.isFinite(r.h.t) ? 1 - Phi(r.h.t) : 1; }
const k2 = bh(surv.map((r) => r.p2), 0.10); surv.forEach((r, i) => { r.passBH = k2[i] && r.h.m > 0; });
// twins for rules passing stage 2
for (const r of surv.filter((x) => x.passBH)) twinsWanted.add(r.id);
const TW = new Map([...twinsWanted].map((id) => [id, Array.from({ length: 20 }, () => [])]));
if (twinsWanted.size) for (const T of Object.keys(DATA)) for (let i = 1; i < DATA[T].days.length; i++) { if (DATA[T].days[i].skip || DATA[T].days[i].d < HOLD_START) continue; for (let k = 0; k < 20; k++) for (const x of runDay(T, i, k)) TW.get(x.id)[k].push(x); }
for (const r of surv.filter((x) => x.passBH)) { const tm = TW.get(r.id).map((a) => mean(a.map((x) => x.R))); r.twinBeat = tm.filter((m) => r.h.m > m).length; r.twinMed = tm.sort((a, b) => a - b)[10];
  const hold = r.all.filter((x) => x.d >= HOLD_START); r.bySym = Object.fromEntries(SYMS.map((T) => [T, stats(hold.filter((x) => x.T === T))])); r.cost2 = stats(hold.map((x) => ({ ...x, R: x.R - (0.02) / 1 * 0 }))); }
surv.forEach((r) => { r.validated = !!r.passBH && r.twinBeat >= 19; });
// ---------- report ----------
const fx = (x, d = 3) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : '—'), val = surv.filter((r) => r.validated);
const L = ['# Trade-rule factory — results', `\nRun ${new Date().toISOString()} · design shadow/DESIGN_trade_factory.md · ${rules.length} rules · symbols ${Object.keys(DATA).join(' ')}`,
  `\n**Build (BH q = 0.10): ${surv.length} of ${rules.length} pass. Holdout (BH across survivors, mean R > 0): ${surv.filter((r) => r.passBH).length}. Beat ≥ 19/20 random-level twins: ${val.length} validated.**\n`,
  '## Validated rules\n', '| rule | build: trades, mean R (t) | holdout: trades, win, mean R (t) | twins beaten (median twin R) | holdout by symbol (mean R) |', '|---|---|---|---|---|',
  ...val.sort((a, b) => b.h.t - a.h.t).map((r) => `| ${r.id} — ${r.text} | ${r.b.n}, ${fx(r.b.m)} (${fx(r.b.t, 2)}) | ${r.h.n}, ${(r.h.win * 100).toFixed(0)}%, **${fx(r.h.m)} (${fx(r.h.t, 2)})** | ${r.twinBeat}/20 (${fx(r.twinMed)}) | ${SYMS.map((T) => `${T} ${fx(r.bySym[T].m, 2)}`).join(' · ')} |`),
  '\n## Passed the holdout but not their random-level twins (the level did not matter)\n', '| rule | holdout mean R (t) | twins beaten |', '|---|---|---|', ...surv.filter((r) => r.passBH && !r.validated).map((r) => `| ${r.id} | ${fx(r.h.m)} (${fx(r.h.t, 2)}) | ${r.twinBeat}/20 |`),
  '\n## Passed build, failed holdout\n', '| rule | build mean R (t) | holdout mean R (t) |', '|---|---|---|', ...surv.filter((r) => !r.passBH).map((r) => `| ${r.id} | ${fx(r.b.m)} (${fx(r.b.t, 2)}) | ${fx(r.h?.m)} (${fx(r.h?.t, 2)}) |`)];
fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'summary.md'), L.join('\n') + '\n'); fs.writeFileSync(path.join(OUT, 'rules.json'), JSON.stringify(rules.map(({ all, ...x }) => x), null, 1)); console.log(L.join('\n'));
