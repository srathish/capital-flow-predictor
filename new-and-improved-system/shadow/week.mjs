#!/usr/bin/env node
// Shadow week: run the agent every N minutes over past trading days on cached 0DTE boards + Atlas bars,
// journal EVERY decision, turn each CARD into a paper trade priced on the real contract, and report the book.
// usage: node shadow/week.mjs --from 2026-09-28 --to 2026-10-02 [--step 5] [--criteria current|location] [--symbols SPXW,SPY,QQQ]
// Nothing is ever routed to a broker.
import fs from 'node:fs';
import path from 'node:path';
import { runPass } from '../loop/run.js';
import { PRICE_SYMBOL, DEFLECTION_ZONE } from '../map/board.js';
import { boardsAt, minuteBars, dailyBars, stats } from './cache.js';
import { simulate, RULES } from './paper.js';
import { etToUnix } from '../lib/time.js';
import { account } from '../feeds/skylit.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const from = arg('from'), to = arg('to', from), step = Number(arg('step', 5));
const variant = arg('criteria', 'current');
const criteria = { current: {}, location: { locationOnly: true }, noking: { noKing: true } }[variant] ?? {};
const symbols = arg('symbols', 'SPXW,SPY,QQQ').split(',');
if (!from) { console.error('need --from YYYY-MM-DD'); process.exit(1); }

const HERE = decodeURIComponent(new URL('.', import.meta.url).pathname);
const JDIR = path.join(HERE, 'journal'); fs.mkdirSync(JDIR, { recursive: true });
const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

// trading days from Atlas daily bars (skips weekends/holidays automatically)
const probe = await dailyBars('SPY', to);
const days = probe.map((b) => new Date((b.t + 12 * 3600) * 1000).toISOString().slice(0, 10)).filter((d) => d >= from && d <= to);
const acct0 = await account().catch(() => null);
console.log(`shadow week ${from} → ${to} · ${days.length} days · every ${step}m · criteria=${variant} · credits ${acct0?.creditsBalance ?? '?'}\n`);

const trades = [], passes = [];
for (const date of days) {
  const pxs = [...new Set(symbols.map((s) => PRICE_SYMBOL[s] ?? s))];
  const fullBars = {}, daily = {};
  for (const px of pxs) { fullBars[px] = await minuteBars(px, date); daily[px] = await dailyBars(px, date); }
  const jf = path.join(JDIR, `${date}.${variant}.jsonl`); fs.writeFileSync(jf, '');
  const frames = new Map(); // hhmm -> boards
  const busyUntil = {};     // symbol -> unix (open trade or cooldown)
  const flatBy = etToUnix(date, RULES.flatBy), noNew = etToUnix(date, RULES.noNewAfter);
  let cards = 0;
  for (let m = toMin('09:35'); m <= toMin('15:40'); m += step) {
    const t = etToUnix(date, hm(m));
    if (t > Date.now() / 1000 - 120) break;
    const boards = await boardsAt(symbols, date, hm(m)); frames.set(m, boards);
    const prev = frames.get(m - 15) ?? null;
    const bars = Object.fromEntries(pxs.map((px) => [px, fullBars[px].filter((b) => b.t <= t)]));
    const out = runPass({ symbols, boards, prevBoards: prev, bars, daily, date, criteria });
    for (const sym of symbols) {
      const r = out.results[sym]; if (!r) continue;
      const c = out.ctx[sym];
      const rec = { t, et: hm(m), symbol: sym, decision: r.decision, step: r.stepFailed ?? null, why: r.why ?? null, setup: r.setup ?? null, direction: r.direction ?? null, plan: r.plan ?? null,
        day: out.day.type, trinity: out.tri.klass, regime: c.regime.label, spot: c.board.spot, king: c.hier.king?.strike ?? null, floor: c.hier.floor?.strike ?? null, ceiling: c.hier.ceiling?.strike ?? null, chart: c.chart.bias };
      fs.appendFileSync(jf, JSON.stringify(rec) + '\n'); passes.push(rec);
      if (r.decision !== 'CARD') continue;
      cards++;
      if (t >= noNew || (busyUntil[sym] && t < busyUntil[sym])) continue;
      const px = PRICE_SYMBOL[sym] ?? sym;
      const tr = await simulate({ symbol: sym, direction: r.direction, plan: r.plan, t, zone: DEFLECTION_ZONE[sym], setup: r.setup, nodeType: r.node?.skylitType }, fullBars[px], date, flatBy);
      if (!tr.filled) { busyUntil[sym] = t + RULES.pendingMinutes * 60; continue; }
      busyUntil[sym] = tr.exitT + RULES.cooldownMinutes * 60;
      trades.push({ date, et: hm(m), ...tr, plan: r.plan, day: out.day.type, trinity: out.tri.klass });
      fs.appendFileSync(jf, JSON.stringify({ trade: { date, et: hm(m), ...tr } }) + '\n');
    }
  }
  const dt = trades.filter((x) => x.date === date);
  const dm = dt.reduce((a, x) => a + x.retMid, 0) * 1000, dw = dt.reduce((a, x) => a + (x.retWorst ?? x.retMid), 0) * 1000;
  console.log(`${date}  cards ${String(cards).padStart(3)}  trades ${String(dt.length).padStart(2)}  @$1k/trade  mid ${dm >= 0 ? '+' : '-'}$${Math.abs(dm).toFixed(0)}  worst ${dw >= 0 ? '+' : '-'}$${Math.abs(dw).toFixed(0)}   [boards fetched ${stats.boardFetch}, cached ${stats.boardHit}]`);
}

// ---------------- report ----------------
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const sqn = (a) => (a.length > 1 && sd(a) > 0 ? Math.sqrt(a.length) * mean(a) / sd(a) : 0);
const line = (label, T) => {
  if (!T.length) return `${label.padEnd(22)} —`;
  const w = T.filter((x) => x.pnlMid > 0).length;
  const k = (a) => { const v = a.reduce((s, x) => s + x, 0) * 1000; return `${v >= 0 ? '+' : '-'}$${Math.abs(v).toFixed(0)}`.padStart(7); };
  // P&L normalized to $1,000 of premium per trade (mid fills, and worst-case: buy bar high / sell bar low)
  return `${label.padEnd(22)} n=${String(T.length).padStart(3)}  win ${(w / T.length * 100).toFixed(0).padStart(3)}%  @$1k/trade: mid ${k(T.map((x) => x.retMid))}  worst ${k(T.map((x) => x.retWorst ?? x.retMid))}  avg ${(mean(T.map((x) => x.retMid)) * 100).toFixed(0).padStart(3)}%  SQN ${sqn(T.map((x) => x.retMid)).toFixed(2).padStart(5)}  uR ${mean(T.map((x) => x.uR)).toFixed(2)}  hold ${mean(T.map((x) => x.holdMin)).toFixed(0)}m`;
};
console.log(`\n================ SHADOW BOOK · ${from} → ${to} · criteria=${variant} · $1k premium per card, real 0DTE prices ================`);
console.log(line('ALL', trades));
for (const s of symbols) console.log(line(`  ${s}`, trades.filter((x) => x.symbol === s)));
const by = (k) => { const g = {}; for (const x of trades) (g[x[k] ?? 'none'] ||= []).push(x); return g; };
console.log('\n-- by setup --'); for (const [k, T] of Object.entries(by('setup'))) console.log(line(`  ${k}`, T));
console.log('\n-- by node type --'); for (const [k, T] of Object.entries(by('nodeType'))) console.log(line(`  ${k}`, T));
console.log('\n-- by day type at entry --'); for (const [k, T] of Object.entries(by('day'))) console.log(line(`  ${k}`, T));
console.log('\n-- exits --'); const ex = {}; for (const x of trades) ex[x.outcome] = (ex[x.outcome] || 0) + 1; console.log('  ' + Object.entries(ex).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · '));
console.log('\n-- why no trade (all PASS decisions) --');
const pc = {}; for (const p of passes.filter((x) => x.decision === 'PASS')) { const k = `step ${p.step}: ${(p.why || '').replace(/[0-9.]+/g, '#').slice(0, 70)}`; pc[k] = (pc[k] || 0) + 1; }
for (const [k, v] of Object.entries(pc).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${String(v).padStart(4)}  ${k}`);
console.log('\n-- every trade --');
for (const x of trades) console.log(`  ${x.date} ${x.et} ${x.symbol.padEnd(4)} ${x.direction === 'up' ? 'CALL' : 'PUT '} ${x.contract.padEnd(20)} ${(x.setup || '').padEnd(12)} in $${x.entryOpt.toFixed(2)} → ${x.outcome.padEnd(14)} ${x.holdMin}m  ${x.pnlMid >= 0 ? '+' : ''}$${x.pnlMid.toFixed(0)} (${(x.retMid * 100).toFixed(0)}%)  uR ${x.uR}`);
fs.writeFileSync(path.join(JDIR, `book.${from}_${to}.${variant}.json`), JSON.stringify(trades, null, 1));
const acct1 = await account().catch(() => null);
console.log(`\ncredits used ${acct0 && acct1 ? acct0.creditsBalance - acct1.creditsBalance : '?'} · boards fetched ${stats.boardFetch} / cached ${stats.boardHit} · option contracts fetched ${stats.optFetch} / cached ${stats.optHit}`);
