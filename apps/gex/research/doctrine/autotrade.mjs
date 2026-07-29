// AUTO PAPER-TRADER — mirrors the live plays-tracker (real 0DTE option quotes · peak tracking · STRUCTURE-
// invalidation exits · tracker log format) but FIRES on our new validated rules (failed-reach · ride-to-pika ·
// barney accelerant · fade-to-king). PAPER ONLY — never sends orders, never touches the live tracker.
// Runs each cron tick during RTH; state persists in state_autotrade.json; log → trades_<day>.txt.
import '../../scripts/_env-bootstrap.js';
import { initAuth, getFreshToken } from '../../src/heatseeker/auth.js';
import fs from 'node:fs'; import path from 'node:path';
const KEY = process.env.UNUSUAL_WHALES_API_KEY || process.env.UW_API_KEY;
const D = path.join(process.cwd(), 'research', 'doctrine');
const STATE = path.join(D, 'state_autotrade.json');
const sign = (x) => x > 0 ? 1 : x < 0 ? -1 : 0, r5 = (x) => Math.round(x / 5) * 5;
const STRONG = 15e6, WALL = 12e6, BARN = 8e6, RIDE_MOM = 3, FADE_EXT = 7, FADE_MAX = 20, RIDE_STOP = 8, FADE_STOP = 6;
const MIN_CONFLUENCE = 5;   // Falcon's selectivity principle: fire ONLY when >=5 of our validated criteria align
const TP = 25, SL = 40, HARDEN = 1.8;                                        // manage: +25% pop / −40% / struct-harden ×1.8
const REACH = { S: [93, 74, 59, 42, 24], M: [89, 69, 55, 43, 26], L: [87, 52, 38, 22, 6] };
const reachPct = (ad, g0) => { const g = g0 >= 35e6 ? 'L' : g0 >= 20e6 ? 'M' : 'S'; const b = ad < 4 ? 0 : ad < 8 ? 1 : ad < 12 ? 2 : ad < 18 ? 3 : 4; return REACH[g][b]; };
const etHM = () => new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false }).slice(0, 5);
const etDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const etMin = (hm) => +hm.slice(0, 2) * 60 + +hm.slice(3);
const occOf = (day, cp, strike) => `SPXW${day.slice(2).replace(/-/g, '')}${cp}${String(strike * 1000).padStart(8, '0')}`;

const hm = etHM(), day = etDate(), m = etMin(hm);
if ((m < 9 * 60 + 35 || m > 15 * 60 + 56) && !process.env.FORCE) process.exit(0);   // RTH only (FORCE=1 to test off-hours)
const TLOG = path.join(D, `trades_${day}.txt`);
let st = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};
if (st.day !== day) st = { day, pos: null, trades: [] };
const log = (s) => { fs.appendFileSync(TLOG, s + '\n'); console.log(s); };

await initAuth();
const token = await getFreshToken();
const u = new URL('https://app.skylit.ai/api/data');
u.searchParams.set('symbol', 'SPXW'); u.searchParams.set('max_strikes', '200'); u.searchParams.set('max_expirations', '10'); u.searchParams.set('nocache', Math.random().toString());
const rr = await fetch(u, { headers: { Origin: 'https://app.skylit.ai', Referer: 'https://app.skylit.ai/', Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) }).catch(() => null);
if (!rr || !rr.ok) { log(`${hm} · surface pull failed (${rr ? rr.status : 'net'})`); process.exit(0); }
const raw = await rr.json(); if (!raw || raw.CurrentSpot == null) process.exit(0);
const spot = raw.CurrentSpot, K = raw.Strikes || [], G = raw.GammaValues || [], V = raw.VannaValues || [], strikes = [];
for (let i = 0; i < K.length; i++) { const k = +K[i]; if (Number.isFinite(k) && Math.abs(k - spot) / spot <= 0.012) strikes.push({ strike: k, g0: (G[i] || [])[0] || 0, v0: (V[i] || [])[0] || 0 }); }
const sumAbs = strikes.reduce((t, n) => t + Math.abs(n.g0), 0) || 1;
const gAt = (k) => (strikes.find(n => n.strike === k)?.g0 || 0);
const vAt = (k) => (strikes.find(n => n.strike === k)?.v0 || 0);
const king = strikes.filter(n => n.g0 >= STRONG).sort((a, b) => b.g0 - a.g0)[0];
const pikaUp = strikes.filter(n => n.g0 >= WALL && n.strike > spot + 1).sort((a, b) => a.strike - b.strike)[0];
const pikaDn = strikes.filter(n => n.g0 >= WALL && n.strike < spot - 1).sort((a, b) => b.strike - a.strike)[0];
const barnAhead = (dir) => strikes.filter(n => n.g0 <= -BARN && (n.strike - spot) * dir > 1 && Math.abs(n.strike - spot) <= 20).sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))[0];
const optMark = async (occ) => { const q = await fetch(`https://api.unusualwhales.com/api/option-contract/${occ}/intraday`, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(12000) }).then(x => x.ok ? x.json() : null).catch(() => null); const d = (q?.data || []).filter(b => +b.close > 0); return d.length ? +d[d.length - 1].close : null; };
const spy = await fetch(`https://api.unusualwhales.com/api/stock/SPY/ohlc/1m?date=${day}`, { headers: { Authorization: `Bearer ${KEY}` } }).then(x => x.ok ? x.json() : null).catch(() => null);
const sc = (spy?.data || []).map(x => +x.close).filter(Number.isFinite);
const mom10 = sc.length > 11 ? (sc[sc.length - 1] - sc[sc.length - 11]) * 10 : 0;
const spath = sc.slice(-16).map(c => spot + (c - sc[sc.length - 1]) * 10);
const failedReach = (pk) => { if (!pk) return null; let c = 999; spath.forEach(v => { const g = Math.abs(v - pk.strike); if (g < c) c = g; }); return (c >= 2 && c <= 5 && Math.abs(spot - pk.strike) > c + 1.5) ? c : null; };

async function open(kind, dir, target, stopSpot, reason, oppStrike) {
  const cp = dir > 0 ? 'C' : 'P', strike = r5(spot), occ = occOf(day, cp, strike), mark = await optMark(occ);
  const oppShare = oppStrike ? gAt(oppStrike) / sumAbs : 0;
  st.pos = { kind, dir, entry: +spot.toFixed(1), entryET: hm, target, stopSpot, reason, cp, strike, occ, entryMark: mark, peakMark: mark, oppStrike, oppShare0: +oppShare.toFixed(3) };
  log(`  ${hm}  ${dir > 0 ? '🐂' : '🐻'} ${kind.padEnd(16)} SPXW  ${cp === 'C' ? 'CALL' : 'PUT'} $${strike} @ $${mark == null ? '?' : mark.toFixed(2)}  [${occ}]  → tgt ${target} · ${reason}`);
}
function closePos(exitMark, why, oppNow) {
  const p = st.pos, ret = (p.entryMark && exitMark) ? (exitMark - p.entryMark) / p.entryMark * 100 : 0;
  st.trades.push({ ...p, exitET: hm, exitMark, ret: +ret.toFixed(0), why });
  log(`  ${hm}  ✂ EXIT  SPXW  ${p.cp === 'C' ? 'CALL' : 'PUT'} $${p.strike}  ${p.kind}  $${(p.entryMark || 0).toFixed(2)} → $${(exitMark || 0).toFixed(2)}  (${ret >= 0 ? '🟢' : '🔴'} ${Math.abs(ret).toFixed(0)}%)  peak $${(p.peakMark || 0).toFixed(2)}  [${why}]`);
  st.pos = null;
}

let bestConf = -1, bestKind = '';                                            // confluence visibility for the status line
if (st.pos) {                                                                // RefreshLoop: manage on REAL option quote + structure
  const p = st.pos, mark = await optMark(p.occ);
  if (mark != null) { p.peakMark = Math.max(p.peakMark || 0, mark); const ret = p.entryMark ? (mark - p.entryMark) / p.entryMark * 100 : 0;
    const oppNow = p.oppStrike ? gAt(p.oppStrike) / sumAbs : 0;
    const hardened = p.oppStrike && p.oppShare0 > 0.01 && oppNow >= p.oppShare0 * HARDEN && oppNow >= 0.05;
    const tgtHit = p.dir > 0 ? spot >= p.target : spot <= p.target, stopHit = p.dir > 0 ? spot <= p.stopSpot : spot >= p.stopSpot, eod = m >= 15 * 60 + 55;
    if (ret >= TP) closePos(mark, `+${TP}% pop (manage)`, oppNow);
    else if (ret <= -SL) closePos(mark, `−${SL}% stop`, oppNow);
    else if (hardened) closePos(mark, `STRUCT opposing_pika_$${p.oppStrike}_hardened_${(p.oppShare0 * 100).toFixed(1)}%→${(oppNow * 100).toFixed(1)}%`, oppNow);
    else if (tgtHit) closePos(mark, `target ${p.target} ✓`, oppNow);
    else if (stopHit) closePos(mark, `spot stop`, oppNow);
    else if (eod) closePos(mark, `closed_eod`, oppNow);
  }
} else if (king) {                                                           // FireLoop: CONFLUENCE-GATED entry (Falcon selectivity — fire ONLY when ≥MIN validated criteria align)
  const trinity = sign(mom10);                                              // tape proxy (SPY 10-min momentum)
  const migDir = st.prevKing && Math.abs(king.strike - st.prevKing) >= 5 ? sign(king.strike - st.prevKing) : 0;  // escalator
  const cands = [];
  const fUp = failedReach(pikaUp), fDn = failedReach(pikaDn);
  if (fUp) cands.push({ kind: 'FAILED-REACH', dir: -1, anchor: pikaUp, target: (pikaDn || king).strike, stop: +(spot + FADE_STOP).toFixed(1) });
  if (fDn) cands.push({ kind: 'FAILED-REACH', dir: 1, anchor: pikaDn, target: (pikaUp || king).strike, stop: +(spot - FADE_STOP).toFixed(1) });
  const pin = strikes.filter(n => n.g0 >= STRONG && Math.abs(n.strike - spot) >= FADE_EXT && Math.abs(n.strike - spot) <= FADE_MAX).sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))[0];
  if (pin) cands.push({ kind: 'FADE', dir: sign(pin.strike - spot), anchor: pin, target: pin.strike, stop: +(spot - sign(pin.strike - spot) * FADE_STOP).toFixed(1) });
  if (Math.abs(mom10) >= RIDE_MOM) { const d = sign(mom10), pk = d > 0 ? pikaUp : pikaDn; if (pk && Math.abs(pk.strike - spot) <= 15) cands.push({ kind: 'RIDE', dir: d, anchor: pk, target: pk.strike, stop: +(spot - d * RIDE_STOP).toFixed(1) }); }
  const scored = cands.map(c => {
    const cr = [
      ['pika', !!c.anchor && c.anchor.g0 > 0],                             // anchor is a positive-gamma wall
      ['strong20M', !!c.anchor && c.anchor.g0 >= 20e6],                    // extra-strong node
      ['reachable', !!c.anchor && reachPct(Math.abs(c.target - spot), c.anchor.g0) >= 40], // reach model says gettable
      ['vanna+', !!c.anchor && vAt(c.anchor.strike) > 0],                  // vanna+ = holds/deflect (74%)
      ['king-mig', migDir !== 0 && migDir === c.dir],                      // escalator agrees
      ['tape', trinity !== 0 && trinity === c.dir],                        // SPY momentum agrees
      ['failed-reach', c.kind === 'FAILED-REACH'],                         // the strongest reversal tell
      ['R:R≥1', Math.abs(c.target - spot) >= Math.abs(c.stop - spot)],     // reward ≥ risk
      ['window', m < 15 * 60 + 15],                                        // pre-15:15
    ];
    return { ...c, cr, pass: cr.filter(x => x[1]).length };
  }).sort((a, b) => b.pass - a.pass);
  const best = scored[0];
  if (best) { bestConf = best.pass; bestKind = best.kind; }
  if (best && best.pass >= MIN_CONFLUENCE) {
    const hits = best.cr.filter(x => x[1]).map(x => x[0]).join('+');
    await open(best.kind, best.dir, best.target, best.stop, `CONFLUENCE ${best.pass}/9 [${hits}]`, (best.dir > 0 ? pikaUp : pikaDn)?.strike);
  }
}
if (m >= 15 * 60 + 55 && !st.pos && st.trades.length && !st.done) { const w = st.trades.filter(t => t.ret > 0).length; log(`  ═══ DAY DONE: ${st.trades.length} trades · ${w}/${st.trades.length} green · avg ${(st.trades.reduce((a, c) => a + c.ret, 0) / st.trades.length).toFixed(0)}% ═══`); st.done = 1; }
// per-tick STATUS heartbeat (watch it think between trades) — appended to status_<day>.txt
const kd = king ? spot - king.strike : 0;
// KING MIGRATION (Falcon's Heatseeker "wall migrated X→Y" = our escalator finding)
let migNote = '';
if (king && st.prevKing && Math.abs(king.strike - st.prevKing) >= 5) { migNote = ` · 🔀 KING MIGRATED ${st.prevKing}→${king.strike} (escalator ${king.strike > st.prevKing ? 'UP' : 'DOWN'})`; log(`  ${hm}  🔀 KING wall migrated ${st.prevKing} → ${king.strike} (escalator ${king.strike > st.prevKing ? 'UP/bull-lean' : 'DOWN/bear-lean'})`); }
if (king) st.prevKing = king.strike;
const status = `${hm} · SPX ${spot.toFixed(1)} · ${king ? `king ${king.strike}(${(king.g0 / 1e6).toFixed(0)}M) ${kd >= 0 ? '+' : ''}${kd.toFixed(0)}` : 'NO strong king → STAND ASIDE'} · mom ${mom10 >= 0 ? '+' : ''}${mom10.toFixed(0)}pt · ${st.pos ? `IN ${st.pos.kind} ${st.pos.dir > 0 ? 'LONG' : 'SHORT'} @${st.pos.entry}→${st.pos.target}` : king ? `flat · best ${bestKind || '—'} confluence ${bestConf >= 0 ? bestConf : 0}/9 (fire ≥${MIN_CONFLUENCE})` : 'flat'}${migNote}`;
fs.appendFileSync(path.join(D, `status_${day}.txt`), status + '\n');
fs.writeFileSync(STATE, JSON.stringify(st));
