#!/usr/bin/env node
// DESIGN_dispersion.md: QQQ weekly ATM straddle quotes at each week's last close → .cache/ssprem/QQQ.json (W entries only).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UW_API_KEY } from '../feeds/env.js';
const C = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.cache'), f = path.join(C, 'ssprem', 'QQQ.json'), out = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
const uw = async (p) => { for (let k = 0; k < 4; k++) { await new Promise((r) => setTimeout(r, 110)); const r = await fetch(`https://api.unusualwhales.com/api${p}`, { headers: { Authorization: `Bearer ${UW_API_KEY}` } }).catch(() => null); if (r?.ok) return r.json(); if (r?.status === 404) return { data: [], chains: [] }; await new Promise((q) => setTimeout(q, 2000)); } return null; };
const parse = (s) => { const m = s.match(/^(.+?)(\d{6})([CP])(\d{8})$/); return m ? { e: `20${m[2].slice(0, 2)}-${m[2].slice(2, 4)}-${m[2].slice(4, 6)}`, cp: m[3], k: +m[4] / 1000, id: s } : null; };
const wk = (d) => { const x = new Date(d + 'T12:00:00Z'), day = (x.getUTCDay() + 6) % 7; return new Date(x.getTime() - day * 864e5).toISOString().slice(0, 10); };
const bars = JSON.parse(fs.readFileSync(path.join(C, 'uwgreeks', 'QQQ_ohlc.json'), 'utf8')).filter((b) => b.d >= '2023-11-10' && b.d <= '2026-10-15');
for (let i = 0; i < bars.length - 1; i++) { const t0 = bars[i].d; if (wk(bars[i + 1].d) === wk(t0)) continue; const key = `${t0}|W`; if (key in out) continue; const S = bars[i].c;
  const ch = await uw(`/stock/QQQ/option-chains?date=${t0}`); if (!ch) continue; const L = (ch.data ?? []).map(parse).filter(Boolean);
  const e = [...new Set(L.map((x) => x.e))].filter((x) => { const g = (Date.parse(x) - Date.parse(t0)) / 864e5; return g >= 3 && g <= 9; }).sort().at(-1); /* the week's Friday, not a Mon/Wed daily */
  if (!e) { out[key] = null; continue; } const ks = [...new Set(L.filter((x) => x.e === e).map((x) => x.k))]; const atm = ks.reduce((a, k) => (Math.abs(k - S) < Math.abs(a - S) ? k : a), ks[0]); const legs = {};
  for (const cp of ['C', 'P']) { const id = L.find((x) => x.e === e && x.cp === cp && x.k === atm)?.id; if (!id) continue; const h = await uw(`/option-contract/${id}/historic`); const r = (h?.chains ?? []).find((z) => z.date === t0); legs[cp] = r ? { k: atm, bid: +r.nbbo_bid, ask: +r.nbbo_ask } : null; }
  out[key] = { e, S, legs }; }
fs.writeFileSync(f, JSON.stringify(out)); console.log('QQQ weeks', Object.keys(out).length);
