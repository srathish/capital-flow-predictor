// DESIGN_management_only.md options: SPY/QQQ 0DTE call AND put at the strike nearest the 10:30 close, UW minute prices for the
// session, every day 2025-05-01 → 2026-10-16. Cached in .cache/uwopt_intraday/<CONTRACT>_<date>.json. UW calls only.
//   node shadow/fetch_0dte_1031.mjs
import fs from 'node:fs';
import path from 'node:path';
import { UW_API_KEY } from '../feeds/env.js';

const NIS = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..');
const OC = path.join(NIS, '.cache', 'uwopt_intraday');
const H = { Authorization: `Bearer ${UW_API_KEY}`, Accept: 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const etMin = (t) => { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(t)); return +p.find((x) => x.type === 'hour').value * 60 + +p.find((x) => x.type === 'minute').value; };

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
  const rows = ((await r.json()).data ?? []).map((q) => ({ m: etMin(q.start_time), c: +q.close, h: +q.high, l: +q.low })).filter((q) => q.c > 0).sort((a, b) => a.m - b.m);
  fs.writeFileSync(f, JSON.stringify(rows));
  return 'ok';
}

const plan = [];
for (const T of ['SPY', 'QQQ']) {
  const dir = path.join(NIS, '.cache', 'uw', 'm1', T);
  for (const f of fs.readdirSync(dir).sort()) {
    const d = f.slice(0, 10);
    if (d < '2025-05-01' || d > '2026-10-16') continue;
    const bars = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).filter((b) => b.m === 'r');
    const b = bars.find((x) => etMin(x.t * 1000) === 629);   // bar starting 10:29 closes at 10:30
    if (!b) continue;
    const K = Math.round(b.c), exp = d.slice(2).replace(/-/g, '');
    for (const cp of ['C', 'P']) plan.push({ id: `${T}${exp}${cp}${String(K * 1000).padStart(8, '0')}`, d, T, K });
  }
}
console.log('legs', plan.length);
const tally = {}; let n = 0;
for (const p of plan) { const s = await leg(p.id, p.d); tally[s] = (tally[s] ?? 0) + 1; if (++n % 200 === 0) console.log(n, p.d, tally); }
fs.writeFileSync(path.join(NIS, 'shadow', 'results_management_only_plan.json'), JSON.stringify(plan));
console.log('done', tally);
