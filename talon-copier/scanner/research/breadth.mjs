// breadth.mjs — quantify sector breadth: actual Aug-17 moves of the full peer set per theme (UW prices).
// Tests "was it a THEME (whole complex up) or a fluke (one name)?" as a measured fact.
import { loadEnvKeysFrom, resolveFromRoot, log } from '../lib/util.mjs';
loadEnvKeysFrom(resolveFromRoot('../../.env'), ['UNUSUAL_WHALES_API_KEY']);
const { FlowProvider } = await import('../providers/flow-uw.mjs');
const flow = new FlowProvider();
const SETS = {
  'MEMORY': ['MU', 'WDC', 'SNDK', 'STX', 'DRAM'],
  'AI-NETWORKING/SEMI': ['MRVL', 'CRDO', 'CIEN', 'ANET', 'AVGO', 'NVDA', 'SMH'],
  'CRYPTO MINERS': ['MARA', 'RIOT', 'CLSK', 'BMNR', 'IREN', 'WULF'],
};
for (const [name, list] of Object.entries(SETS)) {
  log(`\n── ${name} — Monday 8/17 move ──`);
  const moves = [];
  for (const t of list) {
    const oh = await flow.getDailyOHLC(t, { limit: 4 }).catch(() => []);
    if (oh.length < 2) { log(`  ${t.padEnd(6)} no data`); continue; }
    const c = oh.map((x) => x.close);
    const mv = (c[c.length - 1] / c[c.length - 2] - 1) * 100;
    moves.push(mv);
    log(`  ${t.padEnd(6)} ${(mv >= 0 ? '+' : '') + mv.toFixed(1)}%  (close ${c[c.length - 1].toFixed(2)}, ${oh[oh.length - 1].date})`);
  }
  if (moves.length) {
    const up = moves.filter((m) => m > 0).length;
    log(`  → ${up}/${moves.length} up · avg ${(moves.reduce((a, b) => a + b, 0) / moves.length).toFixed(1)}%`);
  }
}
