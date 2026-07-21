// Doctrine day-analyzer: reconstruct price path + 0DTE node structure evolution
// from a replay_<DAY>_<TICKER>.jsonl.gz, and surface the signals the doctrine keys
// on (king/floor/ceiling, net gamma regime, node-flip, rolling, air pockets).
// Usage: node analyze_day.mjs 2026-07-21
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const DAY = process.argv[2] || '2026-07-21';
const DIR = path.join(process.cwd(), 'research', 'velocity-capture');
const load = (tk) => {
  const f = path.join(DIR, `replay_${DAY}_${tk}.jsonl.gz`);
  if (!fs.existsSync(f)) return [];
  return zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => JSON.parse(l));
};
const etOf = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const M = (x) => (x / 1e6);
function struct(frame) {
  const s = frame.spot, nodes = frame.strikes;
  const pika = nodes.filter(n => n.g0 > 0), barney = nodes.filter(n => n.g0 < 0);
  const strongest = (arr) => arr.slice().sort((a, b) => Math.abs(b.g0) - Math.abs(a.g0))[0] || null;
  const king = strongest(nodes);
  const floor = strongest(pika.filter(n => n.strike < s));
  const ceil = strongest(pika.filter(n => n.strike > s));
  const barnBelow = strongest(barney.filter(n => n.strike < s));
  const barnAbove = strongest(barney.filter(n => n.strike > s));
  const netG = nodes.reduce((a, b) => a + b.g0, 0);
  return { s, king, floor, ceil, barnBelow, barnAbove, netG };
}
const spxw = load('SPXW'), spy = load('SPY'), qqq = load('QQQ');
if (!spxw.length) { console.log('no SPXW data'); process.exit(1); }

// price path
const spots = spxw.map(f => ({ et: etOf(f.ts), s: f.spot }));
const open = spots[0].s, close = spots[spots.length - 1].s;
const hi = spots.reduce((a, b) => b.s > a.s ? b : a), lo = spots.reduce((a, b) => b.s < a.s ? b : a);
console.log(`=== SPXW 7/21 PRICE PATH ===`);
console.log(`open ${open.toFixed(0)}  high ${hi.s.toFixed(0)}@${hi.et}  low ${lo.s.toFixed(0)}@${lo.et}  close ${close.toFixed(0)}  net ${((close-open)/open*100).toFixed(2)}%`);

// structure timeline at 30-min marks
console.log(`\n=== SPXW 0DTE STRUCTURE (col0) — king/floor/ceiling/netGamma ===`);
console.log(`ET     spot    KING            FLOOR(pika<sp)   CEILING(pika>sp)  netG   barneyAbove(fuel↑) barneyBelow(fuel↓)`);
const marks = ['09:30','10:00','10:30','11:00','11:30','12:00','12:30','13:00','13:30','14:00','14:30','15:00','15:30','15:55'];
const nearest = (et) => spxw.reduce((best, f) => Math.abs((+etOf(f.ts).replace(':','')) - +et.replace(':','')) < Math.abs((+etOf(best.ts).replace(':','')) - +et.replace(':',''))?f:best);
const kingPos = [];
for (const et of marks) {
  const f = nearest(et); const x = struct(f);
  const kp = x.king ? (x.king.strike < x.s ? 'below' : x.king.strike > x.s ? 'above' : 'at') : '-';
  kingPos.push({ et, kingStrike: x.king?.strike, kp, floor: x.floor?.strike, ceil: x.ceil?.strike });
  const fmtN = (n) => n ? `${n.strike}(${M(n.g0).toFixed(0)}M)` : '—';
  console.log(`${et}  ${x.s.toFixed(0)}  ${fmtN(x.king).padEnd(14)} ${fmtN(x.floor).padEnd(15)} ${fmtN(x.ceil).padEnd(16)} ${M(x.netG).toFixed(0).padStart(5)}  ${fmtN(x.barnAbove).padEnd(16)} ${fmtN(x.barnBelow)}`);
}
// regime read
const posFrames = spxw.filter(f => struct(f).netG > 0).length;
console.log(`\n=== REGIME SIGNALS ===`);
console.log(`net gamma POSITIVE (pin-prone) on ${posFrames}/${spxw.length} frames = ${(posFrames/spxw.length*100).toFixed(0)}%`);
console.log(`king position over day: ${kingPos.map(k=>k.kp[0]).join('')}  (a=above spot, b=below, -=none)`);
// floor/ceiling migration (rolling)
const floors = kingPos.map(k=>k.floor).filter(Boolean), ceils = kingPos.map(k=>k.ceil).filter(Boolean);
console.log(`floor strikes over day: ${kingPos.map(k=>k.floor||'-').join(' → ')}`);
console.log(`ceiling strikes over day: ${kingPos.map(k=>k.ceil||'-').join(' → ')}`);

// trinity: SPY/QQQ net direction (close vs open) + net gamma
for (const [nm, d] of [['SPY', spy], ['QQQ', qqq]]) {
  if (!d.length) continue;
  const o = d[0].spot, c = d[d.length-1].spot;
  const pf = d.filter(f => struct(f).netG > 0).length;
  console.log(`TRINITY ${nm}: open ${o} → close ${c} (${((c-o)/o*100).toFixed(2)}%), net-gamma-positive ${(pf/d.length*100).toFixed(0)}%`);
}
