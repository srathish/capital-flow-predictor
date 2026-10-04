#!/usr/bin/env node
// A+ WALK-FORWARD on one stock. Day by day, using ONLY what was known at 09:35: find A+ setups (rubric locked below,
// 2026-10-03, before running), wait for the RETEST THAT HOLDS, trade it, price it on the real option. Lists every A+ found.
//   node shadow/aplus_walk.mjs --symbol MSFT --from 2026-04-01 --to 2026-10-02
//
// A+ (bull; bear = mirror):
//  1 strong entry node: the floor (largest node below spot) is king/gatekeeper with ≥8% share, within 1.5% of spot
//  2 air pocket: no node between entry and target with |value| ≥ 0.7 × target|value|
//  3 untouched target: target strike not reached by any session high so far this week (delivered = not A+)
//  4 R:R ≥ 3 node-to-node; stop = one major node beyond entry (else 1 strike step)
//  5 charts first: daily trend not against the trade
//  6 entry = retest that HOLDS: 1-min bar tags the node (±zone) and closes back on the right side; 1st/2nd tap only
//  7 no earnings in the holding window; contract ≥14 DTE ("buy time"), hold ≤10 trading days
//  flag only (not required): liquidity sweep at entry (took prior-day low/high, reclaimed)
import fs from 'node:fs';
import path from 'node:path';
import { atlasHistory, account } from '../feeds/skylit.js';
import { normalizeBoard, majorNodes } from '../map/board.js';
import { hierarchy } from '../map/hierarchy.js';
import { tapCount } from '../map/living.js';
import { minuteBars, optionBars } from './cache.js';
import { board as cachedBoard, earningsDates, earningsIn } from './features.js';
import { dailyTrend } from '../system/stockrules.js';
import { occ } from '../feeds/uw.js';
import { etToUnix } from '../lib/time.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const SYM = arg('symbol', 'MSFT'), FROM = arg('from', '2026-04-01'), TO = arg('to', '2026-10-02');
const REACH = 0.015, ZONE_PCT = 0.0015, MIN_SHARE = 0.08, GATE = 0.7, MIN_RR = 3, HOLD = 10, DTE = 14;
const HERE = decodeURIComponent(new URL('.', import.meta.url).pathname);
const ymd = (t) => new Date((t + 12 * 3600) * 1000).toISOString().slice(0, 10);
const dow = (d) => new Date(d + 'T12:00:00Z').getUTCDay();
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const hm = (t) => new Date((t - 4 * 3600) * 1000).toISOString().slice(11, 16);
const mondayOf = (d) => addDays(d, -((dow(d) + 6) % 7));

const daily = await atlasHistory(SYM, 'D', etToUnix(FROM, '09:30') - 200 * 86400, etToUnix(TO, '16:00') + 86400);
const dmap = new Map(daily.map((b) => [ymd(b.t), b])), days = [...dmap.keys()].sort(), tdays = days.filter((d) => d >= FROM && d <= TO);
const isTD = (d) => dmap.has(d) || d > days[days.length - 1];
const weekly = (d) => { let f = addDays(d, (5 - dow(d) + 7) % 7); if (dow(d) >= 4) f = addDays(f, 7); while (!isTD(f) && dow(f) >= 1) f = addDays(f, -1); return f; };
const buyTime = (d) => { let f = addDays(d, DTE); while (dow(f) !== 5) f = addDays(f, 1); while (!isTD(f) && dow(f) >= 1) f = addDays(f, -1); return f; };
const px = (bars, t, k = 'c') => { let best = null; for (const b of bars) { if (b.t > t) break; best = b; } if (!best) best = bars.find((b) => b.t > t) ?? null; return best ? best[k] : null; };
// liquid contract: chosen expiry first, then the next valid expiry a week out, then the front weekly (last resort) if the chain barely traded (≤30 prints)
async function contract(exp, type, strike, date) { for (const e of [...new Set([exp, buyTime(addDays(date, 7)), weekly(date)])]) for (const s of [2.5, 5, 1]) { const k = Math.round(strike / s) * s, id = occ(SYM, e, type, k); if ((await optionBars(id, date)).length > 30) return id; } return null; }
const earn = await earningsDates(SYM);
const spyD = await atlasHistory('SPY', 'D', etToUnix(FROM, '09:30') - 200 * 86400, etToUnix(TO, '16:00') + 86400);
const spyMap = new Map(spyD.map((b) => [ymd(b.t), b])), spyDays = [...spyMap.keys()].sort();
import { vexLean } from '../system/stockrules.js';
// Stock-selection features, all known BEFORE the entry bar (signed so + = in the trade's favor).
async function selectFeatures(D, a, bars, bi, exp) {
  const sg = a.dir === 'up' ? 1 : -1, pr = days.filter((d) => d < D).map((d) => dmap.get(d)), sp = spyDays.filter((d) => d < D).map((d) => spyMap.get(d));
  const ret = (xs, n) => xs.at(-1).c / xs.at(-1 - n).c - 1;
  const tr = pr.slice(-15).map((b, i, xs) => i ? Math.max(b.h - b.l, Math.abs(b.h - xs[i - 1].c), Math.abs(b.l - xs[i - 1].c)) : null).filter((x) => x != null);
  const raw = await cachedBoard(SYM, D, exp, 'vanna'), lean = raw?.strikes?.length ? vexLean(raw) : null;
  return { rs20: +(sg * (ret(pr, 20) - ret(sp, 20))).toFixed(4), mom5: +(sg * ret(pr, 5)).toFixed(4), atrPct: +(tr.reduce((x, y) => x + y, 0) / tr.length / pr.at(-1).c).toFixed(4),
    gap: +(sg * (bars[0].o / pr.at(-1).c - 1)).toFixed(4), spyTrend: dailyTrend(sp.map((b) => b.c)), spyWith: dailyTrend(sp.map((b) => b.c)) === (a.dir === 'up' ? 'up' : 'down'),
    share: a.share, rr: a.rr, chartN: a.tech?.n ?? 0, structure: !!a.tech?.structure, fib: !!a.tech?.fib, level: !!a.tech?.level, sweep: !!a.tech?.sweep, vex: lean == null ? null : lean === a.dir, entryMin: Math.round((bars[bi].t - bars[0].t) / 60) };
}

import { findAplus as findAplusShared, retestHolds, APLUS } from '../system/aplus.js';
import { technicals } from '../system/technicals.js';
const CHART = process.argv.includes('--chart'); // require A+ CHART (map A+ AND chart technicals)
function findAplus(board, hier, D, chart) {
  const wk = days.filter((d) => d >= mondayOf(D) && d < D).map((d) => dmap.get(d));
  return findAplusShared({ board, hier, chart, weekHi: Math.max(-Infinity, ...wk.map((b) => b.h)), weekLo: Math.min(Infinity, ...wk.map((b) => b.l)) });
}

const acct0 = await account().catch(() => null);
const found = [], trades = [];
let busyUntil = null;
for (const D of tdays) {
  if (busyUntil && D <= busyUntil) continue;
  const raw = await cachedBoard(SYM, D, weekly(D), 'gamma');
  if (!raw?.strikes?.length) continue;
  const board = normalizeBoard({ ...raw, symbol: SYM }); board.zone = board.spot * ZONE_PCT;
  const hier = hierarchy(board), chart = dailyTrend(days.filter((d) => d < D).map((d) => dmap.get(d).c));
  const cexp = buyTime(D), holdEnd = days.filter((d) => d >= D && d < cexp).slice(0, HOLD).slice(-1)[0] ?? D;
  const aps = findAplus(board, hier, D, chart);
  if (!aps.length) continue;
  const blackout = earningsIn(earn, D, holdEnd);
  const bars = await minuteBars(SYM, D), pd = dmap.get(days.filter((d) => d < D).slice(-1)[0]);
  let fill = null;
  for (let bi = 0; bi < bars.length && !fill && !blackout; bi++) {
    const b = bars[bi]; if (hm(b.t) < '09:35' || hm(b.t) > '15:30') continue;
    for (const a of aps) {
      if (!retestHolds(a, bars, bi, board.zone)) continue;
      const tech = technicals({ dir: a.dir, node: a.entry, prior: days.filter((d) => d < D).map((d) => dmap.get(d)), session: bars.slice(0, bi + 1) });
      a.tech = tech;
      if (CHART && !tech.aplusChart) continue;
      fill = { ...a, t: b.t, sweep: tech.sweep, tech }; break;
    }
  }
  for (const a of aps) found.push({ D, spot: +board.spot.toFixed(2), ...a, status: blackout ? `earnings blackout (${blackout})` : fill && fill.entry === a.entry && fill.dir === a.dir ? `FILLED ${hm(fill.t)} · chart: ${fill.tech.tag} (${fill.tech.n}/4${fill.tech.against ? ', STRUCTURE AGAINST' : ''})` : a.tech ? `retest held but chart ${a.tech.tag} (${a.tech.n}/4${a.tech.against ? ', against' : ''}) — not A+ chart` : 'no retest that held' });
  if (!fill) continue;
  const fbi = bars.findIndex((x) => x.t === fill.t), feat = await selectFeatures(D, fill, bars, fbi, weekly(D));
  const type = fill.dir === 'up' ? 'call' : 'put', id = await contract(cexp, type, fill.entry, D);
  const e0 = id ? px(await optionBars(id, D), fill.t) : null;
  const dir = fill.dir === 'up' ? 1 : -1, legs = []; let half = false, stopLvl = fill.stop;
  const holdDays = days.filter((d) => d >= D && d <= holdEnd);
  outer: for (const d of holdDays) {
    const bs = (await minuteBars(SYM, d)).filter((x) => d !== D || x.t > fill.t);
    for (const x of bs) {
      if (!half && (dir > 0 ? x.h >= fill.target : x.l <= fill.target)) { legs.push({ d, t: x.t, f: 0.5, why: 'TARGET' }); half = true; stopLvl = fill.entry; if (fill.t2 == null) { legs.push({ d, t: x.t, f: 0.5, why: 'TARGET(all)' }); break outer; } }
      if (half && fill.t2 != null && (dir > 0 ? x.h >= fill.t2 : x.l <= fill.t2)) { legs.push({ d, t: x.t, f: 0.5, why: 'T2' }); break outer; }
      if (half && (dir > 0 ? x.l <= stopLvl - board.zone : x.h >= stopLvl + board.zone)) { legs.push({ d, t: x.t, f: 0.5, why: 'breakeven' }); break outer; }
    }
    const c = bs[bs.length - 1];
    if (c && !half && (dir > 0 ? c.c < stopLvl : c.c > stopLvl)) { legs.push({ d, t: c.t, f: 1, why: 'stop(close)' }); break; }
    if (d === holdDays[holdDays.length - 1] && c) { legs.push({ d, t: c.t, f: half ? 0.5 : 1, why: 'time' }); break; }
  }
  // underlying R (always) + option return (only if every leg is priced from the cache)
  let R = 0; for (const l of legs) { const ub = px(await minuteBars(SYM, l.d), l.t); l.u = ub; R += dir * (ub - fill.entry) / Math.abs(fill.entry - fill.stop) * l.f; }
  let r = e0 ? 0 : null; if (e0) for (const l of legs) { const ob = await optionBars(id, l.d); l.px = ob.length ? px(ob, l.t) : null; if (l.px == null) { r = null; break; } r += (l.px - e0) / e0 * l.f; }
  busyUntil = legs[legs.length - 1]?.d ?? D;
  trades.push({ D, et: hm(fill.t), chart: fill.tech.tag, chartN: fill.tech.n, aplusChart: fill.tech.aplusChart, dir: fill.dir, entry: fill.entry, stop: fill.stop, target: fill.target, rr: fill.rr, sweep: fill.sweep, contract: id, in: e0, exits: legs.map((l) => `${l.why}@${l.d.slice(5)} $${l.px}`).join(' · '), ret: r == null ? null : +r.toFixed(3), R: +R.toFixed(2), ...feat });
}

const $ = (v) => (v >= 0 ? '+' : '-') + '$' + Math.abs(v).toFixed(0);
const first = dmap.get(tdays[0]), last = dmap.get(tdays[tdays.length - 1]);
console.log(`\n=== A+ walk-forward${CHART ? ' (MAP + CHART)' : ' (map only)'} · ${SYM} · ${FROM} → ${TO} (${tdays.length} trading days) · ${SYM} ${first.o.toFixed(0)} → ${last.c.toFixed(0)} ===`);
console.log(`A+ setups found: ${found.length} on ${new Set(found.map((f) => f.D)).size} days · filled: ${trades.length}\n`);
console.log('-- every A+ setup the system saw (as of 09:35 that day) --');
for (const f of found) console.log(`  ${f.D} ${f.dir === 'up' ? 'BULL' : 'BEAR'} entry ${f.entry} stop ${f.stop} target ${f.target}${f.t2 ? ' / ' + f.t2 : ''} (R:R ${f.rr}) — ${f.status}\n      why: ${f.why}`);
console.log('\n-- trades (real option prices, $1k premium each) --');
for (const t of trades) console.log(`  ${t.D} ${t.et} ${t.dir === 'up' ? 'CALL' : 'PUT '} @${t.entry} → tgt ${t.target}  [chart ${t.chart} ${t.chartN}/4${t.aplusChart ? ' ✓A+chart' : ''}]  ${t.contract} in $${t.in} → ${t.exits}  =  ${t.ret == null ? 'unpriced' : (t.ret * 100).toFixed(0) + '%  (' + $(t.ret * 1000) + ')'}  R ${t.R}`);
const tot = trades.reduce((a, t) => a + (t.ret ?? 0), 0) * 1000;
console.log(`\nTOTAL: ${trades.length} trades · win ${trades.length ? Math.round(trades.filter((t) => t.R > 0).length / trades.length * 100) : 0}% · ${$(tot)} on $1k/trade${trades.filter((t) => t.sweep).length ? ` · with sweep: ${trades.filter((t) => t.sweep).length} trades ${$(trades.filter((t) => t.sweep).reduce((a, t) => a + t.ret, 0) * 1000)}` : ''}`);
fs.writeFileSync(path.join(HERE, 'journal', `aplus_walk.${SYM}.${FROM}_${TO}${CHART ? '.chart' : ''}.json`), JSON.stringify({ found, trades }, null, 1));
const acct1 = await account().catch(() => null); console.log(`credits used ${acct0 && acct1 ? acct0.creditsBalance - acct1.creditsBalance : '?'}`);
