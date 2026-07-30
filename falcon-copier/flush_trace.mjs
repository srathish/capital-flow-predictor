// FLUSH TRACE — reconstruct the "Negative-Gamma King-Node Flush" (user's 7/29 playbook) from OUR captured Skylit
// data (today_SPXW.jsonl.gz), to prove the signals were in our data live: the overhead barney growing, the
// dominant-negative-node ROLL-DOWN (7450→7415), the negative-gamma regime (thin chain below), and the positive
// floor target (7300). Usage: node flush_trace.mjs
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const F = zlib.gunzipSync(fs.readFileSync(path.join(process.cwd(), 'falcon-copier/today_SPXW.jsonl.gz'))).toString().trim().split('\n').map(l => JSON.parse(l));
const et = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const etM = (ts) => (+ts.slice(11, 13) - 4) * 60 + +ts.slice(14, 16);
const M = (x) => (x >= 0 ? '+' : '') + (x / 1e6).toFixed(0) + 'M';
const g0At = (s, k) => (s.strikes.find(n => n.k === k)?.g0 || 0);

console.log(`\n═══ 7/29 NEG-GAMMA KING-NODE FLUSH — from our captured data ═══`);
console.log(`ET     spot    7450barn  domNeg(strike,g0)  rollDown?  regime(neg/pos ±40)  floor(+node below)`);
let prevDomNeg = null;
for (let i = 0; i < F.length; i++) {
  const s = F[i], spot = s.spot, m = etM(s.ts);
  if (m < 12 * 60 + 45 || m > 16 * 60) continue;          // focus on the 12:45→close window
  if (m % 15 !== 0 && !(prevDomNeg !== null)) continue;    // every 15 min
  // dominant negative node in the near-money band (±70pt) — the "King node" of the playbook
  const near = s.strikes.filter(n => Math.abs(n.k - spot) <= 70);
  const domNeg = near.filter(n => n.g0 < 0).sort((a, b) => a.g0 - b.g0)[0];
  // regime: neg vs pos strike count within ±40, and net g0
  const band = s.strikes.filter(n => Math.abs(n.k - spot) <= 40);
  const neg = band.filter(n => n.g0 < 0).length, pos = band.filter(n => n.g0 > 0).length;
  const net = band.reduce((a, c) => a + c.g0, 0);
  // nearest strong positive node BELOW spot (the flush target / floor)
  const floor = s.strikes.filter(n => n.g0 >= 20e6 && n.k < spot).sort((a, b) => b.k - a.k)[0];
  const roll = prevDomNeg != null && domNeg && domNeg.k < prevDomNeg ? `↓${prevDomNeg}→${domNeg.k}` : '—';
  if (m % 15 === 0 || roll !== '—') console.log(`${et(s.ts)}  ${spot.toFixed(0)}   ${M(g0At(s, 7450)).padStart(5)}    ${domNeg ? `${domNeg.k}(${M(domNeg.g0)})`.padEnd(15) : '—'.padEnd(15)}  ${roll.padEnd(11)}  ${neg}neg/${pos}pos net${M(net).padStart(5)}   ${floor ? `${floor.k}(${M(floor.g0)})` : '—'}`);
  if (domNeg) prevDomNeg = domNeg.k;
}
// price extremes
const win = F.filter(s => etM(s.ts) >= 12 * 60 + 45);
const hi = win.reduce((a, c) => c.spot > a.spot ? c : a), lo = win.reduce((a, c) => c.spot < a.spot ? c : a);
console.log(`\n  price: high ${hi.spot.toFixed(1)} @${et(hi.ts)} → low ${lo.spot.toFixed(1)} @${et(lo.ts)} = ${(lo.spot - hi.spot).toFixed(0)}pt flush`);
