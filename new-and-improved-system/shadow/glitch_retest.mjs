#!/usr/bin/env node
// GLITCH'S METHOD, tested fairly: break → retest → hold, intraday on SPY. Locked 2026-10-05 BEFORE running.
// Data: UW SPY 1-min bars incl. premarket (UW quota only — run with SKYLIT_BUDGET=0; zero Skylit credits).
// Levels each day: PDH / PDL / PDC (prior regular session) · PMH / PML (today's premarket) · ORH / ORL (09:30–09:59, live from 10:00).
//   (0DTE map nodes left out: only 10 days of saved SPX maps — not worth credits.)
// BREAK   a 5-min bucket (from 09:35, last break 15:00) CLOSES ≥0.02% beyond the level after the prior bucket closed on the other side.
//         First break per level per day only.
// RETEST  within 60 min after the break: a 1-min bar trades back to the level (within 0.03%) and CLOSES back on the break side →
//         enter at that close. If price first closes 0.10% back through the level (failed break), no trade.
// STOP    0.10% beyond the level.  TARGET  the next known level ≥0.10% beyond entry in the trade's direction, else 2R.
// EXIT    stop or target on 1-min high/low (both in one bar → stop), else 15:55 close. COST 0.03% of price per round trip.
// CONTROLS (same rules otherwise):  CHASE — enter at the close of the break bucket ·  RANDOM — the same break-retest at a level the
//   same distance from the 09:30 open on a random side ·  MIRROR — same entries, opposite direction, same stop/target distances.
// TRAIN Jan–Jun 2026 · TEST Jul 1 – Oct 2 2026.
// PASS = net avg R > 0 in TRAIN and TEST, and TEST beats CHASE, RANDOM and MIRROR.
import fs from 'node:fs';
import path from 'node:path';
import { UW_API_KEY } from '../feeds/env.js';

const HERE = decodeURIComponent(new URL('.', import.meta.url).pathname), C = path.join(HERE, '..', '.cache', 'uw', 'spy1m');
const days = JSON.parse(fs.readFileSync(path.join(HERE, '..', '.cache', 'daily', 'SPY.json'), 'utf8')).map((b) => new Date((b.t + 12 * 3600) * 1000).toISOString().slice(0, 10)).filter((d) => d >= '2025-12-31' && d <= '2026-10-02');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function day1m(d) {
  const f = path.join(C, `${d}.json`); if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  for (let k = 0; k < 4; k++) {
    await sleep(260);
    const r = await fetch(`https://api.unusualwhales.com/api/stock/SPY/ohlc/1m?date=${d}&limit=1000`, { headers: { Authorization: `Bearer ${UW_API_KEY}`, Accept: 'application/json' } }).catch(() => null);
    if (r?.status === 429) { await sleep(4000 * (k + 1)); continue; }
    const j = r?.ok ? await r.json().catch(() => null) : null; if (!j) return null;
    const bars = (j.data ?? []).map((b) => ({ t: Math.floor(Date.parse(b.start_time) / 1000), o: +b.open, h: +b.high, l: +b.low, c: +b.close, m: b.market_time })).sort((a, b) => a.t - b.t);
    fs.mkdirSync(C, { recursive: true }); fs.writeFileSync(f, JSON.stringify(bars)); return bars;
  }
  return null;
}
let seed = 31; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const COST = process.env.COST != null ? +process.env.COST : 0.0003, BRK = 0.0002, TOL = 0.0003, STOPP = 0.001; // registered cost 0.03%; COST env = sensitivity only

function run(rth, levels, mode) { // levels: [{name, L, from}] (from = first RTH index the level is known)
  const out = [];
  for (const lv of levels) {
    const L = lv.L; let prevClose = null, done = false;
    for (let k = 1; (k + 1) * 5 <= rth.length && !done; k++) {
      const s = k * 5, bucket = rth.slice(s, s + 5), close = bucket.at(-1).c; prevClose = rth[s - 1].c;
      if (s < Math.max(5, lv.from) || s > 330) continue; // breaks 09:35 → 15:00
      const up = prevClose <= L && close >= L * (1 + BRK), dn = prevClose >= L && close <= L * (1 - BRK);
      if (!up && !dn) continue;
      done = true; const dir = up ? 1 : -1, j0 = s + 5;
      const stop = L * (1 - dir * STOPP);
      const known = levels.filter((x) => x.from <= j0 && x !== lv).map((x) => x.L);
      const tgtFor = (entry) => { const cand = known.filter((x) => dir * (x - entry) >= entry * 0.001).sort((a, b) => dir * (a - b)); return cand[0] ?? entry + dir * 2 * Math.abs(entry - stop); };
      let ei = null, entry = null;
      if (mode === 'chase') { ei = j0 - 1; entry = close; }
      else for (let j = j0; j < Math.min(rth.length, j0 + 60) && j <= 360; j++) {
        const b = rth[j];
        if (dir * (b.c - L) <= -STOPP * L) break; // failed break
        if ((dir > 0 ? b.l <= L * (1 + TOL) : b.h >= L * (1 - TOL)) && dir * (b.c - L) >= 0) { ei = j; entry = b.c; break; }
      }
      if (ei == null || dir * (entry - stop) <= 0) continue;
      let d = dir, st = stop, tg = tgtFor(entry);
      if (mode === 'mirror') { d = -dir; st = entry - d * Math.abs(entry - stop); tg = entry + d * Math.abs(tg - entry); }
      const risk = Math.abs(entry - st); let exit = null, why = 'time';
      for (let j = ei + 1; j < rth.length && j <= 385; j++) { const b = rth[j];
        const hitS = d > 0 ? b.l <= st : b.h >= st, hitT = d > 0 ? b.h >= tg : b.l <= tg;
        if (hitS) { exit = st; why = 'stop'; break; } if (hitT) { exit = tg; why = 'target'; break; } }
      if (exit == null) { exit = rth[Math.min(rth.length - 1, 385)].c; }
      const R = (d * (exit - entry) - COST * entry) / risk;
      out.push({ level: lv.name, dir: d, entryMin: ei, R, why });
    }
  }
  return out;
}

const res = { retest: [], chase: [], random: [], mirror: [] };
let used = 0, prev = null;
for (const d of days) {
  const bars = await day1m(d); if (!bars?.length) continue;
  const rth = bars.filter((b) => b.m === 'r'), pre = bars.filter((b) => b.m === 'pr');
  if (rth.length < 380) { prev = rth.length ? rth : prev; continue; }
  if (prev && d >= '2026-01-02') {
    const lv = [{ name: 'PDH', L: Math.max(...prev.map((b) => b.h)), from: 0 }, { name: 'PDL', L: Math.min(...prev.map((b) => b.l)), from: 0 }, { name: 'PDC', L: prev.at(-1).c, from: 0 }];
    if (pre.length > 20) lv.push({ name: 'PMH', L: Math.max(...pre.map((b) => b.h)), from: 0 }, { name: 'PML', L: Math.min(...pre.map((b) => b.l)), from: 0 });
    const or = rth.slice(0, 30); lv.push({ name: 'ORH', L: Math.max(...or.map((b) => b.h)), from: 30 }, { name: 'ORL', L: Math.min(...or.map((b) => b.l)), from: 30 });
    const open = rth[0].o, rlv = lv.map((x) => ({ ...x, name: 'RND-' + x.name, L: open + (rnd() < 0.5 ? -1 : 1) * Math.abs(x.L - open) }));
    const tag = (arr) => arr.map((t) => ({ ...t, d, set: d < '2026-07-01' ? 'TRAIN' : 'TEST' }));
    res.retest.push(...tag(run(rth, lv, 'retest'))); res.chase.push(...tag(run(rth, lv, 'chase'))); res.random.push(...tag(run(rth, rlv, 'retest'))); res.mirror.push(...tag(run(rth, lv, 'mirror')));
    used++;
  }
  prev = rth;
}
fs.writeFileSync(path.join(HERE, 'journal', 'glitch_retest.json'), JSON.stringify(res));
const st = (v) => { if (v.length < 2) return { n: v.length, m: NaN, t: NaN, win: NaN, tot: 0 }; const m = v.reduce((a, x) => a + x, 0) / v.length, s = Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1)); return { n: v.length, m, t: m / (s / Math.sqrt(v.length)), win: v.filter((x) => x > 0).length / v.length, tot: v.reduce((a, x) => a + x, 0) }; };
const line = (name, X, set) => { const s = st(X.filter((t) => t.set === set).map((t) => t.R)); return `  ${name.padEnd(30)} n ${String(s.n).padStart(4)} · win ${(s.win * 100).toFixed(0).padStart(3)}% · avg ${s.m >= 0 ? '+' : ''}${s.m.toFixed(3)}R (t ${s.t.toFixed(1)}) · total ${s.tot >= 0 ? '+' : ''}${s.tot.toFixed(1)}R`; };
console.log(`GLITCH break → retest → hold · SPY 1-min · ${used} sessions · costs 0.03%/round trip included\n`);
for (const set of ['TRAIN', 'TEST']) {
  console.log(`== ${set} (${set === 'TRAIN' ? 'Jan–Jun' : 'Jul–Oct 2'}) ==`);
  console.log(line('RETEST (Glitch)', res.retest, set)); console.log(line('CHASE (enter on the break)', res.chase, set));
  console.log(line('RANDOM levels, same method', res.random, set)); console.log(line('MIRROR (opposite side)', res.mirror, set));
}
const m = (X, set) => st(X.filter((t) => t.set === set).map((t) => t.R)).m;
const pass = m(res.retest, 'TRAIN') > 0 && m(res.retest, 'TEST') > 0 && m(res.retest, 'TEST') > m(res.chase, 'TEST') && m(res.retest, 'TEST') > m(res.random, 'TEST') && m(res.retest, 'TEST') > m(res.mirror, 'TEST');
console.log(`\nVERDICT: ${pass ? 'PASS' : 'FAIL'}`);
console.log('\n(descriptive, TRAIN only) by level:'); for (const L of ['PDH', 'PDL', 'PDC', 'PMH', 'PML', 'ORH', 'ORL']) console.log(line(L, res.retest.filter((t) => t.level === L), 'TRAIN'));
