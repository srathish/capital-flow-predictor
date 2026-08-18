// prices.mjs — live-price a list of OCC option symbols (UW).
import { loadEnvKeysFrom, resolveFromRoot, log } from '../lib/util.mjs';
loadEnvKeysFrom(resolveFromRoot('../../.env'), ['UNUSUAL_WHALES_API_KEY']);
const { FlowProvider } = await import('../providers/flow-uw.mjs');
const flow = new FlowProvider();
for (const occ of process.argv.slice(2)) {
  const h = await flow.getOptionHistory(occ).catch(() => []);
  const last = h.length ? h[h.length - 1] : null;
  const px = last && (last.mid || last.last);
  log(`${occ.padEnd(22)} ${px ? '~$' + (last.mid || last.last).toFixed(2) + '  IV ' + (last.iv ? (last.iv * 100).toFixed(0) + '%' : '—') + '  OI ' + (last.oi ?? '—') : 'no live quote'}`);
}
