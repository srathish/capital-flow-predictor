// INDEX-SELECTION study — FIRE DETECTION (RESEARCH ONLY, Clause 0).
// Self-contained gamma-released reversal detector run on the 1-min surface for
// SPXW / SPY / QQQ across the velocity-capture backfill (~43 all-3-index days).
//
// SETUP (constant, mechanical, per index — pre-registered):
//   * net near-spot gamma = sum(gamma) for strikes within 0.5% of that index's spot.
//   * RELEASED minute, two variants tested:
//       p40 : netg <= that index's own daily 40th-percentile of netg   (scale-free)
//       neg : netg <= 0                                                (sign-based)
//   * reversal: rolling anchor extreme; a down-swing of >=0.25% off the anchor high
//     that then RECLAIMS (bounces >=0.10% off the swing low) -> CALL; mirror -> PUT.
//   * enter on first reclaim tick (fire), ATM strike = round(spot@entry) (SPX->5, SPY/QQQ->1).
//   * only minutes after 10:00 ET, and only when that minute is RELEASED.
//   * <= 4 fires / index / day; debounce: reset anchor to spot after each fire.
//
// Emits fires_all.json (both variants) + day_features.json (per-day SPX range etc).
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BF = path.join(HERE, '..', 'velocity-capture', 'backfill');
const IDX = ['SPXW', 'SPY', 'QQQ'];

// ---- pre-registered parameters ----
const NEAR_PCT = 0.005;     // 0.5% band around spot for net near-spot gamma
const DROP = 0.0025;        // 0.25% swing to arm
const RECLAIM = 0.0010;     // 0.10% bounce off the extreme = reclaim/reject
const P40 = 0.40;           // daily percentile for the "released" gate (p40 variant)
const MAX_FIRES = 4;        // per index per day
const OPEN_ET_MIN = 10 * 60; // 10:00 ET in minutes-from-midnight (fires only after)

const strikeStep = t => (t === 'SPXW' ? 5 : 1);
const roundK = (t, px) => Math.round(px / strikeStep(t)) * strikeStep(t);
const occ = (t, day, dir, K) =>
  `${t}${day.slice(2, 4)}${day.slice(5, 7)}${day.slice(8, 10)}${dir > 0 ? 'C' : 'P'}${String(Math.round(K * 1000)).padStart(8, '0')}`;

function readSurf(f) {
  const lines = zlib.gunzipSync(fs.readFileSync(f)).toString().trim().split('\n').filter(l => l.trim());
  return lines.map(l => { const d = JSON.parse(l); return { ts: Date.parse(d.requestedTs), spot: d.spot, strikes: d.strikes }; })
    .filter(r => r.spot > 0 && Array.isArray(r.strikes)).sort((a, b) => a.ts - b.ts);
}
function netgNear(row) {
  const lo = row.spot * (1 - NEAR_PCT), hi = row.spot * (1 + NEAR_PCT);
  let s = 0; for (const k of row.strikes) if (k.strike >= lo && k.strike <= hi) s += k.gamma;
  return s;
}
// ET minute-of-day from a UTC ms ts (backfill is EDT = UTC-4 in Apr-Jul window)
function etMin(tsMs) { const d = new Date(tsMs); return (d.getUTCHours() - 4) * 60 + d.getUTCMinutes(); }

function quantile(arr, p) { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }

// Detect reversal fires for one index/day. `gateFn(netg, thr)` decides released.
function detectDay(rows, ticker, day, variant) {
  const ng = rows.map(netgNear);
  const thr = variant === 'p40' ? quantile(ng, P40) : 0;
  const released = i => (variant === 'p40' ? ng[i] <= thr : ng[i] <= 0);

  const fires = [];
  // anchor state for BOTH directions simultaneously
  let anchorHi = rows[0].spot, anchorLo = rows[0].spot;   // rolling extremes since last reset
  let swingLo = rows[0].spot, swingHi = rows[0].spot;
  let armedCall = false, armedPut = false;
  for (let i = 1; i < rows.length; i++) {
    const s = rows[i].spot;
    const et = etMin(rows[i].ts);
    // update extremes
    if (s > anchorHi) { anchorHi = s; swingHi = s; }        // new high resets the up-anchor tracking for puts
    if (s < anchorLo) { anchorLo = s; swingLo = s; }
    // track swing extremes within an active leg
    if (s < swingLo) swingLo = s;
    if (s > swingHi) swingHi = s;

    // arm a down-swing (for a CALL) when drawdown from anchorHi >= DROP
    if (!armedCall && (anchorHi - s) / anchorHi >= DROP) { armedCall = true; swingLo = s; }
    if (armedCall && s < swingLo) swingLo = s;
    // arm an up-swing (for a PUT) when run-up from anchorLo >= DROP
    if (!armedPut && (s - anchorLo) / anchorLo >= DROP) { armedPut = true; swingHi = s; }
    if (armedPut && s > swingHi) swingHi = s;

    if (et < OPEN_ET_MIN) continue;               // only after 10:00 ET
    const dayFires = fires.length;
    if (dayFires >= MAX_FIRES) break;

    // CALL: armed down-swing then reclaim (bounce >= RECLAIM off swingLo)
    if (armedCall && (s - swingLo) / swingLo >= RECLAIM && released(i)) {
      const K = roundK(ticker, s);
      fires.push({ day, ticker, dir: 1, K, fireTsMs: rows[i].ts, etMin: et, spot: s,
        netg: ng[i], thr, swingDrop: (anchorHi - swingLo) / anchorHi, sym: occ(ticker, day, 1, K) });
      // reset both anchors to current -> require a fresh swing
      anchorHi = s; anchorLo = s; swingLo = s; swingHi = s; armedCall = false; armedPut = false;
      continue;
    }
    // PUT: armed up-swing then reject (drop >= RECLAIM off swingHi)
    if (armedPut && (swingHi - s) / swingHi >= RECLAIM && released(i)) {
      const K = roundK(ticker, s);
      fires.push({ day, ticker, dir: -1, K, fireTsMs: rows[i].ts, etMin: et, spot: s,
        netg: ng[i], thr, swingDrop: (swingHi - anchorLo) / anchorLo, sym: occ(ticker, day, -1, K) });
      anchorHi = s; anchorLo = s; swingLo = s; swingHi = s; armedCall = false; armedPut = false;
      continue;
    }
  }
  return { fires, ng, thr };
}

// ---- run over all all-3-index days ----
const days = fs.readdirSync(BF).filter(d => /^\d{4}-\d\d-\d\d$/.test(d))
  .filter(d => IDX.every(t => fs.existsSync(path.join(BF, d, `${t}.jsonl.gz`)))).sort();

const out = { p40: [], neg: [] };
const dayFeat = [];
for (const day of days) {
  const surf = {};
  for (const t of IDX) surf[t] = readSurf(path.join(BF, day, `${t}.jsonl.gz`));
  if (IDX.some(t => surf[t].length < 300)) { continue; }   // need a full session on all 3
  // per-day features (SPX pinned classification uses SPXW realized range)
  const spx = surf.SPXW;
  const hi = Math.max(...spx.map(r => r.spot)), lo = Math.min(...spx.map(r => r.spot));
  const open = spx[0].spot;
  const spxNg = spx.map(netgNear);
  const feat = { day, spxRangePct: (hi - lo) / open * 100,
    spxNetgMedM: quantile(spxNg, 0.5) / 1e6, spxNetgMinM: Math.min(...spxNg) / 1e6 };
  // also record each index's realized range for the "pick the mover" ranker
  for (const t of IDX) { const r = surf[t]; feat[`${t}_rangePct`] = (Math.max(...r.map(x => x.spot)) - Math.min(...r.map(x => x.spot))) / r[0].spot * 100; }
  // morning range (open -> 10:00) per index for the ranker
  for (const t of IDX) {
    const r = surf[t].filter(x => etMin(x.ts) <= OPEN_ET_MIN);
    feat[`${t}_amRangePct`] = r.length ? (Math.max(...r.map(x => x.spot)) - Math.min(...r.map(x => x.spot))) / r[0].spot * 100 : 0;
    // net near-spot gamma at ~10:00 (the ranker's "most released" signal)
    const at10 = surf[t].find(x => etMin(x.ts) >= OPEN_ET_MIN) || surf[t].at(-1);
    feat[`${t}_netg10M`] = netgNear(at10) / 1e6;
  }
  dayFeat.push(feat);

  for (const variant of ['p40', 'neg']) {
    for (const t of IDX) {
      const { fires } = detectDay(surf[t], t, day, variant);
      out[variant].push(...fires);
    }
  }
}

fs.writeFileSync(path.join(HERE, 'fires_all.json'), JSON.stringify(out));
fs.writeFileSync(path.join(HERE, 'day_features.json'), JSON.stringify(dayFeat));

// ---- summary ----
const summ = (arr) => {
  const byIdx = {}; for (const f of arr) byIdx[f.ticker] = (byIdx[f.ticker] || 0) + 1;
  const daysWith = t => new Set(arr.filter(f => f.ticker === t).map(f => f.day)).size;
  return IDX.map(t => `${t} ${byIdx[t] || 0}fires/${daysWith(t)}d`).join('  ');
};
console.log(`days=${days.length}  (${days[0]}..${days.at(-1)})`);
console.log(`p40: ${out.p40.length} fires  |  ${summ(out.p40)}`);
console.log(`neg: ${out.neg.length} fires  |  ${summ(out.neg)}`);
const uniqSym = new Set(out.p40.concat(out.neg).map(f => `${f.sym}|${f.day}`));
console.log(`unique (sym,day) option contracts to pull: ${uniqSym.size}`);
fs.writeFileSync(path.join(HERE, 'need_symbols.json'), JSON.stringify([...uniqSym].map(s => { const [sym, day] = s.split('|'); return { sym, day }; })));
