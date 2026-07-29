// THREE MORE IDEAS, tested honestly on the 19 days (some will miss):
// (A) WALL-HEALTH GAMMA-BLEED: a strong wall being tested while its gamma DECAYS (dealers pulling) breaks.
// (B) VANNA-VIX VOL-CRUSH GRIND: falling VIX + positive aggregate vanna → mechanical dealer bid → grind up.
// (C) TIME PLAYBOOK: is momentum/continuation more likely at the OPEN and reversion/fade more likely MIDDAY?
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const DIR = path.join(process.cwd(), 'apps/gex/research/velocity-capture');
const etOf = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const etMin = (et) => +et.slice(0, 2) * 60 + +et.slice(3);
const load = (d) => { const f = path.join(DIR, `replay_${d}_SPXW.jsonl.gz`); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => JSON.parse(l)) : null; };
const aux = (d) => { const f = path.join(DIR, `aux_${d}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {}; };
const sign = (x) => x > 0 ? 1 : x < 0 ? -1 : 0;
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const days = fs.readdirSync(DIR).filter(f => /^replay_.*_SPXW\.jsonl\.gz$/.test(f)).map(f => f.slice(7, 17)).sort();
const gAtK = (fx, k) => { const n = fx.strikes.find(s => s.strike === k); return n ? n.g0 : 0; };

// ---- (A) WALL-HEALTH GAMMA-BLEED ----
let bleedBrk = 0, bleedN = 0, buildBrk = 0, buildN = 0;
for (const d of days) {
  const fr = load(d); if (!fr) continue; const spots = fr.map(x => x.spot); const nearSet = {};
  for (let i = 12; i < fr.length - 12; i++) {
    if (etMin(etOf(fr[i].ts)) > 15 * 60) break; const spot = spots[i];
    const wall = fr[i].strikes.filter(n => n.g0 >= 15e6 && Math.abs(n.strike - spot) <= 3).sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))[0];
    if (!wall || nearSet[wall.strike]) continue; nearSet[wall.strike] = true;
    const side = sign(spots[i - 3] - wall.strike) || 1;                    // side price came from
    const gVel = wall.g0 - gAtK(fr[i - 10], wall.strike);                  // wall gamma velocity (bleed<0)
    let brk = false;
    for (let j = i + 1; j <= i + 10 && j < fr.length; j++) { if ((spots[j] - wall.strike) * -side >= 3) { brk = true; break; } if ((spots[j] - wall.strike) * side >= 3) break; }
    if (gVel < -2e6) { bleedN++; if (brk) bleedBrk++; } else if (gVel > 2e6) { buildN++; if (brk) buildBrk++; }
  }
}
console.log(`=== (A) WALL-HEALTH GAMMA-BLEED — does a bleeding wall break more? ===`);
console.log(`  BLEEDING wall (gamma↓>2M/10m): break ${bleedN ? (bleedBrk / bleedN * 100).toFixed(0) : 0}% (n=${bleedN})`);
console.log(`  BUILDING wall (gamma↑>2M/10m): break ${buildN ? (buildBrk / buildN * 100).toFixed(0) : 0}% (n=${buildN})`);
console.log(`  => edge if bleeding breaks clearly more than building.`);

// ---- (B) VANNA-VIX VOL-CRUSH GRIND ----
const quad = { 'vixDn_vanna+': [], 'vixDn_vanna-': [], 'vixUp_vanna+': [], 'vixUp_vanna-': [] };
for (const d of days) {
  const fr = load(d), a = aux(d); if (!fr || !a.vixy?.length) continue; const spots = fr.map(x => x.spot);
  const vixBy = Object.fromEntries(a.vixy.map(p => [p.et, p.c]));
  for (let i = 15; i < fr.length - 20; i += 3) {
    const et = etOf(fr[i].ts), p15 = `${String(Math.floor((etMin(et) - 15) / 60)).padStart(2, '0')}:${String((etMin(et) - 15) % 60).padStart(2, '0')}`;
    if (etMin(et) > 15 * 60 || vixBy[et] == null || vixBy[p15] == null) continue;
    const vixDown = vixBy[et] < vixBy[p15];
    const vAgg = fr[i].strikes.reduce((t, n) => t + (n.vAgg || 0), 0);
    const key = `${vixDown ? 'vixDn' : 'vixUp'}_vanna${vAgg >= 0 ? '+' : '-'}`;
    quad[key].push(spots[i + 20] - spots[i]);                              // forward 20-bar move
  }
}
console.log(`\n=== (B) VANNA-VIX VOL-CRUSH GRIND — mean forward 20-bar SPX move by quadrant ===`);
for (const k of Object.keys(quad)) console.log(`  ${k.padEnd(14)}: ${mean(quad[k]) >= 0 ? '+' : ''}${mean(quad[k]).toFixed(2)}pt (n=${quad[k].length})`);
console.log(`  => grind confirmed if vixDn_vanna+ is clearly the most positive (mechanical dealer bid).`);

// ---- (C) TIME PLAYBOOK — continuation (momentum) vs reversion by time-of-day ----
const buckets = { 'open 945-1030': [570, 630], 'mid 1030-1400': [630, 840], 'pm 1400-1545': [840, 945] };
const res = {}; for (const b of Object.keys(buckets)) res[b] = { cont: 0, rev: 0 };
for (const d of days) {
  const fr = load(d); if (!fr) continue; const spots = fr.map(x => x.spot);
  for (let i = 10; i < fr.length - 15; i++) {
    const m = etMin(etOf(fr[i].ts)); const mv = spots[i] - spots[i - 10]; if (Math.abs(mv) < 3) continue;
    const dir = sign(mv); let cont = null;
    for (let j = i + 1; j <= i + 15 && j < fr.length; j++) { const d3 = (spots[j] - spots[i]) * dir; if (d3 >= 3) { cont = true; break; } if (d3 <= -3) { cont = false; break; } }
    if (cont == null) continue;
    for (const [b, [lo, hi]] of Object.entries(buckets)) if (m >= lo && m < hi) { res[b][cont ? 'cont' : 'rev']++; break; }
  }
}
console.log(`\n=== (C) TIME PLAYBOOK — after a confirmed move, continuation vs reversion by time ===`);
for (const b of Object.keys(buckets)) { const r = res[b], t = r.cont + r.rev; console.log(`  ${b.padEnd(15)}: continuation ${t ? (r.cont / t * 100).toFixed(0) : 0}% (n=${t})`); }
console.log(`  => playbook if open>50% continuation (breakout) and midday<50% (fade). 50% = no time-edge.`);
