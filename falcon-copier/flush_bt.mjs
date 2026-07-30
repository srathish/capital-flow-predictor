// FLUSH BACKTEST — encode the user's "Negative-Gamma King-Node Flush" playbook and test capture vs our current
// scalp. Entry = same barney tap+retrace we already have, BUT gated on a NEGATIVE-GAMMA regime (thin chain
// below) and managed the playbook way: target the next POSITIVE node below (the floor), stop above the King,
// take profit when the near-money regime flips positive (the pin forms). Prints the flush trade + the roll-down.
// Usage: node flush_bt.mjs [YYYY-MM-DD]   (default 2026-07-29, read from today_SPXW cache)
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const DAY = process.argv[2] || '2026-07-29';
const VC = path.join(process.cwd(), 'apps/gex/research/velocity-capture'), FC = path.join(process.cwd(), 'falcon-copier');
const sign = (x) => x > 0 ? 1 : x < 0 ? -1 : 0;
const et = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const etM = (ts) => (+ts.slice(11, 13) - 4) * 60 + +ts.slice(14, 16);
function load(day) {
  const r = path.join(VC, `replay_${day}_SPXW.jsonl.gz`); if (fs.existsSync(r)) return zlib.gunzipSync(fs.readFileSync(r)).toString().trim().split('\n').map(l => { const o = JSON.parse(l); return { ts: o.ts, spot: o.spot, strikes: o.strikes.map(n => ({ k: n.strike ?? n.k, g0: n.g0 })) }; });
  const c = path.join(FC, `today_SPXW.jsonl.gz`); if (day === '2026-07-29' && fs.existsSync(c)) return zlib.gunzipSync(fs.readFileSync(c)).toString().trim().split('\n').map(l => JSON.parse(l));
  return null;
}
const F = load(DAY); if (!F) { console.log(`no data for ${DAY}`); process.exit(0); }
const STRONG = 15e6, RANGE = 20, TAP = 6, FLOOR_MIN = 20e6, STOP_BUF = 8;
const g0At = (s, k) => (s.strikes.find(n => n.k === k)?.g0 || 0);
const domNegK = (s, spot) => { const d = s.strikes.filter(n => Math.abs(n.k - spot) <= 70 && n.g0 < 0).sort((a, b) => a.g0 - b.g0)[0]; return d ? d.k : null; };
const regimeNet = (s, spot) => s.strikes.filter(n => Math.abs(n.k - spot) <= 40).reduce((a, c) => a + c.g0, 0);
const negCount = (s, spot) => { const b = s.strikes.filter(n => Math.abs(n.k - spot) <= 40); return [b.filter(n => n.g0 < 0).length, b.filter(n => n.g0 > 0).length]; };

let pos = null, cd = -99, tappedKing = null;
const trades = [];
for (let i = 15; i < F.length; i++) {
  const s = F[i], spot = s.spot, m = etM(s.ts); if (m > 16 * 60) break;
  const dom = domNegK(s, spot), net = regimeNet(s, spot), [neg, posc] = negCount(s, spot);
  if (pos) {
    const tgtHit = spot <= pos.target, stopHit = spot >= pos.stop, eod = m >= 15 * 60 + 58;
    const pinFlip = net > 0 && spot <= pos.entry - 15;                 // near-money regime flipped positive below entry = the pin formed = bank it
    if (tgtHit || stopHit || eod || pinFlip) { trades.push({ ...pos, exitET: et(s.ts), exit: +spot.toFixed(1), pnl: +((pos.entry - spot)).toFixed(1), why: tgtHit ? 'floor' : stopHit ? 'stop' : pinFlip ? 'pin-flip' : 'eod' }); pos = null; cd = i + 10; }
    continue;
  }
  // 1) TAP: price comes within TAP of a strong overhead barney → remember that King node
  const oh = s.strikes.filter(n => n.g0 <= -STRONG && n.k >= spot - 2 && n.k <= spot + RANGE).sort((a, b) => a.g0 - b.g0)[0];
  if (oh && Math.abs(spot - oh.k) <= TAP) tappedKing = { k: oh.k, g0: oh.g0, i };
  if (tappedKing && (i - tappedKing.i > 40 || spot > tappedKing.k + STOP_BUF)) tappedKing = null;   // stale or broke above = invalidated
  // 2) ENTRY: after a tap, the dominant negative node ROLLS DOWN below the King, price is below it, neg-gamma regime, floor exists
  const negGamma = net < -40e6 && neg > posc;                          // negative-gamma regime = thin chain, moves accelerate/trend
  const rollDown = tappedKing && dom != null && dom < tappedKing.k;    // dominant negative node migrated below the tapped King = top confirmed
  const floor = s.strikes.filter(n => n.g0 >= FLOOR_MIN && n.k < spot - 10).sort((a, b) => b.k - a.k)[0];
  if (i >= cd && tappedKing && rollDown && spot < tappedKing.k && negGamma && floor) {
    pos = { entryET: et(s.ts), entry: +spot.toFixed(1), king: tappedKing.k, kingG: tappedKing.g0, roll: `${tappedKing.k}→${dom}`, target: floor.k, floorG: floor.g0, stop: +(tappedKing.k + STOP_BUF).toFixed(1), regime: `${neg}n/${posc}p` };
    tappedKing = null;
  }
}
console.log(`\n═══ FLUSH BACKTEST ${DAY} — neg-gamma king-node flush (target=floor, not scalp) ═══`);
for (const t of trades) console.log(`  ${t.entryET} SHORT @${t.entry} · King ${t.king}(${(t.kingG / 1e6).toFixed(0)}M) regime ${t.regime}${t.roll ? ' +rolldown' : ''} → target ${t.target} · exit ${t.exitET} @${t.exit}  ${t.pnl >= 0 ? '+' : ''}${t.pnl}pt (${t.why})`);
if (!trades.length) console.log('  (no flush setup fired)');
else console.log(`  TOTAL ${trades.length} trades · ${trades.filter(t => t.pnl > 0).length}W · ${trades.reduce((a, c) => a + c.pnl, 0).toFixed(0)}pt`);
console.log(`  (compare: our current scalp caught +15pt on this move and was flat before the roll-down)`);
