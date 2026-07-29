// Add QQQ 1-min closes to each day's aux file, so the regime label can be TRINITY alignment
// (SPX from the surface + SPY + QQQ all pointing the same way = trend; diverging = chop).
import '../../scripts/_env-bootstrap.js';
import fs from 'node:fs'; import path from 'node:path';
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
const DIR = path.join(process.cwd(), 'research', 'velocity-capture');
const etOf = t => new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false }).slice(0, 5);
const days = fs.readdirSync(DIR).filter(f => /^aux_.*\.json$/.test(f)).map(f => f.slice(4, 14)).sort();
for (const day of days) {
  const file = path.join(DIR, `aux_${day}.json`);
  const a = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (a.qqq?.length) { console.log(`${day}: have qqq`); continue; }
  const r = await fetch(`https://api.unusualwhales.com/api/stock/QQQ/ohlc/1m?date=${day}`, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(20000) }).catch(() => null);
  if (!r || !r.ok) { console.log(`${day}: QQQ ${r ? r.status : 'err'}`); continue; }
  const qqq = ((await r.json())?.data || []).map(x => ({ et: etOf(x.start_time), c: +x.close })).filter(p => p.et >= '09:30' && p.et <= '16:00').sort((x, y) => x.et.localeCompare(y.et));
  a.qqq = qqq; fs.writeFileSync(file, JSON.stringify(a));
  console.log(`${day}: +${qqq.length} qqq bars`);
  await new Promise(r => setTimeout(r, 200));
}
console.log('done');
