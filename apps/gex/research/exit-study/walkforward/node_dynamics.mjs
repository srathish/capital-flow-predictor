// Node-dynamics pin/break test (research only) — the operator's mechanism:
// the King pins (WALL) when it STAYS dominant; price breaks (ESCALATOR / handoff)
// when a competing node (ceiling above / floor below) GROWS toward the King's
// strength. Dealers roll the ceiling up / drop the floor. Track the King's share
// and the runner-up node's share over the session; test whether price follows the
// STRENGTHENING node.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE = path.join(HERE, '..', '..', '..', 'data', 'skylit-archive', 'intraday');
const days = fs.readdirSync(ARCHIVE).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
const TICKERS = ['SPXW', 'SPY', 'QQQ'];
const BAND = 0.02;

function frames(day, t) {
  const p = path.join(ARCHIVE, day, `${t}.jsonl.gz`); if (!fs.existsSync(p)) return [];
  return zlib.gunzipSync(fs.readFileSync(p)).toString().trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean).map(s => ({ ts: Date.parse(s.requestedTs), spot: s.spot, strikes: (s.strikes || []).map(q => ({ k: +q.strike, g: +q.gamma || 0 })).filter(q => Number.isFinite(q.k)) }))
    .filter(s => s.spot != null && Number.isFinite(s.ts)).sort((a, b) => a.ts - b.ts);
}
// King + strongest competing node (2nd largest |gamma|) near spot, with side & share
function structure(fr) {
  let tot = 0; const near = fr.strikes.filter(q => Math.abs(q.k - fr.spot) / fr.spot <= BAND);
  for (const q of near) tot += Math.abs(q.g); if (!tot) return null;
  const sorted = [...near].sort((a, b) => Math.abs(b.g) - Math.abs(a.g));
  const king = sorted[0]; if (king.g < 0) return null;                 // dominant node must be pika
  const rival = sorted.find(q => q.k !== king.k) || null;
  const shareOf = k => Math.abs((near.find(q => q.k === k)?.g) || 0) / tot;
  return { king: king.k, kingShare: Math.abs(king.g) / tot,
    rival: rival?.k ?? null, rivalShare: rival ? Math.abs(rival.g) / tot : 0,
    rivalSide: rival ? (rival.k > fr.spot ? 'ceiling' : 'floor') : null,
    rivalSign: rival ? (rival.g >= 0 ? 'pika' : 'barney') : null, shareOf };
}
const rows = [];
for (const day of days) for (const t of TICKERS) {
  const fr = frames(day, t); if (fr.length < 8) continue;
  const s0 = structure(fr[0]); if (!s0 || s0.kingShare < 0.21 || s0.rival == null) continue;
  const late = fr[Math.floor(fr.length * 0.7)]; const sL = structure(late); if (!sL) continue;
  // did the King's share DECAY while the rival GREW (share of the SAME strikes, late vs open)?
  const kingShareLate = sL.shareOf(s0.king), rivalShareLate = sL.shareOf(s0.rival);
  const kingDecay = kingShareLate - s0.kingShare;          // <0 = King weakening
  const rivalGrow = rivalShareLate - s0.rivalShare;        // >0 = rival strengthening
  const handoff = kingDecay < 0 && rivalGrow > 0;          // dealers rolling toward the rival
  // outcome: did price move TOWARD the rival by the close?
  const towardRival = Math.abs(fr.at(-1).spot - s0.rival) < Math.abs(fr[0].spot - s0.rival);
  const pinnedKing = Math.abs(fr.at(-1).spot - s0.king) / fr.at(-1).spot < 0.004;
  rows.push({ day, t, kingShare: s0.kingShare, margin: s0.kingShare - s0.rivalShare,
    kingDecay, rivalGrow, handoff, towardRival, pinnedKing, rivalSide: s0.rivalSide, rivalSign: s0.rivalSign });
}
const pct = x => `${(x * 100).toFixed(0)}%`;
const rate = (s, f) => s.length ? s.filter(f).length / s.length : NaN;
console.log(`NODE DYNAMICS (operator's mechanism) — dominant-pika Kings w/ a rival, n=${rows.length}\n`);
console.log('HYPOTHESIS: King stays dominant -> price PINS; rival strengthens (handoff) -> price moves TO rival\n');
const held = rows.filter(r => !r.handoff), roll = rows.filter(r => r.handoff);
console.log(`King HELD dominance (n=${held.length}):  pinned to King ${pct(rate(held, r => r.pinnedKing))}  | moved to rival ${pct(rate(held, r => r.towardRival))}`);
console.log(`HANDOFF: King decayed & rival grew (n=${roll.length}):  pinned to King ${pct(rate(roll, r => r.pinnedKing))}  | moved to rival ${pct(rate(roll, r => r.towardRival))}`);
console.log(`\n=> operator's model holds if: HANDOFF sessions move-to-rival >> HELD sessions, and HELD pin >> HANDOFF pin.`);
// also: split by initial dominance margin
const medM = [...rows].map(r => r.margin).sort((a, b) => a - b)[Math.floor(rows.length / 2)];
console.log(`\nby initial dominance margin (King − rival share, median ${(medM * 100).toFixed(0)}%):`);
for (const [lab, f] of [['HIGH margin (dominant)', r => r.margin >= medM], ['LOW margin (contested)', r => r.margin < medM]]) {
  const s = rows.filter(f); console.log(`  ${lab.padEnd(24)} n=${String(s.length).padStart(3)}  pinned to King ${pct(rate(s, r => r.pinnedKing))}`);
}
