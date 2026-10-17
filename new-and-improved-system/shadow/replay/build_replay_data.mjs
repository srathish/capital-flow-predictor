#!/usr/bin/env node
// Builds replay_data.json for the map replay page: SPY 1-minute bars, prior-close UW gamma/vanna nodes, Rapid-style
// ladder levels, ±1σ expected range (VIX), and every signal from the two tested rules (air-pocket wide-stop; ladder +
// GEX/VEX confluence) with its outcome. node shadow/replay/build_replay_data.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UW_API_KEY } from '../../feeds/env.js';
const HERE = path.dirname(fileURLToPath(import.meta.url)), C = path.join(HERE, '..', '..', '.cache');
const uw = async (p) => { await new Promise((r) => setTimeout(r, 120)); const r = await fetch(`https://api.unusualwhales.com/api${p}`, { headers: { Authorization: `Bearer ${UW_API_KEY}` } }); if (!r.ok) throw new Error(`${p} ${r.status}`); return r.json(); };
const et = (iso) => { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(iso)); return +p.find((x) => x.type === 'hour').value * 60 + +p.find((x) => x.type === 'minute').value; };
const VIX = JSON.parse(fs.readFileSync(path.join(C, 'cboe', 'VIX.json'), 'utf8'));
const daily = (await uw('/stock/SPY/ohlc/1d?timeframe=3M')).data.filter((b) => b.market_time === 'r').map((b) => ({ d: b.date, h: +b.high, l: +b.low, c: +b.close })).sort((a, b) => a.d.localeCompare(b.d));
const sessions = daily.filter((b) => b.d >= '2026-09-24' && b.d <= '2026-10-16').map((b) => b.d);
const out = [];
for (const d of sessions) { const i = daily.findIndex((b) => b.d === d), p = daily[i - 1];
  const raw = (await uw(`/stock/SPY/ohlc/1m?date=${d}&limit=1000`)).data.map((b) => ({ m: et(b.start_time), o: +b.open, h: +b.high, l: +b.low, c: +b.close, v: +b.volume, s: b.market_time })).sort((a, b) => a.m - b.m);
  const B = raw.filter((b) => b.s === 'r' && b.m >= 570 && b.m < 960), pre = raw.filter((b) => b.s === 'pr' && b.v > 0); if (B.length < 200) continue;
  const g = (await uw(`/stock/SPY/greek-exposure/strike?date=${p.d}`)).data.map((r) => ({ k: +r.strike, g: +r.call_gex + +r.put_gex, v: +r.call_vanna + +r.put_vanna })).filter((x) => Math.abs(x.k / p.c - 1) <= 0.03);
  const gk = Math.max(...g.map((x) => Math.abs(x.g))), vk = Math.max(...g.map((x) => Math.abs(x.v))), king = g.find((x) => Math.abs(x.g) === gk);
  const nodes = g.filter((x) => Math.abs(x.g) >= 0.3 * gk).map((x) => ({ k: x.k, g: x.g, rel: x.g / gk, king: x.k === king.k })), gN = nodes.map((x) => x.k), vN = g.filter((x) => Math.abs(x.v) >= 0.3 * vk).map((x) => x.k);
  const or = B.filter((b) => b.m < 600), lv = { PDH: p.h, PDL: p.l, PDC: p.c, PMH: pre.length ? Math.max(...pre.map((b) => b.h)) : null, PML: pre.length ? Math.min(...pre.map((b) => b.l)) : null, ORH: Math.max(...or.map((b) => b.h)), ORL: Math.min(...or.map((b) => b.l)) };
  const vix = VIX[p.d]?.c ?? null, sig = vix ? p.c * vix / 100 / Math.sqrt(252) : null;
  const sim = (k, dir, entry, stop, tgt) => { const R = Math.abs(entry - stop); for (let j = k + 1; j < B.length && B[j].m < 955; j++) { const b = B[j]; if (dir > 0 ? b.l <= stop : b.h >= stop) return { exitM: b.m, exit: stop, R: dir * (stop - entry) / R, how: 'stop' }; if (dir > 0 ? b.h >= tgt : b.l <= tgt) return { exitM: b.m, exit: tgt, R: dir * (tgt - entry) / R, how: 'target' }; } const last = B.filter((b) => b.m < 955).at(-1); return { exitM: last.m, exit: last.c, R: dir * (last.c - entry) / R, how: 'close' }; };
  const signals = [], seen = new Set();
  for (let k = 1; k < B.length; k++) { const pc = B[k - 1].c, c = B[k].c, m = B[k].m;
    if (m >= 585 && m <= 900) for (const N of gN) { const up = pc <= N && c > N, dn = pc >= N && c < N; if (!up && !dn) continue; const dir = up ? 1 : -1, key = 'AP' + N + dir; if (seen.has(key)) continue; seen.add(key);
      const N2 = gN.filter((x) => (dir > 0 ? x > N : x < N)).sort((a, b) => dir * (a - b))[0]; if (N2 == null || Math.abs(N2 - N) / N < 0.004) continue; const stop = N * (1 - dir * 0.0015), tgt = N2 * (1 - dir * 0.0002); if (dir * (tgt - c) < Math.abs(c - stop)) continue;
      signals.push({ rule: 'air', m, dir, level: N, entry: c, stop, target: tgt, ...sim(k, dir, c, stop, tgt) }); }
    if (m >= 600 && m <= 900) { const ladder = [...new Set(Object.values(lv).filter((x) => x != null))].sort((a, b) => a - b);
      for (const L of ladder) { const up = pc <= L && c > L, dn = pc >= L && c < L; if (!up && !dn) continue; const dir = up ? 1 : -1, key = 'LC' + L + dir; if (seen.has(key)) continue; seen.add(key);
        const T = ladder.filter((x) => dir * (x - L) >= 0.0015 * L).sort((a, b) => dir * (a - b))[0]; if (T == null) continue; const TGT = [...gN, ...vN].some((x) => Math.abs(x / T - 1) <= 0.0015), AIR = !gN.some((x) => (dir > 0 ? x > L && x < T : x < L && x > T)); if (!(TGT && AIR)) continue;
        const stop = L * (1 - dir * 0.0005), tgt = T * (1 - dir * 0.0002); if (dir * (tgt - c) < Math.abs(c - stop)) continue; signals.push({ rule: 'ladder', m, dir, level: L, entry: c, stop, target: tgt, ...sim(k, dir, c, stop, tgt) }); } } }
  // option leg for each signal: ATM 0DTE (strike = entry rounded to $1), call for longs / put for shorts; real UW minute prices
  for (const x of signals) { const K = Math.round(x.entry), cp = x.dir > 0 ? 'C' : 'P', id = `SPY${d.slice(2, 4)}${d.slice(5, 7)}${d.slice(8, 10)}${cp}${String(K * 1000).padStart(8, '0')}`;
    try { const rows = ((await uw(`/option-contract/${id}/intraday?date=${d}`)).data ?? []).map((r) => ({ m: et(r.start_time), c: +r.close, h: +r.high })).filter((r) => r.c > 0).sort((u, v) => u.m - v.m);
      const at = (m) => rows.filter((r) => r.m <= m).at(-1) ?? null, en = rows.find((r) => r.m >= x.m) ?? null, ex = at(x.exitM);
      const peak = (lo, hi) => { const w = rows.filter((r) => r.m > lo && r.m <= hi); if (!w.length || !en) return null; const t = w.reduce((q, r) => ((r.h || r.c) > (q.h || q.c) ? r : q)); const px = t.h || t.c; return { px, m: t.m, pct: +((px / en.c - 1) * 100).toFixed(0) }; };
      x.opt = { peakHeld: en ? peak(en.m, x.exitM) : null, peakDay: en ? peak(en.m, 959) : null, contract: `SPY ${K}${cp === 'C' ? 'C' : 'P'} 0DTE`, strike: K, type: cp === 'C' ? 'call' : 'put', entryPx: en ? en.c : null, entryM: en ? en.m : null, exitPx: ex ? ex.c : null, pct: en && ex ? +((ex.c / en.c - 1) * 100).toFixed(0) : null }; }
    catch { x.opt = null; } }
  let A = 0, N = 0; for (const x of g) if (Math.abs(x.k / p.c - 1) <= 0.01) { A += Math.abs(x.g); N += x.g; } const a01 = A > 0 ? N / A : null; /* ±1% gamma balance; premium filter threshold 0.656 (frozen, straddle_forward.mjs) */
  out.push({ d, prevClose: p.c, vix, sigma: sig, a01: a01 == null ? null : +a01.toFixed(3), longGamma: a01 != null && a01 >= 0.656, dayRange: +(Math.max(...B.map((b) => b.h)) - Math.min(...B.map((b) => b.l))).toFixed(2), close: B.at(-1).c, levels: lv, nodes, bars: B.map((b) => [b.m, +b.o.toFixed(2), +b.h.toFixed(2), +b.l.toFixed(2), +b.c.toFixed(2)]), signals: signals.map((s) => ({ ...s, opt: s.opt, entry: +s.entry.toFixed(2), stop: +s.stop.toFixed(2), target: +s.target.toFixed(2), exit: +s.exit.toFixed(2), R: +s.R.toFixed(2) })) });
  console.error(d, 'bars', B.length, 'nodes', nodes.length, 'signals', signals.length); }
fs.writeFileSync(path.join(HERE, 'replay_data.json'), JSON.stringify({ built: new Date().toISOString(), symbol: 'SPY', sessions: out }));
