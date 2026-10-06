#!/usr/bin/env node
// Node graph (DESIGN_graph.md) — data layer. Builds the point-in-time node panel:
//   company nodes per calendar quarter: revenue, gross margin, capex, inventory, backlog (RPO), operating margin, each with the
//   date it became public (latest filed date among its inputs) → .cache/graph/panel.json
//   outside nodes (FRED, monthly) → .cache/graph/fred.json (both the locked list and the proposed additions; the model picks)
// 0 Skylit credits. node world/graph_data.mjs
import fs from 'node:fs';
import path from 'node:path';
import { TAGS } from './facts_collect.mjs';
import { TAGS2 } from './facts2_collect.mjs';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), C = path.join(ROOT, '.cache'), OUT = path.join(C, 'graph');
const rd = (f, d = null) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const addD = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
export const FRED_LOCKED = { PCU334413334413: 'PPI semiconductors', PCU33443344: 'PPI semis & electronic components', IPG3344S: 'IP semiconductors',
  PCU335311335311: 'PPI transformers', PCU335313335313: 'PPI switchgear', PCU2211222112: 'PPI power transmission/distribution', APU000072610: 'electricity price',
  DHHNGSP: 'Henry Hub gas', PCOPPUSDM: 'copper', PALUMUSDM: 'aluminum', TLPWRCONS: 'construction: power', TLCOMCONS: 'construction: commercial' };
export const FRED_EXTRA = { DGS10: '10-year Treasury yield', DTWEXBGS: 'US dollar index', DCOILWTICO: 'WTI oil', CBBTCUSD: 'Bitcoin', TSIFRGHT: 'freight shipments', RSAFS: 'retail sales' };
export const FRED_MORE = { A34SNO: 'M3 new orders: computers & electronics', A34SUO: 'M3 unfilled orders: computers & electronics', A34STI: 'M3 inventories: computers & electronics',
  A34ANO: 'M3 new orders: computers', A35SNO: 'M3 new orders: electrical equipment', A35SUO: 'M3 unfilled orders: electrical equipment', A33SNO: 'M3 new orders: machinery', A36SNO: 'M3 new orders: transportation equipment',
  NEWORDER: 'M3 core capital goods orders', ADEFNO: 'M3 defense capital goods orders', ANAPNO: 'M3 nondefense aircraft orders', TLMFGCONS: 'construction: manufacturing', IPG3341S: 'IP computers',
  CAPUTLG3344S: 'capacity use: semiconductors', IPG2211S: 'IP electric power generation', PCU518210518210: 'PPI data processing & hosting', CES6054150001: 'jobs: computer systems design',
  CES5051800001: 'jobs: data processing & hosting', PURANUSDM: 'uranium', PNICKUSDM: 'nickel', PIORECRUSDM: 'iron ore', PCOALAUUSDM: 'coal', XTEXVA01KRM667S: 'Korea exports',
  XTEXVA01JPM667S: 'Japan exports', XTEXVA01CNM667S: 'China exports', RAILFRTCARLOADSD11: 'rail carloads', TRUCKD11: 'truck tonnage', NOFDFSA066MSFRBPHI: 'Philly Fed future new orders', CFNAI: 'Chicago Fed activity index' };
export const DAILY = new Set(['DHHNGSP', 'DGS10', 'DTWEXBGS', 'DCOILWTICO', 'CBBTCUSD']), LEVEL = new Set(['DGS10', 'CFNAI', 'NOFDFSA066MSFRBPHI']);

// calendar quarter key for a fiscal period end: nearest quarter-end within ±46 days → 'YYYYQn'
export function cq(e) { const d = new Date(e + 'T12:00:00Z'); let best = null;
  for (let y = d.getUTCFullYear() - 1; y <= d.getUTCFullYear() + 1; y++) for (let q = 1; q <= 4; q++) { const qe = new Date(Date.UTC(y, q * 3, 0)).toISOString().slice(0, 10), dd = Math.abs(days(qe, e)); if (dd <= 46 && (!best || dd < best.dd)) best = { k: `${y}Q${q}`, dd }; }
  return best?.k ?? null; }

// flow series (income statement / cash flow): quarterly values, first-filed, highest-priority tag; Q4 = annual − 3 quarters;
// cash-flow items reported only year-to-date (6/9 months) are de-cumulated: Qn = YTD(n) − YTD(n−1) with the same start date.
function flow(facts, tags) { const q = new Map(), ytd = new Map(), ann = new Map();
  for (const tag of tags) for (const x of facts?.[tag] ?? []) { if (!x.s) continue; const dur = days(x.s, x.e);
    const put = (m, k) => { const cur = m.get(k); if (cur && (cur.tag !== tag || cur.f <= x.f)) return; m.set(k, { v: x.v, f: x.f, s: x.s, e: x.e, tag }); };
    if (dur >= 80 && dur <= 100) put(q, x.e); else if (dur >= 350 && dur <= 380) put(ann, x.e); else if ((dur >= 170 && dur <= 190) || (dur >= 260 && dur <= 280)) put(ytd, x.s + '|' + x.e); }
  for (const [, y] of ytd) { if ([...q.keys()].some((k) => Math.abs(days(k, y.e)) <= 5)) continue; // already have the 3-month value
    const prev = [...ytd.values(), ...q.values()].filter((z) => Math.abs(days(z.s, y.s)) <= 5 && days(z.e, y.e) >= 80 && days(z.e, y.e) <= 100).sort((a, b) => b.e.localeCompare(a.e))[0];
    if (prev) q.set(y.e, { v: y.v - prev.v, f: [y.f, prev.f].sort().at(-1), s: prev.e, e: y.e }); }
  for (const [e, a] of ann) { if ([...q.keys()].some((k) => Math.abs(days(k, e)) <= 5)) continue;
    const ytd9 = [...ytd.values()].find((z) => Math.abs(days(z.s, a.s)) <= 5 && days(z.e, e) >= 80 && days(z.e, e) <= 100);
    if (ytd9) { q.set(e, { v: a.v - ytd9.v, f: [a.f, ytd9.f].sort().at(-1), e }); continue; }
    const inside = [...q.entries()].filter(([k, x]) => x.s && days(a.s, x.s) >= -5 && days(k, e) >= 0); if (inside.length !== 3) continue;
    q.set(e, { v: a.v - inside.reduce((s, [, x]) => s + x.v, 0), f: [a.f, ...inside.map(([, x]) => x.f)].sort().at(-1), e }); }
  return q; }
function instant(facts, tags) { const m = new Map(); for (const tag of tags) for (const x of facts?.[tag] ?? []) { const cur = m.get(x.e); if (cur && (cur.tag !== tag || cur.f <= x.f)) continue; m.set(x.e, { v: x.v, f: x.f, tag }); } return m; }

if (decodeURIComponent(new URL(import.meta.url).pathname) === process.argv[1]) {
  fs.mkdirSync(OUT, { recursive: true });
  const panel = {}; let n = 0;
  for (const f of fs.readdirSync(path.join(C, 'edgar', 'facts'))) { const t = f.replace('.json', ''), F = rd(path.join(C, 'edgar', 'facts', f), {}), G = rd(path.join(C, 'edgar', 'facts2', f), {}); if (!F.rev) continue;
    const S = { rev: flow(F.rev, TAGS.rev), gp: flow(F.gp, TAGS.gp), cost: flow(F.cost, TAGS.cost), capex: flow(G.capex, TAGS2.capex), opinc: flow(G.opinc, TAGS2.opinc), inv: instant(G.inv, TAGS2.inv), rpo: instant(G.rpo, TAGS2.rpo) };
    const rows = {};
    for (const [e, r] of S.rev) { const k = cq(e); if (!k || r.v <= 0) continue; const row = { e, f: r.f, rev: r.v };
      const near = (m) => { for (const [e2, x] of m) if (Math.abs(days(e2, e)) <= 5) return x; return null; };
      const gp = near(S.gp), cost = near(S.cost), cx = near(S.capex), oi = near(S.opinc), iv = near(S.inv), rp = near(S.rpo);
      if (gp) { row.gm = gp.v / r.v; row.fgm = gp.f; } else if (cost) { row.gm = (r.v - cost.v) / r.v; row.fgm = cost.f; }
      if (cx) { row.capex = Math.abs(cx.v); row.fcx = cx.f; } if (oi) { row.om = oi.v / r.v; row.fom = oi.f; } if (iv) { row.inv = iv.v; row.finv = iv.f; } if (rp) { row.rpo = rp.v; row.frpo = rp.f; }
      if (!rows[k] || rows[k].f > row.f) rows[k] = row; }
    if (Object.keys(rows).length >= 6) { panel[t] = rows; n++; } }
  fs.writeFileSync(path.join(OUT, 'panel.json'), JSON.stringify(panel)); console.error(`panel: ${n} companies`);
  await import('../feeds/env.js'); const K = process.env.FRED_API_KEY, fred = {}; // amendment 2b: first-release values (ALFRED vintages) for revised monthly series
  const api = async (q) => { for (let k = 0; k < 4; k++) { const j = await (await fetch(`https://api.stlouisfed.org/fred/series/observations?${q}&api_key=${K}&file_type=json&limit=100000`)).json().catch(() => null); if (j?.observations) return j.observations; await new Promise((r) => setTimeout(r, 2000 * (k + 1))); } return []; };
  const mEnd = (m) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10), m12 = (m) => `${+m.slice(0, 4) - 1}${m.slice(4, 7)}`;
  for (const [id, name] of Object.entries({ ...FRED_LOCKED, ...FRED_EXTRA, ...FRED_MORE })) {
    if (DAILY.has(id)) { const o = (await api(`series_id=${id}&observation_start=2008-01-01`)).filter((x) => x.value !== '.').map((x) => ({ d: x.date, v: +x.value })); fred[id] = { name, kind: 'daily', level: LEVEL.has(id), obs: o }; console.error(`${id} ${name}: ${o.length} daily obs`); continue; }
    const recs = (await api(`series_id=${id}&observation_start=2008-01-01&output_type=1&realtime_start=1776-07-04&realtime_end=9999-12-31`)).filter((x) => x.value !== '.');
    const by = new Map(); for (const x of recs) { const m = x.date.slice(0, 7), a = by.get(m) ?? []; a.push({ rs: x.realtime_start, re: x.realtime_end, v: +x.value }); by.set(m, a); }
    for (const a of by.values()) a.sort((p, q) => p.rs.localeCompare(q.rs));
    const yoy = []; for (const [m, a] of by) { const prev = by.get(m12(m)); if (!prev) continue; let r = a[0].rs, v = a[0].v, pv;
      if (r > addD(mEnd(m), 200)) { pv = prev[0].v; r = addD(mEnd(m), 60); } // vintage history starts later than this month: earliest vintage, month-end + 60 days
      else { const hit = prev.find((x) => x.rs <= r && r <= x.re) ?? prev[0]; pv = hit.v; }
      const g = LEVEL.has(id) ? v - pv : pv > 0 ? v / pv - 1 : null; if (g != null && Number.isFinite(g)) yoy.push({ m, g, avail: r }); }
    fred[id] = { name, kind: 'monthly', level: LEVEL.has(id), yoy: yoy.sort((p, q) => p.m.localeCompare(q.m)) }; console.error(`${id} ${name}: ${yoy.length} first-release YoY months ${yoy[0]?.m ?? ''} → ${yoy.at(-1)?.m ?? ''}`); }
  fs.writeFileSync(path.join(OUT, 'fred.json'), JSON.stringify(fred));
}
