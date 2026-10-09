#!/usr/bin/env node
// Stock-finding factory registry (shadow/DESIGN_stock_factory.md): every study = one feature known at the rebalance date →
// one forward outcome across stocks, with a predicted sign. Written BEFORE the engines run.
//   LONG  (monthly, 2012 → 2026, SEC + prices + insiders + guidance + themes): outcomes M1 / M3 / M6 = 1 / 3 / 6-month return
//         vs the eligible universe, MV = in the top 10% of 6-month returns ("big mover").
//   SHORT (weekly, Nov 2023 → Oct 2026, 300 stocks, UW options greeks + prices): W1 / W2 / W4 = 1 / 2 / 4-week return vs the
//         300, WV = in the top 10% of 4-week returns.
// Columns: [id, definition, mechanism, return sign, mover sign]   ('?' = two-sided; seen = already used in an earlier design)
import fs from 'node:fs';
import path from 'node:path';

const SH = decodeURIComponent(new URL('.', import.meta.url).pathname);
const LONG = [
  // growth / quality (point-in-time SEC, first-filed)
  ['L01', 'revenue growth YoY (latest quarter)', 'demand', '+', '+'], ['L02', 'revenue growth acceleration (YoY now − YoY last quarter)', 'inflection', '+', '+'],
  ['L03', 'gross margin (latest quarter)', 'pricing power', '+', '?'], ['L04', 'gross margin change YoY', 'pricing power rising', '+', '+'],
  ['L05', 'v5 bottleneck score (mean pct-rank of L01, L02, L04)', 'bottleneck (seen)', '+', '+'], ['L06', 'revenue growth QoQ', 'near-term demand', '+', '+'],
  ['L07', '2-year revenue growth (latest vs 8 quarters earlier)', 'durable growth', '+', '+'], ['L08', 'stability of YoY growth (−s.d. over last 6 quarters)', 'quality growth', '+', '-'],
  ['L09', 'operating margin', 'profitability', '+', '?'], ['L10', 'operating margin change YoY', 'operating leverage', '+', '+'],
  ['L11', 'operating income growth YoY (sign-safe)', 'profit growth', '+', '+'], ['L12', 'net income positive (1/0)', 'profitable', '+', '-'],
  ['L13', 'net margin change YoY', 'margin trend', '+', '+'], ['L14', 'growth surprise vs own trend (YoY now − mean YoY of prior 4 quarters)', 'news', '+', '+'],
  ['L15', 'gross margin negative a year ago (1/0)', 'losing less ≠ pricing power (seen rule)', '-', '?'], ['L16', 'gross margin recovering from negative (1/0)', 'turnaround', '-', '+'],
  // investment / balance sheet
  ['L17', 'capex growth YoY', 'over-investment', '-', '?'], ['L18', 'capex ÷ revenue (TTM)', 'capital intensity', '-', '?'],
  ['L19', 'inventory growth − revenue growth (YoY)', 'demand slowing / build-up', '-', '-'], ['L20', 'backlog (RPO) growth YoY', 'future revenue', '+', '+'],
  ['L21', 'deferred revenue growth YoY', 'prepaid demand', '+', '+'], ['L22', 'R&D ÷ revenue', 'innovation', '+', '+'], ['L23', 'R&D growth YoY', 'innovation push', '+', '+'],
  ['L24', 'share count change over 1 year (split-adjusted)', 'dilution', '-', '?'], ['L25', 'buyback: share count down > 2% in a year (1/0)', 'capital return', '+', '-'],
  // valuation (split-adjusted market cap)
  ['L26', 'price ÷ sales (TTM)', 'expensive → lower returns', '-', '?'], ['L27', 'earnings yield (TTM net income ÷ market cap)', 'value', '+', '-'],
  ['L28', 'P/S ÷ industry median P/S', 'relative value', '-', '?'], ['L29', 'P/S change over 1 year', 'multiple expansion', '?', '?'],
  // price / trading
  ['L30', '12-1 month momentum', 'momentum (seen)', '+', '+'], ['L31', '6-1 month momentum', 'momentum', '+', '+'], ['L32', '1-month return', 'short-term reversal', '-', '?'],
  ['L33', 'price ÷ 52-week high', '52-week-high effect', '+', '?'], ['L34', 'above 200-day average (1/0)', 'trend (seen)', '+', '+'], ['L35', '200-day average slope (3 months)', 'trend strength', '+', '+'],
  ['L36', 'realized volatility (3 months)', 'low-volatility anomaly', '-', '+'], ['L37', 'max daily return last month', 'lottery stocks underperform', '-', '+'],
  ['L38', 'beta to SPY (1 year)', 'betting-against-beta', '-', '+'], ['L39', 'dollar volume 3 months ÷ 12 months', 'rising attention', '+', '+'],
  ['L40', 'turnover (dollar volume ÷ market cap)', 'over-trading', '-', '+'], ['L41', 'size (ln market cap)', 'small-cap effect', '-', '-'],
  ['L42', '3-month momentum', 'intermediate momentum', '+', '+'], ['L43', '12-1 momentum minus industry 12-1 momentum', 'stock-specific momentum', '+', '+'], ['L44', 'price ÷ 20-day average − 1', 'stretch', '-', '?'],
  // industry / theme
  ['L45', 'industry (SIC3) 6-month return', 'industry momentum', '+', '+'], ['L46', 'industry median revenue growth', 'industry demand', '+', '+'],
  ['L47', 'share of industry above 200-day average', 'industry breadth', '+', '+'], ['L48', 'best 6-month return among the stock\'s filing concepts', 'theme momentum (E1, seen)', '+', '+'],
  ['L49', 'number of filing concepts with 6-month return in the top quartile', 'theme exposure', '+', '+'], ['L50', 'new concept mentioned in the last 6 months (1/0)', 'new theme', '+', '+'],
  ['L51', 'industry 3-month relative strength rank', 'rotation', '+', '+'],
  // insiders / events
  ['L52', 'insider purchases (count, 90 days)', 'insiders know', '+', '+'], ['L53', 'insider cluster: ≥ 3 distinct buyers in 90 days (1/0)', 'conviction', '+', '+'],
  ['L54', 'insider $ bought ÷ market cap (90 days)', 'insider conviction size', '+', '+'], ['L55', 'guidance raise in last 120 days (1/0)', 'management confidence', '+', '+'],
  ['L56', 'guidance cut in last 120 days (1/0)', 'bad news drift', '-', '-'], ['L57', 'spin-off in last 12 months (1/0)', 'spin-off effect', '+', '+'],
  ['L58', 'days since latest 10-Q/10-K', 'news staleness', '?', '?'], ['L59', 'fresh filing (≤ 30 days) with accelerating revenue (1/0)', 'post-earnings drift', '+', '+'],
  ['L60', 'revenue growth rank change over 3 months', 'improving fundamentals', '+', '+'],
  // commodity link + combinations
  ['L61', 'commodity-linked industry and its commodity in an uptrend (1/0)', 'commodity cycle (E2, seen)', '+', '+'],
  ['L62', 'v5 Model C conditions met (bottleneck top 20% + momentum + above 200-day)', 'growth + trend (seen)', '+', '+'],
  ['L63', 'high gross margin and low P/S (both in better half)', 'quality at a fair price', '+', '?'], ['L64', 'revenue accelerating and industry momentum positive (1/0)', 'theme + inflection', '+', '+'],
  ['L65', 'low volatility and positive 12-1 momentum (1/0)', 'quality momentum', '+', '-'], ['L66', 'revenue growth top 30% and P/S below median (1/0)', 'growth at a reasonable price', '+', '+'],
  ['L67', 'gross margin stability (−s.d. over 6 quarters)', 'durable economics', '+', '-'], ['L68', 'price ÷ 52-week low', 'distance from lows', '?', '?'],
  ['L69', 'earnings yield change over 1 year', 'cheapening vs earnings', '+', '?'], ['L70', 'operating margin positive (1/0)', 'operating profit', '+', '-'],
];
const SHORT = [
  // options positioning (UW greeks per strike at the week's last close; S = raw price)
  ['S01', 'gamma balance Σg / Σ|g|', 'long gamma damps moves', '?', '-'], ['S02', 'gamma balance within ±2%', 'local regime', '?', '-'], ['S03', 'gamma balance within ±5%', 'medium regime', '?', '-'],
  ['S04', 'net gamma negative (1/0)', 'short gamma → bigger moves', '?', '+'], ['S05', 'share of |gamma| below spot', 'support underneath', '+', '?'],
  ['S06', 'king distance (K − S)/S', 'drift toward the biggest strike', '+', '+'], ['S07', '|K − S|/S', 'no pin → room to run', '?', '+'], ['S08', 'king gamma positive (1/0)', 'pinned', '?', '-'],
  ['S09', 'king share of |gamma|', 'concentration pins', '?', '-'], ['S10', 'distance to nearest strong node above', 'room above', '+', '+'], ['S11', 'distance to nearest strong node below', 'room below', '-', '?'],
  ['S12', 'largest positive-gamma strike − S, / S', 'positive magnet', '+', '+'], ['S13', 'call gamma share', 'call-heavy positioning', '?', '+'],
  ['S14', 'total |gamma| ÷ its 8-week mean', 'options interest surging', '?', '+'], ['S15', 'net gamma ÷ 20-day dollar volume', 'hedging vs trading', '?', '-'],
  ['S16', 'S02 z-score vs prior 12 weeks', 'regime vs normal', '?', '-'],
  ['S17', 'vanna balance', 'vanna flows', '?', '?'], ['S18', 'vanna balance within ±2%', 'local vanna', '?', '?'], ['S19', '(vanna above − below) / Σ|vanna|', 'vanna skew', '?', '?'],
  ['S20', 'largest |vanna| strike − S, / S', 'vanna magnet', '+', '+'], ['S21', 'charm balance', 'decay flows', '?', '?'], ['S22', 'charm balance within ±2%', 'local decay', '?', '?'],
  ['S23', 'delta balance Σδ / Σ|δ|', 'net bullish positioning', '+', '+'], ['S24', 'call delta ÷ |put delta|', 'crowded calls (contrarian)', '-', '+'], ['S25', 'delta balance within ±2%', 'local positioning', '?', '?'],
  ['S26', 'delta balance change over 1 week', 'positioning shifting bullish', '+', '+'], ['S27', 'call delta growth over 1 week', 'call buying', '+', '+'], ['S28', 'put delta growth over 1 week', 'put buying / hedging', '-', '?'],
  ['S29', 'S01 change over 1 week', 'gamma shift', '?', '?'], ['S30', 'S02 change over 1 week', 'local gamma shift', '?', '?'], ['S31', 'king strike moved up over 1 week (/ S)', 'escalator', '+', '+'],
  ['S32', 'ln total |gamma| change over 1 week', 'options interest change', '?', '+'], ['S33', 'vanna balance change over 1 week', 'vanna shift', '?', '?'],
  ['S34', 'ln total |delta| change over 1 week', 'positioning growth', '?', '+'], ['S35', 'call delta change over 4 weeks', 'sustained call accumulation', '+', '+'],
  // price / trading
  ['S36', '1-week return', 'weekly reversal', '-', '?'], ['S37', '4-week return', 'short momentum', '?', '?'], ['S38', '12-week return', 'momentum', '+', '+'],
  ['S39', 'price ÷ 20-day average − 1', 'stretch', '-', '?'], ['S40', 'last week dollar volume ÷ 12-week average', 'attention spike', '?', '+'],
  ['S41', 'realized volatility (4 weeks)', 'low-volatility anomaly', '-', '+'], ['S42', 'price ÷ 52-week high', '52-week-high effect', '+', '?'],
  ['S43', '4-week return minus the 300-stock average', 'relative strength', '+', '+'], ['S44', 'max daily return (4 weeks)', 'lottery', '-', '+'],
  // combinations
  ['S45', 'call-heavy delta and uptrend (both 1/0)', 'chasing confirmed', '+', '+'], ['S46', 'short gamma and downtrend (1/0)', 'air pocket', '-', '+'],
  ['S47', 'king above spot and positive (1/0)', 'upside magnet', '+', '+'], ['S48', 'king below spot and positive (1/0)', 'downside magnet', '-', '?'],
  ['S49', 'largest |vanna| strike above spot (1/0)', 'vanna pull up', '+', '+'],
  // fundamentals at weekly frequency
  ['S50', 'v5 bottleneck score', 'fundamental demand (seen)', '+', '+'], ['S51', 'revenue acceleration', 'inflection', '+', '+'],
  // size-normalized options
  ['S52', 'put/call gamma ratio change over 1 week', 'hedging demand shift', '?', '?'], ['S53', 'total |delta| ÷ market cap', 'options footprint', '?', '+'],
  ['S54', 'net gamma ÷ market cap', 'hedging relative to size', '?', '-'], ['S55', 'net vanna ÷ market cap', 'vanna relative to size', '?', '?'],
  ['S56', 'call delta ÷ market cap', 'call footprint', '?', '+'],
];
const H = [];
for (const [list, outs] of [[LONG, ['M1', 'M3', 'M6', 'MV']], [SHORT, ['W1', 'W2', 'W4', 'WV']]])
  for (const f of list) for (const o of outs) { const mover = o === 'MV' || o === 'WV';
    H.push({ id: `${f[0]}x${o}`, feature: f[0], outcome: o, horizon: list === LONG ? 'long' : 'short', sign: mover ? f[4] : f[3], definition: f[1], mechanism: f[2], seen: /seen/.test(f[2]) }); }
fs.writeFileSync(path.join(SH, 'stock_registry.json'), JSON.stringify({ created: '2026-10-09', n: H.length, hypotheses: H }, null, 1));
console.log(`long ${LONG.length} × 4 + short ${SHORT.length} × 4 → ${H.length} studies (signed ${H.filter((h) => h.sign !== '?').length}, two-sided ${H.filter((h) => h.sign === '?').length}, seen ${H.filter((h) => h.seen).length})`);
