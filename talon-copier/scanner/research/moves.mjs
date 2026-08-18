// moves.mjs — validation: pull ACTUAL price moves for the named stocks, rank by biggest move,
// and show where price sits vs OUR king-node/T1 target (the GEX/VEX "prediction"). UW price only.
import { loadEnvKeysFrom, resolveFromRoot, log } from '../lib/util.mjs';
loadEnvKeysFrom(resolveFromRoot('../../.env'), ['UNUSUAL_WHALES_API_KEY']);
const { FlowProvider } = await import('../providers/flow-uw.mjs');
const flow = new FlowProvider();

const NAMES = 'IONQ RGTI ON TSM NVDA MRVL ORCL META MSFT HOOD PYPL MARA NKE DIS HD GDX XBI HAL VST WDC MU HYG USO DRAM SMH C BAC GOOGL PLTR BMNR'.split(' ');
// our king-node / T1 target from the deep-analysis (we were BULLISH on all of these)
const T1 = { PYPL:65, MU:1000, NVDA:228, WDC:540, MRVL:250, TSM:445, ORCL:160, HOOD:100, IONQ:50, RGTI:20, GDX:95, XBI:165, MSFT:508, HAL:34, VST:162, ON:86, META:600, DIS:107, MARA:10.5, NKE:42, HD:360, HYG:80, USO:135, SMH:600, C:145, BAC:65, GOOGL:350, PLTR:180, BMNR:20, DRAM:60 };

const rows = [];
for (const t of NAMES) {
  const oh = await flow.getDailyOHLC(t, { limit: 25 }).catch(() => []);
  if (oh.length < 11) { rows.push({ t, err: 'no data' }); continue; }
  const c = oh.map((x) => x.close);
  const now = c[c.length - 1], d1 = c[c.length - 2], d5 = c[c.length - 6], d10 = c[c.length - 11];
  const seg = oh.slice(-10);
  const hi = Math.max(...seg.map((x) => x.high)), lo = Math.min(...seg.map((x) => x.low));
  const t1 = T1[t] ?? null;
  rows.push({
    t, now, dt: oh[oh.length - 1].date,
    mv1: (now / d1 - 1) * 100, mv5: (now / d5 - 1) * 100, mv10: (now / d10 - 1) * 100,
    hi, lo, t1, gap: t1 != null ? (now / t1 - 1) * 100 : null,
    hitHi: t1 != null ? hi >= t1 : null,   // did price TAG the king node intraday over the window?
  });
}
rows.sort((a, b) => (Math.abs(b.mv10 || 0) - Math.abs(a.mv10 || 0)));

log(`\nlast close ${rows.find(r=>r.dt)?.dt || ''} — ranked by 10-session move\n`);
log(`ticker   now       1d%    5d%    10d%   10d range        kingT1   now→T1   tagged?`);
log('─'.repeat(84));
for (const r of rows) {
  if (r.err) { log(`${r.t.padEnd(8)} ${r.err}`); continue; }
  const dir = r.mv10 >= 0 ? '↑' : '↓';
  log(
    `${r.t.padEnd(7)} ${r.now.toFixed(2).padStart(8)} ${r.mv1.toFixed(1).padStart(6)} ${r.mv5.toFixed(1).padStart(6)} ${dir}${Math.abs(r.mv10).toFixed(1).padStart(5)}  ` +
    `${(r.lo.toFixed(1) + '-' + r.hi.toFixed(1)).padEnd(15)} ${String(r.t1 ?? '—').padStart(7)} ` +
    `${r.gap != null ? ((r.gap >= 0 ? '+' : '') + r.gap.toFixed(1) + '%').padStart(8) : '     —  '} ${r.hitHi ? '✓ HIT' : (r.hitHi === false ? '·' : '')}`
  );
}
// direction scoreboard: we predicted UP on all — how many of the biggest movers went up?
const moved = rows.filter((r) => !r.err);
const big = moved.slice(0, 12);
const up = big.filter((r) => r.mv10 > 0).length;
log('\n── direction (we were BULLISH on all): of the 12 biggest movers, ' + up + '/12 moved UP over 10 sessions ──');
const tagged = moved.filter((r) => r.hitHi).length, withT1 = moved.filter((r) => r.t1 != null).length;
log(`── king-node as magnet: ${tagged}/${withT1} tagged their king-node/T1 level intraday within the 10-session window ──`);
