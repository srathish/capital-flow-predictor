// levels.test.mjs — validates the key_levels feature end-to-end against REAL UW data by running
// `node agent.mjs --levels` and asserting invariants on the emitted price-memory levels.
//   node falcon-copier/levels.test.mjs        (run from repo root)
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');   // fileURLToPath decodes %20 etc. (the repo path has a space)
let out;
try { out = execSync('node falcon-copier/agent.mjs --levels', { cwd: ROOT, encoding: 'utf8', timeout: 60000 }); }
catch (e) { console.error('FAILED to run --levels:', e.message); process.exit(1); }

// parse the three "═══ SYM  spot N ═══\n{json}" blocks
const parts = out.split(/═══ (\w+)\s+spot ([\d.]+) ═══/).slice(1);
const R = {};
for (let i = 0; i < parts.length; i += 3) { try { R[parts[i]] = { spot: +parts[i + 1], kl: JSON.parse(parts[i + 2]) }; } catch { R[parts[i]] = { spot: +parts[i + 1], err: true }; } }

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; if (!c) console.log(`  ✗ FAIL ${m}`); };

for (const sym of ['SPXW', 'SPY', 'QQQ']) {
  const b = R[sym];
  if (!b || !b.kl || b.err) { console.log(`  ✗ FAIL ${sym}: no valid key_levels block`); fail++; continue; }
  const k = b.kl, pd = k.prior_day, on = k.overnight, pw = k.prior_week;
  ok(pd.high && pd.low && pd.high.level > pd.low.level, `${sym} PDH > PDL`);
  ok(pd.close.level >= pd.low.level && pd.close.level <= pd.high.level, `${sym} PDC within [PDL,PDH]`);
  ok(on.high && on.low && on.high.level >= on.low.level, `${sym} ONH >= ONL`);
  ok(pw.high && pw.low && pw.high.level > pw.low.level, `${sym} PWH > PWL`);
  // spot-relative math must be internally consistent
  const dp = +(pd.high.level - b.spot).toFixed(2);
  ok(Math.abs(dp - pd.high.dist_pts) < 0.02 && pd.high.side === (pd.high.level > b.spot ? 'above' : 'below'), `${sym} spot-relative math`);
  ok(typeof k.source === 'string' && k.source.length > 0, `${sym} has a source label`);
}
// SPY is EXACT from UW — its 8/13 prior-day must equal the known raw bar (H779.37 L774.11 C777.88).
// (Only asserted while 8/13 is the prior completed session; skips cleanly afterward so the test doesn't rot.)
const spy = R.SPY?.kl?.prior_day;
if (spy && Math.abs(spy.high.level - 779.37) < 0.5) {
  ok(Math.abs(spy.high.level - 779.37) < 0.01 && Math.abs(spy.low.level - 774.11) < 0.01 && Math.abs(spy.close.level - 777.88) < 0.01, 'SPY prior-day matches known 8/13 raw exactly');
} else { console.log('  (skipped SPY-exact-8/13 check — prior day has rolled past 8/13)'); }

console.log(fail ? `\n═══ ${fail} FAILED, ${pass} passed ═══` : `\n═══ ${pass} passed, 0 failed ═══`);
process.exit(fail ? 1 : 0);
