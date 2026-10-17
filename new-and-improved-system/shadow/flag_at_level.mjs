#!/usr/bin/env node
// DESIGN_flag_at_level.md — UW daily GEX/VEX map levels + EMA8/21/34 stack + tight 30-min flag at the level + volume breakout (5-min bars).
import fs from 'node:fs';
const C = new URL('../.cache/', import.meta.url), OUT = new URL('./results_flag_at_level/', import.meta.url); fs.mkdirSync(OUT, { recursive: true });
const etMin = (t) => { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(t * 1000)); return +p.find((x) => x.type === 'hour').value * 60 + +p.find((x) => x.type === 'minute').value; };
let seed = 20261017; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const START = '2023-11-16', HOLD = '2025-04-01';
const VAR = { full: { vol: 1, stack: 1, flag: 1 }, noVol: { vol: 0, stack: 1, flag: 1 }, noStack: { vol: 1, stack: 0, flag: 1 }, noFlag: { vol: 1, stack: 1, flag: 0 } };
function levelsFor(s, S) {
  const near = s.filter((r) => Math.abs(r[0] / S - 1) <= 0.02), byG = [...near].sort((a, b) => Math.abs(b[1] + b[2]) - Math.abs(a[1] + a[2])).slice(0, 4), byV = [...near].sort((a, b) => Math.abs(b[7] + b[8]) - Math.abs(a[7] + a[8])).slice(0, 2);
  return [...new Set([...byG, ...byV].map((r) => r[0]))];
}
function sim(m1, t5end, dir, entry, stop) {
  const risk = dir * (entry - stop); if (!(risk > 0)) return null; const tgt = entry + dir * 2 * risk;
  for (const b of m1) { if (b.m < t5end) continue;
    if (dir > 0 ? b.l <= stop : b.h >= stop) return -1;
    if (dir > 0 ? b.h >= tgt : b.l <= tgt) return 2;
    if (b.m >= 955) return dir * (b.c - entry) / risk; }
  const l = m1.at(-1); return dir * (l.c - entry) / risk;
}
const rows = [];
for (const T of ['SPY', 'QQQ']) {
  const GR = new Map(fs.readFileSync(new URL(`uwgreeks/${T}.jsonl`, C), 'utf8').split('\n').filter(Boolean).map((l) => { const j = JSON.parse(l); return [j.d, j.s]; }));
  const gd = [...GR.keys()].sort();
  const files = fs.readdirSync(new URL(`uw/m1/${T}/`, C)).filter((f) => f.endsWith('.json')).sort();
  let e8 = null, e21 = null, e34 = null, atr = null, prevC = null, prevClose = null;
  const a8 = 2 / 9, a21 = 2 / 22, a34 = 2 / 35, aA = 1 / 14;
  for (const f of files) {
    const d = f.slice(0, 10);
    const m1 = JSON.parse(fs.readFileSync(new URL(`uw/m1/${T}/${f}`, C), 'utf8')).filter((b) => b.m === 'r').map((b) => ({ m: etMin(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0 })).filter((b) => b.m >= 570 && b.m < 960).sort((a, b) => a.m - b.m);
    if (m1.length < 300) continue;
    const b5 = []; for (const b of m1) { const k = Math.floor((b.m - 570) / 5), x = b5[b5.length - 1]; if (x && x.k === k) { x.h = Math.max(x.h, b.h); x.l = Math.min(x.l, b.l); x.c = b.c; x.v += b.v; } else b5.push({ k, m: 570 + k * 5, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }); }
    // levels from the most recent UW map dated before d
    let gi = gd.findIndex((x) => x >= d) - 1; if (gi === -2) gi = gd.length - 1; const gdate = gd[gi];
    const L0 = d >= START && gdate && prevClose ? levelsFor(GR.get(gdate), prevClose) : null;
    const twins = L0 ? Array.from({ length: 10 }, () => L0.map((L) => L * (1 + (rnd() < 0.5 ? -1 : 1) * (0.003 + rnd() * 0.005)))) : [];
    const st = b5.map((b) => { e8 = e8 == null ? b.c : e8 + a8 * (b.c - e8); e21 = e21 == null ? b.c : e21 + a21 * (b.c - e21); e34 = e34 == null ? b.c : e34 + a34 * (b.c - e34);
      const tr = prevC == null ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - prevC), Math.abs(b.l - prevC)); atr = atr == null ? tr : atr + aA * (tr - atr); prevC = b.c; return { e8, e21, e34, atr }; });
    prevClose = m1.at(-1).c;
    if (!L0) continue;
    const scan = (levels, V) => {
      for (let t = 6; t < b5.length; t++) { const b = b5[t], tEnd = b.m + 5; if (tEnd < 600 || tEnd > 900) continue;
        const F = b5.slice(t - 6, t), fh = Math.max(...F.map((x) => x.h)), fl = Math.min(...F.map((x) => x.l)), s = st[t];
        const bull = s.e8 > s.e21 && s.e21 > s.e34 && b.c > s.e8, bear = s.e8 < s.e21 && s.e21 < s.e34 && b.c < s.e8;
        const tight = fh - fl <= 0.6 * st[t - 1].atr * Math.sqrt(6), volOK = b.v >= 1.5 * F.reduce((a, x) => a + x.v, 0) / 6;
        for (const L of levels) for (const dir of [1, -1]) {
          if (V.stack && !(dir > 0 ? bull : bear)) continue; if (V.vol && !volOK) continue;
          if (!(dir > 0 ? b.c >= L * 1.0002 : b.c <= L * 0.9998)) continue;
          if (V.flag) { if (!tight || Math.abs((dir > 0 ? fh : fl) - L) > L * 0.001) continue; }
          else if (!(dir > 0 ? b5[t - 1].c < L : b5[t - 1].c > L)) continue;
          const R = sim(m1, tEnd, dir, b.c, dir > 0 ? fl : fh); if (R == null) continue; return { m: tEnd, dir, L, R }; } }
      return null; };
    for (const [vn, V] of Object.entries(VAR)) { const r = scan(L0, V); if (!r) continue;
      const tw = vn === 'full' ? twins.map((lv) => scan(lv, V)?.R).filter((x) => x != null) : [];
      rows.push({ T, d, v: vn, ...r, twin: tw.length ? tw.reduce((a, b) => a + b, 0) / tw.length : null, ntw: tw.length, ho: d >= HOLD }); }
    // twin-only days: the pattern fired on shifted maps even if not on ours (needed for a fair per-day twin rate)
    const twAll = twins.map((lv) => scan(lv, VAR.full)?.R).filter((x) => x != null); if (twAll.length) rows.push({ T, d, v: 'twinAll', R: twAll.reduce((a, b) => a + b, 0) / twAll.length, n: twAll.length, ho: d >= HOLD });
  }
  console.log(T, 'done', rows.length);
}
const byDay = (a, f) => { const g = new Map(); for (const x of a) { const v = f(x); if (v == null) continue; const q = g.get(x.d) ?? []; q.push(v); g.set(x.d, q); } return [...g.values()].map((q) => q.reduce((s, v) => s + v, 0) / q.length); };
const ts = (v) => { const n = v.length; if (n < 3) return { n, m: NaN, t: NaN }; const m = v.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)); return { n, m, t: (m / sd) * Math.sqrt(n) }; };
const erf = (x) => { const s = Math.sign(x); x = Math.abs(x); const a = 1 / (1 + 0.3275911 * x); return s * (1 - (((((1.061405429 * a - 1.453152027) * a) + 1.421413741) * a - 0.284496736) * a + 0.254829592) * a * Math.exp(-x * x)); }, pOne = (t) => 0.5 * (1 - erf(t / Math.SQRT2));
const pick = (v, ho) => rows.filter((x) => x.v === v && x.ho === ho);
const L = ['# Flag at our level — results', '', `Run ${new Date().toISOString()} · design shadow/DESIGN_flag_at_level.md`, '', '| variant | build: trades, mean R (t), win | holdout: trades, mean R (t), win |', '|---|---|---|'];
for (const v of ['full', 'noVol', 'noStack', 'noFlag', 'twinAll']) { const b = pick(v, false), h = pick(v, true), sb = ts(byDay(b, (x) => x.R)), sh = ts(byDay(h, (x) => x.R)), w = (a) => a.length ? (a.filter((x) => x.R > 0).length / a.length * 100).toFixed(0) + '%' : '—';
  L.push(`| ${v === 'twinAll' ? 'same pattern on 10 shifted maps (avg per day)' : v} | ${b.length}, ${sb.m.toFixed(3)} (${sb.t.toFixed(2)}), ${w(b)} | ${h.length}, **${sh.m.toFixed(3)}** (${sh.t.toFixed(2)}), ${w(h)} |`); }
const F1 = ts(byDay(pick('full', true), (x) => x.R)), F2 = ts(byDay(pick('full', true), (x) => x.twin == null ? null : x.R - x.twin));
const nv = new Map(pick('noVol', true).map((x) => [x.T + x.d, x.R])), F3 = ts(byDay(pick('full', true), (x) => nv.has(x.T + x.d) ? x.R - nv.get(x.T + x.d) : null));
const T3 = [['F1 full pattern R', F1], ['F2 full − shifted-map twins', F2], ['F3 full − no-volume (same day)', F3]].map(([n, s]) => ({ n, s, p: pOne(s.t) }));
const ps = T3.map((x) => x.p).sort((a, b) => a - b); let kk = 0; ps.forEach((p, i) => { if (p <= ((i + 1) / ps.length) * 0.1) kk = i + 1; }); const cut = kk ? ps[kk - 1] : -1;
L.push('', `**Tests (holdout, BH q = 0.10): ${T3.filter((x) => x.s.m > 0 && x.p <= cut).map((x) => x.n.split(' ')[0]).join(', ') || 'none validated'}**`, '');
for (const x of T3) L.push(`- ${x.n}: mean ${x.s.m.toFixed(3)}R, t ${x.s.t.toFixed(2)}, days ${x.s.n}`);
fs.writeFileSync(new URL('summary.md', OUT), L.join('\n') + '\n'); fs.writeFileSync(new URL('rows.json', OUT), JSON.stringify(rows)); console.log(L.join('\n'));
