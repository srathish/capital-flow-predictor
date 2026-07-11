// Overnight exit-study — STRATEGY BACKTEST (research only, no live changes).
// Backtests a library of exit rules on REAL option marks + underlying 1m bars.
// Exits trigger off candle CLOSE only (no intra-bar look-ahead) => recoverable,
// not hindsight. Reports expectancy/win% per strategy with a train/test split
// (first 32 days vs last 32 days) so we don't overfit one regime.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'cache');
const UND = path.join(HERE, 'cache_underlying');
const undKey = t => (t === 'SPXW' ? 'SPY' : t);
const load = f => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []);

// ---------- indicators (computed on the underlying day series) ----------
const ema = (arr, p) => { const k = 2 / (p + 1); let e = arr[0]; return arr.map(v => (e = v * k + e * (1 - k))); };
function vwap(cs) { // reset at regular open 13:30 UTC
  let pv = 0, vv = 0; return cs.map(c => {
    const hr = new Date(c.ts).getUTCHours(), mn = new Date(c.ts).getUTCMinutes();
    if (hr === 13 && mn === 30) { pv = 0; vv = 0; }
    const tp = (c.high + c.low + c.close) / 3; pv += tp * c.vol; vv += c.vol;
    return vv ? pv / vv : c.close;
  });
}
function atr(cs, p = 14) {
  const tr = cs.map((c, i) => i === 0 ? c.high - c.low : Math.max(c.high - c.low, Math.abs(c.high - cs[i - 1].close), Math.abs(c.low - cs[i - 1].close)));
  return ema(tr, p);
}
function rsi(closes, p = 14) {
  let g = 0, l = 0; const out = [50];
  for (let i = 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    g = (g * (p - 1) + Math.max(ch, 0)) / p; l = (l * (p - 1) + Math.max(-ch, 0)) / p;
    out.push(l === 0 ? 100 : 100 - 100 / (1 + g / l));
  }
  return out;
}

// ---------- build per-fire merged path ----------
function buildPath(fire) {
  const opt = load(path.join(CACHE, `${fire.sym}_${fire.day}.json`))
    .map(c => ({ ts: Date.parse(c.start_time), close: Number(c.close) || 0 })).filter(c => c.close > 0).sort((a, b) => a.ts - b.ts);
  if (opt.length < 4) return null;
  const uc = load(path.join(UND, `${undKey(fire.ticker)}_${fire.day}.json`))
    .map(c => ({ ts: Date.parse(c.start_time), close: +c.close, high: +c.high, low: +c.low, vol: +c.volume || 0 }))
    .filter(c => c.close > 0).sort((a, b) => a.ts - b.ts);
  if (uc.length < 20) return null;
  const closes = uc.map(c => c.close);
  const e9 = ema(closes, 9), e21 = ema(closes, 21), vw = vwap(uc), at = atr(uc, 14), rs = rsi(closes, 14);
  const uAt = ts => { let i = 0; while (i < uc.length - 1 && uc[i + 1].ts <= ts) i++; return { i, c: uc[i], e9: e9[i], e21: e21[i], vw: vw[i], atr: at[i], rsi: rs[i] }; };
  // entry = option close at first candle >= fireTs + 60s (confirmation delay)
  const entryTs = fire.fireTsMs + 60000;
  const ei = opt.findIndex(o => o.ts >= entryTs);
  if (ei < 0 || ei >= opt.length - 2) return null;
  const entry = opt[ei].close;
  const steps = opt.slice(ei).map(o => ({ ts: o.ts, opt: o.close, g: (o.close - entry) / entry, u: uAt(o.ts) }));
  return { fire, entry, steps, dir: fire.dir };
}

// ---------- strategy library: each returns exit gain fraction ----------
// A step: {opt, g, u:{c,e9,e21,vw,atr,rsi}}. dir>0 = call (bull), dir<0 = put (bear).
const S = {};
S['hold_eod'] = P => P.steps[P.steps.length - 1].g;
S['target+50_stop-40'] = P => { for (const s of P.steps) { if (s.g >= 0.5) return s.g; if (s.g <= -0.4) return s.g; } return P.steps.at(-1).g; };
S['target+100_stop-50'] = P => { for (const s of P.steps) { if (s.g >= 1.0) return s.g; if (s.g <= -0.5) return s.g; } return P.steps.at(-1).g; };
function trail(arm, gb, stop) { return P => { let peak = 0, armed = false; for (const s of P.steps) { if (s.g > peak) peak = s.g; if (!armed && peak >= arm) armed = true; if (s.g <= -stop) return s.g; if (armed && s.g <= peak - gb * (1 + peak)) return s.g; } return P.steps.at(-1).g; }; }
S['trail_a0_gb25'] = trail(0, 0.25, 0.6); S['trail_a20_gb25'] = trail(0.2, 0.25, 0.6); S['trail_a30_gb20'] = trail(0.3, 0.2, 0.6);
// time stops
function timeStop(mins) { return P => { const t0 = P.steps[0].ts; for (const s of P.steps) if (s.ts - t0 >= mins * 60000) return s.g; return P.steps.at(-1).g; }; }
S['time_15m'] = timeStop(15); S['time_30m'] = timeStop(30); S['time_45m'] = timeStop(45);
// underlying EMA cross: bull exits when underlying closes below EMA9; bear when above
S['ema9_cross'] = P => { for (const s of P.steps) { const below = s.u.c.close < s.u.e9; if (P.dir > 0 ? below : !below) return s.g; } return P.steps.at(-1).g; };
S['ema9<21_cross'] = P => { for (const s of P.steps) { const bear = s.u.e9 < s.u.e21; if (P.dir > 0 ? bear : !bear) return s.g; } return P.steps.at(-1).g; };
// VWAP loss
S['vwap_cross'] = P => { for (const s of P.steps) { const below = s.u.c.close < s.u.vw; if (P.dir > 0 ? below : !below) return s.g; } return P.steps.at(-1).g; };
// ATR chandelier trail on underlying (exit when underlying pulls back mult*ATR from favorable extreme)
function chandelier(mult) { return P => { let ext = P.steps[0].u.c.close; for (const s of P.steps) { const c = s.u.c.close, a = s.u.atr; if (P.dir > 0) { if (c > ext) ext = c; if (c <= ext - mult * a) return s.g; } else { if (c < ext) ext = c; if (c >= ext + mult * a) return s.g; } } return P.steps.at(-1).g; }; }
S['atr_chand_2.5'] = chandelier(2.5); S['atr_chand_1.5'] = chandelier(1.5);
// HYBRIDS: lock a profit floor once armed, else ride the technical signal
S['ema9_or_profitlock50'] = P => { let armed = false; for (const s of P.steps) { if (s.g >= 0.5) armed = true; const below = s.u.c.close < s.u.e9; if (P.dir > 0 ? below : !below) return s.g; if (armed && s.g <= 0.25) return s.g; if (s.g <= -0.5) return s.g; } return P.steps.at(-1).g; };
S['vwap_or_target100'] = P => { for (const s of P.steps) { if (s.g >= 1.0) return s.g; const below = s.u.c.close < s.u.vw; if (P.dir > 0 ? below : !below) return s.g; if (s.g <= -0.5) return s.g; } return P.steps.at(-1).g; };

// ---------- run ----------
const fires = load(path.join(HERE, 'fires_index.json'));
const days = [...new Set(fires.map(f => f.day))].sort();
const splitDay = days[Math.floor(days.length / 2)];
const built = [];
for (const f of fires) { const P = buildPath(f); if (P) built.push(P); }
console.log(`built paths: ${built.length}/${fires.length}  (split at ${splitDay})\n`);

const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const med = a => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const win = a => a.filter(x => x > 0).length / a.length;
const pct = x => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%`;

function evalStrat(name, subset) {
  const g = subset.map(P => S[name](P));
  return { name, n: g.length, mean: mean(g), med: med(g), win: win(g) };
}
const filt = (pred) => built.filter(pred);
function leaderboard(label, subset) {
  console.log(`\n===== ${label}  (n=${subset.length}) =====`);
  const rows = Object.keys(S).map(k => evalStrat(k, subset)).sort((a, b) => b.mean - a.mean);
  console.log('strategy'.padEnd(22) + 'avg'.padStart(7) + 'median'.padStart(8) + 'win%'.padStart(7));
  for (const r of rows) console.log(r.name.padEnd(22) + pct(r.mean).padStart(7) + pct(r.med).padStart(8) + (r.win * 100).toFixed(0).padStart(6) + '%');
}
// headline: all fires, then BULL_REVERSE (the real edge), with train/test
leaderboard('ALL FIRES', built);
leaderboard('BULL_REVERSE only', filt(P => P.fire.state === 'BULL_REVERSE'));
leaderboard('BULL_REVERSE · TRAIN (first half days)', filt(P => P.fire.state === 'BULL_REVERSE' && P.fire.day < splitDay));
leaderboard('BULL_REVERSE · TEST (last half days)', filt(P => P.fire.state === 'BULL_REVERSE' && P.fire.day >= splitDay));
