// LADDER-RUNG TEST (RESEARCH ONLY, Clause 0).
// tracked_plays logs a STRIKE LADDER per fire: 72 fire events -> 175 rows, each row a
// different strike (rung) on the SAME signal. Within a fire, a cheaper contract is
// ALWAYS the further-OTM one. So pooling rows across rungs makes "entry price" a
// perfect proxy for "moneyness". This script:
//   A) reproduces the reported price-bucket PFs on the POOLED ladder (provenance check)
//   B) runs the PAIRED within-fire experiment: same signal, same second, same ticker,
//      only the strike varies -> a clean causal read on moneyness.
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(HERE, '..', '..', 'data', 'gexester.db'), { readonly: true });
const rows = db.prepare(`SELECT trading_day day, ticker, state, strike K, option_type, spot_at_fire spot,
  entry_mark, entry_bid, entry_ask, close_mark, fire_ts_ms
  FROM tracked_plays WHERE entry_mark > 0 AND close_mark IS NOT NULL`).all()
  .map(r => {
    const dir = r.option_type === 'call' ? 1 : -1;
    return { ...r, dir, ret: (r.close_mark - r.entry_mark) / r.entry_mark,
      mny: Math.abs(r.K - r.spot) / r.spot,
      spread: (r.entry_ask > 0 && r.entry_bid > 0) ? (r.entry_ask - r.entry_bid) / r.entry_mark : null };
  });

const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
function stats(g) {
  const pos = g.filter(x => x > 0);
  const gp = pos.reduce((s, x) => s + x, 0), gl = -g.filter(x => x <= 0).reduce((s, x) => s + x, 0);
  return { n: g.length, win: pos.length / g.length, exp: mean(g), pf: gl > 0 ? gp / gl : Infinity };
}
const pc = x => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const f2 = x => (x === Infinity ? ' inf' : x.toFixed(2));
const row = (l, s) => `${l.padEnd(16)}${String(s.n).padStart(5)}${(s.win * 100).toFixed(0).padStart(6)}%${pc(s.exp).padStart(9)}${f2(s.pf).padStart(7)}`;

// group into fire events, order rungs by moneyness (rung 0 = ATM)
const fires = new Map();
for (const r of rows) {
  const k = `${r.fire_ts_ms}|${r.ticker}`;
  if (!fires.has(k)) fires.set(k, []);
  fires.get(k).push(r);
}
for (const v of fires.values()) v.sort((a, b) => a.mny - b.mny);
const events = [...fires.values()];
console.log(`rows ${rows.length} -> fire EVENTS ${events.length}`);
const sizes = {};
for (const e of events) sizes[e.length] = (sizes[e.length] || 0) + 1;
console.log(`rungs per event: ${JSON.stringify(sizes)}\n`);

// ---------- A. provenance: pooled-ladder price buckets ----------
const PB = [['<$1', r => r.entry_mark < 1], ['$1-3', r => r.entry_mark >= 1 && r.entry_mark < 3],
  ['$3-10', r => r.entry_mark >= 3 && r.entry_mark < 10], ['>$10', r => r.entry_mark >= 10]];
console.log('='.repeat(70));
console.log('# A. PROVENANCE — price buckets on the POOLED LADDER (all rungs, n=' + rows.length + ')');
console.log('   reported finding: <$1 PF 0.25 | $1-3 PF 0.13 | $3-10 PF 1.54 | >$10 PF 1.49');
console.log('bucket'.padEnd(16) + 'n'.padStart(5) + 'win%'.padStart(7) + 'exp'.padStart(9) + 'PF'.padStart(7) + '   avg|mny|');
for (const [lab, fn] of PB) {
  const s = rows.filter(fn);
  console.log(row(lab, stats(s.map(r => r.ret))) + `    ${(100 * mean(s.map(r => r.mny))).toFixed(2)}%`);
}
console.log(row('ALL', stats(rows.map(r => r.ret))) + `    ${(100 * mean(rows.map(r => r.mny))).toFixed(2)}%`);
console.log('\n  ^ note avg|moneyness| climbs monotonically as price falls. Price IS moneyness here.');

// ---------- B. the SAME table, but by moneyness ----------
const MB = [['ATM <0.15%', r => r.mny < 0.0015], ['0.15-0.5%', r => r.mny >= 0.0015 && r.mny < 0.005],
  ['0.5-1%', r => r.mny >= 0.005 && r.mny < 0.01], ['>1%', r => r.mny >= 0.01]];
console.log('\n' + '='.repeat(70));
console.log('# B. SAME POOLED ROWS, bucketed by MONEYNESS instead of price');
console.log('bucket'.padEnd(16) + 'n'.padStart(5) + 'win%'.padStart(7) + 'exp'.padStart(9) + 'PF'.padStart(7) + '   avg$entry');
for (const [lab, fn] of MB) {
  const s = rows.filter(fn);
  if (!s.length) continue;
  console.log(row(lab, stats(s.map(r => r.ret))) + `    $${mean(s.map(r => r.entry_mark)).toFixed(2)}`);
}

// ---------- C. PAIRED within-fire experiment (the clean causal read) ----------
console.log('\n' + '='.repeat(70));
console.log('# C. PAIRED WITHIN-FIRE: same signal, same second, same ticker — only STRIKE varies');
const multi = events.filter(e => e.length >= 3);
console.log(`multi-rung fire events: ${multi.length}\n`);
console.log('rung (0=ATM, higher=further OTM)');
console.log('rung'.padEnd(16) + 'n'.padStart(5) + 'win%'.padStart(7) + 'exp'.padStart(9) + 'PF'.padStart(7) + '   avg|mny|   avg$');
for (let k = 0; k < 4; k++) {
  const s = multi.filter(e => e[k]).map(e => e[k]);
  if (!s.length) continue;
  console.log(row(`rung ${k}`, stats(s.map(r => r.ret)))
    + `    ${(100 * mean(s.map(r => r.mny))).toFixed(2)}%`.padStart(9)
    + `   $${mean(s.map(r => r.entry_mark)).toFixed(2)}`);
}

// paired deltas: rung k vs rung 0, WITHIN the same fire
console.log('\nPAIRED Δ vs rung 0 (ATM), same fire:');
console.log('pair'.padEnd(16) + 'n'.padStart(5) + 'meanΔ'.padStart(9) + 'medΔ'.padStart(9) + 'ATMwins'.padStart(9) + '  sign-test p');
function binomP(k, n) { const C = (n, k) => { let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return r; }; let s = 0; for (let i = k; i <= n; i++) s += C(n, i); return s / 2 ** n; }
for (let k = 1; k < 4; k++) {
  const pairs = multi.filter(e => e[k] && e[0]).map(e => e[k].ret - e[0].ret);
  if (pairs.length < 5) continue;
  const srt = [...pairs].sort((a, b) => a - b);
  const atmWins = pairs.filter(d => d < 0).length;
  console.log(`rung${k} - rung0`.padEnd(16) + String(pairs.length).padStart(5) + pc(mean(pairs)).padStart(9)
    + pc(srt[srt.length >> 1]).padStart(9) + `${atmWins}/${pairs.length}`.padStart(9)
    + `  ${binomP(atmWins, pairs.length).toFixed(4)}`);
}

// ---------- D. does the price effect survive WITHIN a rung? ----------
console.log('\n' + '='.repeat(70));
console.log('# D. THE DECISIVE CONTROL — price buckets WITHIN a single rung');
console.log('  (rung fixes moneyness. If price still sorts, price is causal.');
console.log('   If it goes flat, price was only ever a moneyness proxy.)');
for (let k = 0; k < 3; k++) {
  const s = multi.filter(e => e[k]).map(e => e[k]);
  if (s.length < 20) continue;
  console.log(`\n-- rung ${k} (avg |mny| ${(100 * mean(s.map(r => r.mny))).toFixed(2)}%, n=${s.length})`);
  console.log('  ' + 'bucket'.padEnd(16) + 'n'.padStart(5) + 'win%'.padStart(7) + 'exp'.padStart(9) + 'PF'.padStart(7));
  for (const [lab, fn] of PB) {
    const g = s.filter(fn).map(r => r.ret);
    if (g.length >= 5) console.log('  ' + row(lab, stats(g)));
    else if (g.length) console.log('  ' + `${lab}`.padEnd(16) + String(g.length).padStart(5) + '   (too few)');
  }
}

// ---------- E. real friction by rung ----------
console.log('\n' + '='.repeat(70));
console.log('# E. REAL BID/ASK SPREAD BY RUNG (recorded live)');
console.log('rung'.padEnd(10) + 'n'.padStart(5) + 'avg$entry'.padStart(11) + 'avg spread$'.padStart(13) + 'rel spread'.padStart(12));
for (let k = 0; k < 4; k++) {
  const s = multi.filter(e => e[k]).map(e => e[k]).filter(r => r.spread != null);
  if (!s.length) continue;
  console.log(`rung ${k}`.padEnd(10) + String(s.length).padStart(5)
    + `$${mean(s.map(r => r.entry_mark)).toFixed(2)}`.padStart(11)
    + `$${mean(s.map(r => r.entry_ask - r.entry_bid)).toFixed(3)}`.padStart(13)
    + `${(100 * mean(s.map(r => r.spread))).toFixed(1)}%`.padStart(12));
}
console.log('\nrel spread by PRICE bucket (pooled ladder):');
console.log('bucket'.padEnd(10) + 'n'.padStart(5) + 'avg$entry'.padStart(11) + 'rel spread'.padStart(12));
for (const [lab, fn] of PB) {
  const s = rows.filter(r => fn(r) && r.spread != null);
  if (!s.length) continue;
  console.log(lab.padEnd(10) + String(s.length).padStart(5) + `$${mean(s.map(r => r.entry_mark)).toFixed(2)}`.padStart(11)
    + `${(100 * mean(s.map(r => r.spread))).toFixed(1)}%`.padStart(12));
}
