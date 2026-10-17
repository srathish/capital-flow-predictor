#!/usr/bin/env node
// DESIGN_flow_fly.md feature: customer net buying (ask − bid volume) of the ATM call+put expiring d, over rows dated ≤ d−1. → .cache/flowfly/{T}.jsonl
import fs from 'node:fs';
import { UW_API_KEY } from '../feeds/env.js';
const C = new URL('../.cache/', import.meta.url), OUT = new URL('flowfly/', C); fs.mkdirSync(OUT, { recursive: true });
let LIMIT = false;
const uw = async (p) => { for (let k = 0; k < 4 && !LIMIT; k++) { await new Promise((r) => setTimeout(r, 120)); const r = await fetch('https://api.unusualwhales.com/api' + p, { headers: { Authorization: `Bearer ${UW_API_KEY}` } }).catch(() => null);
  if (r?.status === 429) { const b = await r.text().catch(() => ''); if (b.includes('daily_request_limit_hit')) { LIMIT = true; console.log('UW daily limit'); return null; } await new Promise((x) => setTimeout(x, 4000)); continue; }
  if (r?.status === 404 || r?.status === 422) return null; if (!r?.ok) { await new Promise((x) => setTimeout(x, 1500)); continue; } return r.json().catch(() => null); } return null; };
const occ = (T, d, cp, k) => `${T}${d.slice(2, 4)}${d.slice(5, 7)}${d.slice(8, 10)}${cp}${String(Math.round(k * 1000)).padStart(8, '0')}`;
for (const T of ['SPY', 'QQQ', 'IWM', 'DIA']) {
  const f = new URL(`${T}.jsonl`, OUT), have = new Set(fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).d) : []);
  const days = fs.readdirSync(new URL(`straddle/${T}/`, C)).filter((x) => x.endsWith('.json')).sort(); let n = 0;
  for (const fn of days) { if (LIMIT) break; const S = JSON.parse(fs.readFileSync(new URL(`straddle/${T}/${fn}`, C), 'utf8')), d = S.d ?? fn.slice(0, 10); if (have.has(d) || !S.t1?.strike) continue;
    const prevD = (S.t1.call ?? []).map((r) => r.date).filter((x) => x < d).sort().at(-1); const out = { d, prevD, strike: S.t1.strike };
    for (const cp of ['C', 'P']) { const j = await uw(`/option-contract/${occ(T, d, cp, S.t1.strike)}/historic`); const rows = (j?.chains ?? []).filter((r) => prevD && r.date <= prevD);
      out[cp] = { rows: rows.length, nb: rows.reduce((s, r) => s + (+r.ask_volume || 0) - (+r.bid_volume || 0), 0), vol: rows.reduce((s, r) => s + (+r.volume || 0), 0), first: rows.map((r) => r.date).sort()[0] ?? null }; }
    fs.appendFileSync(f, JSON.stringify(out) + '\n'); if (++n % 100 === 0) console.log(T, n); }
  console.log(T, 'done', n);
}
