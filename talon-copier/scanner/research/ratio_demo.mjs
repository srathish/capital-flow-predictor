// ratio_demo.mjs — "what's so hard about making UW look like Skylit?" If it were just SCALE, the ratio
// Skylit/UW would be the SAME constant at every strike (multiply UW by it, done). Show that it isn't.
import { loadEnvKeysFrom, resolveFromRoot, fetchJson } from '../lib/util.mjs';
loadEnvKeysFrom(resolveFromRoot('../../.env'), ['UNUSUAL_WHALES_API_KEY']);
import { GexProvider } from '../providers/gex-skylit.mjs';
const KEY = process.env.UNUSUAL_WHALES_API_KEY;
const T = (process.argv[2] || 'SPY').toUpperCase();
const sk = await new GexProvider().getProfile(T);
const spot = sk.spot;
const skM = new Map(sk.strikes.map((s) => [s.strike, s.gexAgg]));
const uwj = await fetchJson(`https://api.unusualwhales.com/api/stock/${T}/greek-exposure/strike`, { headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json' } });
const uwM = new Map(((uwj.data || uwj.result) || []).map((r) => [+r.strike, (+r.call_gex || 0) + (+r.put_gex || 0)]));
const ks = [...skM.keys()].filter((k) => uwM.has(k) && Math.abs(k - spot) / spot <= 0.02).sort((a, b) => a - b);
console.log(`${T} spot ${spot} — to "scale UW into Skylit" you'd multiply UW by (Skylit/UW). If that number is constant, it's easy:\n`);
console.log(`strike |    Skylit gex |      UW gex |  Skylit/UW ratio`);
let flips = 0;
for (const k of ks) {
  const s = skM.get(k), u = uwM.get(k);
  const ratio = u !== 0 ? s / u : NaN;
  const flip = Math.sign(s) !== Math.sign(u) ? '  ← SIGN FLIP (opposite opinion!)' : '';
  if (flip) flips++;
  console.log(`${String(k).padStart(6)} | ${s.toFixed(0).padStart(13)} | ${u.toFixed(0).padStart(11)} | ${(ratio).toFixed(0).padStart(8)}${flip}`);
}
const ratios = ks.map((k) => skM.get(k) / uwM.get(k)).filter((x) => isFinite(x));
console.log(`\nratio range: ${Math.min(...ratios).toFixed(0)} to ${Math.max(...ratios).toFixed(0)}  ·  sign-flips: ${flips}/${ks.length} strikes`);
console.log(`→ a single "multiply UW by X" can't exist: X would have to be different (and sometimes negative) at every strike.`);
