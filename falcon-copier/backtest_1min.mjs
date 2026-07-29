// MINUTE-GRANULARITY BACKTEST — the multi-instrument, all-layers system on today, evaluated EVERY MINUTE
// (from the cached 1-min GEX). Fused confluence per minute; fire ≥THRESH; one position/instrument; manage
// forward on the 1-min spot path (target=pin / stop / EOD) + cooldown. Usage: node backtest_1min.mjs [THRESH]
import '../apps/gex/scripts/_env-bootstrap.js';
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
const DIR = path.join(process.cwd(), 'falcon-copier'), DAY = '2026-07-29';
const THRESH = Number(process.argv[2] || 5);
const sign = (x) => x > 0 ? 1 : x < 0 ? -1 : 0;
const load = (sym) => { const f = path.join(DIR, `today_${sym}.jsonl.gz`); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString().trim().split('\n').map(l => JSON.parse(l)) : null; };
const etOf = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const etMin = (ts) => (+ts.slice(11, 13) - 4) * 60 + +ts.slice(14, 16);
async function flowMap(sym) {
  const r = await fetch(`https://api.unusualwhales.com/api/option-trades?ticker_symbol=${sym}&min_premium=25000&limit=1000&newer_than=${DAY}T13:30:00Z`, { headers: { Authorization: `Bearer ${KEY}` } }).then(x => x.ok ? x.json() : null).catch(() => null);
  const m = {}; for (const x of (r?.data || r?.result || [])) { const tg = x.tags || []; if (!tg.includes('ask_side')) continue; const d = new Date(x.executed_at); const b = Math.floor((d.getUTCHours() * 60 + d.getUTCMinutes()) / 15) * 15; (m[b] ||= 0); m[b] += tg.includes('bullish') ? +x.premium : tg.includes('bearish') ? -x.premium : 0; } return m;
}
const dpR = await fetch(`https://api.unusualwhales.com/api/stock/SPY/stock-volume-price-levels`, { headers: { Authorization: `Bearer ${KEY}` } }).then(x => x.ok ? x.json() : null).catch(() => null);
let dp = null; if (dpR) { const b = {}; for (const x of (dpR.data || [])) { const o = +x.off_vol || 0; if (o > 0) b[Math.round(+x.price)] = (b[Math.round(+x.price)] || 0) + o; } const a = Object.entries(b).map(([p, v]) => ({ p: +p, v })).sort((x, y) => y.v - x.v).slice(0, 4); if (a.length) dp = { poc: a[0].p, vah: Math.max(...a.map(x => x.p)), val: Math.min(...a.map(x => x.p)) }; }

const INSTR = [{ sym: 'SPXW', strong: 15e6, range: 20, gap: 5, stop: 8, cool: 10, dpMul: 10.05 }, { sym: 'SPY', strong: 15e6, range: 3, gap: 0.5, stop: 0.8, cool: 10, dpMul: 1 }, { sym: 'QQQ', strong: 5e6, range: 3, gap: 0.5, stop: 0.8, cool: 10, dpMul: 0 }];
const kingOf = (fr) => fr.strikes.filter(n => n.g0 > 0).sort((a, b) => b.g0 - a.g0)[0];
const blot = [];
for (const I of INSTR) {
  const F = load(I.sym); if (!F) { console.log(`${I.sym}: no cache yet`); continue; }
  const fmap = await flowMap(I.sym === 'SPXW' ? 'SPXW' : I.sym);
  let pos = null, cd = -99;
  for (let i = 15; i < F.length; i++) {
    const s = F[i], spot = s.spot, m = etMin(s.ts); if (m > 15 * 60 + 45) break;
    if (pos) { const tgt = pos.dir > 0 ? spot >= pos.target : spot <= pos.target, stp = pos.dir > 0 ? spot <= pos.stop : spot >= pos.stop, eod = m >= 15 * 60 + 55;
      if (tgt || stp || eod) { blot.push({ sym: I.sym, ...pos, exitET: etOf(s.ts), exit: +spot.toFixed(1), pnl: +((spot - pos.entry) * pos.dir).toFixed(1), why: tgt ? 'tgt' : stp ? 'stop' : 'eod' }); pos = null; } continue; }
    if (i < cd) continue;
    const king = kingOf(s); if (!king) continue; const kingPrev = kingOf(F[i - 15]);
    const migDir = kingPrev && Math.abs(king.k - kingPrev.k) >= I.gap ? sign(king.k - kingPrev.k) : 0;
    const fl = sign(fmap[Math.floor((etMin(s.ts) + 240) / 15) * 15] || 0);   // UTC-bucketed flow lean
    const vah = dp && I.dpMul ? dp.vah * I.dpMul : null, val = dp && I.dpMul ? dp.val * I.dpMul : null;
    const cands = [];
    // A) fade toward nearest strong PIKA (extension → mean-revert to the wall)
    const pin = s.strikes.filter(n => n.g0 >= I.strong && Math.abs(n.k - spot) >= I.gap && Math.abs(n.k - spot) <= I.range).sort((a, b) => Math.abs(a.k - spot) - Math.abs(b.k - spot))[0];
    if (pin) cands.push({ kind: 'PIKA', dir: sign(pin.k - spot), anchor: pin, target: pin.k, strong: pin.g0 >= I.strong * 1.3, vanna: pin.v0 > 0 });
    // B) REJECT off a big BARNEY price is AT (node-sign reversal — the 14:54 −40M @7450 top-tick Falcon caught)
    const barn = s.strikes.filter(n => n.g0 <= -I.strong && Math.abs(n.k - spot) >= I.gap && Math.abs(n.k - spot) <= I.range * 0.5).sort((a, b) => Math.abs(a.k - spot) - Math.abs(b.k - spot))[0];
    if (barn) {                                                            // FAILED-REACH confirmation: price TAPPED the barney + is RETRACING (Falcon waited for 14:54 tap-reject, didn't short the approach)
      const d = -sign(barn.k - spot), look = F.slice(Math.max(0, i - 5), i + 1).map(f => f.spot);
      const ext = barn.k > spot ? Math.max(...look) : Math.min(...look);   // extreme toward the barney over last ~5min
      const tapped = Math.abs(ext - barn.k) <= (I.sym === 'SPXW' ? 6 : 0.6);
      const retrace = barn.k > spot ? spot < ext - (I.sym === 'SPXW' ? 1 : 0.1) : spot > ext + (I.sym === 'SPXW' ? 1 : 0.1);
      if (tapped && retrace) cands.push({ kind: 'BARNEY', dir: d, anchor: barn, target: +(spot + d * I.stop * 1.3).toFixed(2), strong: barn.g0 <= -I.strong * 2, vanna: barn.v0 < 0 });
    }
    let best = null;
    for (const c of cands) {
      const cr = [true, c.strong, c.vanna, migDir === c.dir && migDir !== 0, fl === c.dir && fl !== 0, c.dir > 0 ? spot < s.prevClose : spot > s.prevClose, vah != null && (c.dir < 0 ? spot > vah : spot < val)];
      c.pass = cr.filter(Boolean).length; if (!best || c.pass > best.pass) best = c;
    }
    if (best && best.pass >= THRESH) { pos = { entryET: etOf(s.ts), dir: best.dir, entry: +spot.toFixed(1), target: best.target, stop: +(spot - best.dir * I.stop).toFixed(1), pass: best.pass, kind: best.kind }; cd = i; }
  }
}
console.log(`\n═══ 1-MIN BACKTEST ${DAY} · SPX+SPY+QQQ · all layers · confluence ≥${THRESH}/6 ═══`);
for (const b of blot) console.log(`  ${b.sym.padEnd(4)} ${b.entryET} ${b.dir > 0 ? 'LONG ' : 'SHORT'} @${b.entry} → ${b.exitET} @${b.exit}  ${b.pnl >= 0 ? '+' : ''}${b.pnl} (${b.why}) ${(b.kind || '').padEnd(6)} ${b.pass}/7`);
for (const I of INSTR) { const t = blot.filter(b => b.sym === I.sym); if (t.length) console.log(`  ${I.sym}: ${t.length} trades · ${t.filter(b => b.pnl > 0).length}W · ${t.reduce((a, c) => a + c.pnl, 0).toFixed(1)}pt`); }
console.log(`  TOTAL ${blot.length} trades · ${blot.filter(b => b.pnl > 0).length}/${blot.length} win`);
