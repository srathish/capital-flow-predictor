// FULL-PICTURE FEATURE MATRIX — combine EVERYTHING per minute-state, emit CSV for the integrated model.
// Structure (sizes/signs/distances) + DYNAMICS (gamma velocity, vanna, vanna velocity, growth) +
// shape (concentration, gamma-flip, mass-below) + context (trinity tape, VIX level+velocity+compression,
// SPX volume) + time. Targets: forward directional bracket (+T before -T), max excursions, reach-king.
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const DIR = path.join(process.cwd(), 'research', 'velocity-capture');
const OUT = path.join(process.cwd(), 'research', 'doctrine', 'features.csv');
const etOf = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const etMin = (et) => +et.slice(0, 2) * 60 + +et.slice(3);
const etMinus = (et, n) => { const m = etMin(et) - n; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const load = (d) => { const f = path.join(DIR, `replay_${d}_SPXW.jsonl.gz`); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => JSON.parse(l)) : null; };
const aux = (d) => { const f = path.join(DIR, `aux_${d}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { spy: [], qqq: [], vixy: [] }; };
const sign = (x) => x > 0 ? 1 : x < 0 ? -1 : 0;
const LB = 15, T = 4, RANGE = 40, NEAR = 15;
const days = fs.readdirSync(DIR).filter(f => /^replay_.*_SPXW\.jsonl\.gz$/.test(f)).map(f => f.slice(7, 17)).sort();

const gAt = (fx, k) => { const n = fx.strikes.find(s => s.strike === k); return n ? n.g0 : 0; };
const vAt = (fx, k) => { const n = fx.strikes.find(s => s.strike === k); return n ? n.v0 : 0; };
const pikaBest = (fx, s, lo, hi) => fx.strikes.filter(n => n.g0 >= 12e6 && n.strike > s + lo && n.strike <= s + hi).sort((a, b) => b.g0 - a.g0)[0];
const barneyBest = (fx, s, lo, hi) => fx.strikes.filter(n => n.g0 <= -8e6 && n.strike > s + lo && n.strike <= s + hi).sort((a, b) => a.g0 - b.g0)[0];
const netGnear = (fx, s) => fx.strikes.filter(n => Math.abs(n.strike - s) <= NEAR).reduce((t, n) => t + n.g0, 0);
const netVnear = (fx, s) => fx.strikes.filter(n => Math.abs(n.strike - s) <= NEAR).reduce((t, n) => t + n.v0, 0);
const sumAbsG = (fx) => fx.strikes.reduce((t, n) => t + Math.abs(n.g0), 0);
const massBelow = (fx, s) => { const b = fx.strikes.filter(n => n.strike < s).reduce((t, n) => t + n.g0, 0), a = fx.strikes.filter(n => n.strike > s).reduce((t, n) => t + n.g0, 0); const tot = Math.abs(b) + Math.abs(a); return tot ? (b - a) / tot : 0; };
// gamma-flip proxy: balance strike where cumulative g0 from below ~= cumulative from above
function flipDist(fx, s) { const ss = [...fx.strikes].sort((a, b) => a.strike - b.strike); let best = null, bd = 1e18; for (const k of ss) { const below = ss.filter(n => n.strike <= k.strike).reduce((t, n) => t + n.g0, 0); const above = ss.filter(n => n.strike > k.strike).reduce((t, n) => t + n.g0, 0); const d = Math.abs(below - above); if (d < bd) { bd = d; best = k.strike; } } return best == null ? 0 : best - s; }
// aggregate (all-expiry / SWING) structure — a whole dimension we were ignoring
const aggNetGnear = (fx, s) => fx.strikes.filter(n => Math.abs(n.strike - s) <= NEAR).reduce((t, n) => t + (n.gAgg || 0), 0);
const aggNetVnear = (fx, s) => fx.strikes.filter(n => Math.abs(n.strike - s) <= NEAR).reduce((t, n) => t + (n.vAgg || 0), 0);
const aggKingOf = (fx, s) => fx.strikes.filter(n => (n.gAgg || 0) > 0 && Math.abs(n.strike - s) <= RANGE).sort((a, b) => (b.gAgg || 0) - (a.gAgg || 0))[0];
const sumAbsAgg = (fx) => fx.strikes.reduce((t, n) => t + Math.abs(n.gAgg || 0), 0);
const sumSide = (fx, s, above, key) => fx.strikes.filter(n => above ? n.strike > s : n.strike < s).reduce((t, n) => t + (n[key] || 0), 0);
// AGGREGATE VEX (all-expiry vanna) — "GEX governs range, VEX governs drift"; the drift force 0DTE v0 misses
const vexNet = (fx) => fx.strikes.reduce((t, n) => t + (n.vAgg || 0), 0);
const vexSide = (fx, s, above) => fx.strikes.filter(n => above ? n.strike > s : n.strike < s).reduce((t, n) => t + (n.vAgg || 0), 0);
function flipDistAgg(fx, s) { const ss = [...fx.strikes].sort((a, b) => a.strike - b.strike); let best = null, bd = 1e18; for (const k of ss) { const below = ss.filter(n => n.strike <= k.strike).reduce((t, n) => t + (n.gAgg || 0), 0); const above = ss.filter(n => n.strike > k.strike).reduce((t, n) => t + (n.gAgg || 0), 0); const d = Math.abs(below - above); if (d < bd) { bd = d; best = k.strike; } } return best == null ? 0 : best - s; }

const cols = ['day', 'et', 'minsOpen', 'minsClose',
  'spot', 'spotVel5', 'spotVel15',
  'd_king', 'king_g', 'king_v', 'king_gVel', 'king_vVel',
  'd_callwall', 'callwall_g', 'd_putwall', 'putwall_g',
  'd_barneyBelow', 'barneyBelow_g', 'd_barneyAbove', 'barneyAbove_g',
  'd_nearest', 'nearest_g', 'nearest_v', 'nearest_sign', 'nearest_gVel', 'nearest_vVel',
  'concentration', 'netG_near', 'netG_vel', 'netV_near', 'netV_vel', 'massBelow', 'd_flip',
  'aggKing_d', 'aggNetG_near', 'aggNetV_near', 'aggNetG_vel', 'gAbove', 'gBelow', 'vSkew', 'flipSide', 'pinPressure', 'nStrong', 'aggConc',
  'vex_net', 'vex_below', 'vex_above', 'vex_net_vel', 'vex_x_dvix', 'aggFlip_d', 'aggFlipSide', 'crossKingAgree', 'crossFlipAgree', 'charm',
  'tape', 'trinity_sum', 'trinity_aligned',
  'vix', 'vix_vel', 'vix_pct', 'spx_vol_z',
  'tide_np', 'tide_nv', 'tide_np_vel', 'tide_nv_vel', 'tide_dir',
  // targets
  'y_dir', 'y_maxUp', 'y_maxDn', 'y_reachKing', 'y_reachUp', 'y_reachDn', 'y_pin'];
const rows = [cols.join(',')];

for (const d of days) {
  const fr = load(d), a = aux(d); if (!fr || !a.spy?.length) continue;
  const spyC = Object.fromEntries(a.spy.map(p => [p.et, p.c])), spyV = Object.fromEntries(a.spy.map(p => [p.et, p.v || 0]));
  const qqqC = Object.fromEntries((a.qqq || []).map(p => [p.et, p.c])), vixC = Object.fromEntries((a.vixy || []).map(p => [p.et, p.c]));
  const spxC = Object.fromEntries(fr.map(x => [etOf(x.ts), x.spot]));
  const spyOpen = a.spy[0].c, spots = fr.map(x => x.spot);
  const vols = a.spy.map(p => p.v || 0).filter(v => v > 0).sort((x, y) => x - y); const volMed = vols.length ? vols[Math.floor(vols.length / 2)] : 1;
  const vixVals = (a.vixy || []).map(p => p.c).filter(Number.isFinite); const vMin = Math.min(...vixVals), vMax = Math.max(...vixVals);
  const kingDay = (() => { const c = {}; for (const f of fr) { const k = f.strikes.filter(n => n.g0 > 0).sort((x, y) => y.g0 - x.g0)[0]; if (k) c[k.strike] = (c[k.strike] || 0) + 1; } return +Object.entries(c).sort((x, y) => y[1] - x[1])[0][0]; })();

  for (let i = LB; i < fr.length; i++) {
    const fx = fr[i], et = etOf(fx.ts), m = etMin(et); if (m > 15 * 60 + 30 || m < 9 * 60 + 45) continue;
    const prev = fr[i - LB], spot = spots[i], p15 = etMinus(et, LB);
    const king = pikaBest(fx, spot, -RANGE, RANGE) || fx.strikes.filter(n => n.g0 > 0).sort((x, y) => y.g0 - x.g0)[0];
    if (!king) continue;
    const cw = pikaBest(fx, spot, 0, RANGE), pw = pikaBest(fx, spot, -RANGE, 0);
    const bb = barneyBest(fx, spot, -RANGE, -1), ba = barneyBest(fx, spot, 1, RANGE);
    const nearest = fx.strikes.filter(n => Math.abs(n.g0) >= 8e6 && Math.abs(n.strike - spot) <= 15).sort((x, y) => Math.abs(x.strike - spot) - Math.abs(y.strike - spot))[0] || king;
    // context
    const tape = sign((spyC[et] ?? spyOpen) - spyOpen);
    const mom = (C) => (C[et] != null && C[p15] != null) ? sign(C[et] - C[p15]) : 0;
    const tsum = mom(spxC) + mom(spyC) + mom(qqqC), aligned = Math.abs(tsum) === 3 ? 1 : 0;
    const vix = vixC[et] ?? 0, vixVel = (vixC[et] != null && vixC[p15] != null) ? vixC[et] - vixC[p15] : 0;
    const vixPct = (vMax > vMin && vixC[et] != null) ? (vixC[et] - vMin) / (vMax - vMin) : 0.5;
    const volZ = (spyV[et] || 0) / (volMed || 1);
    // MARKET TIDE flow (net premium & volume + velocities = the leading positioning signal GEX can't see)
    const tideAt = (arr, e) => { let v = null; for (const p of arr || []) { if (p.et <= e) v = p; else break; } return v; };
    const t0 = tideAt(a.tide, et), t15v = tideAt(a.tide, p15);
    const np0 = t0 ? (t0.ncp - t0.npp) : 0, np15 = t15v ? (t15v.ncp - t15v.npp) : 0;
    const tideNp = np0 / 1e6, tideNv = t0 ? t0.nv / 1000 : 0, tideNpVel = (np0 - np15) / 1e6, tideNvVel = (t0 && t15v) ? (t0.nv - t15v.nv) / 1000 : 0, tideDir = sign(np0);
    // targets: forward bracket ±T, max excursion, reach king
    let ydir = 0, up = 0, dn = 0, reachK = 0, reachUp = 0, reachDn = 0, pinMove = 0;
    const cwK = cw ? cw.strike : null, pwK = pw ? pw.strike : null;
    for (let j = i + 1; j < spots.length; j++) { const dv = spots[j] - spot; up = Math.max(up, dv); dn = Math.max(dn, -dv); if (ydir === 0) { if (dv >= T) ydir = 1; else if (dv <= -T) ydir = -1; } if (Math.abs(spots[j] - kingDay) <= 2) reachK = 1; if (cwK && Math.abs(spots[j] - cwK) <= 2) reachUp = 1; if (pwK && Math.abs(spots[j] - pwK) <= 2) reachDn = 1; if (j <= i + 20) pinMove = Math.max(pinMove, Math.abs(dv)); }
    const yPin = pinMove < T ? 1 : 0;
    const r = [d, et, m - 9 * 60 - 30, 16 * 60 - m,
      spot.toFixed(1), (spot - spots[i - 5]).toFixed(1), (spot - spots[i - LB]).toFixed(1),
      (king.strike - spot).toFixed(0), (king.g0 / 1e6).toFixed(1), (king.v0 / 1e6).toFixed(2), ((king.g0 - gAt(prev, king.strike)) / 1e6).toFixed(1), ((king.v0 - vAt(prev, king.strike)) / 1e6).toFixed(2),
      cw ? (cw.strike - spot).toFixed(0) : 99, cw ? (cw.g0 / 1e6).toFixed(1) : 0, pw ? (pw.strike - spot).toFixed(0) : -99, pw ? (pw.g0 / 1e6).toFixed(1) : 0,
      bb ? (bb.strike - spot).toFixed(0) : -99, bb ? (bb.g0 / 1e6).toFixed(1) : 0, ba ? (ba.strike - spot).toFixed(0) : 99, ba ? (ba.g0 / 1e6).toFixed(1) : 0,
      (nearest.strike - spot).toFixed(0), (nearest.g0 / 1e6).toFixed(1), (nearest.v0 / 1e6).toFixed(2), sign(nearest.g0), ((nearest.g0 - gAt(prev, nearest.strike)) / 1e6).toFixed(1), ((nearest.v0 - vAt(prev, nearest.strike)) / 1e6).toFixed(2),
      (king.g0 / (sumAbsG(fx) || 1)).toFixed(3), (netGnear(fx, spot) / 1e6).toFixed(1), ((netGnear(fx, spot) - netGnear(prev, spots[i - LB])) / 1e6).toFixed(1), (netVnear(fx, spot) / 1e6).toFixed(1), ((netVnear(fx, spot) - netVnear(prev, spots[i - LB])) / 1e6).toFixed(1), massBelow(fx, spot).toFixed(2), flipDist(fx, spot).toFixed(0),
      (() => { const ak = aggKingOf(fx, spot); return ak ? (ak.strike - spot).toFixed(0) : 99; })(), (aggNetGnear(fx, spot) / 1e6).toFixed(1), (aggNetVnear(fx, spot) / 1e6).toFixed(1), ((aggNetGnear(fx, spot) - aggNetGnear(prev, spots[i - LB])) / 1e6).toFixed(1), (sumSide(fx, spot, true, 'g0') / 1e6).toFixed(1), (sumSide(fx, spot, false, 'g0') / 1e6).toFixed(1), ((sumSide(fx, spot, true, 'v0') - sumSide(fx, spot, false, 'v0')) / 1e6).toFixed(1), sign(flipDist(fx, spot)), ((netGnear(fx, spot) / 1e6) / Math.max(16 * 60 - m, 10) * 100).toFixed(2), fx.strikes.filter(n => Math.abs(n.g0) >= 12e6 && Math.abs(n.strike - spot) <= RANGE).length, (() => { const ak = aggKingOf(fx, spot); return ak ? ((ak.gAgg || 0) / (sumAbsAgg(fx) || 1)).toFixed(3) : 0; })(),
      (vexNet(fx) / 1e6).toFixed(1), (vexSide(fx, spot, false) / 1e6).toFixed(1), (vexSide(fx, spot, true) / 1e6).toFixed(1), ((vexNet(fx) - vexNet(prev)) / 1e6).toFixed(1), ((vexNet(fx) / 1e6) * vixVel).toFixed(1), flipDistAgg(fx, spot).toFixed(0), sign(flipDistAgg(fx, spot)), (() => { const ak = aggKingOf(fx, spot); const a = ak ? sign(spot - ak.strike) : 0; const k0 = sign(spot - king.strike); return (k0 !== 0 && k0 === a) ? 1 : 0; })(), (sign(flipDist(fx, spot)) === sign(flipDistAgg(fx, spot)) ? 1 : 0), ((m - 9 * 60 - 30) / 390 * (king.g0 / (sumAbsG(fx) || 1)) * sign(king.strike - spot)).toFixed(3),
      tape, tsum, aligned,
      vix.toFixed(2), vixVel.toFixed(2), vixPct.toFixed(2), volZ.toFixed(2),
      tideNp.toFixed(1), tideNv.toFixed(0), tideNpVel.toFixed(1), tideNvVel.toFixed(0), tideDir,
      ydir, up.toFixed(1), dn.toFixed(1), reachK, reachUp, reachDn, yPin];
    rows.push(r.join(','));
  }
}
fs.writeFileSync(OUT, rows.join('\n') + '\n');
console.log(`wrote ${rows.length - 1} rows × ${cols.length} cols -> ${OUT}`);
console.log(`features: ${cols.slice(4, -4).length} · targets: y_dir(+T/-T bracket), y_maxUp, y_maxDn, y_reachKing`);
