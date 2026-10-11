#!/usr/bin/env node
// Volatility-premium factory registry (shadow/DESIGN_vol_factory.md). Sign = predicted effect on the SHORT-straddle P&L
// outcomes (V1, V2, V4, V6); V3 (range ÷ implied) and V5 (1σ breach) get the opposite sign. '?' = two-sided.
import fs from 'node:fs';
import path from 'node:path';

const SH = decodeURIComponent(new URL('.', import.meta.url).pathname);
// [id, definition, mechanism, sign for premium sellers, usable for V2/V6 only-open features?]
const F = [
  ['A01', 'gamma balance within ±1% (d−1)', 'long local gamma damps the day → straddle seller wins', '+'],
  ['A02', 'gamma balance within ±2% (d−1)', 'local regime (validated for range)', '+'],
  ['A03', 'gamma balance within ±5% (d−1)', 'medium regime', '+'],
  ['A04', 'gamma balance, all strikes (d−1)', 'total regime', '+'],
  ['A05', '±2% gamma balance z-score vs prior 60 days (G23, strongest validated)', 'regime vs normal', '+'],
  ['A06', 'all-strike balance z-score vs prior 60 days', 'regime vs normal', '+'],
  ['A07', 'net gamma negative (1/0)', 'dealers chase → bigger move', '-'],
  ['A08', '|king − close| ÷ close', 'no pin when the king is far', '-'],
  ['A09', 'largest positive-gamma strike − close, ÷ close', 'validated range feature (positive magnet far above → wider)', '-'],
  ['A10', 'king share of |gamma|', 'concentrated pin', '+'],
  ['A11', 'vanna balance', 'vanna flows', '?'], ['A12', 'charm balance', 'decay flows', '?'], ['A13', 'delta balance within ±2%', 'positioning', '?'],
  ['A14', 'local gamma balance 1-day change', 'gamma being added', '+'],
  ['B01', 'variance premium: ln(implied ÷ 20-day realized)', 'rich options → seller wins', '+'],
  ['B02', 'ln implied vol (index level)', 'high-vol regimes pay more', '?'],
  ['B03', 'implied vol 1-day change', 'fresh fear spike', '?'],
  ['B04', 'VIX term slope ln(VIX ÷ VIX3M) (market-wide)', 'inverted curve = stress', '-'],
  ['B05', 'ln(VIX9D ÷ VIX) (market-wide)', 'near-term event priced', '?'],
  ['B06', 'ln(VIX1D ÷ VIX9D) at the prior close (market-wide)', 'next-day event priced', '?'],
  ['B07', 'implied ÷ its own 20-day average', 'vol elevated vs recent', '?'],
  ['C01', '|prior-day return| ÷ implied move', 'big yesterday → big today (clustering beyond implied)', '-'],
  ['C02', 'prior-day range ÷ 20-day mean range', 'yesterday unusually wide', '-'],
  ['C03', '5-day return', 'down weeks are jumpier', '+'],
  ['C04', 'close ÷ 20-day average − 1', 'stretched up = calm; stretched down = jumpy', '+'],
  ['C05', 'opening gap |O_d ÷ C_{d−1} − 1| ÷ implied move (V2/V6 only)', 'a big gap already used the move', '?'],
  ['D01', 'day d is Monday', 'weekend risk in close-to-close', '-'], ['D02', 'day d is Friday', 'weekend de-risking', '?'],
  ['D03', 'day d is monthly OPEX', 'expiry pin', '+'], ['D04', 'day d is the day after monthly OPEX', 'gamma released', '-'],
  ['D05', 'day d is the first trading day of the month', 'validated wider day', '-'], ['D06', 'day d is in OPEX week', 'pin week', '+'],
  ['E01', 'A05 × (variance premium above its build median)', 'long gamma AND rich options', '+'],
];
const OUT = ['V1', 'V2', 'V3', 'V4', 'V5', 'V6'], H = [];
for (const [id, def, mech, s] of F) for (const o of OUT) { if (id === 'C05' && !['V2', 'V6'].includes(o)) continue;
  const flip = o === 'V3' || o === 'V5', sign = s === '?' ? '?' : flip ? (s === '+' ? '-' : '+') : s;
  H.push({ id: `${id}x${o}`, feature: id, outcome: o, sign, definition: def, mechanism: mech }); }
fs.writeFileSync(path.join(SH, 'vol_registry.json'), JSON.stringify({ created: '2026-10-10', n: H.length, hypotheses: H }, null, 1));
console.log(`${F.length} features → ${H.length} hypotheses`);
