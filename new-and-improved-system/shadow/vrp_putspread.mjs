#!/usr/bin/env node
// DESIGN_vrp_putspread.md — weekly entries, monthly SPY ~1σ put credit spread (3% wide), hold to expiry; filters VRP and VIX contango.
import fs from 'node:fs';
import { UW_API_KEY } from '../feeds/env.js';
const C = new URL('../.cache/', import.meta.url), CA = new URL('vrp/', C), OUT = new URL('./results_vrp_putspread/', import.meta.url); fs.mkdirSync(CA, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });
const uw = async (p, key) => { const f = new URL(key + '.json', CA); if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  for (let k = 0; k < 4; k++) { await new Promise((r) => setTimeout(r, 120)); const r = await fetch('https://api.unusualwhales.com/api' + p, { headers: { Authorization: `Bearer ${UW_API_KEY}` } }).catch(() => null); if (r?.status === 404 || r?.status === 422) return null; if (r?.ok) { const j = await r.json(); fs.writeFileSync(f, JSON.stringify(j)); return j; } await new Promise((x) => setTimeout(x, 2000)); } return null; };
const spy = JSON.parse(fs.readFileSync(new URL('daily/SPY.json', C), 'utf8')).map((b) => ({ d: new Date(b.t * 1000).toISOString().slice(0, 10), c: b.c })).sort((a, b) => a.d.localeCompare(b.d));
const close = new Map(spy.map((b) => [b.d, b.c])), VIX = JSON.parse(fs.readFileSync(new URL('cboe/VIX.json', C), 'utf8')), V3 = JSON.parse(fs.readFileSync(new URL('cboe/VIX3M.json', C), 'utf8'));
const thirdFri = (y, m) => { const d = new Date(Date.UTC(y, m, 1)); const off = (5 - d.getUTCDay() + 7) % 7; return new Date(Date.UTC(y, m, 1 + off + 14)).toISOString().slice(0, 10); };
const parse = (id) => { const m = id.match(/^SPY(\d{6})([CP])(\d{8})$/); return m ? { exp: `20${m[1].slice(0, 2)}-${m[1].slice(2, 4)}-${m[1].slice(4, 6)}`, cp: m[2], K: +m[3] / 1000 } : null; };
const rows = [], skip = {}; let lastWeek = null;
for (let i = 21; i < spy.length; i++) {
  const { d, c: S } = spy[i]; if (d < '2023-01-02' || d > '2026-08-24') continue;
  const wk = (() => { const t = new Date(d + 'T12:00:00Z'); const mon = new Date(t - ((t.getUTCDay() + 6) % 7) * 864e5); return mon.toISOString().slice(0, 10); })(); if (wk === lastWeek) continue; lastWeek = wk;
  const vix = VIX[d]?.c, v3 = V3[d]?.c; if (!vix || !v3) { skip.vix = (skip.vix ?? 0) + 1; continue; }
  const r = []; for (let j = i - 19; j <= i; j++) r.push(Math.log(spy[j].c / spy[j - 1].c)); const mu = r.reduce((a, b) => a + b, 0) / r.length, rv = Math.sqrt(r.reduce((a, b) => a + (b - mu) ** 2, 0) / (r.length - 1)) * Math.sqrt(252) * 100;
  const t0 = new Date(d + 'T12:00:00Z'), cands = []; for (let k = 0; k < 3; k++) { const y = t0.getUTCFullYear(), m = t0.getUTCMonth() + k; const e = thirdFri(y + Math.floor(m / 12), m % 12), dte = (Date.parse(e) - Date.parse(d)) / 864e5; if (dte >= 28 && dte <= 49) cands.push({ e, dte }); }
  if (!cands.length) { skip.noexp = (skip.noexp ?? 0) + 1; continue; } const { e: exp0, dte } = cands[0];
  const ch = await uw(`/stock/SPY/option-chains?date=${d}`, `chain_${d}`); const puts = (ch?.data ?? []).map(parse).filter((x) => x && x.cp === 'P');
  const exps = [...new Set(puts.map((x) => x.exp))], exp = exps.includes(exp0) ? exp0 : exps.find((x) => Math.abs(Date.parse(x) - Date.parse(exp0)) <= 864e5) ; if (!exp) { skip.chain = (skip.chain ?? 0) + 1; continue; }
  const Ks = [...new Set(puts.filter((x) => x.exp === exp).map((x) => x.K))].sort((a, b) => a - b), near = (t) => Ks.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a));
  const ks = near(S * (1 - vix / 100 * Math.sqrt(dte / 365))), kl = near(ks - 0.03 * S); if (!(kl < ks)) { skip.strikes = (skip.strikes ?? 0) + 1; continue; }
  const id = (K) => `SPY${exp.slice(2, 4)}${exp.slice(5, 7)}${exp.slice(8, 10)}P${String(Math.round(K * 1000)).padStart(8, '0')}`;
  const q = async (K) => ((await uw(`/option-contract/${id(K)}/historic`, `h_${id(K)}`))?.chains ?? []).find((x) => x.date === d);
  const a = await q(ks), b = await q(kl); if (!a || !b || !(+a.nbbo_bid > 0) || !(+b.nbbo_ask > 0)) { skip.quote = (skip.quote ?? 0) + 1; continue; }
  const credit = +a.nbbo_bid - +b.nbbo_ask - 0.013, width = ks - kl; if (!(credit > 0)) { skip.credit = (skip.credit ?? 0) + 1; continue; }
  const Se = close.get(exp) ?? close.get(spy.filter((x) => x.d <= exp).at(-1)?.d); if (Se == null || exp > spy.at(-1).d) { skip.open = (skip.open ?? 0) + 1; continue; }
  const payout = Math.min(width, Math.max(0, ks - Se));
  rows.push({ d, exp, S, vix, v3, rv, vrp: vix > rv, cont: vix < v3, ks, kl, credit, width, r: (credit - payout) / (width - credit), ho: d >= '2025-01-01' });
}
const FIL = { P1: () => true, P2: (x) => x.vrp, P3: (x) => x.cont, P4: (x) => x.vrp && x.cont };
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length, sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const st = (a) => { const g = new Map(); for (const x of a) { const q = g.get(x.exp) ?? []; q.push(x.r); g.set(x.exp, q); } const v = [...g.values()].map(mean); return { n: a.length, k: v.length, m: mean(a.map((x) => x.r)), t: v.length > 2 ? (mean(v) / sd(v)) * Math.sqrt(v.length) : NaN, win: a.filter((x) => x.r > 0).length / a.length, worst: Math.min(...a.map((x) => x.r)) }; };
const path = (a) => { let eq = 1, pk = 1, mdd = 0; for (const x of [...a].sort((p, q) => p.exp.localeCompare(q.exp))) { eq *= 1 + 0.02 * x.r; pk = Math.max(pk, eq); mdd = Math.min(mdd, eq / pk - 1); } return { eq, mdd }; };
const erf = (x) => { const s = Math.sign(x); x = Math.abs(x); const a = 1 / (1 + 0.3275911 * x); return s * (1 - (((((1.061405429 * a - 1.453152027) * a) + 1.421413741) * a - 0.284496736) * a + 0.254829592) * a * Math.exp(-x * x)); }, pOne = (t) => 0.5 * (1 - erf(t / Math.SQRT2));
const L = ['# VRP monthly put spread — results', '', `Run ${new Date().toISOString()} · design shadow/DESIGN_vrp_putspread.md · trades ${rows.length} · skipped ${JSON.stringify(skip)}`, '', '| id | filter | build: n, mean (t), win, worst | holdout: n, mean (t), win, worst | holdout path at 2% risk ×, max DD |', '|---|---|---|---|---|'];
const res = Object.entries(FIL).map(([id, f]) => { const b = st(rows.filter((x) => !x.ho && f(x))), h = st(rows.filter((x) => x.ho && f(x))), p = path(rows.filter((x) => x.ho && f(x))); L.push(`| ${id} | ${{ P1: 'none', P2: 'VIX > realized', P3: 'contango', P4: 'both' }[id]} | ${b.n}, ${(b.m * 100).toFixed(1)}% (${b.t.toFixed(2)}), ${(b.win * 100).toFixed(0)}%, ${(b.worst * 100).toFixed(0)}% | ${h.n}, **${(h.m * 100).toFixed(1)}%** (${h.t.toFixed(2)}), ${(h.win * 100).toFixed(0)}%, ${(h.worst * 100).toFixed(0)}% | ${p.eq.toFixed(3)}, ${(p.mdd * 100).toFixed(1)}% |`); return { id, b, h, p: pOne(h.t) }; });
const ps = res.map((r) => r.p).sort((a, b) => a - b); let kk = 0; ps.forEach((p, i) => { if (p <= ((i + 1) / ps.length) * 0.1) kk = i + 1; }); const cut = kk ? ps[kk - 1] : -1, P1 = res[0];
L.push('', `**Pass (holdout > 0, BH, build > 0, filters must beat P1 in both periods): ${res.filter((r) => r.h.m > 0 && r.b.m > 0 && r.p <= cut && (r.id === 'P1' || (r.h.m > P1.h.m && r.b.m > P1.b.m))).map((r) => r.id).join(', ') || 'none'}**`);
const hs = spy.filter((x) => x.d >= '2025-01-01' && x.d <= '2026-09-30'); L.push(`SPY buy-and-hold over the holdout window: ${((hs.at(-1).c / hs[0].c - 1) * 100).toFixed(1)}%`);
fs.writeFileSync(new URL('summary.md', OUT), L.join('\n') + '\n'); fs.writeFileSync(new URL('rows.json', OUT), JSON.stringify(rows)); console.log(L.join('\n'));
