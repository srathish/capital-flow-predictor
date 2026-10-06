#!/usr/bin/env node
// Node graph (DESIGN_graph.md, locked 0144a94b) — learn lead-lag connections → forecast next-quarter revenue acceleration →
// buy & hold. Walk-forward: connections re-learned every January from data filed before it; test months 2019-01 → 2026-03.
//   node --max-old-space-size=12000 world/graph_model.mjs           (outside nodes = the locked FRED list)
//   node --max-old-space-size=12000 world/graph_model.mjs --extra   (+ rates, dollar, oil, BTC, freight, retail sales — needs an
//                                                                     amendment committed before running)
// Runs once per mode (refuses if the report exists). 0 Skylit credits.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(decodeURIComponent(new URL('.', import.meta.url).pathname), '..'), C = path.join(ROOT, '.cache'), G = path.join(C, 'graph'), RES = path.join(ROOT, 'world', 'results_graph');
const EXTRA = process.argv.includes('--extra'), SMOKE = process.argv.includes('--smoke'), TAG = EXTRA ? 'graph_extra' : 'graph'; // --smoke: bug check on 2018 (training years), writes nothing
if (!SMOKE && fs.existsSync(path.join(RES, TAG + '.txt')) && !process.argv.includes('--force')) { console.error('already run: ' + TAG); process.exit(1); }
const rd = (f, d = null) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const addD = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const TOP = 20, KEEP = 60, HUBS = 300, MAXC = 10, LAGS = [1, 2, 3, 4], COST = 0.001, DRAWS = SMOKE ? 2 : 200;

// ---------- quarters ----------
const qk = (s) => +s.slice(0, 4) * 4 + (+s.slice(5) - 1), qEnd = (k) => new Date(Date.UTC(Math.floor(k / 4), (k % 4) * 3 + 3, 0)).toISOString().slice(0, 10);
const clip = (x) => Math.max(-1, Math.min(3, x));

// ---------- company nodes ----------
const panel = rd(path.join(G, 'panel.json'));
const CO = new Map(); // t → { rev,gm,capex,inv,rpo: Map k→{v,f} ; g, acc, cxg, ivg, rpg : Map k→{v,f} }
for (const [t, rows] of Object.entries(panel)) { const R = new Map(Object.entries(rows).map(([k, r]) => [qk(k), r]));
  const yoy = (fld, ff) => { const m = new Map(); for (const [k, r] of R) { const p = R.get(k - 4); if (r[fld] > 0 && p?.[fld] > 0) m.set(k, { v: clip(r[fld] / p[fld] - 1), f: [r.f, p.f, r[ff] ?? r.f, p[ff] ?? p.f].sort().at(-1) }); } return m; };
  const g = yoy('rev', 'f'), acc = new Map(); for (const [k, x] of g) { const p = g.get(k - 1); if (p) acc.set(k, { v: x.v - p.v, f: [x.f, p.f].sort().at(-1) }); }
  CO.set(t, { R, g, acc, cxg: yoy('capex', 'fcx'), ivg: yoy('inv', 'finv'), rpg: yoy('rpo', 'frpo') }); }

// ---------- root node: hyperscaler capex ----------
const HYP = ['MSFT', 'GOOGL', 'AMZN', 'META', 'ORCL'], root = new Map();
{ const ks = new Set(HYP.flatMap((t) => [...(CO.get(t)?.R.keys() ?? [])]));
  for (const k of ks) { let a = 0, b = 0, f = '', ok = true; for (const t of HYP) { const r = CO.get(t)?.R, x = r?.get(k), p = r?.get(k - 4); if (!(x?.capex > 0 && p?.capex > 0)) { ok = false; break; } a += x.capex; b += p.capex; f = [f, x.fcx ?? x.f, x.f].sort().at(-1); }
    if (ok) root.set(k, { v: clip(a / b - 1), f }); } }

// ---------- outside nodes (FRED) ----------
const fred = rd(path.join(G, 'fred.json')), DAILY = new Set(['DHHNGSP', 'DGS10', 'DTWEXBGS', 'DCOILWTICO', 'CBBTCUSD']), OUT = new Map();
for (const [id, s] of Object.entries(fred)) { if (!s.locked && !EXTRA) continue; const qv = new Map();
  for (const o of s.obs) { const k = qk(`${o.d.slice(0, 4)}Q${Math.floor((+o.d.slice(5, 7) - 1) / 3) + 1}`); const a = qv.get(k) ?? []; a.push(o.v); qv.set(k, a); }
  const m = new Map(); for (const [k, a] of qv) { const p = qv.get(k - 4); if (!p) continue; const x = mean(a), y = mean(p);
    const v = id === 'DGS10' ? (x - y) / 100 : y > 0 ? clip(x / y - 1) : null; if (v != null) m.set(k, { v, f: addD(qEnd(k), DAILY.has(id) ? 1 : 60) }); }
  OUT.set('fred:' + id, m); }

// ---------- prices / eligibility ----------
const P = new Map();
for (const t of CO.keys()) { const b = [...rd(path.join(C, 'wdaily_hist', `${t}.json`), []), ...rd(path.join(C, 'wdaily', `${t}.json`), [])]; if (b.length > 70) P.set(t, { d: b.map((x) => x.d), c: b.map((x) => x.c), v: b.map((x) => x.v || 0) }); }
const at = (t, d) => { const p = P.get(t); let lo = 0, hi = p.d.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (p.d[m] <= d) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
const eligible = (t, d) => { const p = P.get(t); if (!p) return false; const j = at(t, d); if (j < 64 || p.d[j] < addD(d, -7)) return false; let dv = 0; for (let k = j - 49; k <= j; k++) dv += p.c[k] * p.v[k]; return p.c[j] >= 5 && dv / 50 >= 2e7; };
const mom = (t, d) => { const p = P.get(t), i = at(t, addD(d, -365)), j = at(t, addD(d, -30)); return i >= 0 && j > i ? p.c[j] / p.c[i] - 1 : null; };
const latestQ = (m, d) => { let best = null; for (const [k, x] of m) if (x.f <= d && (!best || k > best)) best = k; return best; };
const known = (m, k, d) => { const x = m?.get(k); return x && x.f <= d ? x.v : null; };
const hardRule = (t, d) => { const c = CO.get(t), kq = latestQ(c.acc, d); if (kq == null) return false; const r = c.R.get(kq - 4); return r?.gm != null && r.gm >= 0 && (r.fgm ?? r.f) <= d; };

// ---------- learning ----------
function corr(x, y) { const n = x.length; if (n < 3) return 0; const mx = mean(x), my = mean(y); let a = 0, b = 0, c = 0; for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; a += dx * dy; b += dx * dx; c += dy * dy; } return b && c ? a / Math.sqrt(b * c) : 0; }
function learn(cut) { // connections using only values filed before `cut`
  const before = (m) => new Map([...m].filter(([, x]) => x.f < cut));
  const trail = (t) => { const r = CO.get(t).R, ks = [...r.keys()].filter((k) => r.get(k).f < cut).sort((a, b) => b - a).slice(0, 4); return ks.length === 4 ? ks.reduce((s, k) => s + r.get(k).rev, 0) : 0; };
  const hubs = [...CO.keys()].map((t) => [t, trail(t)]).sort((a, b) => b[1] - a[1]).slice(0, HUBS).map(([t]) => t);
  const drivers = new Map([['root:hyperscaler_capex', before(root)], ...[...OUT].map(([k, m]) => [k, before(m)]), ...hubs.map((t) => ['hub:' + t, before(CO.get(t).g)])]);
  const Z = new Map(); for (const [k, m] of drivers) { const v = [...m.values()].map((x) => x.v); if (v.length < 8) continue; const mu = mean(v), sd = Math.sqrt(mean(v.map((x) => (x - mu) ** 2))) || 1; Z.set(k, { m, mu, sd }); }
  const model = new Map(); let nConn = 0;
  for (const [t, c] of CO) { const tgt = [...c.acc].filter(([, x]) => x.f < cut).sort((a, b) => a[0] - b[0]); if (tgt.length < 16) continue;
    const own = [['own:capex', before(c.cxg)], ['own:inventory', before(c.ivg)], ['own:backlog', before(c.rpg)]];
    const cand = [];
    for (const [name, zz] of [...[...Z].filter(([k]) => k !== 'hub:' + t), ...own.map(([k, m]) => { const v = [...m.values()].map((x) => x.v); if (v.length < 8) return [k, null]; const mu = mean(v); return [k, { m, mu, sd: Math.sqrt(mean(v.map((x) => (x - mu) ** 2))) || 1 }]; })]) {
      if (!zz) continue; for (const L of LAGS) { const xs = [], ys = []; for (const [k, y] of tgt) { const d = zz.m.get(k - L); if (d) { xs.push(d.v); ys.push(y.v); } }
        const n = xs.length; if (n < 12) continue; const cut1 = Math.floor((n * 2) / 3); const c1 = corr(xs.slice(0, cut1), ys.slice(0, cut1)), c2 = corr(xs.slice(cut1), ys.slice(cut1));
        cand.push({ name, L, c1, c2, cf: corr(xs, ys), n, zz }); } }
    const kept = cand.sort((a, b) => Math.abs(b.c1) - Math.abs(a.c1)).slice(0, MAXC).filter((x) => Math.sign(x.c2) === Math.sign(x.c1) && Math.abs(x.c2) >= 0.5 * Math.abs(x.c1))
      .map((x) => ({ name: x.name, L: x.L, w: x.cf * (x.n / (x.n + 12)), mu: x.zz.mu, sd: x.zz.sd }));
    if (kept.length) { model.set(t, kept); nConn += kept.length; } }
  return { model, hubs, nConn }; }
const driverMap = (t, name) => name === 'root:hyperscaler_capex' ? root : name.startsWith('fred:') ? OUT.get(name) : name.startsWith('hub:') ? CO.get(name.slice(4))?.g
  : name === 'own:capex' ? CO.get(t).cxg : name === 'own:inventory' ? CO.get(t).ivg : CO.get(t).rpg;
function forecast(t, conns, d) { const c = CO.get(t), kq = latestQ(c.acc, d); if (kq == null) return null; const kt = kq + 1; let s = 0, used = 0;
  for (const x of conns) { const v = known(driverMap(t, x.name), kt - x.L, d); if (v == null) continue; s += x.w * ((v - x.mu) / x.sd); used++; }
  return used ? { pred: s, kq, kt, persist: c.acc.get(kq).v, actual: c.acc.get(kt)?.v ?? null } : null; }

// ---------- v5 score (for the comparison) from the same panel ----------
function v5score(ts, d) { const F = []; for (const t of ts) { const c = CO.get(t), kq = latestQ(c.acc, d); if (kq == null) continue; const r = c.R.get(kq), r4 = c.R.get(kq - 4); const g = c.g.get(kq), a = c.acc.get(kq);
    if (r?.gm == null || r4?.gm == null || !g || !a || r.rev < 25e6) continue; F.push([t, g.v, a.v, r.gm - r4.gm]); }
  const rk = [1, 2, 3].map((i) => { const s = F.map((x) => x[i]).sort((a, b) => a - b); return (v) => { let lo = 0, hi = s.length; while (lo < hi) { const m = (lo + hi) >> 1; if (s[m] < v) lo = m + 1; else hi = m; } return lo / (s.length - 1 || 1); }; });
  return new Map(F.map((x) => [x[0], (rk[0](x[1]) + rk[1](x[2]) + rk[2](x[3])) / 3])); }

// ---------- walk-forward ----------
const monthEnds = []; for (let y = 2019; y <= 2026; y++) for (let m = 1; m <= 12; m++) { const mo = `${y}-${String(m).padStart(2, '0')}`; if (mo <= '2026-03') monthEnds.push(new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)); }
if (SMOKE) monthEnds.splice(0, monthEnds.length, '2018-06-30', '2018-07-31', '2018-08-31', '2018-09-30');
const spear = (a, b) => { const rk = (x) => { const o = x.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]), r = new Array(x.length); o.forEach(([, i], j) => (r[i] = j)); return r; }; return corr(rk(a), rk(b)); };
const learned = new Map(), months = [];
for (const M of monthEnds) { const Y = M.slice(0, 4); if (!learned.has(Y)) { const L = learn(`${Y}-01-01`); learned.set(Y, L); console.error(`learned ${Y}: ${L.model.size} companies, ${L.nConn} connections`); }
  const { model } = learned.get(Y), elig = [...CO.keys()].filter((t) => eligible(t, M) && hardRule(t, M));
  const fc = new Map(); for (const t of elig) { const conns = model.get(t); if (!conns) continue; const f = forecast(t, conns, M); if (f) fc.set(t, f); }
  const ev = [...fc.values()].filter((f) => f.actual != null), ic = ev.length > 30 ? spear(ev.map((f) => f.pred), ev.map((f) => f.actual)) : null, icP = ev.length > 30 ? spear(ev.map((f) => f.persist), ev.map((f) => f.actual)) : null;
  const v5 = v5score(elig, M), mo = new Map(elig.map((t) => [t, mom(t, M)]).filter(([, v]) => v != null));
  months.push({ M, elig, ranks: { graph: new Map([...fc].map(([t, f]) => [t, f.pred])), momentum: mo, v5 }, ic, icP, nfc: fc.size });
  console.error(`${M} elig ${elig.length} · forecasts ${fc.size} · IC ${ic?.toFixed(3)} (persistence ${icP?.toFixed(3)})`); }

// ---------- portfolios (buy top 20, hold while in top 60) ----------
const ret = (t, a, b) => { const p = P.get(t); if (!p) return null; const i = at(t, a) + 1, j = at(t, b) + 1; return i > 0 && j > i && j < p.c.length ? p.c[j] / p.c[i] - 1 : null; };
const medRet = months.slice(0, -1).map((m, i) => { const nxt = months[i + 1].M, v = m.elig.map((t) => ret(t, m.M, nxt)).filter((x) => x != null).sort((a, b) => a - b); return v[v.length >> 1] ?? 0; });
function run(rankOf, log = false) { let hold = new Set(); const out = [], trades = [];
  for (let i = 0; i < months.length - 1; i++) { const m = months[i], r = rankOf(m, i); const order = [...r].sort((a, b) => b[1] - a[1]).map(([t]) => t), keep = new Set(order.slice(0, KEEP));
    const next = new Set([...hold].filter((t) => keep.has(t))); for (const t of order) { if (next.size >= TOP) break; next.add(t); }
    const bought = [...next].filter((t) => !hold.has(t)), sold = [...hold].filter((t) => !next.has(t));
    if (log) { for (const t of bought) trades.push({ M: m.M, t, side: 'buy' }); for (const t of sold) trades.push({ M: m.M, t, side: 'sell' }); }
    const rs = [...next].map((t) => ret(t, m.M, months[i + 1].M)).filter((x) => x != null), turn = (bought.length + sold.length) / Math.max(1, next.size);
    const pr = rs.length ? mean(rs) - COST * turn : 0; out.push({ M: m.M, r: pr, ex: pr - medRet[i], n: next.size, hold: [...next] }); hold = next; }
  return { out, trades }; }
const G1 = run((m) => m.ranks.graph, true), MO = run((m) => m.ranks.momentum), V5 = run((m) => m.ranks.v5);
let seed = 4242; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const RAND = Array.from({ length: DRAWS }, () => run((m) => new Map(m.elig.map((t) => [t, rnd()])))).map((x) => mean(x.out.map((o) => o.ex))).sort((a, b) => a - b);

// ---------- report ----------
const pc = (x, d = 1) => (x == null ? '—' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}%`), comp = (a) => a.reduce((s, x) => s * (1 + x), 1) - 1;
const ics = (from, to) => { const a = months.filter((m) => m.M >= from && m.M <= to && m.ic != null); return { g: mean(a.map((m) => m.ic)), p: mean(a.map((m) => m.icP)), pos: a.filter((m) => m.ic > 0).length / a.length, n: a.length }; };
const A = ics('2019', '2026-12'), Bc = ics('2019', '2022-12-31'), exm = (R, from = '', to = '9') => mean(R.out.filter((o) => o.M >= from && o.M <= to).map((o) => o.ex));
const p95 = RAND[Math.floor(DRAWS * 0.95)];
const crit = [A.g > A.p && A.pos >= 0.6 && Bc.g > Bc.p && Bc.pos >= 0.6, exm(G1) > exm(MO), exm(G1) > exm(V5), exm(G1) > p95];
const L = [`# Node graph — ${EXTRA ? 'locked + extra world factors' : 'locked world factors'} · test months 2019-01 → 2026-03\n`,
  `Learned connections per year: ${[...learned].map(([y, l]) => `${y} ${l.nConn} (${l.model.size} cos)`).join(' · ')}\n`,
  '## 1. Does it forecast growth? (rank correlation of predicted vs actual next-quarter revenue acceleration)\n',
  '| | graph IC | persistence IC | months graph IC > 0 |', '|---|---|---|---|',
  `| 2019–2026 | **${A.g.toFixed(3)}** | ${A.p.toFixed(3)} | ${(A.pos * 100).toFixed(0)}% of ${A.n} |`, `| 2019–2022 (clean) | **${Bc.g.toFixed(3)}** | ${Bc.p.toFixed(3)} | ${(Bc.pos * 100).toFixed(0)}% of ${Bc.n} |`,
  '\n## 2–4. Buy & hold (top 20, hold while in top 60): average monthly return minus the typical stock\n', '| | 2019–2026 | 2019–2022 (clean) | 2023–2026 |', '|---|---|---|---|'];
for (const [n, R] of [['**Node graph**', G1], ['Momentum', MO], ['v5 bottleneck (A)', V5]]) L.push(`| ${n} | ${pc(exm(R), 2)} | ${pc(exm(R, '', '2022-12-31'), 2)} | ${pc(exm(R, '2023'), 2)} |`);
L.push(`| Random, 95th pct of ${DRAWS} | ${pc(p95, 2)} | | |`);
L.push(`\n**Pass:** forecasts growth ${crit[0] ? 'PASS' : 'FAIL'} · beats momentum ${crit[1] ? 'PASS' : 'FAIL'} · beats v5 ${crit[2] ? 'PASS' : 'FAIL'} · beats random ${crit[3] ? 'PASS' : 'FAIL'} → **${crit.every(Boolean) ? 'PASS' : crit[0] ? 'FAIL' : 'FAIL (connections not real; 2–4 not judged)'}**`);
L.push('\n## Year by year (compounded)\n\n| Year | Node graph | Momentum | v5 | Typical stock | Most-held names |\n|---|---|---|---|---|---|');
for (let y = 2019; y <= 2026; y++) { const f = (R) => R.out.filter((o) => o.M.startsWith(String(y))), cnt = new Map(); for (const o of f(G1)) for (const t of o.hold) cnt.set(t, (cnt.get(t) ?? 0) + 1);
  const med = medRet.filter((_, i) => months[i].M.startsWith(String(y)));
  L.push(`| ${y} | **${pc(comp(f(G1).map((o) => o.r)), 0)}** | ${pc(comp(f(MO).map((o) => o.r)), 0)} | ${pc(comp(f(V5).map((o) => o.r)), 0)} | ${pc(comp(med), 0)} | ${[...cnt].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t).join(', ')} |`); }
const yr = learned.get('2026') ?? [...learned.values()].at(-1), show = ['MU', 'NVDA', 'SNDK', 'WDC', 'VRT', 'LITE', 'AMD', 'CEG'];
L.push('\n## Example learned connections (2026 model)\n'); for (const t of show) { const c = yr.model.get(t); if (c) L.push(`- **${t}** ← ${c.map((x) => `${x.name.replace('hub:', '').replace('fred:', '')} (${x.L}q, ${x.w >= 0 ? '+' : ''}${x.w.toFixed(2)})`).join(', ')}`); }
const txt = L.join('\n'); console.log(txt); if (SMOKE) process.exit(0); fs.mkdirSync(RES, { recursive: true }); fs.writeFileSync(path.join(RES, TAG + '.txt'), txt + '\n');
fs.writeFileSync(path.join(RES, TAG + '.json'), JSON.stringify({ months: months.map((m) => ({ M: m.M, ic: m.ic, icP: m.icP, nfc: m.nfc })), graph: G1.out, trades: G1.trades, momentum: MO.out, v5: V5.out, rand95: p95, crit,
  connections: Object.fromEntries([...learned].map(([y, l]) => [y, Object.fromEntries([...l.model].map(([t, c]) => [t, c.map((x) => [x.name, x.L, +x.w.toFixed(3)])]))])) }));
