// Shared point-in-time stock data (copied verbatim from the audited stock_factory_long.mjs loaders, incl. its amendment-1 fixes).
import fs from 'node:fs';
import path from 'node:path';
import { TAGS } from '../world/facts_collect.mjs';
import { TAGS2 } from '../world/facts2_collect.mjs';
import { universeV2 } from '../world/universe_prices.mjs';
import { cleanBars, gapsOf, blockedAt, crosses } from '../world/prices_clean.mjs';
import { sharesAdjusted } from './split_shares.mjs';

const SH = decodeURIComponent(new URL('.', import.meta.url).pathname), NIS = path.join(SH, '..'), C = path.join(NIS, '.cache');
const rd = (f, d = null) => { try { return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d; } catch { return d; } };
const addD = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10), days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN), median = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const sdv = (a) => { if (a.length < 2) return NaN; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const log = (s) => console.error(`${new Date().toISOString().slice(11, 19)} ${s}`);
const FUNDS = new Set(['6221', '6722', '6726']);
const AMBIG = new Set(['deposition', 'server', 'foundry', 'accelerator', 'oil', 'natural gas', 'digital assets', 'subscription', 'grid', 'wind', 'solar', 'construction', 'interest rate', 'advertising', 'travel', 'restaurant', 'housing', 'consumer spending', 'credit card', 'mortgage', 'steel', 'copper', 'automotive', 'tariff', 'freight', 'shipping', 'wafer', 'rack', 'inference', 'transformer']);
const GROUPS = { GLD: ['1040'], SLV: ['1040', '1090'], CPER: ['1000', '3330', '3331'], URA: ['1090', '1094'], USO: ['1311', '1381', '1389', '2911'], UNG: ['1311', '4922', '4923', '4924'], LIT: ['2819'], BDRY: ['4400', '4412', '4424'] };

// ---------- static data ----------
const U = universeV2(1e9);
const SIC = new Map(); for (const f of fs.readdirSync(path.join(C, 'edgar', 'sic'))) { const j = rd(path.join(C, 'edgar', 'sic', f)); if (j?.sic) SIC.set(f.replace('.json', ''), String(j.sic).padStart(4, '0')); }
function series(facts, tags) { const q = new Map(), ann = new Map(); // quarterly (80–100 d) first-filed, Q4 = annual − 3 quarters
  for (const tag of tags) for (const x of facts?.[tag] ?? []) { if (!x.s) continue; const dur = days(x.s, x.e), tgt = dur >= 80 && dur <= 100 ? q : dur >= 350 && dur <= 380 ? ann : null; if (!tgt) continue;
    const cur = tgt.get(x.e); if (cur && cur.f <= x.f) continue; tgt.set(x.e, { v: x.v, f: x.f, s: x.s, tag }); } // amendment 1: earliest-filed across tags (ASC 606 restatements no longer replace originals)
  for (const [e, a] of ann) { if ([...q.keys()].some((k) => Math.abs(days(k, e)) <= 5)) continue; const inside = [...q.entries()].filter(([k, x]) => days(a.s, x.s) >= -5 && days(k, e) >= 0); if (inside.length !== 3) continue;
    q.set(e, { v: a.v - inside.reduce((s, [, x]) => s + x.v, 0), f: [a.f, ...inside.map(([, x]) => x.f)].sort().at(-1) }); }
  return [...q].map(([e, x]) => ({ e, v: x.v, f: x.f })).sort((a, b) => a.e.localeCompare(b.e)); }
function annual(facts, tags) { const m = new Map(); for (const tag of tags) for (const x of facts?.[tag] ?? []) { if (!x.s) continue; const dur = days(x.s, x.e); if (dur < 350 || dur > 380) continue; const cur = m.get(x.e); if (cur && cur.f <= x.f) continue; m.set(x.e, { e: x.e, v: x.v, f: x.f }); } return [...m.values()].sort((a, b) => a.e.localeCompare(b.e)); }
function instant(facts, tags) { const m = new Map(); for (const tag of tags) for (const x of facts?.[tag] ?? []) { if (x.s) continue; const cur = m.get(x.e); if (cur && cur.f <= x.f) continue; m.set(x.e, { e: x.e, v: x.v, f: x.f }); } return [...m.values()].sort((a, b) => a.e.localeCompare(b.e)); }
const FUND = new Map();
for (const { t } of U) { const F = rd(path.join(C, 'edgar', 'facts', `${t}.json`)); if (!F?.rev) continue; const G = rd(path.join(C, 'edgar', 'facts2', `${t}.json`), {}), H = rd(path.join(C, 'edgar', 'facts3', `${t}.json`), {});
  const rev = series(F.rev, TAGS.rev), gp = new Map(series(F.gp, TAGS.gp).map((x) => [x.e, x])), cost = new Map(series(F.cost, TAGS.cost).map((x) => [x.e, x]));
  const Q = rev.map((r) => { const a = gp.get(r.e), c = cost.get(r.e); let gm = null, fg = r.f; if (a) { gm = a.v / r.v; fg = [r.f, a.f].sort().at(-1); } else if (c) { gm = (r.v - c.v) / r.v; fg = [r.f, c.f].sort().at(-1); } return { e: r.e, rev: r.v, f: r.f, gm, fg }; });
  FUND.set(t, { Q, op: series(G.opinc, TAGS2.opinc), ni: series(H.ni, ['NetIncomeLoss', 'ProfitLoss']), rnd: series(G.rnd, TAGS2.rnd), capex: annual(G.capex, TAGS2.capex),
    inv: instant(G.inv, TAGS2.inv), rpo: instant(G.rpo, TAGS2.rpo), defrev: instant(G.defrev, TAGS2.defrev), sh: sharesAdjusted(C, t)?.series ?? [] }); }
log(`fundamentals for ${FUND.size} companies`);
const INS = new Map(); for (const line of fs.readFileSync(path.join(C, 'insider_bulk', 'purchases.jsonl'), 'utf8').split('\n')) { if (!line) continue; const r = JSON.parse(line);
  if (!r.ticker || !r.filed || !r.tradeDate || r.tradeDate > r.filed) continue; (INS.get(r.ticker) ?? INS.set(r.ticker, []).get(r.ticker)).push({ f: r.filed, o: r.ownerCik ?? r.owner, v: Math.min(r.value ?? 0, 5e7) }); }
const GUID = new Map(); for (const g of rd(path.join(C, 'edgar', 'guidance_hist.json'), [])) (GUID.get(g.t) ?? GUID.set(g.t, []).get(g.t)).push(g);
const SPIN = rd(path.join(C, 'edgar', 'spinoffs.json'), {});
const CONCEPT = new Map(); for (const x of [...rd(path.join(C, 'edgar', 'exposure_hist.json'), []), ...rd(path.join(C, 'edgar', 'exposure.json'), [])]) { if (AMBIG.has(x.c) || !x.t || !x.c || !x.d || !/^10-[KQ]/.test(x.f ?? '')) continue; const a = CONCEPT.get(x.c) ?? CONCEPT.set(x.c, new Map()).get(x.c); (a.get(x.t) ?? a.set(x.t, []).get(x.t)).push(x.d); }
for (const mp of CONCEPT.values()) for (const a of mp.values()) a.sort();
const memberAt = (dates, M) => { const lo = addD(M, -730); for (let i = dates.length - 1; i >= 0; i--) { if (dates[i] <= M) return dates[i] >= lo; } return false; };
const COMM = Object.fromEntries(Object.keys(GROUPS).map((t) => [t, (rd(path.join(C, 'commodity', `${t}.json`), []) || []).filter((x) => x.c > 0)]));
const SPY = rd(path.join(C, 'wdaily_hist', 'SPY_full.json'), []), SPYI = new Map(SPY.map((x, i) => [x.d, i]));

// ---------- prices ----------
const P = new Map();
for (const { t } of U) { if (!FUND.has(t) || FUNDS.has(SIC.get(t))) continue; const cb = cleanBars(t); const b = cb.bars; if (b.length < 260) continue;
  P.set(t, { d: b.map((x) => x.d), o: Float64Array.from(b.map((x) => x.o ?? NaN)), c: Float64Array.from(b.map((x) => x.c)), v: Float64Array.from(b.map((x) => x.v || 0)), bad: cb.bad, gaps: gapsOf(b) }); }
log(`prices for ${P.size} companies`);
const idx = (arr, d) => { let lo = 0, hi = arr.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m] <= d) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
const lastBy = (arr, d, key = 'f') => { let r = null; for (const x of arr) { if (x[key] <= d) r = x; else if (key === 'f') continue; } return r; };


export { C, rd, addD, days, mean, median, sdv, log, SIC, FUND, INS, GUID, CONCEPT, memberAt, SPY, SPYI, P, idx, series, GROUPS, COMM };
