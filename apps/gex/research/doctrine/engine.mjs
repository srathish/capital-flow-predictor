// THE LIVING ENGINE — probabilities that BREATHE with the structure (node size + vanna), not a static
// distance table. Two validated, ~stationary mechanics (unlike the non-stationary directional/tape edge):
//   REACH  P(price reaches a pika before close | distance, NODE GAMMA SIZE). Bigger node = LESS reach
//          (big gamma pins/suppresses vol). ~halves the reach prob at range.
//   HOLD   P(reject on touch | VANNA sign). vanna+ holds better (deflect); vanna- breaks (trapdoor).
// Combine: P(reach AND reject) = the fade setup's probability; P(reach AND break) = the trapdoor's.
//   node engine.mjs            -> tables + HOLDOUT (does node-size reach generalize?)
//   ENV_FILE=... node engine.mjs --live
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const DIR = path.join(process.cwd(), 'research', 'velocity-capture');
const etOf = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const etMin = (et) => +et.slice(0, 2) * 60 + +et.slice(3);
const load = (d) => { const f = path.join(DIR, `replay_${d}_SPXW.jsonl.gz`); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => JSON.parse(l)) : null; };
const WALLG = 12e6, TOL = 2, REACT = 3, WIN = 8;
const dBucket = (ad) => ad < 4 ? '0-4' : ad < 8 ? '4-8' : ad < 12 ? '8-12' : ad < 18 ? '12-18' : '18-30';
const gBucket = (g) => g < 20e6 ? 'S' : g < 35e6 ? 'M' : 'L';   // small / medium / large node
const ALLDAYS = fs.readdirSync(DIR).filter(f => /^replay_.*_SPXW\.jsonl\.gz$/.test(f)).map(f => f.slice(7, 17)).sort();

function train(days = ALLDAYS) {
  const reach = {}, hold = {};   // reach: `${dB}|${gB}` -> {hit,n}; hold: vannaSign -> {rej,brk}
  for (const d of days) {
    const fr = load(d); if (!fr) continue; const spots = fr.map(x => x.spot);
    for (let i = 0; i < fr.length; i++) {
      if (etMin(etOf(fr[i].ts)) > 15 * 60 + 30) continue; const spot = spots[i];
      for (const n of fr[i].strikes) {
        if (n.g0 < WALLG) continue; const ad = Math.abs(n.strike - spot); if (ad < 2 || ad > 30) continue;
        let reached = false; for (let j = i + 1; j < spots.length; j++) { if (Math.abs(spots[j] - n.strike) <= TOL) { reached = true; break; } }
        const k = `${dBucket(ad)}|${gBucket(n.g0)}`; (reach[k] ||= { hit: 0, n: 0 }); reach[k].n++; if (reached) reach[k].hit++;
      }
    }
    let near = {};
    for (let i = 1; i < fr.length; i++) {
      if (etMin(etOf(fr[i].ts)) > 15 * 60 + 40) continue; const spot = spots[i];
      for (const n of fr[i].strikes) {
        if (n.g0 < WALLG) continue; const ad = Math.abs(n.strike - spot);
        if (ad <= TOL && !near[n.strike]) {
          near[n.strike] = true; const side0 = Math.sign(spots[i - 1] - n.strike) || 1; let o = null;
          for (let j = i + 1; j <= Math.min(i + WIN, fr.length - 1); j++) { const away = (spots[j] - n.strike) * side0; if (away >= REACT) { o = 'rej'; break; } if (-away >= REACT) { o = 'brk'; break; } }
          if (o) { const vs = n.v0 > 0 ? 'vanna+' : n.v0 < 0 ? 'vanna-' : 'v0'; (hold[vs] ||= { rej: 0, brk: 0 })[o]++; }
        } else if (ad > TOL + 1) near[n.strike] = false;
      }
    }
  }
  return { reach, hold };
}
const rP = (t, k, m = 25) => { const c = t[k]; return c && c.n >= m ? c.hit / c.n : null; };
const hP = (t, k) => { const c = t[k]; return c && (c.rej + c.brk) >= 20 ? c.rej / (c.rej + c.brk) : null; };
const model = train();

if (!process.argv.includes('--live')) {
  console.log(`=== LIVING ENGINE — reach P(reach before close) by distance × NODE SIZE ===`);
  console.log(`dist        small(12-20M)   med(20-35M)    large(35M+)`);
  for (const db of ['0-4', '4-8', '8-12', '12-18', '18-30']) { const c = (g) => { const p = rP(model.reach, `${db}|${g}`); return p == null ? '—' : (p * 100).toFixed(0) + '%'; }; console.log(`${db.padEnd(10)}  ${c('S').padEnd(14)}  ${c('M').padEnd(13)}  ${c('L')}`); }
  console.log(`\nhold P(reject on touch) by vanna:  vanna+ ${((hP(model.hold, 'vanna+') || 0) * 100).toFixed(0)}%  ·  vanna- ${((hP(model.hold, 'vanna-') || 0) * 100).toFixed(0)}%`);
  // HOLDOUT — does the node-size reach effect generalize? (the directional/tape one did NOT)
  const tr = train(ALLDAYS.slice(0, 12)), te = train(ALLDAYS.slice(12));
  console.log(`\n=== HOLDOUT (train 12d / test 7d) — node-size reach:`);
  console.log(`bucket        train  test   Δ`); let sae = 0, cells = 0;
  for (const db of ['4-8', '8-12', '12-18', '18-30']) for (const g of ['S', 'M', 'L']) {
    const a = rP(tr.reach, `${db}|${g}`, 15), b = rP(te.reach, `${db}|${g}`, 15); if (a == null || b == null) continue;
    sae += Math.abs(a - b) * 100; cells++; console.log(`${(db + ' ' + g).padEnd(12)}  ${(a * 100).toFixed(0).padStart(3)}%  ${(b * 100).toFixed(0).padStart(3)}%  ${((b - a) * 100 >= 0 ? '+' : '') + ((b - a) * 100).toFixed(0)}`);
  }
  console.log(`mean abs calibration error: ${(sae / cells).toFixed(1)} pts (${cells} cells). <10 = generalizes (unlike the 18-23pt directional error).`);
  console.log(`\nSYSTEM READ: large near node = PINNING (low travel) = fade the range. small/scattered = price travels = trend/breakout.`);
  console.log(`At a pika: vanna+ => it DEFLECTS (fade). vanna- => it BREAKS (trapdoor, ride through).`);
  process.exit(0);
}

// ---- LIVE ----
await import('../../scripts/_env-bootstrap.js');
const { initAuth, getFreshToken } = await import('../../src/heatseeker/auth.js');
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
const DATE = process.env.DATE || new Date().toISOString().slice(0, 10);
await initAuth();
const token = await getFreshToken();
const u = new URL('https://app.skylit.ai/api/data');
u.searchParams.set('symbol', 'SPXW'); u.searchParams.set('max_strikes', '200'); u.searchParams.set('max_expirations', '10'); u.searchParams.set('nocache', Math.random().toString());
const r = await fetch(u, { headers: { Origin: 'https://app.skylit.ai', Referer: 'https://app.skylit.ai/', Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
if (!r.ok) { console.error(`skylit ${r.status} — re-auth session B`); process.exit(1); }
const raw = await r.json(); const spot = raw.CurrentSpot, K = raw.Strikes || [], G = raw.GammaValues || [], V = raw.VannaValues || [];
const strikes = []; for (let i = 0; i < K.length; i++) { const k = +K[i]; if (Number.isFinite(k) && Math.abs(k - spot) / spot <= 0.012) strikes.push({ strike: k, g0: (G[i] || [])[0] || 0, v0: (V[i] || [])[0] || 0 }); }
const near = strikes.filter(n => n.g0 >= WALLG && Math.abs(n.strike - spot) >= 2 && Math.abs(n.strike - spot) <= 30).sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot));
const biggest = strikes.filter(n => Math.abs(n.strike - spot) <= 12).sort((a, b) => b.g0 - a.g0)[0];
console.log(`\n===== LIVING ENGINE · ${DATE} · SPX ${spot.toFixed(1)} =====`);
console.log(`near-spot dominant node: ${biggest ? `${biggest.strike} (${(biggest.g0 / 1e6).toFixed(0)}M) => ${biggest.g0 >= 35e6 ? 'LARGE: PINNING regime, fade the range' : biggest.g0 >= 20e6 ? 'MED: mixed' : 'small: price can TRAVEL (trend/breakout)'}` : 'none'}`);
if (!near.length) console.log(`(no strong pika within 30 pts — stand aside)`);
for (const n of near) {
  const dd = n.strike - spot, g = gBucket(n.g0), reach = rP(model.reach, `${dBucket(Math.abs(dd))}|${g}`);
  const vs = n.v0 > 0 ? 'vanna+' : 'vanna-', rej = hP(model.hold, vs);
  const combo = reach != null && rej != null ? reach * rej : null;
  console.log(`  ${dd > 0 ? 'UP  ' : 'DOWN'} ${n.strike} (${(n.g0 / 1e6).toFixed(0)}M/${g}, ${vs}, ${dd > 0 ? '+' : ''}${dd.toFixed(0)}): reach ${reach == null ? '—' : (reach * 100).toFixed(0) + '%'} · if-reached reject ${rej == null ? '—' : (rej * 100).toFixed(0) + '%'} · FADE-setup ${combo == null ? '—' : (combo * 100).toFixed(0) + '%'} ${n.v0 < 0 ? '[vanna- => leans BREAK/trapdoor]' : ''}`);
}
console.log(`\nreach = P(price gets there | distance & node size). reject = P(it bounces if it gets there | vanna). FADE-setup = reach×reject.`);
console.log(`Direction (with/against tape) is regime-dependent & non-stationary — use these STRUCTURE probs + your read of whether fades or breakouts are working this week.`);
