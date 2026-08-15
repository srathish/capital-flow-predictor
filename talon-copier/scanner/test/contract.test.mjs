// contract.test.mjs — deterministic convex contract construction (pure, no network).
import { buildConvexContract } from '../lib/contract.mjs';

let pass = 0, fail = 0;
const eq = (n, g, w) => { if (JSON.stringify(g) === JSON.stringify(w)) pass++; else { fail++; console.log(`  ✗ ${n}: got ${JSON.stringify(g)} want ${JSON.stringify(w)}`); } };

const structure = {
  spot: 1000, expirations: ['2026-08-21', '2026-09-18', '2026-10-16'], // DTE from 8/14: 5, 24, 45
  gamma: { nodes: [{ strike: 1050 }, { strike: 1100 }, { strike: 1200 }, { strike: 950 }] },
  vanna: { nodes: [{ strike: 1150 }, { strike: 1300 }] },
};
const RUN = '2026-08-14';
const squeezeLong = { direction: 'long', setup_type: 'squeeze', contract: { type: 'call', expiry: '2026-09-18', strike: 1050, selection_note: 'llm' } };
const cfg = { enabled: true, squeeze_style: 'lotto', lotto_otm_pct: 0.15, weekly_max_dte: 10 };

// enabled squeeze → near weekly + far-OTM node strike (~15% OTM = 1150 nearest node)
const c = buildConvexContract(squeezeLong, structure, RUN, cfg);
eq('convex: near weekly (8/21, dte 5 <= 10)', c.expiry, '2026-08-21');
eq('convex: far-OTM strike ~15% → node 1150', c.strike, 1150);
eq('convex: call for a long', c.type, 'call');

// disabled → keep the LLM's contract (no behavior change)
eq('disabled keeps LLM contract', buildConvexContract(squeezeLong, structure, RUN, { enabled: false }).strike, 1050);
// non-squeeze → keep the LLM's contract (only squeezes get convexified)
eq('non-squeeze keeps LLM contract', buildConvexContract({ ...squeezeLong, setup_type: 'flow_through' }, structure, RUN, cfg).strike, 1050);
// no_trade → null
eq('no_trade → null', buildConvexContract({ direction: 'no_trade', contract: null }, structure, RUN, cfg), null);
// short squeeze → put, far-OTM below
const c2 = buildConvexContract({ direction: 'short', setup_type: 'squeeze', contract: { type: 'put', expiry: '2026-09-18', strike: 950 } }, structure, RUN, cfg);
eq('convex short: put', c2.type, 'put');
eq('convex short: OTM strike below (nearest node to 850 → 950)', c2.strike, 950);

console.log(`\ncontract.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
