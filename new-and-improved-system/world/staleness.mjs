#!/usr/bin/env node
// How STALE is 13F data? For every new/increased position, split the stock's excess return (vs the universe median over the same
// window) into: (1) BUYING  quarter start → quarter end (when the manager could have bought), (2) LAG  quarter end → 13F filing date
// (public, but not yet), (3) COPY  filing → +6 months (what a copier gets). Groups: all managers, SA LP (CIK 2045724), and the
// top-decile managers by their own later realized excess. 0 credits (cached positions + prices).
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { worldUniverse } from './collect.mjs';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), C = path.join(ROOT, '.cache'), B = path.join(C, 'sec_bulk');
const rd = (f, d = null) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d), ymd = (t) => new Date((t + 43200) * 1000).toISOString().slice(0, 10);
const addD = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const P = new Map(); for (const { t } of worldUniverse()) { let b = rd(path.join(C, 'wdaily', `${t}.json`), []); if (!b.length) b = (rd(path.join(C, 'daily', `${t}.json`), []) || []).map((x) => ({ d: ymd(x.t), c: x.c })); if (b.length > 70) P.set(t, { d: b.map((x) => x.d), c: b.map((x) => x.c) }); }
const at = (t, d) => { const p = P.get(t); let lo = 0, hi = p.d.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (p.d[m] <= d) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
const ret = (t, a, b) => { const p = P.get(t); if (!p) return null; const i = at(t, a), j = at(t, b); return i >= 0 && j > i && p.d[j] >= addD(b, -7) ? p.c[j] / p.c[i] - 1 : null; };
const medC = new Map(); const med = (a, b) => { const k = a + b; if (medC.has(k)) return medC.get(k); const v = [...P.keys()].map((t) => ret(t, a, b)).filter((x) => x != null).sort((x, y) => x - y); const m = v.length > 50 ? v[v.length >> 1] : null; medC.set(k, m); return m; };
const ex = (t, a, b) => { const r = ret(t, a, b), m = med(a, b); return r == null || m == null ? null : r - m; };
// per manager × period holdings
const mgr = new Map(); const rl = readline.createInterface({ input: fs.createReadStream(path.join(B, 'positions.jsonl')), crlfDelay: Infinity });
for await (const line of rl) { if (!line) continue; const o = JSON.parse(line); if (o.call || !P.has(o.t)) continue; let M = mgr.get(o.m); if (!M) mgr.set(o.m, (M = new Map())); let F = M.get(o.p); if (!F) M.set(o.p, (F = { p: o.p, f: o.f, pos: new Map() })); if (o.f < F.f) F.f = o.f; F.pos.set(o.t, (F.pos.get(o.t) ?? 0) + o.sh); }
const rows = [];
for (const [m, M] of mgr) { const fs_ = [...M.values()].sort((a, b) => a.p.localeCompare(b.p));
  for (let i = 1; i < fs_.length; i++) { const prev = fs_[i - 1].pos, cur = fs_[i]; if (cur.f < '2022-01-01' || cur.f > '2026-03-31') continue;
    const qs = addD(cur.p, -91), lagDays = (Date.parse(cur.f) - Date.parse(cur.p)) / 864e5;
    for (const [t, sh] of cur.pos) { const ps = prev.get(t) ?? 0; if (!(sh > 0 && (ps === 0 || sh >= 1.25 * ps))) continue;
      rows.push({ m, t, buy: ex(t, qs, cur.p), lag: ex(t, cur.p, cur.f), copy: ex(t, cur.f, addD(cur.f, 182)), lagDays }); } } }
const mean = (a) => { a = a.filter((x) => x != null && Number.isFinite(x)); return a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN; };
const pc = (x) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%' : '-');
// "realized skill" decile (hindsight label — descriptive only: are even the BEST managers' gains mostly gone before the filing?)
const byM = new Map(); for (const r of rows) { const a = byM.get(r.m) ?? []; a.push(r); byM.set(r.m, a); }
const skill = [...byM.entries()].filter(([, a]) => a.length >= 20).map(([m, a]) => [m, mean(a.map((r) => (r.buy ?? 0) + (r.lag ?? 0) + (r.copy ?? 0)))]).sort((a, b) => b[1] - a[1]);
const topDec = new Set(skill.slice(0, Math.round(skill.length / 10)).map((x) => x[0]));
console.log(`13F STALENESS · ${rows.length} new/increased positions (2022–2026 filings) · median filing lag ${[...rows.map((r) => r.lagDays)].sort((a, b) => a - b)[rows.length >> 1]} days after quarter-end\n`);
console.log('average excess return vs the median stock, by window:');
console.log(`${''.padEnd(40)} ${'1 BUYING (quarter)'.padStart(19)} ${'2 LAG (to filing)'.padStart(18)} ${'3 COPY (6m after)'.padStart(18)}   share of the move a copier misses`);
for (const [name, f] of [['all managers', () => true], ['top-decile managers (hindsight label)', (r) => topDec.has(r.m)], ['Situational Awareness LP', (r) => r.m === '0002045724']]) {
  const X = rows.filter(f), b = mean(X.map((r) => r.buy)), l = mean(X.map((r) => r.lag)), c = mean(X.map((r) => r.copy)), tot = b + l + c;
  console.log(`  ${name.padEnd(38)} ${pc(b).padStart(19)} ${pc(l).padStart(18)} ${pc(c).padStart(18)}   ${Number.isFinite(tot) && tot !== 0 ? Math.round(((b + l) / tot) * 100) + '%' : '-'}  (n ${X.length})`);
}
