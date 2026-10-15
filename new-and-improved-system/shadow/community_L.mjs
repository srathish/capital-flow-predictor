#!/usr/bin/env node
// Community batch part L — lunch fade (shadow/DESIGN_community_batch.md). Minute handling copied from vwap_node.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SH = path.dirname(fileURLToPath(import.meta.url)), C = path.join(SH, '..', '.cache'), OUT = path.join(SH, 'results_community'), SMOKE = process.argv.includes('--smoke');
if (!SMOKE && fs.existsSync(path.join(OUT, 'L.json')) && !process.argv.includes('--force')) { console.error('already run'); process.exit(1); }
const START = '2023-11-09', BUILD_END = '2025-03-31', HOLD_START = '2025-04-01';
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const offC = new Map(), etMin = (t, d) => { if (!offC.has(d)) { const h = +new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date(d + 'T16:00:00Z')); offC.set(d, (h - 16) * 60); } return (((Math.floor(t / 60) + offC.get(d)) % 1440) + 1440) % 1440; };
function loadDay(T, d) { const f = path.join(C, 'uw', 'm1', T, `${d}.json`); if (!fs.existsSync(f)) return null; const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  let reg = raw.filter((b) => b.m === 'r').map((b) => ({ ...b, etm: etMin(b.t, d) })).filter((b) => b.etm >= 570 && b.etm < 960); if (reg.length < 200) return null;
  const filled = [reg[0]]; for (let i = 1; i < reg.length; i++) { for (let m = filled.at(-1).etm + 1; m < reg[i].etm; m++) { const c0 = filled.at(-1).c; filled.push({ t: filled.at(-1).t + 60, o: c0, h: c0, l: c0, c: c0, v: 0, etm: m }); } filled.push(reg[i]); }
  return filled; }
const tr = [];
for (const T of ['SPY', 'QQQ', 'IWM', 'DIA']) { let days = fs.readdirSync(path.join(C, 'uw', 'm1', T)).map((f) => f.slice(0, 10)).filter((d) => d >= START && d <= '2026-10-02'); if (SMOKE) days = days.slice(-60);
  for (const d of days) { const B = loadDay(T, d); if (!B) continue; const at = (m) => B.find((b) => b.etm === m)?.c; const r0 = at(599), e = at(689), x = at(809); if (!(r0 && e && x) || B.at(-1).etm < 900) continue; /* skip half days */
    const mv = e / r0 - 1; if (mv === 0) continue; const dir = -Math.sign(mv); tr.push({ T, d, mv, ret: dir * (x / e - 1) - 0.02 / e }); } }
function st(a) { const n = a.length; if (n < 30) return { n, m: NaN, t: NaN }; const m = mean(a.map((x) => x.ret)), by = new Map(); for (const x of a) by.set(x.d, (by.get(x.d) ?? 0) + (x.ret - m)); const G = by.size; const se = Math.sqrt(([...by.values()].reduce((s, v) => s + v * v, 0) * G) / Math.max(1, G - 1)) / n;
  return { n, m, t: m / se, win: a.filter((x) => x.ret > 0).length / n }; }
if (SMOKE) { console.log(JSON.stringify({ n: tr.length })); process.exit(0); }
const B = (x) => x.d <= BUILD_END, Hd = (x) => x.d >= HOLD_START;
const H = [['L1', 0], ['L2', 0.0025], ['L3', 0.005]].map(([id, th]) => { const f = (x) => Math.abs(x.mv) >= th; return { id, th, build: st(tr.filter((x) => B(x) && f(x))), hold: st(tr.filter((x) => Hd(x) && f(x))), perT: Object.fromEntries(['SPY', 'QQQ', 'IWM', 'DIA'].map((T) => [T, { build: st(tr.filter((x) => x.T === T && B(x) && f(x))), hold: st(tr.filter((x) => x.T === T && Hd(x) && f(x))) }])) }; });
const months = {}; for (const x of tr) (months[x.d.slice(0, 7)] ??= []).push(x.ret);
fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'L.json'), JSON.stringify({ run: new Date().toISOString(), H, monthsPositive: Object.values(months).filter((a) => mean(a) > 0).length, months: Object.keys(months).length }, null, 1));
console.log(JSON.stringify(H.map((x) => [x.id, x.hold.m, x.hold.t, x.hold.n])));
