// The SPX-board trades from trade_2026_11_05.mjs, priced in SPXW 0DTE puts (UW minute prices). Same entry/exit minutes.
import { UW_API_KEY } from '../../feeds/env.js';
const et = (iso) => { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(iso)); return +p.find((x) => x.type === 'hour').value * 60 + +p.find((x) => x.type === 'minute').value; };
const hm = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
async function rows(K) { const id = `SPXW261105P${String(K * 1000).padStart(8, '0')}`; const r = await fetch(`https://api.unusualwhales.com/api/option-contract/${id}/intraday?date=2026-11-05`, { headers: { Authorization: `Bearer ${UW_API_KEY}` } }); const j = await r.json(); return (j.data ?? []).map((q) => ({ m: et(q.start_time), c: +q.close, h: +q.high, v: +q.volume || 0 })).sort((a, b) => a.m - b.m); }
const trades = [{ lab: '10:00 → king 7500', spot: 7563.39, inM: 600, outM: 621 }, { lab: '11:00 → king 7360', spot: 7440.82, inM: 660, outM: 846 }, { lab: 'Reference: 09:35 put held all day', spot: 7645.83, inM: 575, outM: 955 }];
let tot = 0;
for (const t of trades) { const K = Math.round(t.spot / 5) * 5, R = await rows(K); const en = R.find((q) => q.m >= t.inM), ex = R.filter((q) => q.m <= t.outM).at(-1), pk = R.filter((q) => q.m > en.m && q.m <= t.outM).reduce((a, q) => (q.h > a.h ? q : a), en);
  const pct = ex.c / en.c - 1, per = (ex.c - en.c) * 100, q10 = Math.floor(10000 / (en.c * 100));
  console.log(`${t.lab.padEnd(36)} SPXW ${K}P: bought ${hm(en.m)} @ $${en.c.toFixed(2)} → sold ${hm(ex.m)} @ $${ex.c.toFixed(2)} = ${pct >= 0 ? '+' : ''}${Math.round(pct * 100)}% | $${Math.round(per).toLocaleString()} per contract | with $10k: ${q10} contracts → ${per * q10 >= 0 ? '+' : ''}$${Math.round(per * q10).toLocaleString()} | peak $${pk.h.toFixed(2)} at ${hm(pk.m)} (${Math.round((pk.h / en.c - 1) * 100)}%) | volume at entry ${en.v}`);
  if (!t.lab.startsWith('Ref')) tot += per * q10; }
console.log(`\nThe two board trades with $10k each: ${tot >= 0 ? '+' : ''}$${Math.round(tot).toLocaleString()}`);
