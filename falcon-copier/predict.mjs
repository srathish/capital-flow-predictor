// PREDICTIVE REACH ENGINE (trinity-regime). Regime = are SPX(surface)+SPY+QQQ all aligned (same 15-min
// direction)? aligned = TREND (momentum reaches levels WITH the tape); diverging = CHOP (price REVERTS
// against the tape back to levels). This is live-computable (no hindsight), matching Falcon's radar.
// P(reach) is pooled over every (minute × strong-level) sample, conditioned on regime + distance + tape.
//   node predict.mjs            -> print the two regime reach tables + excursion
//   node predict.mjs --holdout  -> train first 12 days / test last 7 (does it generalize?)
//   ENV_FILE=research/stock-gex/session-b.env ... node predict.mjs --live
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const DIR = path.join(process.cwd(), 'apps/gex/research/velocity-capture');
const etOf = (ts) => `${String(+ts.slice(11, 13) - 4).padStart(2, '0')}:${ts.slice(14, 16)}`;
const etMin = (et) => +et.slice(0, 2) * 60 + +et.slice(3);
const etMinus = (et, n) => { const m = etMin(et) - n; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const load = (d) => { const f = path.join(DIR, `replay_${d}_SPXW.jsonl.gz`); return fs.existsSync(f) ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').trim().split('\n').map(l => JSON.parse(l)) : null; };
const aux = (d) => { const f = path.join(DIR, `aux_${d}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { spy: [], qqq: [] }; };
const sign = (x) => x > 0 ? 1 : x < 0 ? -1 : 0;
const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; };
const WALLG = 12e6, TOL = 2, MOM = 15, CLOSE = 16 * 60;
const dBucket = (ad) => ad < 4 ? '0-4' : ad < 8 ? '4-8' : ad < 12 ? '8-12' : ad < 18 ? '12-18' : '18-30';
const tBucket = (m) => { const left = CLOSE - m; return left > 240 ? '>4h' : left > 120 ? '2-4h' : left > 60 ? '1-2h' : '<1h'; };
const ALLDAYS = fs.readdirSync(DIR).filter(f => /^replay_.*_SPXW\.jsonl\.gz$/.test(f)).map(f => f.slice(7, 17)).sort();

function train(days = ALLDAYS) {
  const reach = { TREND: {}, CHOP: {} }, exc = {}, regimeCount = { TREND: 0, CHOP: 0 };
  for (const d of days) {
    const fr = load(d), a = aux(d); if (!fr || !a.spy?.length || !a.qqq?.length) continue;
    const spyBy = Object.fromEntries(a.spy.map(p => [p.et, p.c])), qqqBy = Object.fromEntries(a.qqq.map(p => [p.et, p.c]));
    const spxBy = Object.fromEntries(fr.map(x => [etOf(x.ts), x.spot]));
    const spyOpen = a.spy[0].c, spots = fr.map(x => x.spot);
    for (let i = 0; i < fr.length; i++) {
      const et = etOf(fr[i].ts), m = etMin(et); if (m > 15 * 60 + 30) continue;
      const p15 = etMinus(et, MOM);
      if (spxBy[p15] == null || spyBy[p15] == null || qqqBy[p15] == null || spyBy[et] == null || qqqBy[et] == null) continue;
      const sx = sign(spxBy[et] - spxBy[p15]), sp = sign(spyBy[et] - spyBy[p15]), qq = sign(qqqBy[et] - qqqBy[p15]);
      const regime = (sx !== 0 && sx === sp && sp === qq) ? 'TREND' : 'CHOP';   // trinity aligned?
      regimeCount[regime]++;
      const spot = spots[i], tape = sign(spyBy[et] - spyOpen);
      let up = 0, dn = 0; for (let j = i + 1; j < spots.length; j++) { up = Math.max(up, spots[j] - spot); dn = Math.max(dn, spot - spots[j]); }
      (exc[tBucket(m)] ||= { up: [], dn: [] }).up.push(up); exc[tBucket(m)].dn.push(dn);
      for (const n of fr[i].strikes) {
        if (n.g0 < WALLG) continue; const dd = n.strike - spot, ad = Math.abs(dd); if (ad < 2 || ad > 30) continue;
        const withTape = tape !== 0 && tape === sign(dd) ? 'with-tape' : tape === 0 ? 'flat' : 'vs-tape';
        let reached = false; for (let j = i + 1; j < spots.length; j++) { if (Math.abs(spots[j] - n.strike) <= TOL) { reached = true; break; } }
        const key = `${dBucket(ad)}|${withTape}`; ((reach[regime][key]) ||= { hit: 0, n: 0 }); reach[regime][key].n++; if (reached) reach[regime][key].hit++;
      }
    }
  }
  return { reach, exc, regimeCount };
}

const cell = (tbl, db, al, min = 20) => { const c = tbl[`${db}|${al}`]; return c && c.n >= min ? `${(c.hit / c.n * 100).toFixed(0)}% (n=${c.n})` : '—'; };
function printTable(name, tbl) {
  console.log(`\n${name} — P(reach) by distance & tape:`);
  console.log(`dist       with-tape          vs-tape`);
  for (const db of ['0-4', '4-8', '8-12', '12-18', '18-30']) console.log(`${db.padEnd(9)}  ${cell(tbl, db, 'with-tape').padEnd(17)}  ${cell(tbl, db, 'vs-tape')}`);
}

if (process.argv.includes('--holdout')) {
  const tr = train(ALLDAYS.slice(0, 12)), te = train(ALLDAYS.slice(12));
  console.log(`=== TRINITY-REGIME HOLDOUT · train 12d / test 7d ===`);
  for (const reg of ['TREND', 'CHOP']) {
    console.log(`\n${reg}:  bucket             train  test   Δ`); let sae = 0, cells = 0;
    for (const db of ['0-4', '4-8', '8-12', '12-18', '18-30']) for (const al of ['with-tape', 'vs-tape']) {
      const a = tr.reach[reg][`${db}|${al}`], b = te.reach[reg][`${db}|${al}`]; if (!a || !b || a.n < 15 || b.n < 15) continue;
      const pa = a.hit / a.n * 100, pb = b.hit / b.n * 100; sae += Math.abs(pa - pb); cells++;
      console.log(`        ${(db + ' ' + al).padEnd(18)}  ${pa.toFixed(0).padStart(3)}%  ${pb.toFixed(0).padStart(3)}%  ${(pb - pa >= 0 ? '+' : '') + (pb - pa).toFixed(0)}`);
    }
    console.log(`        mean abs calibration error: ${cells ? (sae / cells).toFixed(1) : '—'} pts (${cells} cells)`);
  }
  process.exit(0);
}

const model = train();
if (!process.argv.includes('--live')) {
  console.log(`=== TRINITY-REGIME REACH ENGINE — ${ALLDAYS.length} days ===`);
  console.log(`minute-samples: TREND (SPX+SPY+QQQ aligned) ${model.regimeCount.TREND}  ·  CHOP (diverging) ${model.regimeCount.CHOP}`);
  printTable('TREND (trinity aligned)', model.reach.TREND);
  printTable('CHOP (diverging)', model.reach.CHOP);
  console.log(`\nExpected MAX EXCURSION to close (SPX pts), by time left:`);
  for (const tb of ['>4h', '2-4h', '1-2h', '<1h']) { const e = model.exc[tb]; if (!e) continue; console.log(`  ${tb.padEnd(5)}  median +${pct(e.up, 50).toFixed(0)}/-${pct(e.dn, 50).toFixed(0)} · p90 +${pct(e.up, 90).toFixed(0)}/-${pct(e.dn, 90).toFixed(0)}`); }
  console.log(`\nUSE: classify regime live (trinity). TREND -> trade WITH the tape toward the level (with-tape reach). CHOP -> fade the extension, price REVERTS to the level (vs-tape reach).`);
  process.exit(0);
}

// ---- LIVE ----
await import('../apps/gex/scripts/_env-bootstrap.js');
const { initAuth, getFreshToken } = await import('../apps/gex/src/heatseeker/auth.js');
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
const DATE = process.env.DATE || new Date().toISOString().slice(0, 10);
await initAuth();
const token = await getFreshToken();
const u = new URL('https://app.skylit.ai/api/data');
u.searchParams.set('symbol', 'SPXW'); u.searchParams.set('max_strikes', '200'); u.searchParams.set('max_expirations', '10'); u.searchParams.set('nocache', Math.random().toString());
const r = await fetch(u, { headers: { Origin: 'https://app.skylit.ai', Referer: 'https://app.skylit.ai/', Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
if (!r.ok) { console.error(`skylit ${r.status} — re-auth session B`); process.exit(1); }
const raw = await r.json(); const spot = raw.CurrentSpot, K = raw.Strikes || [], G = raw.GammaValues || [];
const strikes = []; for (let i = 0; i < K.length; i++) { const k = +K[i]; if (Number.isFinite(k) && Math.abs(k - spot) / spot <= 0.012) strikes.push({ strike: k, g0: (G[i] || [])[0] || 0 }); }
const ser = async (tk) => { const rr = await fetch(`https://api.unusualwhales.com/api/stock/${tk}/ohlc/1m?date=${DATE}`, { headers: { Authorization: `Bearer ${KEY}` } }).catch(() => null); if (!rr || !rr.ok) return []; return ((await rr.json())?.data || []).map(x => +x.close).filter(Number.isFinite); };
const spy = await ser('SPY'), qqq = await ser('QQQ');
const mom = (a) => a.length > MOM ? sign(a[a.length - 1] - a[a.length - 1 - MOM]) : 0;
const spyMom = mom(spy), qqqMom = mom(qqq), spxMom = spyMom; // SPX≈SPY intraday proxy for live momentum
const aligned = spyMom !== 0 && spxMom === spyMom && spyMom === qqqMom;
const regime = aligned ? 'TREND' : 'CHOP';
const tape = spy.length ? sign(spy[spy.length - 1] - spy[0]) : 0;
const nowM = etMin(new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false }).slice(0, 5));
const tbl = model.reach[regime];
const probFor = (dd) => { const al = tape !== 0 && tape === sign(dd) ? 'with-tape' : tape === 0 ? 'flat' : 'vs-tape'; const c = tbl[`${dBucket(Math.abs(dd))}|${al}`]; return c && c.n >= 20 ? c.hit / c.n : null; };

console.log(`\n===== REACH FORECAST · ${DATE} · SPX ${spot.toFixed(1)} =====`);
console.log(`TRINITY  SPX ${spxMom > 0 ? '+' : spxMom < 0 ? '-' : '0'} / SPY ${spyMom > 0 ? '+' : spyMom < 0 ? '-' : '0'} / QQQ ${qqqMom > 0 ? '+' : qqqMom < 0 ? '-' : '0'}  =>  REGIME: ${regime}${aligned ? ' (aligned — momentum)' : ' (diverging — reversion)'}   tape ${tape > 0 ? 'UP' : tape < 0 ? 'DOWN' : 'flat'}`);
const targets = strikes.filter(n => n.g0 >= WALLG && Math.abs(n.strike - spot) >= 2 && Math.abs(n.strike - spot) <= 30).sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot));
if (!targets.length) console.log(`(no strong pika within 30 pts — stand aside)`);
for (const t of targets) { const dd = t.strike - spot, p = probFor(dd); console.log(`  ${dd > 0 ? 'UP  ' : 'DOWN'} to ${t.strike} (${(t.g0 / 1e6).toFixed(0)}M, ${dd > 0 ? '+' : ''}${dd.toFixed(0)}): ${p == null ? 'no base rate' : (p * 100).toFixed(0) + '% reach before close'}  [${regime}]`); }
const e = model.exc[tBucket(nowM)] || model.exc['1-2h'];
if (e) console.log(`  range to close: +${pct(e.up, 50).toFixed(0)}/-${pct(e.dn, 50).toFixed(0)} median, +${pct(e.up, 90).toFixed(0)}/-${pct(e.dn, 90).toFixed(0)} p90`);
console.log(`  PLAY: ${regime === 'TREND' ? 'trinity aligned = lean WITH the tape toward the highest-prob level.' : 'trinity diverging = lean toward REVERSION (fade the extension back to the level).'}`);
console.log(`  ⚠ REGIME CAVEAT: the with/against-tape edge is NON-STATIONARY (holdout: it inverted June→late-July). Trust the DISTANCE % as the base rate; only bet direction if the LAST FEW DAYS have been rewarding that direction (momentum vs reversion). When unsure, treat it as ~a coin flip on direction and lean on convexity+management.`);
