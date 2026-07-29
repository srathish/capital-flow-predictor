// Add UW Market Tide (net call/put premium + net volume, 5-min) to each day's aux file — real options
// FLOW / positioning pressure, the dimension the static GEX map can't see. Test: does flow crack direction?
import '../../scripts/_env-bootstrap.js';
import fs from 'node:fs'; import path from 'node:path';
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
const DIR = path.join(process.cwd(), 'research', 'velocity-capture');
const etOf = t => new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false }).slice(0, 5);
const days = fs.readdirSync(DIR).filter(f => /^aux_.*\.json$/.test(f)).map(f => f.slice(4, 14)).sort();
for (const day of days) {
  const file = path.join(DIR, `aux_${day}.json`); const a = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (a.tide?.length) { console.log(`${day}: have tide`); continue; }
  const r = await fetch(`https://api.unusualwhales.com/api/market/market-tide?date=${day}&interval_5m=true`, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(20000) }).catch(() => null);
  if (!r || !r.ok) { console.log(`${day}: tide ${r ? r.status : 'err'}`); continue; }
  const d = (await r.json())?.data || [];
  a.tide = d.map(x => ({ et: etOf(x.timestamp), ncp: +x.net_call_premium, npp: +x.net_put_premium, nv: +x.net_volume })).filter(p => p.et >= '09:30' && p.et <= '16:00');
  fs.writeFileSync(file, JSON.stringify(a));
  console.log(`${day}: +${a.tide.length} tide bars`);
  await new Promise(r => setTimeout(r, 200));
}
console.log('done');
