#!/usr/bin/env node
// Multi-engine mover catcher (DESIGN_engines.md + amendments). One harness judges every engine the same way:
// movers caught early (top-50 yearly gainers flagged before half their move), precision (6-month excess of everything flagged),
// list size. Settings chosen on 2015–2022 with data truncated at 2022-12-31; then frozen and run once on 2025–2026.
//   node --max-old-space-size=16000 world/engines.mjs            (--smoke: build years only, no report; --force re-run)
import fs from 'node:fs';
import path from 'node:path';
import { TAGS } from './facts_collect.mjs';
import { TAGS2 } from './facts2_collect.mjs';
import { universeV2 } from './universe_prices.mjs';
import { sicToBea } from './sic_bea.mjs';
import { cleanBars, inBad } from './prices_clean.mjs';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), C = path.join(ROOT, '.cache'), RES = path.join(ROOT, 'world', 'results_engines');
const SMOKE = process.argv.includes('--smoke'), DIAG = process.argv.includes('--diag'); // --diag: per-engine coverage + sample flags (no scoring)
if (!SMOKE && fs.existsSync(path.join(RES, 'engines.txt')) && !process.argv.includes('--force')) { console.error('already run — see world/results_engines/engines.txt'); process.exit(1); }
const rd = (f, d = null) => { try { return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d; } catch { return d; } };
const addD = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10), days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length, med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
const FWD = 182, FUNDS = new Set(['6221', '6722', '6726', '6798x']); // commodity trusts / funds are not "stocks that moved"

// ---------- static data ----------
const U = universeV2(1e9), CIK = new Map(U.map((x) => [x.t, x.cik]));
const SIC = new Map(); for (const f of fs.readdirSync(path.join(C, 'edgar', 'sic'))) { const j = rd(path.join(C, 'edgar', 'sic', f)); if (j?.sic) SIC.set(f.replace('.json', ''), { s4: String(j.sic).padStart(4, '0'), desc: j.desc }); }
const sic3 = (t) => SIC.get(t)?.s4.slice(0, 3), isFund = (t) => FUNDS.has(SIC.get(t)?.s4);
const finEx = (t) => { const s = SIC.get(t)?.s4 ?? ''; return (s >= '6000' && s < '6500') || s === '6282' || s === '6798'; }; // amendment 4: E0b skips banks/insurers/asset managers/REITs (keeps 6199)
function series(facts, tags, keepUnit = false) { const q = new Map(), ann = new Map();
  for (const tag of tags) for (const x of facts?.[tag] ?? []) { if (!x.s) continue; const dur = days(x.s, x.e), tgt = dur >= 80 && dur <= 100 ? q : dur >= 170 && dur <= 190 && keepUnit ? q : dur >= 350 && dur <= 380 ? ann : null; if (!tgt) continue;
    const cur = tgt.get(x.e); if (cur && (cur.tag !== tag ? true : cur.f <= x.f)) continue; tgt.set(x.e, { v: x.v, f: x.f, s: x.s, tag, dur, unit: x.unit }); }
  for (const [e, a] of ann) { if ([...q.keys()].some((k) => Math.abs(days(k, e)) <= 5)) continue; const inside = [...q.entries()].filter(([k, x]) => x.dur <= 100 && days(a.s, x.s) >= -5 && days(k, e) >= 0); if (inside.length !== 3) { if (keepUnit) q.set(e, { ...a }); continue; }
    q.set(e, { v: a.v - inside.reduce((s, [, x]) => s + x.v, 0), f: [a.f, ...inside.map(([, x]) => x.f)].sort().at(-1), s: inside.at(-1)?.[0], dur: 91 }); }
  return q; }
const RAWQ = new Map(), RAWQ0 = new Map(); // with / without gross margin
for (const { t } of U) { const F = rd(path.join(C, 'edgar', 'facts', `${t}.json`), null); if (!F?.rev) continue; const rev = series(F.rev, TAGS.rev), gp = series(F.gp, TAGS.gp), cost = series(F.cost, TAGS.cost), rows = [];
  for (const [e, r] of rev) { let g = null, f = r.f; const a = gp.get(e), c = cost.get(e); if (a) { g = a.v / r.v; f = [f, a.f].sort().at(-1); } else if (c) { g = (r.v - c.v) / r.v; f = [f, c.f].sort().at(-1); } rows.push({ e, rev: r.v, gm: g, f, frev: r.f }); }
  RAWQ.set(t, rows.sort((x, y) => x.e.localeCompare(y.e))); }
const OPQ = new Map(), NIQ = new Map(), SHR = new Map(), BACK = new Map();
for (const t of RAWQ.keys()) { const G = rd(path.join(C, 'edgar', 'facts2', `${t}.json`), {}), H = rd(path.join(C, 'edgar', 'facts3', `${t}.json`), {});
  if (G.opinc) OPQ.set(t, [...series(G.opinc, TAGS2.opinc)].map(([e, x]) => ({ e, v: x.v, f: x.f })).sort((a, b) => a.e.localeCompare(b.e)));
  if (H.ni) NIQ.set(t, [...series(H.ni, ['NetIncomeLoss', 'ProfitLoss'])].map(([e, x]) => ({ e, v: x.v, f: x.f })).sort((a, b) => a.e.localeCompare(b.e)));
  if (H.sh) { const a = []; for (const tag of ['EntityCommonStockSharesOutstanding', 'CommonStockSharesOutstanding']) for (const x of H.sh[tag] ?? []) a.push({ d: x.f, v: x.v }); if (a.length) SHR.set(t, a.sort((x, y) => x.d.localeCompare(y.d))); }
  const b = []; for (const [k, tags] of [['rpo', TAGS2.rpo], ['defrev', TAGS2.defrev]]) for (const tag of tags) for (const x of G[k]?.[tag] ?? []) b.push({ k, e: x.e, v: x.v, f: x.f }); if (b.length) BACK.set(t, b); }
const IFRS = new Map(); for (const f of fs.existsSync(path.join(C, 'edgar', 'facts_ifrs')) ? fs.readdirSync(path.join(C, 'edgar', 'facts_ifrs')) : []) { const F = rd(path.join(C, 'edgar', 'facts_ifrs', f)); if (!F?.rev) continue;
  const rev = series(F.rev, Object.keys(F.rev), true), gp = series(F.gp ?? {}, Object.keys(F.gp ?? {}), true), rows = [];
  for (const [e, r] of rev) { const a = gp.get(e); rows.push({ e, rev: r.v, dur: r.dur, gm: a && a.dur === r.dur ? a.v / r.v : null, f: a ? [r.f, a.f].sort().at(-1) : r.f }); } IFRS.set(f.replace('.json', ''), rows.sort((x, y) => x.e.localeCompare(y.e))); }
const INS = new Map(); for (const line of fs.readFileSync(path.join(C, 'insider_bulk', 'purchases.jsonl'), 'utf8').split('\n')) { if (!line) continue; const r = JSON.parse(line);
  if (!r.ticker || !r.filed || !r.tradeDate || r.tradeDate < '2014-01-01' || r.tradeDate > r.filed) continue; const a = INS.get(r.ticker) ?? []; a.push({ f: r.filed, d: r.tradeDate, o: r.ownerCik ?? r.owner, v: Math.min(r.value ?? 0, 5e7) }); INS.set(r.ticker, a); }
const SPIN = rd(path.join(C, 'edgar', 'spinoffs.json'), {});
const EXPO = [...(rd(path.join(C, 'edgar', 'exposure_hist.json'), []) || []), ...(rd(path.join(C, 'edgar', 'exposure.json'), []) || [])];
const CONCEPT = new Map(); for (const x of EXPO) { if (!x.t || !x.c || !x.d) continue; const a = CONCEPT.get(x.c) ?? new Map(); if (!a.has(x.t) || x.d < a.get(x.t)) a.set(x.t, x.d); CONCEPT.set(x.c, a); }
const COMM = Object.fromEntries(['GLD', 'SLV', 'CPER', 'URA', 'USO', 'UNG', 'LIT', 'REMX'].map((t) => [t, rd(path.join(C, 'commodity', `${t}.json`), [])]));
const BTC = (rd(path.join(C, 'graph', 'fred.json'), {})?.CBBTCUSD?.obs ?? []).map((o) => ({ d: o.d, c: o.v }));
const GROUPS = { GLD: { s4: ['1040'], c: [] }, SLV: { s4: ['1040', '1090'], c: [] }, CPER: { s4: ['1000', '3330', '3331'], c: [] }, URA: { s4: ['1090', '1094'], c: ['uranium', 'small modular reactor'] }, // amendment 4: SIC producers only, concepts only where no SIC home
  USO: { s4: ['1311', '1381', '1389', '2911'], c: [] }, UNG: { s4: ['1311', '4922', '4923', '4924'], c: [] }, LIT: { s4: ['2819'], c: ['lithium'] }, REMX: { s4: [], c: ['rare earth'] }, BTC: { s4: [], c: ['bitcoin mining', 'hashrate'] } };
const WIKI = (t) => rd(path.join(C, 'wiki', 'views', `${t}.json`), null);
const USE = rd(path.join(C, 'bea', 'use_summary.json'), {});
const SP_BAR = { 2014: 5.3e9, 2015: 5.3e9, 2016: 5.3e9, 2017: 6.1e9, 2018: 6.1e9, 2019: 8.2e9, 2020: 8.2e9, 2021: 13.1e9, 2022: 14.6e9, 2023: 15.8e9, 2024: 18e9, 2025: 22.7e9, 2026: 22.7e9 }; // S&P 500 minimum market cap rule by year (as published)

// ---------- prices (optionally truncated) ----------
function loadPrices(cut) { const P = new Map();
  for (const { t } of U) { if (isFund(t)) continue; const cb = cleanBars(t); let b = cb.bars; if (cut) b = b.filter((x) => x.d <= cut); if (b.length < 70) continue;
    const c = b.map((x) => x.c), v = b.map((x) => x.v || 0), obv = new Array(b.length).fill(0); for (let i = 1; i < b.length; i++) obv[i] = obv[i - 1] + (c[i] > c[i - 1] ? v[i] : c[i] < c[i - 1] ? -v[i] : 0);
    P.set(t, { d: b.map((x) => x.d), c, v, obv, bad: cb.bad }); } return P; }
const idx = (p, d) => { let lo = 0, hi = p.d.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (p.d[m] <= d) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
const ser = (a, d) => { if (!a?.length) return null; let lo = 0, hi = a.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m].d <= d) { r = m; lo = m + 1; } else hi = m - 1; } return r >= 0 ? a[r].c : null; };

// ---------- per-month state ----------
function month(P, M) {
  const elig = [], px = new Map();
  for (const [t, p] of P) { const j = idx(p, M); if (j < 64 || p.d[j] < addD(M, -7) || inBad(p.bad, M)) continue; let dv = 0; for (let k = j - 49; k <= j; k++) dv += p.c[k] * p.v[k]; if (!(p.c[j] >= 5 && dv / 50 >= 2e7)) continue; elig.push(t);
    const c = (k) => p.c[Math.max(0, k)]; let hi = 0, obvHi = -Infinity, up = 0, dn = 0, ma = 0; for (let k = Math.max(0, j - 251); k < j; k++) hi = Math.max(hi, p.c[k]);
    for (let k = Math.max(0, j - 125); k < j; k++) obvHi = Math.max(obvHi, p.obv[k]); for (let k = j - 49; k <= j; k++) { if (p.c[k] > p.c[k - 1]) up += p.v[k]; else if (p.c[k] < p.c[k - 1]) dn += p.v[k]; ma += p.c[k]; }
    px.set(t, { j, c: p.c[j], r3: c(j) / c(j - 63) - 1, r6: c(j) / c(j - 126) - 1, r12: j >= 252 ? c(j - 21) / c(j - 252) - 1 : null, hi52: hi, newHigh: p.c[j] >= hi, offHi: p.c[j] / Math.max(hi, p.c[j]) - 1, obvNewHi: p.obv[j] >= obvHi, udv: dn > 0 ? up / dn : 9, aboveMA50: p.c[j] > ma / 50, dv: dv / 50, firstDay: p.d[0] }); }
  const fwd = (t) => { const p = P.get(t), j = idx(p, M) + 1, k = idx(p, addD(M, FWD)); return j > 0 && j < p.c.length && k > j && p.d[k] >= addD(M, FWD - 10) ? p.c[k] / p.c[j] - 1 : null; };
  // v5 features (E0 / E0b / E4)
  const F = new Map(), F0 = new Map();
  for (const t of elig) { const rows = (RAWQ.get(t) ?? []).filter((x) => x.frev <= M), q0 = rows.at(-1); if (!q0 || days(q0.e, M) > 200 || q0.rev < 25e6) continue;
    const find = (ref, lo, hi) => ref && rows.filter((x) => { const d = days(x.e, ref.e); return d >= lo && d <= hi; }).at(-1);
    const q1 = find(q0, 80, 100), q4 = find(q0, 345, 385), q5 = find(q1, 345, 385); if (!q1 || !q4 || !q5 || !(q4.rev > 0 && q5.rev > 0)) continue;
    const g0 = q0.rev / q4.rev - 1, g1 = q1.rev / q5.rev - 1, gmOK = q0.gm != null && q4.gm != null && q0.f <= M && q4.f <= M;
    if (gmOK) F.set(t, { g0, g1, accel: g0 - g1, dGM: q0.gm - q4.gm, gm: q0.gm, gm4: q4.gm, rev: q0.rev, e: q0.e }); else if (!rows.some((x) => x.gm != null) && !finEx(t)) F0.set(t, { g0, accel: g0 - g1, rev: q0.rev }); }
  const rankBy = (Mp, keys) => { const R = keys.map((k) => { const s = [...Mp.values()].map((f) => f[k]).sort((a, b) => a - b); return (v) => { let lo = 0, hi = s.length; while (lo < hi) { const m = (lo + hi) >> 1; if (s[m] < v) lo = m + 1; else hi = m; } return lo / (s.length - 1 || 1); }; });
    return [...Mp].map(([t, f]) => ({ t, f, s: mean(R.map((r, i) => r(f[keys[i]]))) })).sort((a, b) => b.s - a.s); };
  const e0 = rankBy(F, ['g0', 'accel', 'dGM']).filter((x) => x.f.gm4 >= 0), e0b = F0.size ? rankBy(F0, ['g0', 'accel']) : [];
  return { M, elig, px, fwd, F, e0, e0b }; }

// ---------- engines: each returns [{t, why}] for a month and a setting ----------
const pct = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%`;
const top = (arr, n, why) => arr.slice(0, n).map((x) => ({ t: x.t, why: why(x) }));
const byMom = (m, ts, n) => ts.filter((t) => m.px.has(t)).sort((a, b) => m.px.get(b).r3 - m.px.get(a).r3).slice(0, n);
const indBea = (s3) => new Set([...SIC].filter(([, x]) => x.s4.startsWith(s3)).map(([, x]) => sicToBea(x.s4)).filter(Boolean));
const beaLinked = (a, b, yr) => { const Ut = USE[String(Math.min(Math.max(+yr - 2, 1997), 2023))]; if (!Ut) return false; for (const x of a) for (const y of b) { if (x === y) return true; const o = Ut.use[x]?.[y] ?? 0, i = Ut.use[y]?.[x] ?? 0; if ((Ut.rowTotal[x] && o / Ut.rowTotal[x] >= 0.02) || (Ut.inter[x] && i / Ut.inter[x] >= 0.02)) return true; } return false; };
const IND3 = new Map(); for (const [t, x] of SIC) { const a = IND3.get(x.s4.slice(0, 3)) ?? []; a.push(t); IND3.set(x.s4.slice(0, 3), a); }
const BEA3 = new Map([...IND3.keys()].map((s) => [s, indBea(s)]));
const ENGINES = {
  E0: { budget: 60, grid: [{ n: 20 }, { n: 40 }, { n: 60 }], run: (m, p) => top(m.e0, p.n, (x) => `bottleneck: revenue ${pct(x.f.g0)} YoY, growth ${x.f.accel >= 0 ? '+' : ''}${(x.f.accel * 100).toFixed(0)} pts, gross margin ${(x.f.gm * 100).toFixed(0)}% vs ${(x.f.gm4 * 100).toFixed(0)}% a year ago`) },
  E0b: { budget: 20, grid: [{ n: 10 }, { n: 20 }], run: (m, p) => top(m.e0b, p.n, (x) => `revenue-only bottleneck: revenue ${pct(x.f.g0)} YoY, growth ${x.f.accel >= 0 ? '+' : ''}${(x.f.accel * 100).toFixed(0)} pts`) },
  E1: { budget: 40, grid: [{ k: 2, n: 3 }, { k: 2, n: 5 }, { k: 3, n: 3 }, { k: 3, n: 5 }], run: (m, p) => { const lead = m.e0.slice(0, 60).map((x) => x.t), leadSet = new Set(lead), out = [], yr = m.M.slice(0, 4);
    const cnt = new Map(); for (const t of lead) { const s = sic3(t); if (s) cnt.set(s, (cnt.get(s) ?? 0) + 1); } const lit = [...cnt].filter(([, n]) => n >= p.k).map(([s]) => s);
    const litLinked = new Set(lit); for (const s of IND3.keys()) if (!litLinked.has(s) && (cnt.get(s) ?? 0) >= 1 && lit.some((l) => beaLinked(BEA3.get(l), BEA3.get(s), yr))) litLinked.add(s); // amendment 4
    const litC = []; for (const [c, mp] of CONCEPT) { let n = 0; for (const t of lead) if (mp.has(t) && mp.get(t) <= m.M && mp.get(t) >= addD(m.M, -730)) n++; if (n >= p.k) litC.push(c); }
    for (const s of litLinked) { const mem = (IND3.get(s) ?? []).filter((t) => !leadSet.has(t)); for (const t of byMom(m, mem, p.n)) out.push({ t, why: `theme spread: industry "${SIC.get(t)?.desc}" is ${lit.includes(s) ? 'lit' : 'linked to a lit industry'} (${cnt.get(s) ?? 0} bottleneck leaders); 3-month momentum ${pct(m.px.get(t).r3)}` }); }
    for (const c of litC) { const mem = [...CONCEPT.get(c)].filter(([t, d]) => d <= m.M && !leadSet.has(t)).map(([t]) => t); for (const t of byMom(m, mem, p.n)) out.push({ t, why: `theme spread: concept "${c}" is lit (≥${p.k} bottleneck leaders mention it); 3-month momentum ${pct(m.px.get(t).r3)}` }); }
    const seen = new Set(); return out.filter((x) => !seen.has(x.t) && seen.add(x.t)).sort((a, b) => m.px.get(b.t).r3 - m.px.get(a.t).r3).slice(0, 40); } },
  E2a: { budget: 20, grid: [{ n: 10 }, { n: 20 }], run: (m, p) => { const S = [];
    for (const [t, rows0] of IFRS) { if (!m.px.has(t)) continue; const rows = rows0.filter((x) => x.f <= m.M), q0 = rows.at(-1); if (!q0 || days(q0.e, m.M) > 400) continue;
      const bk = (x) => (x.dur < 120 ? 'Q' : x.dur < 250 ? 'H' : 'Y'), same = (x) => bk(x) === bk(q0); // period-length bucket (181 vs 184 days must match)
      const prevY = rows.filter((x) => same(x) && days(x.e, q0.e) >= 345 && days(x.e, q0.e) <= 385).at(-1); if (!prevY || !(prevY.rev > 0)) continue;
      const prev = rows.filter((x) => same(x) && x.e < q0.e).at(-1), prevPY = prev && rows.filter((x) => same(x) && days(x.e, prev.e) >= 345 && days(x.e, prev.e) <= 385).at(-1);
      const g0 = q0.rev / prevY.rev - 1, g1 = prevPY?.rev > 0 ? prev.rev / prevPY.rev - 1 : g0, dGM = q0.gm != null && prevY.gm != null ? q0.gm - prevY.gm : 0; S.push({ t, f: { g0, accel: g0 - g1, dGM } }); }
    const R = ['g0', 'accel', 'dGM'].map((k) => { const s = S.map((x) => x.f[k]).sort((a, b) => a - b); return (v) => s.findIndex((y) => y >= v) / (s.length - 1 || 1); });
    return S.map((x) => ({ ...x, s: mean(R.map((r, i) => r(x.f[['g0', 'accel', 'dGM'][i]]))) })).sort((a, b) => b.s - a.s).slice(0, p.n).map((x) => ({ t: x.t, why: `foreign filer bottleneck: revenue ${pct(x.f.g0)} YoY (IFRS)` })); } },
  E2b: { budget: 20, grid: [{ th: 0.15, n: 5 }, { th: 0.15, n: 10 }, { th: 0.25, n: 5 }, { th: 0.25, n: 10 }], run: (m, p) => { const out = [];
    for (const [k, g] of Object.entries(GROUPS)) { const a = k === 'BTC' ? BTC : COMM[k]; const c0 = ser(a, m.M), c6 = ser(a, addD(m.M, -182)); if (!c0 || !c6 || c0 / c6 - 1 < p.th) continue;
      const mem = new Set([...m.px.keys()].filter((t) => g.s4.includes(SIC.get(t)?.s4))); for (const c of g.c) for (const [t, d] of CONCEPT.get(c) ?? []) if (d <= m.M && d >= addD(m.M, -730) && m.px.has(t)) mem.add(t);
      for (const t of byMom(m, [...mem], p.n)) out.push({ t, why: `commodity/crypto: ${k === 'BTC' ? 'bitcoin' : k} up ${pct(c0 / c6 - 1)} in 6 months; producer with 3-month momentum ${pct(m.px.get(t).r3)}` }); }
    const seen = new Set(); return out.filter((x) => !seen.has(x.t) && seen.add(x.t)); } },
  // E3 (amendment 4): the year-earlier backlog value must be ≥ $50M
  E3: { budget: 20, grid: [{ th: 0.2, n: 10 }, { th: 0.2, n: 20 }, { th: 0.4, n: 10 }, { th: 0.4, n: 20 }], run: (m, p) => { const S = [];
    for (const t of m.elig) { const b = BACK.get(t), f = m.F.get(t) ?? null; if (!b || !f || f.g0 < 0.1) continue; for (const k of ['rpo', 'defrev']) { const a = b.filter((x) => x.k === k && x.f <= m.M).sort((x, y) => x.e.localeCompare(y.e)); const q0 = a.at(-1); if (!q0 || days(q0.e, m.M) > 200) continue;
      const py = a.filter((x) => days(x.e, q0.e) >= 345 && days(x.e, q0.e) <= 385).at(-1), q1 = a.filter((x) => days(x.e, q0.e) >= 80 && days(x.e, q0.e) <= 100).at(-1), py1 = q1 && a.filter((x) => days(x.e, q1.e) >= 345 && days(x.e, q1.e) <= 385).at(-1);
      if (!(py?.v >= 5e7) || !(py1?.v > 0)) continue; const g = q0.v / py.v - 1, gp = q1.v / py1.v - 1; if (g >= p.th && g > gp) { S.push({ t, g, k, rg: f.g0 }); break; } } }
    return S.sort((a, b) => b.g - a.g).slice(0, p.n).map((x) => ({ t: x.t, why: `backlog: ${x.k === 'rpo' ? 'order backlog (RPO)' : 'deferred revenue'} ${pct(x.g)} YoY and accelerating; revenue ${pct(x.rg)}` })); } },
  E4: { budget: 10, grid: [{ gm: 0.1, g: 0.5 }, { gm: 0.1, g: 1 }, { gm: 0.2, g: 0.5 }, { gm: 0.2, g: 1 }], run: (m, p) => [...m.F].filter(([, f]) => f.gm4 < 0 && f.gm >= p.gm && f.g0 >= p.g).sort((a, b) => b[1].g0 - a[1].g0).slice(0, 10)
    .map(([t, f]) => ({ t, why: `real turnaround: gross margin ${(f.gm4 * 100).toFixed(0)}% → ${(f.gm * 100).toFixed(0)}%, revenue ${pct(f.g0)}` })) },
  E5: { budget: 20, grid: [{ k: 2 }, { k: 3 }], run: (m, p) => { const S = [];
    for (const t of m.elig) { const a = INS.get(t); if (!a) continue; const w = a.filter((x) => x.f <= m.M && x.d >= addD(m.M, -30)); if (!w.length) continue; const own = new Set(w.map((x) => x.o)), v = w.reduce((s, x) => s + x.v, 0); if (own.size >= p.k && v >= 1e5) S.push({ t, n: own.size, v }); }
    return S.sort((a, b) => b.v - a.v).slice(0, 20).map((x) => ({ t: x.t, why: `insider cluster: ${x.n} insiders bought $${(x.v / 1e6).toFixed(1)}M in 30 days` })); } },
  E7: { budget: 40, grid: [{ q: 0.02 }, { q: 0.05 }], run: (m, p) => { const r6 = m.elig.map((t) => m.px.get(t).r6).sort((a, b) => b - a), cut = r6[Math.floor(r6.length * p.q)];
    return m.elig.filter((t) => m.px.get(t).newHigh && m.px.get(t).r6 >= cut).sort((a, b) => m.px.get(b).r6 - m.px.get(a).r6).slice(0, 40).map((t) => ({ t, why: `relative strength: 52-week high, 6-month ${pct(m.px.get(t).r6)}` })); } },
  E8: { budget: 20, grid: [{ neg: 2, g: 0.15 }, { neg: 2, g: 0.3 }, { neg: 4, g: 0.15 }, { neg: 4, g: 0.3 }], run: (m, p) => { const S = [];
    for (const t of m.elig) { const a = (OPQ.get(t) ?? []).filter((x) => x.f <= m.M); const q0 = a.at(-1); if (!q0 || q0.v <= 0 || days(q0.e, m.M) > 200) continue; const prior = a.slice(-5, -1); if (prior.length < 4) continue;
      const neg = prior.filter((x) => x.v < 0).length, g = (m.F.get(t) ?? null)?.g0 ?? null; if (neg >= p.neg && g != null && g >= p.g) S.push({ t, neg, g }); }
    return S.sort((a, b) => b.g - a.g).slice(0, 20).map((x) => ({ t: x.t, why: `profitability turn: first operating profit after ${x.neg} loss quarters of the prior 4; revenue ${pct(x.g)}` })); } },
  E9: { budget: 20, grid: [{ mult: 1 }, { mult: 1.25 }], run: (m, p) => { const S = [], bar = SP_BAR[+m.M.slice(0, 4)] * p.mult;
    for (const t of m.elig) { const sh = ser((SHR.get(t) ?? []).map((x) => ({ d: x.d, c: x.v })), m.M), q = m.px.get(t); if (!sh || !q) continue; const pp = P_.get(t), j3 = idx(pp, addD(m.M, -91)); if (j3 < 0) continue;
      const cap = sh * q.c, cap3 = sh * pp.c[j3]; if (!(cap >= bar && cap3 < bar)) continue; const ni = (NIQ.get(t) ?? []).filter((x) => x.f <= m.M).slice(-4); if (ni.length < 4 || ni.at(-1).v <= 0 || ni.reduce((s, x) => s + x.v, 0) <= 0) continue; S.push({ t, cap }); }
    return S.sort((a, b) => a.cap - b.cap).slice(0, 20).map((x) => ({ t: x.t, why: `index candidate: market cap crossed $${(bar / 1e9).toFixed(1)}B (S&P 500 bar) with 4 profitable quarters` })); } },
  E10: { budget: 20, grid: [{ lo: 3, hi: 6, spin: true }, { lo: 6, hi: 12, spin: true }, { lo: 3, hi: 6, spin: false }, { lo: 6, hi: 12, spin: false }], run: (m, p) => {
    const cand = m.elig.filter((t) => { const fd = m.px.get(t).firstDay; if (fd <= '2010-02-01') return false; const age = days(fd, m.M) / 30.4; return age >= p.lo && age < p.hi && (!p.spin || (SPIN[t] && SPIN[t].firstForm10 <= m.M)); });
    const r3 = cand.map((t) => m.px.get(t).r3).sort((a, b) => a - b), mid = r3[r3.length >> 1];
    return cand.filter((t) => m.px.get(t).r3 >= mid).sort((a, b) => m.px.get(b).r3 - m.px.get(a).r3).slice(0, 20).map((t) => ({ t, why: `${p.spin ? 'spin-off' : 'new listing'}: trading ${Math.round(days(m.px.get(t).firstDay, m.M) / 30.4)} months, 3-month momentum ${pct(m.px.get(t).r3)}` })); } },
  E11: { budget: 40, grid: [{ off: 0.1, ud: 1.3 }, { off: 0.1, ud: 1.6 }, { off: 0.2, ud: 1.3 }, { off: 0.2, ud: 1.6 }], run: (m, p) => m.elig.filter((t) => { const x = m.px.get(t); return x.obvNewHi && x.offHi <= -p.off && x.udv >= p.ud; })
    .sort((a, b) => m.px.get(b).udv - m.px.get(a).udv).slice(0, 40).map((t) => ({ t, why: `quiet accumulation: volume on-balance at 6-month high while price ${pct(m.px.get(t).offHi)} from its high; up/down volume ${m.px.get(t).udv.toFixed(1)}×` })) },
  E12: { budget: 30, grid: [{ x: 3 }, { x: 5 }], run: (m, p) => { const S = [];
    for (const t of m.elig) { const w = WCACHE.get(t) ?? (WCACHE.set(t, WIKI(t)), WCACHE.get(t)); if (!w?.length || !m.px.get(t).aboveMA50) continue; const key = m.M.replaceAll('-', ''), j = w.findLastIndex((x) => String(x[0]) <= key); if (j < 210) continue;
      const v30 = w.slice(j - 29, j + 1).reduce((s, x) => s + x[1], 0), base = w.slice(j - 209, j - 29).reduce((s, x) => s + x[1], 0) / 180 * 30; if (base > 300 && v30 >= p.x * base) S.push({ t, r: v30 / base }); }
    return S.sort((a, b) => b.r - a.r).slice(0, 30).map((x) => ({ t: x.t, why: `attention surge: Wikipedia views ${x.r.toFixed(1)}× normal, price above 50-day average` })); } },
};
const WCACHE = new Map(); let P_ = null;

// ---------- evaluation ----------
const calME = (a, b) => { const o = []; for (let y = +a.slice(0, 4), mm = +a.slice(5, 7); `${y}-${String(mm).padStart(2, '0')}` <= b; mm === 12 ? (y++, mm = 1) : mm++) o.push(new Date(Date.UTC(y, mm, 0)).toISOString().slice(0, 10)); return o; };
function build(P, a, b) { P_ = P; const out = new Map(); for (const M of calME(a, b)) { out.set(M, month(P, M)); } return out; }
function moversOf(P, MS, Y, endOverride) { const a = `${Y - 1}-12-31`, b = endOverride ?? `${Y}-12-31`, m0 = MS.get(a); if (!m0) return [];
  return m0.elig.map((t) => { const p = P.get(t), i0 = idx(p, a), i1 = idx(p, b); return [t, i0 >= 0 && i1 > i0 && p.d[i1] >= addD(b, -7) ? p.c[i1] / p.c[i0] - 1 : null]; }).filter(([, r]) => r != null).sort((x, y) => y[1] - x[1]).slice(0, 50); }
function evaluate(P, MS, flagsBy, years, endOverride) { const res = { early: 0, any: 0, n: 0, perYear: {}, detail: {} };
  for (const Y of years) { const mv = moversOf(P, MS, Y, Y === 2026 ? endOverride : null), start = `${Y - 1}-12-31`, end = Y === 2026 && endOverride ? endOverride : `${Y}-12-31`; let e = 0, an = 0; res.detail[Y] = [];
    for (const [t, r] of mv) { const p = P.get(t), p0 = p.c[idx(p, start)], p1 = p.c[idx(p, end)]; let first = null;
      for (const M of [...MS.keys()].filter((M) => M >= addD(start, -184) && M <= end)) { const f = flagsBy.get(M)?.get(t); if (f) { const share = M <= start ? 0 : (p.c[idx(p, M)] / p0 - 1) / (p1 / p0 - 1); first = { M, share, why: f }; break; } }
      if (first) an++; if (first && first.share <= 0.5) e++; res.detail[Y].push({ t, r, first }); }
    res.perYear[Y] = { early: e, any: an, n: mv.length }; res.early += e; res.any += an; res.n += mv.length; }
  return res; }
function precision(MS, flagsBy, a, b) { const ex = [], sizes = []; for (const [M, m] of MS) { if (M < a || M > b) continue; const fl = flagsBy.get(M); if (!fl) continue; sizes.push(fl.size); if (!fl.size) continue;
    const all = m.elig.map(m.fwd).filter((x) => x != null), md = med(all), r = [...fl.keys()].map(m.fwd).filter((x) => x != null); if (r.length && md != null) ex.push(mean(r) - md); }
  return { ex: ex.length ? mean(ex) : null, size: sizes.length ? mean(sizes) : 0 }; }
let rseed = 7; const rnd = () => ((rseed = (rseed * 1103515245 + 12345) % 2147483648) / 2147483648);
// amendment 3: random lists of the same size each month, scored with the same recall rule
function randomBase(P, MS, flagsBy, years, endOverride, draws = 30) { const r = [];
  for (let k = 0; k < draws; k++) { const fake = new Map([...flagsBy].map(([M, fl]) => { const el = MS.get(M)?.elig ?? [], n = Math.min(fl.size, el.length), pick = new Map(); while (pick.size < n) pick.set(el[Math.floor(rnd() * el.length)], 'random'); return [M, pick]; }));
    r.push(evaluate(P, MS, fake, years, endOverride)); }
  const per = (Y) => { const v = r.map((x) => x.perYear[Y]?.early ?? 0).sort((a, b) => a - b); return { mean: mean(v), p95: v[Math.min(v.length - 1, Math.floor(v.length * 0.95))] }; };
  const tot = r.map((x) => x.early).sort((a, b) => a - b); return { mean: mean(tot), p95: tot[Math.min(tot.length - 1, Math.floor(tot.length * 0.95))], per }; }
const runEngine = (MS, E, p) => new Map([...MS].map(([M, m]) => [M, new Map(ENGINES[E].run(m, p).map((x) => [x.t, `${E}: ${x.why}`]))]));

if (DIAG) { const Pd = loadPrices(null); P_ = Pd; console.log(`data coverage: priced ${Pd.size} · SIC ${SIC.size} · revenue facts ${RAWQ.size} · op income ${OPQ.size} · net income ${NIQ.size} · shares ${SHR.size} · backlog ${BACK.size} · IFRS ${IFRS.size} · insider tickers ${INS.size} · spin-offs ${Object.keys(SPIN).length} · concepts ${CONCEPT.size} (${EXPO.length} rows) · wiki ${fs.readdirSync(path.join(C, 'wiki', 'views')).length} · commodities ${Object.values(COMM).filter((a) => a.length).length}/8 · bitcoin ${BTC.length}`);
  for (const M of ['2016-06-30', '2020-06-30', '2024-06-30']) { const m = month(Pd, M); console.log(`\n### ${M}: eligible ${m.elig.length} · E0 scored ${m.e0.length} · E0b scored ${m.e0b.length}`);
    for (const [E, eng] of Object.entries(ENGINES)) { const fl = eng.run(m, eng.grid[eng.grid.length - 1]); console.log(`${E.padEnd(4)} ${String(fl.length).padStart(3)} flags · ${fl.slice(0, 3).map((x) => `${x.t} (${x.why})`).join(' | ').slice(0, 330)}`); } }
  process.exit(0); }
// ---------- 1. choose settings on 2015–2022 (data truncated at 2022-12-31) ----------
const t0 = Date.now(), PB = loadPrices('2022-12-31'), MB = build(PB, '2014-06', '2022-12'); console.error(`build months ${MB.size} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
const BUILD_Y = SMOKE ? [2016, 2020] : [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022];
const chosen = {}, buildLog = [];
for (const [E, eng] of Object.entries(ENGINES)) { let best = null;
  for (const p of eng.grid) { const fl = runEngine(MB, E, p), ev = evaluate(PB, MB, fl, BUILD_Y), pr = precision(MB, fl, '2014-07-01', '2022-06-30'), ok = pr.ex != null && pr.ex > 0 && pr.size <= eng.budget, rb = randomBase(PB, MB, fl, BUILD_Y, null, SMOKE ? 10 : 30), lift = ev.early - rb.mean;
    buildLog.push({ E, p, early: ev.early, any: ev.any, n: ev.n, ex: pr.ex, size: pr.size, ok, rnd: rb.mean, rnd95: rb.p95, lift }); console.error(`${E} ${JSON.stringify(p)} early ${ev.early}/${ev.n} (random ${rb.mean.toFixed(1)}, 95th ${rb.p95}) lift ${lift.toFixed(1)} · excess ${pr.ex == null ? '—' : (pr.ex * 100).toFixed(1) + '%'} · size ${pr.size.toFixed(1)} ${ok ? '' : '(not allowed)'}`);
    if (ok && (!best || lift > best.lift || (lift === best.lift && pr.ex > best.ex))) best = { p, early: ev.early, ex: pr.ex, size: pr.size, lift }; }
  chosen[E] = best; }
const usable = Object.entries(chosen).filter(([, c]) => c), order = ['E0', ...usable.filter(([E]) => E !== 'E0').sort((a, b) => b[1].ex - a[1].ex).map(([E]) => E)].filter((E) => chosen[E]);
const combine = (MS) => { const per = Object.fromEntries(order.map((E) => [E, runEngine(MS, E, chosen[E].p)])); return new Map([...MS.keys()].map((M) => { const out = new Map(); for (const E of order) for (const [t, w] of per[E].get(M)) { if (out.size >= 150) break; if (!out.has(t)) out.set(t, w); } return [M, out]; })); };
const combB = combine(MB), evB = evaluate(PB, MB, combB, BUILD_Y), prB = precision(MB, combB, '2014-07-01', '2022-06-30');
const rbB = randomBase(PB, MB, combB, BUILD_Y, null, SMOKE ? 10 : 30); console.error(`COMBINED build: early ${evB.early}/${evB.n} (random ${rbB.mean.toFixed(1)}, 95th ${rbB.p95}) · any ${evB.any} · excess ${(prB.ex * 100).toFixed(1)}% · size ${prB.size.toFixed(0)}`);
if (SMOKE) process.exit(0);

// ---------- 2. blind test 2025–2026 (and 2023–2024, partly seen) with frozen settings ----------
const PF = loadPrices(null), MF = build(PF, '2022-06', '2026-09'), END26 = '2026-09-30';
const per = Object.fromEntries(order.map((E) => [E, runEngine(MF, E, chosen[E].p)])), comb = combine(MF);
const T = (fl, ys) => { const ev = evaluate(PF, MF, fl, ys, END26), pr = precision(MF, fl, `${ys[0] - 1}-07-01`, '2026-03-31'); return { ev, pr }; };
const pcs = (x) => (x == null ? '—' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`);
const L = ['# Multi-engine mover catcher — results (DESIGN_engines.md)\n', '## Settings chosen on 2015–2022 only\n', '| engine | chosen setting | movers caught early 2015–22 | same-size random lists (mean / 95th) | lift | excess of flagged names | avg list size |', '|---|---|---|---|---|---|---|'];
for (const [E, c] of Object.entries(chosen)) { const b = c && buildLog.find((x) => x.E === E && JSON.stringify(x.p) === JSON.stringify(c.p)); L.push(`| ${E} | ${c ? JSON.stringify(c.p) : 'none allowed'} | ${b ? `${b.early}/${b.n}` : '—'} | ${b ? `${b.rnd.toFixed(1)} / ${b.rnd95}` : '—'} | ${b ? b.lift.toFixed(1) : '—'} | ${b ? pcs(b.ex) : '—'} | ${b ? b.size.toFixed(0) : '—'} |`); }
L.push(`| **combined** | ${order.join(' + ')} | **${evB.early}/${evB.n}** | ${rbB.mean.toFixed(1)} / ${rbB.p95} | ${(evB.early - rbB.mean).toFixed(1)} | ${pcs(prB.ex)} | ${prB.size.toFixed(0)} |`);
L.push('\n## Blind test: 2025 and 2026 YTD (frozen settings) — and 2023–24 (partly seen)\n', '| | 2025 early (random mean / 95th) | 2026 early (random mean / 95th) | 2025–26 caught at all | excess of flagged names (2024-07 → 2026-03) | avg list size | 2023–24 early (partly seen) |', '|---|---|---|---|---|---|---|');
const rowT = (name, fl) => { const t = T(fl, [2025, 2026]), s = T(fl, [2023, 2024]), rb = randomBase(PF, MF, fl, [2025, 2026], END26); return `| ${name} | ${t.ev.perYear[2025].early}/${t.ev.perYear[2025].n} (${rb.per(2025).mean.toFixed(1)} / ${rb.per(2025).p95}) | ${t.ev.perYear[2026].early}/${t.ev.perYear[2026].n} (${rb.per(2026).mean.toFixed(1)} / ${rb.per(2026).p95}) | ${t.ev.any}/${t.ev.n} | ${pcs(t.pr.ex)} | ${t.pr.size.toFixed(0)} | ${s.ev.early}/${s.ev.n} |`; };
L.push(rowT('E0 bottleneck alone', per.E0)); for (const E of order.filter((E) => E !== 'E0')) L.push(rowT(E, per[E])); L.push(rowT('**combined watchlist**', comb));
const tc = T(comb, [2025, 2026]), rbc = randomBase(PF, MF, comb, [2025, 2026], END26), succ = tc.ev.perYear[2025].early >= 25 && tc.ev.perYear[2026].early >= 25 && tc.ev.perYear[2025].early > rbc.per(2025).p95 && tc.ev.perYear[2026].early > rbc.per(2026).p95 && (tc.pr.ex ?? -1) > 0;
L.push(`\n**Success test** (combined catches ≥ 25/50 early in both years, beats the 95th percentile of same-size random lists, positive excess): **${succ ? 'PASS' : 'FAIL'}**\n`);
for (const Y of [2025, 2026]) { L.push(`\n## ${Y === 2026 ? '2026 YTD' : Y}: every top-50 mover — which engine caught it, when, and why\n`, '| stock | move | first flagged | move already done | engine and reason |', '|---|---|---|---|---|');
  for (const x of tc.ev.detail[Y]) L.push(`| ${x.t} | ${pcs(x.r)} | ${x.first ? x.first.M.slice(0, 7) : '—'} | ${x.first ? `${Math.max(0, Math.round(x.first.share * 100))}%` : '—'} | ${x.first ? x.first.why : 'missed'} |`); }
const txt = L.join('\n'); console.log(txt); fs.mkdirSync(RES, { recursive: true }); fs.writeFileSync(path.join(RES, 'engines.txt'), txt + '\n'); fs.writeFileSync(path.join(RES, 'engines.json'), JSON.stringify({ chosen, buildLog, order, combinedBuild: { ...evB, detail: undefined, ...prB } }, null, 1));
