// DARK-POOL VALUE AREA (the layer that caught Falcon's 07-29 top-tick). Pull off-exchange (dark-pool)
// volume by price for SPY/QQQ, compute POC (point of control = biggest shelf) + VAH/VAL (value area = the
// price band holding ~70% of DP volume), map to SPX (×10). Signal: price stretched BEYOND value = reversion
// fade (short above VAH, long below VAL). This is what a short "top-ticked" — fading extension above value.
import '../apps/gex/scripts/_env-bootstrap.js';
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
const map2spx = { SPY: 10, QQQ: null };   // SPY×10 ≈ SPX; QQQ shown for context only

async function levels(tkr) {
  const r = await fetch(`https://api.unusualwhales.com/api/stock/${tkr}/stock-volume-price-levels`, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!r || !r.ok) return null;
  const rows = ((await r.json())?.data || []).map(x => ({ price: +x.price, off: +x.off_vol || 0, lit: +x.lit_vol || 0 })).filter(x => x.off > 0);
  if (!rows.length) return null;
  // bucket by 1.0 price
  const buck = {}; for (const x of rows) { const b = Math.round(x.price); buck[b] = (buck[b] || 0) + x.off; }
  const arr = Object.entries(buck).map(([p, v]) => ({ p: +p, v })).sort((a, b) => b.v - a.v);
  const total = arr.reduce((t, x) => t + x.v, 0);
  const poc = arr[0].p;
  // value area = expand from POC until ~70% of volume covered
  const byPrice = [...arr].sort((a, b) => a.p - b.p); const pocI = byPrice.findIndex(x => x.p === poc);
  let lo = pocI, hi = pocI, acc = byPrice[pocI].v;
  while (acc < total * 0.70 && (lo > 0 || hi < byPrice.length - 1)) {
    const up = hi < byPrice.length - 1 ? byPrice[hi + 1].v : -1, dn = lo > 0 ? byPrice[lo - 1].v : -1;
    if (up >= dn) { hi++; acc += Math.max(up, 0); } else { lo--; acc += Math.max(dn, 0); }
  }
  return { poc, vah: byPrice[hi].p, val: byPrice[lo].p, top3: arr.slice(0, 3), cur: rows[rows.length - 1]?.price };
}

for (const tkr of ['SPY', 'QQQ']) {
  const L = await levels(tkr); if (!L) { console.log(`${tkr}: no DP data`); continue; }
  const m = map2spx[tkr];
  const sx = (p) => m ? ` (SPX ${(p * m).toFixed(0)})` : '';
  console.log(`\n=== ${tkr} DARK-POOL VALUE AREA (today) ===`);
  console.log(`  POC (biggest shelf): ${L.poc}${sx(L.poc)}   VAH: ${L.vah}${sx(L.vah)}   VAL: ${L.val}${sx(L.val)}`);
  console.log(`  top shelves: ${L.top3.map(x => `${x.p}(${(x.v / 1e6).toFixed(1)}M)`).join('  ')}`);
}
// live signal for SPY vs current price
const spy = await levels('SPY');
const q = await fetch(`https://api.unusualwhales.com/api/stock/SPY/ohlc/1m?date=${new Date().toISOString().slice(0, 10)}`, { headers: { Authorization: `Bearer ${KEY}` } }).then(x => x.ok ? x.json() : null).catch(() => null);
const cur = (q?.data || []).map(x => +x.close).filter(Number.isFinite).pop();
if (spy && cur) {
  const above = cur - spy.vah, below = spy.val - cur;
  console.log(`\n=== LIVE DP SIGNAL (SPY ${cur.toFixed(2)} / SPX ~${(cur * 10).toFixed(0)}) ===`);
  console.log(above > 0.5 ? `  STRETCHED ${(above * 10).toFixed(0)}pt ABOVE value-area-high (${spy.vah}) → reversion SHORT bias (fade to POC ${spy.poc} = SPX ${(spy.poc * 10).toFixed(0)})`
    : below > 0.5 ? `  STRETCHED ${(below * 10).toFixed(0)}pt BELOW value-area-low (${spy.val}) → reversion LONG bias (revert to POC ${spy.poc})`
      : `  INSIDE value area (${spy.val}–${spy.vah}) → no DP extension edge (in balance)`);
}
