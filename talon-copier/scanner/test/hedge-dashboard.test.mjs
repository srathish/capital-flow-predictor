// hedge-dashboard.test.mjs — throttle logic (pure, no network).
import { classifyHedge, hedgeThrottle } from '../lib/hedge-dashboard.mjs';

let pass = 0, fail = 0;
const eq = (n, g, w) => { if (g === w) pass++; else { fail++; console.log(`  ✗ ${n}: got ${g} want ${w}`); } };
const km = (d) => ({ gamma: { king_migration: { direction: d } } });

// index: bullish structure = risk-ON
eq('index up_bullish → risk-on', classifyHedge(km('up_bullish'), 'index').risk, 'on');
eq('index down_bearish → risk-off', classifyHedge(km('down_bearish'), 'index').risk, 'off');
eq('index flat → neutral', classifyHedge(km('flat'), 'index').risk, 'neutral');
// inverse/vol (SQQQ/VXX): bullish structure = risk-OFF (hedges getting bid)
eq('inverse up_bullish → risk-off', classifyHedge(km('up_bullish'), 'inverse').risk, 'off');
eq('inverse down_bearish → risk-on', classifyHedge(km('down_bearish'), 'inverse').risk, 'on');

// throttle: RED if >=3 of 6 off, YELLOW if >=2, else GREEN
eq('all on → GREEN', hedgeThrottle([{ risk: 'on' }, { risk: 'on' }, { risk: 'on' }, { risk: 'on' }, { risk: 'on' }, { risk: 'on' }]).throttle, 'GREEN');
eq('1 off → GREEN', hedgeThrottle([{ risk: 'off' }, { risk: 'on' }, { risk: 'on' }, { risk: 'on' }, { risk: 'on' }, { risk: 'neutral' }]).throttle, 'GREEN');
eq('2 off → YELLOW', hedgeThrottle([{ risk: 'off' }, { risk: 'off' }, { risk: 'on' }, { risk: 'on' }, { risk: 'on' }, { risk: 'neutral' }]).throttle, 'YELLOW');
eq('3 off → RED', hedgeThrottle([{ risk: 'off' }, { risk: 'off' }, { risk: 'off' }, { risk: 'on' }, { risk: 'on' }, { risk: 'neutral' }]).throttle, 'RED');

console.log(`\nhedge-dashboard.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
