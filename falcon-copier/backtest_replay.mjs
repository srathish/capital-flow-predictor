// HISTORICAL REPLAY BACKTEST — run the SAME PIKA/BARNEY engine on a PAST day using velocity-capture replay
// files (SPXW always; SPY/QQQ only where captured, e.g. 07-20/07-21). Then compare the blotter to Falcon's
// documented picks for that day (falcon_picks.json). HONEST LIMITATION: flow (UW option-trades) and dark-pool
// value-area are NOT reconstructable for a past day, so this scores only the 5 GEX-derivable criteria
// (at-node · strong · vanna · king-migration · pivot-side), not the live 7. prevClose = prior replay day's
// last spot. Usage: node backtest_replay.mjs <YYYY-MM-DD> [THRESH=3]
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const DAY = process.argv[2] || '2026-07-20', THRESH = Number(process.argv[3] || 3), BIAS = Number(process.argv[4] || 0);   // BIAS: -1 bear-only / +1 bull-only / 0 both (tests Falcon's one-thesis-per-day lock)
const VC = path.join(process.cwd(), 'apps/gex/research/velocity-capture');
const sign = (x) => x > 0 ? 1 : x < 0 ? -1 : 0;
const etOf = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const etMin = (ts) => (+ts.slice(11, 13) - 4) * 60 + +ts.slice(14, 16);
const load = (sym, day) => { const f = path.join(VC, `replay_${day}_${sym}.jsonl.gz`); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString().trim().split('\n').map(l => JSON.parse(l)) : null; };
// prevClose = last spot of the most recent replay day for that symbol strictly before DAY
function prevClose(sym) {
  const days = fs.readdirSync(VC).map(f => (f.match(new RegExp(`^replay_(\\d{4}-\\d{2}-\\d{2})_${sym}\\.jsonl\\.gz$`)) || [])[1]).filter(Boolean).filter(d => d < DAY).sort();
  if (!days.length) return null; const F = load(sym, days[days.length - 1]); return F ? F[F.length - 1].spot : null;
}
const INSTR = [{ sym: 'SPXW', strong: 15e6, range: 20, gap: 5, stop: 8, cool: 10 }, { sym: 'SPY', strong: 15e6, range: 3, gap: 0.5, stop: 0.8, cool: 10 }, { sym: 'QQQ', strong: 5e6, range: 3, gap: 0.5, stop: 0.8, cool: 10 }];
const kingOf = (fr) => fr.strikes.filter(n => n.g0 > 0).sort((a, b) => b.g0 - a.g0)[0];
const picks = (JSON.parse(fs.readFileSync(path.join(process.cwd(), 'falcon-copier', 'falcon_picks.json'), 'utf8')).picks || []).filter(p => p.date === DAY);
const blot = [];
for (const I of INSTR) {
  const F = load(I.sym, DAY); if (!F) { continue; }
  const pc = prevClose(I.sym);
  let pos = null, cd = -99;
  for (let i = 15; i < F.length; i++) {
    const s = F[i], spot = s.spot, m = etMin(s.ts); if (m > 15 * 60 + 45) break;
    if (pos) { const tgt = pos.dir > 0 ? spot >= pos.target : spot <= pos.target, stp = pos.dir > 0 ? spot <= pos.stop : spot >= pos.stop, eod = m >= 15 * 60 + 55;
      if (tgt || stp || eod) { blot.push({ sym: I.sym, ...pos, exitET: etOf(s.ts), exit: +spot.toFixed(1), pnl: +((spot - pos.entry) * pos.dir).toFixed(1), why: tgt ? 'tgt' : stp ? 'stop' : 'eod' }); pos = null; } continue; }
    if (i < cd) continue;
    const king = kingOf(s); if (!king) continue; const kingPrev = kingOf(F[i - 15]);
    const migDir = kingPrev && Math.abs(king.strike - kingPrev.strike) >= I.gap ? sign(king.strike - kingPrev.strike) : 0;
    const cands = [];
    const pin = s.strikes.filter(n => n.g0 >= I.strong && Math.abs(n.strike - spot) >= I.gap && Math.abs(n.strike - spot) <= I.range).sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))[0];
    if (pin) cands.push({ kind: 'PIKA', dir: sign(pin.strike - spot), anchor: pin, target: pin.strike, strong: pin.g0 >= I.strong * 1.3, vanna: pin.v0 > 0 });
    const barn = s.strikes.filter(n => n.g0 <= -I.strong && Math.abs(n.strike - spot) >= I.gap && Math.abs(n.strike - spot) <= I.range * 0.5).sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))[0];
    if (barn) {
      const d = -sign(barn.strike - spot), look = F.slice(Math.max(0, i - 5), i + 1).map(f => f.spot);
      const ext = barn.strike > spot ? Math.max(...look) : Math.min(...look);
      const tapped = Math.abs(ext - barn.strike) <= (I.sym === 'SPXW' ? 6 : 0.6);
      const retrace = barn.strike > spot ? spot < ext - (I.sym === 'SPXW' ? 1 : 0.1) : spot > ext + (I.sym === 'SPXW' ? 1 : 0.1);
      if (tapped && retrace) cands.push({ kind: 'BARNEY', dir: d, anchor: barn, target: +(spot + d * I.stop * 1.3).toFixed(2), strong: barn.g0 <= -I.strong * 2, vanna: barn.v0 < 0 });
    }
    let best = null;
    for (const c of cands) {
      if (BIAS !== 0 && c.dir !== BIAS) continue;                          // day-thesis lock: only trade in the day's bias direction
      const cr = [true, c.strong, c.vanna, migDir === c.dir && migDir !== 0, pc != null && (c.dir > 0 ? spot < pc : spot > pc)];   // 5 GEX-derivable criteria only (flow/dp not reconstructable historically)
      c.pass = cr.filter(Boolean).length; if (!best || c.pass > best.pass) best = c;
    }
    if (best && best.pass >= THRESH) { pos = { entryET: etOf(s.ts), dir: best.dir, entry: +spot.toFixed(1), target: best.target, stop: +(spot - best.dir * I.stop).toFixed(1), pass: best.pass, kind: best.kind }; cd = i + I.cool; }
  }
}
console.log(`\n═══ REPLAY BACKTEST ${DAY} · ${INSTR.filter(I => load(I.sym, DAY)).map(I => I.sym).join('+')} · STRUCTURE-ONLY (5 GEX criteria, no flow/dp) · fire ≥${THRESH}/5 ═══`);
for (const b of blot.sort((a, b) => a.entryET.localeCompare(b.entryET))) console.log(`  ${b.sym.padEnd(4)} ${b.entryET} ${b.dir > 0 ? 'LONG ' : 'SHORT'} @${b.entry} → ${b.exitET} @${b.exit}  ${b.pnl >= 0 ? '+' : ''}${b.pnl} (${b.why}) ${(b.kind || '').padEnd(6)} ${b.pass}/5`);
for (const I of INSTR) { const t = blot.filter(b => b.sym === I.sym); if (t.length) console.log(`  ${I.sym}: ${t.length} trades · ${t.filter(b => b.pnl > 0).length}W · ${t.reduce((a, c) => a + c.pnl, 0).toFixed(1)}pt`); }
console.log(`  TOTAL ${blot.length} trades · ${blot.filter(b => b.pnl > 0).length}/${blot.length} win`);
console.log(`\n─── FALCON's documented picks ${DAY} (ground truth) ───`);
for (const p of picks) console.log(`  ${p.et} ${p.dir} ${p.cp}${p.strike ?? ''} ${p.underlying || 'SPX'} [${p.kind}] ${p.signal || ''} ${p.thesis ? '· ' + p.thesis.slice(0, 90) : ''}`);
