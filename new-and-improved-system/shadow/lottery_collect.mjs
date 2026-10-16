#!/usr/bin/env node
// DESIGN_lottery.md collector: weekly selections (S1–S4, CTL) from .cache/winners, then per pick the listed chain on t,
// the 3–9-day expiry, the 4 OTM legs, and each leg's closing ask on t. → .cache/lottery/{t}.json. Resumable.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UW_API_KEY } from '../feeds/env.js';
const SH = path.dirname(fileURLToPath(import.meta.url)), W = path.join(SH, '..', '.cache', 'winners'), OUT = path.join(SH, '..', '.cache', 'lottery'); fs.mkdirSync(OUT, { recursive: true });
const ETF = new Set(['SPY', 'QQQ', 'XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLI', 'XLU', 'XLB', 'XLRE', 'XLC', 'SMH', 'IGV']);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN), sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); }, num = (x) => (x == null ? NaN : +x);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); let LIMIT = false, calls = 0;
async function uw(p) { for (let k = 0; k < 5 && !LIMIT; k++) { await sleep(110); calls++; const r = await fetch(`https://api.unusualwhales.com/api${p}`, { headers: { Authorization: `Bearer ${UW_API_KEY}` } }).catch(() => null);
  if (r?.status === 429) { const b = await r.text().catch(() => ''); if (b.includes('daily_request_limit_hit')) { LIMIT = true; console.error('UW daily limit'); return null; } await sleep(4000 * (k + 1)); continue; } if (r?.status === 404 || r?.status === 422) return { data: [], chains: [] }; if (!r?.ok) { await sleep(1500); continue; } return r.json().catch(() => null); } return null; }
const D = {}; for (const f of fs.readdirSync(W)) { if (!f.endsWith('.json') || f.startsWith('_')) continue; const t = f.replace('.json', ''); if (ETF.has(t)) continue; const j = JSON.parse(fs.readFileSync(path.join(W, f), 'utf8')); const o = j.ohlc.slice().sort((a, b) => a.d.localeCompare(b.d)); if (o.length < 300) continue; D[t] = { o, oi: new Map(o.map((b, i) => [b.d, i])), fl: new Map(j.flow.map((x) => [x.date, x])) }; }
const T = Object.keys(D).sort(), days = [...new Set(Object.values(D).flatMap((x) => x.o.map((b) => b.d)))].sort().filter((d) => Object.values(D).filter((x) => x.oi.has(d)).length > 200);
const wk = (d) => { const x = new Date(d + 'T12:00:00Z'), day = (x.getUTCDay() + 6) % 7; return new Date(x.getTime() - day * 864e5).toISOString().slice(0, 10); };
const ends = []; for (let i = 0; i < days.length; i++) if (i === days.length - 1 || wk(days[i + 1]) !== wk(days[i])) ends.push(days[i]);
let seed = 23; const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
function score(t, d) { const X = D[t], i = X.oi.get(d); if (i == null || i < 40 || i + 6 >= X.o.length + 6) return null; const o = X.o, lr = []; for (let q = i - 19; q <= i; q++) lr.push(Math.log(o[q].c / o[q - 1].c));
  for (let q = Math.max(1, i - 19); q <= Math.min(o.length - 1, i + 7); q++) { const r = o[q].c / o[q - 1].c; if (SPLIT.some((x) => Math.abs(r / x - 1) < 0.03)) return null; } /* amendment 1b: split-ratio guard only (real big moves kept) */
  const k = days.indexOf(d), f5 = days.slice(k - 4, k + 1).map((z) => X.fl.get(z)).filter(Boolean), f30 = days.slice(k - 29, k + 1).map((z) => X.fl.get(z)).filter(Boolean); const c30 = mean(f30.map((x) => num(x.call_volume))), p30 = mean(f30.map((x) => num(x.call_premium) + num(x.put_premium)));
  const dir = f5.reduce((s, x) => s + num(x.net_call_premium) - num(x.net_put_premium), 0); return { t, c: o[i].c, rv: sd(lr), B2: f5.length >= 4 && c30 > 0 ? mean(f5.map((x) => num(x.call_volume))) / c30 : NaN, B3: f5.length >= 4 && p30 > 0 ? Math.abs(dir / p30) : NaN, dir: Math.sign(dir) }; }
const SPLIT = [1 / 2, 1 / 3, 1 / 4, 1 / 5, 1 / 10, 2 / 3, 2, 3, 4, 5, 10, 1.5, 1 / 20, 20];
const parse = (s) => { const m = s.match(/^(.+?)(\d{6})([CP])(\d{8})$/); return m ? { e: `20${m[2].slice(0, 2)}-${m[2].slice(2, 4)}-${m[2].slice(4, 6)}`, cp: m[3], k: +m[4] / 1000, id: s } : null; };
for (const t0 of ends) { if (t0 < '2024-11-22' || LIMIT) continue; const f = path.join(OUT, `${t0}.json`); const prev = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; if (prev?.done) continue;
  const rows = T.map((t) => score(t, t0)).filter(Boolean); if (rows.length < 150) continue; const rk = (k) => { const v = rows.filter((r) => Number.isFinite(r[k])).sort((a, b) => a[k] - b[k]); v.forEach((r, i) => (r['q' + k] = i / (v.length - 1))); }; rk('rv'); rk('B2');
  for (const r of rows) r.B4 = Number.isFinite(r.qrv) && Number.isFinite(r.qB2) ? (r.qrv + r.qB2) / 2 : NaN; const ctl = [...rows]; for (let i = ctl.length - 1; i > 0; i--) { const k = Math.floor(rnd() * (i + 1)); [ctl[i], ctl[k]] = [ctl[k], ctl[i]]; }
  const top = (k) => rows.filter((r) => Number.isFinite(r[k])).sort((a, b) => b[k] - a[k]).slice(0, 10);
  const sets = { S1: top('rv'), S2: top('B2'), S3: top('B3'), S4: top('B4'), CTL: ctl.slice(0, 10) }, names = new Map(); for (const [s, a] of Object.entries(sets)) for (const r of a) { if (!names.has(r.t)) names.set(r.t, { ...r, sets: [] }); names.get(r.t).sets.push(s); }
  const out = prev ?? { t0, picks: {} };
  for (const [t, r] of names) { if (LIMIT) break; if (out.picks[t]?.legs) continue; const ch = await uw(`/stock/${t}/option-chains?date=${t0}`); if (!ch) continue; const L = (ch.data ?? []).map(parse).filter(Boolean);
    const exps = [...new Set(L.map((x) => x.e))].filter((e) => { const g = (Date.parse(e) - Date.parse(t0)) / 864e5; return g >= 3 && g <= 9; }).sort(); if (!exps.length) { out.picks[t] = { ...r, legs: [] }; continue; } const e = exps[0];
    const near = (cp, tgt, side) => { const c = L.filter((x) => x.e === e && x.cp === cp && (side > 0 ? x.k >= r.c * 1.03 : x.k <= r.c * 0.97)); return c.length ? c.reduce((a, x) => (Math.abs(x.k - tgt) < Math.abs(a.k - tgt) ? x : a)) : null; };
    const want = [['C5', near('C', r.c * 1.05, 1)], ['C10', near('C', r.c * 1.10, 1)], ['P5', near('P', r.c * 0.95, -1)], ['P10', near('P', r.c * 0.90, -1)]], legs = [];
    for (const [tag, x] of want) { if (!x) continue; const h = await uw(`/option-contract/${x.id}/historic`); if (!h) continue; const row = (h.chains ?? []).find((z) => z.date === t0); legs.push({ tag, id: x.id, k: x.k, cp: x.cp, e, ask: row ? +row.nbbo_ask : null, bid: row ? +row.nbbo_bid : null }); }
    out.picks[t] = { ...r, legs }; }
  out.done = !LIMIT; fs.writeFileSync(f, JSON.stringify(out)); console.error(`${t0} picks ${names.size} (${calls} calls)`); }
console.error(`run done ${calls}${LIMIT ? ' (UW limit — re-run after 8pm ET)' : ''}`);
