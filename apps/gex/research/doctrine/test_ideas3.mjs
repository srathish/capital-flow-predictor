// THREE MORE (batch 3):
// (D) GAMMA-FLIP CROSS: below the 0DTE gamma-flip = negative-gamma = range EXPANDS (momentum). Test if
//     forward range is bigger when spot is below the flip, and if a fresh cross-below accelerates.
// (E) ESCALATOR (king migration): a dominant king whose STRIKE migrates one way over 30m → price follows.
// (F) BRACKET PIN: two comparable strong pikas straddling spot → price pins between them (chop, low range).
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const DIR = path.join(process.cwd(), 'research', 'velocity-capture');
const etOf = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const etMin = (et) => +et.slice(0, 2) * 60 + +et.slice(3);
const load = (d) => { const f = path.join(DIR, `replay_${d}_SPXW.jsonl.gz`); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => JSON.parse(l)) : null; };
const sign = (x) => x > 0 ? 1 : x < 0 ? -1 : 0;
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const days = fs.readdirSync(DIR).filter(f => /^replay_.*_SPXW\.jsonl\.gz$/.test(f)).map(f => f.slice(7, 17)).sort();
const flip = (fx) => { const ss = [...fx.strikes].sort((a, b) => a.strike - b.strike); let best = null, bd = 1e18; for (const k of ss) { const bel = ss.filter(n => n.strike <= k.strike).reduce((t, n) => t + n.g0, 0); const abv = ss.filter(n => n.strike > k.strike).reduce((t, n) => t + n.g0, 0); if (Math.abs(bel - abv) < bd) { bd = Math.abs(bel - abv); best = k.strike; } } return best; };
const dayKing = (fr, i) => fr[i].strikes.filter(n => n.g0 >= 15e6).sort((a, b) => b.g0 - a.g0)[0];

// ---- (D) GAMMA-FLIP CROSS ----
const belowRange = [], aboveRange = [];
for (const d of days) {
  const fr = load(d); if (!fr) continue; const spots = fr.map(x => x.spot);
  for (let i = 5; i < fr.length - 20; i += 3) {
    if (etMin(etOf(fr[i].ts)) > 15 * 60) break; const spot = spots[i], fl = flip(fr[i]); if (fl == null) continue;
    const seg = spots.slice(i, i + 20); const rng = Math.max(...seg) - Math.min(...seg);
    (spot < fl - 2 ? belowRange : spot > fl + 2 ? aboveRange : belowRange).push(spot < fl - 2 ? rng : spot > fl + 2 ? rng : null);
    if (spot >= fl - 2 && spot <= fl + 2) { belowRange.pop(); }
  }
}
const bR = belowRange.filter(x => x != null), aR = aboveRange.filter(x => x != null);
console.log(`=== (D) GAMMA-FLIP CROSS — is forward range bigger BELOW the flip (negative gamma = momentum)? ===`);
console.log(`  spot BELOW flip: median 20-bar range ${median(bR).toFixed(1)}pt (n=${bR.length})`);
console.log(`  spot ABOVE flip: median 20-bar range ${median(aR).toFixed(1)}pt (n=${aR.length})`);
console.log(`  => edge if below-flip range is clearly bigger (regime switch real).`);

// ---- (E) ESCALATOR (king migration leads price) ----
let hit = 0, tot = 0; const migMoves = [];
for (const d of days) {
  const fr = load(d); if (!fr) continue; const spots = fr.map(x => x.spot);
  for (let i = 30; i < fr.length - 20; i += 3) {
    if (etMin(etOf(fr[i].ts)) > 15 * 60) break;
    const k0 = dayKing(fr, i), k30 = dayKing(fr, i - 30); if (!k0 || !k30) continue;
    const mig = k0.strike - k30.strike; if (Math.abs(mig) < 5) continue;   // king migrated >=5pt over 30m
    const fwd = spots[i + 20] - spots[i];
    tot++; if (sign(mig) === sign(fwd)) hit++; migMoves.push(sign(mig) * fwd);
  }
}
console.log(`\n=== (E) ESCALATOR — does a migrating king LEAD price the same way? ===`);
console.log(`  king migrated ≥5pt/30m: forward move follows migration ${tot ? (hit / tot * 100).toFixed(0) : 0}% · mean follow ${mean(migMoves).toFixed(2)}pt (n=${tot})`);
console.log(`  => escalator real if >55% and mean-follow clearly positive.`);

// ---- (F) BRACKET PIN ----
const bracketRange = [], singleRange = [];
for (const d of days) {
  const fr = load(d); if (!fr) continue; const spots = fr.map(x => x.spot);
  for (let i = 5; i < fr.length - 20; i += 3) {
    if (etMin(etOf(fr[i].ts)) > 15 * 60) break; const spot = spots[i];
    const up = fr[i].strikes.filter(n => n.g0 >= 15e6 && n.strike > spot + 1 && n.strike - spot <= 25).sort((a, b) => b.g0 - a.g0)[0];
    const dn = fr[i].strikes.filter(n => n.g0 >= 15e6 && n.strike < spot - 1 && spot - n.strike <= 25).sort((a, b) => b.g0 - a.g0)[0];
    const seg = spots.slice(i, i + 20); const rng = Math.max(...seg) - Math.min(...seg);
    if (up && dn && Math.max(up.g0, dn.g0) / Math.min(up.g0, dn.g0) <= 2) bracketRange.push(rng);   // comparable straddle
    else if ((up && !dn) || (dn && !up)) singleRange.push(rng);                                       // one dominant side
  }
}
console.log(`\n=== (F) BRACKET PIN — do two comparable straddling pikas = lower range (pinned/chop)? ===`);
console.log(`  BRACKET (2 comparable pikas straddle): median 20-bar range ${median(bracketRange).toFixed(1)}pt (n=${bracketRange.length})`);
console.log(`  SINGLE (one dominant side):            median 20-bar range ${median(singleRange).toFixed(1)}pt (n=${singleRange.length})`);
console.log(`  => bracket-pin real if bracket range is clearly smaller (price trapped between walls).`);
