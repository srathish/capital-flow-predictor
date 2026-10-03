// verify_calls.mjs — what ACTUALLY happened after each timestamped directional index call in the Discord ledgers.
// For every SPX/SPY/QQQ record with action=call|entry and a bullish/bearish direction during RTH:
//   entry = close of the 1-min bar at the call minute; forward signed return at +15/+30/+60 min and EOD; MFE/MAE in 60 min.
// Baseline = the unconditional forward return at the same minutes (separates "called it" from "the tape was going up anyway").
import fs from 'node:fs';
import { atlasHistory } from '../feeds/skylit.js';

const LEDGER_DIR = decodeURIComponent(new URL('./ledgers/', import.meta.url).pathname);
const PX = { SPX: 'SPX', SPXW: 'SPX', SPY: 'SPY', QQQ: 'QQQ' };
const who = (a) => { a = (a || '').split('(')[0].trim(); for (const k of ['Glitch', 'Giul', 'jack', 'TheArchitect', 'TheQuietCalf', 'garma', 'Wicksy', 'Hamoudi', 'Scarface', 'TT', 'Tirth', 'Real Blonde Broker']) if (a.toLowerCase().startsWith(k.toLowerCase())) return k; return a; };

// ---- load + dedupe calls ----
let calls = [];
for (const f of fs.readdirSync(LEDGER_DIR).filter((x) => x.startsWith('calls_') && x.endsWith('.jsonl'))) {
  for (const line of fs.readFileSync(LEDGER_DIR + f, 'utf8').split('\n')) {
    if (!line.trim()) continue; let r; try { r = JSON.parse(line); } catch { continue; }
    const sym = PX[(r.ticker || '').toUpperCase()]; if (!sym) continue;
    if (!['call', 'entry'].includes(r.action) || !['bullish', 'bearish'].includes(r.direction) || !r.time) continue;
    const t = Math.floor(Date.parse(r.time.length === 16 ? r.time + ':00Z' : r.time) / 1000); if (!Number.isFinite(t)) continue;
    calls.push({ t, sym, dir: r.direction === 'bullish' ? 1 : -1, who: who(r.author), chan: r.chan, setup: r.setup || 'none', level_type: r.level_type || 'none', instrument: r.instrument || 'none', quote: r.quote });
  }
}
calls.sort((a, b) => a.t - b.t);
const seen = new Map(); calls = calls.filter((c) => { const k = `${c.who}|${c.sym}|${c.dir}`; const last = seen.get(k); if (last != null && c.t - last < 30 * 60) return false; seen.set(k, c.t); return true; });
console.log(`directional index calls after 30-min dedupe: ${calls.length}`);

// ---- price: 1-min bars in ≤120-day windows ----
const t0 = calls[0].t - 86400, t1 = calls[calls.length - 1].t + 86400;
const bars = {};
for (const sym of [...new Set(calls.map((c) => c.sym))]) {
  const m = new Map();
  for (let a = t0; a < t1; a += 120 * 86400) {
    const chunk = await atlasHistory(sym, '1', a, Math.min(t1, a + 120 * 86400));
    for (const b of chunk) m.set(b.t, b);
  }
  bars[sym] = { byT: m, sorted: [...m.values()].sort((x, y) => x.t - y.t) };
  console.log(`${sym}: ${m.size} 1-min bars`);
}
const dayOf = (t) => new Date((t - 4 * 3600) * 1000).toISOString().slice(0, 10);
const eodBy = {}; for (const [sym, b] of Object.entries(bars)) { eodBy[sym] = {}; for (const x of b.sorted) eodBy[sym][dayOf(x.t)] = x; }
function at(sym, t) { const m = bars[sym].byT; for (let k = 0; k <= 3; k++) { const b = m.get(Math.floor(t / 60) * 60 + k * 60); if (b) return b; } return null; }
function path(sym, t, mins) { const out = []; const m = bars[sym].byT; for (let k = 1; k <= mins; k++) { const b = m.get(Math.floor(t / 60) * 60 + k * 60); if (b) out.push(b); } return out; }

// ---- score ----
const rows = [];
for (const c of calls) {
  const e = at(c.sym, c.t); if (!e) continue;               // not RTH / no bar
  const p = e.c, fwd = {};
  for (const m of [15, 30, 60]) { const b = at(c.sym, c.t + m * 60); fwd[m] = b ? (b.c - p) / p * 1e4 : null; }
  const eod = eodBy[c.sym][dayOf(c.t)]; fwd.eod = eod && eod.t > e.t ? (eod.c - p) / p * 1e4 : null;
  const pth = path(c.sym, c.t, 60);
  const mfe = pth.length ? Math.max(...pth.map((b) => c.dir > 0 ? (b.h - p) / p * 1e4 : (p - b.l) / p * 1e4)) : null;
  const mae = pth.length ? Math.max(...pth.map((b) => c.dir > 0 ? (p - b.l) / p * 1e4 : (b.h - p) / p * 1e4)) : null;
  rows.push({ ...c, raw: fwd, signed: Object.fromEntries(Object.entries(fwd).map(([k, v]) => [k, v == null ? null : v * c.dir])), mfe, mae });
}
console.log(`scored (RTH, price found): ${rows.length}`);

// baseline: unconditional forward returns at random RTH minutes per symbol
function baseline(sym, n = 3000) {
  const s = bars[sym].sorted, out = { 15: [], 30: [], 60: [] };
  for (let i = 0; i < n; i++) { const b = s[Math.floor(Math.random() * s.length)]; for (const m of [15, 30, 60]) { const f = at(sym, b.t + m * 60); if (f && dayOf(f.t) === dayOf(b.t)) out[m].push((f.c - b.c) / b.c * 1e4); } }
  return out;
}
const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const hit = (a) => a.length ? a.filter((x) => x > 0).length / a.length * 100 : NaN;
const se = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)) / Math.sqrt(a.length); };

function report(label, R) {
  const v = (k) => R.map((r) => r.signed[k]).filter((x) => x != null);
  const s30 = v(30);
  const z = s30.length > 5 ? mean(s30) / se(s30) : NaN;
  console.log(`${label.padEnd(38)} n=${String(R.length).padStart(4)}  hit15 ${hit(v(15)).toFixed(0)}%  hit30 ${hit(s30).toFixed(0)}%  hit60 ${hit(v(60)).toFixed(0)}%  hitEOD ${hit(v('eod')).toFixed(0)}%  | mean30 ${mean(s30).toFixed(1)}bps (t=${z.toFixed(1)})  mean60 ${mean(v(60)).toFixed(1)}  MFE60 ${mean(R.map((r) => r.mfe).filter((x) => x != null)).toFixed(0)} MAE60 ${mean(R.map((r) => r.mae).filter((x) => x != null)).toFixed(0)}`);
}

console.log('\n===== BASELINE (no call): unconditional forward return at random RTH minutes =====');
for (const sym of Object.keys(bars)) { const b = baseline(sym); console.log(`${sym.padEnd(5)} up15 ${hit(b[15]).toFixed(0)}%  up30 ${hit(b[30]).toFixed(0)}%  up60 ${hit(b[60]).toFixed(0)}%  mean30 ${mean(b[30]).toFixed(2)}bps`); }

console.log('\n===== ALL CALLS =====');
report('ALL', rows);
report('  bullish calls', rows.filter((r) => r.dir > 0));
report('  bearish calls', rows.filter((r) => r.dir < 0));

console.log('\n===== BY CALLER (n≥15) =====');
const byWho = {}; for (const r of rows) (byWho[r.who] ||= []).push(r);
for (const [w, R] of Object.entries(byWho).sort((a, b) => b[1].length - a[1].length)) if (R.length >= 15) report(w, R);

console.log('\n===== BY SETUP (n≥15) =====');
const bySet = {}; for (const r of rows) (bySet[r.setup] ||= []).push(r);
for (const [k, R] of Object.entries(bySet).sort((a, b) => b[1].length - a[1].length)) if (R.length >= 15) report(k, R);

console.log('\n===== BY LEVEL TYPE (n≥15) =====');
const byLvl = {}; for (const r of rows) (byLvl[r.level_type] ||= []).push(r);
for (const [k, R] of Object.entries(byLvl).sort((a, b) => b[1].length - a[1].length)) if (R.length >= 15) report(k, R);

console.log('\n===== BY SYMBOL =====');
for (const sym of Object.keys(bars)) report(sym, rows.filter((r) => r.sym === sym));

fs.writeFileSync(new URL('./ledgers/verified_index_calls.json', import.meta.url), JSON.stringify(rows));
console.log('\nsaved ledgers/verified_index_calls.json');
