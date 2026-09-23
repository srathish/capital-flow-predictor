// talon_reads_uw.mjs — validate Talon's 6 actionable/watch reads against LIVE UW data for a Sept-23 decision.
// Talon's card is a 16:00 snapshot; check where spot is NOW vs its OTE/invalidation/target, + flow/GEX/IV.
import '../../../apps/gex/scripts/_env-bootstrap.js';
const K = process.env.UNUSUAL_WHALES_API_KEY;
const H = { headers: { Authorization: `Bearer ${K}`, Accept: 'application/json' } };
const api = (p) => fetch('https://api.unusualwhales.com/api/' + p, H).then((r) => r.json()).catch(() => null);
const n = (x) => (x == null || x === '' ? null : +x);

// Talon reads (from the cards): dir, entry(OTE), invalidation, primary target
const READS = [
  { t: 'IONQ', dir: 'bull', snap: 40.75, ote: 39, inval: 38, target: 45, kind: 'GEX Support', status: 'Actionable' },
  { t: 'TSM',  dir: 'bull', snap: 452.03, ote: 450, inval: 445, target: 475, kind: 'GEX Support', status: 'Actionable' },
  { t: 'NBIS', dir: 'bull', snap: 236.31, ote: 230, inval: 225, target: 250, kind: 'VEX Magnet', status: 'Actionable' },
  { t: 'HOOD', dir: 'bear', snap: 124.23, ote: 129, inval: 131, target: 118, kind: 'GEX Ceiling', status: 'Watchlist' },
  { t: 'SNDK', dir: 'bear', snap: 1886.31, ote: 2000, inval: 2030, target: 1800, kind: 'Bear VEX Rally', status: 'OTE Watch' },
  { t: 'SKHY', dir: 'bear', snap: 195.30, ote: 212.5, inval: 217.5, target: 185, kind: 'Bear VEX Rally', status: 'OTE Watch' },
];

for (const r of READS) {
  const T = r.t;
  const st = await api(`stock/${T}/stock-state`);
  const s = (st && (st.data || st)) || {};
  const px = n(s.close) ?? n(s.last) ?? n(s.price);
  const pm = s.market_time || '';
  const prev = n(s.prev_close);
  const chg = px != null && prev ? ((px - prev) / prev * 100) : null;

  const ov = await api(`stock/${T}/options-volume`);
  const o = ((ov && (ov.data || ov)) || {}); const ovr = Array.isArray(o) ? o[o.length - 1] : o;
  const cv = n(ovr?.call_volume), pv = n(ovr?.put_volume);
  const cAsk = n(ovr?.call_volume_ask_side), cBid = n(ovr?.call_volume_bid_side);
  const ncp = n(ovr?.net_call_premium), npp = n(ovr?.net_put_premium);

  const ivj = await api(`stock/${T}/iv-rank`);
  const iv = ((ivj && (ivj.data || ivj)) || {}); const ivr = Array.isArray(iv) ? iv[iv.length - 1] : iv;

  const mpj = await api(`stock/${T}/max-pain`);
  const mp = ((mpj && (mpj.data || mpj)) || []); const mp0 = Array.isArray(mp) ? mp[0] : mp;

  const gx = await api(`stock/${T}/greek-exposure/strike`);
  const gr = ((gx && (gx.data || gx.result)) || []).map((x) => ({ k: +x.strike, g: (+x.call_gex || 0) + (+x.put_gex || 0) })).filter((x) => isFinite(x.k) && px && Math.abs(x.k - px) / px < 0.12);
  gr.sort((a, b) => Math.abs(b.g) - Math.abs(a.g));
  const walls = gr.slice(0, 4).sort((a, b) => a.k - b.k).map((x) => `${x.k}${x.g >= 0 ? '+' : ''}${(x.g / 1e6).toFixed(1)}M`).join(' ');

  // where is spot vs the plan?
  const distOte = px != null ? ((px - r.ote) / r.ote * 100) : null;
  let verdict;
  if (r.dir === 'bull') {
    if (px >= r.target) verdict = `⛔ ALREADY HIT TARGET ($${r.target}) — setup done, chasing`;
    else if (px <= r.inval) verdict = `⛔ BELOW INVALIDATION ($${r.inval}) — dead`;
    else if (px <= r.ote * 1.01) verdict = `🟢 AT/NEAR ENTRY — live`;
    else verdict = `🟡 above entry by ${distOte.toFixed(1)}% — wait for pullback to $${r.ote}`;
  } else {
    if (px <= r.target) verdict = `⛔ ALREADY HIT TARGET ($${r.target}) — setup done`;
    else if (px >= r.inval) verdict = `⛔ ABOVE INVALIDATION ($${r.inval}) — dead`;
    else if (px >= r.ote * 0.99) verdict = `🟢 AT/NEAR SHORT ENTRY — live`;
    else verdict = `🟡 below short entry by ${Math.abs(distOte).toFixed(1)}% — wait for rally to $${r.ote}`;
  }

  console.log(`\n━━━ ${T}  (${r.dir.toUpperCase()} · ${r.kind} · Talon:${r.status}) ━━━`);
  console.log(`  Talon snap $${r.snap} → NOW $${px} (${chg != null ? (chg >= 0 ? '+' : '') + chg.toFixed(1) + '%' : '?'}, ${pm})`);
  console.log(`  plan: entry $${r.ote} · invalidation $${r.inval} · target $${r.target}`);
  console.log(`  ${verdict}`);
  console.log(`  flow: calls ${cv}/puts ${pv} (${cv && pv ? (cv / pv).toFixed(1) : '?'}x) · call ask/bid ${cAsk}/${cBid} · net call prem $${ncp != null ? (ncp / 1e6).toFixed(2) + 'M' : '?'}`);
  console.log(`  IV: ${ivr?.volatility ? (ivr.volatility * 100).toFixed(0) + '%' : '?'} · IVrank1y ${ivr?.iv_rank_1y ? (+ivr.iv_rank_1y).toFixed(1) + '%ile' : '?'} · maxpain(${mp0?.expiry || '?'}) $${mp0?.max_pain ?? '?'}`);
  console.log(`  GEX walls near spot: ${walls || '(none)'}`);
}
