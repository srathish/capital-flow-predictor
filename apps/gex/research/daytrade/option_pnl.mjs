// option_pnl.mjs — does the +0.6R underlying index edge survive as 0DTE OPTION P&L?
// Replays the SAME setups from doctrine_rows.json on fresh 1-min bars to recover entry/exit timing+price,
// prices ATM 0DTE calls/puts with BS (our validated model), across an IV x slippage grid. r=0.
import '/Users/saiyeeshrathish/the final plan/apps/gex/scripts/_env-bootstrap.js';
import fs from 'node:fs';
const K = process.env.SKYLIT_API_KEY;
const H = { Authorization: `Bearer ${K}`, Accept: 'application/json' };
const get = (p) => fetch(`https://atlas-api.skylit.ai${p}`, { headers: H }).then((r) => r.json());
const dstr = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const NEAR = 0.0008;
const STRIKE_STEP = { SPXW: 5, SPY: 1, QQQ: 1 };
const YEAR_MIN = 525600, EXPIRY_MIN = 390; // regular session minute count; 0DTE expires ~16:00 ET

// standard normal CDF
const erf = (x) => { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
const N = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
function bs(S, Kk, T, iv, type) {
  if (T <= 0 || iv <= 0) return Math.max(0, type === 'call' ? S - Kk : Kk - S); // intrinsic at expiry
  const d1 = (Math.log(S / Kk) + 0.5 * iv * iv * T) / (iv * Math.sqrt(T)), d2 = d1 - iv * Math.sqrt(T);
  return type === 'call' ? S * N(d1) - Kk * N(d2) : Kk * N(-d2) - S * N(-d1);
}

const rows = JSON.parse(fs.readFileSync('/private/tmp/claude-501/-Users-saiyeeshrathish-the-final-plan/a5088226-4255-42ad-8c1a-63d53449d7a5/scratchpad/doctrine_rows.json'));
const NOW = Math.floor(Date.now() / 1000);

// fresh 1-min bars per index
const barsBy = {};
for (const px of ['SPX', 'SPY', 'QQQ']) {
  const by = {};
  for (const [a, b] of [[181, 91], [91, 0]]) { const mq = await get(`/v1/history?symbol=${px}&resolution=1&from=${NOW - a * 86400}&to=${NOW - b * 86400}`); mq.t?.forEach((t, i) => { const d = dstr(t); (by[d] ||= []).push({ t, o: mq.o[i], h: mq.h[i], l: mq.l[i], c: mq.c[i] }); }); }
  for (const d of Object.keys(by)) by[d].sort((x, y) => x.t - y.t);
  barsBy[px === 'SPX' ? 'SPXW' : px] = by;
}

// replay a setup: return {entryMin, exitMin, Sentry, Sexit, result}
function replay(bars, s) {
  const tol = s.entry * NEAR; let i0 = -1;
  for (let i = 0; i < bars.length; i++) if (bars[i].l - tol <= s.entry && s.entry <= bars[i].h + tol) { i0 = i; break; }
  if (i0 < 0) return null;
  for (let j = i0; j < bars.length; j++) {
    if (s.dir === 'bull') { if (bars[j].h >= s.target) return R(i0, j, s.entry, s.target, 'win'); if (bars[j].c <= s.stop) return R(i0, j, s.entry, s.stop, 'loss'); }
    else { if (bars[j].l <= s.target) return R(i0, j, s.entry, s.target, 'win'); if (bars[j].c >= s.stop) return R(i0, j, s.entry, s.stop, 'loss'); }
  }
  const last = bars[bars.length - 1];
  return R(i0, bars.length - 1, s.entry, last.c, 'eod');
}
const R = (i0, j, Se, Sx, result) => ({ entryMin: i0, exitMin: j, Sentry: Se, Sexit: Sx, result });

const IVS = [0.10, 0.14, 0.18, 0.24];   // 0DTE ATM IV (vol pts/100)
const SLIPS = [0.00, 0.03, 0.06];       // per-side slippage as frac of premium
const grid = {}; // key iv|slip|grade -> {n, rets[]}
const push = (k, r) => { (grid[k] ||= []).push(r); };

const idx = rows.filter((x) => x.sym !== 'MU' && x.triggered);
let priced = 0, noretest = 0;
for (const s of idx) {
  const bars = barsBy[s.sym]?.[s.d]; if (!bars || bars.length < 200) continue;
  const rp = replay(bars, s); if (!rp) { noretest++; continue; }
  const step = STRIKE_STEP[s.sym];
  const Kk = Math.round(rp.Sentry / step) * step; // ATM
  const type = s.dir === 'bull' ? 'call' : 'put';
  const Tentry = (EXPIRY_MIN - rp.entryMin) / YEAR_MIN;
  const Texit = rp.result === 'eod' ? 0 : (EXPIRY_MIN - rp.exitMin) / YEAR_MIN;
  for (const iv of IVS) {
    const pe = bs(rp.Sentry, Kk, Tentry, iv, type);
    const pxit = bs(rp.Sexit, Kk, Texit, iv, type);
    if (pe <= 0.01) continue;
    for (const slip of SLIPS) {
      const cost = pe * (1 + slip), proceeds = Math.max(0, pxit) * (1 - slip);
      const ret = (proceeds - cost) / cost;
      for (const g of [s.grade, 'ALL', s.aligned ? 'ALIGNED' : 'COUNTER']) push(`${iv}|${slip}|${g}`, ret);
    }
  }
  priced++;
}

const agg = (arr) => { if (!arr?.length) return null; const m = arr.reduce((a, b) => a + b, 0) / arr.length; const w = arr.filter((x) => x > 0).length / arr.length; return { n: arr.length, avg: m, win: w }; };
console.log(`\noption-P&L replay: ${priced} setups priced, ${noretest} no-retest-on-fresh-bars\n`);
console.log('0DTE ATM option return per trade (enter on retest, exit target/stop/EOD-intrinsic):\n');
for (const iv of IVS) {
  console.log(`\n=== IV ${(iv * 100).toFixed(0)} vol-pts ===`);
  console.log('slip%   A+ ret / win        B ret / win         ALIGNED             COUNTER');
  for (const slip of SLIPS) {
    const f = (g) => { const a = agg(grid[`${iv}|${slip}|${g}`]); return a ? `${(a.avg * 100 >= 0 ? '+' : '')}${(a.avg * 100).toFixed(0)}% ${(a.win * 100).toFixed(0)}%(n${a.n})`.padEnd(19) : '—'.padEnd(19); };
    console.log(`${(slip * 100).toFixed(0).padStart(3)}%    ${f('A+')} ${f('B')} ${f('ALIGNED')} ${f('COUNTER')}`);
  }
}
console.log('\n(ret = mean % P&L on premium per trade; win = % of trades green. r=0, ATM, EOD=intrinsic.)');
