// flow_days.mjs — VERIFIABLE dated daily options flow (UW): did call premium build BEFORE the move
// (front-run / tell) or only spike ON the move day (chasing)? Prints net call premium + ask-side% by date.
import { loadEnvKeysFrom, resolveFromRoot, log } from '../lib/util.mjs';
loadEnvKeysFrom(resolveFromRoot('../../.env'), ['UNUSUAL_WHALES_API_KEY']);
const { FlowProvider } = await import('../providers/flow-uw.mjs');
const flow = new FlowProvider();
const PM = (x) => x == null ? '     —' : `${x >= 0 ? '+' : '-'}$${(Math.abs(x) >= 1e6 ? (Math.abs(x) / 1e6).toFixed(1) + 'M' : Math.round(Math.abs(x) / 1e3) + 'k').padStart(6)}`;
for (const t of process.argv.slice(2)) {
  const s = await flow.getFlowSeries(t, 12).catch(() => []);
  log(`\n${t}  (daily net CALL premium · call ask-side% · call vol)`);
  for (const r of s.slice(-7)) {
    const den = (r.call_ask || 0) + (r.call_bid || 0);
    const ask = den ? Math.round((r.call_ask / den) * 100) : null;
    log(`  ${r.date}  netCall ${PM(r.net_call_premium)}   ask ${ask != null ? String(ask).padStart(3) + '%' : '  —'}   vol ${String(r.call_volume ?? '—').padStart(8)}`);
  }
}
