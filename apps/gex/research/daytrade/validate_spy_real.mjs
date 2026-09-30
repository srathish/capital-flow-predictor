// validate_spy_real.mjs — validate the SPY leg with REAL 0DTE contract fills (UW), not BS.
// Replay each SPY aligned setup on SPY 1-min bars -> entry/exit minute -> look up the real contract price then.
import '/Users/saiyeeshrathish/the final plan/apps/gex/scripts/_env-bootstrap.js';
import fs from 'node:fs';
const SK = process.env.SKYLIT_API_KEY, UW = process.env.UNUSUAL_WHALES_API_KEY;
const atlas = (p) => fetch(`https://atlas-api.skylit.ai${p}`, { headers: { Authorization: `Bearer ${SK}`, Accept: 'application/json' } }).then((r) => r.json());
const uw = (p) => fetch(`https://api.unusualwhales.com${p}`, { headers: { Authorization: `Bearer ${UW}`, Accept: 'application/json' } }).then(async (r) => ({ s: r.status, j: await r.json().catch(() => null) }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dstr = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const NEAR = 0.0008;
const occ = (s) => { const [y, m, d] = s.d.split('-'); const strike = String(Math.round(s.entry) * 1000).padStart(8, '0'); return `SPY${y.slice(2)}${m}${d}${s.dir === 'bull' ? 'C' : 'P'}${strike}`; };

const rows = JSON.parse(fs.readFileSync('/private/tmp/claude-501/-Users-saiyeeshrathish-the-final-plan/a5088226-4255-42ad-8c1a-63d53449d7a5/scratchpad/doctrine_rows.json'));
const setups = rows.filter((x) => x.sym === 'SPY' && x.triggered && x.aligned);

const NOW = Math.floor(Date.now() / 1000);
const byDay = {};
for (const [a, b] of [[181, 91], [91, 0]]) { const mq = await atlas(`/v1/history?symbol=SPY&resolution=1&from=${NOW - a * 86400}&to=${NOW - b * 86400}`); mq.t?.forEach((t, i) => { const d = dstr(t); (byDay[d] ||= []).push({ t, h: mq.h[i], l: mq.l[i], c: mq.c[i] }); }); }
for (const d of Object.keys(byDay)) byDay[d].sort((x, y) => x.t - y.t);

// replay -> entry/exit unix ts (aligned to minute) + result
function replay(s) {
  const bars = byDay[s.d]; if (!bars || bars.length < 200) return null;
  const tol = s.entry * NEAR; let i0 = -1;
  for (let i = 0; i < bars.length; i++) if (bars[i].l - tol <= s.entry && s.entry <= bars[i].h + tol) { i0 = i; break; }
  if (i0 < 0) return null;
  for (let j = i0; j < bars.length; j++) {
    if (s.dir === 'bull') { if (bars[j].h >= s.target) return { et: bars[i0].t, xt: bars[j].t, res: 'win' }; if (bars[j].c <= s.stop) return { et: bars[i0].t, xt: bars[j].t, res: 'loss' }; }
    else { if (bars[j].l <= s.target) return { et: bars[i0].t, xt: bars[j].t, res: 'win' }; if (bars[j].c >= s.stop) return { et: bars[i0].t, xt: bars[j].t, res: 'loss' }; }
  }
  return { et: bars[i0].t, xt: bars[bars.length - 1].t, res: 'eod' };
}

const SLIP = 0.03;
const real = []; let skipped = 0;
for (const s of setups) {
  const rp = replay(s); if (!rp) { skipped++; continue; }
  const id = occ(s);
  const { s: st, j } = await uw(`/api/option-contract/${id}/intraday?date=${s.d}`);
  await sleep(250);
  if (st !== 200 || !Array.isArray(j?.data) || !j.data.length) { skipped++; process.stdout.write('x'); continue; }
  const m = {}; for (const b of j.data) { const ts = Math.floor(new Date(b.start_time).getTime() / 1000); m[ts] = { o: +b.open, h: +b.high, l: +b.low, c: +b.close }; }
  const tsList = Object.keys(m).map(Number).sort((a, b) => a - b);
  const nearest = (ts) => { let best = null, bd = 1e9; for (const t of tsList) { const d = Math.abs(t - ts); if (d < bd) { bd = d; best = t; } } return bd <= 300 ? m[best] : null; }; // within 5 min
  const ein = nearest(rp.et), exOut = nearest(rp.xt);
  if (!ein || !exOut) { skipped++; process.stdout.write('.'); continue; }
  // realistic fill: buy at entry close, sell at exit close, minus slippage each side
  const entryPx = ein.c, exitPx = exOut.c;
  if (!(entryPx > 0.02)) { skipped++; continue; }
  const cost = entryPx * (1 + SLIP), proc = Math.max(0, exitPx) * (1 - SLIP);
  const ret = (proc - cost) / cost;
  // conservative fill: buy entry HIGH, sell exit LOW
  const costC = ein.h * (1 + SLIP), procC = Math.max(0, exOut.l) * (1 - SLIP);
  const retC = ein.h > 0.02 ? (procC - costC) / costC : ret;
  real.push({ d: s.d, res: rp.res, entryPx, exitPx, ret, retC, grade: s.grade });
  process.stdout.write(rp.res === 'win' ? '#' : rp.res === 'loss' ? '-' : 'o');
}

fs.writeFileSync('/private/tmp/claude-501/-Users-saiyeeshrathish-the-final-plan/a5088226-4255-42ad-8c1a-63d53449d7a5/scratchpad/spy_real_trades.json', JSON.stringify(real, null, 1));
const wr = (real.filter((x) => x.ret > 0).length / real.length * 100).toFixed(0);
const avg = (real.reduce((a, x) => a + x.ret, 0) / real.length * 100).toFixed(1);
const avgC = (real.reduce((a, x) => a + x.retC, 0) / real.length * 100).toFixed(1);
console.log(`\n\n===== SPY 0DTE — REAL CONTRACT FILLS (${real.length} trades, ${skipped} skipped, 3% slip) =====`);
console.log(`result mix: win ${real.filter(x=>x.res==='win').length} / loss ${real.filter(x=>x.res==='loss').length} / eod ${real.filter(x=>x.res==='eod').length}`);
console.log(`\nREALISTIC (buy entry-close, sell exit-close):  avg ${avg}%/trade   win ${wr}%`);
console.log(`CONSERVATIVE (buy minute-high, sell minute-low): avg ${avgC}%/trade`);
real.sort((a, b) => a.d < b.d ? -1 : 1);
console.log('\n$1000 compounded, REALISTIC fills:');
for (const f of [0.02, 0.05, 0.10, 0.20]) { let bank = 1000, peak = 1000, dd = 0; for (const t of real) { bank *= (1 + f * t.ret); peak = Math.max(peak, bank); dd = Math.max(dd, (peak - bank) / peak); } console.log(`   f=${(f*100).toFixed(0).padStart(2)}%:  $1000 -> $${bank.toLocaleString(undefined,{maximumFractionDigits:0})}  (maxDD ${(dd*100).toFixed(0)}%)`); }
console.log('\nlast 8 trades (real fills):'); for (const t of real.slice(-8)) console.log(`  ${t.d} ${t.res.padEnd(4)} entry $${t.entryPx.toFixed(2)} exit $${t.exitPx.toFixed(2)}  ret ${(t.ret*100).toFixed(0)}%`);
