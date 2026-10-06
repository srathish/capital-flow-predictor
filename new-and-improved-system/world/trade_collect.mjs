#!/usr/bin/env node
// Census International Trade API → monthly US imports (GEN_VAL_MO, general imports) and exports (ALL_VAL_MO, total exports)
// by HS code (HS4 totals + HS6 children), totals, and 8471/8542 imports by partner country → .cache/trade/trade.json.
// One range query (time=from 2010-01 to <now>) per HS code/flow; the HS timeseries itself starts 2013-01.
// Raw response bodies (never the URL — it carries the key) cached under .cache/trade/raw/ → resumable. ≤2 req/s.
// Point-in-time: Census publishes monthly trade (FT-900) ~35 days after month end, so avail = month end + 40 days.
import fs from 'node:fs';
import path from 'node:path';
await import('../feeds/env.js');

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), OUT = path.join(ROOT, '.cache', 'trade'), RAW = path.join(OUT, 'raw');
const B = 'https://api.census.gov/data/timeseries/intltrade';
export const HS = { 8471: 'computers/servers', 8473: 'computer parts', 8542: 'integrated circuits', 8541: 'diodes/transistors/semis/solar cells',
  8486: 'semiconductor manufacturing equipment', 8517: 'telecom/network equipment', 8504: 'transformers/power supplies', 8535: 'switchgear >1kV',
  8536: 'switchgear <=1kV', 8537: 'control panels/boards', 8544: 'insulated wire/cable incl fiber', 9001: 'optical fibers/lenses', 8507: 'batteries',
  8502: 'generator sets', 8411: 'turbines', 8418: 'refrigeration/cooling', 8415: 'air conditioning', 7403: 'refined copper', 7408: 'copper wire',
  8523: 'storage media', 8528: 'monitors', 2804: 'silicon', 3818: 'doped wafers', 8703: 'cars', 8708: 'auto parts', 3004: 'medicaments', 2710: 'petroleum oils' };
export const CTY = { TW: '5830', KR: '5800', CN: '5700', MX: '2010', MY: '5570', VN: '5520', JP: '5880' };
const FLOW = { imports: { c: 'I_COMMODITY', v: 'GEN_VAL_MO' }, exports: { c: 'E_COMMODITY', v: 'ALL_VAL_MO' } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let next = 0; const gate = async () => { const now = Date.now(), t = Math.max(now, next); next = t + 550; if (t > now) await sleep(t - now); };
const end = new Date().toISOString().slice(0, 7), TIME = `time=from+2010-01+to+${end}`;
export const avail = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo, 0) + 40 * 864e5).toISOString().slice(0, 10); };

async function q(id, flow, qs, tries = 5, time = TIME) { // returns array of row objects; caches raw body by id
  const f = path.join(RAW, `${id}.json`); if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  for (let k = 0; k < tries; k++) { await gate(); const r = await fetch(`${B}/${flow}/hs?${qs}&${time}&key=${process.env.CENSUS_API_KEY}`, { signal: AbortSignal.timeout(180e3) }).catch(() => null);
    if (r?.status === 204) { fs.writeFileSync(f, '[]'); return []; }
    const t = r?.ok ? await r.text().catch(() => '') : ''; console.error(`  ${id} ${r?.status ?? 'net/timeout'}`); let j; try { j = JSON.parse(t); } catch { j = null; }
    if (!Array.isArray(j)) { console.error(`  retry ${id} (${r?.status ?? 'net'}${t.includes('Invalid Key') ? ' invalid-key page' : ''})`); await sleep(3000 * (k + 1)); continue; }
    const [h, ...rows] = j, o = rows.map((x) => Object.fromEntries(h.map((c, i) => [c, x[i]]).reverse())); // reverse → first occurrence of dup columns wins
    fs.writeFileSync(f, JSON.stringify(o)); return o; }
  console.error(`  FAILED ${id}`); return null;
}
const obs = (rows, v) => [...new Map(rows.map((r) => [r.time, Number(r[v])])).entries()].filter(([, x]) => Number.isFinite(x)).sort(([a], [b]) => a.localeCompare(b)).map(([m, x]) => ({ m, v: x, avail: avail(m) }));

if (decodeURIComponent(new URL(import.meta.url).pathname) === process.argv[1]) {
  if (!process.env.CENSUS_API_KEY) { console.error('CENSUS_API_KEY missing'); process.exit(1); }
  fs.mkdirSync(RAW, { recursive: true }); const series = {}, failed = [];
  const add = (k, name, rows, v) => { const o = obs(rows, v); if (o.length) series[k] = { name, obs: o }; };
  for (const [flow, { c, v }] of Object.entries(FLOW)) {
    const tot = await q(`${flow}_TOTAL`, flow, `get=${v}&CTY_CODE=-`); if (tot) add(`${flow}:TOTAL`, `US total ${flow}`, tot, v); else failed.push(`${flow}:TOTAL`);
    for (const [hs, name] of Object.entries(HS)) {
      const r4 = await q(`${flow}_${hs}`, flow, `get=${c},${v},COMM_LVL,${c}_SDESC&${c}=${hs}&CTY_CODE=-`);
      if (!r4?.length) { failed.push(`${flow}:${hs}`); continue; } add(`${flow}:${hs}`, `${name} (${r4.at(-1)[`${c}_SDESC`]})`, r4, v);
      const q6 = `get=${c},${v},${c}_SDESC&${c}=${hs}*&COMM_LVL=HS6&CTY_CODE=-`; const r6 = await q(`${flow}_${hs}_hs6`, flow, q6, 2); // HS6 children are optional: 2 tries, then skip + log
      if (!r6) { failed.push(`${flow}:${hs}:hs6`); console.error(`  skip ${flow} ${hs} hs6`); continue; }
      const by = Map.groupBy(r6, (r) => r[c]); for (const [h6, rs] of by) add(`${flow}:${h6}`, rs.at(-1)[`${c}_SDESC`], rs, v);
    }
    console.error(`${flow} done · ${Object.keys(series).length} series`);
  }
  for (const hs of ['8471', '8542']) { const r = await q(`imports_${hs}_cty`, 'imports', `get=I_COMMODITY,GEN_VAL_MO,CTY_NAME&I_COMMODITY=${hs}&${Object.values(CTY).map((x) => `CTY_CODE=${x}`).join('&')}`);
    if (!r) { failed.push(`imports:${hs}:cty`); continue; }
    for (const [iso, code] of Object.entries(CTY)) { const rs = r.filter((x) => x.CTY_CODE === code); if (rs.length) add(`imports:${hs}:${iso}`, `${HS[hs]} imports from ${rs[0].CTY_NAME}`, rs, 'GEN_VAL_MO'); else failed.push(`imports:${hs}:${iso}`); } }
  fs.writeFileSync(path.join(OUT, 'trade.json'), JSON.stringify({ source: 'api.census.gov timeseries/intltrade {imports,exports}/hs', avail_rule: 'month end + 40 days (FT-900 ~35d lag)', built: new Date().toISOString(), series }));
  console.error(`wrote ${Object.keys(series).length} series · failed: ${failed.join(', ') || 'none'}`);
}
