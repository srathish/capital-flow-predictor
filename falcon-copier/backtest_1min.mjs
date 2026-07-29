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

const INSTR = [{ sym: 'SPXW', strong: 15e6, range: 20, gap: 5, stop: 8, cool: 10 }, { sym: 'SPY', strong: 15e6, range: 3, gap: 0.5, stop: 0.8, cool: 10 }, { sym: 'QQQ', strong: 5e6, range: 3, gap: 0.5, stop: 0.8, cool: 10 }];
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
    const pin = s.strikes.filter(n => n.g0 >= I.strong && Math.abs(n.k - spot) >= I.gap && Math.abs(n.k - spot) <= I.range).sort((a, b) => Math.abs(a.k - spot) - Math.abs(b.k - spot))[0];
    if (!pin) continue; const dir = sign(pin.k - spot);
    const fl = sign(fmap[Math.floor((etMin(s.ts) + 240) / 15) * 15] || 0);   // UTC-bucketed flow lean
    const cr = [true, pin.g0 >= I.strong * 1.3, pin.v0 > 0, migDir === dir && migDir !== 0, fl === dir && fl !== 0, dir > 0 ? spot < s.prevClose : spot > s.prevClose];
    const pass = cr.filter(Boolean).length;
    if (pass >= THRESH) { pos = { entryET: etOf(s.ts), dir, entry: +spot.toFixed(1), target: pin.k, stop: +(spot - dir * I.stop).toFixed(1), pass }; cd = i; }
  }
}
console.log(`\n═══ 1-MIN BACKTEST ${DAY} · SPX+SPY+QQQ · all layers · confluence ≥${THRESH}/6 ═══`);
for (const b of blot) console.log(`  ${b.sym.padEnd(4)} ${b.entryET} ${b.dir > 0 ? 'LONG ' : 'SHORT'} @${b.entry} → ${b.exitET} @${b.exit}  ${b.pnl >= 0 ? '+' : ''}${b.pnl} (${b.why}) ${b.pass}/6`);
for (const I of INSTR) { const t = blot.filter(b => b.sym === I.sym); if (t.length) console.log(`  ${I.sym}: ${t.length} trades · ${t.filter(b => b.pnl > 0).length}W · ${t.reduce((a, c) => a + c.pnl, 0).toFixed(1)}pt`); }
console.log(`  TOTAL ${blot.length} trades · ${blot.filter(b => b.pnl > 0).length}/${blot.length} win`);
