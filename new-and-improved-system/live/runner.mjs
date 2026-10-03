#!/usr/bin/env node
// FORWARD-SHADOW RUNNER for the v1 stock rules (SYSTEM_RULES.md). NEVER sends orders — it logs the trades it WOULD take.
//   node live/runner.mjs --live                         run today in real time (09:35 plan → minute watch → 15:59 close)
//   node live/runner.mjs --replay 2026-07-01 2026-10-02 push past days through the SAME code (regression vs the backtest)
// Optional: --symbols AAPL,NVDA,...  (default: the 10 validated names)
// Out: live/journal/<mode>/<date>.jsonl (every event), live/state/<mode>.json (open positions), live/journal/<mode>/book.json
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { RULES, PARAMS, dailyTrend, vexLean, planDay, evaluateTouch, manageBar, manageClose } from '../system/stockrules.js';
import { vixPivot } from '../chart/vixpivot.js';
import { earningsDates, earningsIn, board as histBoard } from '../shadow/features.js';
import { minuteBars, dailyBars, optionBars } from '../shadow/cache.js';
import { heatmapLive, atlasHistory, optionChain, account, mcp } from '../feeds/skylit.js';
import { occ } from '../feeds/uw.js';
import { etToUnix, todayET } from '../lib/time.js';

const argv = process.argv.slice(2);
const MODE = argv.includes('--live') ? 'live' : argv.includes('--replay') ? 'replay' : null;
if (!MODE) { console.error('usage: --live | --replay FROM TO'); process.exit(1); }
const SYMS = (argv.find((a) => a.startsWith('--symbols='))?.split('=')[1] ?? 'AAPL,NVDA,AMZN,META,GOOGL,AMD,TSLA,AVGO,ORCL,MSFT').split(',');
const HERE = decodeURIComponent(new URL('.', import.meta.url).pathname);
const JDIR = path.join(HERE, 'journal', MODE), SDIR = path.join(HERE, 'state');
fs.mkdirSync(JDIR, { recursive: true }); fs.mkdirSync(SDIR, { recursive: true });
const STATE = path.join(SDIR, `${MODE}.json`);
let RUN_FROM = null, RUN_TO = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ymd = (t) => new Date((t + 12 * 3600) * 1000).toISOString().slice(0, 10);
const dow = (d) => new Date(d + 'T12:00:00Z').getUTCDay();
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const hm = (t) => new Date((t - 4 * 3600) * 1000).toISOString().slice(11, 16);
const ROOT = { };
const notify = (msg) => { if (MODE !== 'live') return; execFile('osascript', ['-e', `display notification ${JSON.stringify(msg)} with title "Skylit shadow"`], () => {}); };

// ---------------- calendar (from Atlas daily; replay uses cache) ----------------
const cal = new Set();
// full daily history, fetched ONCE per symbol per run (trend needs ~60 prior closes; calendar spans the whole replay)
const dailyMem = {};
async function dailyHist(sym, upTo, from = null) {
  if (!dailyMem[sym]) { const end = etToUnix(upTo, '16:00') + 86400, start = (from ? etToUnix(from, '09:30') : end) - 200 * 86400; dailyMem[sym] = await atlasHistory(sym, 'D', start, end); }
  return dailyMem[sym];
}
async function loadCalendar(upTo, from) { for (const b of await dailyHist('SPY', upTo, from)) cal.add(ymd(b.t)); }
const isTradingDay = (d, lastKnown) => cal.has(d) || (d > lastKnown && dow(d) >= 1 && dow(d) <= 5);
function weeklyExpiry(d, lastKnown) {
  let f = addDays(d, (5 - dow(d) + 7) % 7);
  if (dow(d) >= 4) f = addDays(f, 7);
  while (!isTradingDay(f, lastKnown) && dow(f) >= 1) f = addDays(f, -1);
  return f;
}

// ---------------- data providers ----------------
function provider(D) {
  if (MODE === 'replay') { const mem = {}; const day = async (s) => (mem[s] ??= await minuteBars(s, D)); return {
    gamma: async (sym, exp) => histBoard(sym, D, exp, 'gamma'),
    vanna: async (sym, exp) => histBoard(sym, D, exp, 'vanna'),
    bars: async (sym, upTo) => (await day(sym)).filter((b) => b.t <= upTo),
    vixBars: async (upTo) => (await day('VIX')).filter((b) => b.t <= upTo),
    optPrice: async (sym, exp, type, strike, t, day) => {
      for (const step of [2.5, 5, 1]) { const k = Math.round(strike / step) * step, id = occ(sym, exp, type, k); const ob = await optionBars(id, day ?? D);
        if (ob.length > 30) { let best = null; for (const b of ob) { if (b.t > t) break; if (t - b.t <= 600) best = b; } if (best) return { id, k, price: best.c, worst: best.h }; } }
      return null;
    },
  }; }
  // LIVE: one batched heatmap call per metric (≤10 symbols), Atlas minute polling, Skylit option_chain for the contract price
  const boardCache = {};
  return {
    gamma: async (sym, exp) => (boardCache[`g${exp}`] ??= Object.fromEntries((await heatmapLive(SYMS, { metric: 'gamma', expirations: exp }).catch(() => [])).map((s) => [s.symbol, s])))[sym] ?? null,
    vanna: async (sym, exp) => (boardCache[`v${exp}`] ??= Object.fromEntries((await heatmapLive(SYMS, { metric: 'vanna', expirations: exp }).catch(() => [])).map((s) => [s.symbol, s])))[sym] ?? null,
    bars: async (sym, upTo) => atlasHistory(sym, '1', etToUnix(D, '09:30'), upTo),
    vixBars: async (upTo) => atlasHistory('VIX', '1', etToUnix(D, '09:30'), upTo),
    optPrice: async (sym, exp, type, strike) => {
      const oc = await optionChain(sym, exp).catch(() => null); const rows = oc?.data?.strikes || []; if (!rows.length) return null;
      const r = rows.slice().sort((a, b) => Math.abs(a.strike - strike) - Math.abs(b.strike - strike))[0];
      const p = type === 'call' ? r.callLastPrice : r.putLastPrice;
      return p ? { id: occ(sym, exp, type, r.strike), k: r.strike, price: p, worst: p, iv: type === 'call' ? r.callIv : r.putIv } : null;
    },
  };
}

// ---------------- state + journal ----------------
const state = fs.existsSync(STATE) && MODE === 'live' ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { open: [], closed: [] };
const save = () => fs.writeFileSync(STATE, JSON.stringify(state, null, 1));
let jf = null; const log = (ev) => { fs.appendFileSync(jf, JSON.stringify({ at: new Date().toISOString(), ...ev }) + '\n'); };

async function runDay(D, lastKnown) {
  jf = path.join(JDIR, `${D}.jsonl`); if (MODE === 'replay') fs.writeFileSync(jf, '');
  const P = provider(D), exp = weeklyExpiry(D, lastKnown);
  const priorDays = [...cal].filter((d) => d < D).sort();
  const lastHoldDayFor = () => { const hold = [...cal].filter((d) => d >= D && d < exp).sort(); const lim = hold.length ? hold : [D]; return lim.slice(0, PARAMS.MAX_DAYS).slice(-1)[0] ?? D; };
  const vp = vixPivot(await dailyHist('VIX', RUN_TO, RUN_FROM), D);

  // ---- 09:35 PLAN ----
  if (MODE === 'live') { const t0 = etToUnix(D, '09:35') + 20; while (Date.now() / 1000 < t0) await sleep(5000); }
  const plans = {};
  for (const sym of SYMS) {
    const busy = Object.keys(RULES).filter((r) => state.open.some((p) => p.sym === sym && p.rule === r));
    if (busy.length === Object.keys(RULES).length) { log({ ev: 'plan', sym, status: 'in position (all rules)' }); continue; }
    const raw = await P.gamma(sym, exp);
    if (!raw || raw.error || !raw.strikes?.length) { log({ ev: 'plan', sym, exp, status: 'no board', err: raw?.error }); continue; }
    const day = planDay(sym, raw);
    if (!day.cands.length) { log({ ev: 'plan', sym, exp, spot: raw.spot, status: 'no setup in reach' }); continue; }
    const closes = (await dailyHist(sym, RUN_TO, RUN_FROM)).filter((b) => ymd(b.t) < D).map((b) => b.c);
    const chart = dailyTrend(closes);
    const holdEnd = lastHoldDayFor();
    const earn = earningsIn(await earningsDates(sym), D, holdEnd);
    if (earn) { log({ ev: 'plan', sym, exp, status: `earnings blackout (${earn})` }); continue; }
    const vex = vexLean(await P.vanna(sym, exp));
    plans[sym] = { ...day, chart, vex, holdEnd, busy, lastBi: -1 };
    log({ ev: 'plan', sym, exp, spot: raw.spot, chart, vex, vixPivot: vp, cands: day.cands.map((c) => `${c.setup}@${c.node.strike} ${c.direction} rr${c.plan.rr}`) });
  }
  if (MODE === 'live') notify(`09:35 plan: ${Object.keys(plans).length} names live — ${Object.entries(plans).map(([s, p]) => `${s} ${p.cands.map((c) => c.node.strike).join('/')}`).join(', ').slice(0, 180)}`);

  // ---- MINUTE LOOP ----
  const lastEntry = etToUnix(D, '15:30'), closeT = etToUnix(D, '15:59');
  const gates = {};
  const step = async (upTo) => {
    const vixMin = await P.vixBars(upTo);
    const active = new Set([...Object.keys(plans), ...state.open.map((p) => p.sym)]);
    for (const sym of active) {
      const bars = await P.bars(sym, upTo); if (!bars.length) continue;
      // manage open positions on new bars
      for (const pos of state.open.filter((p) => p.sym === sym)) {
        for (const b of bars) { if (b.t <= pos.lastT) continue; pos.lastT = b.t;
          for (const leg of manageBar(pos, b)) { const q = await P.optPrice(sym, pos.exp, pos.type, pos.k, b.t); bookLeg(pos, leg, b, q, D); }
          if (pos.closed) break; }
      }
      // new entries
      const pl = plans[sym]; if (!pl) continue;
      for (let bi = pl.lastBi + 1; bi < bars.length; bi++) {
        pl.lastBi = bi; const b = bars[bi];
        if (b.t < etToUnix(D, '09:35') || b.t > lastEntry) continue;
        for (const [rule, crit] of Object.entries(RULES)) {
          if (state.open.some((p) => p.sym === sym && p.rule === rule) || pl.busy.includes(rule)) continue;
          for (const c of pl.cands) {
            const r = evaluateTouch({ crit, c, board: pl.board, hier: pl.hier, bars, bi, chart: pl.chart, vex: pl.vex, vixMin, vixPiv: vp });
            if (!r.ok) { if (r.gate !== 'no_touch') gates[`${sym}:${rule}:${r.gate}`] = (gates[`${sym}:${rule}:${r.gate}`] || 0) + 1; continue; }
            const type = r.direction === 'up' ? 'call' : 'put';
            const q = await P.optPrice(sym, exp, type, c.node.strike, b.t);
            if (!q) { log({ ev: 'entry_skipped', sym, rule, why: 'no option price' }); continue; }
            const pos = { sym, rule, setup: r.setup, direction: r.direction, type, exp, k: q.k, contract: q.id, entryDay: D, entryT: b.t, entryU: c.node.strike, entryPx: q.price, entryWorst: q.worst,
              plan: r.plan, half: false, stopLvl: r.plan.stop, zone: pl.board.zone, holdEnd: pl.holdEnd, lastT: b.t, legs: [] };
            state.open.push(pos); save();
            log({ ev: 'ENTRY', sym, rule, setup: r.setup, direction: r.direction, contract: q.id, price: q.price, et: hm(b.t), node: c.node.strike, stop: r.plan.stop, t1: r.plan.t1, t2: r.plan.t2, rr: r.plan.rr, chart: pl.chart, vex: pl.vex });
            notify(`ENTRY ${sym} ${type.toUpperCase()} ${q.id} @ $${q.price} (${rule}) stop ${r.plan.stop} T1 ${r.plan.t1}`);
            break;
          }
        }
      }
    }
  };
  function bookLeg(pos, leg, b, q, day) {
    const px = q?.price ?? 0, w = MODE === 'replay' ? (q ? q.worst : 0) : px;
    pos.legs.push({ ...leg, day, et: hm(b.t), u: b.c, px });
    log({ ev: 'EXIT', sym: pos.sym, rule: pos.rule, why: leg.why, frac: leg.frac, contract: pos.contract, px, et: hm(b.t) });
    notify(`EXIT ${pos.sym} ${leg.why} ${Math.round(leg.frac * 100)}% @ $${px}`);
    if (pos.closed || pos.legs.reduce((a, l) => a + l.frac, 0) >= 0.999) {
      const ret = pos.legs.reduce((a, l) => a + (l.px - pos.entryPx) / pos.entryPx * l.frac, 0);
      state.closed.push({ ...pos, ret: +ret.toFixed(3), exitDay: day }); state.open = state.open.filter((p) => p !== pos);
      log({ ev: 'CLOSED', sym: pos.sym, rule: pos.rule, ret: +ret.toFixed(3), legs: pos.legs.map((l) => `${l.why}@${l.day.slice(5)} ${l.et} $${l.px}`).join(' · ') });
    }
    save();
  }

  // same minute-by-minute stepping in both modes; live just waits for the clock (bar t closes at t+60, poll 8s after)
  for (let t = etToUnix(D, '09:36'); t <= closeT; t += 60) {
    if (MODE === 'live') while (Date.now() / 1000 < t + 68) await sleep(2000);
    try { await step(t); } catch (e) { log({ ev: 'error', err: String(e.message).slice(0, 200) }); }
  }

  // ---- CLOSE: daily-close stop + time exit ----
  for (const pos of [...state.open]) {
    const bars = await P.bars(pos.sym, closeT); const close = bars[bars.length - 1]; if (!close) continue;
    for (const leg of manageClose(pos, close, D >= pos.holdEnd)) { const q = await P.optPrice(pos.sym, pos.exp, pos.type, pos.k, close.t); bookLeg(pos, leg, close, q, D); }
  }
  log({ ev: 'eod', open: state.open.map((p) => `${p.sym}/${p.rule}`), gates });
  save();
}

// ---------------- main ----------------
if (MODE === 'live') {
  const D = todayET(); RUN_FROM = D; RUN_TO = D;
  await loadCalendar(D, D);
  const known = [...cal].sort(); cal.add(D);
  if (dow(D) === 0 || dow(D) === 6) { console.log('weekend — nothing to do'); process.exit(0); }
  console.log(`[live] ${D} · ${SYMS.join(',')} · credits ${(await account()).creditsBalance}`);
  await runDay(D, known[known.length - 1]);
  console.log(`[live] done ${D}: open ${state.open.length}, closed today ${state.closed.filter((p) => p.exitDay === D).length}`);
} else {
  const i = argv.indexOf('--replay'), FROM = argv[i + 1], TO = argv[i + 2] ?? argv[i + 1]; RUN_FROM = FROM; RUN_TO = TO;
  await loadCalendar(TO, FROM); const lastKnown = [...cal].sort().slice(-1)[0];
  for (const D of [...cal].filter((d) => d >= FROM && d <= TO).sort()) { await runDay(D, lastKnown); process.stdout.write('.'); }
  fs.writeFileSync(path.join(JDIR, 'book.json'), JSON.stringify(state.closed, null, 1));
  const by = {}; for (const p of state.closed) (by[p.rule] ||= []).push(p);
  console.log(`\nreplay ${FROM} → ${TO}: closed ${state.closed.length}, still open ${state.open.length}`);
  for (const [r, T] of Object.entries(by)) console.log(`  ${r.padEnd(20)} n=${T.length}  win ${Math.round(T.filter((x) => x.ret > 0).length / T.length * 100)}%  @$1k/trade ${(T.reduce((a, x) => a + x.ret, 0) * 1000).toFixed(0)}`);
}
