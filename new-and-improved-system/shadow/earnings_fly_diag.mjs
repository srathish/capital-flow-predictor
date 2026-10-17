import fs from 'node:fs';
const C = new URL('../.cache/', import.meta.url);
const res = { mid: [], midCap: [], spreadShare: [], held: [] }, HOLD = '2025-04-01';
for (const f of fs.readdirSync(new URL('earnfly/', C))) for (const l of fs.readFileSync(new URL('earnfly/' + f, C), 'utf8').split('\n').filter(Boolean)) {
  const o = JSON.parse(l); if (o.skip) continue; const q = (r, d) => r?.find((x) => x.date === d), mid = (x) => (x.bid + x.ask) / 2;
  const legs = [[o.bc, o.body, 'C', -1], [o.bp, o.body, 'P', -1], [o.lc, o.wc, 'C', 1], [o.lp, o.wp, 'P', 1]];
  const e0 = legs.map(([r]) => q(r, o.E)); if (e0.some((x) => !x || !(x.ask > 0))) continue;
  const cMid = e0[0] && (mid(e0[0]) + mid(e0[1]) - mid(e0[2]) - mid(e0[3])), cBA = e0[0].bid + e0[1].bid - e0[2].ask - e0[3].ask;
  const intr = (K, cp) => Math.max(0, cp === 'C' ? o.Sx - K : K - o.Sx);
  const xMid = legs.map(([r, K, cp]) => { const x = q(r, o.X); return o.exp === o.X || !x || !(x.ask > 0) ? intr(K, cp) : mid(x); });
  const width = Math.max(o.wc - o.body, o.body - o.wp), costMid = Math.min(width, Math.max(0, xMid[0] + xMid[1] - xMid[2] - xMid[3]));
  const intrinsicPay = Math.min(width, Math.abs(o.Sx - o.body)); // value if it expired at the X close
  if (!(cMid > 0) || !(width - cMid > 0)) continue;
  const ho = o.E >= HOLD;
  res.mid.push({ ho, r: (cMid - costMid) / (width - cMid) });
  res.held.push({ ho, r: (cMid - intrinsicPay) / (width - cMid), beat: Math.abs(o.Sx / o.S - 1) > o.imp });
  res.spreadShare.push({ ho, s: (cMid - cBA) / cMid });
}
const m = (a) => a.reduce((s, x) => s + x, 0) / a.length;
for (const ho of [false, true]) { const p = ho ? 'holdout' : 'build';
  console.log(p, '| at MID prices, exit at X mid:', (m(res.mid.filter((x) => x.ho === ho).map((x) => x.r)) * 100).toFixed(1) + '%', '| at mid, valued at X intrinsic:', (m(res.held.filter((x) => x.ho === ho).map((x) => x.r)) * 100).toFixed(1) + '%',
    '| moves beating the implied move:', (res.held.filter((x) => x.ho === ho && x.beat).length / res.held.filter((x) => x.ho === ho).length * 100).toFixed(0) + '%', '| entry spread cost as % of mid credit:', (m(res.spreadShare.filter((x) => x.ho === ho).map((x) => x.s)) * 100).toFixed(0) + '%', '| n', res.mid.filter((x) => x.ho === ho).length); }
