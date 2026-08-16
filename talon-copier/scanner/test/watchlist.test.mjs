// watchlist.test.mjs — render + grouping/sorting logic (pure, no network).
import { renderWatchlist } from '../lib/watchlist.mjs';

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log(`  ✗ ${n}`); } };
const has = (n, s, sub) => ok(n, s.includes(sub));

const wl = {
  as_of: '2026-08-16',
  dashboard: {
    throttle: { throttle: 'GREEN', on: 3, off: 0, neutral: 3, note: 'bullish backdrop supports the single-name map' },
    components: [
      { ticker: 'QQQ', role: 'index', label: 'growth', spot: 731, king_migration: 'up_bullish', risk: 'on' },
      { ticker: 'VXX', role: 'inverse', label: 'volatility', spot: 19.36, king_migration: 'flat', risk: 'neutral' },
    ],
  },
  breadth: { bullish: 2, bearish: 1, watch: 1, stand_aside: 1, no_data: 0 },
  rows: [
    { ticker: 'NBIS', direction: 'long', clean: true, spot: 275, king_migration: 'up_bullish', setup_type: 'squeeze', confidence: 5, thesis: 'neg-gamma king building', levels: { ote: 260, invalidation: 245, first_target: 300, swing_targets: [320, 350], rr: 2.67 } },
    { ticker: 'MU', direction: 'long', clean: true, spot: 972, king_migration: 'up_bullish', setup_type: 'flow_through', confidence: 3, thesis: 'wall above', levels: { ote: 960, invalidation: 940, first_target: 995, swing_targets: [], rr: 1.75 } },
    { ticker: 'MARA', direction: 'short', clean: true, spot: 18, king_migration: 'down_bearish', setup_type: 'reversal', confidence: 4, thesis: 'king falling', levels: { ote: 19, invalidation: 20, first_target: 16, swing_targets: [], rr: 3 } },
    { ticker: 'AVGO', direction: 'watch_long', clean: false, spot: 300, king_migration: 'up_bullish', note: 'no clean plan', levels: { ote: 290, invalidation: 280, first_target: 310, swing_targets: [], rr: 2 } },
    { ticker: 'TSM', direction: 'no_trade', clean: false, spot: 200, king_migration: 'flat', levels: {} },
  ],
};

const md = renderWatchlist(wl);
has('has title', md, 'Talon Watchlist — 2026-08-16');
has('shows throttle GREEN', md, 'Market throttle: **GREEN**');
has('lists a hedge component', md, 'QQQ');
has('breadth pulse line', md, '🟢 2 bullish · 🔴 1 bearish');
has('bullish section header w/ count', md, '🟢 Bullish setups (2)');
has('bearish section header', md, '🔴 Bearish setups (1)');
has('watch section', md, '🟡 Watch');
has('stand-aside section', md, '⚪ Stand-aside');
has('NBIS OTE level present', md, 'OTE **260**');
has('NBIS T1 present', md, 'T1 **300**');
has('green footer directive', md, 'GREEN throttle');
// conviction sort: NBIS (5) must appear before MU (3) in the bullish block
ok('bullish sorted by conviction (NBIS before MU)', md.indexOf('NBIS') < md.indexOf('**MU**'));

console.log(`\nwatchlist.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
