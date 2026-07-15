// PIKA CREDIT SPREADS — structure builder (RESEARCH ONLY, Clause 0).
// Computes, per (day, ticker) at a fixed 10:00 ET entry, the pika structure and the
// exact option strikes required for every credit-spread construction + controls.
// No option prices here (that's fetch_legs.mjs); this is pure surface geometry, causal.
//
// Node / relSig definition mirrors src/domain/significance.js EXACTLY:
//   relSig = |gamma| / sum|gamma| ; gamma>0 = pika (pin/positive-gamma wall).
//
// PRE-REGISTERED design knobs (locked before any P&L is seen):
//   ENTRY        = 10:00 ET (14:00:00Z), causal frame at/before.
//   PIKA UNIVERSE= strikes gamma>0 within |K-spot|/spot <= 0.01 (~1%).
//   REAL         = pika absG at t >= 0.90 * absG 5m ago AND >= 0.90 * 15m ago (not shrinking).
//   DOMINANT PIKA= strongest relSig among REAL pikas within 1%. none -> drop day (logged).
//   GRID         = SPXW 5, SPY 1, QQQ 1.
//   SIDE         = sign(pika - spot); >0 pika is a CEILING (sell CALL spread, bet no close
//                  above it); <0 pika is a FLOOR (sell PUT spread, bet no close below it).
//   VERTICAL (a) = short = pika + grid*side (1 strike BEYOND pika, away from spot),
//                  long  = pika + 2*grid*side. width = grid.
//   CONDOR   (b) = strongest REAL pika above spot (ceiling) + strongest below (floor);
//                  bear-call beyond ceiling + bull-put beyond floor.
//   MIRROR ctrl  = reflect dominant pika across spot (2*spot - pika): same distance,
//                  opposite side, (usually) no pika. THE key location control.
//   WEAK ctrl    = weakest REAL pika within 1% (does node STRENGTH matter?).
//   REGIME       = sign(sum gamma over all strikes): + = pin, - = trend.
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BF = path.join(HERE, '..', 'velocity-capture', 'backfill');
const TICKERS = ['SPXW', 'SPY', 'QQQ'];
const GRID = { SPXW: 5, SPY: 1, QQQ: 1 };
const ENTRY_UTC = 'T14:00:00Z';   // 10:00 ET
const REAL_RATIO = 0.90;
const NEAR = 0.01;                // pika must be within 1% of spot

const days = fs.readdirSync(BF).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
function frames(day, t) {
  const p = path.join(BF, day, `${t}.jsonl.gz`);
  if (!fs.existsSync(p)) return [];
  return zlib.gunzipSync(fs.readFileSync(p)).toString().trim().split('\n')
    .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
    .map(s => ({ tsMs: Date.parse(s.requestedTs), spot: +s.spot, strikes: s.strikes || [] }))
    .filter(s => Number.isFinite(s.spot) && s.strikes.length)
    .sort((a, b) => a.tsMs - b.tsMs);
}
const frameAtOrBefore = (fr, ts) => { let b = null; for (const f of fr) { if (f.tsMs <= ts) b = f; else break; } return b; };
function nodes(frame) {
  let tot = 0; const rows = frame.strikes.map(r => ({ strike: +r.strike, gamma: +r.gamma || 0 }));
  for (const r of rows) tot += Math.abs(r.gamma);
  if (!(tot > 0)) return [];
  return rows.map(r => ({ strike: r.strike, gamma: r.gamma, absG: Math.abs(r.gamma),
    sign: r.gamma > 0 ? 'pika' : r.gamma < 0 ? 'barney' : 'zero', relSig: Math.abs(r.gamma) / tot }));
}
const absGAtStrike = (frame, K) => { if (!frame) return null; const r = frame.strikes.find(s => +s.strike === K); return r ? Math.abs(+r.gamma || 0) : 0; };

const design = [], needed = new Map(), drops = [];
const addLeg = (t, day, cp, K) => { if (K == null || !Number.isFinite(K)) return; needed.set(`${t}|${day}|${cp}|${K}`, { ticker: t, day, cp, strike: K }); };

for (const t of TICKERS) {
  const g = GRID[t];
  for (const day of days) {
    const fr = frames(day, t); if (!fr.length) continue;
    const entryTs = Date.parse(day + ENTRY_UTC);
    const f0 = frameAtOrBefore(fr, entryTs); if (!f0) { drops.push({ t, day, why: 'no-frame' }); continue; }
    const f5 = frameAtOrBefore(fr, entryTs - 5 * 60000);
    const f15 = frameAtOrBefore(fr, entryTs - 15 * 60000);
    const ns = nodes(f0); if (!ns.length) { drops.push({ t, day, why: 'no-nodes' }); continue; }
    const spot = f0.spot, netGamma = ns.reduce((s, n) => s + n.gamma, 0);
    const isReal = K => {
      const now = absGAtStrike(f0, K), a5 = absGAtStrike(f5, K), a15 = absGAtStrike(f15, K);
      if (!(now > 0)) return false;
      const ok5 = a5 == null ? true : now >= REAL_RATIO * a5;
      const ok15 = a15 == null ? true : now >= REAL_RATIO * a15;
      return ok5 && ok15;
    };
    const pikasNear = ns.filter(n => n.sign === 'pika' && Math.abs(n.strike - spot) / spot <= NEAR);
    const realPikas = pikasNear.filter(n => isReal(n.strike));
    if (!realPikas.length) { drops.push({ t, day, why: pikasNear.length ? 'no-REAL-pika' : 'no-pika-near' }); continue; }
    const dom = realPikas.reduce((a, b) => (b.relSig > a.relSig ? b : a));
    const weak = realPikas.reduce((a, b) => (b.relSig < a.relSig ? b : a));
    const ceilPika = realPikas.filter(n => n.strike > spot).sort((a, b) => b.relSig - a.relSig)[0] || null;
    const floorPika = realPikas.filter(n => n.strike < spot).sort((a, b) => b.relSig - a.relSig)[0] || null;

    // build a vertical spec {cp, shortK, longK, width} from a pika strike P
    const vert = P => {
      const side = P >= spot ? +1 : -1;                 // ceiling -> call, floor -> put
      const shortK = P + g * side, longK = P + 2 * g * side;
      return { cp: side > 0 ? 'C' : 'P', side, shortK, longK, width: g, anchor: P };
    };
    const domV = vert(dom.strike);
    const weakV = weak.strike === dom.strike ? null : vert(weak.strike);
    const mirrorP = 2 * spot - dom.strike;               // phantom reflection
    const mirrorPsnap = Math.round(mirrorP / g) * g;
    const mirV = vert(mirrorPsnap);
    const condor = (ceilPika && floorPika) ? { call: vert(ceilPika.strike), put: vert(floorPika.strike),
      ceilAnchor: ceilPika.strike, floorAnchor: floorPika.strike } : null;

    // random-control ladder: neutral verticals at fixed offsets both sides (short at offset, long +1 grid out)
    const randSpecs = [];
    for (const off of [0.004, 0.006, 0.008, 0.010]) {
      for (const side of [+1, -1]) {
        const shortK = Math.round(spot * (1 + side * off) / g) * g;
        const longK = shortK + g * side;
        // skip if this short sits on/next to the dominant pika (keep it a genuine non-pika location)
        if (Math.abs(shortK - dom.strike) <= g) continue;
        randSpecs.push({ cp: side > 0 ? 'C' : 'P', side, shortK, longK, width: g, off });
      }
    }

    // register every needed contract
    const reg = v => { if (!v) return; addLeg(t, day, v.cp, v.shortK); addLeg(t, day, v.cp, v.longK); };
    reg(domV); reg(weakV); reg(mirV);
    if (condor) { reg(condor.call); reg(condor.put); }
    for (const rs of randSpecs) reg(rs);

    design.push({
      day, ticker: t, spot, entryTsMs: entryTs, frameTsMs: f0.tsMs, staleMin: (entryTs - f0.tsMs) / 60000,
      netGamma, regime: netGamma >= 0 ? 'pos' : 'neg', grid: g,
      domPika: { strike: dom.strike, relSig: dom.relSig, distPct: (dom.strike - spot) / spot },
      weakPika: { strike: weak.strike, relSig: weak.relSig },
      nRealPikasNear: realPikas.length,
      dom: domV, weak: weakV, mirror: { ...mirV, phantom: mirrorP }, condor, rand: randSpecs,
    });
  }
}
fs.writeFileSync(path.join(HERE, 'design.json'), JSON.stringify(design));
fs.writeFileSync(path.join(HERE, 'needed_contracts.json'), JSON.stringify([...needed.values()]));
// summary
const byT = t => design.filter(d => d.ticker === t);
console.log(`days scanned ${days.length}  |  design rows ${design.length}  |  needed contracts ${needed.size}`);
for (const t of TICKERS) {
  const d = byT(t); const pos = d.filter(x => x.regime === 'pos').length;
  console.log(`  ${t.padEnd(5)} rows ${String(d.length).padStart(3)}  regime +${pos}/-${d.length - pos}  condor-able ${d.filter(x => x.condor).length}  weak!=dom ${d.filter(x => x.weak).length}  medRelSig ${(d.map(x=>x.domPika.relSig).sort((a,b)=>a-b)[d.length>>1]*100).toFixed(1)}%`);
}
const dc = {}; for (const x of drops) dc[x.why] = (dc[x.why] || 0) + 1;
console.log('drops:', JSON.stringify(dc));
