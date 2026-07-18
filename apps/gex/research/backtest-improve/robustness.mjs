// Backtest-improve STEP 3: separate LOOK-AHEAD from LIVE-KNOWN, then stress the
// two live candidates (d_flip_bps, big_open) with quantile buckets on both halves.
// A real edge is monotone-ish across buckets in BOTH halves; a knife-edge that only
// shows at one median split is overfit. Clause 0 — hypothesis-gen only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const raw = fs.readFileSync(path.join(HERE, '..', 'uw', 'studies', 'outputs', 'repriced_fires.csv'), 'utf8').trim().split('\n');
const cols = raw[0].split(','); const rows = raw.slice(1).map(l => { const v = l.split(','); const o = {}; cols.forEach((c, i) => o[c] = v[i]); return o; });
const num = x => (x === undefined || x === '') ? null : (Number.isFinite(+x) ? +x : null);
const bool = x => x === 'True';
const pnl = r => { if (bool(r.confirmed)) { const c = num(r.pnl_confirm), e = num(r.entry_confirm); if (c !== null && e) return c / e; } const a = num(r.pnl_atfire), e = num(r.entry_atfire); return (a !== null && e) ? a / e : null; };
const v2 = (r, cap = 45) => { const pk = num(r.mfe_pct), ex = pnl(r); if (ex === null) return null; return (pk !== null && pk >= cap) ? cap : ex; };
const mean = a => { const x = a.filter(v => v !== null); return x.length ? x.reduce((s, v) => s + v, 0) / x.length : null; };
const fmt = v => v === null ? ' n/a' : (v >= 0 ? '+' : '') + v.toFixed(1);
const base = rows.filter(r => bool(r.g7_gate) && num(r.nflags) !== null && num(r.nflags) <= 1);
const days = [...new Set(rows.map(r => r.day))].sort(); const cut = days[Math.floor(days.length * 0.6)];
const tr = r => r.day < cut, te = r => r.day >= cut;

console.log('LOOK-AHEAD (NOT usable live): trend_day, daytype  — both from full-day ret/range (policy_simulator.py:167-171)');
console.log('LIVE-KNOWN: d_flip_bps, d_wall_bps, big_open(after 10am), prem_pct, nflags, flow_*, vixd15, pin, hr\n');

// big_open = live trend proxy (first-30min range >= 90th pct; known by ~10am)
console.log('== big_open (LIVE trend proxy) vs baseline, cap+45 ==');
console.log(`  baseline           train ${fmt(mean(base.filter(tr).map(r=>v2(r))))}%  test ${fmt(mean(base.filter(te).map(r=>v2(r))))}%`);
console.log(`  big_open=True      train ${fmt(mean(base.filter(r=>tr(r)&&bool(r.big_open)).map(r=>v2(r))))}%  test ${fmt(mean(base.filter(r=>te(r)&&bool(r.big_open)).map(r=>v2(r))))}%  (n_te=${base.filter(r=>te(r)&&bool(r.big_open)).length})`);
console.log(`  big_open=False     train ${fmt(mean(base.filter(r=>tr(r)&&!bool(r.big_open)).map(r=>v2(r))))}%  test ${fmt(mean(base.filter(r=>te(r)&&!bool(r.big_open)).map(r=>v2(r))))}%  (n_te=${base.filter(r=>te(r)&&!bool(r.big_open)).length})`);

// quantile buckets for the two continuous live candidates
function buckets(nm, f, nb = 4) {
  console.log(`\n== ${nm} — expectancy by quantile bucket (both halves), cap+45 ==`);
  const vals = base.map(f).filter(v => v !== null).sort((a, b) => a - b);
  const qs = Array.from({ length: nb - 1 }, (_, i) => vals[Math.floor(vals.length * (i + 1) / nb)]);
  const edges = [-Infinity, ...qs, Infinity];
  console.log(`  edges: ${qs.map(q => q.toFixed(1)).join(' | ')}`);
  for (let b = 0; b < nb; b++) {
    const inB = r => { const v = f(r); return v !== null && v > edges[b] && v <= edges[b + 1]; };
    const trB = base.filter(r => tr(r) && inB(r)), teB = base.filter(r => te(r) && inB(r));
    console.log(`  Q${b + 1} (${edges[b] === -Infinity ? 'lo' : edges[b].toFixed(0)}..${edges[b + 1] === Infinity ? 'hi' : edges[b + 1].toFixed(0)})  train ${fmt(mean(trB.map(r => v2(r)))).padStart(6)}% (n${String(trB.length).padStart(3)})   test ${fmt(mean(teB.map(r => v2(r)))).padStart(6)}% (n${String(teB.length).padStart(3)})`);
  }
}
buckets('d_flip_bps (distance to gamma flip)', r => num(r.d_flip_bps));
buckets('d_wall_bps (distance to gamma wall)', r => num(r.d_wall_bps));

// cap sweep by state — is the loosen-cap effect concentrated?
console.log(`\n== cap sweep by state (test half only), %-ret/fire ==`);
for (const st of ['ALL', 'BULL_REVERSE', 'BEAR_RUG']) {
  const s = base.filter(r => te(r) && (st === 'ALL' || r.state === st));
  const line = [20, 45, 80, 120, 1e9].map(cap => `${cap === 1e9 ? '∞' : cap}:${fmt(mean(s.map(r => v2(r, cap))))}`).join('  ');
  console.log(`  ${st.padEnd(13)} (n=${s.length})  ${line}`);
}
