// Stage B data (DESIGN_overnight_gap.md A2): for every SPY/QQQ session d in 2025-05-01 → 2026-10-16, the ATM straddle expiring
// the next session (strike nearest the 15:55 close), UW minute prices on d (entry) and d+1 (exit). Cached in
// .cache/uwopt_intraday/<CONTRACT>_<date>.json (same layout as earlier tests). UW calls only.
//   node shadow/fetch_1dte_straddle.mjs
import fs from 'node:fs';
import path from 'node:path';
import { UW_API_KEY } from '../feeds/env.js';

const NIS = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..');
const OC = path.join(NIS, '.cache', 'uwopt_intraday'); fs.mkdirSync(OC, { recursive: true });
const H = { Authorization: `Bearer ${UW_API_KEY}`, Accept: 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FROM = '2025-05-01', TO = '2026-10-16';
const etMin = (t) => { const d = new Date(t * 1000); const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(d); return +p.find((x) => x.type === 'hour').value * 60 + +p.find((x) => x.type === 'minute').value; };

async function leg(id, d) {
  const f = path.join(OC, `${id}_${d}.json`);
  if (fs.existsSync(f)) return 'cached';
  let r = null;
  for (let a = 0; a < 4 && !r?.ok; a++) {
    await sleep(130);
    r = await fetch(`https://api.unusualwhales.com/api/option-contract/${id}/intraday?date=${d}`, { headers: H }).catch(() => null);
    if (r?.status === 404) { fs.writeFileSync(f, '[]'); return 'none'; }
    if (!r?.ok) await sleep(r?.status === 429 ? 5000 : 1500);
  }
  if (!r?.ok) return 'fail';
  const rows = ((await r.json()).data ?? []).map((q) => ({ m: etMin(Math.floor(new Date(q.start_time).getTime() / 1000)), c: +q.close, h: +q.high, l: +q.low })).filter((q) => q.c > 0).sort((a, b) => a.m - b.m);  // same layout as earlier caches
  fs.writeFileSync(f, JSON.stringify(rows));
  return 'ok';
}

const plan = [];
for (const T of ['SPY', 'QQQ']) {
  const daily = JSON.parse(fs.readFileSync(path.join(NIS, '.cache', 'uw', `daily_${T}.json`), 'utf8'));
  const days = Object.keys(daily).sort().filter((d) => d >= FROM && d <= TO);
  for (let i = 0; i < days.length - 1; i++) {
    const d = days[i], dn = days[i + 1];
    const bf = path.join(NIS, '.cache', 'uw', 'm1', T, `${d}.json`);
    if (!fs.existsSync(bf)) continue;
    const bars = JSON.parse(fs.readFileSync(bf, 'utf8')).filter((b) => b.m === 'r');
    const b1555 = bars.find((b) => etMin(b.t) === 955);           // bar starting 15:55
    if (!b1555) continue;
    const K = Math.round(b1555.c);
    const exp = dn.slice(2).replace(/-/g, '');
    for (const cp of ['C', 'P']) plan.push({ id: `${T}${exp}${cp}${String(K * 1000).padStart(8, '0')}`, d, dn, T });
  }
}
console.log('legs', plan.length, '→ calls', plan.length * 2);
const tally = {};
let n = 0;
for (const p of plan) {
  for (const d of [p.d, p.dn]) { const s = await leg(p.id, d); tally[s] = (tally[s] ?? 0) + 1; }
  if (++n % 100 === 0) console.log(n, p.d, tally);
}
fs.writeFileSync(path.join(NIS, 'shadow', 'results_overnight_gap', 'stageB_plan.json'), JSON.stringify(plan));
console.log('done', tally);
