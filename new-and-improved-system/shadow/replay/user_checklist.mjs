#!/usr/bin/env node
// User checklist v1 (DESIGN_user_checklist.md): trade toward a stable, non-shrinking king with the ATM 0DTE option; exit at the king,
// on a king move against the trade, at -50% on the option, or 15:50. Writes s.rules (CORE, from 10:00) and s.rulesLate (from 12:00)
// into the replay file for the given month only. Usage: node user_checklist.mjs [file] [month]
import fs from 'node:fs';
import { UW_API_KEY } from '../../feeds/env.js';
const FILE = process.argv[2] ?? 'skylit_all.json', MONTH = process.argv[3] ?? '2026-03';
const F = new URL('./' + FILE, import.meta.url), D = JSON.parse(fs.readFileSync(F, 'utf8'));
const CACHE = new URL('../../.cache/uwopt_intraday/', import.meta.url); fs.mkdirSync(CACHE, { recursive: true });
const et = (iso) => { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(iso)); return +p.find((x) => x.type === 'hour').value * 60 + +p.find((x) => x.type === 'minute').value; };
async function optRows(T, d, K, cp) {
  const id = `${T}${d.slice(2, 4)}${d.slice(5, 7)}${d.slice(8, 10)}${cp}${String(K * 1000).padStart(8, '0')}`, f = new URL(`${id}_${d}.json`, CACHE);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  await new Promise((r) => setTimeout(r, 130));
  const r = await fetch(`https://api.unusualwhales.com/api/option-contract/${id}/intraday?date=${d}`, { headers: { Authorization: `Bearer ${UW_API_KEY}` } }).catch(() => null);
  if (!r?.ok) return null;
  const rows = ((await r.json()).data ?? []).map((q) => ({ m: et(q.start_time), c: +q.close, h: +q.high, l: +q.low })).filter((q) => q.c > 0).sort((a, b) => a.m - b.m);
  fs.writeFileSync(f, JSON.stringify(rows)); return rows;
}
const hm = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
async function run(s, from) {
  const B = new Map(s.bars.map((b) => [b[0], b])), M = s.maps, out = [];
  const px = (m) => B.get(m - 1)?.[4] ?? null;
  let i = 0, busyUntil = -1;
  for (i = 0; i < M.length; i++) {
    const [m, K, nodes] = M[i];
    if (m < from || m > 870 || m <= busyUntil || out.length >= 2 || K == null) continue;
    let ten = 0; for (let j = i; j >= 0 && M[j][1] === K; j--) ten++;
    let flips = 0; for (let j = Math.max(1, i - 59); j <= i; j++) if (M[j][1] !== M[j - 1][1]) flips++;
    const kn = nodes.find((n) => n[0] === K), d15 = kn ? kn[2] : null, p = px(m);
    if (ten < 20 || flips > 3 || d15 == null || d15 < 0 || p == null) continue;
    const dist = (K - p) / p; if (Math.abs(dist) < 0.0025 || Math.abs(dist) > 0.015) continue;
    const dir = K > p ? 1 : -1, cp = dir > 0 ? 'C' : 'P', strike = Math.round(p);
    const rows = await optRows(s.T, s.d, strike, cp); if (!rows) continue;
    const en = rows.find((q) => q.m >= m); if (!en || en.m > m + 2) continue;
    const R = new Map(rows.map((q) => [q.m, q])), optAt = (bm) => rows.filter((q) => q.m <= bm).at(-1);
    let tgt = K, cand = null, candN = 0, ex = null;
    for (let bm = m; bm <= 950; bm++) {
      const q = R.get(bm), b = B.get(bm);
      if (q && q.m > en.m && q.l <= en.c * 0.5) { ex = { m: bm, px: +(en.c * 0.5).toFixed(2), how: 'stop −50%' }; break; }
      if (b && (dir > 0 ? b[2] >= tgt * 0.9995 : b[3] <= tgt * 1.0005)) { ex = { m: bm, px: optAt(bm)?.c, how: `reached king ${tgt}` }; break; }
      const fr = M.find((x) => x[0] === bm);
      if (fr && fr[1] != null && fr[1] !== tgt) { if (fr[1] === cand) candN++; else { cand = fr[1]; candN = 1; } } else if (fr) { cand = null; candN = 0; }
      if (candN >= 5) { const pp = px(bm) ?? b?.[4]; if (dir * (cand - pp) < 0) { ex = { m: bm, px: optAt(bm)?.c, how: `king moved to ${cand}, against the trade` }; break; } tgt = cand; cand = null; candN = 0; }
      if (bm === 950) ex = { m: 950, px: optAt(950)?.c, how: '15:50 close' };
    }
    if (!ex || ex.px == null) continue;
    const held = rows.filter((q) => q.m > en.m && q.m <= ex.m), pk = held.length ? held.reduce((a, q) => (q.h > a.h ? q : a)) : null;
    const day = rows.filter((q) => q.m > en.m && q.m <= 959), pd = day.length ? day.reduce((a, q) => (q.h > a.h ? q : a)) : null;
    const g0 = Math.abs(kn[1]);
    const path = M.filter((x) => x[0] > m && x[0] <= 955).map((x) => { const n = x[2].find((y) => y[0] === K); const kv = x[2].find((y) => y[0] === x[1]); return [x[0], n && kv ? +((Math.abs(n[1]) / g0)).toFixed(3) : null, null, px(x[0]) ?? 0]; });
    out.push({ m, dir, level: null, next: K, entry: +p.toFixed(2), target: K, stop: null, exitM: ex.m, exit: B.get(ex.m)?.[4] ?? null, how: ex.how, R: 0, d15, why: `king ${K} (+${d15}% in 15m, king for ${ten} min, ${flips} flips in the last hour) is ${(dist * 100).toFixed(2)}% ${dir > 0 ? 'above' : 'below'}`,
      optPath: rows.filter((q) => q.m >= en.m && q.m <= 955).map((q) => [q.m, q.l, q.h, q.c]), path,
      opt: { contract: `${s.T} ${strike}${cp}`, strike, type: cp === 'C' ? 'call' : 'put', entryPx: en.c, entryM: en.m, exitPx: ex.px, pct: Math.round((ex.px / en.c - 1) * 100), peakHeld: pk ? { px: pk.h, m: pk.m, pct: Math.round((pk.h / en.c - 1) * 100) } : null, peakDay: pd ? { px: pd.h, m: pd.m, pct: Math.round((pd.h / en.c - 1) * 100) } : null } });
    busyUntil = ex.m;
  }
  return out;
}
const lines = [];
for (const s of D.sessions) {
  if (!s.d.startsWith(MONTH)) continue;
  s.rules = await run(s, 600); s.rulesLate = await run(s, 720);
  for (const [lab, arr] of [['CORE', s.rules], ['LATE', s.rulesLate]]) for (const x of arr) lines.push([s.d, s.T, lab, hm(x.m), x.opt.contract, x.opt.entryPx, x.opt.exitPx, x.opt.pct, hm(x.exitM), x.how, x.opt.peakHeld?.pct ?? '', x.why].join('\t'));
}
D.rulesMeta = { month: MONTH, design: 'DESIGN_user_checklist.md v1', built: new Date().toISOString() };
fs.writeFileSync(F, JSON.stringify(D));
fs.writeFileSync(new URL('./user_checklist_trades.tsv', import.meta.url), ['day\tT\tvariant\tentry\tcontract\tin\tout\tpct\texit\thow\tpeakHeld%\twhy', ...lines].join('\n') + '\n');
console.log(lines.length, 'trades written');
