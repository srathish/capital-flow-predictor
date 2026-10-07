#!/usr/bin/env node
// Live paper test — money list (DESIGN_v6 adopted rules, frozen): bottleneck version C + price-to-sales cap (skip top decile),
// 20 equal slots, selling rule C1 (sell when out of the top 60 at a monthly run, or still below entry 63 trading days after
// buying; 24-month cap), quarantine exits. Paper fills at the run date's close. State: world/paper/money_state.json.
//   node world/paper_money.mjs            (one monthly step as of the latest price date)
import fs from 'node:fs';
import path from 'node:path';
import { TAGS } from './facts_collect.mjs';
import { universeV2 } from './universe_prices.mjs';
import { cleanBars, gapsOf, blockedAt, crosses, isTradingDay } from './prices_clean.mjs';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), C = path.join(ROOT, '.cache'), PAPER = path.join(ROOT, 'world', 'paper'), STATE = path.join(PAPER, 'money_state.json');
const rd = (f, d = null) => { try { return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d; } catch { return d; } };
const addD = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10), days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length, sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const SLOTS = 20;
// ---------- data ----------
function series(facts, tags) { const q = new Map(), ann = new Map();
  for (const tag of tags) for (const x of facts?.[tag] ?? []) { const dur = days(x.s, x.e), tgt = dur >= 80 && dur <= 100 ? q : dur >= 350 && dur <= 380 ? ann : null; if (!tgt) continue;
    const cur = tgt.get(x.e); if (cur && (cur.tag !== tag ? true : cur.f <= x.f)) continue; tgt.set(x.e, { v: x.v, f: x.f, s: x.s, tag }); }
  for (const [e, a] of ann) { if ([...q.keys()].some((k) => Math.abs(days(k, e)) <= 5)) continue; const inside = [...q.entries()].filter(([k, x]) => days(a.s, x.s) >= -5 && days(k, e) >= 0); if (inside.length !== 3) continue;
    q.set(e, { v: a.v - inside.reduce((s, [, x]) => s + x.v, 0), f: [a.f, ...inside.map(([, x]) => x.f)].sort().at(-1) }); }
  return q; }
const RAWQ = new Map(), SIC3 = new Map(), SHR = new Map();
for (const t of universeV2(1e9).map((x) => x.t)) { const F = rd(path.join(C, 'edgar', 'facts', `${t}.json`), null); if (!F?.rev) continue; const rev = series(F.rev, TAGS.rev), gp = series(F.gp, TAGS.gp), cost = series(F.cost, TAGS.cost), rows = [];
  for (const [e, r] of rev) { let g = null, f = r.f; const a = gp.get(e), c = cost.get(e); if (a) { g = a.v / r.v; f = [f, a.f].sort().at(-1); } else if (c) { g = (r.v - c.v) / r.v; f = [f, c.f].sort().at(-1); } rows.push({ e, rev: r.v, gm: g, f }); }
  RAWQ.set(t, rows.sort((x, y) => x.e.localeCompare(y.e))); const s = rd(path.join(C, 'edgar', 'sic', `${t}.json`)); if (s?.sic) SIC3.set(t, String(s.sic).padStart(4, '0').slice(0, 3));
  const H = rd(path.join(C, 'edgar', 'facts3', `${t}.json`), {}); const a = []; for (const tag of ['EntityCommonStockSharesOutstanding', 'CommonStockSharesOutstanding']) for (const x of H.sh?.[tag] ?? []) a.push({ d: x.f, v: x.v }); if (a.length) SHR.set(t, a.sort((x, y) => x.d.localeCompare(y.d))); }
const GUID = new Map(); { const g = rd(path.join(C, 'edgar', 'guidance_hist.json'), null); if (g) for (const r of g) { if (!r.t || !r.d) continue; const a = GUID.get(r.t) ?? []; a.push({ d: r.d, dir: r.dir }); GUID.set(r.t, a); } }
const HAVE_GUID = GUID.size > 0;
function load(cut) { const P = new Map();
  for (const t of RAWQ.keys()) { const cb = cleanBars(t); let b = cb.bars; if (cut) b = b.filter((x) => x.d <= cut); if (b.length > 70) P.set(t, { d: b.map((x) => x.d), c: b.map((x) => x.c), v: b.map((x) => x.v || 0), bad: cut ? cb.bad.filter((w) => w.at <= cut) : cb.bad, gaps: gapsOf(b) }); }
  const spy = rd(path.join(C, 'wdaily_hist', 'SPY_full.json'), []).filter((x) => isTradingDay(x.d)); const sp = cut ? spy.filter((x) => x.d <= cut) : spy;
  return { P, cal: sp.map((x) => x.d), spy: sp }; }
const idx = (p, d) => { let lo = 0, hi = p.d.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (p.d[m] <= d) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
const ser = (a, d) => { let lo = 0, hi = a.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m].d <= d) { r = m; lo = m + 1; } else hi = m - 1; } return r >= 0 ? a[r] : null; };

// ---------- ranking at a date ----------
const RC = new Map();
function rankAt(D, M) { const key = (D.cut ?? 'full') + M; if (RC.has(key)) return RC.get(key); const { P } = D;
  const elig = [...P.keys()].filter((t) => { const p = P.get(t), j = idx(p, M); if (j < 64 || p.d[j] < addD(M, -7) || blockedAt(p.bad, p.gaps, M)) return false; let dv = 0; for (let k = j - 49; k <= j; k++) dv += p.c[k] * p.v[k]; return p.c[j] >= 5 && dv / 50 >= 2e7; });
  const F = [];
  for (const t of elig) { const rows = RAWQ.get(t).filter((x) => x.f <= M), q0 = rows.at(-1); if (!q0 || days(q0.e, M) > 200 || q0.rev < 25e6) continue;
    const find = (ref, lo, hi) => ref && rows.filter((x) => { const d = days(x.e, ref.e); return d >= lo && d <= hi; }).at(-1);
    const q1 = find(q0, 80, 100), q4 = find(q0, 345, 385), q5 = find(q1, 345, 385); if (!q1 || !q4 || !q5 || !(q4.rev > 0 && q5.rev > 0) || q0.gm == null || q4.gm == null) continue;
    const g0 = q0.rev / q4.rev - 1, g1 = q1.rev / q5.rev - 1, ttm = rows.filter((x) => days(x.e, q0.e) >= 0 && days(x.e, q0.e) < 300).slice(-4); F.push({ t, g0, accel: g0 - g1, dGM: q0.gm - q4.gm, gm4: q4.gm, ttm: ttm.length === 4 ? ttm.reduce((s, x) => s + x.rev, 0) : null }); }
  const rk = ['g0', 'accel', 'dGM'].map((k) => { const s = F.map((f) => f[k]).sort((a, b) => a - b); return (v) => { let lo = 0, hi = s.length; while (lo < hi) { const m = (lo + hi) >> 1; if (s[m] < v) lo = m + 1; else hi = m; } return lo / (s.length - 1 || 1); }; });
  for (const f of F) { f.s = (rk[0](f.g0) + rk[1](f.accel) + rk[2](f.dGM)) / 3; const p = P.get(f.t), j = idx(p, M); const c = (k) => p.c[Math.max(0, k)]; let ma = 0; for (let k = Math.max(0, j - 199); k <= j; k++) ma += p.c[k];
    f.mom = j >= 252 ? c(j - 21) / c(j - 252) - 1 : null; f.a200 = p.c[j] > ma / Math.min(200, j + 1); f.r6 = c(j) / c(j - 126) - 1; const lr = []; for (let k = Math.max(1, j - 59); k <= j; k++) lr.push(Math.log(p.c[k] / p.c[k - 1])); f.vol = sd(lr) || 0.02;
    let dv = 0; for (let k = j - 49; k <= j; k++) dv += p.c[k] * p.v[k]; f.dv = dv / 50; const sh = ser(SHR.get(f.t) ?? [], M); f.ps = sh && f.ttm > 0 ? (sh.v * p.c[j]) / f.ttm : null; }
  const hard = F.filter((f) => f.gm4 >= 0).sort((a, b) => b.s - a.s), rankA = new Map(hard.map((f, i) => [f.t, i]));
  const C = hard.filter((f) => f.mom != null && f.mom > 0 && f.a200); const ps = C.map((f) => f.ps).filter((x) => x != null).sort((a, b) => a - b), ps90 = ps.length ? ps[Math.floor(ps.length * 0.9)] : Infinity;
  const out = { M, C, rankA, byT: new Map(F.map((f) => [f.t, f])), ps90 }; RC.set(key, out); return out; }


// ---------- one monthly paper step ----------
const D = load(null); D.cut = null; const dNow = D.cal.at(-1), R = rankAt(D, dNow), S = rd(STATE, { start: dNow, cash: 1, pos: [], trades: [], marks: [] });
const px = (t) => { const p = D.P.get(t); if (!p) return null; const j = idx(p, dNow); return j >= 0 ? p.c[j] : null; }, tdays = (a) => D.cal.filter((d) => d > a && d <= dNow).length;
let eq = S.cash + S.pos.reduce((s, x) => s + x.u * (px(x.t) ?? x.last ?? x.px), 0);
const sells = [];
for (const x of S.pos) { const c = px(x.t) ?? x.last, p = D.P.get(x.t); let why = null;
  if (p && crosses(p.bad, p.gaps, x.lastRun ?? x.d0, dNow)) why = 'data (price quarantine)';
  else if (!((R.rankA.get(x.t) ?? 1e9) < 60)) why = 'dropped out of the top 60';
  else if (days(x.d0, dNow) >= 730) why = '24-month cap';
  else if (tdays(x.d0) >= 63 && c < x.px) why = 'below entry after 3 months';
  if (why) sells.push({ x, c: why.startsWith('data') ? (x.last ?? x.px) : c, why }); }
for (const s of sells) { S.cash += s.x.u * s.c * (1 - 0.0005); S.trades.push({ side: 'sell', t: s.x.t, d: dNow, px: s.c, entry: s.x.px, d0: s.x.d0, r: s.c / s.x.px - 1, why: s.why }); }
S.pos = S.pos.filter((x) => !sells.some((s) => s.x === x)); for (const x of S.pos) { x.last = px(x.t) ?? x.last; x.lastRun = dNow; }
const held = new Set(S.pos.map((x) => x.t)), buys = [];
for (const f of R.C) { if (S.pos.length + buys.length >= SLOTS) break; if (held.has(f.t)) continue; if (f.ps != null && f.ps >= R.ps90) continue; buys.push(f); }
eq = S.cash + S.pos.reduce((s, x) => s + x.u * (x.last ?? x.px), 0);
for (const f of buys) { const c = px(f.t), amt = Math.min(eq / SLOTS, S.cash); if (!c || amt <= 0) continue; S.cash -= amt; S.pos.push({ t: f.t, u: (amt * (1 - 0.0005)) / c, px: c, d0: dNow, last: c, lastRun: dNow, why: `revenue ${(f.g0 * 100).toFixed(0)}% YoY, growth ${(f.accel * 100).toFixed(0)} pts, gross margin +${(f.dGM * 100).toFixed(0)} pts vs a year ago${f.ps ? `, price/sales ${f.ps.toFixed(1)}` : ''}` });
  S.trades.push({ side: 'buy', t: f.t, d: dNow, px: c }); }
eq = S.cash + S.pos.reduce((s, x) => s + x.u * (x.last ?? x.px), 0); const spy = D.spy.at(-1).c; if (!S.spy0) S.spy0 = spy; S.marks.push({ d: dNow, eq, spy: spy / S.spy0 });
fs.mkdirSync(PAPER, { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(S, null, 1));
console.log(`# Money list — paper portfolio as of ${dNow} (started ${S.start})\n\nValue ${(eq * 100).toFixed(1)} (start 100) · SPY ${(spy / S.spy0 * 100).toFixed(1)} · cash ${(S.cash * 100).toFixed(1)}\n`);
console.log(`Sold this run (${sells.length}): ${sells.map((s) => `${s.x.t} ${((s.c / s.x.px - 1) * 100).toFixed(0)}% (${s.why})`).join(' · ') || 'none'}`);
console.log(`Bought this run (${buys.length}): ${buys.map((f) => f.t).join(', ') || 'none'}\n\n| stock | since | entry | now | return | why bought |\n|---|---|---|---|---|---|`);
for (const x of S.pos) console.log(`| ${x.t} | ${x.d0} | ${x.px.toFixed(2)} | ${(x.last ?? x.px).toFixed(2)} | ${(((x.last ?? x.px) / x.px - 1) * 100).toFixed(1)}% | ${x.why ?? ''} |`);
