#!/usr/bin/env node
// perexpiry.mjs — PER-EXPIRY GEX/VEX validator. The aggregate map (assembleStructure)
// SUMS gamma/vanna across all expirations per strike, which blends nodes that live in
// different expiries on different clocks (e.g. MU's 955 short-gamma pocket is 8/17 and
// decays Monday, while its 1100 vanna king is the 8/21 monthly). This tool decomposes
// the Skylit surface BY EXPIRY and derives expiry-tagged levels so we match the option
// to the expiry whose structure actually supports it, and validate that the planned
// direction is confirmed by the dealer map.
//
//   node perexpiry.mjs --date 2026-08-14 --plans data/plans/2026-08-17_sysval.json
//   node perexpiry.mjs --date 2026-08-14 MU NVDA AVGO           (defaults to long)
import { loadConfig, loadEnvKeysFrom, resolveFromRoot, readJson, log } from './lib/util.mjs';
loadEnvKeysFrom(resolveFromRoot('../../.env'), ['ANTHROPIC_API_KEY', 'UNUSUAL_WHALES_API_KEY']);
const { GexProvider } = await import('./providers/gex-skylit.mjs');

const args = process.argv.slice(2);
const getOpt = (f, d = null) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const AS_OF = getOpt('--date', '2026-08-14');
const plansFile = getOpt('--plans');
let targets = [];
if (plansFile) {
  const sv = readJson(resolveFromRoot(plansFile)) || readJson(plansFile);
  targets = (sv?.rows || []).filter((r) => r.dir === 'long' || r.dir === 'short').map((r) => ({ t: r.t, dir: r.dir, tgt: r.tgt, run: r.run, inval: r.inval }));
} else {
  targets = args.filter((a) => !a.startsWith('--') && !/^\d{4}-\d{2}-\d{2}$/.test(a) && a !== AS_OF).map((t) => ({ t: t.toUpperCase(), dir: 'long' }));
}
if (!targets.length) { console.log('no targets. pass --plans <sysval.json> or TICKER...'); process.exit(1); }

const config = loadConfig();
const M = (x) => Math.round((x / 1e6) * 100) / 100;
const pctOf = (k, spot) => Math.round((k - spot) / spot * 1000) / 10;
const eShort = (E) => E.slice(5).replace('-', '/'); // 2026-08-21 -> 08/21
const gex = new GexProvider({ maxStrikes: config.ingest.max_strikes, maxExpirations: config.ingest.max_expirations, eodHHMM: config.ingest.skylit_eod_hhmm });
try { await gex.init(); } catch (e) { console.log('AUTH-FAIL:', e.message); process.exit(2); }

// which single expiry contributes the most |field| at a given strike row
function domExpiry(strikeObj, field) {
  const map = strikeObj[field] || {};
  let best = null, bv = 0;
  for (const [E, v] of Object.entries(map)) { if (Math.abs(v) > bv) { bv = Math.abs(v); best = E; } }
  return best ? { E: best, v: map[best] } : null;
}

function analyze(profile, dir) {
  const spot = profile.spot;
  const S = profile.strikes;
  const maxG = Math.max(...S.map((s) => Math.abs(s.gexAgg)), 1);
  const maxV = Math.max(...S.map((s) => Math.abs(s.vexAgg)), 1);
  const sigG = 0.2 * maxG, sigV = 0.2 * maxV;
  const long = dir === 'long';

  // per-expiry weight (which expiry drives gamma / vanna overall)
  const byExpG = {}, byExpV = {};
  for (const s of S) {
    for (const [E, v] of Object.entries(s.perExpiry || {})) byExpG[E] = (byExpG[E] || 0) + Math.abs(v);
    for (const [E, v] of Object.entries(s.perExpiryVanna || {})) byExpV[E] = (byExpV[E] || 0) + Math.abs(v);
  }
  const driveG = Object.entries(byExpG).sort((a, b) => b[1] - a[1])[0];
  const driveV = Object.entries(byExpV).sort((a, b) => b[1] - a[1])[0];

  // helper to describe a level with its dominant expiry tag
  const tag = (s, kind) => {
    const d = domExpiry(s, kind === 'g' ? 'perExpiry' : 'perExpiryVanna');
    return d ? `${eShort(d.E)} ${kind === 'g' ? 'G' : 'V'}${M(d.v) >= 0 ? '+' : ''}${M(d.v)}M` : '—';
  };

  // T1 = nearest significant POSITIVE-gamma wall in the trade direction (above for long)
  const wallsDir = S.filter((s) => s.gexAgg > sigG && (long ? s.strike > spot * 1.001 : s.strike < spot * 0.999))
    .sort((a, b) => (long ? a.strike - b.strike : b.strike - a.strike));
  const t1 = wallsDir[0] || null;
  // runner = biggest POSITIVE-vanna magnet in the trade direction
  const magsDir = S.filter((s) => s.vexAgg > sigV && (long ? s.strike > spot : s.strike < spot))
    .sort((a, b) => b.vexAgg - a.vexAgg);
  const runner = magsDir[0] || null;
  // stop-side support = nearest significant positive-gamma node AGAINST the trade (below for long)
  const supp = S.filter((s) => s.gexAgg > sigG && (long ? s.strike < spot * 0.999 : s.strike > spot * 1.001))
    .sort((a, b) => (long ? b.strike - a.strike : a.strike - b.strike));
  const support = supp[0] || null;
  // short-gamma pocket near spot on the losing side (unstable / decaying near-dated fuel)
  const pocket = S.filter((s) => s.gexAgg < -0.12 * maxG && (long ? (s.strike < spot && s.strike > spot * 0.97) : (s.strike > spot && s.strike < spot * 1.03)))
    .sort((a, b) => a.strike - b.strike);
  // A large positive-gamma pin BEHIND spot (below for a long) is SUPPORT the dealers
  // defend — a floor, NOT a cap. A cap is only an adjacent wall AHEAD (handled by PINNED).
  const strongFloor = support && support.gexAgg >= 0.45 * maxG;

  // verdict
  let verdict = 'THIN', why = '';
  const room = t1 ? Math.abs(pctOf(t1.strike, spot)) : null;
  const floorNote = strongFloor ? ` · strong ${support.strike} floor` : (support ? '' : ' · NO gamma support below');
  if (!t1 && runner) { verdict = 'VANNA-ONLY'; why = `no gamma wall ahead — target is the ${runner.strike} vanna magnet only${floorNote}`; }
  else if (!t1) { verdict = 'NO-STRUCT'; why = 'no wall or magnet ahead'; }
  else if (room < 0.4) { verdict = 'PINNED'; why = `spot on the ${t1.strike} wall (${room}%) — immediate resistance${floorNote}`; }
  else if (room > 8) { verdict = 'WIDE'; why = `nearest wall ${t1.strike} is far (+${room}%); relies on the ${runner ? runner.strike + ' magnet' : 'move'}${floorNote}`; }
  else if (runner) { verdict = 'CONFIRM'; why = `wall ${t1.strike} (+${room}%) + ${runner.strike} vanna magnet ahead${floorNote}`; }
  else { verdict = 'THIN'; why = `wall ${t1.strike} ahead but no vanna magnet${floorNote}`; }

  const vScore = runner ? Math.min(M(Math.abs(runner.vexAgg)), 800) : 0;
  const score = ({ CONFIRM: 3, 'VANNA-ONLY': 2, WIDE: 1.5, THIN: 1, PINNED: 1, 'NO-STRUCT': 0 }[verdict] || 0) * 1000
    + vScore + (strongFloor ? 250 : 0);
  return { spot, driveG, driveV, t1, runner, support, pocket, strongFloor, verdict, why, score, tag };
}

const out = [];
for (const { t, dir } of targets) {
  try {
    const p = await gex.getProfile(t, { date: AS_OF });
    if (!p) { log(`${t.padEnd(6)} — no structure`); out.push({ t, dir, verdict: 'NODATA', score: -1 }); continue; }
    const a = analyze(p, dir);
    out.push({ t, dir, ...a });
  } catch (e) {
    if (e.message === 'AUTH') { log('AUTH died mid-run'); break; }
    log(`${t.padEnd(6)} — err ${e.message}`);
  }
}

// ranked report
out.sort((x, y) => (y.score ?? -1) - (x.score ?? -1));
log(`\n████ PER-EXPIRY VALIDATION — ${targets.length} names, as-of ${AS_OF} ████`);
log(`(T1 = nearest gamma wall ahead · RUN = biggest vanna magnet ahead · STOP = nearest support behind · POCKET = near-dated short-gamma)\n`);
for (const r of out) {
  if (!r.spot) { log(`${r.t.padEnd(6)} ${String(r.dir).padEnd(5)} ${r.verdict}`); continue; }
  const fmt = (s, kind) => s ? `${s.strike} [${r.tag(s, kind)}] ${pctOf(s.strike, r.spot) >= 0 ? '+' : ''}${pctOf(s.strike, r.spot)}%` : '—';
  const pkt = r.pocket.length ? `${r.pocket[0].strike}-${r.pocket[r.pocket.length - 1].strike}` : '—';
  log(`${r.t.padEnd(6)} ${String(r.dir).padEnd(5)} spot ${r.spot}  drive: ${r.driveV ? eShort(r.driveV[0]) : '—'}(V) ${r.driveG ? eShort(r.driveG[0]) : '—'}(G)   【${r.verdict}】`);
  log(`   T1 ${fmt(r.t1, 'g')}   RUN ${fmt(r.runner, 'v')}   STOP ${fmt(r.support, 'g')}   POCKET ${pkt}`);
  log(`   → ${r.why}`);
}
const conf = out.filter((r) => r.verdict === 'CONFIRM').map((r) => `${r.t}${r.strongFloor ? '*' : ''}`);
const spec = out.filter((r) => ['VANNA-ONLY', 'WIDE'].includes(r.verdict)).map((r) => r.t);
const weak = out.filter((r) => ['PINNED', 'THIN', 'NO-STRUCT', 'NODATA'].includes(r.verdict)).map((r) => r.t);
log(`\nCONFIRM (${conf.length})  [* = strong gamma floor below]: ${conf.join(' ')}`);
log(`SPECULATIVE (${spec.length})  [magnet ahead, gamma wall far/absent → melt-up dependent]: ${spec.join(' ')}`);
log(`WEAK/PINNED (${weak.length}): ${weak.join(' ')}`);
