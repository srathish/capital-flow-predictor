#!/usr/bin/env node
// THEME / SECTOR selection — "the catalyst + breadth layer" (8/17 blow-ups were theme moves). Locked 2026-10-03 BEFORE running.
// Baskets = the sector baskets already in memory (feedback_always_sector_basket_workup, written 2026-05-26 — not fit to this data),
// intersected with the cached universe (.cache/daily from rank_study --fetch). Themes need ≥4 members with data that week.
//   T1 hot theme      : top-2 themes by avg 20d return → buy all their members
//   T2 theme breadth  : top-2 themes by % of members up over 5d (ties → 20d) → buy all members
//   T3 leader in hot  : top-3 themes by 20d → buy each theme's strongest 20d member
//   T4 laggard in hot : top-3 themes by 20d → buy each theme's weakest 20d member (catch-up)
//   T5 theme 12-1     : top-2 themes by avg 12-1 momentum → buy all members
//   T0 cold theme     : bottom-2 themes by 20d (control — should be the worst)
// Same scoring as rank_study: return minus equal-weight universe; TRAIN 2023–24 / TEST 2025 / HOLD 2026; ✓ = >0 in all three AND t ≥ 2.
//   node shadow/theme_study.mjs [--hold 5|20]
import fs from 'node:fs';
import path from 'node:path';

const HERE = decodeURIComponent(new URL('.', import.meta.url).pathname), DIR = path.join(HERE, '..', '.cache', 'daily');
const B = {
  space: 'ASTS LUNR RKLB SATL SPIR AMPG SIDU VOYG IRDM RDW BKSY GSAT FLY PL HAWK MDA KTOS', dcInfra: 'VRT DLR EQIX ANET NTAP IREN NBIS CRWV WULF APLD GLW',
  aiCompute: 'NVDA AMD AVGO MRVL SMCI ORCL PLTR AI SOUN BBAI', semis: 'NVDA AMD AVGO TSM ASML AMAT LRCX KLAC MU MRVL', crypto: 'COIN MSTR MARA RIOT HUT CIFR IREN CLSK BTBT WULF',
  ev: 'TSLA RIVN LCID NIO XPEV LI F GM', defense: 'LMT RTX NOC GD BA LHX HII KTOS', banks: 'JPM BAC WFC C GS MS USB', oil: 'XOM CVX COP OXY SLB HAL BP EQT',
  saas: 'CRM NOW ORCL SAP ADBE MSFT NET DDOG', cyber: 'PANW CRWD ZS NET FTNT OKTA S', pharma: 'LLY NVO JNJ MRNA BNTX REGN GILD', quantum: 'IONQ RGTI QBTS QUBT ARQQ',
  nuclear: 'OKLO NNE SMR BWXT CCJ LEU',
};
const ymd = (t) => new Date((t + 12 * 3600) * 1000).toISOString().slice(0, 10);
const load = (s) => { const f = path.join(DIR, `${s}.json`); if (!fs.existsSync(f)) return null; const b = JSON.parse(fs.readFileSync(f, 'utf8')); return b.length > 60 ? new Map(b.map((x) => [ymd(x.t), x])) : null; };
const ALL = fs.readdirSync(DIR).map((f) => f.replace('.json', '')).filter((s) => s !== 'SPY');
const D = new Map(ALL.map((s) => [s, load(s)]).filter(([, m]) => m));
const TH = Object.fromEntries(Object.entries(B).map(([k, v]) => [k, v.split(' ').filter((s) => D.has(s))]).filter(([, v]) => v.length >= 4));
const spy = JSON.parse(fs.readFileSync(path.join(DIR, 'SPY.json'), 'utf8')), days = spy.map((x) => ymd(x.t));
const fridays = days.filter((d, i) => i + 1 < days.length && new Date(days[i + 1] + 'T12:00:00Z') - new Date(d + 'T12:00:00Z') > 86400000 * 1.5 && new Date(d + 'T12:00:00Z').getUTCDay() >= 4);
const HOLD = process.argv.includes('--hold') ? +process.argv[process.argv.indexOf('--hold') + 1] : 5, STEP = HOLD >= 20 ? 4 : 1;
const back = (m, i, n) => { const a = m.get(days[i]), b = m.get(days[i - n]); return a && b ? a.c / b.c - 1 : null; };
const per = (d) => (d < '2025-01-01' ? 'TRAIN' : d < '2026-01-01' ? 'TEST' : 'HOLD');
const R = { 'T1 hot theme (20d)': [], 'T2 theme breadth (5d)': [], 'T3 leader in hot theme': [], 'T4 laggard in hot theme': [], 'T5 theme 12-1': [], 'T0 cold theme (control)': [] };
for (const [wk, fd] of fridays.filter((d) => d >= '2023-01-01').entries()) {
  if (wk % STEP) continue;
  const i = days.indexOf(fd); if (i < 260 || i + HOLD >= days.length) continue;
  const o = days[i + 1], cl = days[i + HOLD];
  const ret = (s) => { const m = D.get(s), a = m.get(o), b = m.get(cl); return a && b ? b.c / a.o - 1 : null; };
  const uniR = [...D.keys()].map(ret).filter((x) => x != null), uni = uniR.reduce((a, x) => a + x, 0) / uniR.length;
  const th = Object.entries(TH).map(([k, mem]) => {
    const ms = mem.map((s) => ({ s, r20: back(D.get(s), i, 20), r5: back(D.get(s), i, 5), m121: (() => { const m = D.get(s), a = m.get(days[i - 21]), b = m.get(days[i - 252]); return a && b ? a.c / b.c - 1 : null; })(), fwd: ret(s) })).filter((x) => x.r20 != null && x.r5 != null && x.fwd != null);
    if (ms.length < 4) return null;
    const av = (k) => { const v = ms.map((x) => x[k]).filter((x) => x != null); return v.length ? v.reduce((a, x) => a + x, 0) / v.length : null; };
    return { k, ms, r20: av('r20'), m121: av('m121'), breadth: ms.filter((x) => x.r5 > 0).length / ms.length };
  }).filter(Boolean);
  if (th.length < 6) continue;
  const book = (picks) => (picks.length ? picks.reduce((a, x) => a + x.fwd, 0) / picks.length - uni : null);
  const by = (f) => [...th].sort((a, b) => f(b) - f(a));
  const push = (name, picks, themes) => { const ex = book(picks); if (ex != null) R[name].push({ fd, per: per(fd), ex, themes }); };
  const hot2 = by((t) => t.r20).slice(0, 2), hot3 = by((t) => t.r20).slice(0, 3);
  push('T1 hot theme (20d)', hot2.flatMap((t) => t.ms), hot2.map((t) => t.k));
  const br2 = by((t) => t.breadth + t.r20 / 100).slice(0, 2); push('T2 theme breadth (5d)', br2.flatMap((t) => t.ms), br2.map((t) => t.k));
  push('T3 leader in hot theme', hot3.map((t) => [...t.ms].sort((a, b) => b.r20 - a.r20)[0]), hot3.map((t) => t.k));
  push('T4 laggard in hot theme', hot3.map((t) => [...t.ms].sort((a, b) => a.r20 - b.r20)[0]), hot3.map((t) => t.k));
  const m2 = th.filter((t) => t.m121 != null).sort((a, b) => b.m121 - a.m121).slice(0, 2); push('T5 theme 12-1', m2.flatMap((t) => t.ms), m2.map((t) => t.k));
  const cold = by((t) => -t.r20).slice(0, 2); push('T0 cold theme (control)', cold.flatMap((t) => t.ms), cold.map((t) => t.k));
}
const S = (X) => { if (X.length < 2) return { m: NaN, t: NaN, hit: NaN, n: X.length }; const v = X.map((x) => x.ex), m = v.reduce((a, x) => a + x, 0) / v.length, sd = Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1)); return { m, t: m / (sd / Math.sqrt(v.length)), hit: v.filter((x) => x > 0).length / v.length, n: v.length }; };
const pc = (x) => (x >= 0 ? '+' : '') + (x * 100).toFixed(2) + '%';
console.log(`themes used: ${Object.entries(TH).map(([k, v]) => `${k}(${v.length})`).join(' ')}`);
console.log(`hold ${HOLD} sessions · ${R['T1 hot theme (20d)'].length} rebalances · excess vs equal-weight universe\n`);
console.log(`${'rule'.padEnd(28)} ${'TRAIN 23-24'.padStart(12)} ${'TEST 2025'.padStart(11)} ${'HOLD 2026'.padStart(11)}   all t   hit`);
for (const [k, X] of Object.entries(R)) {
  const a = S(X.filter((x) => x.per === 'TRAIN')), b = S(X.filter((x) => x.per === 'TEST')), c = S(X.filter((x) => x.per === 'HOLD')), all = S(X);
  console.log(`${a.m > 0 && b.m > 0 && c.m > 0 && all.t >= 2 && !k.startsWith('T0') ? '✓' : ' '} ${k.padEnd(26)} ${pc(a.m).padStart(12)} ${pc(b.m).padStart(11)} ${pc(c.m).padStart(11)}   ${all.t.toFixed(1).padStart(4)}  ${(all.hit * 100).toFixed(0)}%`);
}
console.log('\nmost recent hot themes:', R['T1 hot theme (20d)'].slice(-4).map((x) => `${x.fd}: ${x.themes.join('+')}`).join(' · '));
fs.writeFileSync(path.join(HERE, 'journal', `theme_study.hold${HOLD}.json`), JSON.stringify(R));
