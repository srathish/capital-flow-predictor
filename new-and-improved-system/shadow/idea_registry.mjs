#!/usr/bin/env node
// Generates idea_registry.json — every hypothesis for the idea factory (shadow/DESIGN_idea_factory.md), with its
// mechanism and predicted sign, BEFORE any data is downloaded. Each feature carries a predicted sign per outcome family:
//   vol = R1/R2 (bigger range), trend = S1, dir = D1–D4 (up), pull = P1 (moves toward the gamma king). '?' = two-sided.
import fs from 'node:fs';
import path from 'node:path';

const SH = decodeURIComponent(new URL('.', import.meta.url).pathname);
// [id, definition, mechanism, vol, trend, dir, pull]
const F = [
  // ---- gamma level (dealer gamma, known at the d−1 close; S = d−1 close, g = call_gex + put_gex per strike) ----
  ['G01', 'gamma balance Σg / Σ|g| (all strikes)', 'long gamma → dealers sell rips / buy dips → damped day', '-', '-', '?', '+'],
  ['G02', 'gamma balance within ±1% of S', 'gamma nearest spot does the hedging', '-', '-', '?', '+'],
  ['G03', 'gamma balance within ±2% of S', 'local gamma regime', '-', '-', '?', '+'],
  ['G04', 'gamma balance within ±5% of S', 'medium-range gamma regime', '-', '-', '?', '+'],
  ['G05', 'net gamma negative (1/0)', 'short gamma → dealers chase', '+', '+', '?', '-'],
  ['G06', 'share of |gamma| below S', 'mass below spot = hedging support underneath (SPXW factor)', '-', '?', '+', '?'],
  ['G07', 'gamma balance of strikes below S', 'long gamma below = buyers on dips', '-', '-', '+', '?'],
  ['G08', 'gamma balance of strikes above S', 'long gamma above = sellers on rips', '-', '-', '-', '?'],
  ['G09', 'king distance (K − S) / S, K = strike with largest |g|', 'price drifts toward the biggest hedging strike', '?', '?', '+', '?'],
  ['G10', '|K − S| / S', 'king far away = no pin today', '+', '+', '?', '?'],
  ['G11', 'king gamma positive (1/0)', 'positive king pins, negative king repels', '-', '-', '?', '+'],
  ['G12', 'king share |g_K| / Σ|g|', 'concentrated gamma = stronger pin', '-', '-', '?', '+'],
  ['G13', 'gamma concentration (Herfindahl of |g| shares)', 'concentrated gamma = stronger pin', '-', '-', '?', '+'],
  ['G14', 'distance to nearest strong node above S (≥ 50% of king) / S', 'more room above before a wall', '+', '+', '+', '?'],
  ['G15', 'distance to nearest strong node below S / S', 'more room below before a floor', '+', '+', '-', '?'],
  ['G16', 'corridor width = G14 + G15', 'wide corridor = room to move', '+', '+', '?', '-'],
  ['G17', 'largest positive-gamma strike − S, / S', 'positive magnet location', '?', '?', '+', '?'],
  ['G18', 'largest negative-gamma strike − S, / S', 'negative (repelling / accelerating) strike location', '?', '?', '?', '?'],
  ['G19', 'call gamma share Σcall_g / (Σcall_g + |Σput_g|)', 'call-heavy gamma = dealers long gamma on top', '-', '-', '?', '+'],
  ['G20', 'ln(Σ|g| / its 20-day mean)', 'abnormal total gamma', '?', '?', '?', '?'],
  ['G21', 'net gamma in $ per 1% move ÷ 20-day $ volume', 'hedging flow relative to normal trading', '-', '-', '?', '+'],
  ['G22', 'G01 z-score vs its own prior 60 days', 'regime relative to recent normal', '-', '-', '?', '+'],
  ['G23', 'G03 z-score vs its own prior 60 days', 'local regime relative to recent normal', '-', '-', '?', '+'],
  // ---- vanna (sensitivity of dealer delta to implied volatility) ----
  ['V01', 'vanna balance Σv / Σ|v|', 'vol drift + vanna = forced hedging (vanna rally / unwind)', '?', '?', '?', '?'],
  ['V02', 'vanna balance within ±2%', 'local vanna', '?', '?', '?', '?'],
  ['V03', '(Σv above S − Σv below S) / Σ|v|', 'vanna skew around spot', '?', '?', '?', '?'],
  ['V04', 'largest |vanna| strike − S, / S', 'vanna magnet location', '?', '?', '+', '?'],
  ['V05', 'net vanna positive (1/0)', 'positive vanna + usual IV drift down → dealer buying', '?', '?', '+', '?'],
  // ---- charm (decay of dealer delta with time) ----
  ['C01', 'charm balance Σc / Σ|c|', 'time decay forces dealer re-hedging', '?', '?', '?', '?'],
  ['C02', 'charm balance within ±2%', 'local charm', '?', '?', '?', '?'],
  ['C03', 'Σc / Σ|δ| (charm relative to delta)', 'size of the overnight delta drift', '?', '?', '?', '?'],
  // ---- delta (option open interest positioning) ----
  ['D01', 'delta balance Σδ / Σ|δ|', 'customer net positioning', '?', '?', '?', '?'],
  ['D02', 'call delta ÷ |put delta|', 'crowd bullishness (contrarian)', '?', '?', '-', '?'],
  ['D03', 'delta balance within ±2%', 'local positioning', '?', '?', '?', '?'],
  // ---- dynamics (change since earlier closes) ----
  ['Y01', 'G01 change over 1 day', 'gamma being added = more damping', '-', '-', '?', '+'],
  ['Y02', 'G03 change over 1 day', 'local gamma being added', '-', '-', '?', '+'],
  ['Y03', 'G01 change over 5 days', 'gamma build-up', '-', '-', '?', '+'],
  ['Y04', 'king strike change over 1 day / S', 'king rolling up = escalator', '?', '?', '+', '?'],
  ['Y05', 'ln Σ|g| change over 1 day', 'gamma growing or shrinking', '?', '?', '?', '?'],
  ['Y06', 'V01 change over 1 day', 'vanna shift', '?', '?', '?', '?'],
  ['Y07', 'C01 change over 1 day', 'charm shift', '?', '?', '?', '?'],
  ['Y08', 'D01 change over 1 day', 'positioning shift', '?', '?', '?', '?'],
  ['Y09', 'G17 change over 1 day', 'positive magnet moving', '?', '?', '+', '?'],
  // ---- non-GEX baselines (the ideas everyone already has) ----
  ['N01', 'ln VIX', 'fear level', 'x', '?', '?', '?'],
  ['N02', 'VIX 1-day change', 'fear shock (mean-reverts)', '+', '?', '+', '?'],
  ['N03', 'prior-day return', 'short-term reversal', '?', '?', '-', '?'],
  ['N04', '5-day return', 'weekly reversal', '?', '?', '-', '?'],
  ['N05', '20-day return', 'momentum', '?', '?', '+', '?'],
  ['N06', 'close ÷ 20-day average − 1', 'stretch from the mean (reversion)', '?', '?', '-', '?'],
  ['N07', 'prior-day range ÷ 20-day mean range', 'yesterday unusually wide', 'x', '?', '?', '?'],
  ['N08', 'prior-day close location (C − L)/(H − L)', 'strong close → follow-through', '?', '?', '+', '?'],
  ['N09', 'prior-day trendiness |C − O|/range', 'trend days cluster', '?', '+', '?', '?'],
  ['N10', 'ln(VIX ÷ 20-day realized vol of SPY)', 'rich implied vol → calmer than feared', '-', '?', '+', '?'],
  ['N11', 'day d is Monday', 'weekend news → wider', '+', '?', '?', '?'],
  ['N12', 'day d is Friday', 'weekend de-risking', '?', '?', '?', '?'],
  ['N13', 'day d is monthly OPEX (3rd Friday)', 'expiry pin', '-', '-', '?', '+'],
  ['N14', 'day d is the day after monthly OPEX', 'gamma released after expiry', '+', '+', '?', '-'],
  ['N15', 'day d is in OPEX week', 'pin week', '-', '-', '?', '+'],
  ['N16', 'day d is the last trading day of the month', 'month-end flows', '?', '?', '+', '?'],
  ['N17', 'day d is the first trading day of the month', 'new-month inflows', '?', '?', '+', '?'],
  ['N18', 'day d is the day before a market holiday', 'pre-holiday drift', '-', '?', '+', '?'],
  // ---- interactions ----
  ['I01', 'G01 × (VIX > 20)', 'gamma matters more in stress', '-', '-', '?', '+'],
  ['I02', 'G03 × (close above 20-day average)', 'local gamma in an uptrend', '?', '?', '?', '?'],
  ['I03', 'king above S and positive (1/0)', 'upside magnet', '?', '?', '+', '+'],
  ['I04', 'king below S and positive (1/0)', 'downside magnet', '?', '?', '-', '+'],
  ['I05', 'net gamma negative and close below 20-day average (1/0)', 'short gamma in a downtrend = air pocket', '+', '+', '-', '-'],
  ['I06', 'G06 × net gamma positive', 'supported and damped', '-', '?', '+', '?'],
];
const O = [['R1', 'vol', 4], ['R2', 'vol', 4], ['S1', 'trend', 5], ['D1', 'dir', 6], ['D2', 'dir', 6], ['D3', 'dir', 6], ['D4', 'dir', 6], ['P1', 'pull', 7]];
const H = [];
// amendment 1: features that duplicate a control for an outcome are not tested there (audit 2026-10-09)
const DUP = new Set(['N01xS1', 'N09xS1', 'N03xD1', 'N03xD2', 'N03xD3', 'N03xD4']);
for (const f of F) for (const [o, fam, col] of O) { const sign = f[col]; if (sign === 'x' || DUP.has(`${f[0]}x${o}`)) continue; // 'x' = that feature is already a control for this outcome
  H.push({ id: `${f[0]}x${o}`, feature: f[0], outcome: o, family: fam, sign, definition: f[1], mechanism: f[2], seen: f[0] === 'G01' && o === 'R1' }); }
fs.writeFileSync(path.join(SH, 'idea_registry.json'), JSON.stringify({ created: '2026-10-09', n: H.length, features: F.length, hypotheses: H }, null, 1));
console.log(`${F.length} features × ${O.length} outcomes → ${H.length} hypotheses (signed ${H.filter((h) => h.sign !== '?').length}, two-sided ${H.filter((h) => h.sign === '?').length})`);
