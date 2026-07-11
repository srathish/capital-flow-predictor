// Entry-quality study (RESEARCH ONLY). Isolates ENTRY edge from EXIT quality
// using the real per-minute option-mark path (UW intraday, close basis, cached).
//
// Entry is "good" if, independent of how we exit, the trade reliably CATCHES a
// favorable move. Metrics per fire:
//   MFE = max favorable excursion (peak gain)   -- did it ever work?
//   MAE = max adverse excursion (worst drawdown) -- did it go against us first?
//   drift@5/15/30m = avg option gain at fixed horizons -- is there real post-entry edge?
//   ttPeak = minutes to the peak                 -- good timing (fast) vs lucky drift (late)
//   againstFirst = did MAE occur BEFORE MFE?     -- entry timing quality
import '../../scripts/_env-bootstrap.js';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache');
const db = new Database(path.join(HERE, '..', '..', 'data', 'gexester.db'), { readonly: true });
const candles = (sym, day) => {
  const f = path.join(CACHE, `${sym}_${day}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [];
};

const fires = db.prepare(
  `SELECT trading_day d, ticker, state, option_symbol sym, entry_mark entry, fire_ts_ms fts
   FROM tracked_plays WHERE entry_mark > 0 ORDER BY fire_ts_ms`).all();

const recs = [];
for (const f of fires) {
  const p = candles(f.sym, f.d).filter(c => c.ts >= f.fts);
  if (p.length < 3) continue;
  let mfe = -1, mae = 1, mfeTs = f.fts, maeTs = f.fts;
  for (const c of p) {
    const g = (c.close - f.entry) / f.entry;
    if (g > mfe) { mfe = g; mfeTs = c.ts; }
    if (g < mae) { mae = g; maeTs = c.ts; }
  }
  const at = (min) => {
    const target = f.fts + min * 60000;
    const c = p.filter(x => x.ts <= target).pop() || p[0];
    return (c.close - f.entry) / f.entry;
  };
  recs.push({
    d: f.d, ticker: f.ticker, state: f.state, mfe, mae,
    d5: at(5), d15: at(15), d30: at(30),
    ttPeak: Math.round((mfeTs - f.fts) / 60000),
    againstFirst: maeTs < mfeTs && mae < -0.05,
  });
}

const pct = x => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%`;
const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const frac = (a, f) => (a.filter(f).length / a.length * 100).toFixed(0);

function report(label, R) {
  if (!R.length) return;
  const mfe = R.map(r => r.mfe), mae = R.map(r => r.mae);
  console.log(`\n${label}  (n=${R.length})`);
  console.log(`  MFE (peak):   median ${pct(median(mfe))}  mean ${pct(mean(mfe))}   |  reached +25%: ${frac(R, r => r.mfe >= .25)}%  +50%: ${frac(R, r => r.mfe >= .5)}%  +100%: ${frac(R, r => r.mfe >= 1)}%`);
  console.log(`  MAE (dd):     median ${pct(median(mae))}  mean ${pct(mean(mae))}   |  never dipped < -15%: ${frac(R, r => r.mae >= -.15)}%`);
  console.log(`  drift:        +5m ${pct(mean(R.map(r => r.d5)))}   +15m ${pct(mean(R.map(r => r.d15)))}   +30m ${pct(mean(R.map(r => r.d30)))}`);
  console.log(`  timing:       went AGAINST first: ${frac(R, r => r.againstFirst)}%   |  median mins-to-peak: ${median(R.map(r => r.ttPeak))}`);
  console.log(`  edge check:   MFE>|MAE| (worked before it hurt): ${frac(R, r => r.mfe > Math.abs(r.mae))}%`);
}

report('ALL FIRES', recs);
report('BULL_REVERSE only', recs.filter(r => r.state === 'BULL_REVERSE'));
report('BEAR (rug/trapdoor/continue)', recs.filter(r => r.state.startsWith('BEAR')));
for (const tk of ['SPXW', 'SPY', 'QQQ']) report(`BULL_REVERSE · ${tk}`, recs.filter(r => r.state === 'BULL_REVERSE' && r.ticker === tk));
