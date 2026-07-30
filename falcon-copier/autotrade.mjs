// AUTO PAPER-TRADER (multi-instrument) — the SAME validated engine as backtest_1min.mjs / scan_multi.mjs, but
// it actually paper-trades on REAL 0DTE option quotes. Scans SPX + SPY + QQQ every tick, builds PIKA (fade to
// wall) + BARNEY (reject off a tapped-and-retracing negative-gamma node) candidates, scores 7-criteria
// confluence, fires the SINGLE best setup across the complex (≥MIN), then must clear a red-team veto. Manages
// on the real option mark with peak tracking + STRUCTURE-hardening exits. PAPER ONLY — never sends orders,
// never touches the live tracker. Runs each RTH tick; state in state_autotrade.json; log → trades_<day>.txt.
import '../apps/gex/scripts/_env-bootstrap.js';
import { initAuth, getFreshToken } from '../apps/gex/src/heatseeker/auth.js';
import fs from 'node:fs'; import path from 'node:path';
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
const D = path.join(process.cwd(), 'falcon-copier');
const STATE = path.join(D, 'state_autotrade.json');
const sign = (x) => x > 0 ? 1 : x < 0 ? -1 : 0;
const MIN_CONFLUENCE = 5;                                                    // Falcon selectivity: fire ONLY when ≥5/7 validated criteria align
const TP = 25, SL = 40, HARDEN = 1.8;                                        // manage: +25% pop / −40% / opposing-node hardens ×1.8
// per-instrument params (identical to the validated backtest): strong-node floor, search range, min gap, spot-stop, DP scale, strike step
const INSTR = [
  { sym: 'SPXW', strong: 15e6, range: 20, gap: 5, stop: 8, dpMul: 10.05, step: 5 },
  { sym: 'SPY', strong: 15e6, range: 3, gap: 0.5, stop: 0.8, dpMul: 1, step: 1 },
  { sym: 'QQQ', strong: 5e6, range: 3, gap: 0.5, stop: 0.8, dpMul: 0, step: 1 },
];
const REACH = { S: [93, 74, 59, 42, 24], M: [89, 69, 55, 43, 26], L: [87, 52, 38, 22, 6] };  // SPX-calibrated reach model (red-team only)
const reachPct = (ad, g0) => { const g = g0 >= 35e6 ? 'L' : g0 >= 20e6 ? 'M' : 'S'; const b = ad < 4 ? 0 : ad < 8 ? 1 : ad < 12 ? 2 : ad < 18 ? 3 : 4; return REACH[g][b]; };
const etHM = () => new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false }).slice(0, 5);
const etDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const etMin = (hm) => +hm.slice(0, 2) * 60 + +hm.slice(3);
const occOf = (sym, day, cp, strike) => `${sym === 'SPXW' ? 'SPXW' : sym}${day.slice(2).replace(/-/g, '')}${cp}${String(Math.round(strike * 1000)).padStart(8, '0')}`;

const hm = etHM(), day = etDate(), m = etMin(hm);
if ((m < 9 * 60 + 35 || m > 15 * 60 + 56) && !process.env.FORCE) process.exit(0);   // RTH only (FORCE=1 to test off-hours)
const TLOG = path.join(D, `trades_${day}.txt`);
let st = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};
if (st.day !== day) st = { day, pos: null, trades: [], prevKing: {}, spotHist: {}, spotPath: {} };
if (typeof st.prevKing !== 'object' || st.prevKing === null) st.prevKing = {};   // migrate old SPXW-only scalar prevKing → per-instrument map
if (typeof st.spotHist !== 'object' || st.spotHist === null) st.spotHist = {};
if (typeof st.spotPath !== 'object' || st.spotPath === null) st.spotPath = {};   // session spot path per instrument → tape path-efficiency (WATCH feature: logged, NOT acted on)
const log = (s) => { fs.appendFileSync(TLOG, s + '\n'); console.log(s); };

await initAuth();
async function gex(sym) {
  const token = await getFreshToken(); const u = new URL('https://app.skylit.ai/api/data');
  u.searchParams.set('symbol', sym); u.searchParams.set('max_strikes', '200'); u.searchParams.set('max_expirations', '10'); u.searchParams.set('nocache', Math.random().toString());
  const rr = await fetch(u, { headers: { Origin: 'https://app.skylit.ai', Referer: 'https://app.skylit.ai/', Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!rr || !rr.ok) return null; const raw = await rr.json(); if (!raw || raw.CurrentSpot == null) return null;
  const spot = raw.CurrentSpot, K = raw.Strikes || [], G = raw.GammaValues || [], VV = raw.VannaValues || [], strikes = [];
  for (let i = 0; i < K.length; i++) { const k = +K[i]; if (Number.isFinite(k) && Math.abs(k - spot) / spot <= 0.012) strikes.push({ strike: k, g0: (G[i] || [])[0] || 0, v0: (VV[i] || [])[0] || 0 }); }
  return { spot, prevClose: raw.PreviousClose, strikes };
}
const optMark = async (occ) => { const q = await fetch(`https://api.unusualwhales.com/api/option-contract/${occ}/intraday`, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(12000) }).then(x => x.ok ? x.json() : null).catch(() => null); const d = (q?.data || []).filter(b => +b.close > 0); return d.length ? +d[d.length - 1].close : null; };
async function flowLean(sym) {
  const r = await fetch(`https://api.unusualwhales.com/api/option-trades?ticker_symbol=${sym}&min_premium=25000&limit=400&order=executed_at&order_direction=desc`, { headers: { Authorization: `Bearer ${KEY}` } }).then(x => x.ok ? x.json() : null).catch(() => null);
  let b = 0, be = 0; const cut = Date.now() - 20 * 60000;
  for (const x of (r?.data || r?.result || [])) { if (new Date(x.executed_at).getTime() < cut) continue; const tg = x.tags || []; if (!tg.includes('ask_side')) continue; const p = +x.premium || 0; if (tg.includes('bullish')) b += p; else if (tg.includes('bearish')) be += p; }
  return sign(b - be);
}
async function dpVAH() { const r = await fetch(`https://api.unusualwhales.com/api/stock/SPY/stock-volume-price-levels`, { headers: { Authorization: `Bearer ${KEY}` } }).then(x => x.ok ? x.json() : null).catch(() => null); if (!r) return null; const bu = {}; for (const x of (r.data || [])) { const o = +x.off_vol || 0; if (o > 0) bu[Math.round(+x.price)] = (bu[Math.round(+x.price)] || 0) + o; } const a = Object.entries(bu).map(([p, v]) => ({ p: +p, v })).sort((x, y) => y.v - x.v).slice(0, 4); return a.length ? { poc: a[0].p, vah: Math.max(...a.map(x => x.p)), val: Math.min(...a.map(x => x.p)) } : null; }

function closePos(exitMark, why) {
  const p = st.pos, ret = (p.entryMark && exitMark) ? (exitMark - p.entryMark) / p.entryMark * 100 : 0;
  const rec = { day, ...p, exitET: hm, exitMark, ret: +ret.toFixed(0), why };
  st.trades.push(rec);
  try { fs.appendFileSync(path.join(D, 'falcon_ledger.jsonl'), JSON.stringify(rec) + '\n'); } catch (e) { }   // cumulative forward learning ledger (survives across days; review.mjs reads it)
  log(`  ${hm}  ✂ EXIT  ${p.sym.padEnd(4)} ${p.cp === 'C' ? 'CALL' : 'PUT'} $${p.strike}  ${p.kind}  $${(p.entryMark || 0).toFixed(2)} → $${(exitMark || 0).toFixed(2)}  (${ret >= 0 ? '🟢' : '🔴'} ${Math.abs(ret).toFixed(0)}%)  peak $${(p.peakMark || 0).toFixed(2)}  [${why}]`);
  st.pos = null;
}

let statusLine = '';
if (st.pos) {                                                                // MANAGE the open position on its own instrument's real mark + structure
  const p = st.pos, S = await gex(p.sym), mark = await optMark(p.occ);
  if (S && mark != null) {
    const spot = S.spot; p.peakMark = Math.max(p.peakMark || 0, mark);
    const ret = p.entryMark ? (mark - p.entryMark) / p.entryMark * 100 : 0;
    const sumAbs = S.strikes.reduce((t, n) => t + Math.abs(n.g0), 0) || 1;
    const oppNow = p.oppStrike ? (S.strikes.find(n => n.strike === p.oppStrike)?.g0 || 0) / sumAbs : 0;
    const hardened = p.oppStrike && p.oppShare0 > 0.01 && oppNow >= p.oppShare0 * HARDEN && oppNow >= 0.05;
    const tgtHit = p.dir > 0 ? spot >= p.target : spot <= p.target, stopHit = p.dir > 0 ? spot <= p.stopSpot : spot >= p.stopSpot, eod = m >= 15 * 60 + 55;
    if (ret >= TP) closePos(mark, `+${TP}% pop (manage)`);
    else if (ret <= -SL) closePos(mark, `−${SL}% stop`);
    else if (hardened) closePos(mark, `STRUCT opposing_${p.oppStrike}_hardened_${(p.oppShare0 * 100).toFixed(1)}%→${(oppNow * 100).toFixed(1)}%`);
    else if (tgtHit) closePos(mark, `target ${p.target} ✓`);
    else if (stopHit) closePos(mark, `spot stop`);
    else if (eod) closePos(mark, `closed_eod`);
    else statusLine = `${hm} · IN ${p.sym} ${p.kind} ${p.dir > 0 ? 'LONG' : 'SHORT'} $${p.strike}${p.cp} @${p.entry}→${p.target} · mark $${mark.toFixed(2)} (${ret >= 0 ? '+' : ''}${ret.toFixed(0)}%) peak $${(p.peakMark || 0).toFixed(2)}`;
  } else statusLine = `${hm} · IN ${p.sym} ${p.kind} · (no quote this tick)`;
} else if (m < 15 * 60 + 45 || process.env.FORCE) {                          // SCAN the complex & fire the best (no new entries after 15:45; FORCE bypasses for off-hours testing)
  const dp = await dpVAH();
  const scan = [];
  for (const I of INSTR) {
    const S = await gex(I.sym); if (!S) continue; const spot = S.spot;
    const fl = await flowLean(I.sym);
    const king = S.strikes.filter(n => n.g0 > 0).sort((a, b) => b.g0 - a.g0)[0];
    const migDir = king && st.prevKing[I.sym] && Math.abs(king.strike - st.prevKing[I.sym]) >= I.gap ? sign(king.strike - st.prevKing[I.sym]) : 0;
    if (king && st.prevKing[I.sym] && Math.abs(king.strike - st.prevKing[I.sym]) >= I.gap) log(`  ${hm}  🔀 ${I.sym} KING migrated ${st.prevKing[I.sym]} → ${king.strike} (escalator ${king.strike > st.prevKing[I.sym] ? 'UP' : 'DOWN'})`);
    if (king) st.prevKing[I.sym] = king.strike;
    const hist = (st.spotHist[I.sym] || []).concat(spot).slice(-6); st.spotHist[I.sym] = hist;
    st.spotPath[I.sym] = (st.spotPath[I.sym] || []).concat(spot).slice(-400);   // accumulate session path for tape path-efficiency
    const vah = dp && I.dpMul ? dp.vah * I.dpMul : null, val = dp && I.dpMul ? dp.val * I.dpMul : null;
    const cands = [];
    const pin = S.strikes.filter(n => n.g0 >= I.strong && Math.abs(n.strike - spot) >= I.gap && Math.abs(n.strike - spot) <= I.range).sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))[0];
    if (pin) cands.push({ kind: 'PIKA', dir: sign(pin.strike - spot), anchor: pin, target: pin.strike, stop: +(spot - sign(pin.strike - spot) * I.stop).toFixed(2), strong: pin.g0 >= I.strong * 1.3, vanna: pin.v0 > 0 });
    const barn = S.strikes.filter(n => n.g0 <= -I.strong && Math.abs(n.strike - spot) >= I.gap && Math.abs(n.strike - spot) <= I.range * 0.5).sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))[0];
    if (barn) {
      const d = -sign(barn.strike - spot), ext = barn.strike > spot ? Math.max(...hist) : Math.min(...hist);
      const tapped = Math.abs(ext - barn.strike) <= (I.sym === 'SPXW' ? 6 : 0.6);
      const retrace = barn.strike > spot ? spot < ext - (I.sym === 'SPXW' ? 1 : 0.1) : spot > ext + (I.sym === 'SPXW' ? 1 : 0.1);
      if (tapped && retrace) cands.push({ kind: 'BARNEY', dir: d, anchor: barn, target: +(spot + d * I.stop * 1.3).toFixed(2), stop: +(spot - d * I.stop).toFixed(2), strong: barn.g0 <= -I.strong * 2, vanna: barn.v0 < 0 });
    }
    let best = null;
    for (const c of cands) {
      const cr = [
        ['at-node', true],
        ['strong', c.strong],
        [c.kind === 'BARNEY' ? 'vanna-' : 'vanna+', c.vanna],
        ['king-mig', migDir !== 0 && migDir === c.dir],
        ['flow', fl !== 0 && fl === c.dir],
        ['pivot-side', c.dir > 0 ? spot < S.prevClose : spot > S.prevClose],
        ['dp-ext', vah != null && (c.dir < 0 ? spot > vah : spot < val)],
      ];
      c.pass = cr.filter(x => x[1]).length; c.hits = cr.filter(x => x[1]).map(x => x[0]);
      c.crmap = {}; for (const [k, v] of cr) c.crmap[k.replace(/[+-]$/, '')] = v ? 1 : 0;   // normalized criteria map for the learning ledger (vanna+/- → vanna)
      if (!best || c.pass > best.pass) best = c;
    }
    scan.push({ I, S, fl, king, best });
  }
  const winner = scan.filter(x => x.best).sort((a, b) => b.best.pass - a.best.pass)[0];
  if (winner && winner.best.pass >= MIN_CONFLUENCE) {
    const { I, S, best } = winner, spot = S.spot, hist = st.spotHist[I.sym] || [spot];
    const reward = Math.abs(best.target - spot), risk = Math.abs(best.stop - spot), mom = hist.length > 1 ? hist[hist.length - 1] - hist[0] : 0;
    // RED TEAM — the trade must SURVIVE the arguments against it (adversarial veto), not merely score well
    const objections = [
      ['target unreachable', I.sym === 'SPXW' && reachPct(reward, Math.abs(best.anchor.g0)) < 25],   // the 81-pt-fade killer (SPX-calibrated)
      ['fighting tape', Math.abs(mom) >= (I.sym === 'SPXW' ? 6 : 0.6) && sign(mom) !== best.dir],
      ['R:R poor (<0.8)', reward < risk * 0.8],
      ['no room', best.kind === 'PIKA' && reward < I.gap],
      ['weak anchor', Math.abs(best.anchor.g0) < I.strong],
    ].filter(x => x[1]).map(x => x[0]);
    if (objections.length === 0) {
      const cp = best.dir > 0 ? 'C' : 'P', strike = Math.round(spot / I.step) * I.step, occ = occOf(I.sym, day, cp, strike), mark = await optMark(occ);
      const sumAbs = S.strikes.reduce((t, n) => t + Math.abs(n.g0), 0) || 1;
      // opposing node = strongest pika in the direction of travel that could cap us (for structure-hardening exit)
      const opp = S.strikes.filter(n => n.g0 >= I.strong && (n.strike - spot) * best.dir > 0).sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))[0];
      const oppShare = opp ? opp.g0 / sumAbs : 0;
      const pth = st.spotPath[I.sym] || [spot], mv = pth.slice(1).reduce((a, c, idx) => a + Math.abs(c - pth[idx]), 0) || 1e-9;
      const tapeEff = +(Math.abs(spot - pth[0]) / mv).toFixed(3);   // session path-efficiency up to entry — WATCH: chop-gate hypothesis (win days ~0.21 vs bleed ~0.06, n=7). LOGGED, not gated.
      st.pos = { sym: I.sym, kind: best.kind, dir: best.dir, entry: +spot.toFixed(2), entryET: hm, target: best.target, stopSpot: best.stop, cp, strike, occ, entryMark: mark, peakMark: mark, oppStrike: opp?.strike || null, oppShare0: +oppShare.toFixed(3), pass: best.pass, hits: best.hits, crmap: best.crmap, tapeEff };
      log(`  ${hm}  ${best.dir > 0 ? '🐂' : '🐻'} ${best.kind.padEnd(6)} ${I.sym.padEnd(4)} ${cp === 'C' ? 'CALL' : 'PUT'} $${strike} @ $${mark == null ? '?' : mark.toFixed(2)}  [${occ}]  → tgt ${best.target} · CONFLUENCE ${best.pass}/7 [${best.hits.join('+')}] · red-team CLEARED`);
    } else { log(`  ${hm}  ⚖ RED-TEAM VETO ${winner.I.sym} ${best.kind} ${best.dir > 0 ? 'LONG' : 'SHORT'} (conf ${best.pass}/7): ${objections.join(' · ')}`); }
  }
  statusLine = `${hm} · flat · ` + scan.map(x => `${x.I.sym} ${x.S.spot.toFixed(1)}${x.best ? ` ${x.best.kind[0]}${x.best.dir > 0 ? '↑' : '↓'}${x.best.pass}/7` : ' —'}`).join(' · ') + ` · fire ≥${MIN_CONFLUENCE}`;
}
if (m >= 15 * 60 + 55 && !st.pos && !st.done) {                              // DAY DONE + auto-run the disciplined review (the iterative loop)
  const n = st.trades.length, w = st.trades.filter(t => t.ret > 0).length;
  log(n ? `  ═══ DAY DONE: ${n} trades · ${w}/${n} green · avg ${(st.trades.reduce((a, c) => a + c.ret, 0) / n).toFixed(0)}% ═══` : `  ═══ DAY DONE: 0 trades (stood aside all day) ═══`);
  st.done = 1;
  try { const { spawn } = await import('node:child_process'); spawn(process.execPath, [path.join(D, 'review.mjs')], { cwd: process.cwd(), detached: true, stdio: 'ignore' }).unref(); } catch (e) { }
}
if (statusLine) fs.appendFileSync(path.join(D, `status_${day}.txt`), statusLine + '\n');
fs.writeFileSync(STATE, JSON.stringify(st));
