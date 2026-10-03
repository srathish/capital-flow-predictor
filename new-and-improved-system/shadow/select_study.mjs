#!/usr/bin/env node
// WHICH STOCKS to trade the A+ setup on? Every selector below was written down 2026-10-03 BEFORE looking at results.
// Input: journal/aplus_walk.<SYM>.2026-01-02_2026-10-02.json (all 15 cached names). TRAIN = Jan–Jun entries, TEST = Jul–Oct.
// Metric = underlying R (always available; option P&L only where the contract is cached). A selector "works" only if it
// beats ALL-A+ on TRAIN *and* on TEST.
import fs from 'node:fs';
import path from 'node:path';

const HERE = decodeURIComponent(new URL('.', import.meta.url).pathname);
const SYMS = ['AAPL', 'ADBE', 'AMD', 'AMZN', 'AVGO', 'COST', 'CRM', 'GOOGL', 'JPM', 'META', 'MSFT', 'NFLX', 'NVDA', 'ORCL', 'TSLA'];
const T = [];
for (const s of SYMS) {
  const f = path.join(HERE, 'journal', `aplus_walk.${s}.2026-01-02_2026-10-02.json`);
  if (fs.existsSync(f)) for (const t of JSON.parse(fs.readFileSync(f, 'utf8')).trades) T.push({ sym: s, set: t.D < '2026-07-01' ? 'TRAIN' : 'TEST', ...t });
}
const bad = T.filter((t) => !Number.isFinite(t.R));
const ok = T.filter((t) => Number.isFinite(t.R));

const SELECT = {
  'all A+': () => true,
  'leader vs SPY (rs20>0)': (t) => t.rs20 > 0,
  'laggard vs SPY (rs20<0)': (t) => t.rs20 < 0,
  'index trend with you': (t) => t.spyWith,
  '5d momentum with you': (t) => t.mom5 > 0,
  '5d momentum against (pullback)': (t) => t.mom5 < 0,
  'calm stock (ATR<2%)': (t) => t.atrPct < 0.02,
  'volatile stock (ATR≥2%)': (t) => t.atrPct >= 0.02,
  'big node (share≥15%)': (t) => t.share >= 0.15,
  'chart ≥2/4': (t) => t.chartN >= 2,
  'liquidity sweep': (t) => t.sweep,
  'VEX agrees': (t) => t.vex === true,
  'no gap against': (t) => t.gap >= 0,
  'first hour entry': (t) => t.entryMin < 60,
  'after first hour': (t) => t.entryMin >= 60,
  'leader + index with you': (t) => t.rs20 > 0 && t.spyWith,
};
const st = (R) => {
  if (!R.length) return { n: 0, s: '   n=0' };
  const r = R.map((t) => t.R), avg = r.reduce((a, x) => a + x, 0) / r.length, sd = Math.sqrt(r.reduce((a, x) => a + (x - avg) ** 2, 0) / Math.max(1, r.length - 1));
  const opt = R.filter((t) => t.ret != null);
  return { n: R.length, avg, s: `n=${String(R.length).padStart(3)} win ${String(Math.round(R.filter((t) => t.R > 0).length / R.length * 100)).padStart(3)}%  avg ${avg.toFixed(2).padStart(5)}R  tot ${r.reduce((a, x) => a + x, 0).toFixed(1).padStart(6)}R  t=${(avg / (sd / Math.sqrt(r.length)) || 0).toFixed(1).padStart(4)}  [opt priced ${opt.length}: ${opt.length ? '$' + Math.round(opt.reduce((a, t) => a + t.ret, 0) * 1000) : '-'}]` };
};

console.log(`A+ trades: ${T.length} across ${new Set(T.map((t) => t.sym)).size} stocks · usable ${ok.length}${bad.length ? ` · dropped ${bad.length} (missing bars)` : ''}`);
console.log(`direction: ${ok.filter((t) => t.dir === 'up').length} bull / ${ok.filter((t) => t.dir === 'down').length} bear\n`);
const base = { TRAIN: st(ok.filter((t) => t.set === 'TRAIN')), TEST: st(ok.filter((t) => t.set === 'TEST')) };
console.log('=== selectors (TRAIN Jan–Jun | TEST Jul–Oct) ===');
for (const [name, fn] of Object.entries(SELECT)) {
  const a = st(ok.filter((t) => t.set === 'TRAIN' && fn(t))), b = st(ok.filter((t) => t.set === 'TEST' && fn(t)));
  const both = name !== 'all A+' && a.n >= 5 && b.n >= 5 && a.avg > base.TRAIN.avg && b.avg > base.TEST.avg;
  console.log(`${both ? '✓' : ' '} ${name.padEnd(31)} TRAIN ${a.s}\n  ${''.padEnd(31)} TEST  ${b.s}`);
}

console.log('\n=== does a stock that worked in TRAIN keep working in TEST? (per-stock persistence) ===');
const per = SYMS.map((s) => ({ s, tr: ok.filter((t) => t.sym === s && t.set === 'TRAIN'), te: ok.filter((t) => t.sym === s && t.set === 'TEST') }))
  .map((x) => ({ ...x, trR: x.tr.reduce((a, t) => a + t.R, 0), teR: x.te.reduce((a, t) => a + t.R, 0) }));
for (const x of per.sort((a, b) => b.trR - a.trR)) console.log(`  ${x.s.padEnd(6)} TRAIN ${String(x.tr.length).padStart(2)}t ${x.trR.toFixed(1).padStart(6)}R   →   TEST ${String(x.te.length).padStart(2)}t ${x.teR.toFixed(1).padStart(6)}R`);
const top = per.filter((x) => x.tr.length && x.trR > 0), rest = per.filter((x) => !(x.tr.length && x.trR > 0));
console.log(`  stocks positive in TRAIN (${top.map((x) => x.s).join(' ')}) → TEST ${st(top.flatMap((x) => x.te)).s}`);
console.log(`  all other stocks                  → TEST ${st(rest.flatMap((x) => x.te)).s}`);
fs.writeFileSync(path.join(HERE, 'journal', 'select_study.json'), JSON.stringify(ok, null, 1));
