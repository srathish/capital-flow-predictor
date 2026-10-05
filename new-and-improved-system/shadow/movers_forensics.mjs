#!/usr/bin/env node
// MOVER FORENSICS — 10 biggest 3-month movers (Jul 2 – Oct 2 2026, liquid universe). Could ANYTHING in UW or Skylit have seen it coming?
// Locked 2026-10-05 BEFORE looking at any feature values.
//   Daily panel per stock (each value known at that day's CLOSE; it "predicts" the next 10 sessions):
//     UW  callput (call/put volume) · optvol (options volume ÷ 20d avg) · flow (net call − net put premium, ÷ 60d std) ·
//         askcall (ask-side share of call volume) · gex (UW net gamma, z vs 60d) · vanna (UW net vanna, z vs 60d) ·
//         insiderBuy (open-market buy ≥$100k filed in last 20 sessions) · insiderSell (≥3 discretionary sellers, ≥$5M, 30d) ·
//         analyst (upgrades − downgrades, last 10 sessions) · si (short interest % float, publish-lagged) · earnings (report in next 10 sessions)
//     Skylit (weekly 09:35 gamma map) mapNet (signed gamma within ±5% of spot ÷ total |gamma|; negative = dealers short gamma = "amplify") ·
//         mapSkew (|gamma| above spot − below, ÷ total) · kingDist (king strike vs spot, %)
//     price  stockvol (share volume ÷ 50d avg) · squeeze (20d realized vol percentile vs 250d — LOW = coiled) · rs20 (vs SPY)
//     IV   iv (own 30d implied vol, z vs 60d) · ivPrem (implied ÷ 20d realized, z) — SIZE signals (SirFartalot F1/F2: own IV ranks range)
//   Outcome: next-10-session return r10; BIG = |r10| in that stock's top 5% (Apr 2026 → Sep 2026 panel).
//   Per feature: "fired" = |z| ≥ 2 vs the stock's trailing 60 sessions (binary features: true). Report
//     precision P(BIG | fired) vs base P(BIG), lift, and direction hit-rate (sign(feature) = sign(r10)) on fired days.
//   Plus, for each stock's main burst (best 10-day window): what was lit at T0−1, and the headlines around T0 (attribution).
// Direction claims are judged against the BOARD COIN (SirFartalot): the side most of the 294 universe stocks moved over the same 10
// sessions — in a trending tape that's 60–70%, not 50%. Size claims are judged against trailing realized vol (Spearman with |r10|).
// Warning built in: 10 stocks CHOSEN because they moved — any lift here is a hypothesis to test on the rest of the universe.
import fs from 'node:fs';
import path from 'node:path';
import { UW_API_KEY } from '../feeds/env.js';
import { loadDaily } from '../desk/common.mjs';
import { normalizeBoard } from '../map/board.js';

const HERE = decodeURIComponent(new URL('.', import.meta.url).pathname), ROOT = path.join(HERE, '..'), UC = path.join(ROOT, '.cache', 'uw');
const SYMS = ['MRNA', 'TEAM', 'BMNR', 'MSTR', 'HPE', 'TE', 'SMCI', 'APP', 'VLO', 'OKTA'];
const P0 = '2026-04-01', P1 = '2026-10-02';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); let last = 0;
async function uw(p) { for (let k = 0; k < 5; k++) { const w = 260 - (Date.now() - last); if (w > 0) await sleep(w); last = Date.now();
  const r = await fetch(`https://api.unusualwhales.com/api${p}`, { headers: { Authorization: `Bearer ${UW_API_KEY}`, Accept: 'application/json' } }).catch(() => null);
  if (r?.status === 429) { await sleep(5000 * (k + 1)); continue; } return r?.ok ? r.json().catch(() => null) : null; } return null; }
async function cached(kind, sym, fn) { const f = path.join(UC, kind, `${sym}.json`); if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')); const v = await fn(); if (v != null) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v)); } return v; }

const spy = loadDaily('SPY'), spyMap = new Map(spy.map((b) => [b.d, b]));
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length, sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const z = (hist, v) => { const h = hist.filter(Number.isFinite); if (h.length < 20 || !Number.isFinite(v)) return null; const s = sd(h); return s > 0 ? (v - mean(h)) / s : null; };
const wkly = (d) => { const dow = new Date(d + 'T12:00:00Z').getUTCDay(); let f = new Date(Date.parse(d + 'T12:00:00Z') + ((5 - dow + 7) % 7 + (dow >= 4 ? 7 : 0)) * 864e5).toISOString().slice(0, 10); return f; };

const panel = [], bursts = [];
for (const s of SYMS) {
  const bars = loadDaily(s), ix = new Map(bars.map((b, i) => [b.d, i]));
  const ov = await cached('optvol', s, async () => (await uw(`/stock/${s}/options-volume?limit=500`))?.data ?? null) ?? [];
  const gx = await cached('greeks', s, async () => (await uw(`/stock/${s}/greek-exposure?limit=500`))?.data ?? null) ?? [];
  const ivh = await cached('ivhist', s, async () => (await uw(`/stock/${s}/iv-rank?timespan=1y`))?.data ?? null) ?? [];
  const ivm = new Map(ivh.map((r) => [r.date, +r.volatility]));
  const er = await cached('earnings', s, async () => (await uw(`/earnings/${s}`))?.data ?? null) ?? [];
  const ins = JSON.parse(fs.readFileSync(path.join(UC, 'insider', `${s}.json`), 'utf8')), an = JSON.parse(fs.readFileSync(path.join(UC, 'analyst', `${s}.json`), 'utf8')), si = JSON.parse(fs.readFileSync(path.join(UC, 'si', `${s}.json`), 'utf8'));
  const ovm = new Map(ov.map((r) => [r.date, r])), gxm = new Map(gx.map((r) => [r.date, r]));
  const edates = er.map((r) => r.report_date).filter(Boolean).sort();
  const days = bars.filter((b) => b.d >= P0 && b.d <= P1).map((b) => b.d);
  const series = {}; const put = (k, d, v) => ((series[k] ??= new Map()).set(d, v));
  // raw daily series (also before P0 for z-score history)
  for (const b of bars.filter((x) => x.d >= '2025-10-01')) {
    const d = b.d, o = ovm.get(d), g = gxm.get(d), i = ix.get(d);
    if (o) { const cv = +o.call_volume, pv = +o.put_volume; put('callput', d, pv > 0 ? Math.log(cv / pv) : null); put('optvolRaw', d, cv + pv); put('flowRaw', d, (+o.net_call_premium) - (+o.net_put_premium)); put('askcall', d, cv > 0 ? (+o.call_volume_ask_side) / cv : null); }
    if (g) { put('gex', d, (+g.call_gamma) + (+g.put_gamma)); put('vanna', d, (+g.call_vanna) + (+g.put_vanna)); }
    if (ivm.has(d)) put('iv', d, ivm.get(d));
    if (i >= 50) { put('stockvol', d, (b.v || 0) / mean(bars.slice(i - 50, i).map((x) => x.v || 0))); }
    if (i >= 21) { const r = (k) => Math.log(bars[k].c / bars[k - 1].c), rv = sd(Array.from({ length: 20 }, (_, k) => r(i - k))); put('rv20', d, rv); const sp = spyMap.get(d), sp20 = spyMap.get(bars[i - 20].d); if (sp && sp20) put('rs20', d, bars[i].c / bars[i - 20].c - (sp.c / sp20.c)); }
  }
  const keys = [...(series.optvolRaw?.keys() ?? [])];
  for (const d of days) {
    const i = ix.get(d); if (i + 10 >= bars.length) continue;
    const prior = (k, n) => { const m = series[k]; if (!m) return []; return bars.slice(Math.max(0, i - n), i).map((b) => m.get(b.d)).filter((v) => v != null && Number.isFinite(v)); };
    const cur = (k) => series[k]?.get(d);
    const row = { s, d, r10: bars[i + 10].c / bars[i].c - 1 };
    row.callput = z(prior('callput', 60), cur('callput'));
    const ovr = prior('optvolRaw', 20); row.optvol = ovr.length >= 10 && cur('optvolRaw') ? Math.log(cur('optvolRaw') / mean(ovr)) / 0.35 : null; // ≈ z (log-ratio / typical dispersion)
    row.flow = z(prior('flowRaw', 60).map(() => 0).length ? prior('flowRaw', 60) : [], cur('flowRaw'));
    row.askcall = z(prior('askcall', 60), cur('askcall'));
    row.gex = z(prior('gex', 60), cur('gex')); row.vanna = z(prior('vanna', 60), cur('vanna'));
    row.stockvol = cur('stockvol') != null ? Math.log(cur('stockvol')) / 0.35 : null;
    const rvh = prior('rv20', 250); row.squeeze = rvh.length > 100 && cur('rv20') != null ? -z(rvh, cur('rv20')) : null; // positive = unusually LOW vol (coiled)
    row.rs20 = z(prior('rs20', 120), cur('rs20'));
    row.iv = z(prior('iv', 60), cur('iv')); row.ivRaw = cur('iv') ?? null; row.rvRaw = cur('rv20') != null ? cur('rv20') * Math.sqrt(252) : null;
    { const ivp = (k) => { const a = series.iv?.get(bars[k]?.d), b = series.rv20?.get(bars[k]?.d); return a != null && b ? a / (b * Math.sqrt(252)) : null; }; const h = Array.from({ length: 60 }, (_, k) => ivp(i - 1 - k)).filter((x) => x != null); row.ivPrem = z(h, ivp(i)); }
    const back20 = bars[Math.max(0, i - 20)].d, back30 = new Date(Date.parse(d) - 30 * 864e5).toISOString().slice(0, 10);
    row.insiderBuy = ins.some((t) => t.code === 'P' && t.f > back20 && t.f <= d && t.sh * t.px >= 1e5);
    const sells = ins.filter((t) => t.code === 'S' && !t.plan && t.f > back30 && t.f <= d); row.insiderSell = new Set(sells.map((t) => t.who)).size >= 3 && sells.reduce((a, t) => a + t.sh * t.px, 0) >= 5e6;
    const back10 = bars[Math.max(0, i - 10)].d, aa = an.filter((a) => a.ts.slice(0, 10) > back10 && a.ts.slice(0, 10) <= d);
    row.analyst = aa.filter((a) => a.action === 'upgraded').length - aa.filter((a) => a.action === 'downgraded').length;
    const lastSi = si.filter((x) => { const k = ix.get(bars.find((b) => b.d >= x.d)?.d); return k != null && k + 9 <= i; }).sort((a, b) => a.d.localeCompare(b.d)).at(-1); row.si = lastSi ? lastSi.si : null;
    const ahead = bars[Math.min(bars.length - 1, i + 10)].d; row.earnings = edates.some((e) => e > d && e <= ahead);
    // Skylit weekly map at 09:35 of d
    const mf = fs.readdirSync(path.join(ROOT, '.cache', 'stock', s)).find((f) => f.startsWith(`${d}_`) && /^\d{4}-\d\d-\d\d_\d{4}-\d\d-\d\d\.json$/.test(f));
    if (mf) { const raw = JSON.parse(fs.readFileSync(path.join(ROOT, '.cache', 'stock', s, mf), 'utf8'));
      if (raw?.strikes?.length) { const sp = raw.spot, near = raw.strikes.filter((x) => Number.isFinite(x.value) && Math.abs(x.strike - sp) / sp <= 0.05), tot = near.reduce((a, x) => a + Math.abs(x.value), 0) || 1;
        row.mapNet = near.reduce((a, x) => a + x.value, 0) / tot; row.mapSkew = (near.filter((x) => x.strike > sp).reduce((a, x) => a + Math.abs(x.value), 0) - near.filter((x) => x.strike < sp).reduce((a, x) => a + Math.abs(x.value), 0)) / tot;
        const king = raw.strikes.find((x) => x.nodeType === 'king'); row.kingDist = king ? (king.strike - sp) / sp : null; } }
    panel.push(row);
  }
  // main burst
  const win = bars.filter((b) => b.d >= '2026-07-02' && b.d <= P1); let best = null; for (let k = 0; k + 10 < win.length; k++) { const r = win[k + 10].c / win[k].c - 1; if (!best || Math.abs(r) > Math.abs(best.r)) best = { r, T0: win[k].d, T1: win[k + 10].d }; }
  // headlines around T0 (attribution, not prediction)
  const news = []; for (let p = 0; p < 12; p++) { const j = await uw(`/news/headlines?ticker=${s}&limit=100&page=${p}`); const d = j?.data ?? []; if (!d.length) break; news.push(...d.filter((h) => (h.tickers ?? []).includes(s))); if (d.at(-1).created_at.slice(0, 10) < new Date(Date.parse(best.T0) - 7 * 864e5).toISOString().slice(0, 10)) break; }
  const lo = new Date(Date.parse(best.T0) - 5 * 864e5).toISOString().slice(0, 10), hi = new Date(Date.parse(best.T0) + 4 * 864e5).toISOString().slice(0, 10);
  bursts.push({ s, ...best, news: news.filter((h) => h.created_at.slice(0, 10) >= lo && h.created_at.slice(0, 10) <= hi).slice(0, 8).map((h) => `${h.created_at.slice(5, 10)} ${h.headline.slice(0, 120)}`), newsReach: news.at(-1)?.created_at?.slice(0, 10), earnNear: edates.filter((e) => e >= lo && e <= hi) });
  console.error(`… ${s}: ${panel.filter((r) => r.s === s).length} days, burst ${best.T0} ${(best.r * 100).toFixed(0)}%`);
}
fs.writeFileSync(path.join(HERE, 'journal', 'movers_panel.json'), JSON.stringify({ panel, bursts }));

// BIG threshold per stock
for (const s of SYMS) { const R = panel.filter((r) => r.s === s).map((r) => Math.abs(r.r10)).sort((a, b) => a - b); const thr = R[Math.floor(R.length * 0.95)]; for (const r of panel.filter((x) => x.s === s)) r.big = Math.abs(r.r10) >= thr; }
const base = panel.filter((r) => r.big).length / panel.length;
const FEAT = { iv: 'z', ivPrem: 'z', callput: 'z', optvol: 'z', flow: 'z', askcall: 'z', gex: 'z', vanna: 'z', stockvol: 'z', squeeze: 'z', rs20: 'z', mapNet: 'raw', mapSkew: 'raw', insiderBuy: 'bool', insiderSell: 'bool', earnings: 'bool', analyst: 'count', si: 'si' };
const fired = (f, r) => { const v = r[f]; if (v == null) return null; switch (FEAT[f]) { case 'z': return Math.abs(v) >= 2 ? Math.sign(v) : 0; case 'raw': return f === 'mapNet' ? (v <= -0.3 ? -1 : 0) : Math.abs(v) >= 0.5 ? Math.sign(v) : 0; case 'bool': return v ? 1 : 0; case 'count': return v !== 0 ? Math.sign(v) : 0; case 'si': return v >= 0.15 ? 1 : 0; } };
console.log(`\nMOVER FORENSICS · ${SYMS.join(' ')} · ${panel.length} stock-days ${P0}→${P1} · BIG = |next-10d move| in the stock's top 5% · base rate ${(base * 100).toFixed(1)}%\n`);
console.log(`${'feature'.padEnd(12)} fired-days  P(BIG|fired)  lift   direction right (fired & BIG)   note`);
const res = [];
for (const f of Object.keys(FEAT)) {
  const X = panel.map((r) => [r, fired(f, r)]).filter(([, v]) => v != null), F = X.filter(([, v]) => v !== 0), FB = F.filter(([r]) => r.big);
  const prec = F.length ? FB.length / F.length : NaN, dirOk = FB.filter(([r, v]) => (['mapNet', 'earnings', 'si', 'optvol', 'stockvol', 'squeeze', 'iv', 'ivPrem'].includes(f)) ? true : Math.sign(r.r10) === v).length;
  res.push({ f, n: F.length, prec, lift: prec / base });
  console.log(`  ${f.padEnd(12)} ${String(F.length).padStart(5)}/${String(X.length).padEnd(5)} ${(prec * 100).toFixed(1).padStart(8)}%   ${(prec / base).toFixed(2).padStart(5)}×   ${FB.length ? `${dirOk}/${FB.length}` : '-'}${['optvol', 'stockvol', 'squeeze', 'earnings', 'si', 'mapNet', 'iv', 'ivPrem'].includes(f) ? ' (size-only signal)' : ''}`);
}
// BOARD COIN for direction: majority sign of the universe's next-10-session returns from the same day
{ const { universe } = await import('../desk/common.mjs'); const U = universe(), maj = new Map();
  for (const d of [...new Set(panel.map((r) => r.d))]) { let up = 0, dn = 0; for (const u of U) { const b = loadDaily(u), k = b.findIndex((x) => x.d === d); if (k < 0 || k + 10 >= b.length) continue; (b[k + 10].c > b[k].c ? up++ : dn++); } maj.set(d, up >= dn ? 1 : -1); }
  const coin = panel.filter((r) => Math.sign(r.r10) === maj.get(r.d)).length / panel.length;
  console.log(`\nDIRECTION vs the BOARD COIN (bet with the universe's majority side each day): coin is right ${(coin * 100).toFixed(1)}% of all stock-days`);
  for (const f of ['callput', 'flow', 'askcall', 'gex', 'vanna', 'rs20', 'mapSkew', 'insiderBuy', 'insiderSell', 'analyst']) {
    const F = panel.map((r) => [r, fired(f, r)]).filter(([, v]) => v != null && v !== 0); if (!F.length) continue;
    const sgn = (v) => (f === 'insiderSell' ? -1 : v), right = F.filter(([r, v]) => Math.sign(r.r10) === sgn(v)).length / F.length, coinOnSame = F.filter(([r]) => Math.sign(r.r10) === maj.get(r.d)).length / F.length;
    console.log(`  ${f.padEnd(12)} fired ${String(F.length).padStart(4)} · direction right ${(right * 100).toFixed(1)}% vs board coin on the same days ${(coinOnSame * 100).toFixed(1)}%  ${right > coinOnSame + 0.05 ? '← beats coin by 5pp' : ''}`);
  } }
// SIZE: does own IV rank the next-10-day |move| better than trailing realized vol? (Spearman within each stock)
const spear = (xs, ys) => { const rk = (a) => { const o = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]), r = Array(a.length); o.forEach(([, i], k) => (r[i] = k)); return r; }; const a = rk(xs), b = rk(ys), n = xs.length, m = (n - 1) / 2; let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { num += (a[i] - m) * (b[i] - m); da += (a[i] - m) ** 2; db += (b[i] - m) ** 2; } return num / Math.sqrt(da * db); };
console.log('\nSIZE: rank correlation with the next-10-day |move| (within each stock) — own implied vol vs trailing 20d realized vol');
let ivWins = 0, nS = 0;
for (const s of SYMS) { const R = panel.filter((r) => r.s === s && r.ivRaw != null && r.rvRaw != null); if (R.length < 40) continue; const a = spear(R.map((r) => r.ivRaw), R.map((r) => Math.abs(r.r10))), b = spear(R.map((r) => r.rvRaw), R.map((r) => Math.abs(r.r10))); nS++; if (a > b) ivWins++;
  console.log(`  ${s.padEnd(5)} IV ρ ${a.toFixed(2).padStart(5)} · realized ρ ${b.toFixed(2).padStart(5)} ${a > b ? '← IV better' : ''}`); }
console.log(`  IV ranked size better on ${ivWins} of ${nS} stocks`);
console.log('\n— each stock\'s main burst: what was lit the day before it started (|z|≥2 or flag), and the news around it —');
for (const b of bursts) {
  const r = panel.find((x) => x.s === b.s && x.d < b.T0 && panel.filter((y) => y.s === b.s && y.d < b.T0).at(-1) === x) ?? panel.filter((x) => x.s === b.s && x.d < b.T0).at(-1);
  const lit = r ? Object.keys(FEAT).filter((f) => { const v = fired(f, r); return v != null && v !== 0; }).map((f) => `${f}${typeof r[f] === 'number' ? `(${r[f].toFixed(2)})` : ''}`) : [];
  console.log(`\n${b.s} ${(b.r * 100).toFixed(0)}% ${b.T0}→${b.T1}${b.earnNear.length ? ` · EARNINGS ${b.earnNear.join(',')}` : ''}\n  lit on ${r?.d ?? '-'}: ${lit.join(' · ') || 'nothing'}\n  news (reach back to ${b.newsReach ?? '-'}): ${b.news.length ? '\n    ' + b.news.join('\n    ') : 'none in window'}`);
}
