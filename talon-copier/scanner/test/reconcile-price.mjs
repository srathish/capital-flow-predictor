// reconcile-price.mjs — why do Skylit spot and UW close disagree? Pull both for MU
// across dates + inspect UW's raw candle fields. Needs ENV_FILE (Skylit) + UW key.
import { loadEnvKeysFrom, resolveFromRoot } from '../lib/util.mjs';
loadEnvKeysFrom(resolveFromRoot('../../.env'), ['UNUSUAL_WHALES_API_KEY']);
const { GexProvider } = await import('../providers/gex-skylit.mjs');
const { FlowProvider } = await import('../providers/flow-uw.mjs');

const gex = new GexProvider({}); await gex.init();
const flow = new FlowProvider();

// Raw UW candle to see ALL fields (adjusted? session? which 'close'?)
const rawUw = await fetch('https://api.unusualwhales.com/api/stock/MU/ohlc/1d?limit=45', { headers: { Authorization: `Bearer ${process.env.UNUSUAL_WHALES_API_KEY}`, Accept: 'application/json' } }).then((r) => r.json());
const rows = Array.isArray(rawUw) ? rawUw : (rawUw.data || []);
const raw731 = rows.find((r) => String(r.date || r.start_time || r.market_time || '').startsWith('2026-07-31'));
console.log('RAW UW candle 7/31 (all fields):');
console.log(JSON.stringify(raw731, null, 1));

const uwOhlc = await flow.getDailyOHLC('MU', { limit: 45 });
console.log('\ndate        Skylit spot | UW close (parsed) | ratio | UW open/high/low');
for (const d of ['2026-07-01', '2026-07-15', '2026-07-24', '2026-07-31', '2026-08-05', '2026-08-07', '2026-08-14']) {
  let sk = null; try { sk = (await gex.getProfile('MU', { date: d }))?.spot; } catch { /* */ }
  const uw = uwOhlc.find((o) => o.date === d);
  const ratio = (sk && uw) ? (sk / uw.close).toFixed(3) : '—';
  console.log(`${d}  ${sk ? sk.toFixed(2).padStart(9) : '   —'} | ${uw ? String(uw.close).padStart(10) : '   —'}        | ${ratio} | ${uw ? `${uw.open}/${uw.high}/${uw.low}` : '—'}`);
}
