// ionq_workup.mjs — UW options read on IONQ to validate Talon's bullish GEX-support call + pick a Sept-23 contract.
import '../../../apps/gex/scripts/_env-bootstrap.js';
const K = process.env.UNUSUAL_WHALES_API_KEY;
const H = { headers: { Authorization: `Bearer ${K}`, Accept: 'application/json' } };
const api = (p) => fetch('https://api.unusualwhales.com/api/' + p, H).then((r) => r.json()).catch(() => null);
const T = 'IONQ';
const num = (x) => (x == null || x === '' ? null : +x);

// price / state
const oh = await api(`stock/${T}/ohlc/1d?limit=2`);
const bars = (Array.isArray(oh) ? oh : (oh && oh.data)) || [];
const last = bars[bars.length - 1] || {};
console.log(`=== IONQ ===`);
console.log(`RTH close ${last.date}: $${last.close}  (O ${last.open} H ${last.high} L ${last.low}) vol ${last.volume}`);
const st = await api(`stock/${T}/stock-state`);
const s = (st && (st.data || st)) || {};
if (s.last || s.close || s.price) console.log(`stock-state:`, JSON.stringify(s).slice(0, 260));

// IV rank
const iv = await api(`stock/${T}/iv-rank`);
const ivd = (iv && (iv.data || iv)) || {};
console.log(`IV rank:`, JSON.stringify(Array.isArray(ivd) ? ivd[ivd.length - 1] : ivd).slice(0, 160));

// options volume (call/put)
const ov = await api(`stock/${T}/options-volume`);
const ovd = (ov && (ov.data || ov)) || {};
const ovr = Array.isArray(ovd) ? ovd[ovd.length - 1] : ovd;
console.log(`options-volume:`, JSON.stringify(ovr).slice(0, 300));

// GEX by strike (confirm $45 wall / $38-39 support)
const gx = await api(`stock/${T}/greek-exposure/strike`);
const gr = ((gx && (gx.data || gx.result)) || []).map((r) => ({ k: +r.strike, g: (+r.call_gex || 0) + (+r.put_gex || 0) })).filter((r) => isFinite(r.k));
gr.sort((a, b) => Math.abs(b.g) - Math.abs(a.g));
console.log(`\nTop GEX strikes (|gamma|):`);
gr.slice(0, 8).sort((a,b)=>a.k-b.k).forEach((r) => console.log(`  $${r.k}  ${r.g >= 0 ? '+' : ''}${(r.g / 1e6).toFixed(2)}M ${r.g >= 0 ? '(long γ / pin-support)' : '(short γ / accel)'}`));

// max pain
const mp = await api(`stock/${T}/max-pain`);
const mpd = (mp && (mp.data || mp)) || {};
console.log(`\nmax-pain:`, JSON.stringify(Array.isArray(mpd) ? mpd.slice(0, 3) : mpd).slice(0, 240));

// recent flow alerts (bullish opening?)
const fa = await api(`stock/${T}/flow-alerts?limit=15`);
const fad = (fa && (fa.data || fa)) || [];
console.log(`\nRecent flow alerts (${fad.length}):`);
for (const a of (Array.isArray(fad) ? fad : []).slice(0, 12)) {
  console.log(`  ${a.type || a.rule_name || '?'} ${a.option_chain || a.strike || ''} ${a.expiry || ''} ${a.side || ''} $${a.total_premium || a.premium || '?'} ${a.volume ? 'vol' + a.volume : ''} ${a.open_interest ? 'oi' + a.open_interest : ''}`);
}
