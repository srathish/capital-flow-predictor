// validate_uw_read.mjs — does the UW-native provider produce the same STRUCTURAL read as Skylit?
import { loadEnvKeysFrom, resolveFromRoot } from '../lib/util.mjs';
loadEnvKeysFrom(resolveFromRoot('../../.env'), ['UNUSUAL_WHALES_API_KEY']);
import { GexProvider } from '../providers/gex-skylit.mjs';
import { GexProviderUW } from '../providers/gex-uw.mjs';

const TICKERS = (process.argv.slice(2).length ? process.argv.slice(2) : ['GOOGL', 'SPY', 'TSLA', 'AMD']).map((t) => t.toUpperCase());

function read(profile, exp) {
  const spot = profile.spot;
  const use = exp && profile.expirations.includes(exp);
  const nodes = profile.strikes.map((s) => ({ k: s.strike, g: use ? (s.perExpiry?.[exp] || 0) : s.gexAgg, v: use ? (s.perExpiryVanna?.[exp] || 0) : s.vexAgg }))
    .filter((n) => (n.g || n.v) && Math.abs(n.k - spot) / spot <= 0.15);
  const king = nodes.slice().sort((a, b) => Math.abs(b.g) - Math.abs(a.g))[0] || null;
  const floor = nodes.filter((n) => n.k < spot && n.g > 0).sort((a, b) => b.g - a.g)[0] || null;
  const ceiling = nodes.filter((n) => n.k > spot && n.g > 0).sort((a, b) => b.g - a.g)[0] || null;
  const barn = nodes.slice().sort((a, b) => a.g - b.g)[0];
  const barney = barn && barn.g < 0 ? barn : null;
  const net = nodes.reduce((a, n) => a + n.g, 0), totAbs = nodes.reduce((a, n) => a + Math.abs(n.g), 0) || 1;
  return { used: use, king, floor, ceiling, barney, regime: net / totAbs };
}

const skg = new GexProvider(), uwg = new GexProviderUW();
for (const T of TICKERS) {
  const [sk, uw] = await Promise.all([skg.getProfile(T).catch(() => null), uwg.getProfile(T).catch(() => null)]);
  if (!sk || !uw) { console.log(`\n${T}: ${!sk ? 'no Skylit' : ''} ${!uw ? 'no UW' : ''}`); continue; }
  const today = new Date().toISOString().slice(0, 10);
  const exp = sk.expirations.filter((e) => uw.expirations.includes(e)).find((e) => e >= today) || null;
  const spot = sk.spot;
  const pct = (k) => ((k - spot) / spot * 100).toFixed(1);
  const f = (n) => (n ? `${n.k}(${pct(n.k)}%)` : '—');
  console.log(`\n════ ${T} — expiry ${exp || '(aggregate)'} · spot ~${spot.toFixed(2)} ════`);
  for (const [name, prof] of [['SKYLIT', sk], ['UW    ', uw]]) {
    const r = read(prof, exp);
    console.log(`  ${name}  regime ${r.regime >= 0 ? '+' : ''}${r.regime.toFixed(2)}  ·  KING ${f(r.king)}  floor ${f(r.floor)}  ceiling ${f(r.ceiling)}  barney↑ ${f(r.barney)}`);
  }
  const rs = read(sk, exp), ru = read(uw, exp);
  const match = (a, b) => (a && b && a.k === b.k ? '✓' : '✗');
  console.log(`  MATCH   king ${match(rs.king, ru.king)}  floor ${match(rs.floor, ru.floor)}  ceiling ${match(rs.ceiling, ru.ceiling)}  regime-sign ${Math.sign(rs.regime) === Math.sign(ru.regime) ? '✓' : '✗'}`);
}
