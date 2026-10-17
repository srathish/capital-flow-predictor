#!/usr/bin/env node
// DESIGN_wall_condor.md — sell the 0DTE iron condor at the IV walls (09:35), hold to the close; filters IV>HV and dealer gamma (prior-close ±1% balance).
import fs from 'node:fs';
import { UW_API_KEY } from '../feeds/env.js';
const C = new URL('../.cache/', import.meta.url), OC = new URL('uwopt_intraday/', C), OUT = new URL('./results_wall_condor/', import.meta.url); fs.mkdirSync(OUT, { recursive: true });
const BUILD_END = '2025-12-31', HOLD_START = '2026-01-02', START = '2025-04-01', SLIP = 0.03, COMM = 0.026;
const etMin = (t) => { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(t)); return +p.find((x) => x.type === 'hour').value * 60 + +p.find((x) => x.type === 'minute').value; };
async function leg(T, d, K, cp) {
  const id = `${T}${d.slice(2, 4)}${d.slice(5, 7)}${d.slice(8, 10)}${cp}${String(Math.round(K * 1000)).padStart(8, '0')}`, f = new URL(`${id}_${d}.json`, OC);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  let r = null; for (let a = 0; a < 3 && !r?.ok; a++) { await new Promise((x) => setTimeout(x, 130)); r = await fetch(`https://api.unusualwhales.com/api/option-contract/${id}/intraday?date=${d}`, { headers: { Authorization: `Bearer ${UW_API_KEY}` } }).catch(() => null); if (!r?.ok) await new Promise((x) => setTimeout(x, 1500)); }
  if (!r?.ok) return null;
  const rows = ((await r.json()).data ?? []).map((q) => ({ m: etMin(q.start_time), c: +q.close, h: +q.high, l: +q.low })).filter((q) => q.c > 0).sort((a, b) => a.m - b.m);
  fs.writeFileSync(f, JSON.stringify(rows)); return rows;
}
function bal1(s, S, p) { let A = 0, N = 0; for (const r of s) { const g = r[1] + r[2]; if (Math.abs(r[0] / S - 1) <= p) { A += Math.abs(g); N += g; } } return A > 0 ? N / A : NaN; }
const rows = [], miss = { straddle: 0, legs: 0, noPrint: 0, credit: 0 };
for (const T of ['SPY', 'QQQ']) {
  const gb = JSON.parse(fs.readFileSync(new URL(`uwgreeks/${T}_ohlc.json`, C), 'utf8')), gi = new Map(gb.map((b, i) => [b.d, i]));
  const GR = new Map(fs.readFileSync(new URL(`uwgreeks/${T}.jsonl`, C), 'utf8').split('\n').filter(Boolean).map((l) => { const j = JSON.parse(l); return [j.d, j.s]; }));
  const files = fs.readdirSync(new URL(`uw/m1/${T}/`, C)).filter((f) => f.endsWith('.json')).sort(), closes = [];
  for (const f of files) {
    const d = f.slice(0, 10), bars = JSON.parse(fs.readFileSync(new URL(`uw/m1/${T}/${f}`, C), 'utf8')).filter((b) => b.m === 'r').map((b) => [etMin(b.t * 1000), b.c]).filter((b) => b[0] >= 570 && b[0] < 960).sort((a, b) => a[0] - b[0]);
    if (bars.length < 300) continue; const close = bars.at(-1)[1];
    let hv = NaN; if (closes.length >= 21) { const r = []; for (let i = closes.length - 20; i < closes.length; i++) r.push(Math.log(closes[i] / closes[i - 1])); const m = r.reduce((a, b) => a + b, 0) / r.length; hv = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1)); }
    closes.push(close); if (d < START || d > '2026-10-02') continue;
    const sf = new URL(`straddle/${T}/${d}.json`, C); if (!fs.existsSync(sf)) { miss.straddle++; continue; }
    const S0 = JSON.parse(fs.readFileSync(sf, 'utf8')), pick = (a) => (a ?? []).find((q) => q.m >= 575 && q.m <= 577), c = pick(S0.t2?.call), p = pick(S0.t2?.put); if (!c || !p || !S0.t2?.px935) { miss.straddle++; continue; }
    const S = S0.t2.px935, sig = (c.c + p.c) / (0.798 * S);
    const ip = gi.get(d), A01 = ip > 0 ? (() => { const s = GR.get(gb[ip - 1].d); return s ? bal1(s, gb[ip - 1].c, 0.01) : NaN; })() : NaN;
    for (const k of [1.645, 1.0]) {
      const w = Math.max(1, Math.round(0.5 * sig * S)), sc = Math.ceil(S * (1 + k * sig)), sp = Math.floor(S * (1 - k * sig)), lc = sc + w, lp = sp - w;
      const L = [[sc, 'C', -1], [sp, 'P', -1], [lc, 'C', 1], [lp, 'P', 1]]; const data = [];
      for (const [K, cp] of L) data.push(await leg(T, d, K, cp));
      if (data.some((x) => !x || !x.length)) { miss.legs++; continue; }
      let px = null; for (let m = 575; m <= 579 && !px; m++) { const q = data.map((x) => x.find((r) => r.m === m)); if (q.every(Boolean)) px = q.map((r) => r.c); }
      if (!px) { miss.noPrint++; continue; }
      const credit = px[0] + px[1] - px[2] - px[3] - 4 * SLIP - COMM; if (!(credit > 0) || credit >= w) { miss.credit++; continue; }
      const payout = Math.min(w, Math.max(0, close - sc)) + Math.min(w, Math.max(0, sp - close));
      rows.push({ T, d, k, S, sig, hv, A01, w, credit, payout, r: (credit - payout) / (w - credit), ho: d >= HOLD_START, build: d <= BUILD_END });
    }
  }
  console.log(T, 'rows so far', rows.length, JSON.stringify(miss));
}
// gamma threshold: build-period top third per ticker (on the k=1.645 rows, one per day)
const th = {}; for (const T of ['SPY', 'QQQ']) { const a = rows.filter((x) => x.T === T && x.build && x.k === 1.645).map((x) => x.A01).filter(Number.isFinite).sort((a, b) => a - b); th[T] = a[Math.floor((2 / 3) * (a.length - 1))]; }
const FIL = { none: () => true, ivhv: (x) => x.sig > x.hv, gamma: (x) => x.A01 >= th[x.T], both: (x) => x.sig > x.hv && x.A01 >= th[x.T] };
const byDay = (a) => { const g = new Map(); for (const x of a) { const q = g.get(x.d) ?? []; q.push(x.r); g.set(x.d, q); } return [...g.values()].map((q) => q.reduce((s, v) => s + v, 0) / q.length); };
const ts = (v) => { const n = v.length, m = v.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)); return { n, m, t: (m / sd) * Math.sqrt(n) }; };
const erf = (x) => { const s = Math.sign(x); x = Math.abs(x); const a = 1 / (1 + 0.3275911 * x); return s * (1 - (((((1.061405429 * a - 1.453152027) * a) + 1.421413741) * a - 0.284496736) * a + 0.254829592) * a * Math.exp(-x * x)); }, pOne = (t) => 0.5 * (1 - erf(t / Math.SQRT2));
const dd = (tr) => { let eq = 1, pk = 1, mdd = 0; for (const x of [...tr].sort((a, b) => a.d.localeCompare(b.d))) { eq *= 1 + 0.02 * x.r; pk = Math.max(pk, eq); mdd = Math.min(mdd, eq / pk - 1); } return { eq, mdd }; };
const V = []; let id = 1; for (const k of [1.645, 1.0]) for (const fk of ['none', 'ivhv', 'gamma', 'both']) V.push({ id: 'C' + id++, k, fk });
const res = V.map((v) => { const b = rows.filter((x) => x.k === v.k && x.build && FIL[v.fk](x)), h = rows.filter((x) => x.k === v.k && x.ho && FIL[v.fk](x)), sb = ts(byDay(b)), sh = ts(byDay(h));
  return { ...v, nb: b.length, nh: h.length, sb, sh, p: pOne(sh.t), win: h.filter((x) => x.r > 0).length / h.length, worst: Math.min(...h.map((x) => x.r)), avgCr: h.reduce((s, x) => s + x.credit / x.w, 0) / h.length, ddh: dd(h) }; });
const ps = res.map((r) => r.p).sort((a, b) => a - b); let kk = 0; ps.forEach((p, i) => { if (p <= ((i + 1) / ps.length) * 0.1) kk = i + 1; }); const cut = kk ? ps[kk - 1] : -1;
const Lines = ['# Wall condor — results', '', `Run ${new Date().toISOString()} · design shadow/DESIGN_wall_condor.md · skipped: ${JSON.stringify(miss)} · gamma thresholds ${JSON.stringify(th)}`, '',
  `**Validated (holdout mean > 0, BH q = 0.10 across 8, build mean > 0): ${res.filter((r) => r.sh.m > 0 && r.sb.m > 0 && r.p <= cut).map((r) => r.id).join(', ') || 'none'}**`, '',
  '| id | short strikes | filter | build: n, mean (t) | holdout: n, mean (t) | holdout win | worst | avg credit / width | holdout account ×, max DD (2% risk/trade) |', '|---|---|---|---|---|---|---|---|---|'];
for (const r of res) Lines.push(`| ${r.id} | ${r.k}σ | ${r.fk} | ${r.nb}, ${(r.sb.m * 100).toFixed(1)}% (${r.sb.t.toFixed(2)}) | ${r.nh}, **${(r.sh.m * 100).toFixed(1)}%** (${r.sh.t.toFixed(2)}) | ${(r.win * 100).toFixed(0)}% | ${(r.worst * 100).toFixed(0)}% | ${(r.avgCr * 100).toFixed(0)}% | ${r.ddh.eq.toFixed(3)}, ${(r.ddh.mdd * 100).toFixed(1)}% |`);
fs.writeFileSync(new URL('summary.md', OUT), Lines.join('\n') + '\n'); fs.writeFileSync(new URL('rows.json', OUT), JSON.stringify(rows)); console.log(Lines.join('\n'));
