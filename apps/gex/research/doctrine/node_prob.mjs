// Does the probability CHANGE with node SIZE and VANNA? (Is the engine "living" or just distance?)
// Two questions, both pooled over the 19 days:
//   REACH  — within a distance bucket, does a BIGGER target pika get reached more (stronger magnet)?
//   HOLD   — when price TOUCHES a pika, does it REJECT (bounce) more if the node is bigger / by vanna?
// If size & vanna move the numbers, the reach engine must be conditioned on them, not on distance alone.
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const DIR = path.join(process.cwd(), 'research', 'velocity-capture');
const etOf = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const etMin = (et) => +et.slice(0, 2) * 60 + +et.slice(3);
const load = (d) => { const f = path.join(DIR, `replay_${d}_SPXW.jsonl.gz`); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => JSON.parse(l)) : null; };
const WALLG = 12e6, TOL = 2, REACT = 3, WIN = 8;
const dBucket = (ad) => ad < 4 ? '0-4' : ad < 8 ? '4-8' : ad < 12 ? '8-12' : ad < 18 ? '12-18' : '18-30';
const gBucket = (g) => g < 20e6 ? '12-20M' : g < 35e6 ? '20-35M' : '35M+';
const days = fs.readdirSync(DIR).filter(f => /^replay_.*_SPXW\.jsonl\.gz$/.test(f)).map(f => f.slice(7, 17)).sort();

const reach = {};   // `${dBucket}|${gBucket}` -> {hit,n}
const hold = {};    // gBucket -> {rej, brk}    (reject vs break on touch)
const holdV = {};   // vanna sign at node -> {rej, brk}
const holdGrow = {};// growing vs shrinking node -> {rej, brk}

for (const d of days) {
  const fr = load(d); if (!fr) continue; const spots = fr.map(x => x.spot);
  const gPrev = (i, k) => { const f = fr[Math.max(0, i - 15)]; const n = f.strikes.find(s => s.strike === k); return n ? n.g0 : 0; };
  for (let i = 0; i < fr.length; i++) {
    const m = etMin(etOf(fr[i].ts)); if (m > 15 * 60 + 30) continue;
    const spot = spots[i];
    for (const n of fr[i].strikes) {
      if (n.g0 < WALLG) continue; const dd = n.strike - spot, ad = Math.abs(dd); if (ad < 2 || ad > 30) continue;
      // REACH by size
      let reached = false; for (let j = i + 1; j < spots.length; j++) { if (Math.abs(spots[j] - n.strike) <= TOL) { reached = true; break; } }
      const rk = `${dBucket(ad)}|${gBucket(n.g0)}`; (reach[rk] ||= { hit: 0, n: 0 }); reach[rk].n++; if (reached) reach[rk].hit++;
    }
  }
  // HOLD: scan for touches of a strong pika, classify reject vs break, by size / vanna / growth
  let near = {};
  for (let i = 1; i < fr.length; i++) {
    const m = etMin(etOf(fr[i].ts)); if (m > 15 * 60 + 40) continue; const spot = spots[i];
    for (const n of fr[i].strikes) {
      if (n.g0 < WALLG) continue; const ad = Math.abs(n.strike - spot);
      const key = n.strike;
      if (ad <= TOL && !near[key]) {                                  // fresh touch
        near[key] = true;
        // outcome over next WIN bars: reject (move away REACT, back to same side) or break (close past REACT)
        const side0 = Math.sign(spots[i - 1] - n.strike) || 1;        // side price came from
        let outcome = null;
        for (let j = i + 1; j <= Math.min(i + WIN, fr.length - 1); j++) {
          const away = (spots[j] - n.strike) * side0;                 // + = pushed back to origin side (reject)
          const thru = (spots[j] - n.strike) * -side0;                // + = pushed through
          if (away >= REACT) { outcome = 'rej'; break; }
          if (thru >= REACT) { outcome = 'brk'; break; }
        }
        if (outcome) {
          (hold[gBucket(n.g0)] ||= { rej: 0, brk: 0 })[outcome]++;
          const vs = n.v0 > 0 ? 'vanna+' : n.v0 < 0 ? 'vanna-' : 'vanna0'; (holdV[vs] ||= { rej: 0, brk: 0 })[outcome]++;
          const grow = n.g0 >= gPrev(i, n.strike) ? 'growing' : 'shrinking'; (holdGrow[grow] ||= { rej: 0, brk: 0 })[outcome]++;
        }
      } else if (ad > TOL + 1) near[key] = false;
    }
  }
}
const pctReach = (o) => o && o.n >= 25 ? `${(o.hit / o.n * 100).toFixed(0)}% (n=${o.n})` : '—';
const pctRej = (o) => { const t = o.rej + o.brk; return t >= 20 ? `${(o.rej / t * 100).toFixed(0)}% reject (n=${t})` : '—'; };
console.log(`=== DOES NODE SIZE CHANGE REACH? — P(reach) by distance × node gamma ===`);
console.log(`dist        12-20M            20-35M            35M+`);
for (const db of ['0-4', '4-8', '8-12', '12-18', '18-30']) console.log(`${db.padEnd(10)}  ${pctReach(reach[`${db}|12-20M`]).padEnd(16)}  ${pctReach(reach[`${db}|20-35M`]).padEnd(16)}  ${pctReach(reach[`${db}|35M+`])}`);
console.log(`\n=== DOES NODE SIZE CHANGE HOLD? — reject-on-touch by node gamma ===`);
for (const g of ['12-20M', '20-35M', '35M+']) console.log(`  ${g.padEnd(8)}: ${hold[g] ? pctRej(hold[g]) : '—'}`);
console.log(`\n=== DOES VANNA MATTER? — reject-on-touch by vanna sign at the node ===`);
for (const v of ['vanna+', 'vanna-', 'vanna0']) console.log(`  ${v.padEnd(8)}: ${holdV[v] ? pctRej(holdV[v]) : '—'}`);
console.log(`\n=== DOES GROWTH MATTER? — reject-on-touch by node growing vs shrinking (last 15min) ===`);
for (const g of ['growing', 'shrinking']) console.log(`  ${g.padEnd(10)}: ${holdGrow[g] ? pctRej(holdGrow[g]) : '—'}`);
console.log(`\nIf reject% rises with node size / differs by vanna / rises when growing -> the engine MUST condition on live structure (it's living, not a static distance table).`);
