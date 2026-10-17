#!/usr/bin/env node
// DESIGN_earnings_fly.md collector: per earnings event, the chain on entry day E, then daily NBBO history for body call/put + wing call/put.
// → .cache/earnfly/{T}.jsonl (one line per event). Resumable; stops cleanly at the UW daily limit.
import fs from 'node:fs';
import { UW_API_KEY } from '../feeds/env.js';
const C = new URL('../.cache/', import.meta.url), OUT = new URL('earnfly/', C); fs.mkdirSync(OUT, { recursive: true });
let LIMIT = false, calls = 0;
const uw = async (p) => { for (let k = 0; k < 4 && !LIMIT; k++) { await new Promise((r) => setTimeout(r, 110)); calls++; const r = await fetch('https://api.unusualwhales.com/api' + p, { headers: { Authorization: `Bearer ${UW_API_KEY}` } }).catch(() => null);
  if (r?.status === 429) { const b = await r.text().catch(() => ''); if (b.includes('daily_request_limit_hit')) { LIMIT = true; console.log('UW daily limit — stopping; rerun tomorrow to resume'); return null; } await new Promise((x) => setTimeout(x, 4000)); continue; }
  if (r?.status === 404 || r?.status === 422) return null; if (!r?.ok) { await new Promise((x) => setTimeout(x, 1500)); continue; } return r.json().catch(() => null); } return null; };
const parse = (id) => { const m = id.match(/^([A-Z.]+?)(\d{6})([CP])(\d{8})$/); return m ? { exp: `20${m[2].slice(0, 2)}-${m[2].slice(2, 4)}-${m[2].slice(4, 6)}`, cp: m[3], K: +m[4] / 1000 } : null; };
export function loadBars(T) { const m = new Map();
  const df = new URL(`daily/${T}.json`, C); if (fs.existsSync(df)) for (const b of JSON.parse(fs.readFileSync(df, 'utf8'))) m.set(new Date(b.t * 1000).toISOString().slice(0, 10), +b.c);
  const wf = new URL(`winners/${T}.json`, C); if (fs.existsSync(wf)) for (const b of JSON.parse(fs.readFileSync(wf, 'utf8')).ohlc ?? []) m.set(b.d ?? b.date, +(b.c ?? b.close));
  const bars = [...m.entries()].map(([d, c]) => ({ d, c })).filter((b) => b.d && b.c > 0).sort((a, b) => a.d.localeCompare(b.d)); return bars.length >= 50 ? bars : null; }
const EV = JSON.parse(fs.readFileSync(new URL('lottery_earnings.json', C), 'utf8'));
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) for (const T of Object.keys(EV)) {
  if (LIMIT) break;
  const bars = loadBars(T); if (!bars) continue;
  if (bars.length < 50) continue; const di = new Map(bars.map((b, i) => [b.d, i]));
  const f = new URL(`${T}.jsonl`, OUT), have = new Set(fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).rd) : []);
  for (const e of EV[T]) {
    if (LIMIT) break; if (e.d < '2024-01-01' || e.d > '2026-10-09' || have.has(e.d)) continue;
    let iE = di.get(e.d); if (iE == null) { const k = bars.findIndex((b) => b.d > e.d); iE = k < 0 ? null : k; } if (iE == null) continue;
    if (e.when !== 'postmarket') iE -= 1; if (iE < 0 || iE + 1 >= bars.length) continue;
    const E = bars[iE].d, X = bars[iE + 1].d, S = bars[iE].c, out = { rd: e.d, when: e.when, E, X, S, Sx: bars[iE + 1].c };
    const ch = await uw(`/stock/${T}/option-chains?date=${E}`); const ids = (ch?.data ?? []).map((id) => ({ id, ...parse(id) })).filter((x) => x.exp && x.exp >= X);
    if (!ids.length) { out.skip = 'chain'; fs.appendFileSync(f, JSON.stringify(out) + '\n'); continue; }
    const exp = ids.map((x) => x.exp).sort()[0], ex = ids.filter((x) => x.exp === exp), Ks = [...new Set(ex.map((x) => x.K))].sort((a, b) => a - b);
    const body = Ks.reduce((a, b) => (Math.abs(b - S) < Math.abs(a - S) ? b : a)); out.exp = exp; out.body = body;
    const hist = async (K, cp) => { const x = ex.find((q) => q.K === K && q.cp === cp); if (!x) return null; const j = await uw(`/option-contract/${x.id}/historic`); return (j?.chains ?? []).filter((r) => r.date === E || r.date === X).map((r) => ({ date: r.date, bid: +r.nbbo_bid, ask: +r.nbbo_ask, last: +r.last_price, vol: +r.volume })); };
    const bc = await hist(body, 'C'), bp = await hist(body, 'P'); out.bc = bc; out.bp = bp;
    const q = (rows, d) => rows?.find((r) => r.date === d); const c0 = q(bc, E), p0 = q(bp, E);
    if (!c0 || !p0 || !(c0.bid > 0) || !(p0.bid > 0)) { out.skip = 'bodyquote'; fs.appendFileSync(f, JSON.stringify(out) + '\n'); continue; }
    const imp = ((c0.bid + c0.ask) / 2 + (p0.bid + p0.ask) / 2) / S; out.imp = imp;
    const wc = Ks.find((k) => k >= S * (1 + 1.2 * imp)), wp = [...Ks].reverse().find((k) => k <= S * (1 - 1.2 * imp)); out.wc = wc ?? null; out.wp = wp ?? null;
    if (wc == null || wp == null) { out.skip = 'wings'; fs.appendFileSync(f, JSON.stringify(out) + '\n'); continue; }
    out.lc = await hist(wc, 'C'); out.lp = await hist(wp, 'P');
    fs.appendFileSync(f, JSON.stringify(out) + '\n');
  }
  console.log(T, 'calls so far', calls);
}
console.log('done; calls', calls, LIMIT ? '(stopped at daily limit)' : '');
