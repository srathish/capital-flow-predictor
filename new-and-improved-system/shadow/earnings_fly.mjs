#!/usr/bin/env node
// DESIGN_earnings_fly.md analysis: short ATM iron fly into earnings (entry E close, exit X close, real NBBO), "rich" = implied > mean |past 8 reactions|.
import fs from 'node:fs';
import { loadBars } from './earnings_fly_collect.mjs';
const C = new URL('../.cache/', import.meta.url), OUT = new URL('./results_earnings_fly/', import.meta.url); fs.mkdirSync(OUT, { recursive: true });
const EV = JSON.parse(fs.readFileSync(new URL('lottery_earnings.json', C), 'utf8')), COMM = 0.052, HOLD = '2025-04-01';
const rows = [], skip = {};
for (const f of fs.readdirSync(new URL('earnfly/', C)).filter((x) => x.endsWith('.jsonl'))) {
  const T = f.replace('.jsonl', ''), bars = loadBars(T); if (!bars) continue; const di = new Map(bars.map((b, i) => [b.d, i]));
  // past reactions per report date (close-to-close across the report), known before later events
  const react = (EV[T] ?? []).map((e) => { let i = di.get(e.d); if (i == null) { const k = bars.findIndex((b) => b.d > e.d); i = k < 0 ? null : k; } if (i == null) return null; if (e.when !== 'postmarket') i -= 1; if (i < 0 || i + 1 >= bars.length) return null; return { rd: e.d, E: bars[i].d, mv: Math.abs(bars[i + 1].c / bars[i].c - 1) }; }).filter(Boolean);
  for (const l of fs.readFileSync(new URL(`earnfly/${f}`, C), 'utf8').split('\n').filter(Boolean)) {
    const o = JSON.parse(l); if (o.skip) { skip[o.skip] = (skip[o.skip] ?? 0) + 1; continue; }
    const q = (rows0, d) => rows0?.find((r) => r.date === d);
    const legs = [[o.bc, o.body, 'C', -1], [o.bp, o.body, 'P', -1], [o.lc, o.wc, 'C', 1], [o.lp, o.wp, 'P', 1]];
    const e0 = legs.map(([r]) => q(r, o.E)); if (e0.some((x) => !x || !(x.bid >= 0) || !(x.ask > 0))) { skip.entryquote = (skip.entryquote ?? 0) + 1; continue; }
    const credit = e0[0].bid + e0[1].bid - e0[2].ask - e0[3].ask; if (!(credit > 0)) { skip.credit = (skip.credit ?? 0) + 1; continue; }
    const intr = (K, cp) => Math.max(0, cp === 'C' ? o.Sx - K : K - o.Sx);
    const exitPx = legs.map(([r, K, cp, sg]) => { const x = q(r, o.X); if (o.exp === o.X || !x || !(x.ask > 0)) return intr(K, cp); return sg < 0 ? x.ask : x.bid; });
    const cost = exitPx[0] + exitPx[1] - exitPx[2] - exitPx[3], risk = Math.max(o.wc - o.body, o.body - o.wp) - credit; if (!(risk > 0)) { skip.risk = (skip.risk ?? 0) + 1; continue; }
    const past = react.filter((x) => x.E < o.E).slice(-8), hist = past.length >= 4 ? past.reduce((s, x) => s + x.mv, 0) / past.length : NaN;
    rows.push({ T, E: o.E, imp: o.imp, hist, ratio: o.imp / hist, rich: Number.isFinite(hist) ? o.imp > hist : null, mv: Math.abs(o.Sx / o.S - 1), r: (credit - cost - COMM) / (risk + COMM), ho: o.E >= HOLD });
  }
}
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length, sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const dm = (a) => { const g = new Map(); for (const x of a) { const q = g.get(x.E) ?? []; q.push(x.r); g.set(x.E, q); } return [...g.values()].map(mean); };
const st = (a) => { const v = dm(a); return { n: a.length, days: v.length, m: v.length ? mean(v) : NaN, mt: a.length ? mean(a.map((x) => x.r)) : NaN, t: v.length > 2 ? (mean(v) / sd(v)) * Math.sqrt(v.length) : NaN, v, win: a.filter((x) => x.r > 0).length / (a.length || 1), worst: a.length ? Math.min(...a.map((x) => x.r)) : NaN }; };
const erf = (x) => { const s = Math.sign(x); x = Math.abs(x); const a = 1 / (1 + 0.3275911 * x); return s * (1 - (((((1.061405429 * a - 1.453152027) * a) + 1.421413741) * a - 0.284496736) * a + 0.254829592) * a * Math.exp(-x * x)); }, pOne = (t) => 0.5 * (1 - erf(t / Math.SQRT2));
const acct = (a) => { let eq = 1, pk = 1, mdd = 0; const byE = new Map(); for (const x of a) { const q = byE.get(x.E) ?? []; q.push(x.r); byE.set(x.E, q); } for (const [, q] of [...byE.entries()].sort()) { eq *= 1 + 0.01 * q.reduce((s, x) => s + x, 0); pk = Math.max(pk, eq); mdd = Math.min(mdd, eq / pk - 1); } return { eq, mdd }; };
const L = ['# Earnings iron fly — results', '', `Run ${new Date().toISOString()} · design shadow/DESIGN_earnings_fly.md · events priced ${rows.length} · skipped ${JSON.stringify(skip)}`, '', '| set | period | events (dates) | mean per event (date-clustered) | t | win | worst | 1%-risk account ×, max DD |', '|---|---|---|---|---|---|---|---|'];
const sets = [['all', () => true], ['rich (implied > past avg move)', (x) => x.rich === true], ['not rich', (x) => x.rich === false]];
const S = {};
for (const [lab, f] of sets) for (const [pl, ho] of [['build', false], ['holdout', true]]) { const a = rows.filter((x) => x.ho === ho && f(x)), s = st(a), ac = acct(a); S[lab + pl] = s; L.push(`| ${lab} | ${pl} | ${s.n} (${s.days}) | ${(s.m * 100).toFixed(1)}% (per trade ${(s.mt * 100).toFixed(1)}%) | ${s.t.toFixed(2)} | ${(s.win * 100).toFixed(0)}% | ${(s.worst * 100).toFixed(0)}% | ${ac.eq.toFixed(2)}, ${(ac.mdd * 100).toFixed(1)}% |`); }
for (const pl of ['build', 'holdout']) { const a = rows.filter((x) => x.ho === (pl === 'holdout') && Number.isFinite(x.ratio)).sort((p, q) => p.ratio - q.ratio), n = a.length; L.push(`\n${pl} terciles of implied ÷ historical move: ${[a.slice(0, n / 3), a.slice(n / 3, 2 * n / 3), a.slice(2 * n / 3)].map((s) => `ratio ≤${s.at(-1)?.ratio.toFixed(2)}: ${(mean(s.map((x) => x.r)) * 100).toFixed(1)}% (n ${s.length})`).join(' | ')}`); }
const h = (k) => S[k + 'holdout'], wt = (mean(h('rich (implied > past avg move)').v) - mean(h('not rich').v)) / Math.sqrt(sd(h('rich (implied > past avg move)').v) ** 2 / h('rich (implied > past avg move)').v.length + sd(h('not rich').v) ** 2 / h('not rich').v.length);
const tests = [{ id: 'S1 all', m: h('all').m, t: h('all').t, bm: S.allbuild.m }, { id: 'S2 rich', m: h('rich (implied > past avg move)').m, t: h('rich (implied > past avg move)').t, bm: S['rich (implied > past avg move)build'].m }, { id: 'S3 rich − not rich', m: mean(h('rich (implied > past avg move)').v) - mean(h('not rich').v), t: wt, bm: mean(S['rich (implied > past avg move)build'].v) - mean(S['not richbuild'].v) }];
const ps = tests.map((x) => pOne(x.t)).sort((a, b) => a - b); let kk = 0; ps.forEach((p, i) => { if (p <= ((i + 1) / ps.length) * 0.1) kk = i + 1; }); const cut = kk ? ps[kk - 1] : -1;
L.push('', '**Tests (holdout; BH q = 0.10; build must agree in sign):** ' + tests.map((x) => `${x.id}: ${(x.m * 100).toFixed(1)}% t ${x.t.toFixed(2)} (build ${(x.bm * 100).toFixed(1)}%)${x.m > 0 && x.bm > 0 && pOne(x.t) <= cut ? ' **PASS**' : ''}`).join(' · '));
const top = rows.filter((x) => x.ho).sort((a, b) => a.r - b.r), loss = top.filter((x) => x.r < 0), worst10 = loss.slice(0, Math.ceil(loss.length / 10));
L.push(`Fat tail (holdout): worst 10% of losing trades = ${(worst10.reduce((s, x) => s + x.r, 0) / loss.reduce((s, x) => s + x.r, 0) * 100).toFixed(0)}% of all losses.`);
fs.writeFileSync(new URL('summary.md', OUT), L.join('\n') + '\n'); fs.writeFileSync(new URL('rows.json', OUT), JSON.stringify(rows)); console.log(L.join('\n'));
