#!/usr/bin/env node
// DESIGN_king_pin_fly.md: price the king fly and the control fly with real UW minute prices; test P1/P2.
import fs from 'node:fs';
import { UW_API_KEY } from '../feeds/env.js';
const R = new URL('./results_kingfly/', import.meta.url), trig = JSON.parse(fs.readFileSync(new URL('triggers.json', R), 'utf8'));
const et = (iso) => { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(iso)); return +p.find((x) => x.type === 'hour').value * 60 + +p.find((x) => x.type === 'minute').value; };
const cache = new Map();
async function px(T, d, k, m) { const id = `${T}${d.slice(2, 4)}${d.slice(5, 7)}${d.slice(8, 10)}C${String(Math.round(k * 1000)).padStart(8, '0')}`; if (!cache.has(id)) { await new Promise((r) => setTimeout(r, 120)); const r = await fetch(`https://api.unusualwhales.com/api/option-contract/${id}/intraday?date=${d}`, { headers: { Authorization: `Bearer ${UW_API_KEY}` } }).catch(() => null); cache.set(id, r?.ok ? ((await r.json()).data ?? []).map((q) => ({ m: et(q.start_time), c: +q.close })).filter((q) => q.c > 0) : []); }
  const row = cache.get(id).filter((q) => q.m >= m && q.m <= m + 2).sort((a, b) => a.m - b.m)[0]; return row ? row.c : null; }
const closeOf = (T, d) => { const f = new URL(`../.cache/uw/m1/${T}/${d}.json`, import.meta.url); if (!fs.existsSync(f)) return null; const b = JSON.parse(fs.readFileSync(f, 'utf8')).filter((x) => x.m === 'r').sort((a, c) => a.t - c.t); return b.at(-1)?.c ?? null; };
async function fly(T, d, K, m, S) { const a = await px(T, d, K - 2, m), b = await px(T, d, K, m), c = await px(T, d, K + 2, m); if (a == null || b == null || c == null) return null; const debit = (a + 0.01) - 2 * (b - 0.01) + (c + 0.01); if (!(debit > 0)) return null;
  const pay = Math.max(0, S - (K - 2)) - 2 * Math.max(0, S - K) + Math.max(0, S - (K + 2)); return { debit: +debit.toFixed(3), pay: +pay.toFixed(3), r: pay / debit - 1 }; }
const rows = [];
for (const t of trig) { const S = closeOf(t.T, t.d); if (S == null) continue; const k = await fly(t.T, t.d, t.king, t.m, S), c = await fly(t.T, t.d, t.ctrl, t.m, S); rows.push({ ...t, close: S, king: t.king, kf: k, cf: c }); }
fs.writeFileSync(new URL('trades.json', R), JSON.stringify(rows, null, 1));
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length, Phi = (x) => 0.5 * (1 + Math.sign(x) * Math.sqrt(1 - Math.exp(-2 * x * x / Math.PI)));
const st = (v) => { const m = mean(v), sd = Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1)); return { n: v.length, m, t: m / (sd / Math.sqrt(v.length)) }; };
const per = (lo, hi) => rows.filter((r) => r.d >= lo && r.d <= hi && r.kf), L = ['# King-pin butterfly — results', ''];
for (const [name, lo, hi] of [['build Dec–Feb', '0', '2026-02-27'], ['holdout Mar–May', '2026-03-02', '9']]) { const a = per(lo, hi), pr = a.filter((r) => r.cf);
  const p1 = st(a.map((r) => r.kf.r)), p2 = st(pr.map((r) => r.kf.r - r.cf.r)); let bal = 10000; for (const r of a) { const q = Math.floor(200 / (r.kf.debit * 100)); if (q >= 1) bal += q * 100 * (r.kf.pay - r.kf.debit) - 4 * 0.65 * 2 * q; }
  L.push(`## ${name}`, `- King fly: ${p1.n} trades, mean ${(p1.m * 100).toFixed(1)}% per fly (t ${p1.t.toFixed(2)}, p ${(1 - Phi(p1.t)).toFixed(3)}), win rate ${Math.round(100 * a.filter((r) => r.kf.r > 0).length / a.length)}%, median ${(a.map((r) => r.kf.r).sort((x, y) => x - y)[a.length >> 1] * 100).toFixed(0)}%`,
    `- King fly minus control fly (paired, ${p2.n}): ${(p2.m * 100).toFixed(1)} pts (t ${p2.t.toFixed(2)}, p ${(1 - Phi(p2.t)).toFixed(3)}); control mean ${(mean(pr.map((r) => r.cf.r)) * 100).toFixed(1)}%`,
    `- $10,000 account, $200 per fly, $0.65/contract commission: ${(bal / 100 - 100).toFixed(1)}% → $${bal.toFixed(0)}`, ''); }
fs.writeFileSync(new URL('summary.md', R), L.join('\n') + '\n'); console.log(L.join('\n'));
