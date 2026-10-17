#!/usr/bin/env node
// DESIGN_iv_walls.md — fade the day's implied (straddle) / historical-vol band, vs random twin levels; Skylit-node confluence exploratory.
import fs from 'node:fs';
const C = new URL('../.cache/', import.meta.url), OUT = new URL('./results_iv_walls/', import.meta.url); fs.mkdirSync(OUT, { recursive: true });
const etMin = (t) => { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(t * 1000)); return +p.find((x) => x.type === 'hour').value * 60 + +p.find((x) => x.type === 'minute').value; };
let seed = 20261017; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const SPLIT = { HV: '2025-04-01', IV: '2026-01-01' };
function fade(bars, wall, side, sig, O) {
  // side +1 = upper wall (short fade), -1 = lower wall (long fade); bars = [m,o,h,l,c] from 09:45
  const touch = bars.find((b) => b[0] >= 585 && b[0] <= 930 && (side > 0 ? b[2] >= wall : b[3] <= wall)); if (!touch) return null;
  const risk = 0.25 * sig * O, stop = wall + side * risk, tgt = wall - side * 0.5 * sig * O;
  for (const b of bars) { if (b[0] < touch[0]) continue;
    if (side > 0 ? b[2] >= stop : b[3] <= stop) { if (b[0] === touch[0] && (side > 0 ? b[1] >= stop : b[1] <= stop)) return { m: touch[0], R: -1 }; return { m: touch[0], R: -1 }; }
    if (b[0] > touch[0] && (side > 0 ? b[3] <= tgt : b[2] >= tgt)) return { m: touch[0], R: 2 };
    if (b[0] >= 955) return { m: touch[0], R: (side > 0 ? wall - b[4] : b[4] - wall) / risk }; }
  const l = bars.at(-1); return { m: touch[0], R: (side > 0 ? wall - l[4] : l[4] - wall) / risk };
}
const rows = [], contain = [];
for (const T of ['SPY', 'QQQ']) {
  const files = fs.readdirSync(new URL(`uw/m1/${T}/`, C)).filter((f) => f.endsWith('.json')).sort(), closes = [];
  for (const f of files) {
    const d = f.slice(0, 10), raw = JSON.parse(fs.readFileSync(new URL(`uw/m1/${T}/${f}`, C), 'utf8')).filter((b) => b.m === 'r');
    const bars = raw.map((b) => [etMin(b.t), b.o, b.h, b.l, b.c]).filter((b) => b[0] >= 570 && b[0] < 960).sort((a, b) => a[0] - b[0]);
    if (bars.length < 300 || bars[0][0] !== 570) { if (bars.length) closes.push(bars.at(-1)[4]); continue; }
    const O = bars[0][1], C1 = bars.at(-1)[4], hi = Math.max(...bars.map((b) => b[2])), lo = Math.min(...bars.map((b) => b[3]));
    const sig = {};
    if (closes.length >= 21) { const r = []; for (let i = closes.length - 20; i < closes.length; i++) r.push(Math.log(closes[i] / closes[i - 1])); const m = r.reduce((a, b) => a + b, 0) / r.length; sig.HV = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1)); }
    const sf = new URL(`straddle/${T}/${d}.json`, C);
    if (fs.existsSync(sf)) { const S = JSON.parse(fs.readFileSync(sf, 'utf8')), pick = (a) => (a ?? []).find((q) => q.m >= 575 && q.m <= 577), c = pick(S.t2?.call), p = pick(S.t2?.put); if (c && p && S.t2?.px935) sig.IV = (c.c + p.c) / (0.798 * S.t2.px935); }
    closes.push(C1);
    for (const [W, s] of Object.entries(sig)) { if (!(s > 0)) continue;
      for (const k of [1.645, 1.0]) {
        contain.push({ T, d, W, k, inHL: hi <= O * (1 + k * s) && lo >= O * (1 - k * s), inC: Math.abs(C1 / O - 1) <= k * s });
        for (const side of [1, -1]) { const wall = O * (1 + side * k * s), f0 = fade(bars, wall, side, s, O); if (!f0) continue;
          const tw = []; for (let n = 0; n < 20; n++) { let kk; do { kk = 0.8 + rnd() * 1.6; } while (Math.abs(kk - k) < 0.2); const g = fade(bars, O * (1 + side * kk * s), side, s, O); if (g) tw.push(g.R); }
          rows.push({ T, d, W, k, side, wall, m: f0.m, R: f0.R, twin: tw.length ? tw.reduce((a, b) => a + b, 0) / tw.length : null, ho: d >= SPLIT[W] }); } } }
  }
}
const byDay = (a, f) => { const g = new Map(); for (const x of a) { const v = f(x); if (v == null) continue; const q = g.get(x.d) ?? []; q.push(v); g.set(x.d, q); } return [...g.values()].map((q) => q.reduce((s, v) => s + v, 0) / q.length); };
const tstat = (v) => { const n = v.length, m = v.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)); return { n, m, t: (m / sd) * Math.sqrt(n) }; };
const pOne = (t) => 0.5 * (1 - erf(t / Math.SQRT2)); function erf(x) { const s = Math.sign(x); x = Math.abs(x); const a = 1 / (1 + 0.3275911 * x); return s * (1 - (((((1.061405429 * a - 1.453152027) * a) + 1.421413741) * a - 0.284496736) * a + 0.254829592) * a * Math.exp(-x * x)); }
const L = ['# IV walls — results', '', `Run ${new Date().toISOString()} · design shadow/DESIGN_iv_walls.md`, '', '## Containment (all days with the wall defined)', '', '| wall | k | days | high+low inside | close inside |', '|---|---|---|---|---|'];
for (const W of ['IV', 'HV']) for (const k of [1.645, 1.0]) { const c = contain.filter((x) => x.W === W && x.k === k); L.push(`| ${W} | ${k} | ${c.length} | ${(c.filter((x) => x.inHL).length / c.length * 100).toFixed(0)}% | ${(c.filter((x) => x.inC).length / c.length * 100).toFixed(0)}% |`); }
const TESTS = [['W1', 'IV', 1.645, 'R'], ['W2', 'IV', 1.645, 'diff'], ['W3', 'HV', 1.645, 'R'], ['W4', 'HV', 1.645, 'diff'], ['W5', 'IV', 1.0, 'R'], ['W6', 'IV', 1.0, 'diff']];
const res = TESTS.map(([id, W, k, kind]) => { const f = kind === 'R' ? (x) => x.R : (x) => (x.twin == null ? null : x.R - x.twin);
  const b = rows.filter((x) => x.W === W && x.k === k && !x.ho), h = rows.filter((x) => x.W === W && x.k === k && x.ho), sb = tstat(byDay(b, f)), sh = tstat(byDay(h, f));
  const win = h.filter((x) => x.R > 0).length / h.length; return { id, W, k, kind, sb, sh, nb: b.length, nh: h.length, win, p: pOne(sh.t) }; });
const ps = res.map((r) => r.p).sort((a, b) => a - b); let kk = 0; ps.forEach((p, i) => { if (p <= ((i + 1) / ps.length) * 0.1) kk = i + 1; }); const cut = kk ? ps[kk - 1] : -1;
L.push('', `## Fade tests (R; +2R target, −1R stop; holdout day-clustered t; BH q = 0.10 across 6) — validated: ${res.filter((r) => r.sh.m > 0 && r.p <= cut).map((r) => r.id).join(', ') || 'none'}`, '', '| id | wall | k | measure | build mean (t, touches) | holdout mean (t, touches) | holdout win |', '|---|---|---|---|---|---|---|');
for (const r of res) L.push(`| ${r.id} | ${r.W} | ${r.k} | ${r.kind === 'R' ? 'fade R' : 'fade − twins'} | ${r.sb.m.toFixed(3)} (${r.sb.t.toFixed(2)}, ${r.nb}) | **${r.sh.m.toFixed(3)}** (${r.sh.t.toFixed(2)}, ${r.nh}) | ${(r.win * 100).toFixed(0)}% |`);
// exploratory: Skylit node confluence (Dec 2025 – Mar 2026)
const SK = JSON.parse(fs.readFileSync(new URL('./replay/skylit_all.json', import.meta.url), 'utf8')), ses = new Map(SK.sessions.map((s) => [s.T + s.d, s]));
const conf = rows.filter((x) => ses.has(x.T + x.d)).map((x) => { const s = ses.get(x.T + x.d), fr = s.maps.filter((q) => q[0] <= x.m).at(-1); const hit = fr ? fr[2].some((n) => Math.abs(n[1]) >= 0.3 && Math.abs(n[0] - x.wall) <= x.wall * 0.001) : false; return { ...x, conf: hit }; });
L.push('', '## Exploratory: Skylit node at the wall (Dec 2025 – Mar 2026)', '', '| wall | k | with node: n, mean R | without: n, mean R |', '|---|---|---|---|');
for (const W of ['IV', 'HV']) for (const k of [1.645, 1.0]) { const c = conf.filter((x) => x.W === W && x.k === k), a = c.filter((x) => x.conf), b = c.filter((x) => !x.conf), mm = (q) => q.length ? (q.reduce((s, x) => s + x.R, 0) / q.length).toFixed(2) : '—'; L.push(`| ${W} | ${k} | ${a.length}, ${mm(a)} | ${b.length}, ${mm(b)} |`); }
fs.writeFileSync(new URL('summary.md', OUT), L.join('\n') + '\n'); fs.writeFileSync(new URL('rows.json', OUT), JSON.stringify(conf.length ? rows : rows)); console.log(L.join('\n'));
