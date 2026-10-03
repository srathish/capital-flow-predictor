#!/usr/bin/env node
// stock3 — Glitch-faithful entries, PRE-REGISTERED 2026-10-03 before any run (rules below are frozen for this test).
//
//  R3  BREAK → HOLD → RETEST (S/R flip). Day D: a major node from D's 09:35 map is crossed during the session and the DAILY
//      close holds beyond it by ≥ the deflection zone ("break and hold", higher-timeframe confirmation — Glitch: never play
//      retests on lower timeframes). For the next 1–3 sessions: buy the RETEST of that level from the new side
//      (uptrend: old ceiling → new floor → calls; downtrend: mirror → puts). Entry = first 1-min bar that tags the level
//      (±zone) and closes on the right side (it held). Invalidated by a daily close back through the level.
//  R1g RULE 1 + Glitch filters (anticipating the break at the first touch, VEX lean, as validated) — for comparison.
//
//  Glitch filters on BOTH: no entries before 10:15 ET (wait for the reshuffle) or 11:30–13:30 (lunch chop) or after 15:30;
//  no 3rd+ tap of the level today; daily trend aligned; INDEX veto (no longs while SPY's daily trend is down, no shorts while up);
//  earnings blackout over the holding window. Management identical to the validated engine (T1 half → breakeven, T2,
//  daily-close stop, exit the day before expiry, ≤5 days), priced on real weekly-option minute bars.
//
//  node shadow/stock3.mjs --symbol MSFT --from 2026-01-02 --to 2026-03-31 --criteria r3|r3_novix|r1g
import fs from 'node:fs';
import path from 'node:path';
import { heatmapAt, account, atlasHistory } from '../feeds/skylit.js';
import { normalizeBoard, majorNodes } from '../map/board.js';
import { hierarchy } from '../map/hierarchy.js';
import { buildPlan } from '../execution/plan.js';
import { tapCount } from '../map/living.js';
import { minuteBars, optionBars } from './cache.js';
import { occ } from '../feeds/uw.js';
import { etToUnix, iso } from '../lib/time.js';
import { PARAMS, RULES, dailyTrend, planDay, evaluateTouch, vexLean } from '../system/stockrules.js';
import { earningsDates, earningsIn, board as cachedBoard } from './features.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const SYM = arg('symbol', 'MSFT'), FROM = arg('from'), TO = arg('to'), VAR = arg('criteria', 'r3');
if (!['r3', 'r1g', 'r3t', 'g1', 'r1t'].includes(VAR)) { console.error('criteria: r3 | r1g | r3t | g1 | r1t'); process.exit(1); }
// r1t (pre-registered 2026-10-03 after 'buy time' cut losses in every variant): Rule 1 exactly as validated (no Glitch clock/tap/index filters) but with ≥14-DTE contracts, hold ≤10 days.
// "BUY TIME" (Glitch: 54% same-day vs 320% two weeks out; Giul's MSFT swing was 7 weeks out): r3t/g1 buy the first Friday
// ≥14 calendar days out and hold up to 10 trading days. The MAP still comes from the nearest weekly (cached; Giul: "play the
// current week GEX map"). PRE-REGISTERED 2026-10-03 before running.
const BUY_TIME = VAR === 'r3t' || VAR === 'g1' || VAR === 'r1t';
const { REACH, ZONE_PCT, MIN_RR } = PARAMS;
const MAX_DAYS = (['r3t', 'g1', 'r1t'].includes(arg('criteria', 'r3'))) ? 10 : PARAMS.MAX_DAYS;
const RETEST_DAYS = 3;
const HERE = decodeURIComponent(new URL('.', import.meta.url).pathname);
const ymd = (t) => new Date((t + 12 * 3600) * 1000).toISOString().slice(0, 10);
const dow = (d) => new Date(d + 'T12:00:00Z').getUTCDay();
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const hmOf = (t) => new Date((t - 4 * 3600) * 1000).toISOString().slice(11, 16);
const glitchClock = (t) => { const h = hmOf(t); return h >= '10:15' && h <= '15:30' && !(h >= '11:30' && h < '13:30'); };

const span = [etToUnix(FROM, '09:30') - 200 * 86400, etToUnix(TO, '16:00') + 86400];
const daily = await atlasHistory(SYM, 'D', ...span), spyD = await atlasHistory('SPY', 'D', ...span);
const dmap = new Map(daily.map((b) => [ymd(b.t), b])), smap = new Map(spyD.map((b) => [ymd(b.t), b]));
const days = [...dmap.keys()].sort(), tradeDays = days.filter((d) => d >= FROM && d <= TO);
const isTradingDay = (d) => dmap.has(d) || d > days[days.length - 1];
function contractExpiry(d) { if (!BUY_TIME) return weeklyExpiry(d); let f = addDays(d, 14); while (dow(f) !== 5) f = addDays(f, 1); while (!isTradingDay(f) && dow(f) >= 1) f = addDays(f, -1); return f; }
function weeklyExpiry(d) { let f = addDays(d, (5 - dow(d) + 7) % 7); if (dow(d) >= 4) f = addDays(f, 7); while (!isTradingDay(f) && dow(f) >= 1) f = addDays(f, -1); return f; }
const trendAt = (map, keys, d) => dailyTrend(keys.filter((x) => x < d).map((x) => map.get(x).c));
const spyKeys = [...smap.keys()].sort();
const SIDE = { close: 'c', high: 'h', low: 'l' };
// option price at t: the last real print at/before t that day; if none yet, the next print after t. (A fixed 10-min lookback
// returned null → $0 on thinly traded longer-dated contracts, booking fake −100% legs.)
const px = (bars, t, side = 'close') => { let best = null; for (const b of bars) { if (b.t > t) break; best = b; } if (!best) best = bars.find((b) => b.t > t) ?? null; return best ? best[SIDE[side]] : null; };
async function contractFor(exp, type, strike, date) { for (const step of [2.5, 5, 1]) { const k = Math.round(strike / step) * step, id = occ(SYM, exp, type, k); if ((await optionBars(id, date)).length > 30) return { id, k }; } return null; }
const earn = await earningsDates(SYM);

const acct0 = await account().catch(() => null);
const trades = [], log = [];
let busyUntil = null, flips = [];

for (const D of tradeDays) {
  const exp = weeklyExpiry(D), cexp = contractExpiry(D);
  const raw = await cachedBoard(SYM, D, exp, 'gamma');
  const hasBoard = raw && !raw.error && raw.strikes?.length;
  const bars = await minuteBars(SYM, D);
  const chart = trendAt(dmap, days, D), spy = trendAt(smap, spyKeys, D);
  const holdEnd = days.filter((d) => d >= D && d < cexp).slice(0, MAX_DAYS).slice(-1)[0] ?? D;
  const blackout = earningsIn(earn, D, holdEnd);
  const indexOk = (dir) => (dir === 'up' ? spy !== 'down' : spy !== 'up');

  if (!(busyUntil && D <= busyUntil) && hasBoard && !blackout) {
    const day = planDay(SYM, raw), board = day.board, hier = day.hier;
    let fill = null; const gate = {};
    const bump = (g) => (gate[g] = (gate[g] || 0) + 1);
    if (VAR === 'r3' || VAR === 'r3t') {
      // candidates = live flips (created on a prior day, not expired/invalidated), in the trend's and the index's direction
      for (const f of flips.filter((f) => D > f.created && D <= f.expires && !f.used)) {
        if (f.dir !== chart) { bump('trend'); continue; }
        if (!indexOk(f.dir)) { bump('index'); continue; }
        const node = { strike: f.level, skylitType: 'flip', sign: 'flip', share: 0 };
        const plan = buildPlan({ board, hier, direction: f.dir, entryNode: node });
        if (!plan.ok || plan.rr < MIN_RR) { bump('rr'); continue; }
        for (let bi = 0; bi < bars.length && !fill; bi++) {
          const b = bars[bi]; if (!glitchClock(b.t)) continue;
          const tagged = b.l <= f.level + board.zone && b.h >= f.level - board.zone;
          if (!tagged) continue;
          const held = f.dir === 'up' ? b.c >= f.level - board.zone : b.c <= f.level + board.zone;
          if (!held) { bump('no_hold'); continue; }
          if (tapCount(bars.slice(0, bi), f.level, board.zone).taps >= 2) { bump('tap3+'); continue; }
          fill = { direction: f.dir, plan, setup: `flip_${f.from}`, node, t: b.t }; f.used = true;
        }
        if (fill) break;
      }
    } else if (VAR === 'g1') {
      // Giul's dip-buy: uptrend + index not down; buy the retest that HOLDS at the floor or the king below spot
      const cands = [hier.floor, hier.king].filter((n, i, a) => n && !n.above && a.findIndex((m) => m && m.strike === n.strike) === i && (board.spot - n.strike) / board.spot <= REACH);
      if (chart !== 'up') bump('trend'); else if (!indexOk('up')) bump('index');
      else for (const n of cands) {
        const plan = buildPlan({ board, hier, direction: 'up', entryNode: n });
        if (!plan.ok || plan.rr < MIN_RR) { bump('rr'); continue; }
        for (let bi = 0; bi < bars.length && !fill; bi++) {
          const b = bars[bi]; if (!glitchClock(b.t)) continue;
          if (!(b.l <= n.strike + board.zone && b.h >= n.strike - board.zone)) continue;
          if (b.c < n.strike - board.zone) { bump('no_hold'); continue; }
          if (tapCount(bars.slice(0, bi), n.strike, board.zone).taps >= 2) { bump('tap3+'); continue; }
          fill = { direction: 'up', plan, setup: `dip_${n.skylitType}`, node: n, t: b.t };
        }
        if (fill) break;
      }
    } else {
      // R1g: Rule 1 (validated logic via the shared module) + Glitch clock, tap and index filters
      const vex = day.cands.length ? vexLean(await cachedBoard(SYM, D, exp, 'vanna')) : null; // only fetch VEX when a setup exists (as the validated engine did → cached)
      for (let bi = 0; bi < bars.length && !fill; bi++) {
        const b = bars[bi];
        const G = VAR === 'r1g';  // Glitch filters only for r1g; r1t = Rule 1 as validated (09:35–15:30 window)
        if (G ? !glitchClock(b.t) : (hmOf(b.t) < '09:35' || hmOf(b.t) > '15:30')) continue;
        for (const c of day.cands) {
          const r = evaluateTouch({ crit: RULES.R1_break_with_trend, c, board, hier, bars, bi, chart, vex });
          if (!r.ok) { if (r.gate !== 'no_touch') bump(r.gate); continue; }
          if (G && !indexOk(r.direction)) { bump('index'); continue; }
          if (G && tapCount(bars.slice(0, bi), c.node.strike, board.zone).taps >= 2) { bump('tap3+'); continue; }
          fill = { direction: r.direction, plan: r.plan, setup: r.setup, node: c.node, t: b.t }; break;
        }
      }
    }
    if (fill) {
      const type = fill.direction === 'up' ? 'call' : 'put';
      const ct = await contractFor(cexp, type, fill.node.strike, D);
      const eb = ct ? await optionBars(ct.id, D) : [];
      const eMid = px(eb, fill.t), eWorst = px(eb, fill.t, 'high');
      if (ct && eMid) {
        const dir = fill.direction === 'up' ? 1 : -1, P = fill.plan, entryU = fill.node.strike;
        const holdDays = days.filter((d) => d >= D && d <= holdEnd).slice(0, MAX_DAYS);
        let half = false, stopLvl = P.stop; const legs = [];
        outer: for (const d of holdDays) {
          const bs = (await minuteBars(SYM, d)).filter((b) => d !== D || b.t > fill.t);
          for (const b of bs) {
            if (!half && P.t1 != null && (dir > 0 ? b.h >= P.t1 : b.l <= P.t1)) { legs.push({ d, t: b.t, frac: 0.5, why: 'T1' }); half = true; stopLvl = entryU; }
            if (half && P.t2 != null && (dir > 0 ? b.h >= P.t2 : b.l <= P.t2)) { legs.push({ d, t: b.t, frac: 0.5, why: 'T2' }); break outer; }
            if (half && (dir > 0 ? b.l <= stopLvl - board.zone : b.h >= stopLvl + board.zone)) { legs.push({ d, t: b.t, frac: 0.5, why: 'breakeven' }); break outer; }
          }
          const close = bs.length ? bs[bs.length - 1] : null;
          if (close && !half && (dir > 0 ? close.c < stopLvl : close.c > stopLvl)) { legs.push({ d, t: close.t, frac: 1, why: 'stop(close)' }); break; }
          if (d === holdDays[holdDays.length - 1] && close) { legs.push({ d, t: close.t, frac: half ? 0.5 : 1, why: 'time' }); break; }
        }
        let rMid = 0, rWorst = 0;
        for (const l of legs) { const ob = await optionBars(ct.id, l.d); l.o = px(ob, l.t) ?? 0; rMid += (l.o - eMid) / eMid * l.frac; rWorst += ((px(ob, l.t, 'low') ?? 0) - eWorst) / eWorst * l.frac; }
        busyUntil = legs[legs.length - 1]?.d ?? D;
        trades.push({ D, et: hmOf(fill.t), setup: fill.setup, direction: fill.direction, level: entryU, stop: P.stop, t1: P.t1, t2: P.t2, rr: P.rr, chart, spy, contract: ct.id, entryOpt: eMid,
          exits: legs.map((l) => `${l.why}@${l.d.slice(5)} $${l.o}`).join(' · '), retMid: +rMid.toFixed(3), retWorst: +rWorst.toFixed(3) });
      }
    }
    log.push({ D, chart, spy, flips: flips.filter((f) => D > f.created && D <= f.expires).map((f) => `${f.dir}@${f.level}`), gate, filled: !!fill });
  }

  // ---- end of day D: update flips (break + HOLD on the daily close) and invalidate failed ones ----
  const dc = dmap.get(D);
  for (const f of flips) if (!f.used && D > f.created && (f.dir === 'up' ? dc.c < f.level - f.zone : dc.c > f.level + f.zone)) f.used = true; // failed flip
  if (hasBoard && (VAR === 'r3' || VAR === 'r3t')) {
    const board = normalizeBoard({ ...raw, symbol: SYM }); const zone = board.spot * ZONE_PCT;
    const crossedUp = majorNodes(board).filter((n) => Math.abs(n.strike - board.spot) / board.spot <= REACH && dc.o < n.strike && dc.c >= n.strike + zone);
    const crossedDn = majorNodes(board).filter((n) => Math.abs(n.strike - board.spot) / board.spot <= REACH && dc.o > n.strike && dc.c <= n.strike - zone);
    const pick = (arr) => arr.sort((a, b) => b.abs - a.abs)[0];
    const exp3 = days.filter((d) => d > D).slice(0, RETEST_DAYS).slice(-1)[0] ?? addDays(D, RETEST_DAYS + 2);
    const up = pick(crossedUp), dn = pick(crossedDn);
    if (up) flips.push({ dir: 'up', level: up.strike, from: up.skylitType, created: D, expires: exp3, zone, used: false });
    if (dn) flips.push({ dir: 'down', level: dn.strike, from: dn.skylitType, created: D, expires: exp3, zone, used: false });
  }
  flips = flips.filter((f) => !f.used && f.expires >= D);
}

// ---- report ----
const $ = (v) => (v >= 0 ? '+' : '-') + '$' + Math.abs(v).toFixed(0);
const sum = (a) => a.reduce((x, y) => x + y, 0);
console.log(`\n=== ${SYM} ${FROM}→${TO} · ${VAR} · ${tradeDays.length} days ===`);
console.log(`trades ${trades.length}  win ${trades.length ? Math.round(trades.filter((x) => x.retMid > 0).length / trades.length * 100) : 0}%  @$1k/trade mid ${$(sum(trades.map((x) => x.retMid)) * 1000)}  worst ${$(sum(trades.map((x) => x.retWorst)) * 1000)}`);
for (const x of trades) console.log(`  ${x.D} ${x.et} ${x.direction === 'up' ? 'CALL' : 'PUT '} ${x.setup.padEnd(16)} @${x.level} stop ${x.stop} T1 ${x.t1} T2 ${x.t2} ${x.contract} in $${x.entryOpt} → ${x.exits} = ${(x.retMid * 100).toFixed(0)}%`);
fs.mkdirSync(path.join(HERE, 'journal'), { recursive: true });
fs.writeFileSync(path.join(HERE, 'journal', `stock3.${SYM}.${FROM}_${TO}.${VAR}.json`), JSON.stringify({ trades, log }, null, 1));
const acct1 = await account().catch(() => null);
console.log(`credits used ${acct0 && acct1 ? acct0.creditsBalance - acct1.creditsBalance : '?'}`);
