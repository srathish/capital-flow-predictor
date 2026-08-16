#!/usr/bin/env node
// Slice the cached OOS dataset. No pulls — pure stats, iterate freely.
// Discipline: any "edge" must (a) beat the take-everything baseline, (b) hold the SAME
// direction in >=3 of 4 weeks (not be one-week-driven), (c) be mechanistically sensible.
import { resolveFromRoot, readJson, log } from '../../lib/util.mjs';
const D = readJson(resolveFromRoot('research/perexpiry-oos/dataset.json'));
const rows = D.rows;
const WEEKS = ['2026-07-13', '2026-07-20', '2026-07-27', '2026-08-03'];
const R = (x) => x.R_stop ?? 0;
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const hit = (a) => a.length ? a.filter((x) => x > 0).length / a.length : 0;
const fmt = (x) => (x >= 0 ? '+' : '') + x.toFixed(2);
const stat = (rs) => ({ n: rs.length, mean: mean(rs.map(R)), hit: hit(rs.map(R)), tot: rs.map(R).reduce((s, x) => s + x, 0) });

log(`\n════ OOS dataset: ${rows.length} setups, 4 weeks ════`);
const base = stat(rows);
log(`BASELINE (take everything): n=${base.n}  meanR ${fmt(base.mean)}  hit ${(base.hit * 100).toFixed(0)}%  totR ${fmt(base.tot)}`);
log(`  Any filter must beat meanR ${fmt(base.mean)} AND hold across weeks.\n`);

// per-week mean for a subset (consistency check)
function perWeek(rs) { return WEEKS.map((w) => { const s = rs.filter((r) => r.week === w); return s.length ? mean(s.map(R)) : null; }); }
function report(name, rs, allRows = rows) {
  const s = stat(rs);
  const pw = perWeek(rs).map((x) => x == null ? ' — ' : fmt(x)).join('  ');
  log(`${name.padEnd(28)} n=${String(s.n).padStart(2)}  meanR ${fmt(s.mean).padStart(6)}  hit ${(s.hit * 100).toFixed(0).padStart(3)}%   per-wk: ${pw}`);
  return s;
}

// H1 — verdict buckets
log('── H1: STRUCTURE GRADE (verdict) ──   per-wk: 07/13 07/20 07/27 08/03');
const verdicts = ['CONFIRM', 'VANNA-ONLY', 'WIDE', 'PINNED', 'THIN', 'NO-STRUCT'];
for (const v of verdicts) report(v, rows.filter((r) => r.verdict === v));
report('CONFIRM only', rows.filter((r) => r.verdict === 'CONFIRM'));
report('NOT confirm', rows.filter((r) => r.verdict !== 'CONFIRM'));

// H2 — vanna magnet size terciles
log('\n── H2: VANNA MAGNET SIZE (terciles by $M) ──');
const withMag = rows.filter((r) => r.vannaMagnetM > 0).sort((a, b) => a.vannaMagnetM - b.vannaMagnetM);
const t = Math.floor(withMag.length / 3);
report(`small magnet (<=${withMag[t - 1]?.vannaMagnetM}M)`, withMag.slice(0, t));
report(`mid magnet`, withMag.slice(t, 2 * t));
report(`large magnet (>=${withMag[2 * t]?.vannaMagnetM}M)`, withMag.slice(2 * t));
report('zero magnet (NO-STRUCT/THIN)', rows.filter((r) => r.vannaMagnetM === 0));

// H3 — strong floor
log('\n── H3: STRONG GAMMA FLOOR below ──');
report('strongFloor=true', rows.filter((r) => r.strongFloor));
report('strongFloor=false', rows.filter((r) => !r.strongFloor));

// H4 — magnet on a NEAR clock (driving vanna expiry within the resolve window)
log('\n── H4: MAGNET IN-WINDOW (driveNear) ──');
report('driveNear=true', rows.filter((r) => r.driveNear));
report('driveNear=false', rows.filter((r) => !r.driveNear));
report('runnerNear=true', rows.filter((r) => r.runnerNear));
report('runnerNear=false', rows.filter((r) => !r.runnerNear));

// H5 — proximity to T1 wall (room). pinned vs some room vs wide
log('\n── H5: ROOM TO T1 WALL ──');
report('pinned (<0.4%)', rows.filter((r) => r.t1RoomPct != null && r.t1RoomPct < 0.4));
report('room 0.4-3%', rows.filter((r) => r.t1RoomPct != null && r.t1RoomPct >= 0.4 && r.t1RoomPct <= 3));
report('room 3-8%', rows.filter((r) => r.t1RoomPct != null && r.t1RoomPct > 3 && r.t1RoomPct <= 8));
report('wide (>8%) / none', rows.filter((r) => r.t1RoomPct == null || r.t1RoomPct > 8));

// H6 — combined: CONFIRM + strong floor (the Aug-17 "A-tier" profile)
log('\n── H6: COMBINED FILTERS ──');
report('CONFIRM & strongFloor', rows.filter((r) => r.verdict === 'CONFIRM' && r.strongFloor));
report('CONFIRM & !strongFloor', rows.filter((r) => r.verdict === 'CONFIRM' && !r.strongFloor));
report('CONFIRM & runnerNear', rows.filter((r) => r.verdict === 'CONFIRM' && r.runnerNear));
report('CONFIRM & magnet>=50M', rows.filter((r) => r.verdict === 'CONFIRM' && r.vannaMagnetM >= 50));
report('CONFIRM & magnet<50M', rows.filter((r) => r.verdict === 'CONFIRM' && r.vannaMagnetM > 0 && r.vannaMagnetM < 50));
