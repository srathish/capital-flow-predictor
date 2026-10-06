#!/usr/bin/env node
// v3 STEP 2 (DESIGN_v3): point-in-time manager skill → copy the consensus of skilled managers' NEW positions. 0 Skylit credits.
//   node --max-old-space-size=16000 world/smart_money.mjs            → DEV month-ends 2023-07 → 2024-12
//   node --max-old-space-size=16000 world/smart_money.mjs --holdout  → HOLDOUT 2025-01 → 2026-03 (run once)
//   node --max-old-space-size=16000 world/smart_money.mjs --live     → today's skilled-manager consensus top 20 (logged)
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { worldUniverse } from './collect.mjs';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), C = path.join(ROOT, '.cache'), B = path.join(C, 'sec_bulk');
const MODE = process.argv.includes('--holdout') ? 'holdout' : process.argv.includes('--live') ? 'live' : 'dev';
const rd = (f, d = null) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const ymd = (t) => new Date((t + 12 * 3600) * 1000).toISOString().slice(0, 10), addD = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const TOP = 20, FWD = 182, MIN_N = 20, SHRINK = 20, SKILL_TOP = 0.02, INC = 1.25, LOOKBACK_Y = 3, SIGNAL_D = 90;

// ---------- prices / eligibility (same rules as v1/v2) ----------
const U = worldUniverse(), P = new Map();
for (const { t } of U) { let b = rd(path.join(C, 'wdaily', `${t}.json`), []); if (!b.length) b = (rd(path.join(C, 'daily', `${t}.json`), []) || []).map((x) => ({ d: ymd(x.t), c: x.c, v: x.v }));
  if (b.length > 70) P.set(t, { d: b.map((x) => x.d), c: b.map((x) => x.c), v: b.map((x) => x.v || 0) }); }
const META = new Map([...P.keys()].map((t) => [t, rd(path.join(C, 'edgar', 'meta', `${t}.json`), null)]));
const at = (t, d) => { const p = P.get(t); let lo = 0, hi = p.d.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (p.d[m] <= d) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
const eligibleAt = (t, d) => { const p = P.get(t); if (!p || !META.get(t)?.sic) return false; const j = at(t, d); if (j < 64) return false; let dv = 0; for (let k = Math.max(0, j - 49); k <= j; k++) dv += p.c[k] * p.v[k]; return p.c[j] >= 5 && dv / Math.min(50, j + 1) >= 2e7; };
const fwdFrom = (t, d) => { const p = P.get(t); if (!p) return null; const j = at(t, d) + 1, k = at(t, addD(d, FWD)); return j > 0 && j < p.c.length && k > j && p.d[k] >= addD(d, FWD - 10) ? p.c[k] / p.c[j] - 1 : null; }; // entry = next session's close
const medCache = new Map(); const uniMed = (d) => { if (medCache.has(d)) return medCache.get(d); const v = [...P.keys()].filter((t) => eligibleAt(t, d)).map((t) => fwdFrom(t, d)).filter((x) => x != null).sort((a, b) => a - b); const m = v.length ? v[v.length >> 1] : null; medCache.set(d, m); return m; };

// ---------- load positions → per-manager filings ----------
const mgr = new Map(); let rows = 0;
const rl = readline.createInterface({ input: fs.createReadStream(path.join(B, 'positions.jsonl')), crlfDelay: Infinity });
for await (const line of rl) { if (!line) continue; const o = JSON.parse(line); rows++; if (!P.has(o.t)) continue;
  let M = mgr.get(o.m); if (!M) mgr.set(o.m, (M = new Map())); let F = M.get(o.p); if (!F) M.set(o.p, (F = { p: o.p, f: o.f, pos: new Map() }));
  if (o.f < F.f) F.f = o.f; const k = o.call ? `${o.t}*` : o.t; F.pos.set(k, (F.pos.get(k) ?? 0) + o.sh); }
console.error(`positions ${rows} · managers ${mgr.size}`);
// ---------- events: new or increased (≥25%) positions vs the manager's previous period ----------
const events = []; // {m, t, f}
for (const [m, M] of mgr) { const fs_ = [...M.values()].sort((a, b) => a.p.localeCompare(b.p));
  for (let i = 1; i < fs_.length; i++) { const prev = fs_[i - 1].pos, cur = fs_[i];
    for (const [k, sh] of cur.pos) { const ps = prev.get(k) ?? 0; if (sh > 0 && (ps === 0 || sh >= INC * ps)) events.push({ m, t: k.replace('*', ''), f: cur.f }); } } }
console.error(`events (new/increased positions) ${events.length}`);
// score events whose window can be measured (entry date = filing date; excess vs universe median)
const evScore = new Map(); let scored = 0;
for (const e of events) { const r = fwdFrom(e.t, e.f); if (r == null) continue; const med = uniMed(e.f); if (med == null) continue; e.x = r - med; scored++; }
console.error(`scored events ${scored}`);
const byMgr = new Map(); for (const e of events) { let a = byMgr.get(e.m); if (!a) byMgr.set(e.m, (a = [])); a.push(e); }
for (const a of byMgr.values()) a.sort((x, y) => x.f.localeCompare(y.f));

function skilled(t) { // DESIGN_v3: only events whose 6-month window ended before t, trailing 3 years, n ≥ 20, shrunk, top 2%
  const s = []; for (const [m, a] of byMgr) { let n = 0, sum = 0; const lo = addD(t, -365 * LOOKBACK_Y), done = addD(t, -FWD - 3);
    for (const e of a) { if (e.f < lo || e.f > done || e.x == null) continue; n++; sum += e.x; } if (n >= MIN_N) s.push([m, (sum / n) * n / (n + SHRINK)]); }
  s.sort((a, b) => b[1] - a[1]); return new Map(s.slice(0, Math.max(1, Math.round(s.length * SKILL_TOP))).filter((x) => x[1] > 0)); }
function month(t) {
  const sk = skilled(t), score = new Map(), crowd = new Map(), lo = addD(t, -SIGNAL_D);
  for (const [m, a] of byMgr) { const w = sk.get(m); for (const e of a) { if (e.f <= lo || e.f > t || !eligibleAt(e.t, t)) continue; crowd.set(e.t, (crowd.get(e.t) ?? 0) + 1); if (w) score.set(e.t, (score.get(e.t) ?? 0) + w); } }
  const elig = [...P.keys()].filter((x) => eligibleAt(x, t)), fw = new Map(elig.map((x) => [x, fwdFrom(x, t)])), v = [...fw.values()].filter((x) => x != null).sort((a, b) => a - b), med = v.length ? v[v.length >> 1] : 0;
  const ex = (x) => (fw.get(x) == null ? null : fw.get(x) - med), avg = (ids) => { const a = ids.map(ex).filter((x) => x != null); return a.length ? a.reduce((p, q) => p + q, 0) / a.length : null; };
  const top = (mp) => [...mp.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP).map((x) => x[0]);
  const model = top(score), crowdTop = top(crowd);
  const mom = top(new Map(elig.map((x) => { const p = P.get(x), i = at(x, addD(t, -365)), j = at(x, addD(t, -30)); return [x, i >= 0 && j > i ? p.c[j] / p.c[i] - 1 : -9]; })));
  const q = (rd(path.join(C, 'edgar', 'sa_13f.json'), []) || []).filter((z) => z.filed <= t).at(-1); const sa = q ? [...new Set(q.holdings.filter((h) => !h.putCall && h.ticker && eligibleAt(h.ticker, t)).map((h) => h.ticker))] : [];
  const sic2 = (x) => (META.get(x)?.sic ?? '').slice(0, 2), bySic = {}; for (const x of elig) (bySic[sic2(x)] ??= []).push(x);
  let rs = []; let seed = Date.parse(t) % 2147483647 || 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 500; k++) { const pick = model.map((x) => { const g = bySic[sic2(x)] ?? elig; return g[Math.floor(rnd() * g.length)]; }); const a = avg(pick); if (a != null) rs.push(a); }
  // IC over eligible stocks (unscored = 0)
  const pairs = elig.filter((x) => fw.get(x) != null).map((x) => [score.get(x) ?? 0, fw.get(x)]);
  const rk = (a) => { const o = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = Array(a.length); let i = 0; while (i < o.length) { let j = i; while (j + 1 < o.length && o[j + 1][0] === o[i][0]) j++; for (let k = i; k <= j; k++) r[o[k][1]] = (i + j) / 2; i = j + 1; } return r; };
  const A = rk(pairs.map((p) => p[0])), Bv = rk(pairs.map((p) => p[1])), n = pairs.length, mm = (n - 1) / 2; let num = 0, da = 0, db = 0; for (let k = 0; k < n; k++) { num += (A[k] - mm) * (Bv[k] - mm); da += (A[k] - mm) ** 2; db += (Bv[k] - mm) ** 2; }
  return { t, skilledN: sk.size, model: avg(model), crowd: avg(crowdTop), mom: avg(mom), sa: avg(sa), saN: sa.length, random: rs.length ? rs.reduce((a, x) => a + x, 0) / rs.length : null, ic: da && db ? num / Math.sqrt(da * db) : null,
    picks: model.map((x) => ({ t: x, ex: ex(x), w: +(score.get(x) ?? 0).toFixed(4) })), topManagers: [...sk.entries()].slice(0, 10).map(([m, s]) => ({ m, s: +s.toFixed(4) })) };
}
const fmt = (x) => (x == null || !Number.isFinite(x) ? '-' : (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%');
const monthEnds = (a, b) => { const o = []; let [y, m] = a.split('-').map(Number); for (;;) { const d = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); if (d > b) break; o.push(d); m++; if (m > 12) { m = 1; y++; } } return o; };
const OUT = path.join(ROOT, 'world', 'results_v3'); fs.mkdirSync(OUT, { recursive: true });
if (MODE === 'live') { const t = new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10), r = month(t); fs.mkdirSync(path.join(ROOT, 'world', 'live_v3'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'world', 'live_v3', `${t}.json`), JSON.stringify(r, null, 1));
  console.log(`# Smart-money consensus — ${t} · ${r.skilledN} skilled managers\n`); for (const p of r.picks) console.log(`- ${p.t} (skill-weighted buys ${p.w})`); process.exit(0); }
const ARG = (k) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : null; };
const [a, b] = ARG('from') ? [ARG('from'), ARG('to')] : MODE === 'holdout' ? ['2025-01-01', '2026-03-31'] : ['2023-07-01', '2024-12-31'];
if (!ARG('from') && MODE === 'holdout' && fs.existsSync(path.join(OUT, 'holdout.json'))) { console.error('HOLDOUT already run once — refusing (DESIGN_v3).'); process.exit(1); }
const res = []; for (const t of monthEnds(a, b)) { const r = month(t); res.push(r); console.error(`${t} skilled ${r.skilledN} · model ${fmt(r.model)} · crowd ${fmt(r.crowd)} · mom ${fmt(r.mom)} · SA ${fmt(r.sa)} (${r.saN}) · rnd ${fmt(r.random)} · IC ${r.ic?.toFixed(3)} · ${r.picks.slice(0, 8).map((p) => p.t).join(' ')}`); }
fs.writeFileSync(path.join(OUT, ARG('from') ? `range_${a}_${b}.json` : `${MODE}.json`), JSON.stringify(res, null, 1));
const st = (k) => { const v = res.map((r) => r[k]).filter((x) => x != null); const m = v.reduce((p, q) => p + q, 0) / v.length, s = Math.sqrt(v.reduce((p, q) => p + (q - m) ** 2, 0) / Math.max(1, v.length - 1)); return { m, t: m / (s / Math.sqrt(v.length)), n: v.length }; };
console.log(`\n=== SMART-MONEY GRAPH v3 · ${MODE.toUpperCase()} ${a} → ${b} · top-${TOP} 6-month excess vs universe median ===`);
for (const [k, nm] of [['model', 'SKILLED-MANAGER CONSENSUS (v3)'], ['crowd', 'crowd (all managers)'], ['mom', 'momentum 12-1'], ['sa', 'copy Situational Awareness 13F'], ['random', 'random same-sector']]) { const s = st(k); console.log(`  ${nm.padEnd(34)} ${fmt(s.m).padStart(8)}  (t ${Number.isFinite(s.t) ? s.t.toFixed(2) : '-'}, n ${s.n})`); }
const ic = st('ic'); console.log(`  IC mean ${ic.m.toFixed(3)} (t ${ic.t.toFixed(2)})`);
if (MODE === 'holdout') { const m = st('model').m, sym = {}; for (const r of res) for (const p of r.picks) if (p.ex != null) (sym[p.t] ??= []).push(p.ex);
  const w = Object.values(sym).filter((v) => v.reduce((p, q) => p + q, 0) > 0).length, l = Object.values(sym).length - w;
  const pass = m > st('sa').m && m > st('crowd').m && m > st('mom').m && ic.m > 0 && ic.t >= 2 && w > l;
  console.log(`  VERDICT: ${pass ? 'PASS' : 'FAIL'} (> SA ${m > st('sa').m} · > crowd ${m > st('crowd').m} · > momentum ${m > st('mom').m} · IC t≥2 ${ic.t >= 2} · symbols W/L ${w}/${l})`); }
