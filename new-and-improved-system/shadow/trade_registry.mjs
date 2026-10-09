#!/usr/bin/env node
// Trade-rule factory registry (shadow/DESIGN_trade_factory.md): every rule = level × trigger × exit × filter, registered
// as "mean R per trade > 0" BEFORE the engine runs.
import fs from 'node:fs';
import path from 'node:path';

const SH = decodeURIComponent(new URL('.', import.meta.url).pathname);
const CORE = ['PDH', 'PDL', 'PMH', 'PML', 'OR5H', 'OR5L', 'OR30H', 'OR30L', 'VWAP', 'KING', 'CALLW', 'PUTW'];
const ORX = ['OR15H', 'OR15L', 'OR60H', 'OR60L'];
const TRIG = { BRK: 'breakout close beyond the level', RET: 'break, retest within 60 min, hold', RCL: 'sweep and 3-min reclaim (Timmy hunt)', FAD: 'first-touch fade at the level' };
const EXIT = { T2: 'fixed 2R target', NXT: 'next level of the day', EOD: 'hold to 15:55' };
const FILT = { ALL: 'every day', GAM: 'gamma regime matches the trigger (breakouts on low local gamma, fades on high)', VW: 'only on the VWAP side of the trade' };
const LEVEL = { PDH: 'prior-day high', PDL: 'prior-day low', PMH: 'premarket high', PML: 'premarket low', OR5H: '5-min opening-range high', OR5L: '5-min opening-range low',
  OR15H: '15-min opening-range high', OR15L: '15-min opening-range low', OR30H: '30-min opening-range high', OR30L: '30-min opening-range low', OR60H: '60-min opening-range high', OR60L: '60-min opening-range low',
  VWAP: 'session VWAP', KING: 'prior-day gamma king', CALLW: 'call wall (largest call gamma above)', PUTW: 'put wall (largest put gamma below)' };
const R = [];
for (const L of CORE) for (const t of Object.keys(TRIG)) for (const e of Object.keys(EXIT)) for (const f of Object.keys(FILT)) R.push({ id: `${L}-${t}-${e}-${f}`, level: L, trigger: t, exit: e, filter: f });
for (const L of ORX) for (const t of ['BRK', 'RET']) for (const e of Object.keys(EXIT)) for (const f of Object.keys(FILT)) R.push({ id: `${L}-${t}-${e}-${f}`, level: L, trigger: t, exit: e, filter: f });
for (const r of R) { r.sign = '+'; r.text = `${LEVEL[r.level]} · ${TRIG[r.trigger]} · ${EXIT[r.exit]} · ${FILT[r.filter]}`; r.gammaStart = ['KING', 'CALLW', 'PUTW'].includes(r.level) || r.filter === 'GAM'; }
fs.writeFileSync(path.join(SH, 'trade_registry.json'), JSON.stringify({ created: '2026-10-09', n: R.length, rules: R }, null, 1));
console.log(`${R.length} rules`);
