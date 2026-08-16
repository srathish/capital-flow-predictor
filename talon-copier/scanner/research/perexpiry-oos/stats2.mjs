#!/usr/bin/env node
// Stress-test the "reachable wall" signal + kill/keep it. Robustness: finer bins, medians,
// entered-only, correlation, per-week consistency. Guard: is it just proxy for liquid names?
import { resolveFromRoot, readJson, log } from '../../lib/util.mjs';
const D = readJson(resolveFromRoot('research/perexpiry-oos/dataset.json'));
const rows = D.rows;
const WEEKS = ['2026-07-13', '2026-07-20', '2026-07-27', '2026-08-03'];
const R = (x) => x.R_stop ?? 0;
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const hit = (a) => a.length ? a.filter((x) => x > 0).length / a.length : 0;
const fmt = (x) => (x >= 0 ? '+' : '') + x.toFixed(2);
const pearson = (xs, ys) => { const n = xs.length; if (n < 3) return 0; const mx = mean(xs), my = mean(ys); let num = 0, dx = 0, dy = 0; for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; } return dx && dy ? num / Math.sqrt(dx * dy) : 0; };
const perWeek = (rs) => WEEKS.map((w) => { const s = rs.filter((r) => r.week === w).map(R); return s.length ? mean(s) : null; });
function rep(name, rs) { const rr = rs.map(R); const pw = perWeek(rs).map((x) => x == null ? '  —  ' : fmt(x)).join(' '); const pos = perWeek(rs).filter((x) => x != null && x > 0).length; const nn = perWeek(rs).filter((x) => x != null).length; log(`${name.padEnd(30)} n=${String(rs.length).padStart(2)}  mean ${fmt(mean(rr)).padStart(6)}  med ${fmt(median(rr)).padStart(6)}  hit ${(hit(rr) * 100).toFixed(0).padStart(3)}%  wk+ ${pos}/${nn}  [${pw}]`); }

log(`\n════ STRESS TEST — reachable-wall signal (n=${rows.length}) ════`);
log('(wk+ = # of weeks with positive mean; [..] = per-week means 07/13 07/20 07/27 08/03)\n');

// correlations (continuous)
const withRoom = rows.filter((r) => r.t1RoomPct != null);
log(`corr(room%, R)         = ${pearson(withRoom.map((r) => r.t1RoomPct), withRoom.map(R)).toFixed(3)}  (n=${withRoom.length})  [expect NEGATIVE if near-wall better]`);
const withMag = rows.filter((r) => r.vannaMagnetM > 0);
log(`corr(log magnetM, R)   = ${pearson(withMag.map((r) => Math.log(r.vannaMagnetM)), withMag.map(R)).toFixed(3)}  (n=${withMag.length})  [expect ~0 if size is noise]`);
log(`corr(runnerPct, R)     = ${pearson(rows.filter(r=>r.runnerPct!=null).map((r) => r.runnerPct), rows.filter(r=>r.runnerPct!=null).map(R)).toFixed(3)}  [dist to magnet]\n`);

log('── finer ROOM bins ──');
const bins = [[0, 1], [1, 2], [2, 3], [3, 5], [5, 8], [8, 999]];
for (const [lo, hi] of bins) rep(`room ${lo}-${hi}%`, rows.filter((r) => r.t1RoomPct != null && r.t1RoomPct >= lo && r.t1RoomPct < hi));
rep('no wall (room=null)', rows.filter((r) => r.t1RoomPct == null));

log('\n── candidate binary: NEAR WALL (room<=4%) vs far/none ──');
rep('near wall (<=4%)', rows.filter((r) => r.t1RoomPct != null && r.t1RoomPct <= 4));
rep('far/none (>4% or null)', rows.filter((r) => r.t1RoomPct == null || r.t1RoomPct > 4));

log('\n── entered-only (drop no-fills, which are 0R) ──');
const ent = rows.filter((r) => r.entered);
log(`(entered n=${ent.length} of ${rows.length})`);
rep('ALL entered', ent);
rep('entered & near wall<=4%', ent.filter((r) => r.t1RoomPct != null && r.t1RoomPct <= 4));
rep('entered & far/none', ent.filter((r) => r.t1RoomPct == null || r.t1RoomPct > 4));

log('\n── confound check: is near-wall just LARGE magnet (liquid mega-cap)? ──');
rep('near wall & magnet>=100M', rows.filter((r) => r.t1RoomPct != null && r.t1RoomPct <= 4 && r.vannaMagnetM >= 100));
rep('near wall & magnet<100M', rows.filter((r) => r.t1RoomPct != null && r.t1RoomPct <= 4 && r.vannaMagnetM < 100));
rep('near wall & magnet<50M', rows.filter((r) => r.t1RoomPct != null && r.t1RoomPct <= 4 && r.vannaMagnetM < 50));

log('\n── big-magnet inconsistency (the trap), per-week detail ──');
rep('magnet >= 200M', rows.filter((r) => r.vannaMagnetM >= 200));
rep('magnet 50-200M', rows.filter((r) => r.vannaMagnetM >= 50 && r.vannaMagnetM < 200));
rep('magnet 10-50M', rows.filter((r) => r.vannaMagnetM >= 10 && r.vannaMagnetM < 50));

log('\n── longs only (shorts are few + different regime) ──');
const L = rows.filter((r) => r.dir === 'long');
rep('long: near wall<=4%', L.filter((r) => r.t1RoomPct != null && r.t1RoomPct <= 4));
rep('long: far/none', L.filter((r) => r.t1RoomPct == null || r.t1RoomPct > 4));
