// LIVE-SET HORSE RACE (RESEARCH ONLY, Clause 0).
// The replay set is ATM-only by construction, so ONLY the live set carries the
// moneyness variation the entry-price finding was built on. This script races
// entry-price vs moneyness vs time-of-day vs ticker on the live fires, and
// measures REAL bid/ask friction (entry_bid/entry_ask are recorded live).
//
// CAVEAT (stated loudly): this is the SAME sample the finding came from. Nothing
// here is out-of-sample. It is used only to identify WHICH variable the live
// effect actually lives on, not to confirm that the effect is real.
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(HERE, '..', '..', 'data', 'gexester.db'), { readonly: true });
const raw = db.prepare(`SELECT trading_day day, ticker, state, strike K, option_type, spot_at_fire spot,
  entry_mark, entry_bid, entry_ask, close_mark, close_reason, fire_ts_ms, best_pct_gain
  FROM tracked_plays WHERE entry_mark > 0 AND close_mark IS NOT NULL`).all();

// De-dupe to ONE row per fire event (fire_ts_ms + ticker): the tracker logs several
// candidate strikes per fire; the entered contract is the one nearest the money.
const byFire = new Map();
for (const r of raw) {
  const k = `${r.fire_ts_ms}|${r.ticker}`;
  const mny = Math.abs(r.K - r.spot) / r.spot;
  const prev = byFire.get(k);
  if (!prev || mny < prev._mny) byFire.set(k, { ...r, _mny: mny });
}
const fires = [...byFire.values()].map(r => {
  const dir = r.option_type === 'call' ? 1 : -1;
  const d = new Date(r.fire_ts_ms);
  const closeUtc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 20, 0, 0);
  return {
    ...r, dir,
    ret: (r.close_mark - r.entry_mark) / r.entry_mark,
    mny: Math.abs(r.K - r.spot) / r.spot,            // |strike - spot|/spot
    otm: dir * (r.K - r.spot) / r.spot,              // + = OTM
    mtc: (closeUtc - r.fire_ts_ms) / 60000,          // minutes to 16:00 ET
    etHour: (r.fire_ts_ms - Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 13, 30, 0)) / 3600000 + 9.5,
    spread: (r.entry_ask > 0 && r.entry_bid > 0) ? (r.entry_ask - r.entry_bid) / r.entry_mark : null,
  };
});
const days = [...new Set(fires.map(f => f.day))].sort();
console.log(`live fires (de-duped): ${fires.length} over ${days.length} days: ${days.join(', ')}\n`);

const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
function stats(g) {
  const pos = g.filter(x => x > 0);
  const gp = pos.reduce((s, x) => s + x, 0), gl = -g.filter(x => x <= 0).reduce((s, x) => s + x, 0);
  return { n: g.length, win: pos.length / g.length, exp: mean(g), pf: gl > 0 ? gp / gl : Infinity };
}
const pc = x => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
const f2 = x => (x === Infinity ? ' inf' : x.toFixed(2));
const row = (l, s) => `${l.padEnd(20)}${String(s.n).padStart(5)}${(s.win * 100).toFixed(0).padStart(6)}%${pc(s.exp).padStart(9)}${f2(s.pf).padStart(7)}`;
const HDR = 'bucket'.padEnd(20) + 'n'.padStart(5) + 'win%'.padStart(7) + 'exp'.padStart(9) + 'PF'.padStart(7);

const ALL = stats(fires.map(f => f.ret));
console.log(`SYSTEM (all live fires): ${row('ALL', ALL)}\n`);

// ---------- 0. day clustering — how much of this is one bad day? ----------
console.log('='.repeat(72) + '\n# 0. DAY CLUSTERING (the live "finding" rests on how many days?)');
console.log('day'.padEnd(14) + 'n'.padStart(4) + 'exp'.padStart(9) + 'PF'.padStart(7) + '  avg$entry  avg|mny|');
for (const d of days) {
  const s = fires.filter(f => f.day === d);
  console.log(d.padEnd(14) + String(s.length).padStart(4) + pc(stats(s.map(f => f.ret)).exp).padStart(9)
    + f2(stats(s.map(f => f.ret)).pf).padStart(7) + `   $${mean(s.map(f => f.entry_mark)).toFixed(2)}`.padStart(10)
    + `   ${(100 * mean(s.map(f => f.mny))).toFixed(2)}%`);
}
// leave-one-day-out on the headline claim (>=$3 filter)
console.log('\nLeave-one-day-out: PF of the >=$3 filter vs PF of all fires');
for (const d of [null, ...days]) {
  const sub = d ? fires.filter(f => f.day !== d) : fires;
  const a = stats(sub.map(f => f.ret)), b = stats(sub.filter(f => f.entry_mark >= 3).map(f => f.ret));
  console.log(`  drop ${(d || 'none').padEnd(12)} all PF ${f2(a.pf)} (n=${a.n})   >=$3 PF ${f2(b.pf)} (n=${b.n})  exp ${pc(b.exp)}`);
}

// ---------- 1. the four candidate variables, marginally ----------
console.log('\n' + '='.repeat(72) + '\n# 1. MARGINAL EFFECT OF EACH CANDIDATE');
const VARS = {
  'ENTRY PRICE': [['<$1', f => f.entry_mark < 1], ['$1-3', f => f.entry_mark >= 1 && f.entry_mark < 3],
    ['$3-10', f => f.entry_mark >= 3 && f.entry_mark < 10], ['>$10', f => f.entry_mark >= 10]],
  'MONEYNESS |m|': [['<0.15%', f => f.mny < 0.0015], ['0.15-0.5%', f => f.mny >= 0.0015 && f.mny < 0.005],
    ['0.5-1%', f => f.mny >= 0.005 && f.mny < 0.01], ['>1%', f => f.mny >= 0.01]],
  'TIME-OF-DAY (ET)': [['<11:00', f => f.etHour < 11], ['11-12', f => f.etHour >= 11 && f.etHour < 12],
    ['12-13', f => f.etHour >= 12 && f.etHour < 13], ['>=13:00', f => f.etHour >= 13]],
  'TICKER': [['SPXW', f => f.ticker === 'SPXW'], ['SPY', f => f.ticker === 'SPY'], ['QQQ', f => f.ticker === 'QQQ']],
};
for (const [name, buckets] of Object.entries(VARS)) {
  console.log(`\n-- ${name}`);
  console.log(HDR + '  avg$  avg|mny|  avgET');
  for (const [lab, fn] of buckets) {
    const s = fires.filter(fn); if (!s.length) continue;
    console.log(row(lab, stats(s.map(f => f.ret)))
      + `  $${mean(s.map(f => f.entry_mark)).toFixed(2)}`.padStart(8)
      + `  ${(100 * mean(s.map(f => f.mny))).toFixed(2)}%`.padStart(9)
      + `  ${mean(s.map(f => f.etHour)).toFixed(1)}`.padStart(7));
  }
}

// ---------- 2. correlation structure ----------
console.log('\n' + '='.repeat(72) + '\n# 2. HOW ENTANGLED ARE THEY?');
function corr(a, b) {
  const n = a.length, ma = mean(a), mb = mean(b);
  let nu = 0, da = 0, dbb = 0;
  for (let i = 0; i < n; i++) { nu += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; dbb += (b[i] - mb) ** 2; }
  return nu / Math.sqrt(da * dbb);
}
const rank = v => { const ix = v.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]); const r = new Array(v.length); ix.forEach(([, i], k) => r[i] = k); return r; };
const sp = (a, b) => corr(rank(a), rank(b));
const px = fires.map(f => f.entry_mark), mn = fires.map(f => f.mny),
  et = fires.map(f => f.etHour), sx = fires.map(f => f.ticker === 'SPXW' ? 1 : 0), rr = fires.map(f => f.ret);
console.log('Spearman:');
console.log(`  price ~ moneyness   ${sp(px, mn).toFixed(3)}`);
console.log(`  price ~ is-SPXW     ${sp(px, sx).toFixed(3)}`);
console.log(`  price ~ hour        ${sp(px, et).toFixed(3)}`);
console.log(`  moneyness ~ is-SPXW ${sp(mn, sx).toFixed(3)}`);
console.log(`  moneyness ~ hour    ${sp(mn, et).toFixed(3)}`);
console.log('vs RETURN:');
console.log(`  return ~ price      ${sp(px, rr).toFixed(3)}`);
console.log(`  return ~ moneyness  ${sp(mn, rr).toFixed(3)}`);
console.log(`  return ~ hour       ${sp(et, rr).toFixed(3)}`);
console.log(`  return ~ is-SPXW    ${sp(sx, rr).toFixed(3)}`);

// ---------- 3. HORSE RACE: incremental value, each over the others ----------
console.log('\n' + '='.repeat(72) + '\n# 3. HORSE RACE — incremental value of each filter OVER the others');
const F = {
  'price >= $3': f => f.entry_mark >= 3,
  'moneyness <= 0.3%': f => f.mny <= 0.003,
  'before 13:00 ET': f => f.etHour < 13,
  'ticker = SPXW': f => f.ticker === 'SPXW',
};
const names = Object.keys(F);
console.log('\nEach filter ALONE:');
console.log(HDR + '  kept%');
for (const n of names) {
  const s = fires.filter(F[n]);
  console.log(row(n, stats(s.map(f => f.ret))) + `  ${(100 * s.length / fires.length).toFixed(0)}%`.padStart(7));
}
console.log('\nINCREMENTAL: add filter X on top of the OTHER THREE (does X still add?)');
console.log('adds on top of others'.padEnd(24) + 'n'.padStart(5) + 'exp'.padStart(9) + 'PF'.padStart(7) + '   base(others only)');
for (const n of names) {
  const others = names.filter(o => o !== n);
  const base = fires.filter(f => others.every(o => F[o](f)));
  const with_ = base.filter(F[n]);
  const bs = stats(base.map(f => f.ret));
  if (with_.length < 3) { console.log(`+ ${n}`.padEnd(24) + `  n=${with_.length} (too few)`); continue; }
  const ws = stats(with_.map(f => f.ret));
  console.log(`+ ${n}`.padEnd(24) + String(ws.n).padStart(5) + pc(ws.exp).padStart(9) + f2(ws.pf).padStart(7)
    + `    n=${bs.n} exp ${pc(bs.exp)} PF ${f2(bs.pf)}`);
}
console.log('\nDROP-ONE: remove filter X, keep the other three (how much does losing X cost?)');
for (const n of names) {
  const others = names.filter(o => o !== n);
  const s = fires.filter(f => others.every(o => F[o](f)));
  const full = fires.filter(f => names.every(o => F[o](f)));
  const ss = stats(s.map(f => f.ret)), fs2 = stats(full.map(f => f.ret));
  console.log(`  without ${n.padEnd(20)} n=${String(ss.n).padStart(3)} exp ${pc(ss.exp).padStart(7)} PF ${f2(ss.pf)}   (full stack: n=${fs2.n} exp ${pc(fs2.exp)} PF ${f2(fs2.pf)})`);
}

// ---------- 4. is price just a within-ticker non-event? ----------
console.log('\n' + '='.repeat(72) + '\n# 4. WITHIN-TICKER: does price still sort once ticker is fixed?');
for (const t of ['SPXW', 'SPY', 'QQQ']) {
  const s = fires.filter(f => f.ticker === t);
  if (s.length < 6) { console.log(`  ${t}: n=${s.length} (too few)`); continue; }
  const srt = [...s].sort((a, b) => a.entry_mark - b.entry_mark);
  const medPx = srt[Math.floor(srt.length / 2)].entry_mark;
  const cheap = s.filter(f => f.entry_mark < medPx).map(f => f.ret);
  const pricy = s.filter(f => f.entry_mark >= medPx).map(f => f.ret);
  console.log(`  ${t.padEnd(5)} n=${String(s.length).padStart(3)} medPx $${medPx.toFixed(2)}  cheap exp ${pc(mean(cheap))} (n=${cheap.length})  pricy exp ${pc(mean(pricy))} (n=${pricy.length})  Δ ${pc(mean(pricy) - mean(cheap))}`);
  // and within-ticker moneyness split
  const srtm = [...s].sort((a, b) => a.mny - b.mny);
  const medM = srtm[Math.floor(srtm.length / 2)].mny;
  const near = s.filter(f => f.mny < medM).map(f => f.ret);
  const far = s.filter(f => f.mny >= medM).map(f => f.ret);
  console.log(`        ${' '.repeat(3)} medMny ${(100 * medM).toFixed(2)}%  near exp ${pc(mean(near))} (n=${near.length})  far  exp ${pc(mean(far))} (n=${far.length})  Δ ${pc(mean(near) - mean(far))} (near-far)`);
}

// ---------- 5. REAL friction from recorded bid/ask ----------
console.log('\n' + '='.repeat(72) + '\n# 5. REAL BID/ASK FRICTION (recorded live at entry)');
console.log('bucket'.padEnd(14) + 'n'.padStart(5) + 'avg$entry'.padStart(11) + 'avg spread$'.padStart(13)
  + 'rel spread'.padStart(12) + '  RT cost (cross both ways)');
for (const [lab, fn] of VARS['ENTRY PRICE']) {
  const s = fires.filter(f => fn(f) && f.spread != null);
  if (!s.length) continue;
  const relS = mean(s.map(f => f.spread));
  console.log(lab.padEnd(14) + String(s.length).padStart(5) + `$${mean(s.map(f => f.entry_mark)).toFixed(2)}`.padStart(11)
    + `$${mean(s.map(f => f.entry_ask - f.entry_bid)).toFixed(3)}`.padStart(13)
    + `${(100 * relS).toFixed(1)}%`.padStart(12) + `   ~${(100 * relS).toFixed(1)}% of premium`);
}
console.log('\nSame, by MONEYNESS:');
console.log('bucket'.padEnd(14) + 'n'.padStart(5) + 'avg$entry'.padStart(11) + 'rel spread'.padStart(12));
for (const [lab, fn] of VARS['MONEYNESS |m|']) {
  const s = fires.filter(f => fn(f) && f.spread != null);
  if (!s.length) continue;
  console.log(lab.padEnd(14) + String(s.length).padStart(5) + `$${mean(s.map(f => f.entry_mark)).toFixed(2)}`.padStart(11)
    + `${(100 * mean(s.map(f => f.spread))).toFixed(1)}%`.padStart(12));
}
// friction vs directional failure decomposition
console.log('\nFRICTION vs DIRECTIONAL FAILURE (per price bucket):');
console.log('bucket'.padEnd(14) + 'realized exp'.padStart(13) + 'spread cost'.padStart(13) + 'exp EX-friction'.padStart(16));
for (const [lab, fn] of VARS['ENTRY PRICE']) {
  const s = fires.filter(fn);
  if (!s.length) continue;
  const e = mean(s.map(f => f.ret));
  const c = mean(s.filter(f => f.spread != null).map(f => f.spread));
  console.log(lab.padEnd(14) + pc(e).padStart(13) + `-${(100 * c).toFixed(1)}%`.padStart(13) + pc(e + c).padStart(16));
}
console.log('\n(NB: realized exp is measured mark-to-mark, so the spread cost above is an ADDITIONAL');
console.log(' real-world drag that the mark-based P&L does NOT already include.)');
