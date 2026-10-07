#!/usr/bin/env node
// World model v5 (DESIGN_v5, locked 0fa4d881): reported-numbers bottleneck — revenue growth + acceleration + gross-margin expansion,
// point-in-time from SEC XBRL (filed dates). 0 Skylit credits.
//   node world/model_v5.mjs            → DEV month-ends 2023-03 → 2024-12
//   node world/model_v5.mjs --holdout  → HOLDOUT 2025-01 → 2026-03 (run once) + early flags + live list
import fs from 'node:fs';
import path from 'node:path';
import { worldUniverse } from './collect.mjs';
import { TAGS } from './facts_collect.mjs';
import { universeV2 } from './universe_prices.mjs';
import { cleanBars, inBad, gapsOf, blockedAt, crosses } from './prices_clean.mjs';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), C = path.join(ROOT, '.cache'), RES = path.join(ROOT, 'world', 'results_v5');
const HIST = process.argv.includes('--hist'), HOLD = HIST || process.argv.includes('--holdout'), WIDE = HIST || process.argv.includes('--wide');
const [A, Bm] = HIST ? ['2012-01', '2022-12'] : HOLD ? ['2025-01', '2026-03'] : ['2023-03', '2024-12']; // --hist = DESIGN_v5 addendum 2 (2012–2022, run once)
const TAG = HIST ? 'hist' : (WIDE ? 'wide_' : '') + (HOLD ? 'holdout' : 'dev'); // --wide = DESIGN_v5 addendum: all SEC operating companies with XBRL revenue
if (HOLD && fs.existsSync(path.join(RES, TAG + '.json')) && !process.argv.includes('--force')) { console.error('holdout already run'); process.exit(1); }
const rd = (f, d = null) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const ymd = (t) => new Date((t + 12 * 3600) * 1000).toISOString().slice(0, 10), addD = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
const TOP = 20, FWD = 182, DRAWS = 200;

// ---------- prices / eligibility (same rules as v1–v4) ----------
const U = WIDE ? universeV2(1e9) : worldUniverse(), P = new Map();
for (const { t } of U) { const cb = cleanBars(t, { hist: HIST }); let b = cb.bars; // clean layer: NYSE trading days only + split-quarantine windows if (!b.length) b = (rd(path.join(C, 'daily', `${t}.json`), []) || []).map((x) => ({ d: ymd(x.t), c: x.c, v: x.v }));
  if (b.length > 70) P.set(t, { d: b.map((x) => x.d), c: b.map((x) => x.c), v: b.map((x) => x.v || 0), bad: cb.bad, gaps: gapsOf(b) }); }
const META = new Map([...P.keys()].map((t) => [t, WIDE ? { sic: !!rd(path.join(C, 'edgar', 'facts', `${t}.json`), {}).rev } : rd(path.join(C, 'edgar', 'meta', `${t}.json`), null)]));
const at = (t, d) => { const p = P.get(t); let lo = 0, hi = p.d.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (p.d[m] <= d) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
// audit fix #4: a stock is not eligible on a stale price (last bar more than 7 days before the date)
const eligibleAt = (t, d) => { const p = P.get(t); if (!p || !META.get(t)?.sic) return false; const j = at(t, d); if (j < 64 || p.d[j] < addD(d, -7) || blockedAt(p.bad ?? [], p.gaps, d)) return false; let dv = 0; for (let k = Math.max(0, j - 49); k <= j; k++) dv += p.c[k] * p.v[k]; return p.c[j] >= 5 && dv / Math.min(50, j + 1) >= 2e7; };
const fwdFrom = (t, d) => { const p = P.get(t); if (!p || crosses(p.bad ?? [], p.gaps, d, addD(d, FWD))) return null; const j = at(t, d) + 1, k = at(t, addD(d, FWD)); return j > 0 && j < p.c.length && k > j && p.d[k] >= addD(d, FWD - 10) ? p.c[k] / p.c[j] - 1 : null; };
const above200 = (t, d) => { const p = P.get(t), j = at(t, d); if (j < 199) return false; let s = 0; for (let k = j - 199; k <= j; k++) s += p.c[k]; return p.c[j] > s / 200; }; // Model C (addendum 3)
const mom = (t, d) => { const p = P.get(t), i = at(t, addD(d, -365)), j = at(t, addD(d, -30)); return i >= 0 && j > i ? p.c[j] / p.c[i] - 1 : null; };

// ---------- point-in-time quarterly series from XBRL ----------
function series(facts, tags) { // end → {v, f} quarterly (80–100d), first-filed, highest-priority tag; Q4 derived from annual − 3 quarters
  const q = new Map(), ann = new Map();
  for (const tag of tags) for (const x of facts?.[tag] ?? []) { const dur = days(x.s, x.e);
    const tgt = dur >= 80 && dur <= 100 ? q : dur >= 350 && dur <= 380 ? ann : null; if (!tgt) continue;
    const cur = tgt.get(x.e); if (cur && (cur.tag !== tag ? true : cur.f <= x.f)) continue; tgt.set(x.e, { v: x.v, f: x.f, s: x.s, tag }); }
  for (const [e, a] of ann) { if ([...q.keys()].some((k) => Math.abs(days(k, e)) <= 5)) continue;
    const inside = [...q.entries()].filter(([k, x]) => days(a.s, x.s) >= -5 && days(k, e) >= 0); if (inside.length !== 3) continue;
    q.set(e, { v: a.v - inside.reduce((s, [, x]) => s + x.v, 0), f: [a.f, ...inside.map(([, x]) => x.f)].sort().at(-1) }); }
  return q; }
const Q = new Map(); // ticker → [{e, rev, gm, f}] sorted by end
for (const t of P.keys()) { const F = rd(path.join(C, 'edgar', 'facts', `${t}.json`), null); if (!F?.rev) continue;
  const rev = series(F.rev, TAGS.rev), gp = series(F.gp, TAGS.gp), cost = series(F.cost, TAGS.cost), rows = [];
  for (const [e, r] of rev) { let g = null, f = r.f; const a = gp.get(e), c = cost.get(e);
    if (a) { g = a.v / r.v; f = [f, a.f].sort().at(-1); } else if (c) { g = (r.v - c.v) / r.v; f = [f, c.f].sort().at(-1); }
    rows.push({ e, rev: r.v, gm: g, f }); }
  Q.set(t, rows.sort((x, y) => x.e.localeCompare(y.e))); }

function features(t, M) { const rows = (Q.get(t) ?? []).filter((x) => x.f <= M); if (!rows.length) return null; const q0 = rows.at(-1);
  if (days(q0.e, M) > 200 || q0.rev < 25e6) return null;
  const find = (ref, lo, hi) => rows.filter((x) => { const d = days(x.e, ref.e); return d >= lo && d <= hi; }).at(-1);
  const q1 = find(q0, 80, 100), q4 = find(q0, 345, 385); if (!q1 || !q4) return null; const q5 = find(q1, 345, 385); if (!q5) return null;
  if (!(q4.rev > 0 && q5.rev > 0) || q0.gm == null || q4.gm == null) return null;
  const g0 = q0.rev / q4.rev - 1, g1 = q1.rev / q5.rev - 1; return { g0, accel: g0 - g1, dGM: q0.gm - q4.gm, gm: q0.gm, gm4: q4.gm, qe: q0.e }; }
const pctRank = (arr) => { const s = [...arr].sort((a, b) => a - b); return (x) => { let lo = 0, hi = s.length; while (lo < hi) { const m = (lo + hi) >> 1; if (s[m] < x) lo = m + 1; else hi = m; } return lo / (s.length - 1 || 1); }; };
function rank(M) { const elig = [...P.keys()].filter((t) => eligibleAt(t, M)), F = elig.map((t) => [t, features(t, M)]).filter(([, f]) => f);
  const r = ['g0', 'accel', 'dGM'].map((k) => pctRank(F.map(([, f]) => f[k])));
  const scored = F.map(([t, f]) => ({ t, score: (r[0](f.g0) + r[1](f.accel) + r[2](f.dGM)) / 3, ...f })).sort((a, b) => b.score - a.score);
  return { elig, scored }; }

const me = (mo) => new Date(Date.UTC(+mo.slice(0, 4), +mo.slice(5, 7), 0)).toISOString().slice(0, 10);
const monthsBetween = (a, b) => { const out = []; for (let y = +a.slice(0, 4), m = +a.slice(5, 7); `${y}-${String(m).padStart(2, '0')}` <= b; m === 12 ? (y++, m = 1) : m++) out.push(`${y}-${String(m).padStart(2, '0')}`); return out; };
let seed = 777; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

// HARD RULE for any live list (user, 2026-10-06): a company whose gross margin was NEGATIVE a year ago is "losing less", not gaining
// pricing power — never recommend it. 2023–26 picks like that (EOSE, LCID, PLUG, STEM): median −14% vs the typical stock, 25% beat it.
function noRecovery(x) { return x.gm4 >= 0; }
if (process.argv.includes('--live')) { // node world/model_v5.mjs --wide --live → today's list with the hard rule applied
  const D = SPYLAST(), { scored } = rank(D), keep = scored.filter(noRecovery), dropped = scored.slice(0, TOP).filter((x) => !noRecovery(x));
  const rows = keep.slice(0, TOP).map((x) => ({ t: x.t, score: +x.score.toFixed(3), revYoY: +x.g0.toFixed(2), gm: +x.gm.toFixed(3), gmYearAgo: +x.gm4.toFixed(3), uptrend: (mom(x.t, D) ?? -1) > 0 && above200(x.t, D) }));
  console.log(`# v5 live list as of ${D} (hard rule: margin must have been positive a year ago)\n`);
  for (const r of rows) console.log(`${r.uptrend ? '✓ uptrend ' : '✗ no trend'}  ${r.t.padEnd(6)} rev ${pcF(r.revYoY)} YoY · gross margin ${pcF(r.gm)} (a year ago ${pcF(r.gmYearAgo)})`);
  console.log(`\nRemoved by the rule (were losing money per sale a year ago): ${dropped.map((x) => x.t).join(', ') || 'none'}`);
  fs.mkdirSync(path.join(ROOT, 'world', 'v5_live'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'world', 'v5_live', `${D}.json`), JSON.stringify({ asOf: D, list: rows, removed: dropped.map((x) => x.t) }, null, 1));
  process.exit(0); }
function SPYLAST() { let d = ''; for (const p of P.values()) if (p.d.at(-1) > d) d = p.d.at(-1); return d; }
const res = [], drawM = Array.from({ length: DRAWS }, () => []);
for (const mo of monthsBetween(A, Bm)) { const M = me(mo), { elig, scored } = rank(M);
  const fw = new Map(elig.map((t) => [t, fwdFrom(t, M)])), v = [...fw.values()].filter((x) => x != null).sort((a, b) => a - b), med = v[v.length >> 1];
  const ex = (ts) => { const a = ts.map((t) => fw.get(t)).filter((x) => x != null); return a.length ? a.reduce((s, x) => s + x, 0) / a.length - med : null; };
  const pa = scored.slice(0, TOP).map((x) => x.t), pb = scored.filter((x) => (mom(x.t, M) ?? -1) > 0).slice(0, TOP).map((x) => x.t);
  const pc3 = scored.filter((x) => (mom(x.t, M) ?? -1) > 0 && above200(x.t, M) && x.gm4 >= 0).slice(0, TOP).map((x) => x.t);
  const pm = elig.map((t) => [t, mom(t, M)]).filter(([, m]) => m != null).sort((a, b) => b[1] - a[1]).slice(0, TOP).map(([t]) => t);
  const pool = elig.filter((t) => fw.get(t) != null); for (const d of drawM) { const s = new Set(); while (s.size < TOP && s.size < pool.length) s.add(pool[Math.floor(rnd() * pool.length)]); d.push(ex([...s])); }
  const r = { mo, M, n: scored.length, eligN: elig.length, A: ex(pa), B: ex(pb), C: ex(pc3), mom: ex(pm), picksA: scored.slice(0, TOP).map((x) => ({ t: x.t, s: +x.score.toFixed(3), g0: +x.g0.toFixed(2), dGM: +x.dGM.toFixed(3) })), picksB: pb, picksC: pc3 };
  res.push(r); console.error(`${mo} scored ${r.n}/${r.eligN} · A ${pcF(r.A)} · B ${pcF(r.B)} · C ${pcF(r.C)} · mom ${pcF(r.mom)} · ${pa.slice(0, 8).join(' ')}`); }
function pcF(x) { return x == null ? '—' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`; }
const avg = (k) => { const a = res.map((r) => r[k]).filter((x) => x != null); return a.reduce((s, x) => s + x, 0) / a.length; };
const rdm = drawM.map((d) => { const a = d.filter((x) => x != null); return a.reduce((s, x) => s + x, 0) / a.length; }).sort((a, b) => a - b), p95 = rdm[Math.floor(DRAWS * 0.95)];
const out = [`# World model v5 — reported-numbers bottleneck · ${WIDE ? 'WIDE UNIVERSE · ' : ''}${HIST ? '2012–2022 OUT-OF-SAMPLE' : HOLD ? 'HOLDOUT' : 'DEVELOPMENT'} ${A} → ${Bm} (${res.length} month-ends)\n`,
  '| | mean 6m excess vs median | months positive |', '|---|---|---|'];
for (const [k, nm] of [['A', 'A: top 20 by growth + acceleration + margin expansion'], ['B', 'B: same, positive momentum only'], ['C', 'C: A + uptrend (momentum > 0, above 200-day) + margin was positive a year ago'], ['mom', 'momentum 12-1 top 20']]) { const a = res.map((r) => r[k]).filter((x) => x != null); out.push(`| ${nm} | **${pcF(avg(k))}** | ${a.filter((x) => x > 0).length}/${a.length} |`); }
out.push(`| random 20 (${DRAWS} draws) | median ${pcF(rdm[DRAWS >> 1])} · 95th pct ${pcF(p95)} | |`);
for (const k of ['A', 'B', 'C']) { const a = res.map((r) => r[k]).filter((x) => x != null), pos = a.filter((x) => x > 0).length / a.length, m = avg(k);
  const c = [m > avg('mom'), m > p95, pos >= 0.6, ...(k === 'C' ? [m > avg('A')] : [])]; out.push(`\n**${k} pass${HOLD ? '' : ' (informational on dev)'}:** beats momentum ${c[0] ? 'PASS' : 'FAIL'} · beats random 95th ${c[1] ? 'PASS' : 'FAIL'} · ≥60% months positive ${c[2] ? 'PASS' : 'FAIL'}${k === 'C' ? ` · beats A ${c[3] ? 'PASS' : 'FAIL'}` : ''} → **${c.every(Boolean) ? 'PASS' : 'FAIL'}**`); }
out.push('\n| month | A excess | B excess | momentum | A top 8 |\n|---|---|---|---|---|'); for (const r of res) out.push(`| ${r.mo} | ${pcF(r.A)} | ${pcF(r.B)} | ${pcF(r.mom)} | ${r.picksA.slice(0, 8).map((x) => x.t).join(' ')} |`);
if (HOLD && !HIST) { // early flags across all months 2023-03 → 2026-09 (ranks only), and the live list
  const W = ['MU', 'SNDK', 'WDC', 'STX', 'IREN', 'LITE', 'CLS', 'VRT', 'NVDA', 'APP', 'PLTR', 'CORZ', 'COHR'], first = {};
  for (const mo of monthsBetween('2023-03', '2026-09')) { const { scored } = rank(me(mo)); scored.forEach((x, i) => { for (const [n, lim] of [['top20', 20], ['top50', 50]]) if (i < lim && W.includes(x.t)) (first[x.t] ??= {})[n] ??= mo; }); }
  out.push('\n**Early flags (first month in top 20 / top 50):** ' + W.map((t) => `${t} ${first[t]?.top20 ?? 'never'} / ${first[t]?.top50 ?? 'never'}`).join(' · '));
  const L = rank(me('2026-09')).scored.filter(noRecovery), live = L.slice(0, TOP), liveB = L.filter((x) => (mom(x.t, me('2026-09')) ?? -1) > 0).slice(0, TOP);
  out.push('\n## Live list (2026-09-30)\n**A:** ' + live.map((x) => `${x.t} (rev ${pcF(x.g0)} YoY, GM ${pcF(x.dGM)} pts)`).join(' · ') + '\n\n**B (positive momentum):** ' + liveB.map((x) => x.t).join(' · '));
  fs.mkdirSync(path.join(ROOT, 'world', 'v5_live'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'world', 'v5_live', (WIDE ? 'wide_' : '') + '2026-09.json'), JSON.stringify({ A: live, B: liveB }, null, 1)); }
const txt = out.join('\n'); console.log(txt); fs.mkdirSync(RES, { recursive: true });
fs.writeFileSync(path.join(RES, TAG + '.json'), JSON.stringify(res, null, 1)); fs.writeFileSync(path.join(RES, TAG + '.txt'), txt + '\n');
