#!/usr/bin/env node
// THEME SNOWBALL ENGINE — cause and effect between themes. Locked 2026-10-05 BEFORE running; graph written from domain knowledge.
// Monthly, 2022-04 → 2026-06 (needs 3 months back, 3 months forward). Cached daily bars only (0 Skylit credits).
//   Theme strength = the basket's 3-month equal-weight return as a PERCENTILE vs 10,000 random baskets of the same size drawn
//   from the universe (Monte Carlo). Forward = next 3-month basket return minus the universe equal-weight return.
//   S1 SNOWBALL   themes ≥ 95th percentile → forward excess (does extreme theme strength keep rolling?)
//   S2 CAUSE→EFFECT  an UPSTREAM theme ≥ 90th percentile while its DOWNSTREAM theme is ≤ 60th ("hasn't grown yet") → downstream forward
//   CONTROL       all theme-months (S1) / downstream themes when the upstream is NOT hot (S2).
// PASS = forward excess > control in BOTH halves (2022-04…2024-03 / 2024-04…2026-06) and t ≥ 2 over months.
import fs from 'node:fs';
import { universe, loadDaily } from '../desk/common.mjs';

const THEMES = {
  aiCompute: 'NVDA AMD AVGO MRVL ARM', memory: 'MU SNDK WDC STX', semiEquip: 'AMAT LRCX ASML KLAC TER', foundry: 'TSM INTC GFS',
  optical: 'ANET CIEN COHR LITE CRDO AAOI GLW', servers: 'DELL SMCI HPE', neocloud: 'CRWV NBIS IREN APLD CORZ WULF CIFR',
  power: 'CEG VST NRG GEV', nuclear: 'OKLO SMR CCJ NNE LEU UEC', aiSoftware: 'PLTR NOW CRM SNOW DDOG', cyber: 'PANW CRWD ZS NET FTNT OKTA',
  crypto: 'COIN MSTR HOOD', miners: 'MARA RIOT CLSK HUT', space: 'RKLB ASTS LUNR PL', quantum: 'IONQ RGTI QBTS', ev: 'TSLA RIVN LCID',
  banks: 'JPM BAC WFC C GS MS', oil: 'XOM CVX COP OXY HAL', pharma: 'LLY NVO MRK JNJ', consumer: 'WMT COST TGT HD',
};
// upstream → downstream (who's demand drives whom), written before looking at any result
const EDGES = [['aiCompute', 'memory'], ['aiCompute', 'semiEquip'], ['aiCompute', 'foundry'], ['aiCompute', 'optical'], ['aiCompute', 'servers'], ['aiCompute', 'neocloud'],
  ['aiCompute', 'power'], ['neocloud', 'power'], ['power', 'nuclear'], ['memory', 'semiEquip'], ['aiCompute', 'aiSoftware'], ['crypto', 'miners'], ['miners', 'neocloud'], ['foundry', 'semiEquip']];
const U = universe(), D = new Map(); for (const s of new Set([...U, ...Object.values(THEMES).flatMap((v) => v.split(' '))])) { const b = loadDaily(s); if (b.length > 100) D.set(s, b); }
const px = (s, d) => { const b = D.get(s); if (!b) return null; let x = null; for (const y of b) { if (y.d > d) break; x = y; } return x && x.d >= new Date(Date.parse(d) - 10 * 864e5).toISOString().slice(0, 10) ? x.c : null; };
const ret = (s, a, b) => { const p = px(s, a), q = px(s, b); return p && q ? q / p - 1 : null; };
const monthEnd = (y, m) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
const months = []; for (let y = 2022; y <= 2026; y++) for (let m = 1; m <= 12; m++) { const d = monthEnd(y, m); if (d >= '2022-04-30' && d <= '2026-06-30') months.push({ d, back: monthEnd(y, m - 3 <= 0 ? m + 9 : m - 3).replace(/^\d{4}/, String(m - 3 <= 0 ? y - 1 : y)), fwd: monthEnd(m + 3 > 12 ? y + 1 : y, ((m + 2) % 12) + 1) }); }
let seed = 13; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const rows = [];
for (const M of months) {
  const pool = U.map((s) => ret(s, M.back, M.d)).filter((x) => x != null && Number.isFinite(x)); if (pool.length < 100) continue;
  const uniFwd = U.map((s) => ret(s, M.d, M.fwd)).filter((x) => x != null && Number.isFinite(x)), uf = uniFwd.reduce((a, x) => a + x, 0) / uniFwd.length;
  const th = {};
  for (const [k, v] of Object.entries(THEMES)) { const mem = v.split(' ').filter((s) => ret(s, M.back, M.d) != null); if (mem.length < 3) continue;
    const r3 = mem.reduce((a, s) => a + ret(s, M.back, M.d), 0) / mem.length, fw = mem.map((s) => ret(s, M.d, M.fwd)).filter((x) => x != null);
    let below = 0; for (let i = 0; i < 10000; i++) { let t = 0; for (let j = 0; j < mem.length; j++) t += pool[Math.floor(rnd() * pool.length)]; if (t / mem.length < r3) below++; }
    th[k] = { pct: below / 100, fwdEx: fw.length ? fw.reduce((a, x) => a + x, 0) / fw.length - uf : null }; }
  for (const [k, v] of Object.entries(th)) rows.push({ d: M.d, k, ...v, half: M.d < '2024-04-01' ? 'H1' : 'H2', type: 'theme' });
  for (const [u, dn] of EDGES) { if (!th[u] || !th[dn] || th[dn].fwdEx == null) continue; rows.push({ d: M.d, k: `${u}→${dn}`, half: M.d < '2024-04-01' ? 'H1' : 'H2', type: 'edge', upHot: th[u].pct >= 90, dnCold: th[dn].pct <= 60, fwdEx: th[dn].fwdEx, upPct: th[u].pct, dnPct: th[dn].pct }); }
}
fs.writeFileSync(new URL('./journal/theme_snowball.json', import.meta.url), JSON.stringify(rows));
const st = (v) => { v = v.filter((x) => x != null && Number.isFinite(x)); if (v.length < 2) return { n: v.length, m: NaN, t: NaN }; const m = v.reduce((a, x) => a + x, 0) / v.length, sd = Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1)); return { n: v.length, m, t: m / (sd / Math.sqrt(v.length)) }; };
const pc = (x) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%' : '-');
const verdict = (name, sel, ctl) => { let ok = true; const parts = [];
  for (const h of ['H1', 'H2']) { const a = st(rows.filter((r) => r.half === h && sel(r)).map((r) => r.fwdEx)), c = st(rows.filter((r) => r.half === h && ctl(r)).map((r) => r.fwdEx)); if (!(a.m > c.m)) ok = false; parts.push(`${h === 'H1' ? '2022–24' : '2024–26'}: ${pc(a.m)} (n ${a.n}) vs control ${pc(c.m)} (n ${c.n})`); }
  const all = st(rows.filter(sel).map((r) => r.fwdEx)), allC = st(rows.filter(ctl).map((r) => r.fwdEx)); const t = (all.m - allC.m) / Math.sqrt(st(rows.filter(sel).map((r) => r.fwdEx)).n ? (rows.filter(sel).map((r) => r.fwdEx).reduce((a, x) => a + (x - all.m) ** 2, 0) / (all.n - 1)) / all.n + (rows.filter(ctl).map((r) => r.fwdEx).filter(Number.isFinite).reduce((a, x) => a + (x - allC.m) ** 2, 0) / (allC.n - 1)) / allC.n : 1);
  if (!(t >= 2)) ok = false; console.log(`${ok ? '✓ PASS' : '  FAIL'} ${name}\n    all: ${pc(all.m)} (n ${all.n}) vs control ${pc(allC.m)} · t ${t.toFixed(2)}\n    ${parts.join(' · ')}\n`); };
console.log(`THEME SNOWBALL ENGINE · ${Object.keys(THEMES).length} themes · ${months.length} month-ends · 10,000 random baskets per theme-month · forward = next 3 months minus universe\n`);
verdict('S1 SNOWBALL — theme ≥ 95th percentile keeps rolling', (r) => r.type === 'theme' && r.pct >= 95, (r) => r.type === 'theme');
verdict('S2 CAUSE → EFFECT — upstream hot (≥90th), downstream cold (≤60th) → downstream', (r) => r.type === 'edge' && r.upHot && r.dnCold, (r) => r.type === 'edge' && !r.upHot);
console.log('S2 events by edge (upstream hot & downstream cold):');
const ev = rows.filter((r) => r.type === 'edge' && r.upHot && r.dnCold); const byE = {}; for (const r of ev) (byE[r.k] ??= []).push(r);
for (const [k, v] of Object.entries(byE).sort((a, b) => b[1].length - a[1].length)) console.log(`  ${k.padEnd(24)} ${v.length} months · avg next-3m excess ${pc(st(v.map((r) => r.fwdEx)).m)} · ${v.slice(0, 4).map((r) => `${r.d.slice(0, 7)} up ${r.upPct.toFixed(0)}/dn ${r.dnPct.toFixed(0)} → ${pc(r.fwdEx)}`).join(' · ')}`);
const last = rows.filter((r) => r.d === rows.at(-1).d && r.type === 'theme').sort((a, b) => b.pct - a.pct); console.log(`\nlatest month in the test window (${rows.at(-1).d}): ` + last.map((r) => `${r.k} ${r.pct.toFixed(0)}`).join(' · '));
