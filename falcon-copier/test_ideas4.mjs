// BATCH 4:
// (G) LEVEL FRESHNESS: a pika that GREW to strong in the last ~20min (fresh dealer positioning) — is it
//     respected MORE on touch than a long-persistent one?
// (H) BARNEY CASCADE: breaking the FIRST barney with more barneys stacked beyond → bigger move (cascade)?
// (I) 9:45 PIN: does the opening (9:45) dominant king hold price to the CLOSE better than the 9:45 spot?
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const DIR = path.join(process.cwd(), 'apps/gex/research/velocity-capture');
const etOf = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const etMin = (et) => +et.slice(0, 2) * 60 + +et.slice(3);
const load = (d) => { const f = path.join(DIR, `replay_${d}_SPXW.jsonl.gz`); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => JSON.parse(l)) : null; };
const sign = (x) => x > 0 ? 1 : x < 0 ? -1 : 0;
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const days = fs.readdirSync(DIR).filter(f => /^replay_.*_SPXW\.jsonl\.gz$/.test(f)).map(f => f.slice(7, 17)).sort();
const gAtK = (fx, k) => { const n = fx.strikes.find(s => s.strike === k); return n ? n.g0 : 0; };
const idxAt = (fr, et) => fr.reduce((b, x, i) => Math.abs(+etOf(x.ts).replace(':', '') - +et.replace(':', '')) < Math.abs(+etOf(fr[b].ts).replace(':', '') - +et.replace(':', '')) ? i : b, 0);

// ---- (G) FRESHNESS ----
let freshRej = 0, freshN = 0, persRej = 0, persN = 0;
for (const d of days) {
  const fr = load(d); if (!fr) continue; const spots = fr.map(x => x.spot); const seen = {};
  for (let i = 22; i < fr.length - 10; i++) {
    if (etMin(etOf(fr[i].ts)) > 15 * 60) break; const spot = spots[i];
    const wall = fr[i].strikes.filter(n => n.g0 >= 15e6 && Math.abs(n.strike - spot) <= 2).sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))[0];
    if (!wall || seen[wall.strike]) continue; seen[wall.strike] = true;
    const past = gAtK(fr[i - 20], wall.strike); const fresh = past < 10e6;   // grew to strong in last 20 bars
    const side = sign(spots[i - 3] - wall.strike) || 1; let rej = null;
    for (let j = i + 1; j <= i + 10 && j < fr.length; j++) { if ((spots[j] - wall.strike) * side >= 3) { rej = true; break; } if ((spots[j] - wall.strike) * -side >= 3) { rej = false; break; } }
    if (rej == null) continue; if (fresh) { freshN++; if (rej) freshRej++; } else { persN++; if (rej) persRej++; }
  }
}
console.log(`=== (G) FRESHNESS — is a freshly-grown pika respected more on touch? ===`);
console.log(`  FRESH (grew to ≥15M in 20m): reject ${freshN ? (freshRej / freshN * 100).toFixed(0) : 0}% (n=${freshN})`);
console.log(`  PERSISTENT (already strong):  reject ${persN ? (persRej / persN * 100).toFixed(0) : 0}% (n=${persN})`);

// ---- (H) BARNEY CASCADE ----
const solo = [], stacked = [];
for (const d of days) {
  const fr = load(d); if (!fr) continue; const spots = fr.map(x => x.spot); let cd = -99;
  for (let i = 5; i < fr.length - 20; i++) {
    if (i < cd || etMin(etOf(fr[i].ts)) > 15 * 60) continue; const spot = spots[i];
    const b = fr[i].strikes.filter(n => n.g0 <= -8e6 && Math.abs(n.strike - spot) <= 3).sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))[0];
    if (!b) continue; const dir = sign(b.strike - spot) || sign(spot - spots[i - 3]) || -1;   // break direction
    // count barneys stacked beyond the first in the break direction
    const beyond = fr[i].strikes.filter(n => n.g0 <= -8e6 && (n.strike - b.strike) * dir > 1 && Math.abs(n.strike - b.strike) <= 20).length;
    // did price break through b? then measure forward move in dir over 15 bars
    let broke = false; for (let j = i + 1; j <= i + 5 && j < fr.length; j++) if ((spots[j] - b.strike) * dir >= 2) { broke = true; break; }
    if (!broke) continue; let mv = 0; for (let j = i + 1; j <= i + 15 && j < fr.length; j++) mv = Math.max(mv, (spots[j] - spot) * dir);
    (beyond >= 1 ? stacked : solo).push(mv); cd = i + 8;
  }
}
console.log(`\n=== (H) BARNEY CASCADE — does breaking a barney with more stacked beyond move further? ===`);
console.log(`  SOLO barney broken:    median forward move ${median(solo).toFixed(1)}pt (n=${solo.length})`);
console.log(`  STACKED (≥1 beyond):   median forward move ${median(stacked).toFixed(1)}pt (n=${stacked.length})`);

// ---- (I) 9:45 PIN ----
let kingWin = 0, tot = 0; const pulls = [];
for (const d of days) {
  const fr = load(d); if (!fr) continue; const spots = fr.map(x => x.spot);
  const oi = idxAt(fr, '09:45'), spot0 = spots[oi], close = spots[spots.length - 1];
  const king = fr[oi].strikes.filter(n => n.g0 >= 15e6).sort((a, b) => b.g0 - a.g0)[0];
  if (!king || Math.abs(spot0 - king.strike) < 4) continue;
  tot++; if (Math.abs(close - king.strike) < Math.abs(close - spot0)) kingWin++;
  pulls.push(Math.abs(close - spot0) - Math.abs(close - king.strike));           // + = close pulled toward king
}
console.log(`\n=== (I) 9:45 PIN — does the opening king hold price to the close? ===`);
console.log(`  close nearer the 9:45 king than the 9:45 spot: ${tot ? (kingWin / tot * 100).toFixed(0) : 0}% of days (n=${tot}) · median pull ${median(pulls).toFixed(1)}pt`);
console.log(`  => pin real if >60% and positive median pull.`);
