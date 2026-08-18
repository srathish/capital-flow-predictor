// moves_hist.mjs — the RIGOROUS test: pull GEX/VEX structure from BEFORE the move (historical Skylit
// replay), find the king node + vanna magnet THEN, and check if price subsequently moved toward it.
// Distinguishes "king node PREDICTED the move" from "king node forms at current price" (coincident).
import { loadEnvKeysFrom, resolveFromRoot, log } from '../lib/util.mjs';
loadEnvKeysFrom(resolveFromRoot('../../.env'), ['UNUSUAL_WHALES_API_KEY']);
const { GexProvider } = await import('../providers/gex-skylit.mjs');
const { FlowProvider } = await import('../providers/flow-uw.mjs');
const gex = new GexProvider({ maxStrikes: 150, maxExpirations: 12 });
const flow = new FlowProvider();
try { await gex.init(); } catch (e) { console.log('AUTH-FAIL', e.message); process.exit(2); }

const M = (x) => Math.round(x / 1e6 * 100) / 100;
const pct = (k, s) => Math.round((k - s) / s * 1000) / 10;
const PAST = process.argv.find((a) => /^\d{4}-\d\d-\d\d$/.test(a)) || '2026-08-03';
const NAMES = process.argv.slice(2).filter((a) => !/^\d{4}-/.test(a));
const LIST = NAMES.length ? NAMES : ['PLTR', 'MU', 'WDC', 'DRAM', 'IONQ', 'MRVL', 'GDX', 'MARA'];

let hits = 0, tot = 0;
for (const t of LIST) {
  try {
    const then = await gex.getProfile(t, { date: PAST });
    const now = await gex.getProfile(t);
    if (!then || !now) { log(`${t}: missing structure`); continue; }
    const kingThen = then.strikes.slice().sort((a, b) => Math.abs(b.gexAgg) - Math.abs(a.gexAgg))[0];
    const magThen = then.strikes.filter((s) => s.vexAgg > 0 && s.strike > then.spot).sort((a, b) => b.vexAgg - a.vexAgg)[0];
    const oh = await flow.getDailyOHLC(t, { limit: 20 }).catch(() => []);
    const hi = oh.length ? Math.max(...oh.slice(-10).map((x) => x.high)) : now.spot;
    // the bullish "prediction" from the THEN structure = vanna magnet above, else the king if it's above spot
    const target = magThen?.strike ?? (kingThen && kingThen.strike > then.spot ? kingThen.strike : null);
    log(`\n${t}  ${then.asofDate || PAST}: spot ${then.spot.toFixed(2)}  →  now ${now.spot.toFixed(2)} (${pct(now.spot, then.spot) >= 0 ? '+' : ''}${pct(now.spot, then.spot)}%) · 10d-high ${hi.toFixed(2)}`);
    log(`   KING then:  ${kingThen ? kingThen.strike + ' ' + (kingThen.gexAgg >= 0 ? '+' : '') + M(kingThen.gexAgg) + 'M (' + (pct(kingThen.strike, then.spot) >= 0 ? '+' : '') + pct(kingThen.strike, then.spot) + '% from then-spot)' : '—'}`);
    log(`   VEX magnet then above spot: ${magThen ? magThen.strike + ' +' + M(magThen.vexAgg) + 'M (+' + pct(magThen.strike, then.spot) + '%)' : '— none above spot'}`);
    if (target) {
      tot++;
      const reached = hi >= target * 0.995;
      if (reached) hits++;
      log(`   ⟹ predicted up-target ${target} (+${pct(target, then.spot)}% from then): ${reached ? 'REACHED ✓' : 'not reached ✗'}  (price ran to ${hi.toFixed(2)}, now ${pct(now.spot, target) >= 0 ? '+' : ''}${pct(now.spot, target)}% vs target)`);
    } else {
      log(`   ⟹ NO bullish magnet above then-spot → structure did NOT predict an up-move here`);
    }
  } catch (e) { if (e.message === 'AUTH') { log('AUTH died'); break; } log(`${t}: ${e.message}`); }
}
log(`\n═══ PRE-MOVE structure predicted the up-target in ${hits}/${tot} names that had a bullish magnet above spot on ${PAST} ═══`);
