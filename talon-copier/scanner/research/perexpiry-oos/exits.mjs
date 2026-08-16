#!/usr/bin/env node
// Selection features are noise (see stats3). Memory says the edge is MANAGEMENT/asymmetry.
// Test global exit policies on the SAME 72 plans — a rule applied to everything, so it can't
// be curve-fit to a name. Which exit maximizes EXPECTANCY (mean R), not hit-rate?
//   P1 bank-at-T1 (100% first target)   P2 all-runner (100% ladder)   P3 2-scale (½/½)
//   × stop basis: close vs intraday.  Stop caps loss at -1R throughout.
import { loadEnvKeysFrom, resolveFromRoot, readJson, log } from '../../lib/util.mjs';
loadEnvKeysFrom(resolveFromRoot('../../.env'), ['UNUSUAL_WHALES_API_KEY']);
const { FlowProvider } = await import('../../providers/flow-uw.mjs');
const flow = new FlowProvider();
const WEEKS = [
  { week: '2026-07-13', from: '2026-07-13', to: '2026-07-17' },
  { week: '2026-07-20', from: '2026-07-20', to: '2026-07-24' },
  { week: '2026-07-27', from: '2026-07-27', to: '2026-07-31' },
  { week: '2026-08-03', from: '2026-08-03', to: '2026-08-07' },
];
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const fmt = (x) => (x >= 0 ? '+' : '') + x.toFixed(2);

// parameterized resolver: rungs = [{px, w}], stopBasis 'close'|'intra'. Loss capped -1R.
function resolve(plan, ohlc, { from, to, rungs, stopBasis }) {
  const long = plan.direction === 'long';
  const { entry_trigger: trig, invalidation: inval } = plan;
  const win = (ohlc || []).filter((d) => (!from || d.date >= from) && (!to || d.date <= to) && d.close != null).sort((a, b) => a.date < b.date ? -1 : 1);
  if (!win.length) return null;
  let ei = -1, entry = null;
  for (let i = 0; i < win.length; i++) { const b = win[i]; if (long ? b.high >= trig : b.low <= trig) { ei = i; entry = long ? Math.max(trig, b.open) : Math.min(trig, b.open); break; } }
  if (ei < 0) return null; // no fill
  const risk = Math.abs(entry - inval); if (!risk || (long ? inval >= entry : inval <= entry)) return null;
  const signed = (px) => (long ? px - entry : entry - px) / risk;
  let rr = rungs.map((r) => ({ px: r.px, w: r.w })).filter((r) => r.px != null && (long ? r.px > entry : r.px < entry));
  const wsum = rr.reduce((s, r) => s + r.w, 0) || 1; rr = rr.map((r) => ({ ...r, w: r.w / wsum })).sort((a, b) => long ? a.px - b.px : b.px - a.px);
  if (!rr.length) { const last = win[win.length - 1]; return signed(last.close); } // gapped past all rungs
  let realized = 0, remaining = 1; const pend = [...rr];
  for (let i = ei; i < win.length; i++) {
    const b = win[i];
    while (pend.length && (long ? b.high >= pend[0].px : b.low <= pend[0].px)) { const rg = pend.shift(); realized += rg.w * signed(rg.px); remaining -= rg.w; }
    if (remaining <= 1e-9) break;
    const stopHit = stopBasis === 'close' ? (long ? b.close < inval : b.close > inval) : (long ? b.low <= inval : b.high >= inval);
    if (stopHit) { realized += remaining * -1; remaining = 0; break; }
  }
  if (remaining > 1e-9) realized += remaining * signed(win[win.length - 1].close);
  return realized;
}

const plans = [];
for (const w of WEEKS) {
  const sv = readJson(resolveFromRoot(`data/plans/${w.week}_sysval.json`));
  for (const r of (sv?.rows || [])) if ((r.dir === 'long' || r.dir === 'short') && r.entry != null && r.inval != null && r.tgt != null) plans.push({ w, plan: { direction: r.dir, entry_trigger: r.entry, invalidation: r.inval, target: r.tgt, runner_target: r.run } });
}
const ohlcCache = {};
for (const { plan } of plans) { const t = plan.__t; }
// pull OHLC per unique ticker
const byT = {};
for (const w of WEEKS) { const sv = readJson(resolveFromRoot(`data/plans/${w.week}_sysval.json`)); for (const r of (sv?.rows || [])) if (r.entry != null) byT[r.t] = 1; }
for (const t of Object.keys(byT)) ohlcCache[t] = await flow.getDailyOHLC(t, { limit: 90 }).catch(() => []);

// rebuild plans WITH ticker + ohlc
const P = [];
for (const w of WEEKS) { const sv = readJson(resolveFromRoot(`data/plans/${w.week}_sysval.json`)); for (const r of (sv?.rows || [])) if ((r.dir === 'long' || r.dir === 'short') && r.entry != null && r.inval != null && r.tgt != null) P.push({ week: w.week, from: w.from, to: w.to, t: r.t, plan: { direction: r.dir, entry_trigger: r.entry, invalidation: r.inval, target: r.tgt, runner_target: r.run } }); }

const policies = {
  'P1 bank-T1  (close)': { rungs: (p) => [{ px: p.target, w: 1 }], basis: 'close' },
  'P2 all-run  (close)': { rungs: (p) => [{ px: p.runner_target ?? p.target, w: 1 }], basis: 'close' },
  'P3 2-scale  (close)': { rungs: (p) => [{ px: p.target, w: 0.5 }, { px: p.runner_target ?? p.target, w: 0.5 }], basis: 'close' },
  'P3 2-scale  (intra)': { rungs: (p) => [{ px: p.target, w: 0.5 }, { px: p.runner_target ?? p.target, w: 0.5 }], basis: 'intra' },
  'P1 bank-T1  (intra)': { rungs: (p) => [{ px: p.target, w: 1 }], basis: 'intra' },
};
log(`\n════ EXIT-POLICY TEST — ${P.length} plans, 4 weeks ════`);
log('policy                    meanR    totR    per-week means [07/13 07/20 07/27 08/03]\n');
const results = {};
for (const [name, cfg] of Object.entries(policies)) {
  const rs = P.map((x) => ({ week: x.week, R: resolve(x.plan, ohlcCache[x.t], { from: x.from, to: x.to, rungs: cfg.rungs(x.plan), stopBasis: cfg.basis }) })).filter((x) => x.R != null);
  results[name] = rs;
  const pw = WEEKS.map((w) => { const s = rs.filter((r) => r.week === w.week).map((r) => r.R); return s.length ? fmt(mean(s)) : ' — '; }).join('  ');
  log(`${name.padEnd(24)} ${fmt(mean(rs.map((r) => r.R))).padStart(6)}  ${fmt(rs.reduce((s, r) => s + r.R, 0)).padStart(7)}   [${pw}]`);
}

// permutation: does P2/P3 (let-run) beat P1 (bank) in mean R? paired by plan.
function pairedPerm(a, b, nPerm = 20000) {
  const A = results[a], B = results[b];
  const diffs = A.map((x, i) => x.R - B[i].R); // same plan order
  const obs = mean(diffs);
  let seed = 987654; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let ge = 0;
  for (let p = 0; p < nPerm; p++) { let s = 0; for (const d of diffs) s += (rnd() < 0.5 ? -d : d); if (s / diffs.length >= Math.abs(obs)) ge++; }
  return { obs, p: ge / nPerm };
}
log('\n── paired permutation (same plans, flip signs) ──');
for (const [a, b] of [['P3 2-scale  (close)', 'P1 bank-T1  (close)'], ['P2 all-run  (close)', 'P1 bank-T1  (close)'], ['P3 2-scale  (close)', 'P3 2-scale  (intra)']]) {
  const t = pairedPerm(a, b);
  log(`${a}  vs  ${b}:  Δmean ${fmt(t.obs)}  p=${t.p.toFixed(3)}${t.p <= 0.05 ? ' ***' : t.p <= 0.1 ? ' *' : ''}`);
}
