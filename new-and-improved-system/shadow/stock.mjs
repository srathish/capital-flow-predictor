#!/usr/bin/env node
// Single-stock swing shadow test (weekly options), e.g.:  node shadow/stock.mjs --symbol MSFT --from 2026-07-01 --to 2026-10-02
// Each morning 09:35 ET: read the map on the nearest weekly expiry (≥2 DTE) → resting limits at the setup nodes
// (reverse rug / floor = long, rug / ceiling = short; OCO) → manage T1 (half + breakeven), T2, daily-close stop one node beyond,
// exit by the close the day before expiry (max 5 days). Priced on the REAL weekly contract's 1-min bars (UW). Never routes orders.
import fs from 'node:fs';
import path from 'node:path';
import { heatmapAt, account } from '../feeds/skylit.js';
import { normalizeBoard } from '../map/board.js';
import { hierarchy } from '../map/hierarchy.js';
import { regime as regimeOf } from '../map/regime.js';
import { rug, reverseRug } from '../map/patterns.js';
import { buildPlan } from '../execution/plan.js';
import { minuteBars, dailyBars, optionBars } from './cache.js';
import { occ } from '../feeds/uw.js';
import { etToUnix, iso } from '../lib/time.js';
import { projections } from '../chart/legs.js';
import { vixPivot, vixSide } from '../chart/vixpivot.js';
import { majorNodes } from '../map/board.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const SYM = arg('symbol', 'MSFT'), FROM = arg('from'), TO = arg('to');
const VAR = arg('criteria', 'current');
const CRIT = { current: {}, vix: { vixFilter: true }, std: { stdConfluence: true }, confluence: { stdConfluence: true, vixFilter: true }, calf: { calf: true, vixFilter: true }, calfnovix: { calf: true } }[VAR];
if (!CRIT) { console.error(`unknown --criteria ${VAR}`); process.exit(1); }
const REACH = 0.015, ZONE_PCT = 0.0015, MIN_RR = 2, MAX_DAYS = 5;
const HERE = decodeURIComponent(new URL('.', import.meta.url).pathname);
const CACHE = path.join(HERE, '..', '.cache', 'stock');

const ymd = (t) => new Date((t + 12 * 3600) * 1000).toISOString().slice(0, 10);
const dow = (d) => new Date(d + 'T12:00:00Z').getUTCDay();
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const ema = (vals, n) => { const k = 2 / (n + 1); let e = vals[0]; for (let i = 1; i < vals.length; i++) e = vals[i] * k + e * (1 - k); return e; };

// ---- trading calendar + daily bars (one long daily pull) ----
const dailyAll = (await dailyBars(SYM, TO)).concat(await dailyBars(SYM, addDays(FROM, 20))).concat(await dailyBars(SYM, addDays(FROM, 45))).concat(await dailyBars(SYM, addDays(FROM, 70)));
const dmap = new Map(); for (const b of dailyAll) dmap.set(ymd(b.t), b);
const days = [...dmap.keys()].sort();
const tradeDays = days.filter((d) => d >= FROM && d <= TO);
const isTradingDay = (d) => dmap.has(d) || d > days[days.length - 1];

function weeklyExpiry(d) {
  // this week's Friday if ≥2 trading days away, else next Friday; walk back to a trading day for holidays
  let f = addDays(d, (5 - dow(d) + 7) % 7);
  if (dow(d) >= 4) f = addDays(f, 7);
  while (!isTradingDay(f) && dow(f) >= 1) f = addDays(f, -1);
  return f;
}

async function boardAt(date, exp) {
  const f = path.join(CACHE, SYM, `${date}_${exp}.json`);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  let out = null;
  try { out = (await heatmapAt([SYM], iso(etToUnix(date, '09:35')), { expirations: exp }))[0] ?? null; }
  catch (e) { out = { error: String(e.message).slice(0, 160) }; }
  fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(out));
  return out;
}

// ---- option pricing on real minute bars ----
const SIDE = { close: 'c', high: 'h', low: 'l' };
function px(bars, t, side = 'close') { let best = null; for (const b of bars) { if (b.t > t) break; if (t - b.t <= 600) best = b; } return best ? best[SIDE[side]] : null; }
async function contractFor(exp, type, spot, date) {
  for (const step of [2.5, 5, 1]) {
    const k = Math.round(spot / step) * step, id = occ(SYM, exp, type, k);
    const bars = await optionBars(id, date);
    if (bars.length > 30) return { id, k };
  }
  return null;
}

const acct0 = await account().catch(() => null);
const plans = [], trades = [];
let busyUntilDay = null;

for (let di = 0; di < tradeDays.length; di++) {
  const D = tradeDays[di];
  if (busyUntilDay && D <= busyUntilDay) { plans.push({ D, status: 'in position' }); continue; }
  const exp = weeklyExpiry(D);
  const raw = await boardAt(D, exp);
  if (!raw || raw.error || !raw.strikes?.length) { plans.push({ D, exp, status: `no board (${raw?.error ?? 'empty'})` }); continue; }
  const board = normalizeBoard({ ...raw, symbol: SYM }); board.zone = board.spot * ZONE_PCT;
  const hier = hierarchy(board), reg = regimeOf(board);
  const rr = reverseRug(board), rg = rug(board);
  // charts first (daily): trend from prior closes
  const prior = days.filter((d) => d < D).slice(-60).map((d) => dmap.get(d).c);
  const prevClose = prior[prior.length - 1], e20 = ema(prior.slice(-40), 20), e50 = ema(prior, 50);
  const chart = prevClose > e20 && e20 > e50 ? 'up' : prevClose < e20 && e20 < e50 ? 'down' : 'mixed';

  const cands = [];
  const add = (direction, node, setup) => {
    if (!node || Math.abs(node.strike - board.spot) / board.spot > REACH) return;
    if (direction === 'up' && node.strike > board.spot + board.zone) return;
    if (direction === 'down' && node.strike < board.spot - board.zone) return;
    const plan = buildPlan({ board, hier, direction, entryNode: node });
    if (!plan.ok || plan.rr < MIN_RR) return;
    cands.push({ direction, node, setup, plan, chartOk: chart === 'mixed' || (chart === 'up') === (direction === 'up') });
  };
  if (CRIT.calf) {
    // calf: every major node in reach is a candidate; direction is decided at the touch by the std-dev projection on it
    for (const n of majorNodes(board)) if (Math.abs(n.strike - board.spot) / board.spot <= REACH) cands.push({ direction: null, node: n, setup: 'calf', plan: null, chartOk: true });
  } else {
    add('up', rr.detected ? rr.reactionNode : null, 'reverse_rug');
    if (!cands.some((c) => c.direction === 'up')) add('up', hier.floor, 'floor');
    add('down', rg.detected ? rg.reactionNode : null, 'rug');
    if (!cands.some((c) => c.direction === 'down')) add('down', hier.ceiling, 'ceiling');
  }
  plans.push({ D, exp, spot: board.spot, king: hier.king?.strike, floor: hier.floor?.strike, ceiling: hier.ceiling?.strike, regime: reg.label, chart, cands: cands.map((c) => `${c.setup}@${c.node.strike} ${c.direction ?? '?'}${c.plan ? ` rr${c.plan.rr}` : ''}${c.chartOk ? '' : ' (vs chart)'}`) });
  if (!cands.length) continue;

  // ---- intraday: OCO resting limits, first touch that PASSES THE GATES fills ----
  const bars = await minuteBars(SYM, D);
  const vixMin = (CRIT.vixFilter) ? await minuteBars('VIX', D) : null, vp = CRIT.vixFilter ? vixPivot(await dailyBars('VIX', D), D) : null;
  const startT = etToUnix(D, '09:35'), lastEntry = etToUnix(D, '15:30');
  const gate = { vix: 0, std: 0, rr: 0 };
  let fill = null;
  for (let bi = 0; bi < bars.length && !fill; bi++) {
    const b = bars[bi];
    if (b.t < startT || b.t > lastEntry) continue;
    for (const c of cands) {
      if (!(b.l <= c.node.strike + board.zone && b.h >= c.node.strike - board.zone)) continue;
      let direction = c.direction, plan = c.plan, setup = c.setup;
      const needStd = CRIT.calf || CRIT.stdConfluence;
      const pr = needStd ? projections(bars.slice(0, bi + 1)).filter((l) => Math.abs(l.level - c.node.strike) <= board.zone).sort((x, y) => y.k - x.k) : [];
      if (CRIT.calf) {
        if (!pr.length) { gate.std++; continue; }
        direction = pr[0].fade; setup = `std${pr[0].k}_${c.node.skylitType}`;
        plan = buildPlan({ board, hier, direction, entryNode: c.node });
        if (!plan.ok || plan.rr < MIN_RR) { gate.rr++; continue; }
      } else if (CRIT.stdConfluence) {
        const al = pr.filter((l) => l.fade === direction); if (!al.length) { gate.std++; continue; }
        setup = `${setup}+std${al[0].k}`;
      }
      if (CRIT.vixFilter) { const s = vixSide(vixMin, vp, b.t); if (direction === 'up' ? s !== 'below' : s !== 'above') { gate.vix++; continue; } }
      fill = { ...c, direction, plan, setup, t: b.t }; break;
    }
  }
  if (!fill) { plans[plans.length - 1].status = `no fill (blocked: std ${gate.std}, vix ${gate.vix}, rr ${gate.rr})`; continue; }

  // ---- contract ----
  const type = fill.direction === 'up' ? 'call' : 'put';
  const ct = await contractFor(exp, type, fill.node.strike, D);
  if (!ct) { plans[plans.length - 1].status = 'no contract data'; continue; }
  const entryBars = await optionBars(ct.id, D);
  const eMid = px(entryBars, fill.t, 'close'), eWorst = px(entryBars, fill.t, 'high');
  if (!eMid) { plans[plans.length - 1].status = 'no option print at fill'; continue; }

  // ---- manage: walk the fill day + following days ----
  const dir = fill.direction === 'up' ? 1 : -1, P = fill.plan, entryU = fill.node.strike;
  const lastDay = days.filter((d) => d > D && d < exp).slice(-1)[0] ?? D;             // close of the day before expiry
  const holdDays = days.filter((d) => d >= D && d <= lastDay).slice(0, MAX_DAYS);
  let half = false, stopLvl = P.stop, legs = [];
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
  for (const l of legs) {
    const ob = await optionBars(ct.id, l.d);
    l.oMid = px(ob, l.t, 'close') ?? 0; l.oWorst = px(ob, l.t, 'low') ?? 0;
    rMid += (l.oMid - eMid) / eMid * l.frac; rWorst += (l.oWorst - eWorst) / eWorst * l.frac;
  }
  const exitDay = legs[legs.length - 1]?.d ?? D;
  busyUntilDay = exitDay;
  trades.push({ D, et: new Date((fill.t - 4 * 3600) * 1000).toISOString().slice(11, 16), setup: fill.setup, direction: fill.direction, node: entryU, nodeType: fill.node.skylitType, stop: P.stop, t1: P.t1, t2: P.t2, rr: P.rr, chart, chartOk: fill.chartOk,
    contract: ct.id, entryOpt: eMid, exits: legs.map((l) => `${l.why}@${l.d.slice(5)} $${l.oMid}`).join(' · '), exitDay, retMid: +rMid.toFixed(3), retWorst: +rWorst.toFixed(3) });
  plans[plans.length - 1].status = `FILLED ${fill.setup} ${fill.direction}`;
}

// ---- report ----
const sum = (a) => a.reduce((x, y) => x + y, 0), mean = (a) => (a.length ? sum(a) / a.length : 0);
const sd = (a) => { const m = mean(a); return Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / Math.max(1, a.length - 1)); };
const line = (label, T) => T.length ? `${label.padEnd(26)} n=${String(T.length).padStart(2)}  win ${String(Math.round(T.filter((x) => x.retMid > 0).length / T.length * 100)).padStart(3)}%  @$1k/trade mid ${(sum(T.map((x) => x.retMid)) * 1000 >= 0 ? '+' : '-')}$${Math.abs(sum(T.map((x) => x.retMid)) * 1000).toFixed(0)}  worst ${(sum(T.map((x) => x.retWorst)) * 1000 >= 0 ? '+' : '-')}$${Math.abs(sum(T.map((x) => x.retWorst)) * 1000).toFixed(0)}  avg ${(mean(T.map((x) => x.retMid)) * 100).toFixed(0)}%  SQN ${(T.length > 1 ? Math.sqrt(T.length) * mean(T.map((x) => x.retMid)) / (sd(T.map((x) => x.retMid)) || 1) : 0).toFixed(2)}` : `${label.padEnd(26)} n= 0`;
const first = dmap.get(tradeDays[0]), last = dmap.get(tradeDays[tradeDays.length - 1]);
console.log(`\n=========== ${SYM} weekly-option swing shadow · ${FROM} → ${TO} · ${tradeDays.length} trading days · criteria=${VAR} ===========`);
console.log(`${SYM} itself: ${first.o.toFixed(2)} → ${last.c.toFixed(2)} (${((last.c / first.o - 1) * 100).toFixed(1)}%)`);
console.log(line('ALL trades', trades));
console.log(line('  chart-aligned only', trades.filter((x) => x.chartOk)));
console.log(line('  against chart', trades.filter((x) => !x.chartOk)));
for (const k of ['reverse_rug', 'floor', 'rug', 'ceiling']) console.log(line(`  ${k}`, trades.filter((x) => x.setup === k)));
console.log(line('  longs', trades.filter((x) => x.direction === 'up')));
console.log(line('  shorts', trades.filter((x) => x.direction === 'down')));
const st = {}; for (const p of plans) { const k = (p.status || (p.cands?.length ? 'planned' : 'no setup in reach')).replace(/\(.*\)/, '').trim(); st[k] = (st[k] || 0) + 1; }
console.log('\nday outcomes:', Object.entries(st).map(([k, v]) => `${k} ${v}`).join(' · '));
console.log('\n-- every trade --');
for (const x of trades) console.log(`  ${x.D} ${x.et} ${x.direction === 'up' ? 'CALL' : 'PUT '} ${x.setup.padEnd(11)} @${x.node} (${x.nodeType}) stop ${x.stop} T1 ${x.t1} T2 ${x.t2} rr ${x.rr} ${x.chartOk ? '' : '[vs chart]'}  ${x.contract} in $${x.entryOpt} → ${x.exits}  =  ${(x.retMid * 100).toFixed(0)}%`);
fs.mkdirSync(path.join(HERE, 'journal'), { recursive: true });
fs.writeFileSync(path.join(HERE, 'journal', `stock.${SYM}.${FROM}_${TO}.${VAR}.json`), JSON.stringify({ plans, trades }, null, 1));
const acct1 = await account().catch(() => null);
console.log(`\ncredits used ${acct0 && acct1 ? acct0.creditsBalance - acct1.creditsBalance : '?'}`);
