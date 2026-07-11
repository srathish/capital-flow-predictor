// Pin test v4 — fixes the two honest gaps (research only, READ-ONLY, no logic change).
// King = 0DTE col max|gamma| (verified == live tracker). Two fixes:
//   FIX 1 (control): replace mirror-placebo with a DISTANCE-MATCHED DEAD strike —
//     among strikes ~same distance from spot as the King, the one with the LOWEST
//     |gamma| (a non-node). Controls for "price is near the King because the King is
//     near spot" without the mirror accidentally being the other real wall.
//   FIX 2 (metric): ZONE pin, not exact touch — fraction of the final window spot
//     spends within ±0.4% of the King (mean-reversion around it), + mean proximity +
//     zero-crossings (oscillation around the level = pinning).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE = path.join(HERE, '..', '..', '..', 'data', 'skylit-archive', 'intraday');
const days = fs.readdirSync(ARCHIVE).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
const TICKERS = (process.argv[2] || 'SPXW,SPY,QQQ').split(',');
const FINAL = 0.30, ZONE = 0.004;                          // pin zone = +-0.4%

function frames(day, t) {
  const p = path.join(ARCHIVE, day, `${t}.jsonl.gz`); if (!fs.existsSync(p)) return [];
  return zlib.gunzipSync(fs.readFileSync(p)).toString().trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean).map(s => ({ ts: Date.parse(s.requestedTs), spot: s.spot, strikes: (s.strikes || []).map(q => ({ k: +q.strike, g: +q.gamma || 0 })).filter(q => Number.isFinite(q.k)) }))
    .filter(s => s.spot != null && Number.isFinite(s.ts)).sort((a, b) => a.ts - b.ts);
}
function setup(fr) {                                        // King + distance-matched dead control
  let king = null, tot = 0; for (const q of fr.strikes) { tot += Math.abs(q.g); if (!king || Math.abs(q.g) > Math.abs(king.g)) king = q; }
  if (!king || !tot) return null;
  const dist = Math.abs(king.k - fr.spot); if (dist / fr.spot < 0.0015) return null;
  // dead strike: among strikes at distance in [0.6,1.4]*dist from spot, min |gamma|
  let dead = null;
  for (const q of fr.strikes) { const d = Math.abs(q.k - fr.spot); if (d >= 0.6 * dist && d <= 1.4 * dist && q.k !== king.k) { if (!dead || Math.abs(q.g) < Math.abs(dead.g)) dead = q; } }
  return { king: king.k, sign: king.g >= 0 ? 'pika' : 'barney', share: Math.abs(king.g) / tot, dead: dead?.k ?? null };
}
const zoneFrac = (win, lvl) => win.filter(f => Math.abs(f.spot - lvl) / f.spot < ZONE).length / win.length;
const meanProx = (win, lvl) => win.reduce((a, f) => a + Math.abs(f.spot - lvl) / f.spot, 0) / win.length;
function crossings(win, lvl) { let c = 0; for (let i = 1; i < win.length; i++) if ((win[i - 1].spot - lvl) * (win[i].spot - lvl) < 0) c++; return c; }

const rows = [];
for (const day of days) for (const t of TICKERS) {
  const fr = frames(day, t); if (fr.length < 8) continue;
  const cut = fr[Math.floor(fr.length * (1 - FINAL))].ts;
  const win = fr.filter(f => f.ts >= cut); if (win.length < 4) continue;
  const s = setup(win[0]); if (!s || s.dead == null) continue;
  rows.push({ sign: s.sign, share: s.share,
    zK: zoneFrac(win, s.king), zD: zoneFrac(win, s.dead),
    pK: meanProx(win, s.king), pD: meanProx(win, s.dead),
    xK: crossings(win, s.king), xD: crossings(win, s.dead) });
}
const pct = x => `${(x * 100).toFixed(0)}%`;
const mean = (s, f) => s.length ? s.reduce((a, r) => a + f(r), 0) / s.length : NaN;
const rate = (s, f) => s.length ? s.filter(f).length / s.length * 100 : NaN;
function report(lab, s) {
  if (!s.length) return;
  console.log(`${lab.padEnd(22)} n=${String(s.length).padStart(3)} | zone@King ${pct(mean(s, r => r.zK))} vs @dead ${pct(mean(s, r => r.zD))} | meanProx King ${pct(mean(s, r => r.pK))} vs dead ${pct(mean(s, r => r.pD))} | King zone>dead ${rate(s, r => r.zK > r.zD).toFixed(0)}%`);
}
console.log(`PIN v4 — 0DTE King, dead-strike control, ZONE metric (+-0.4%), final-${pct(FINAL)}, ${rows.length} sessions\n`);
report('ALL', rows);
report('PIKA', rows.filter(r => r.sign === 'pika'));
const t2 = [...rows].sort((a, b) => a.share - b.share)[Math.floor(rows.length * 2 / 3)].share;
report('HIGH-share', rows.filter(r => r.share > t2));
report('HIGH-share × PIKA', rows.filter(r => r.share > t2 && r.sign === 'pika'));
console.log('\n(pin real if zone@King > zone@dead AND meanProx King < dead AND crossings King > dead)');
console.log(`crossings: King ${mean(rows, r => r.xK).toFixed(1)} vs dead ${mean(rows, r => r.xD).toFixed(1)} (more = oscillates around it = pin)`);
