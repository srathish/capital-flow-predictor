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
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
export const FRED_LOCKED = { PCU334413334413: 'PPI semiconductors', PCU33443344: 'PPI semis & electronic components', IPG3344S: 'IP semiconductors',
  PCU335311335311: 'PPI transformers', PCU335313335313: 'PPI switchgear', PCU2211222112: 'PPI power transmission/distribution', APU000072610: 'electricity price',
  DHHNGSP: 'Henry Hub gas', PCOPPUSDM: 'copper', PALUMUSDM: 'aluminum', TLPWRCONS: 'construction: power', TLCOMCONS: 'construction: commercial' };
export const FRED_EXTRA = { DGS10: '10-year Treasury yield', DTWEXBGS: 'US dollar index', DCOILWTICO: 'WTI oil', CBBTCUSD: 'Bitcoin', TSIFRGHT: 'freight shipments', RSAFS: 'retail sales' };

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
  await import('../feeds/env.js'); const FRED_API_KEY = process.env.FRED_API_KEY; const fred = {};
  for (const [id, name] of Object.entries({ ...FRED_LOCKED, ...FRED_EXTRA })) { const j = await (await fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${FRED_API_KEY}&file_type=json&observation_start=2008-01-01`)).json().catch(() => null);
    const o = (j?.observations ?? []).filter((x) => x.value !== '.').map((x) => ({ d: x.date, v: +x.value })); fred[id] = { name, locked: id in FRED_LOCKED, obs: o }; console.error(`${id} ${name}: ${o.length} obs ${o[0]?.d ?? ''} → ${o.at(-1)?.d ?? ''}`); }
  fs.writeFileSync(path.join(OUT, 'fred.json'), JSON.stringify(fred));
}
