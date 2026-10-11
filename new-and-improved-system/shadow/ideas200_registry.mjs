#!/usr/bin/env node
// 200 trade ideas (shadow/DESIGN_ideas200.md) registered BEFORE any engine or price pull for parts A and B.
import fs from 'node:fs';
import path from 'node:path';
const SH = decodeURIComponent(new URL('.', import.meta.url).pathname), R = [];
// Part A — VWAP band × gamma node rejections (96)
for (const k of [1, 1.5, 2, 2.5]) for (const side of ['short', 'long', 'both']) for (const tgt of ['VW', 'T2']) {
  for (const node of ['STRONG', 'KING', 'WALL']) R.push({ part: 'A', id: `A-${k}s-${side}-${tgt}-${node}`, k, side, tgt, node, gam: false, text: `${k}σ VWAP band rejection, ${side}, target ${tgt === 'VW' ? 'VWAP' : '2R'}, ${node === 'STRONG' ? 'any strong gamma node' : node === 'KING' ? 'gamma king' : 'call wall (upper) / put wall (lower)'} on the band` });
  R.push({ part: 'A', id: `A-${k}s-${side}-${tgt}-STRONG-GAM`, k, side, tgt, node: 'STRONG', gam: true, text: `${k}σ band rejection, ${side}, ${tgt}, strong node, only on long-local-gamma days (G23 above its build median)` }); }
// Part B — long options on predicted big movers (60)
const SIG = { S17: 'vanna balance', S55: 'net vanna ÷ market cap', S19neg: 'vanna skew (low)', S41: 'realized volatility', S53: 'options footprint', S44: 'max daily return', S07: 'king distance', S20: 'vanna magnet distance',
  S50: 'v5 bottleneck score', S42neg: 'near the 52-week low', S36up: 'up > 10% last week', S36dn: 'down > 10% last week', S14: 'options interest surging', S40: 'dollar-volume spike', COMBO: 'mean rank of S17, S41, S53' };
for (const [s, name] of Object.entries(SIG)) { for (const hold of [10, 20]) R.push({ part: 'B', id: `B-${s}-STRADDLE-${hold}d`, sig: s, structure: 'straddle', hold, text: `buy ATM monthly straddle on the top 10 by ${name}, hold ${hold} trading days` });
  for (const leg of ['CALL', 'PUT']) R.push({ part: 'B', id: `B-${s}-${leg}-20d`, sig: s, structure: leg, hold: 20, text: `buy ATM monthly ${leg.toLowerCase()} on the top 10 by ${name}, hold 20 trading days` }); }
// Part C — straddle-selling day filters on real SPY/QQQ prices (44)
const FIL = { G1: '±1% gamma balance top third', G2: 'G23 z top third', G3: 'all-strike balance top third', G4: 'net gamma ≥ 0', G5: 'king within 0.5% of price', E1: 'VIX1D ÷ VIX9D below build median', E2: 'VIX below VIX3M (contango)',
  V1: 'variance premium top third', P1: 'close above 20-day average', P2: '5-day return > 0', K1: 'not Monday', K2: 'monthly OPEX day', K3: 'not first trading day of month', K4: 'Friday',
  C1: 'G1 + P1', C2: 'G1 + E1', C3: 'G1 + V1', C4: 'G1 + E2', C5: 'G1 + P1 + E1 (= the earlier filter)', C6: 'V1 + E2', C7: 'P1 + E1', C8: 'G2 + E2 + P1' };
for (const [f, name] of Object.entries(FIL)) for (const k of ['T1', 'T2']) R.push({ part: 'C', id: `C-${f}-${k}`, filter: f, trade: k, text: `sell ${k === 'T1' ? '1-day' : '0DTE'} ATM straddle only on days with ${name}` });
fs.writeFileSync(path.join(SH, 'ideas200.json'), JSON.stringify({ created: '2026-10-11', n: R.length, ideas: R }, null, 1));
console.log(`A ${R.filter((x) => x.part === 'A').length} + B ${R.filter((x) => x.part === 'B').length} + C ${R.filter((x) => x.part === 'C').length} = ${R.length}`);
