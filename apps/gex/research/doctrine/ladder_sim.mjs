// Node-growth-gated LADDER simulator.
// Rule: ladder the aligned side ONLY when a growing king validates the magnet.
//   direction = side of the dominant growing king pika (above spot → bull toward it;
//               below → bear toward it)
//   GATE (all required): target-strike gamma grew >= GROWTH x over 30 min
//                        AND spot→king spread >= MIN_SPREAD_PCT
//                        AND the radar (regime-aware momentum) is not OPPOSING
//   entry  = first mark the gate opens;  rungs = ATM..king on the aligned side
//   exit   = when spot TAPS the king (within deflection) OR gate closes OR EOD
// P&L uses REAL UW option marks. Small/static node → NO LADDER (sit out).
// Usage: node ladder_sim.mjs 2026-07-21
import '../../scripts/_env-bootstrap.js';
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const DAY = process.argv[2] || '2026-07-21';
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
// ── tunable gate ─────────────────────────────────────────────
const GROWTH = 2.5;            // king must grow >= 2.5x over 30 min
const MIN_SPREAD_PCT = 0.35;   // spot->king room, % of spot
const RUNGS = 6, STEP = 10;    // 6 strikes, 10-pt apart
const DEFL = 5;                // SPX deflection (king-tap) in points
// ─────────────────────────────────────────────────────────────
const DIR = path.join(process.cwd(), 'research', 'velocity-capture');
const load = (tk) => { const f = path.join(DIR, `replay_${DAY}_${tk}.jsonl.gz`); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => JSON.parse(l)) : []; };
const etOf = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const spxw = load('SPXW');
if (!spxw.length) { console.log(`no ${DAY} SPXW data`); process.exit(1); }
const gammaAt = (frame, k) => { const n = frame.strikes.find(x => x.strike === k); return n ? n.g0 : 0; };
const kingPika = (frame) => { const s = frame.spot; const above = frame.strikes.filter(n => n.g0 > 0 && n.strike > s).sort((a, b) => b.g0 - a.g0)[0]; const below = frame.strikes.filter(n => n.g0 > 0 && n.strike < s).sort((a, b) => b.g0 - a.g0)[0]; const k = [above, below].filter(Boolean).sort((a, b) => b.g0 - a.g0)[0]; return k ? { strike: k.strike, g: k.g0, side: k.strike > s ? 'BULL' : 'BEAR' } : null; };
// simple radar veto: net-gamma-regime momentum sign over 15 min
const radarDir = (i) => { const f = spxw[i], b = spxw[Math.max(0, i - 15)]; const mom = (f.spot - b.spot) / f.spot * 100; return mom > 0.15 ? 'BULL' : mom < -0.15 ? 'BEAR' : 'NEUT'; };

// ── scan for the ladder trigger ──────────────────────────────
const marks = [];
for (let m = 30; m < spxw.length; m += 15) marks.push(m);   // every 15 min, after 10:00
let trig = null;
for (const i of marks) {
  const f = spxw[i], king = kingPika(f);
  if (!king) continue;
  const spread = Math.abs(king.strike - f.spot) / f.spot * 100;
  const gPrev = gammaAt(spxw[i - 30], king.strike);         // same strike, 30 min ago
  const growth = gPrev > 0 ? king.g / gPrev : (king.g > 0 ? 99 : 0);
  const veto = radarDir(i) !== 'NEUT' && radarDir(i) !== king.side;   // radar actively opposing
  const pass = growth >= GROWTH && spread >= MIN_SPREAD_PCT && !veto;
  if (pass) { trig = { i, et: etOf(f.ts), spot: f.spot, king: king.strike, side: king.side, growth, spread, kingG: king.g }; break; }
}
console.log(`=== LADDER SIM — ${DAY} (gate: growth>=${GROWTH}x, spread>=${MIN_SPREAD_PCT}%, radar not opposing) ===`);
if (!trig) { console.log(`\nNO LADDER — gate never opened (no strongly-growing king with room). Correct behavior on a static/chop day: sit out.`); process.exit(0); }

// exit: first frame after entry where spot taps the king (within DEFL) or EOD
let exit = spxw[spxw.length - 1], exitReason = 'EOD';
for (let j = trig.i; j < spxw.length; j++) { if (Math.abs(spxw[j].spot - trig.king) <= DEFL) { exit = spxw[j]; exitReason = 'king-tap'; break; } }
const exitET = etOf(exit.ts);
console.log(`\nTRIGGER ${trig.et}ET: ${trig.side} — king ${trig.king} grew ${trig.growth.toFixed(1)}x (to ${(trig.kingG/1e6).toFixed(0)}M), spot ${trig.spot.toFixed(0)}, spread ${trig.spread.toFixed(2)}%`);
console.log(`EXIT ${exitET}ET (${exitReason}): spot ${exit.spot.toFixed(0)}`);

// ── rungs + real UW P&L ──────────────────────────────────────
const cp = trig.side === 'BULL' ? 'C' : 'P';
const base = Math.round(trig.spot / STEP) * STEP;
const rungs = Array.from({ length: RUNGS }, (_, r) => trig.side === 'BULL' ? base + r * STEP : base - r * STEP);
const occ = (k) => `SPXW${DAY.slice(2).replace(/-/g, '')}${cp}${String(Math.round(k * 1000)).padStart(8, '0')}`;
async function markAt(k, et) {
  const r = await fetch(`https://api.unusualwhales.com/api/option-contract/${occ(k)}/intraday?date=${DAY}`, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) return null;
  const pts = ((await r.json())?.data || []).map(x => ({ et: new Date(x.start_time).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false }).slice(0, 5), m: +(x.close ?? x.avg_price ?? 0) })).filter(p => p.m > 0).sort((a, b) => a.et.localeCompare(b.et));
  const e = pts.find(p => p.et >= et) || pts[0];
  return e ? e.m : null;
}
console.log(`\nLADDER (${cp}), entry ${trig.et} → exit ${exitET}:`);
let sumUsd = 0, sumPct = 0, n = 0;
for (const k of rungs) {
  const en = await markAt(k, trig.et); await new Promise(r => setTimeout(r, 300));
  const ex = await markAt(k, exitET); await new Promise(r => setTimeout(r, 300));
  if (en == null || ex == null || en <= 0) { console.log(`  ${k}${cp}: no marks`); continue; }
  const pct = (ex - en) / en * 100, usd = (ex - en) * 100;
  sumUsd += usd; sumPct += pct; n++;
  console.log(`  ${k}${cp}  ${en.toFixed(2).padStart(6)} → ${ex.toFixed(2).padStart(6)}  ${(pct >= 0 ? '+' : '') + pct.toFixed(0)}%  (${usd >= 0 ? '+$' : '-$'}${Math.abs(usd).toFixed(0)})`);
}
if (n) console.log(`\nLADDER TOTAL: ${n} rungs, mean ${(sumPct / n >= 0 ? '+' : '') + (sumPct / n).toFixed(0)}%/rung, net ${sumUsd >= 0 ? '+$' : '-$'}${Math.abs(sumUsd).toFixed(0)} (1 contract/rung)`);
