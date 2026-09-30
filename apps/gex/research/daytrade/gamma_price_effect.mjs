// gamma_price_effect.mjs — did the OPTIONS structure move price? (dealer-gamma fingerprint)
// For each SPXW 0DTE day: open-snapshot nodes + 1-min SPX bars.
// (1) local realized range when price sits NEAR pika (long-gamma) vs barney (short-gamma) vs far.
// (2) pin: does close gravitate toward the king strike vs the open distance?
import '/Users/saiyeeshrathish/the final plan/apps/gex/scripts/_env-bootstrap.js';
const K = process.env.SKYLIT_API_KEY;
const H = { Authorization: `Bearer ${K}`, Accept: 'application/json' };
const get = (host, p) => fetch(`https://${host}.skylit.ai${p}`, { headers: H }).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dstr = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const uts = (d, hh, mm) => Math.floor(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), hh, mm) / 1000);
const BAND = 0.0005;   // "near a node" = within 0.05% of the strike (~3.8 SPX pts)
const FWD = 3;         // forward minutes for the directional-move measure

const NOW = Math.floor(Date.now() / 1000);
const dj = await get('atlas-api', `/v1/history?symbol=SPX&resolution=D&from=${NOW - 200 * 86400}&to=${NOW}`);
const days = dj.t.map((t) => dstr(t)).slice(-124);

const buck = { pika: [], barney: [], king: [], far: [] };       // local bar range (bps)
const fwdB = { pika: [], barney: [], king: [], far: [] };       // |forward 3-min move| (bps)
const pin = [];                                                 // {openDist, closeDist} vs king (bps)
let used = 0;
for (const d of days) {
  const bq = await get('api', `/v1/historical?symbols=SPXW&at=${d}T13:35:00Z&metric=gamma&maxStrikes=all&expirations=${d}`);
  await sleep(550);
  const s = bq?.data?.symbols?.[0]; if (!s?.strikes?.length) { process.stdout.write('x'); continue; }
  const spot = s.spot;
  const pikas = s.strikes.filter((x) => x.nodeType === 'pika').map((x) => x.strike);
  const barns = s.strikes.filter((x) => x.nodeType === 'barney').map((x) => x.strike);
  const king = s.strikes.find((x) => x.nodeType === 'king')?.strike;
  const allNodes = s.strikes.filter((x) => ['king', 'gatekeeper', 'pika', 'barney', 'significant'].includes(x.nodeType)).map((x) => x.strike);
  const bq2 = await get('atlas-api', `/v1/history?symbol=SPX&resolution=1&from=${uts(d, 13, 30)}&to=${uts(d, 20, 0)}`);
  const b = bq2; if (b?.s !== 'ok' || !b.t?.length) { process.stdout.write('b'); continue; }
  const bars = b.t.map((t, i) => ({ c: b.c[i], h: b.h[i], l: b.l[i] }));
  const nearAny = (px, arr) => arr.some((k) => Math.abs(px - k) / px <= BAND);
  for (let i = 0; i < bars.length; i++) {
    const px = bars[i].c, rng = (bars[i].h - bars[i].l) / px * 1e4;
    const fwd = i + FWD < bars.length ? Math.abs(bars[i + FWD].c - px) / px * 1e4 : null;
    let tag = 'far';
    if (nearAny(px, pikas)) tag = 'pika';
    else if (nearAny(px, barns)) tag = 'barney';
    else if (king && Math.abs(px - king) / px <= BAND) tag = 'king';
    else if (nearAny(px, allNodes)) tag = null; // near a significant/gatekeeper but not pika/barney/king — skip (ambiguous)
    if (tag === null) continue;
    buck[tag].push(rng); if (fwd != null) fwdB[tag].push(fwd);
  }
  if (king) { const openPx = bars[0].c, closePx = bars[bars.length - 1].c; pin.push({ od: Math.abs(openPx - king) / openPx * 1e4, cd: Math.abs(closePx - king) / closePx * 1e4 }); }
  used++; process.stdout.write('.');
}

const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const med = (a) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
console.log(`\n\n===== DID OPTIONS STRUCTURE MOVE PRICE? — SPXW 0DTE, ${used} days =====`);
console.log('\n(1) LOCAL 1-min RANGE while price sits AT a node (bps of spot) — dealer-gamma fingerprint');
console.log('   long-gamma (pika) should DAMPEN; short-gamma (barney) should AMPLIFY vs far-from-node\n');
for (const t of ['pika', 'king', 'far', 'barney']) console.log(`   ${t.padEnd(7)} mean ${mean(buck[t]).toFixed(2)}  median ${med(buck[t]).toFixed(2)}  (n=${buck[t].length})`);
console.log('\n(2) |forward 3-min move| at a node (bps) — amplification of directional travel\n');
for (const t of ['pika', 'king', 'far', 'barney']) console.log(`   ${t.padEnd(7)} mean ${mean(fwdB[t]).toFixed(2)}  median ${med(fwdB[t]).toFixed(2)}  (n=${fwdB[t].length})`);
const od = mean(pin.map((x) => x.od)), cd = mean(pin.map((x) => x.cd));
console.log(`\n(3) PIN toward KING: mean |open−king| ${od.toFixed(0)}bps  ->  |close−king| ${cd.toFixed(0)}bps  (${cd < od ? 'PULLED IN ' + ((1 - cd / od) * 100).toFixed(0) + '%' : 'pushed away'}, n=${pin.length} days)`);
const acc = await get('api', '/v1/account'); console.log('\ncredits left:', acc?.data?.creditsBalance ?? (await get('api','/v1/account'))?.data?.creditsBalance);
